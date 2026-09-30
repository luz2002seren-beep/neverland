'use strict';
const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embed, reply, ok, no } = require('./fx');
async function onInteraction(i){
  if (!i.isButton()) return false;
  if (i.customId === 'ticket:open') {
    const name = `ticket-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,90);
    const ch = await i.guild.channels.create({ name, type:ChannelType.GuildText, permissionOverwrites:[{id:i.guild.roles.everyone, deny:[PermissionFlagsBits.ViewChannel]},{id:i.user.id, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}] });
    await ch.send({ content:`${i.user}`, embeds:[embed('🎫 Ticket Opened','Staff will help you here.',ok)], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'))] });
    await reply(i,{content:`Ticket created: ${ch}`},true); return true;
  }
  if (i.customId === 'ticket:close') { await reply(i,{embeds:[embed('🔒 Closing ticket','This channel will be deleted in 5 seconds.',no)]}); setTimeout(()=>i.channel.delete().catch(()=>{}),5000); return true; }
  return false;
}
module.exports = { onInteraction };
