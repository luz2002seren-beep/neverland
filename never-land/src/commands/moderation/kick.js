'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const actions = require('../../lib/modActions');
const embeds = require('../../lib/embeds');
const { t } = require('../../lib/i18n');

module.exports = {
  permissions: [PermissionFlagsBits.KickMembers],
  botPermissions: [PermissionFlagsBits.KickMembers],
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('طرد عضو من السيرفر')
    .addUserOption((o) => o.setName('العضو').setDescription('العضو المطلوب طرده (منشن)').setRequired(false))
    .addStringOption((o) =>
      o
        .setName('آيدي')
        .setDescription('آيدي العضو — يشتغل بالمنشن أو بالآيدي (مثال: 123456789012345678)')
        .setRequired(false),
    )
    .addStringOption((o) => o.setName('السبب').setDescription('سبب الطرد').setRequired(false).setMaxLength(400)),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const reason = interaction.options.getString('السبب') || t(lang, 'common.reasonNone');

    /* الهدف: منشن أو آيدي — والاثنين يشتغلوا */
    const picked = interaction.options.getUser('العضو');
    const idInput = String(interaction.options.getString('آيدي') || '').trim();
    const targetId = picked?.id || (/\d{17,20}/.exec(idInput) || [])[0] || null;

    if (!targetId) {
      return interaction.editReply({
        embeds: [
          embeds.error('❌ حدّد العضو', 'اكتب منشن العضو في خيار **العضو**، أو حط آيديه في خيار **آيدي**.'),
        ],
      });
    }

    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      /* الطرد يحتاج العضو يكون موجود بالسيرفر (ديسكورد ما يسمح بغيره) — نوضّح ونرشد للحظر بالآيدي */
      const banned = await interaction.guild.bans.fetch(targetId).catch(() => null);
      const user =
        picked || (await client.users.fetch(targetId).catch(() => null)) || { id: targetId, tag: targetId, toString: () => `<@${targetId}>` };
      return interaction.editReply({
        embeds: [
          embeds.error(
            banned ? '❌ هذا العضو محظور حاليًا' : '❌ هذا العضو مو موجود بالسيرفر',
            banned
              ? `${user} محظور أصلًا — إذا بدك ترجّعه استخدم \`/unban\` بالآيدي.`
              : 'ديسكورد ما يسمح بطرد شخص مو بالسيرفر. إذا بدك تمنعه من الدخول استخدم `/ban` مع آيديه — الحظر يشتغل وهو برّا السيرفر.',
          ),
        ],
      });
    }
    const user = picked || member.user;

    const result = await actions.kick(client, {
      guild: interaction.guild,
      executor: interaction.user,
      target: member,
      reason,
      lang,
    });

    if (!result.ok) {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), actions.failure(lang, result.reason))] });
    }

    interaction.__replyVars = { user: `${user}`, target: `${user}`, reason, case: String(result.caseId) };

    await interaction.editReply({
      embeds: [
        embeds.mod('👢 طرد', t(lang, 'mod.kicked', { user: `${user}`, reason, caseId: result.caseId }), {
          thumbnail: user.displayAvatarURL({ size: 256 }),
          fields: [
            { name: t(lang, 'common.case'), value: `#${result.caseId}`, inline: true },
            { name: 'الإداري', value: `${interaction.user}`, inline: true },
          ],
        }),
      ],
    });
  },
};
