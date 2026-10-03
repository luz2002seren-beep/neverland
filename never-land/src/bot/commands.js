'use strict';
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const env = require('./env');
const { reply, embed, ok, no, info, warn, safe } = require('./fx');
const ms = s => { const n=parseInt(s,10); return /h/i.test(s)?n*3600000:/d/i.test(s)?n*86400000:/m/i.test(s)?n*60000:n*1000; };
const cmds = new Map();
function inPrimaryGuild(ctx) {
  const id = ctx?.guildId || ctx?.guild?.id;
  return Boolean(env.guildId && id && String(id) === env.guildId);
}
function add(data, run) {
  // A second guard here protects direct calls to command handlers as well as
  // interaction events guarded by runtime.js.
  cmds.set(data.name, { data, run: async ctx => inPrimaryGuild(ctx) ? run(ctx) : null });
}
add(new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'), async i => reply(i, { embeds:[embed('🏓 Pong', `Gateway: **${Math.round(i.client.ws.ping)}ms**`, ok)] }, true));
add(new SlashCommandBuilder().setName('lock').setDescription('Lock this channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async i => lock(i, true));
add(new SlashCommandBuilder().setName('unlock').setDescription('Unlock this channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async i => lock(i, false));
add(new SlashCommandBuilder().setName('clear').setDescription('Bulk delete messages').addIntegerOption(o=>o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages), async i => { const n=i.options.getInteger('amount'); await i.channel.bulkDelete(n,true); return reply(i,{embeds:[embed('🧹 Messages cleared', `Deleted **${n}** messages.`, ok)]}, true); });
add(new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o=>o.setName('time').setDescription('10m / 1h / 1d').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers), async i => { const u=i.options.getUser('user'), m=await i.guild.members.fetch(u.id); await m.timeout(ms(i.options.getString('time')), i.options.getString('reason')||'No reason'); return reply(i,{embeds:[embed('⏳ Member timed out', `${u} has been timed out.`, ok)]}); });
add(new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers), async i => { const u=i.options.getUser('user'), m=await i.guild.members.fetch(u.id); await m.kick(i.options.getString('reason')||'No reason'); return reply(i,{embeds:[embed('👢 Member kicked', `${u.tag} was kicked.`, ok)]}); });
add(new SlashCommandBuilder().setName('ban').setDescription('Ban a member').addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers), async i => { const u=i.options.getUser('user'); await i.guild.members.ban(u.id,{reason:i.options.getString('reason')||'No reason'}); return reply(i,{embeds:[embed('🔨 Member banned', `${u.tag} was banned.`, ok)]}); });
add(new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers), async i => { const u=i.options.getUser('user'), r=safe(i.options.getString('reason')); await u.send({embeds:[embed('⚠️ Warning', r, warn)]}).catch(()=>{}); return reply(i,{embeds:[embed('⚠️ Warning sent', `${u} — ${r}`, warn)]}); });
add(new SlashCommandBuilder().setName('server').setDescription('Show server stats'), async i => reply(i,{embeds:[embed('📊 Server', `Members: **${i.guild.memberCount}**\nChannels: **${i.guild.channels.cache.size}**\nRoles: **${i.guild.roles.cache.size}**`, info)]}, true));
add(new SlashCommandBuilder().setName('ticket-panel').setDescription('Send ticket open button').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild), async i => { const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'); await i.channel.send({ embeds:[embed('🎫 Support Tickets','Click the button to open a private ticket.',info)], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:open').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary))] }); return reply(i,'Panel sent.',true); });
async function lock(ctx, closed){
  if (!inPrimaryGuild(ctx)) return null;
  const target = ctx.guild.roles.everyone;
  if (closed) await ctx.channel.permissionOverwrites.edit(target, { SendMessages: false });
  else await ctx.channel.permissionOverwrites.edit(target, { SendMessages: true });
  return reply(ctx,{embeds:[embed(closed?'🔒 𝑳𝒐𝒄𝒌𝒆𝒅':'🔓 𝑼𝒏𝒍𝒐𝒄𝒌𝒆𝒅', `${closed?'Locked':'Unlocked'} the channel ${ctx.channel}.`, closed?no:ok)]});
}
module.exports = { cmds, lock, inPrimaryGuild };
