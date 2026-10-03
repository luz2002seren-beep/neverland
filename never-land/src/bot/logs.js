'use strict';
const { AuditLogEvent, ChannelType } = require('discord.js');
const env = require('./env');
const { embed, send, ok, no, info, warn, safe } = require('./fx');

const invites = new Map();
const isPrimaryGuild = (guild) => Boolean(guild && env.guildId && String(guild.id) === env.guildId);

async function ch(client, id) {
  return id && client.channels.fetch(id).catch(() => null);
}

async function log(client, key, icon, title, desc, color = info, fields = []) {
  return send(ch(client, env.logs[key] || env.logs.system), {
    embeds: [embed(`${icon} ${title}`, desc, color, fields)],
  });
}

async function audit(guild, type) {
  try {
    return (await guild.fetchAuditLogs({ type, limit: 1 })).entries.first();
  } catch {
    return null;
  }
}

async function cacheInvites(guild) {
  if (!isPrimaryGuild(guild)) return;
  try {
    invites.set(guild.id, new Map((await guild.invites.fetch()).map(invite => [
      invite.code,
      { uses: invite.uses || 0, inviter: invite.inviter?.tag || 'Unknown' },
    ])));
  } catch {
    invites.set(guild.id, new Map());
  }
}

function attach(client) {
  client.once('ready', () => {
    const primary = client.guilds.cache.get(env.guildId);
    if (primary) void cacheInvites(primary);
  });

  client.on('inviteCreate', invite => {
    if (!isPrimaryGuild(invite.guild)) return;
    const known = invites.get(invite.guild.id) || new Map();
    known.set(invite.code, { uses: invite.uses || 0, inviter: invite.inviter?.tag || 'Unknown' });
    invites.set(invite.guild.id, known);
    void log(client, 'invites', '🔗', 'Invite Created', `Code **${invite.code}** by **${safe(invite.inviter?.tag)}**`, ok);
  });

  client.on('guildMemberAdd', async member => {
    if (!isPrimaryGuild(member.guild)) return;
    const before = invites.get(member.guild.id) || new Map();
    let used = 'Unknown';
    let by = 'Unknown';
    try {
      const now = await member.guild.invites.fetch();
      for (const invite of now.values()) {
        if ((invite.uses || 0) > (before.get(invite.code)?.uses || 0)) {
          used = invite.code;
          by = invite.inviter?.tag || 'Unknown';
          break;
        }
      }
      invites.set(member.guild.id, new Map(now.map(invite => [
        invite.code,
        { uses: invite.uses || 0, inviter: invite.inviter?.tag || 'Unknown' },
      ])));
    } catch {
      // Missing invite permissions should not interrupt join logging.
    }
    void log(client, 'member', '👋', 'Member Joined', `${member} joined.\nInvite: **${used}**\nInviter: **${safe(by)}**`, ok);
  });

  client.on('guildMemberRemove', member => {
    if (isPrimaryGuild(member.guild)) void log(client, 'member', '🚪', 'Member Left', `${safe(member.user.tag)} left the server.`, no);
  });

  client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (!isPrimaryGuild(newMember.guild)) return;
    const added = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
    if (added.size || removed.size) {
      void log(newMember.client, 'roles', '🎭', 'Roles Updated', `${newMember}\nAdded: ${added.map(role => role.name).join(', ') || 'none'}\nRemoved: ${removed.map(role => role.name).join(', ') || 'none'}`, info);
    }
    if (!oldMember.premiumSince && newMember.premiumSince) {
      void log(newMember.client, 'boost', '💎', 'Server Boost', `${newMember} boosted the server.`, ok);
    }
  });

  client.on('channelCreate', channel => {
    if (isPrimaryGuild(channel.guild)) void log(client, 'channels', '🟢', 'Channel Created', `${channel} (${channel.name})`, ok);
  });
  client.on('channelDelete', channel => {
    if (isPrimaryGuild(channel.guild)) void log(client, 'channels', '🔴', 'Channel Deleted', `${safe(channel.name)} (${channel.id})`, no);
  });
  client.on('roleCreate', role => {
    if (isPrimaryGuild(role.guild)) void log(client, 'roles', '🟣', 'Role Created', `**${safe(role.name)}**`, ok);
  });
  client.on('roleDelete', role => {
    if (isPrimaryGuild(role.guild)) void log(client, 'roles', '⚫', 'Role Deleted', `**${safe(role.name)}**`, no);
  });
  client.on('roleUpdate', (oldRole, newRole) => {
    if (isPrimaryGuild(newRole.guild) && oldRole.color !== newRole.color) {
      void log(client, 'roles', '🎨', 'Role Color Changed', `**${safe(newRole.name)}**`, warn);
    }
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    if (!isPrimaryGuild(newState.guild)) return;
    if (!oldState.channelId && newState.channelId) {
      void log(client, 'voice', '🔊', 'Voice Join', `${newState.member} joined <#${newState.channelId}>`);
    } else if (oldState.channelId && !newState.channelId) {
      void log(client, 'voice', '🔇', 'Voice Leave', `${newState.member} left <#${oldState.channelId}>`);
    } else if (oldState.channelId !== newState.channelId) {
      void log(client, 'voice', '🔁', 'Voice Move', `${newState.member}: <#${oldState.channelId}> → <#${newState.channelId}>`);
    }
  });

  client.on('guildBanAdd', ban => {
    if (isPrimaryGuild(ban.guild)) void log(client, 'moderation', '🔨', 'Member Banned', `${safe(ban.user.tag)}`, no);
  });
  client.on('guildBanRemove', ban => {
    if (isPrimaryGuild(ban.guild)) void log(client, 'moderation', '♻️', 'Member Unbanned', `${safe(ban.user.tag)}`, ok);
  });
  client.on('error', error => { void log(client, 'system', '⚠️', 'Bot Error', safe(error.message), no); });
}

module.exports = { attach, isPrimaryGuild, audit };
