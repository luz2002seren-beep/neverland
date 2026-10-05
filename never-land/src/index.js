'use strict';
require('node:dns').setDefaultResultOrder('ipv4first');

const args = process.argv.slice(2);
const off = value => /^(false|0|off|no)$/i.test(String(value || ''));
const runWeb = !args.includes('--no-web') && !off(process.env.RUN_WEB);

process.on('unhandledRejection', error => console.error('[unhandled]', error?.message || error));
process.on('uncaughtException', error => console.error('[fatal]', error?.stack || error));

async function startWeb() {
  try {
    const db = require('./database');
    db.init?.();
    const { startServer } = require('./web/server');
    return startServer();
  } catch (error) {
    console.error('[web]', error.message);
    return null;
  }
}

(async () => {
  console.log('\nNever Land — website runtime\n');
  if (runWeb) await startWeb();
  else console.log('[web] skipped');
  console.log('[ready] website service boot complete');
})();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
