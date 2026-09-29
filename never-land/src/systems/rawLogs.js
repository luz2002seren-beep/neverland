'use strict';

/**
 * لوق من حزمة ديسكورد نفسها.
 * بعض الأحداث كتوصل raw وما كتوصلش لمعالج discord.js، فاللوق كان يسكت.
 */
const logging = require('./logging');
const { GUILD_ID } = require('./onePieceLogs');

const voiceNow = new Map();

function guildFrom(client, guildId) {
  if (String(guildId || '') !== GUILD_ID) return null;
  return client.guilds?.cache?.get(GUILD_ID) || null;
}

function person(user) {
  if (!user) return 'Unknown';
  return `<@${user.id}>${user.username ? ` \`${user.username}\`` : ''}`;
}

async function trackInvite(client, guild) {
  const cached = client.invites?.get(guild.id) || new Map();
  try {
    const fresh = await guild.invites.fetch();
    const used = fresh.find((inv) => (cached.get(inv.code) ?? 0) < (inv.uses ?? 0)) || null;
    const next = new Map(fresh.map((inv) => [inv.code, inv.uses ?? 0]));
    for (const [key, value] of cached) {
      if (String(key).startsWith('vanity:')) next.set(key, value);
    }
    client.invites?.set(guild.id, next);
    return used ? { code: used.code, inviter: used.inviter || null, uses: used.uses ?? null } : null;
  } catch {
    return null;
  }
}

async function onPacket(client, packet) {
  const name = packet?.t;
  const data = packet?.d || {};
  const guild = guildFrom(client, data.guild_id);
  if (!guild || !name) return;

  if (name === 'MESSAGE_DELETE') {
    const channel = guild.channels.cache.get(data.channel_id);
    const cached = channel?.messages?.cache?.get(data.id);
    if (cached?.author?.bot) return;
    await logging.send(client, guild, 'messageDelete', {
      title: 'Message Deleted',
      description: cached?.content || 'Message deleted',
      thumbnail: cached?.author?.displayAvatarURL?.({ size: 256 }),
      fields: [
        { name: 'Author', value: person(cached?.author), inline: true },
        { name: 'Channel', value: channel ? `${channel}` : `<#${data.channel_id}>`, inline: true },
      ],
      footer: `ID ${data.id}`,
      channelId: data.channel_id,
    });
    return;
  }

  if (name === 'MESSAGE_UPDATE' && data.content) {
    const channel = guild.channels.cache.get(data.channel_id);
    const cached = channel?.messages?.cache?.get(data.id);
    if (cached?.author?.bot || data.author?.bot) return;
    await logging.send(client, guild, 'messageEdit', {
      title: 'Message Edited',
      fields: [
        { name: 'Author', value: person(cached?.author || data.author), inline: true },
        { name: 'Channel', value: channel ? `${channel}` : `<#${data.channel_id}>`, inline: true },
        { name: 'Before', value: (cached?.content || '—').slice(0, 1000), inline: false },
        { name: 'After', value: String(data.content).slice(0, 1000), inline: false },
      ],
      footer: `ID ${data.id}`,
      channelId: data.channel_id,
    });
    return;
  }

  if (name === 'GUILD_MEMBER_ADD') {
    if (data.user?.bot) return;
    const inviteTask = trackInvite(client, guild);
    const avatar = data.user?.avatar
      ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=256`
      : undefined;
    await logging.send(client, guild, 'memberJoin', {
      title: 'Member Joined',
      description: person(data.user),
      thumbnail: avatar,
      fields: [
        { name: 'Member', value: person(data.user), inline: true },
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
      ],
      footer: `ID ${data.user?.id || 'join'}`,
    });
    const used = await inviteTask;
    await logging.send(client, guild, 'inviteUsed', {
      title: 'Invite Used',
      description: person(data.user),
      thumbnail: avatar,
      fields: [
        { name: 'Member', value: person(data.user), inline: true },
        { name: 'Link', value: used?.code ? `https://discord.gg/${used.code}` : 'Unknown', inline: true },
        { name: 'Invited By', value: used?.inviter ? `${used.inviter}` : 'Unknown', inline: true },
        { name: 'Uses', value: used?.uses != null ? String(used.uses) : '—', inline: true },
      ],
      footer: `ID ${data.user?.id || 'invite'}`,
    });
    return;
  }

  if (name === 'GUILD_MEMBER_REMOVE') {
    if (data.user?.bot) return;
    await logging.send(client, guild, 'memberLeave', {
      title: 'Member Left',
      description: person(data.user),
      fields: [
        { name: 'Member', value: person(data.user), inline: true },
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
      ],
      footer: `ID ${data.user?.id || 'leave'}`,
    });
    return;
  }

  if (name === 'CHANNEL_CREATE' || name === 'CHANNEL_DELETE') {
    const created = name === 'CHANNEL_CREATE';
    await logging.send(client, guild, created ? 'channelCreate' : 'channelDelete', {
      title: created ? 'Channel Created' : 'Channel Deleted',
      description: `\`${data.name || 'channel'}\``,
      fields: [
        { name: 'Channel', value: data.id ? `<#${data.id}>` : `\`${data.name || '—'}\``, inline: true },
        { name: 'Name', value: `\`${data.name || '—'}\``, inline: true },
      ],
      footer: `ID ${data.id || name}`,
    });
    return;
  }

  if (name === 'VOICE_STATE_UPDATE') {
    const userId = data.user_id;
    if (!userId) return;
    const member = guild.members.cache.get(userId);
    const previous = member?.voice?.channelId || voiceNow.get(userId) || null;
    const next = data.channel_id || null;
    voiceNow.set(userId, next);
    if (previous === next) return;
    const who = member ? `${member}` : `<@${userId}>`;
    if (!previous && next) {
      await logging.send(client, guild, 'voiceJoin', {
        title: 'Voice Join',
        description: `${who} joined <#${next}>`,
        thumbnail: member?.displayAvatarURL?.({ size: 256 }),
        fields: [
          { name: 'Member', value: who, inline: true },
          { name: 'Channel', value: `<#${next}>`, inline: true },
        ],
        footer: `ID ${userId}`,
      });
    } else if (previous && !next) {
      await logging.send(client, guild, 'voiceLeave', {
        title: 'Voice Leave',
        description: `${who} left <#${previous}>`,
        thumbnail: member?.displayAvatarURL?.({ size: 256 }),
        fields: [
          { name: 'Member', value: who, inline: true },
          { name: 'Channel', value: `<#${previous}>`, inline: true },
        ],
        footer: `ID ${userId}`,
      });
    } else if (previous && next) {
      await logging.send(client, guild, 'voiceMove', {
        title: 'Voice Move',
        description: `${who} moved to <#${next}>`,
        thumbnail: member?.displayAvatarURL?.({ size: 256 }),
        fields: [
          { name: 'Member', value: who, inline: true },
          { name: 'From', value: `<#${previous}>`, inline: true },
          { name: 'To', value: `<#${next}>`, inline: true },
        ],
        footer: `ID ${userId}`,
      });
    }
  }
}

function attach(client) {
  client.on('raw', (packet) => {
    onPacket(client, packet).catch((err) => {
      console.error('[لوق] تعذّر الحدث الخام:', err.message);
    });
  });
}

module.exports = { attach };
