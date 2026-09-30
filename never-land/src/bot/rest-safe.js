'use strict';
function patchGateway(client) {
  let used = false;
  client.options.ws ||= {};
  client.options.ws.buildIdentifyThrottler = () => ({ waitForIdentify: () => used ? Promise.reject(new Error('identify blocked: one safe login only')) : (used = true, Promise.resolve()), destroy(){} });
  const old = client.rest.get.bind(client.rest);
  client.rest.get = (route, opt) => String(route).includes('gateway/bot') ? Promise.resolve({ url:'wss://gateway.discord.gg', shards:1, session_start_limit:{total:1,remaining:1,reset_after:0,max_concurrency:1} }) : old(route, opt);
}
function installProxy(client) { try { require('../lib/discordRestProxy').install(client.rest); } catch (e) { console.error('[proxy]', e.message); } }
module.exports = { patchGateway, installProxy };
