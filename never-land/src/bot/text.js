'use strict';
const { PermissionFlagsBits } = require('discord.js');
const { lock } = require('./commands');
const { reply, embed, ok, canMod, safe } = require('./fx');
async function onMessage(m){
  if (!m.guild || m.author.bot) return;
  const body = m.content.trim();
  const admin = canMod(m.member);
  if (/^(قفل|lock)$/i.test(body) && admin) return lock(m, true);
  if (/^(فتح|unlock)$/i.test(body) && admin) return lock(m, false);
  if (/^(ping|!ping)$/i.test(body)) return reply(m, { embeds:[embed('🏓 Pong', 'Bot is alive.', ok)] });
  if (m.member?.permissions?.has(PermissionFlagsBits.ManageMessages) && /^مسح\s+\d+$/i.test(body)) {
    const n = Math.min(100, Math.max(1, Number(body.split(/\s+/)[1]))); await m.channel.bulkDelete(n, true); return reply(m, `🧹 Deleted ${n} messages.`);
  }
  if (!admin) await automod(m);
}
async function automod(m){
  const text = m.content.toLowerCase();
  const bad = /(discord\.gg\/|@everyone|@here|https?:\/\/\S{80,})/.test(text);
  if (!bad) return;
  await m.delete().catch(()=>{});
  await m.channel.send({ content:`⚠️ ${m.author}, message removed by AutoMod.` }).then(x=>setTimeout(()=>x.delete().catch(()=>{}),5000)).catch(()=>{});
}
module.exports = { onMessage };
