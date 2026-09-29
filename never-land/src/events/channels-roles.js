'use strict';

/**
 * events/channels-roles.js
 * -------------------------------------------------------------
 * لوقات القنوات والرتب (إنشاء/حذف/تعديل) مع كشف المنفّذ.
 * -------------------------------------------------------------
 */

const { Events, AuditLogEvent, ChannelType } = require('discord.js');
const logging = require('../systems/logging');
const { findExecutor } = require('../lib/audit');

function isVoiceRoom(channel) {
  return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
}

function isTextRoom(channel) {
  return channel.type === ChannelType.GuildText
    || channel.type === ChannelType.GuildAnnouncement
    || channel.type === ChannelType.GuildForum;
}

/** وصف نوع القناة بالعربي */
function channelKind(channel) {
  switch (channel.type) {
    case ChannelType.GuildVoice: return '🔊 صوتية';
    case ChannelType.GuildCategory: return '📂 قسم';
    case ChannelType.GuildAnnouncement: return '📢 إعلانات';
    case ChannelType.GuildForum: return '💬 منتدى';
    case ChannelType.GuildStageVoice: return '🎤 مسرح';
    default: return '💬 نصية';
  }
}

module.exports = [
  {
    name: Events.ChannelCreate,
    async execute(client, channel) {
      if (!channel.guild) return;
      const { executor } = await findExecutor(channel.guild, AuditLogEvent.ChannelCreate, { targetId: channel.id });
      if (isVoiceRoom(channel)) {
        await logging.send(client, channel.guild, 'voiceJoin', {
          title: 'إنشاء روم صوتي',
          footer: 'الرومات الصوتية',
          fields: [
            { name: 'الروم', value: `${channel} \`${channel.name}\``, inline: true },
            ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
          ],
        });
        return;
      }
      if (!isTextRoom(channel) && channel.type !== ChannelType.GuildCategory) return;
      await logging.send(client, channel.guild, 'channelCreate', {
        title: 'إنشاء قناة',
        fields: [
          { name: 'القناة', value: `${channel} \`${channel.name}\``, inline: true },
          { name: 'النوع', value: channelKind(channel), inline: true },
          ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
        ],
      });
    },
  },
  {
    name: Events.ChannelDelete,
    async execute(client, channel) {
      if (!channel.guild) return;
      const { executor } = await findExecutor(channel.guild, AuditLogEvent.ChannelDelete, { targetId: channel.id });
      if (isVoiceRoom(channel)) {
        await logging.send(client, channel.guild, 'voiceLeave', {
          title: 'حذف روم صوتي',
          footer: 'الرومات الصوتية',
          fields: [
            { name: 'الروم', value: `\`${channel.name}\``, inline: true },
            ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
          ],
        });
        return;
      }
      if (!isTextRoom(channel) && channel.type !== ChannelType.GuildCategory) return;
      await logging.send(client, channel.guild, 'channelDelete', {
        title: 'حذف قناة',
        fields: [
          { name: 'القناة', value: `\`${channel.name}\``, inline: true },
          { name: 'النوع', value: channelKind(channel), inline: true },
          ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
        ],
      });
    },
  },
  {
    name: Events.ChannelUpdate,
    async execute(client, oldChannel, newChannel) {
      if (!newChannel.guild) return;
      if (isVoiceRoom(newChannel)) {
        if (oldChannel.name !== newChannel.name) {
          await logging.send(client, newChannel.guild, 'voiceMove', {
            title: 'تعديل روم صوتي',
            footer: 'الرومات الصوتية',
            fields: [{ name: 'الروم', value: `${oldChannel.name} ➜ ${newChannel.name}`, inline: false }],
          });
        }
        return;
      }

      // تغيير الصلاحيات (Overwrites)
      const oldPerms = [...(oldChannel.permissionOverwrites?.cache?.values?.() ?? [])];
      const newPerms = [...(newChannel.permissionOverwrites?.cache?.values?.() ?? [])];
      const permsChanged =
        oldPerms.length !== newPerms.length ||
        oldPerms.some((o) => {
          const match = newPerms.find((n) => n.id === o.id);
          return !match || match.allow.bitfield !== o.allow.bitfield || match.deny.bitfield !== o.deny.bitfield;
        });

      if (permsChanged) {
        const { executor } = await findExecutor(newChannel.guild, AuditLogEvent.ChannelOverwriteUpdate, { targetId: newChannel.id, maxAgeMs: 6000 }).catch(() => ({}));
        await logging.send(client, newChannel.guild, 'channelPermissions', {
          title: 'تغيير صلاحيات قناة',
          fields: [
            { name: 'القناة', value: `${newChannel}`, inline: true },
            { name: 'عدد التغييرات', value: `${Math.abs(newPerms.length - oldPerms.length) || 'تعديل'}`, inline: true },
            ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
          ],
        });
      }

      const changes = [];
      if (oldChannel.name !== newChannel.name) {
        changes.push({ name: 'الاسم', value: `${oldChannel.name} ➜ ${newChannel.name}`, inline: false });
      }
      if (oldChannel.topic !== newChannel.topic) {
        changes.push({ name: 'الوصف', value: `${(oldChannel.topic || '—').slice(0, 400)} ➜ ${(newChannel.topic || '—').slice(0, 400)}`, inline: false });
      }
      if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push({ name: 'الوضع البطيء', value: `${oldChannel.rateLimitPerUser ?? 0}s ➜ ${newChannel.rateLimitPerUser ?? 0}s`, inline: true });
      }
      if (!changes.length) return;

      const { executor } = await findExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, { targetId: newChannel.id, maxAgeMs: 5000 });
      await logging.send(client, newChannel.guild, 'channelUpdate', {
        title: 'تعديل قناة',
        fields: [
          { name: 'القناة', value: `${newChannel}`, inline: true },
          ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
          ...changes,
        ],
      });
    },
  },
  {
    name: Events.GuildRoleCreate,
    async execute(client, role) {
      const { executor } = await findExecutor(role.guild, AuditLogEvent.RoleCreate, { targetId: role.id });
      await logging.send(client, role.guild, 'roleCreate', {
        title: 'إنشاء رتبة',
        fields: [
          { name: 'الرتبة', value: `${role} \`${role.name}\``, inline: true },
          ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
        ],
      });
    },
  },
  {
    name: Events.GuildRoleDelete,
    async execute(client, role) {
      const { executor } = await findExecutor(role.guild, AuditLogEvent.RoleDelete, { targetId: role.id });
      await logging.send(client, role.guild, 'roleDelete', {
        title: 'حذف رتبة',
        fields: [
          { name: 'الرتبة', value: `\`${role.name}\``, inline: true },
          ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
        ],
      });
    },
  },
  {
    name: Events.GuildRoleUpdate,
    async execute(client, oldRole, newRole) {
      if (oldRole.name === newRole.name && oldRole.hexColor === newRole.hexColor && oldRole.permissions.bitfield === newRole.permissions.bitfield) return;

      const changes = [];
      if (oldRole.name !== newRole.name) changes.push({ name: 'الاسم', value: `${oldRole.name} ➜ ${newRole.name}`, inline: true });
      if (oldRole.hexColor !== newRole.hexColor) changes.push({ name: 'اللون', value: `${oldRole.hexColor} ➜ ${newRole.hexColor}`, inline: true });
      if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push({ name: 'الصلاحيات', value: 'تم تغيير صلاحيات الرتبة', inline: false });

      const { executor } = await findExecutor(newRole.guild, AuditLogEvent.RoleUpdate, { targetId: newRole.id, maxAgeMs: 5000 });
      await logging.send(client, newRole.guild, 'roleUpdate', {
        title: 'تعديل رتبة',
        fields: [
          { name: 'الرتبة', value: `${newRole}`, inline: true },
          ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
          ...changes,
        ],
      });
    },
  },
];
