'use strict';
const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embed, reply, ok, no } = require('./fx');

async function onInteraction(interaction) {
  if (!interaction.isButton()) return false;

  // Button actions make several REST calls. Acknowledge them immediately so a
  // slow proxy never causes Discord's interaction timeout for the user.
  if (interaction.customId === 'ticket:open') {
    await interaction.deferReply({ ephemeral: true });
    const name = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
    const channel = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
      ],
    });
    await channel.send({
      content: `${interaction.user}`,
      embeds: [embed('🎫 Ticket Opened', 'Staff will help you here.', ok)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      )],
    });
    await reply(interaction, { content: `Ticket created: ${channel}` }, true);
    return true;
  }

  if (interaction.customId === 'ticket:close') {
    await interaction.deferReply({ ephemeral: true });
    await reply(interaction, {
      embeds: [embed('🔒 Closing ticket', 'This channel will be deleted in 5 seconds.', no)],
    }, true);
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5_000).unref?.();
    return true;
  }

  return false;
}

module.exports = { onInteraction };
