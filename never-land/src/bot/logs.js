'use strict';
const { AuditLogEvent, ChannelType } = require('discord.js');
const env = require('./env');
const { embed, send, ok, no, info, warn, safe } = require('./fx');
const invites = new Map();
async function ch(client, id){ return id && client.channels.fetch(id).catch(()=>null); }
async function log(client, key, icon, title, desc, color=info, fields=[]){ return send(ch(client, env.logs[key] || env.logs.system), { embeds:[embed(`${icon} ${title}`, desc, color, fields)] }); }
async function audit(guild, type){ try { return (await guild.fetchAuditLogs({type, limit:1})).entries.first(); } catch { return null; } }
async function cacheInvites(g){ try { invites.set(g.id, new Map((await g.invites.fetch()).map(i=>[i.code,{uses:i.uses||0, inviter:i.inviter?.tag||'Unknown'}]))); } catch { invites.set(g.id,new Map()); } }
function attach(client){
  client.once('ready', () => client.guilds.cache.forEach(cacheInvites));
  client.on('inviteCreate', i => { const m=invites.get(i.guild.id)||new Map(); m.set(i.code,{uses:i.uses||0, inviter:i.inviter?.tag||'Unknown'}); invites.set(i.guild.id,m); log(client,'invites','🔗','Invite Created',`Code **${i.code}** by **${safe(i.inviter?.tag)}**`,ok); });
  client.on('guildMemberAdd', async m => { const before=invites.get(m.guild.id)||new Map(); let used='Unknown', by='Unknown'; try { const now=await m.guild.invites.fetch(); for (const i of now.values()) if ((i.uses||0) > (before.get(i.code)?.uses||0)) { used=i.code; by=i.inviter?.tag||'Unknown'; break; } invites.set(m.guild.id,new Map(now.map(i=>[i.code,{uses:i.uses||0, inviter:i.inviter?.tag||'Unknown'}]))); } catch {} log(client,'member','👋','Member Joined',`${m} joined.\nInvite: **${used}**\nInviter: **${safe(by)}**`,ok); });
  client.on('guildMemberRemove', m => log(client,'member','🚪','Member Left',`${safe(m.user.tag)} left the server.`,no));
  client.on('guildMemberUpdate', (o,n)=>{ const added=n.roles.cache.filter(r=>!o.roles.cache.has(r.id)); const rem=o.roles.cache.filter(r=>!n.roles.cache.has(r.id)); if(added.size||rem.size) log(n.client,'roles','🎭','Roles Updated',`${n}\nAdded: ${added.map(r=>r.name).join(', ')||'none'}\nRemoved: ${rem.map(r=>r.name).join(', ')||'none'}`,info); if(!o.premiumSince && n.premiumSince) log(n.client,'boost','💎','Server Boost',`${n} boosted the server.`,ok); });
  client.on('channelCreate', async c => log(client,'channels','🟢','Channel Created',`${c} (${c.name})`,ok));
  client.on('channelDelete', async c => log(client,'channels','🔴','Channel Deleted',`${safe(c.name)} (${c.id})`,no));
  client.on('roleCreate', r => log(client,'roles','🟣','Role Created',`**${safe(r.name)}**`,ok));
  client.on('roleDelete', r => log(client,'roles','⚫','Role Deleted',`**${safe(r.name)}**`,no));
  client.on('roleUpdate', (o,n)=> o.color!==n.color && log(client,'roles','🎨','Role Color Changed',`**${safe(n.name)}**`,warn));
  client.on('voiceStateUpdate', (o,n)=>{ if(!o.channelId&&n.channelId) log(client,'voice','🔊','Voice Join',`${n.member} joined <#${n.channelId}>`); else if(o.channelId&&!n.channelId) log(client,'voice','🔇','Voice Leave',`${n.member} left <#${o.channelId}>`); else if(o.channelId!==n.channelId) log(client,'voice','🔁','Voice Move',`${n.member}: <#${o.channelId}> → <#${n.channelId}>`); });
  client.on('guildBanAdd', b => log(client,'moderation','🔨','Member Banned',`${safe(b.user.tag)}`,no));
  client.on('guildBanRemove', b => log(client,'moderation','♻️','Member Unbanned',`${safe(b.user.tag)}`,ok));
  client.on('error', e => log(client,'system','⚠️','Bot Error',safe(e.message),no));
}
module.exports = { attach };
