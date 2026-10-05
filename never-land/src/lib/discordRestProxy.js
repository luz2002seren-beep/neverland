'use strict';

// Railway's direct Discord REST egress has been unreliable for this service.
// Keep every REST mutation behind the explicitly configured proxy unless a local
// developer intentionally opts in to direct REST.
const state = {
  configured: false,
  healthy: null,
  checkedAt: null,
  lastSuccessAt: null,
};

function proxyConfig() {
  const base = String(process.env.DISCORD_REST_PROXY_URL || '').trim().replace(/\/+$/, '');
  const secret = String(process.env.DISCORD_REST_PROXY_SECRET || '').trim();
  if (!base || !secret) return null;
  return { base, secret };
}

function directRestExplicitlyAllowed() {
  return /^(1|true|yes|on)$/i.test(String(process.env.DISCORD_ALLOW_DIRECT_REST || ''));
}

function updateState(healthy, succeeded = false) {
  state.configured = Boolean(proxyConfig());
  state.healthy = healthy;
  state.checkedAt = new Date().toISOString();
  if (succeeded) state.lastSuccessAt = state.checkedAt;
}

function proxyUnavailableError() {
  return new Error('Discord REST proxy is not configured; direct Discord REST is disabled.');
}

async function fetchWithTimeout(url, options, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request(method, path, body, extra = {}) {
  const cfg = proxyConfig();
  if (!cfg) {
    const error = proxyUnavailableError();
    updateState(false);
    throw error;
  }

  try {
    const res = await fetchWithTimeout(`${cfg.base}/discord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NeverLand-Secret': cfg.secret,
      },
      body: JSON.stringify({ method, path, body, query: extra.query || null, reason: extra.reason || null }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) {
      throw new Error(`Discord REST proxy rejected request (${res.status}).`);
    }
    updateState(true, true);
    return data?.data == null ? true : data.data;
  } catch (error) {
    updateState(false);
    throw error;
  }
}

async function probe() {
  const cfg = proxyConfig();
  if (!cfg) {
    updateState(false);
    return false;
  }
  try {
    const res = await fetchWithTimeout(`${cfg.base}/healthz`, { method: 'GET' }, 8_000);
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) throw new Error('Proxy health check failed.');
    updateState(true, true);
    return true;
  } catch {
    updateState(false);
    return false;
  }
}

function status() {
  return {
    configured: Boolean(proxyConfig()),
    healthy: state.healthy,
    checkedAt: state.checkedAt,
    lastSuccessAt: state.lastSuccessAt,
  };
}

function install(rest) {
  if (!rest || rest.__neverLandProxyInstalled) return rest;

  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = rest[method];
    if (typeof original !== 'function') continue;
    rest[method] = async function proxied(path, options = {}) {
      const cfg = proxyConfig();
      if (!cfg) {
        if (directRestExplicitlyAllowed()) return original.call(this, path, options);
        const error = proxyUnavailableError();
        updateState(false);
        throw error;
      }
      // The proxy protocol is JSON-only. Fail closed instead of leaking an upload
      // through Railway's direct Discord REST path.
      if (options?.files?.length) {
        const error = new Error('Discord REST proxy does not support file uploads; direct Discord REST is disabled.');
        updateState(false);
        throw error;
      }
      return request(method.toUpperCase(), path, options.body ?? null, options);
    };
  }

  rest.__neverLandProxyInstalled = true;
  console.log('[DiscordProxy] Proxied Discord REST is enforced.');
  return rest;
}

module.exports = {
  request,
  install,
  probe,
  status,
  enabled: () => Boolean(proxyConfig()),
};
