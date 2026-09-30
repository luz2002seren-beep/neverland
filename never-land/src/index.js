'use strict';
require('node:dns').setDefaultResultOrder('ipv4first');
const args = process.argv.slice(2);
const off = v => /^(false|0|off|no)$/i.test(String(v||''));
const runBot = !args.includes('--no-bot') && !off(process.env.RUN_BOT);
const runWeb = !args.includes('--no-web') && !off(process.env.RUN_WEB);
process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException', e => console.error('[fatal]', e?.stack || e));
async function startWeb(){ try { const db=require('./database'); db.init?.(); const { startServer }=require('./web/server'); return startServer(); } catch(e){ console.error('[web]', e.message); return null; } }
(async()=>{
  console.log('\nNever Land — clean bot runtime + existing website\n');
  if (runWeb) startWeb(); else console.log('[web] skipped');
  let client=null;
  if (runBot) {
    client = await require('./bot/runtime').start().catch(e => (console.error('[bot]', e.message), null));
    if (client?.isReady?.()) setTimeout(() => require('./deploy-commands').deployCommands(client).catch(e => console.error('[deploy]', e.message)), 3000).unref();
  } else console.log('[bot] skipped');
  console.log('[ready] service boot complete');
})();
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
