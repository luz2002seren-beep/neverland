'use strict';

/**
 * events/members.js
 * -------------------------------------------------------------
 * أحداث الأعضاء الكاملة:
 * دخول/خروج/طرد • رتب • اسم • صورة • اسم مستخدم • إسكات • دعم السيرفر
 * + تتبّع الدعوات (مين دعا مين).
 * -------------------------------------------------------------
 */

const { Events, AuditLogEvent } = require('discord.js');
const db = require('../database');
const logging = require('../systems/logging');
const welcome = require('../systems/welcome');
const { findExecutor } = require('../lib/audit');
const { truncate } = require('../lib/utils');

module.exports = [
  {
    name: Events.GuildMemberAdd,
    async execute(client, member) {
      /* ---- تتبّع الدعوة المستخدمة ---- */
      let inviteInfo = null;
      try {
        const cached = client.invites.get(member.guild.id);
        if (cached) {
          const fresh = await member.guild.invites.fetch();
          const used = fresh.find((inv) => (cached.get(inv.code) ?? 0) < (inv.uses ?? 0));
          if (used) inviteInfo = { code: used.code, inviter: used.inviter, uses: used.uses };
          client.invites.set(member.guild.id, new Map(fresh.map((inv) => [inv.code, inv.uses ?? 0])));
        }
      } catch {
        /* تجاهل */
      }

      if (member.user.bot) {
        await logging.send(client, member.guild, 'botStatus', {
          title: 'بوت دخل السيرفر',
          description: `${member} (${member.user.tag})`,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
        });
      }

      await logging.send(client, member.guild, 'memberJoin', {
        title: 'عضو جديد',
        description: `${member} \`${member.user.tag}\``,
        thumbnail: member.user.displayAvatarURL({ size: 256 }),
        fields: [
          { name: 'الحساب أُنشئ', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'الأعضاء الآن', value: `${member.guild.memberCount}`, inline: true },
          { name: 'بوت؟', value: member.user.bot ? 'نعم 🤖' : 'لا 👤', inline: true },
          ...(inviteInfo
            ? [{ name: 'الدعوة', value: `\`${inviteInfo.code}\` بواسطة ${inviteInfo.inviter ?? 'غير معروف'} (${inviteInfo.uses} استخدام)`, inline: false }]
            : []),
        ],
      });

      await welcome.handleMemberAdd(client, member, { inviteInfo });
      db.bumpDaily(member.guild.id, 'joins');
    },
  },

  {
    name: Events.GuildMemberRemove,
    async execute(client, member) {
      const guild = member.guild;

      /* ---- هل كان طردًا؟ (كشف من سجل التدقيق) ---- */
      const { executor, reason } = await findExecutor(guild, AuditLogEvent.MemberKick, {
        targetId: member.id,
        maxAgeMs: 5000,
      }).catch(() => ({}));

      if (executor) {
        await logging.send(client, guild, 'memberKick', {
          title: 'طرد عضو',
          description: `${member.user} \`${member.user.tag}\``,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
          fields: [
            { name: 'بواسطة', value: `${executor}`, inline: true },
            { name: 'السبب', value: reason || 'بدون سبب', inline: true },
          ],
        });
        db.addCase({
          guildId: guild.id,
          type: 'kick',
          userId: member.id,
          userTag: member.user.tag,
          moderatorId: executor.id,
          moderatorTag: executor.tag,
          reason: reason || 'بدون سبب',
        });
      } else {
        await logging.send(client, guild, 'memberLeave', {
          title: 'مغادرة عضو',
          description: `${member.user} \`${member.user.tag}\``,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
          fields: [
            { name: 'انضم في', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '—', inline: true },
            { name: 'الأعضاء الآن', value: `${guild.memberCount}`, inline: true },
            {
              name: 'الرتب',
              value: truncate(member.roles?.cache?.filter((r) => r.id !== guild.id).map((r) => r.name).join(', ') || '—', 1000),
              inline: false,
            },
          ],
        });
      }

      if (member.user?.bot) {
        await logging.send(client, guild, 'botStatus', {
          title: executor ? 'بوت انطرد من السيرفر' : 'بوت خرج من السيرفر',
          description: `${member.user} (${member.user.tag})`,
          fields: executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : [],
        });
      }

      await welcome.handleMemberRemove(client, member);
      db.bumpDaily(guild.id, 'leaves');
    },
  },

  {
    name: Events.GuildMemberUpdate,
    async execute(client, oldMember, newMember) {
      const guild = newMember.guild;

      /* ---- دعم السيرفر (Boost) ---- */
      if (!oldMember.premiumSince && newMember.premiumSince) {
        await logging.send(client, guild, 'memberBoost', {
          title: 'دعم جديد للسيرفر 🚀',
          description: `${newMember} بدأ بدعم السيرفر!`,
          thumbnail: newMember.user.displayAvatarURL({ size: 256 }),
        });
        await welcome.handleBoost(client, newMember);
      }
      if (oldMember.premiumSince && !newMember.premiumSince) {
        await logging.send(client, guild, 'memberBoost', {
          title: 'انتهاء الدعم',
          description: `${newMember} توقّف عن دعم السيرفر.`,
        });
      }

      /* ---- تغيّر الرتب ---- */
      const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
      const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
      if (added.size || removed.size) {
        const { executor } = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, { targetId: newMember.id, maxAgeMs: 6000 }).catch(() => ({}));
        await logging.send(client, guild, 'memberRoleUpdate', {
          title: 'تحديث رتب عضو',
          description: `${newMember} \`${newMember.user.tag}\``,
          fields: [
            ...(added.size ? [{ name: 'رتب أُضيفت', value: added.map((r) => `${r}`).join(' '), inline: false }] : []),
            ...(removed.size ? [{ name: 'رتب أُزيلت', value: removed.map((r) => `${r}`).join(' '), inline: false }] : []),
            ...(executor && executor.id !== client.user.id ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
          ],
        });
      }

      /* ---- الاسم المستعار ---- */
      if (oldMember.nickname !== newMember.nickname) {
        await logging.send(client, guild, 'memberNickname', {
          title: 'تغيير الاسم المستعار',
          fields: [
            { name: 'العضو', value: `${newMember}`, inline: true },
            { name: 'قبل', value: oldMember.nickname || '—', inline: true },
            { name: 'بعد', value: newMember.nickname || '—', inline: true },
          ],
        });
      }

      /* ---- صورة الحساب ---- */
      if (oldMember.user.avatar !== newMember.user.avatar || oldMember.user.avatarDecorationData !== newMember.user.avatarDecorationData) {
        await logging.send(client, guild, 'memberAvatar', {
          title: 'تغيير صورة الحساب',
          description: `${newMember}`,
          thumbnail: newMember.user.displayAvatarURL({ size: 256 }),
          fields: [{ name: 'الصورة الجديدة', value: `[اضغط للعرض](${newMember.user.displayAvatarURL({ size: 512 })})`, inline: true }],
        });
      }

      /* ---- اسم المستخدم ---- */
      if (newMember.user.bot && (oldMember.user.username !== newMember.user.username || oldMember.user.avatar !== newMember.user.avatar)) {
        await logging.send(client, guild, 'botStatus', {
          title: 'تغيّر بوت',
          description: `${newMember} (${newMember.user.tag})`,
        });
      }

      if (oldMember.user.username !== newMember.user.username) {
        await logging.send(client, guild, 'memberUsername', {
          title: 'تغيير اسم المستخدم',
          fields: [
            { name: 'العضو', value: `${newMember}`, inline: true },
            { name: 'قبل', value: `\`${oldMember.user.username}\``, inline: true },
            { name: 'بعد', value: `\`${newMember.user.username}\``, inline: true },
          ],
        });
      }

      /* ---- إسكات (Timeout) ---- */
      const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? 0;
      const newTimeout = newMember.communicationDisabledUntilTimestamp ?? 0;
      if (!oldTimeout && newTimeout && newTimeout > Date.now()) {
        await logging.send(client, guild, 'memberTimeout', {
          title: 'إسكات عضو (Timeout)',
          fields: [
            { name: 'العضو', value: `${newMember} \`${newMember.user.tag}\``, inline: true },
            { name: 'ينتهي', value: `<t:${Math.floor(newTimeout / 1000)}:R>`, inline: true },
          ],
        });
      } else if (oldTimeout && !newTimeout) {
        await logging.send(client, guild, 'memberTimeout', {
          title: 'فك الإسكات',
          fields: [{ name: 'العضو', value: `${newMember} \`${newMember.user.tag}\``, inline: true }],
        });
      }

      /* ---- تحديث كاش الإعدادات (للّوحة) ---- */
      db.getGuildSettings(guild.id);
    },
  },
];
