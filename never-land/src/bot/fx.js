'use strict';
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ok = 0x57f287, no = 0xed4245, info = 0x5865f2, warn = 0xfee75c;
const fancy = s => String(s).replace(/[A-Za-z]/g, c => {
  const A = c <= 'Z' ? 0x1d468 : 0x1d482, n = c.toLowerCase().charCodeAt(0)-97;
  return String.fromCodePoint(A+n);
});
const embed = (title, desc='', color=info, fields=[]) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc || null).addFields(fields).setTimestamp();
const safe = s => String(s ?? '').replace(/@/g, '@\u200b').slice(0, 1900);
const canMod = m => m?.permissions?.has(PermissionFlagsBits.ManageGuild) || m?.permissions?.has(PermissionFlagsBits.Administrator);
async function reply(ctx, payload, ephemeral=false) {
  if (typeof payload === 'string') payload = { content: payload };
  if ('deferReply' in ctx) return ctx.deferred || ctx.replied ? ctx.editReply(payload) : ctx.reply({ ...payload, ephemeral });
  return ctx.reply(payload).catch(() => ctx.channel?.send(payload));
}
async function send(ch, payload) { try { const c = typeof ch?.send === 'function' ? ch : await ch; return c?.send?.(payload); } catch { return null; } }
module.exports = { ok, no, info, warn, fancy, embed, safe, canMod, reply, send };
