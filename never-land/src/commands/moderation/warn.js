'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const actions = require('../../lib/modActions');
const embeds = require('../../lib/embeds');
const db = require('../../database');
const { t } = require('../../lib/i18n');
const { formatDate } = require('../../lib/utils');

module.exports = {
  permissions: [PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('نظام التحذيرات: إضافة، عرض، حذف')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('تحذير عضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true))
        .addStringOption((o) => o.setName('السبب').setDescription('سبب التحذير').setRequired(false))
        .addBooleanOption((o) => o.setName('خاص').setDescription('إرسال التحذير في الخاص فقط (بدون إعلان)').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('عرض تحذيرات عضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('حذف تحذير برقمه')
        .addIntegerOption((o) => o.setName('الرقم').setDescription('رقم التحذير (Case ID)').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('حذف كل تحذيرات عضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true)),
    ),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();

    /* ------------------------- إضافة تحذير ------------------------- */
    if (sub === 'add') {
      await interaction.deferReply();
      const user = interaction.options.getUser('العضو');
      const reason = interaction.options.getString('السبب') || t(lang, 'common.reasonNone');
      const isPrivate = interaction.options.getBoolean('خاص') ?? false;

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'common.userNotFound'))] });
      }

      const result = await actions.warn(client, {
        guild: interaction.guild,
        executor: interaction.user,
        target: member,
        reason,
        lang,
        silent: isPrivate,
      });

      if (!result.ok) {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), actions.failure(lang, result.reason))] });
      }

      const fields = [
        { name: t(lang, 'common.case'), value: `#${result.caseId}`, inline: true },
        { name: 'عدد التحذيرات', value: `${result.count}`, inline: true },
        { name: 'الإداري', value: `${interaction.user}`, inline: true },
      ];
      if (result.autoAction) {
        fields.push({ name: '⚙️ عقوبة تلقائية', value: `تم تطبيق: **${result.autoAction}** (تجاوز حد التحذيرات)`, inline: false });
      }

      interaction.__replyVars = { user: `${user}`, target: `${user}`, reason, count: String(result.count) };

      return interaction.editReply({
        embeds: [
          embeds.warning('تحذير', t(lang, 'mod.warned', { user: `${user}`, reason, count: result.count }), {
            thumbnail: user.displayAvatarURL({ size: 256 }),
            fields,
          }),
        ],
      });
    }

    /* ------------------------- عرض التحذيرات ------------------------- */
    if (sub === 'list') {
      await interaction.deferReply();
      const user = interaction.options.getUser('العضو');
      const { items } = db.listCases({ guildId: interaction.guildId, userId: user.id, type: 'warn', limit: 25 });
      if (!items.length) {
        return interaction.editReply({ embeds: [embeds.info('التحذيرات', t(lang, 'mod.historyEmpty'))] });
      }
      const lines = items.map(
        (c) => `**#${c.id}** — ${c.reason || '—'}\n> بواسطة <@${c.moderator_id}> • ${formatDate(c.created_at)}`,
      );
      return interaction.editReply({
        embeds: [
          embeds.info(t(lang, 'mod.historyTitle', { user: user.username }), lines.join('\n').slice(0, 4000), {
            thumbnail: user.displayAvatarURL({ size: 256 }),
            footer: `المجموع: ${items.length} تحذير`,
          }),
        ],
      });
    }

    /* ------------------------- حذف تحذير ------------------------- */
    if (sub === 'remove') {
      await interaction.deferReply();
      const id = interaction.options.getInteger('الرقم');
      const record = db.getCase(interaction.guildId, id);
      if (!record || record.type !== 'warn') {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'mod.warnNotFound'))] });
      }
      db.deleteCase(interaction.guildId, id);
      return interaction.editReply({ embeds: [embeds.success('حذف تحذير', t(lang, 'mod.warnRemoved', { id }))] });
    }

    /* ------------------------- حذف الكل ------------------------- */
    if (sub === 'clear') {
      await interaction.deferReply();
      const user = interaction.options.getUser('العضو');
      const count = db.clearWarnings(interaction.guildId, user.id);
      return interaction.editReply({
        embeds: [embeds.success('حذف التحذيرات', t(lang, 'mod.warnsCleared', { user: user.username, count }))],
      });
    }
  },
};
