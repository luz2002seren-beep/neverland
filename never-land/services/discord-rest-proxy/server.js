'use strict';

/**
 * Never Land Discord REST relay — deploy as its own persistent service.
 * It has no bot token in its environment. The bot authenticates each request
 * with a shared secret and passes its bot Authorization header over TLS.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || 8080);
const secret = String(process.env.PROXY_SHARED_SECRET || '');
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTE = /^\/(?:[A-Za-z0-9_@.\-~%/:?=&]+)$/;

function sameSecret(received) {
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(secret);
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 256 * 1024) {
        reject(Object.assign(new Error('payload_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('invalid_json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function discordRequest(payload, authorization) {
  const method = String(payload?.method || '').toUpperCase();
  const route = String(payload?.route || '');
  if (!allowedMethods.has(method) || !ROUTE.test(route) || route.includes('..')) {
    const error = new Error('invalid_route');
    error.status = 400;
    throw error;
  }
  if (!/^Bot\s+[A-Za-z0-9._-]{50,}$/i.test(String(authorization || ''))) {
    const error = new Error('invalid_authorization');
    error.status = 401;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  timer.unref?.();
  try {
    const response = await fetch(`https://discord.com/api/v10${route}`, {
      method,
      headers: {
        authorization,
        ...(payload.body === null || payload.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(payload.reason ? { 'x-audit-log-reason': encodeURIComponent(String(payload.reason).slice(0, 400)) } : {}),
      },
      body: payload.body === null || payload.body === undefined ? undefined : JSON.stringify(payload.body),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    return {
      status: response.status,
      headers: {
        'x-ratelimit-remaining': response.headers.get('x-ratelimit-remaining') || '',
        'x-ratelimit-reset-after': response.headers.get('x-ratelimit-reset-after') || '',
      },
      contentType,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return send(res, 200, { ok: true, service: 'neverland-discord-rest-relay', time: new Date().toISOString() });
  }
  if (req.method !== 'POST' || req.url !== '/v1/discord') return send(res, 404, { error: 'not_found' });
  if (!secret || !sameSecret(req.headers['x-neverland-proxy-secret'])) return send(res, 401, { error: 'unauthorized' });

  try {
    const payload = await readJson(req);
    const result = await discordRequest(payload, req.headers.authorization);
    // Discord normally answers JSON. Preserve raw errors only when Discord did.
    res.writeHead(result.status, {
      'content-type': result.contentType || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...result.headers,
    });
    return res.end(result.text);
  } catch (error) {
    const status = Number(error.status) || (error.name === 'AbortError' ? 504 : 502);
    return send(res, status, { error: status === 504 ? 'upstream_timeout' : 'relay_error' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Discord REST relay listening on ${port}`));
