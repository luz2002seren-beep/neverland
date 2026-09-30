'use strict';
function ensureStyle(){ return true; }
function status(){ return { enabled:true, runtime:'clean' }; }
function missingEmojis(){ return []; }
async function buildWelcomePayload(client, member, settings={}){ return { content:(settings.welcome?.message||'Welcome {user}').replace('{user}',`${member}`).replace('{server}',member.guild?.name||'server') }; }
async function sendTestWelcome(client, guild, member, opt={}){ const ch=await client.channels.fetch(opt.channelId).catch(()=>null); return ch?.send?.(await buildWelcomePayload(client, member, { welcome:{ message:'Welcome {user} to {server}' } })); }
module.exports = { ensureStyle, status, missingEmojis, buildWelcomePayload, sendTestWelcome, attach(){} };
