'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../lib/embeds');
const db = require('../../database');
const logging = require('../../systems/logging');
const { t } = require('../../lib/i18n');
const { canModerate } = require('../../lib/permissions');
const { formatDate } = require('../../lib/utils');

module.exports = {
  permissions: [PermissionFlagsBits.ManageNicknames],
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('إدارة الأعضاء: الاسم المستعار، الرتب، الحالات، التصفير')
    .addSubcommand((sub) =>
      sub
        .setName('nickname')
        .setDescription('تغيير الاسم المستعار لعضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true))
        .addStringOption((o) => o.setName('الاسم').setDescription('الاسم الجديد (اتركه فارغًا لإزالة الاسم المستعار)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('role')
        .setDescription('إعطاء أو سحب رتبة من عضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true))
        .addRoleOption((o) => o.setName('الرتبة').setDescription('الرتبة').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('سجل العقوبات لعضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('تصفير كل العقوبات المسجّلة لعضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true)),
    ),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('العضو');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'common.userNotFound'))] });
    }

    /* ---------------- الاسم المستعار ---------------- */
    if (sub === 'nickname') {
      const name = interaction.options.getString('الاسم');
      const check = canModerate({ guild: interaction.guild, executor: interaction.user, target: member, client });
      if (!check.ok) {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), actionsFailure(lang, check.reason))] });
      }
      if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'common.botNoPermission'))] });
      }
      await member.setNickname(name || null, `بواسطة ${interaction.user.tag}`).catch(() => {});
      return interaction.editReply({
        embeds: [embeds.success('الاسم المستعار', t(lang, 'mod.nicknameSet', { name: name || '(بدون اسم مستعار)' }))],
      });
    }

    /* ---------------- الرتب ---------------- */
    if (sub === 'role') {
      const role = interaction.options.getRole('الرتبة');
      if (role.position >= interaction.guild.members.me.roles.highest.position) {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'common.botNoPermission'))] });
      }

      const has = member.roles.cache.has(role.id);
      await (has ? member.roles.remove(role, `بواسطة ${interaction.user.tag}`) : member.roles.add(role, `بواسطة ${interaction.user.tag}`)).catch(() => {});

      await logging.logModAction(client, interaction.guild, {
        action: has ? 'سحب رتبة' : 'إعطاء رتبة',
        moderator: interaction.user,
        target: user,
        reason: role.name,
      });

      return interaction.editReply({
        embeds: [
          embeds.success(
            'الرتب',
            has
              ? t(lang, 'mod.roleRemoved', { role: `${role}`, user: user.username })
              : t(lang, 'mod.roleAdded', { role: `${role}`, user: user.username }),
          ),
        ],
      });
    }

    /* ---------------- السجل ---------------- */
    if (sub === 'history') {
      const { items, total } = db.listCases({ guildId: interaction.guildId, userId: user.id, limit: 20 });
      if (!items.length) {
        return interaction.editReply({ embeds: [embeds.info('السجل', '📭 لا توجد أي عقوبات مسجّلة لهذا العضو.')] });
      }
      const typeNames = {
        warn: '⚠️ تحذير',
        ban: '🔨 حظر',
        unban: '♻️ فك حظر',
        kick: '👢 طرد',
        timeout: '🔇 إسكات',
        untimeout: '🔊 فك إسكات',
        ticket: '🎫 تذكرة',
        automod: '🚨 حماية تلقائية',
      };
      const lines = items.map(
        (c) => `${typeNames[c.type] || c.type} • **#${c.id}** — ${c.reason || '—'}\n> <@${c.moderator_id}> • ${formatDate(c.created_at)}`,
      );

      // إحصائية سريعة بحسب النوع
      const stats = ['warn', 'ban', 'kick', 'timeout']
        .map((type) => `${typeNames[type]}: ${db.countCases(interaction.guildId, { type, userId: user.id })}`)
        .join(' | ');

      return interaction.editReply({
        embeds: [
          embeds.info(`سجل ${user.username}`, lines.join('\n').slice(0, 3800), {
            thumbnail: user.displayAvatarURL({ size: 256 }),
            footer: `إجمالي: ${total} | ${stats}`,
          }),
        ],
      });
    }

    /* ---------------- التصفير ---------------- */
    if (sub === 'reset') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'common.noPermission'))] });
      }
      const { items } = db.listCases({ guildId: interaction.guildId, userId: user.id, limit: 1000 });
      for (const record of items) db.deleteCase(interaction.guildId, record.id);
      return interaction.editReply({
        embeds: [embeds.success('تصفير العقوبات', `✅ تم حذف **${items.length}** حالة لعضو ${user}.`)],
      });
    }
  },
};

function actionsFailure(lang, reason) {
  const map = {
    hierarchy: t(lang, 'mod.hierarchy'),
    targetIsStaff: t(lang, 'mod.targetIsStaff'),
    selfAction: t(lang, 'mod.selfAction'),
    botHierarchy: t(lang, 'common.botNoPermission'),
  };
  return map[reason] || t(lang, 'common.error');
}
