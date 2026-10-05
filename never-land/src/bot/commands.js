'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const db = require('../database');
const settingsStore = require('./settings');
const { isModerator, canLock } = require('./access');
const logs = require('./logs');
const tickets = require('./tickets');

const commandDefinitions = [
  new SlashCommandBuilder().setName('ping').setDescription('Check the Never Land bot latency.'),
  new SlashCommandBuilder().setName('server').setDescription('Show a short server status summary.'),
  new SlashCommandBuilder()
    .setName('warn').setDescription('Record a warning for a member.')
    .addUserOption((option) => option.setName('member').setDescription('Member to warn').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the warning').setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('timeout').setDescription('Timeout a member.')
    .addUserOption((option) => option.setName('member').setDescription('Member to timeout').setRequired(true))
    .addIntegerOption((option) => option.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setMaxValue(40_320).setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason').setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('kick').setDescription('Kick a member from the server.')
    .addUserOption((option) => option.setName('member').setDescription('Member to kick').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason').setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('ban').setDescription('Ban a member from the server.')
    .addUserOption((option) => option.setName('member').setDescription('Member to ban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason').setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('clear').setDescription('Delete recent messages from this channel.')
    .addIntegerOption((option) => option.setName('amount').setDescription('Number of messages (1–100)').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('lock').setDescription('Lock the current text channel for @everyone.'),
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock the current text channel for @everyone.'),
  new SlashCommandBuilder()
    .setName('ticket').setDescription('Ticket panel and ticket controls.')
    .addSubcommand((sub) => sub.setName('panel').setDescription('Post a new ticket panel in the configured panel channel.'))
    .addSubcommand((sub) => sub.setName('close').setDescription('Close and archive the current ticket.')),
].map((command) => command.toJSON());

function isPrimaryGuild(interaction, env) {
  return Boolean(interaction.guildId && env.primaryGuildId && interaction.guildId === env.primaryGuildId);
}

async function denied(interaction, message = 'You do not have permission to use this command.') {
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content: message, ephemeral: true });
  return interaction.reply({ content: message, ephemeral: true });
}

function reason(interaction) {
  return interaction.options.getString('reason') || 'No reason provided';
}

async function moderator(interaction, settings) {
  if (!isModerator(interaction.member, settings)) {
    await denied(interaction);
    return false;
  }
  return true;
}

async function targetMember(interaction) {
  const user = interaction.options.getUser('member', true);
  if (user.id === interaction.user.id) {
    await denied(interaction, 'You cannot moderate yourself.');
    return null;
  }
  if (user.id === interaction.client.user?.id) {
    await denied(interaction, 'I cannot moderate myself.');
    return null;
  }
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

function recordCase(interaction, type, user, detail, duration = null, active = 0) {
  return db.addCase({
    guildId: interaction.guildId,
    type,
    userId: user.id,
    userTag: user.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: detail,
    duration,
    active,
  });
}

async function logModeration(interaction, settings, title, description, color = 0xfee75c) {
  return logs.send(interaction.client, settings, 'moderation', { title, description, color });
}

async function runModeration(interaction, settings) {
  if (!settings.modules.moderation || !settings.commands.moderation) return denied(interaction, 'The moderation command group is disabled.');
  const command = interaction.commandName;
  // Channel locks may additionally be delegated with lockAllowedRoleIds.
  if (!['lock', 'unlock'].includes(command) && !await moderator(interaction, settings)) return;

  if (command === 'clear') {
    const channel = interaction.channel;
    if (!channel?.isTextBased?.() || !channel.bulkDelete) return denied(interaction, 'This command only works in a standard text channel.');
    const amount = interaction.options.getInteger('amount', true);
    await interaction.deferReply({ ephemeral: true });
    const deleted = await channel.bulkDelete(amount, true).catch(() => null);
    const count = deleted?.size || 0;
    await interaction.editReply({ content: `Deleted ${count} message${count === 1 ? '' : 's'}. Messages older than 14 days cannot be bulk-deleted.` });
    return logModeration(interaction, settings, 'Messages cleared', `<@${interaction.user.id}> cleared **${count}** message(s) in <#${interaction.channelId}>.`, 0x5865f2);
  }

  if (command === 'lock' || command === 'unlock') {
    if (!canLock(interaction.member, settings)) return denied(interaction);
    const channel = interaction.channel;
    if (!channel?.isTextBased?.() || channel.type === ChannelType.DM) return denied(interaction, 'This command only works in a server text channel.');
    const locked = command === 'lock';
    try {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: locked ? false : null }, `${command} by ${interaction.user.tag}`);
      await interaction.reply({ content: locked ? '🔒 Channel locked.' : '🔓 Channel unlocked.', ephemeral: true });
      return logModeration(interaction, settings, locked ? 'Channel locked' : 'Channel unlocked', `<@${interaction.user.id}> ${locked ? 'locked' : 'unlocked'} <#${channel.id}>.`, locked ? 0xed4245 : 0x57f287);
    } catch {
      return denied(interaction, 'I could not change that channel. Check my Manage Channels permission and role position.');
    }
  }

  const member = await targetMember(interaction);
  if (!member) return;
  const user = member.user;
  const detail = reason(interaction);

  if (command === 'warn') {
    const item = recordCase(interaction, 'warn', user, detail);
    await interaction.reply({ content: `⚠️ Warned **${user.tag}** (case #${item.id}).`, ephemeral: true });
    return logModeration(interaction, settings, 'Member warned', `<@${user.id}> was warned by <@${interaction.user.id}>.\nReason: ${detail}`);
  }
  if (command === 'timeout') {
    const minutes = interaction.options.getInteger('minutes', true);
    if (!member.moderatable) return denied(interaction, 'I cannot timeout that member. Check role hierarchy and permissions.');
    try {
      await member.timeout(minutes * 60_000, detail);
      const item = recordCase(interaction, 'timeout', user, detail, minutes * 60_000, 1);
      await interaction.reply({ content: `⏳ Timed out **${user.tag}** for ${minutes} minute(s) (case #${item.id}).`, ephemeral: true });
      return logModeration(interaction, settings, 'Member timed out', `<@${user.id}> was timed out for **${minutes}m** by <@${interaction.user.id}>.\nReason: ${detail}`, 0xed4245);
    } catch {
      return denied(interaction, 'I could not timeout that member.');
    }
  }
  if (command === 'kick') {
    if (!member.kickable) return denied(interaction, 'I cannot kick that member. Check role hierarchy and permissions.');
    try {
      await member.kick(detail);
      recordCase(interaction, 'kick', user, detail);
      await interaction.reply({ content: `👢 Kicked **${user.tag}**.`, ephemeral: true });
      return logModeration(interaction, settings, 'Member kicked', `<@${user.id}> was kicked by <@${interaction.user.id}>.\nReason: ${detail}`, 0xed4245);
    } catch {
      return denied(interaction, 'I could not kick that member.');
    }
  }
  if (command === 'ban') {
    if (!member.bannable) return denied(interaction, 'I cannot ban that member. Check role hierarchy and permissions.');
    try {
      await member.ban({ reason: detail });
      recordCase(interaction, 'ban', user, detail);
      await interaction.reply({ content: `🔨 Banned **${user.tag}**.`, ephemeral: true });
      return logModeration(interaction, settings, 'Member banned', `<@${user.id}> was banned by <@${interaction.user.id}>.\nReason: ${detail}`, 0xed4245);
    } catch {
      return denied(interaction, 'I could not ban that member.');
    }
  }
}

async function runTicket(interaction, settings) {
  if (!settings.modules.tickets || !settings.commands.tickets) return denied(interaction, 'The ticket command group is disabled.');
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'close') return tickets.close(interaction, settings);
  if (!await moderator(interaction, settings)) return;
  try {
    const message = await tickets.publishPanel(interaction.client, interaction.guild, settings);
    return interaction.reply({ content: `Ticket panel posted in <#${message.channelId}>.`, ephemeral: true });
  } catch (error) {
    return denied(interaction, `I could not post the panel. ${String(error.message).slice(0, 150)}`);
  }
}

async function execute(interaction, env) {
  if (!interaction.isChatInputCommand?.()) return false;
  if (!isPrimaryGuild(interaction, env)) return denied(interaction, 'This rebuilt bot is not enabled for this server.');
  const settings = settingsStore.get();
  try {
    if (interaction.commandName === 'ping') return interaction.reply({ content: `Pong — ${Math.round(interaction.client.ws.ping)}ms`, ephemeral: true });
    if (interaction.commandName === 'server') {
      return interaction.reply({ content: `**${interaction.guild.name}**\nMembers: ${interaction.guild.memberCount}\nTickets: ${db.countTickets(interaction.guildId, 'open')} open`, ephemeral: true });
    }
    if (interaction.commandName === 'ticket') return runTicket(interaction, settings);
    return runModeration(interaction, settings);
  } catch (error) {
    console.error('[bot-v2] command error:', error.message);
    return denied(interaction, 'Something went wrong while processing that command.');
  }
}

async function register(client, guildId) {
  if (!guildId) throw new Error('PRIMARY_GUILD_ID is required before slash commands can be registered.');
  const guild = await client.guilds.fetch(guildId);
  await guild.commands.set(commandDefinitions);
  return commandDefinitions.length;
}

module.exports = { commandDefinitions, execute, register };
