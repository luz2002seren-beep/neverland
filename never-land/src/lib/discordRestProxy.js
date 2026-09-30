'use strict';

function proxyConfig() {
  const base = String(process.env.DISCORD_REST_PROXY_URL || '').trim().replace(/\/+$/, '');
  const secret = String(process.env.DISCORD_REST_PROXY_SECRET || '').trim();
  if (!base || !secret) return null;
  return { base, secret };
}

async function request(method, path, body, extra = {}) {
  const cfg = proxyConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.base}/discord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-NeverLand-Secret': cfg.secret,
    },
    body: JSON.stringify({ method, path, body, reason: extra.reason || null }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    const message = data?.message || data?.error || res.statusText;
    throw new Error(`proxy ${res.status}: ${message}`);
  }
  return data?.data == null ? true : data.data;
}

function install(rest) {
  if (!rest || rest.__neverLandProxyInstalled || !proxyConfig()) return rest;
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = rest[method];
    if (typeof original !== 'function') continue;
    rest[method] = async function proxied(path, options = {}) {
      if (options?.files?.length) return original.call(this, path, options);
      try {
        return await request(method.toUpperCase(), path, options.body ?? null, options);
      } catch (err) {
        console.error(`[DiscordProxy] ${method.toUpperCase()} ${path} فشل:`, err?.message || err);
        throw err;
      }
    };
  }
  rest.__neverLandProxyInstalled = true;
  console.log('[DiscordProxy] REST proxy مفعّل لطلبات ديسكورد.');
  return rest;
}

module.exports = { request, install, enabled: () => Boolean(proxyConfig()) };
