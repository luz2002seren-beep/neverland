#!/usr/bin/env python3
"""Minimal authenticated Discord REST proxy for Never Land / One Piece.

Run this OUTSIDE Railway (for example on a VPS behind a Cloudflare named tunnel).
It never accepts a Discord token from callers: the bot token stays on the proxy
host in an environment variable or a root-readable local secret file.
"""
from __future__ import annotations

import hmac
import json
import os
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

MAX_BODY_BYTES = 1_048_576
ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
DISCORD_API_BASE = os.environ.get("DISCORD_API_BASE", "https://discord.com/api/v10").rstrip("/")


def read_secret(name: str, file_name: str, legacy_path: str) -> str:
    """Read a secret without ever logging it."""
    value = os.environ.get(name, "").strip()
    if value:
        return value
    path = os.environ.get(file_name, legacy_path).strip()
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


DISCORD_TOKEN = read_secret("DISCORD_TOKEN", "DISCORD_TOKEN_FILE", "/tmp/nl-discord-token")
PROXY_SECRET = read_secret(
    "DISCORD_REST_PROXY_SECRET",
    "DISCORD_REST_PROXY_SECRET_FILE",
    "/tmp/nl-proxy-secret",
)


def is_ready() -> bool:
    return len(DISCORD_TOKEN) > 50 and len(PROXY_SECRET) >= 24


def json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def safe_path(raw_path: Any, query: Any = None) -> str:
    """Only permit relative Discord API paths; this prevents proxy SSRF."""
    path = str(raw_path or "")
    if not path.startswith("/") or path.startswith("//") or "://" in path or "\\" in path:
        raise ValueError("invalid Discord API path")
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc:
        raise ValueError("invalid Discord API path")
    path = parsed.path
    if query:
        if not isinstance(query, dict):
            raise ValueError("invalid query")
        pairs: list[str] = []
        for key, value in query.items():
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                pairs.extend(f"{quote(str(key), safe='')}={quote(str(item), safe='')}" for item in value)
            else:
                pairs.append(f"{quote(str(key), safe='')}={quote(str(value), safe='')}")
        if pairs:
            path += "?" + "&".join(pairs)
    elif parsed.query:
        path += "?" + parsed.query
    return path


def discord_request(method: str, path: str, body: Any, reason: Any, query: Any) -> tuple[int, Any]:
    method = str(method or "").upper()
    if method not in ALLOWED_METHODS:
        raise ValueError("unsupported method")
    relative_path = safe_path(path, query)
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    headers = {
        "Authorization": f"Bot {DISCORD_TOKEN}",
        "User-Agent": "NeverLand-Discord-Rest-Proxy/1.0",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if reason:
        headers["X-Audit-Log-Reason"] = quote(str(reason)[:512], safe="")

    request = Request(f"{DISCORD_API_BASE}{relative_path}", data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            status = response.status
            raw = response.read()
    except HTTPError as error:
        status = error.code
        raw = error.read()
    except URLError as error:
        raise RuntimeError("Discord API is unreachable") from error

    if not raw:
        data: Any = None
    else:
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            data = None
    return status, data


class Handler(BaseHTTPRequestHandler):
    server_version = "NeverLandDiscordProxy/1.0"

    def log_message(self, _format: str, *_args: Any) -> None:
        # Do not write request bodies, auth headers, or proxy secrets to logs.
        return

    def respond(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/healthz":
            self.respond(HTTPStatus.OK if is_ready() else HTTPStatus.SERVICE_UNAVAILABLE, {"ok": is_ready()})
            return
        self.respond(HTTPStatus.NOT_FOUND, {"ok": False})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/discord":
            self.respond(HTTPStatus.NOT_FOUND, {"ok": False})
            return
        if not is_ready():
            self.respond(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "proxy_not_configured"})
            return
        supplied = self.headers.get("X-NeverLand-Secret", "")
        if not supplied or not hmac.compare_digest(supplied, PROXY_SECRET):
            self.respond(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_BODY_BYTES:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("invalid request")
            status, data = discord_request(
                payload.get("method"),
                payload.get("path"),
                payload.get("body"),
                payload.get("reason"),
                payload.get("query"),
            )
            if 200 <= status < 300:
                self.respond(HTTPStatus.OK, {"ok": True, "data": data})
            else:
                # Do not relay Discord's raw error payload: callers do not need it
                # and it can contain user-provided content.
                self.respond(status, {"ok": False, "error": f"discord_status_{status}"})
        except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
            self.respond(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "bad_request"})
        except RuntimeError:
            self.respond(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": "discord_unreachable"})
        except Exception:
            self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "proxy_error"})


def main() -> None:
    host = os.environ.get("PROXY_HOST", "127.0.0.1")
    port = int(os.environ.get("PROXY_PORT", "8787"))
    if not is_ready():
        print("Discord REST proxy is not configured: provide local secret files or environment variables.", file=sys.stderr)
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Discord REST proxy listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
