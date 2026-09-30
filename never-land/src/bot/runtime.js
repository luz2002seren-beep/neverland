'use strict';
const { Client, GatewayIntentBits, Partials, Collection, ActivityType } = require('discord.js');
const env = require('./env');
const { cmds } = require('./commands');
const { onMessage } = require('./text');
const logs = require('./logs');
const tickets = require('./tickets');
const { patchGateway, installProxy } = require('./rest-safe');
const { reply, embed, no } = require('./fx');
function createClient(){
  const client = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildModeration,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildInvites], partials:[Partials.Channel,Partials.Message,Partials.GuildMember], allowedMentions:{parse:['users','roles'],repliedUser:false}, rest:{timeout:10000}, shards:[0], waitGuildTimeout:8000 });
  client.commands = new Collection(cmds);
  installProxy(client); patchGateway(client); logs.attach(client);
  client.once('ready', () => { client.user.setPresence({status:env.presence.status, activities:[{name:env.presence.name,type:ActivityType.Streaming,url:env.presence.url}] }).catch(()=>{}); console.log(`[bot] ready ${client.user.tag} in ${client.guilds.cache.size} guild(s)`); });
  client.on('messageCreate', onMessage);
  client.on('interactionCreate', async i => { try { if (await tickets.onInteraction(i)) return; if (!i.isChatInputCommand()) return; const c=client.commands.get(i.commandName); if (!c) return; await c.run(i); } catch(e){ console.error('[command]', e); if ('reply' in i) await reply(i,{embeds:[embed('❌ Command failed', e.message || 'Unknown error', no)]},true).catch(()=>{}); } });
  return client;
}
async function start(){ if(!env.ready){ console.log('[bot] skipped: missing DISCORD_TOKEN or CLIENT_ID'); return null; } const client=createClient(); await client.login(env.token); return client; }
module.exports = { start, createClient };
