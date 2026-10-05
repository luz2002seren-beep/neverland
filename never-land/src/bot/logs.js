'use strict';
const env = require('./env');
const { embed, send, ok, no, info, warn, safe } = require('./fx');

const MAX_INVITES = 500;
const MAX_IN_FLIGHT_LOGS = 12;
const invites = new Map();
const logChannels = new Map();
let inFlightLogs = 0;
let lastDropWarningAt = 0;

const isPrimaryGuild = (guild) => Boolean(guild && env.guildId && String(guild.id) === env.guildId);

async function ch(client, id) {
  if (!id) return null;
  const cached = client.channels.cache.get(id) || logChannels.get(id);
  if (cached) return cached;
  const channel = await client.channels.fetch(id).catch(() => null);
  if (channel) logChannels.set(id, channel);
  return channel;
}

function noteDroppedLog() {
  const now = Date.now();
  if (now - lastDropWarningAt > 60_000) {
    lastDropWarningAt = now;
    console.warn('[logs] log burst capped to protect bot memory and command responsiveness.');
  }
}

async function log(client, key, icon, title, desc, color = info, fields = []) {
  // Never allow a burst of low-priority logging to accumulate unbounded network
  // promises while the proxy is slow or unavailable.
  if (inFlightLogs >= MAX_IN_FLIGHT_LOGS) {
    noteDroppedLog();
    return null;
  }
  inFlightLogs += 1;
  try {
    const channel = await ch(client, env.logs[key] || env.logs.system);
    return await send(channel, { embeds: [embed(`${icon} ${title}`, desc, color, fields)] });
  } finally {
    inFlightLogs -= 1;
  }
}

async function audit(guild, type) {
  try {
    return (await guild.fetchAuditLogs({ type, limit: 1 })).entries.first();
  } catch {
    return null;
  }
}

function inviteSnapshot(collection) {
  const snapshot = new Map();
  for (const invite of collection.values()) {
    if (snapshot.size >= MAX_INVITES) break;
    snapshot.set(invite.code, { uses: invite.uses || 0, inviter: invite.inviter?.tag || 'Unknown' });
  }
  return snapshot;
}

async function cacheInvites(guild) {
  if (!isPrimaryGuild(guild)) return;
  try {
    invites.set(guild.id, inviteSnapshot(await guild.invites.fetch()));
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
    if (known.size < MAX_INVITES || known.has(invite.code)) {
      known.set(invite.code, { uses: invite.uses || 0, inviter: invite.inviter?.tag || 'Unknown' });
    }
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
      invites.set(member.guild.id, inviteSnapshot(now));
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
    logChannels.delete(channel.id);
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
