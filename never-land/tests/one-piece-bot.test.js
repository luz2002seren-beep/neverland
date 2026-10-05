'use strict';

/*
 * Focused production-safety checks for the clean One Piece bot.
 * These tests intentionally do not need Discord credentials or a live network
 * connection to Discord; the HTTP server only simulates the configured REST proxy.
 */
const assert = require('node:assert/strict');
const http = require('node:http');

const PRIMARY = '1160219059921629276';
const OTHER = '1542345715949506630';
process.env.PRIMARY_GUILD_ID = PRIMARY;
process.env.CLIENT_ID = '1554905841721671903';
process.env.DISCORD_TOKEN = 'x'.repeat(60);
delete process.env.DISCORD_REST_PROXY_URL;
delete process.env.DISCORD_REST_PROXY_SECRET;
delete process.env.DISCORD_ALLOW_DIRECT_REST;

const env = require('../src/bot/env');
const { cmds, lock, inPrimaryGuild } = require('../src/bot/commands');
const { onMessage } = require('../src/bot/text');
const proxy = require('../src/lib/discordRestProxy');
const { patchGateway } = require('../src/bot/rest-safe');
const { createClient, CACHE_LIMITS } = require('../src/bot/runtime');

function context(guildId, edits, replies) {
  return {
    guildId,
    guild: { id: guildId, roles: { everyone: { id: guildId } } },
    channel: {
      toString: () => '#test-channel',
      permissionOverwrites: {
        edit: async (_role, permissions) => { edits.push(permissions); },
      },
    },
    reply: async payload => { replies.push(payload); },
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function main() {
  assert.equal(env.ready, true, 'bot must require token, client ID, and primary guild ID');
  assert.equal(env.guildId, PRIMARY);

  const names = [...cmds.keys()].sort();
  assert.deepEqual(names, ['ban', 'clear', 'kick', 'lock', 'ping', 'server', 'ticket-panel', 'timeout', 'unlock', 'warn']);
  assert.equal(names.length, 10, 'only the ten One Piece guild commands should be registered');
  assert.equal(cmds.get('lock').defer, true, 'slow moderation commands must acknowledge immediately');
  assert.equal(cmds.get('clear').ephemeral, true, 'clear acknowledgement must preserve its ephemeral reply');
  assert.equal(cmds.get('ping').defer, false, 'fast ping does not need an unnecessary acknowledgement');
  assert.equal(CACHE_LIMITS.GuildMemberManager.maxSize, 250, 'member cache must be bounded');
  assert.equal(CACHE_LIMITS.UserManager.maxSize, 250, 'user cache must be bounded');
  assert.equal(CACHE_LIMITS.MessageManager, 0, 'message cache must be disabled');
  assert.equal(CACHE_LIMITS.PresenceManager, 0, 'presence cache must be disabled');
  assert.equal(inPrimaryGuild({ guildId: PRIMARY }), true);
  assert.equal(inPrimaryGuild({ guildId: OTHER }), false);

  const wrongEdits = [];
  const wrongReplies = [];
  await lock(context(OTHER, wrongEdits, wrongReplies), true);
  assert.equal(wrongEdits.length, 0, 'lock must ignore another guild');
  assert.equal(wrongReplies.length, 0, 'lock must not reply in another guild');

  const edits = [];
  const replies = [];
  await lock(context(PRIMARY, edits, replies), true);
  await lock(context(PRIMARY, edits, replies), false);
  assert.deepEqual(edits, [{ SendMessages: false }, { SendMessages: true }], 'lock/unlock must deny then allow SendMessages');
  assert.equal(replies[0].embeds[0].data.title, '🔒 𝑳𝒐𝒄𝒌𝒆𝒅');
  assert.equal(replies[1].embeds[0].data.title, '🔓 𝑼𝒏𝒍𝒐𝒄𝒌𝒆𝒅');

  // Slow slash commands must defer first, then edit the response after the work.
  const client = createClient();
  try {
    const deferred = [];
    const slashEdits = [];
    const slashPermissions = [];
    let finishEdit;
    const editFinished = new Promise(resolve => { finishEdit = resolve; });
    const slash = {
      guildId: PRIMARY,
      guild: { id: PRIMARY, roles: { everyone: { id: PRIMARY } } },
      channel: {
        toString: () => '#test-channel',
        permissionOverwrites: { edit: async (_role, permissions) => { slashPermissions.push(permissions); } },
      },
      commandName: 'lock',
      deferred: false,
      replied: false,
      isButton: () => false,
      isChatInputCommand: () => true,
      deferReply: async options => { deferred.push(options); slash.deferred = true; },
      editReply: async payload => { slashEdits.push(payload); finishEdit(); },
      reply: async () => { throw new Error('reply must not be used after deferReply'); },
    };
    client.emit('interactionCreate', slash);
    await Promise.race([
      editFinished,
      new Promise((_, reject) => setTimeout(() => reject(new Error('deferred slash command timed out in test')), 1_000)),
    ]);
    assert.deepEqual(deferred, [{ ephemeral: false }]);
    assert.deepEqual(slashPermissions, [{ SendMessages: false }]);
    assert.equal(slashEdits[0].embeds[0].data.title, '🔒 𝑳𝒐𝒄𝒌𝒆𝒅');
  } finally {
    client.destroy();
  }

  // Text commands must be blocked before they can perform any action outside One Piece.
  await onMessage({ guild: { id: OTHER }, content: 'قفل' });

  let directCalls = 0;
  const blockedRest = {
    put: async () => { directCalls += 1; },
    get: async () => { directCalls += 1; },
  };
  proxy.install(blockedRest);
  await assert.rejects(() => blockedRest.put('/channels/test', { body: {} }), /direct Discord REST is disabled/);
  assert.equal(directCalls, 0, 'missing proxy must never fall back to direct Discord REST');

  const received = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/discord' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      received.push({ secret: req.headers['x-neverland-secret'], body: JSON.parse(raw) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { proxied: true } }));
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const port = await listen(server);
    process.env.DISCORD_REST_PROXY_URL = `http://127.0.0.1:${port}`;
    process.env.DISCORD_REST_PROXY_SECRET = 'test-proxy-secret';

    directCalls = 0;
    const proxiedRest = {
      put: async () => { directCalls += 1; },
      get: async () => { directCalls += 1; },
    };
    proxy.install(proxiedRest);
    const result = await proxiedRest.put('/channels/1553824667167629334/permissions/everyone', {
      body: { type: 0, allow: '0', deny: '2048' },
      reason: 'lock command',
    });
    assert.deepEqual(result, { proxied: true });
    assert.equal(directCalls, 0, 'configured requests must use the proxy, not Railway direct REST');
    assert.equal(received.length, 1);
    assert.equal(received[0].secret, 'test-proxy-secret');
    assert.equal(received[0].body.method, 'PUT');
    assert.equal(received[0].body.path, '/channels/1553824667167629334/permissions/everyone');
    assert.equal(await proxy.probe(), true, 'proxy health endpoint must be checked successfully');
    assert.deepEqual(proxy.status().healthy, true);

    let gatewayDirectCalls = 0;
    const fakeClient = {
      options: {},
      rest: { get: async () => { gatewayDirectCalls += 1; return null; } },
    };
    patchGateway(fakeClient);
    const gateway = await fakeClient.rest.get('/gateway/bot');
    assert.equal(gateway.url, 'wss://gateway.discord.gg');
    assert.equal(gatewayDirectCalls, 0, '/gateway/bot must never be requested');
  } finally {
    delete process.env.DISCORD_REST_PROXY_URL;
    delete process.env.DISCORD_REST_PROXY_SECRET;
    await new Promise(resolve => server.close(resolve));
  }

  console.log('✓ One Piece bot safety checks passed');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
