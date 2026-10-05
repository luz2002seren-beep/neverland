'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../database');
const settingsStore = require('./settings');
const { isModerator } = require('./access');
const logs = require('./logs');

const OPEN = 'nlv2_ticket_open';
const CLOSE = 'nlv2_ticket_close';

function panel(settings) {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(settings.tickets.title)
      .setDescription(settings.tickets.greeting)
      .setFooter({ text: 'Never Land • Support tickets' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(OPEN).setLabel('Open ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
    )],
    allowedMentions: { parse: [] },
  };
}

function safeName(value) {
  return String(value || 'member').toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 40) || 'member';
}

async function publishPanel(client, guild, settings) {
  const channelId = settings.tickets.panelChannelId;
  const channel = channelId && (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) throw new Error('The configured ticket panel channel is unavailable.');
  const message = await channel.send(panel(settings));
  settingsStore.update({ tickets: { panelMessageId: message.id } });
  return message;
}

async function open(interaction, settings) {
  const { guild, user, client } = interaction;
  if (!guild || !settings.modules.tickets || !settings.tickets.enabled) {
    return interaction.reply({ content: 'The ticket module is currently disabled.', ephemeral: true });
  }
  const existing = db.listTickets({ guildId: guild.id, userId: user.id, status: 'open', limit: 1 }).items[0];
  if (existing) return interaction.reply({ content: `You already have an open ticket: <#${existing.channel_id}>`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  for (const roleId of settings.tickets.supportRoleIds) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  if (client.user?.id) overwrites.push({ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] });

  try {
    const channel = await guild.channels.create({
      name: `ticket-${safeName(interaction.member?.displayName || user.username)}`,
      type: ChannelType.GuildText,
      parent: settings.tickets.categoryId || undefined,
      permissionOverwrites: overwrites,
      reason: `Ticket opened by ${user.id}`,
    });
    const ticket = db.createTicket({ guildId: guild.id, channelId: channel.id, userId: user.id, type: 'support' });
    await channel.send({
      content: `<@${user.id}>`,
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Support ticket').setDescription(settings.tickets.greeting).setFooter({ text: `Ticket #${ticket.id}` })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CLOSE).setLabel('Close ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      )],
      allowedMentions: { users: [user.id], roles: [] },
    });
    await logs.send(client, settings, 'ticket', { title: 'Ticket opened', description: `<@${user.id}> opened <#${channel.id}>.`, color: 0x57f287 });
    return interaction.editReply({ content: `Your ticket has been created: <#${channel.id}>` });
  } catch (error) {
    return interaction.editReply({ content: `I could not create a ticket. Check the bot's channel and role permissions. (${String(error.message).slice(0, 100)})` });
  }
}

async function close(interaction, settings) {
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status !== 'open') return interaction.reply({ content: 'This is not an open Never Land ticket.', ephemeral: true });
  const member = interaction.member;
  if (ticket.user_id !== interaction.user.id && !isModerator(member, settings)) {
    return interaction.reply({ content: 'Only the ticket owner or staff can close this ticket.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  db.updateTicket(ticket.id, { status: 'closed', closed_at: Date.now(), claimed_by: interaction.user.id });
  try {
    await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }, { reason: `Ticket #${ticket.id} closed` });
    if (!interaction.channel.name.startsWith('closed-')) await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100));
    await interaction.channel.send({ content: `Ticket closed by <@${interaction.user.id}>. It has been archived; a staff member may delete it later.`, allowedMentions: { users: [interaction.user.id] } });
  } catch {
    // Database state remains authoritative even if Discord permissions changed.
  }
  await logs.send(interaction.client, settings, 'ticket', { title: 'Ticket closed', description: `<#${ticket.channel_id}> was closed by <@${interaction.user.id}>.`, color: 0xfee75c });
  return interaction.editReply({ content: 'Ticket closed and archived.' });
}

async function handleButton(interaction, settings) {
  if (interaction.customId === OPEN) return open(interaction, settings);
  if (interaction.customId === CLOSE) return close(interaction, settings);
  return false;
}

module.exports = { OPEN, CLOSE, panel, publishPanel, open, close, handleButton };
