'use strict';
require('node:dns').setDefaultResultOrder('ipv4first');
const { REST, Routes } = require('discord.js');
const env = require('./bot/env');
const { cmds } = require('./bot/commands');
async function deployCommands(client, opt={}){
  const token = env.token, appId = env.clientId || client?.application?.id, guildId = env.guildId || client?.guilds?.cache?.first()?.id;
  if (!token || !appId) throw new Error('DISCORD_TOKEN/CLIENT_ID missing');
  const rest = new REST({ version:'10', timeout:10000 }).setToken(token);
  try { require('./lib/discordRestProxy').install(rest); } catch {}
  const body = [...cmds.values()].map(c => c.data.toJSON());
  try {
    await rest.put(Routes.applicationCommands(appId), { body: [] });
    if (!guildId) return console.log('[deploy] global cleared only; no guild id');
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    console.log(`[deploy] global cleared, ${body.length} guild commands registered for ${guildId}`);
    return { ok:true, count:body.length, guildId };
  } catch (e) {
    console.error('[deploy] skipped:', e?.message || e);
    if (opt.strict) throw e;
    return { ok:false, error:e?.message || String(e) };
  }
}
if (require.main === module) deployCommands(null, { strict:false }).then(r => process.exit(r.ok ? 0 : 0));
module.exports = { deployCommands };
