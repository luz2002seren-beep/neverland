'use strict';
const discordProxy = require('../lib/discordRestProxy');

function patchGateway(client) {
  let used = false;
  client.options.ws ||= {};
  client.options.ws.buildIdentifyThrottler = () => ({
    waitForIdentify: () => used
      ? Promise.reject(new Error('identify blocked: one safe login only'))
      : (used = true, Promise.resolve()),
    destroy() {},
  });

  // Never ask Discord for /gateway/bot from this runtime. discord.js only needs
  // this metadata to open its Gateway WebSocket, so the fixed safe value is enough.
  const old = client.rest.get.bind(client.rest);
  client.rest.get = (route, opt) => String(route).includes('gateway/bot')
    ? Promise.resolve({
      url: 'wss://gateway.discord.gg',
      shards: 1,
      session_start_limit: { total: 1, remaining: 1, reset_after: 0, max_concurrency: 1 },
    })
    : old(route, opt);
}

function installProxy(client) {
  try {
    return discordProxy.install(client.rest);
  } catch (error) {
    console.error('[proxy] could not install Discord REST guard:', error?.message || error);
    return client.rest;
  }
}

function probeProxy() {
  return discordProxy.probe();
}

module.exports = { patchGateway, installProxy, probeProxy };
