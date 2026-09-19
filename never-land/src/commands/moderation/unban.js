'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const actions = require('../../lib/modActions');
const embeds = require('../../lib/embeds');
const db = require('../../database');
const { t } = require('../../lib/i18n');

module.exports = {
  permissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('فك الحظر عن عضو باستخدام الآيدي أو اسم المستخدم')
    .addStringOption((o) =>
      o
        .setName('العضو')
        .setDescription('آيدي العضو أو منشنه أو اسمه (مثال: 123456789012345678) — يشتغل للعضو داخل أو برّا السيرفر')
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('السبب').setDescription('سبب فك الحظر').setRequired(false)),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const input = interaction.options.getString('العضو').trim();
    const reason = interaction.options.getString('السبب') || 'بدون سبب';

    /* نقبل: آيدي · منشن <@123> · اسم كامل name#0000 · اسم المستخدم (بلا حساسية لحالة الأحرف) */
    const id = input.replace(/[^0-9]/g, '');
    const wanted = input.toLowerCase().replace(/^@/, '');

    let entry = null;
    if (/^\d{17,20}$/.test(id)) {
      entry = await interaction.guild.bans.fetch(id).catch(() => null);
    }
    if (!entry) {
      const bans = await interaction.guild.bans.fetch().catch(() => null);
      if (!bans) {
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), '❌ ما قدرت أجيب قائمة المحظورين، تأكد من صلاحيات البوت.')] });
      }
      entry = bans.find((b) => {
        const tag = String(b.user.tag || '').toLowerCase();
        return (
          b.user.id === id ||
          tag === wanted ||
          String(b.user.username || '').toLowerCase() === wanted ||
          String(b.user.globalName || '').toLowerCase() === wanted
        );
      });
    }

    if (!entry) {
      return interaction.editReply({
        embeds: [embeds.error(t(lang, 'common.error'), '❌ هذا العضو مو موجود في قائمة المحظورين. تأكد من الآيدي أو المنشن.')],
      });
    }

    const result = await actions.unban(client, {
      guild: interaction.guild,
      executor: interaction.user,
      userId: entry.user.id,
      reason,
    });

    if (!result.ok) {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), actions.failure(lang, result.reason))] });
    }

    await interaction.editReply({
      embeds: [
        embeds.success(t(lang, 'mod.unbanned', { user: entry.user.tag }), `**السبب:** ${reason}`, {
          fields: [
            { name: t(lang, 'common.case'), value: `#${result.caseId}`, inline: true },
            { name: 'الإداري', value: `${interaction.user}`, inline: true },
          ],
        }),
      ],
    });
  },
};
