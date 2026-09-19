'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const embeds = require('../../lib/embeds');
const { t } = require('../../lib/i18n');

module.exports = {
  permissions: [PermissionFlagsBits.ManageMessages],
  botPermissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory],
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('حذف رسائل بشكل جماعي (تنظيف القناة)')
    .addSubcommand((sub) =>
      sub
        .setName('messages')
        .setDescription('حذف عدد من الرسائل')
        .addIntegerOption((o) => o.setName('العدد').setDescription('عدد الرسائل (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption((o) => o.setName('العضو').setDescription('حذف رسائل عضو معيّن فقط').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('contains')
        .setDescription('حذف الرسائل التي تحتوي على نص معيّن')
        .addStringOption((o) => o.setName('النص').setDescription('النص المطلوب البحث عنه').setRequired(true))
        .addIntegerOption((o) => o.setName('العدد').setDescription('أقصى عدد رسائل للبحث (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('links')
        .setDescription('حذف الرسائل التي تحتوي روابط')
        .addIntegerOption((o) => o.setName('العدد').setDescription('أقصى عدد رسائل للبحث (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('bot')
        .setDescription('حذف رسائل البوتات')
        .addIntegerOption((o) => o.setName('العدد').setDescription('أقصى عدد رسائل للبحث (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('حذف كل رسائل عضو في القناة')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true))
        .addIntegerOption((o) => o.setName('العدد').setDescription('أقصى عدد رسائل للبحث (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    ),

  async run(client, interaction, lang) {
    await interaction.deferReply({ flags: 64 });

    const channel = interaction.channel;
    if (!channel || channel.type === ChannelType.GuildStageVoice) {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), '❌ لا يمكن استخدام هذا الأمر في هذه القناة.')] });
    }

    const sub = interaction.options.getSubcommand();
    const limit = interaction.options.getInteger('العدد') ?? 50;
    let deleted = 0;

    try {
      const fetched = await channel.messages.fetch({ limit: Math.min(limit, 100) });

      let targets = [...fetched.values()];

      if (sub === 'messages') {
        const user = interaction.options.getUser('العضو');
        if (user) targets = targets.filter((m) => m.author.id === user.id);
      } else if (sub === 'contains') {
        const needle = interaction.options.getString('النص').toLowerCase();
        targets = targets.filter((m) => m.content?.toLowerCase().includes(needle));
      } else if (sub === 'links') {
        targets = targets.filter((m) => /https?:\/\//i.test(m.content || ''));
      } else if (sub === 'bot') {
        targets = targets.filter((m) => m.author.bot);
      } else if (sub === 'user') {
        const user = interaction.options.getUser('العضو');
        targets = targets.filter((m) => m.author.id === user.id);
      }

      // لا يمكن حذف الرسائل الأقدم من 14 يومًا بشكل جماعي
      const recent = targets.filter((m) => Date.now() - m.createdTimestamp < 14 * 86400000);
      const old = targets.length - recent.length;

      if (recent.length) {
        const result = await channel.bulkDelete(recent, true).catch(async () => {
          // احتياطي: حذف منفرد عند فشل الحذف الجماعي
          for (const m of recent) {
            await m.delete().then(() => { deleted += 1; }).catch(() => {});
          }
          return null;
        });
        deleted = result?.size ?? deleted;
      }

      const notes = [];
      if (old) notes.push(`⚠️ تم تجاهل ${old} رسالة أقدم من 14 يومًا.`);
      if (!targets.length) notes.push('ما لقيت رسائل مطابقة.');

      return interaction.editReply({
        embeds: [embeds.success('تنظيف القناة', `${t(lang, 'mod.cleared', { count: deleted })}${notes.length ? `\n${notes.join('\n')}` : ''}`)],
      });
    } catch (err) {
      console.error('فشل التنظيف:', err.message);
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), '❌ ما قدرت أحذف الرسائل. تأكد من صلاحية "إدارة الرسائل" وأن الرسائل أحدث من 14 يومًا.')] });
    }
  },
};
