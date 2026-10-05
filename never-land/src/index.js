'use strict';
require('node:dns').setDefaultResultOrder('ipv4first');

const args = process.argv.slice(2);
const off = value => /^(false|0|off|no)$/i.test(String(value || ''));
const on = value => /^(true|1|on|yes)$/i.test(String(value || ''));
const runWeb = !args.includes('--no-web') && !off(process.env.RUN_WEB);
// Safe default: Bot V2 never opens a Discord connection unless explicitly enabled.
const runBot = !args.includes('--no-bot') && on(process.env.RUN_BOT);
let databaseReady = false;

process.on('unhandledRejection', error => console.error('[unhandled]', error?.message || error));
process.on('uncaughtException', error => console.error('[fatal]', error?.stack || error));

function initializeDatabase() {
  if (databaseReady) return require('./database');
  const db = require('./database');
  db.init?.();
  databaseReady = true;
  return db;
}

async function startWeb() {
  try {
    initializeDatabase();
    const { startServer } = require('./web/server');
    return startServer();
  } catch (error) {
    console.error('[web]', error.message);
    return null;
  }
}

async function startBot() {
  try {
    initializeDatabase();
    const bot = require('./bot/runtime');
    return await bot.start();
  } catch (error) {
    console.error('[bot-v2]', error.message);
    return null;
  }
}

(async () => {
  console.log('\nNever Land — website + Bot V2 runtime\n');
  if (runWeb) await startWeb();
  else console.log('[web] skipped');
  if (runBot) await startBot();
  else console.log('[bot-v2] disabled (set RUN_BOT=true only after review and Railway configuration).');
  console.log('[ready] service boot complete');
})();

async function shutdown() {
  try { await require('./bot/runtime').stop(); } catch { /* bot was never loaded */ }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
