'use strict';

/**
 * Discord REST transport for environments where direct Discord HTTPS is not
 * reliable. Gateway traffic remains Discord's normal WebSocket connection;
 * only REST requests are sent to a small, separately deployed relay.
 *
 * The relay contract is deliberately narrow: POST /v1/discord with a route,
 * method and JSON body. The bot token is sent only in the TLS request header,
 * never persisted or written to logs.
 */
function install(rest, env) {
  if (env.transport === 'direct') return { mode: 'direct' };
  if (env.transport !== 'proxy') {
    throw new Error('Discord REST is intentionally blocked: configure a durable proxy or explicitly allow direct REST.');
  }
  if (!env.proxyUrl || !env.proxySecret) {
    throw new Error('Discord REST proxy URL or shared secret is missing.');
  }

  const endpoint = `${env.proxyUrl}/v1/discord`;
  rest.request = async (request = {}) => {
    const method = String(request.method || 'GET').toUpperCase();
    const route = String(request.fullRoute || '');
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method) || !route.startsWith('/') || route.includes('://')) {
      throw new Error('Refused an invalid Discord REST proxy request.');
    }
    if (Array.isArray(request.files) && request.files.length) {
      throw new Error('Attachment uploads are not enabled through the Discord REST relay.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    timer.unref?.();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-neverland-proxy-secret': env.proxySecret,
          // The relay does not store this value; it forwards it to Discord.
          authorization: `Bot ${env.token}`,
        },
        body: JSON.stringify({ method, route, body: request.body ?? null, reason: request.reason || null }),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text || null; }
      if (!response.ok) {
        const error = new Error(`Discord REST relay returned ${response.status}.`);
        error.status = response.status;
        error.data = payload;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  };

  return { mode: 'proxy', endpoint: env.proxyUrl };
}

module.exports = { install };
