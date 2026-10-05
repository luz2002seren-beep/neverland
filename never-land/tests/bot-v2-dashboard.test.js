'use strict';

// Bot V2 is tested as a website integration only: no Discord token, gateway,
// proxy or external network is used. This guards the preview-first contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), `never-land-bot-v2-test-${process.pid}.db`);
process.env.DEMO_MODE = 'true';
process.env.RUN_WEB = 'true';
process.env.RUN_BOT = 'false';
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'bot-v2-test-session-secret-long-enough-1234567890';
process.env.PORT = '0';
delete process.env.DISCORD_TOKEN;
delete process.env.PRIMARY_GUILD_ID;

const db = require('../src/database');
const { createApp } = require('../src/web/server');

function request(port, route, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json' };
    if (body) {
      headers['content-type'] = 'application/json';
      headers.origin = `http://127.0.0.1:${port}`;
      headers['content-length'] = Buffer.byteLength(body);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let data = text;
        try { data = JSON.parse(text); } catch { /* page response */ }
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  db.init?.();
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const port = server.address().port;
    const page = await request(port, '/bot-control');
    assert.equal(page.status, 200);
    assert.match(page.text, /مركز إدارة Never Land/);
    assert.match(page.text, /bot-control\.js/);

    const initial = await request(port, '/api/bot-v2');
    assert.equal(initial.status, 200);
    assert.equal(initial.data.runtime.state, 'disabled');
    assert.equal(initial.data.environment.tokenConfigured, false);
    assert.equal(initial.data.settings.modules.tickets, true);

    const body = JSON.stringify({
      settings: {
        tickets: { title: 'Preview support', supportRoleIds: ['123456789012345678', 'bad-id'] },
        automod: { blockedWords: ['Scam', ' scam ', ''], action: 'warn' },
        unexpected: { shouldNotPersist: true },
      },
    });
    const saved = await request(port, '/api/bot-v2/config', { method: 'PUT', body });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.ok, true);
    assert.equal(saved.data.settings.tickets.title, 'Preview support');
    assert.deepEqual(saved.data.settings.tickets.supportRoleIds, ['123456789012345678']);
    assert.deepEqual(saved.data.settings.automod.blockedWords, ['scam']);
    assert.equal(saved.data.settings.automod.action, 'warn');
    assert.equal('unexpected' in saved.data.settings, false);

    const refreshed = await request(port, '/api/bot-v2');
    assert.equal(refreshed.data.settings.tickets.title, 'Preview support');
    console.log('✓ Bot V2 dashboard preview and safe settings persistence passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* absent */ }
    }
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
