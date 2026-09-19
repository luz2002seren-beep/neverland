'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const actions = require('../../lib/modActions');
const embeds = require('../../lib/embeds');
const { t } = require('../../lib/i18n');
const { parseDuration, formatDuration } = require('../../lib/utils');

module.exports = {
  permissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('إسكات عضو مؤقتًا (Timeout) أو فك الإسكات')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('تطبيق إسكات مؤقت')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true))
        .addStringOption((o) => o.setName('المدة').setDescription('المدة مثل 10m أو 2h (أقصى 28 يوم)').setRequired(true))
        .addStringOption((o) => o.setName('السبب').setDescription('السبب').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('فك الإسكات عن عضو')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true))
        .addStringOption((o) => o.setName('السبب').setDescription('السبب').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('عرض الأعضاء المُسكتين حاليًا')),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();

    /* ---------------- قائمة المُسكتين ---------------- */
    if (sub === 'list') {
      const members = await interaction.guild.members.fetch({ limit: 1000 }).catch(() => null);
      const timedOut = members?.filter((m) => m.isCommunicationDisabled?.()) ?? new Map();
      if (!timedOut.size) {
        return interaction.editReply({ embeds: [embeds.info('الإسكاتات النشطة', '✅ ما في أي عضو مُسكَت حاليًا.')] });
      }
      const lines = [...timedOut.values()].slice(0, 25).map((m) => {
        const until = m.communicationDisabledUntilTimestamp;
        return `• ${m} — ينتهي <t:${Math.floor(until / 1000)}:R>`;
      });
      return interaction.editReply({
        embeds: [embeds.info('🔇 الإسكاتات النشطة', lines.join('\n'))],
      });
    }

    const user = interaction.options.getUser('العضو');
    const reason = interaction.options.getString('السبب') || t(lang, 'common.reasonNone');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'common.userNotFound'))] });
    }

    /* ---------------- فك الإسكات ---------------- */
    if (sub === 'remove') {
      const result = await actions.untimeout(client, { guild: interaction.guild, executor: interaction.user, target: member, reason });
      if (!result.ok) {
        const msg = result.reason === 'notTimedOut' ? '❌ هذا العضو غير مُسكَت أساسًا.' : actions.failure(lang, result.reason);
        return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), msg)] });
      }
      return interaction.editReply({ embeds: [embeds.success('فك الإسكات', t(lang, 'mod.untimedOut', { user: `${user}` }))] });
    }

    /* ---------------- تطبيق الإسكات ---------------- */
    const durationInput = interaction.options.getString('المدة');
    const durationMs = parseDuration(durationInput);
    if (!durationMs) {
      return interaction.editReply({
        embeds: [embeds.error('صيغة المدة غير صحيحة', 'أمثلة صحيحة: `10m` ، `1h30m` ، `3d`')],
      });
    }

    const result = await actions.timeout(client, {
      guild: interaction.guild,
      executor: interaction.user,
      target: member,
      reason,
      durationMs,
      lang,
    });

    if (!result.ok) {
      const msg = result.reason === 'tooLong' ? '❌ الحد الأقصى للإسكات هو 28 يوم.' : actions.failure(lang, result.reason);
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), msg)] });
    }

    await interaction.editReply({
      embeds: [
        embeds.mod(
          '🔇 إسكات',
          t(lang, 'mod.timedOut', { user: `${user}`, duration: formatDuration(durationMs, lang), reason }),
          {
            thumbnail: user.displayAvatarURL({ size: 256 }),
            fields: [
              { name: t(lang, 'common.case'), value: `#${result.caseId}`, inline: true },
              { name: 'الإداري', value: `${interaction.user}`, inline: true },
              { name: 'ينتهي', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>`, inline: true },
            ],
          },
        ),
      ],
    });
  },
};
