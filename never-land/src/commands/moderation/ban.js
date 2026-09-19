'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const actions = require('../../lib/modActions');
const embeds = require('../../lib/embeds');
const db = require('../../database');
const { t } = require('../../lib/i18n');
const { parseDuration } = require('../../lib/utils');

module.exports = {
  permissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('حظر عضو من السيرفر (مع دعم الحظر المؤقت)')
    .setDescriptionLocalizations({ 'en-US': 'Ban a member from the server' })
    .addUserOption((o) => o.setName('العضو').setDescription('العضو المطلوب حظره (منشن)').setRequired(false))
    .addStringOption((o) =>
      o
        .setName('آيدي')
        .setDescription('آيدي العضو — يشتغل حتى لو العضو برّا السيرفر (مثال: 123456789012345678)')
        .setRequired(false),
    )
    .addStringOption((o) => o.setName('السبب').setDescription('سبب الحظر').setRequired(false).setMaxLength(400))
    .addStringOption((o) =>
      o.setName('المدة').setDescription('مدة اختيارية مثل 7d أو 2h (اتركها فارغة لحظر دائم)').setRequired(false))
    .addIntegerOption((o) =>
      o.setName('حذف_الرسائل').setDescription('حذف رسائله خلال آخر X يوم (0-7)').setMinValue(0).setMaxValue(7).setRequired(false)),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const reason = interaction.options.getString('السبب') || t(lang, 'common.reasonNone');
    const durationInput = interaction.options.getString('المدة');
    const deleteDays = interaction.options.getInteger('حذف_الرسائل') ?? 0;

    /* الهدف: منشن/اختيار العضو أو الآيدي الرقمي — والاثنين يشتغلوا لو العضو برّا السيرفر */
    const picked = interaction.options.getUser('العضو');
    const idInput = String(interaction.options.getString('آيدي') || '').trim();
    const targetId = picked?.id || (/\d{17,20}/.exec(idInput) || [])[0] || null;

    if (!targetId) {
      return interaction.editReply({
        embeds: [
          embeds.error('❌ حدّد العضو', 'اكتب منشن العضو في خيار **العضو**، أو حط آيديه في خيار **آيدي** — والآيدي يشتغل حتى لو العضو برّا السيرفر.'),
        ],
      });
    }

    /* العضو ممكن يكون داخل السيرفر أو خارجه (حظر بالآيدي) — الاثنين يشتغلوا */
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    const user = picked || member?.user || (await client.users.fetch(targetId).catch(() => null));
    if (!user) {
      return interaction.editReply({
        embeds: [embeds.error(t(lang, 'common.error'), '❌ ما قدرت ألاقي هذا المستخدم بالآيدي المكتوب. تأكد من الرقم.')],
      });
    }

    const durationMs = durationInput ? parseDuration(durationInput) : null;
    if (durationInput && !durationMs) {
      return interaction.editReply({
        embeds: [embeds.error('صيغة المدة غير صحيحة', 'استخدم صيغة مثل `10m` أو `2h` أو `7d`.')],
      });
    }

    const result = await actions.ban(client, {
      guild: interaction.guild,
      executor: interaction.user,
      target: member || user,
      reason,
      lang,
      deleteMessageSeconds: Math.min(deleteDays, 7) * 86400,
    });

    if (!result.ok) {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), actions.failure(lang, result.reason))] });
    }

    /* قيم جاهزة لقالب «ردود أوامر» في الموقع: {user} · {reason} · {case} · {duration} */
    interaction.__replyVars = {
      user: `${user}`,
      target: `${user}`,
      reason,
      case: String(result.caseId),
      duration: durationMs ? String(durationInput) : 'دائم',
    };

    const embed = embeds.mod(
      '🔨 حظر',
      t(lang, 'mod.banned', {
        user: `${user}`,
        reason,
        caseId: result.caseId,
      }),
      {
        thumbnail: user.displayAvatarURL({ size: 256 }),
        fields: [
          { name: t(lang, 'common.case'), value: `#${result.caseId}`, inline: true },
          { name: 'الإداري', value: `${interaction.user}`, inline: true },
          { name: 'النوع', value: durationMs ? `مؤقت (${durationInput})` : 'دائم', inline: true },
          { name: 'مكان العضو', value: member ? 'داخل السيرفر' : 'خارج السيرفر (حظر بالآيدي)', inline: false },
        ],
      },
    );

    await interaction.editReply({ embeds: [embed] });

    // جدولة فك الحظر تلقائيًا عند انتهاء المدة (الحظر المؤقت)
    if (durationMs) {
      setTimeout(() => {
        interaction.guild.bans
          .remove(user.id, `انتهاء مدة الحظر المؤقت (حالة #${result.caseId})`)
          .then(() => {
            db.updateCase(interaction.guild.id, result.caseId, { active: 0 });
          })
          .catch(() => {});
      }, Math.min(durationMs, 2 ** 31 - 1)).unref?.();
    }
  },
};
