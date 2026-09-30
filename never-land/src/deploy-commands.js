'use strict';
require('node:dns').setDefaultResultOrder('ipv4first');
const { REST, Routes } = require('discord.js');
const env = require('./bot/env');
const { cmds } = require('./bot/commands');
async function deployCommands(client){
  const token = env.token, appId = env.clientId || client?.application?.id, guildId = env.guildId || client?.guilds?.cache?.first()?.id;
  if (!token || !appId) throw new Error('DISCORD_TOKEN/CLIENT_ID missing');
  const rest = new REST({ version:'10', timeout:10000 }).setToken(token);
  try { require('./lib/discordRestProxy').install(rest); } catch {}
  await rest.put(Routes.applicationCommands(appId), { body: [] });
  if (!guildId) return console.log('[deploy] no guild id; global cleared only');
  const body = [...cmds.values()].map(c => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
  console.log(`[deploy] global cleared, ${body.length} guild commands registered for ${guildId}`);
}
if (require.main === module) deployCommands().catch(e => { console.error(e); process.exit(1); });
module.exports = { deployCommands };
