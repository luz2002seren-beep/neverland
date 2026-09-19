'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../lib/embeds');
const { t } = require('../../lib/i18n');
const { parseDuration, formatDuration } = require('../../lib/utils');

module.exports = {
  permissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('ضبط الوضع البطيء للقناة')
    .addStringOption((o) => o.setName('المدة').setDescription('مثل 5s أو 1m — اكتب 0 لإلغاء الوضع البطيء').setRequired(true))
    .addChannelOption((o) => o.setName('القناة').setDescription('القناة (افتراضيًا القناة الحالية)').setRequired(false)),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const input = interaction.options.getString('المدة');
    const channel = interaction.options.getChannel('القناة') || interaction.channel;

    const seconds = input.trim() === '0' ? 0 : Math.floor((parseDuration(input) || 0) / 1000);
    if (seconds > 21600) {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), '❌ الحد الأقصى للوضع البطيء هو 6 ساعات.')] });
    }

    try {
      await channel.setRateLimitPerUser(seconds, `بواسطة ${interaction.user.tag}`);
    } catch {
      return interaction.editReply({ embeds: [embeds.error(t(lang, 'common.error'), t(lang, 'common.botNoPermission'))] });
    }

    return interaction.editReply({
      embeds: [
        embeds.success(
          'الوضع البطيء',
          seconds === 0
            ? `✅ تم إلغاء الوضع البطيء في ${channel}`
            : `${t(lang, 'mod.slowmodeSet', { seconds })} (${formatDuration(seconds * 1000, lang)}) في ${channel}`,
        ),
      ],
    });
  },
};
