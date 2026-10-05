'use strict';

// Website-only smoke test. It uses a temporary local database and never starts
// a Discord client or uses Discord credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), `never-land-site-test-${process.pid}.db`);
process.env.DEMO_MODE = 'true';
process.env.RUN_WEB = 'true';
process.env.RUN_BOT = 'false';
process.env.DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = 'site-test-session-secret-long-enough-1234567890';
process.env.PORT = '0';
delete process.env.DISCORD_TOKEN;

const db = require('../src/database');
const { createApp } = require('../src/web/server');

after().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

async function after() {
  db.init?.();
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const port = server.address().port;
    const payload = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/healthz`, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, data: JSON.parse(body) });
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });

    assert.equal(payload.status, 200);
    assert.equal(payload.data.ok, true);
    assert.equal(payload.data.site, 'Never Land');
    assert.equal(payload.data.bot, false, 'the website deployment must not start a Discord bot');
    assert.equal('restProxy' in payload.data, false, 'the deleted bot proxy must not be exposed by health');
    console.log('✓ Website-only runtime health check passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* absent */ }
    }
  }
}
