'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const { parseDuration, formatDuration } = require('../../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('ضبط تذكير وسيُنبّهك البوت في الوقت المحدّد')
    .addStringOption((o) => o.setName('المدة').setDescription('بعد كم من الوقت؟ مثل 10m أو 2h أو 3d').setRequired(true))
    .addStringOption((o) => o.setName('النص').setDescription('ماذا أذكّرك به؟').setRequired(true).setMaxLength(500)),

  async run(client, interaction, lang) {
    const durationInput = interaction.options.getString('المدة');
    const content = interaction.options.getString('النص');
    const ms = parseDuration(durationInput);

    if (!ms) {
      return interaction.reply({
        embeds: [embeds.error('صيغة المدة غير صحيحة', 'أمثلة: `10m` ، `1h30m` ، `2d`')],
        flags: 64,
      });
    }
    if (ms > 365 * 86400000) {
      return interaction.reply({ embeds: [embeds.error('مدة طويلة جدًا', 'الحد الأقصى سنة واحدة.')], flags: 64 });
    }

    const remindAt = Date.now() + ms;
    db.addReminder({
      guildId: interaction.guildId ?? 'dm',
      channelId: interaction.channelId,
      userId: interaction.user.id,
      content,
      remindAt,
    });

    return interaction.reply({
      embeds: [
        embeds.success('⏰ تم ضبط التذكير', `سأنبّهك <t:${Math.floor(remindAt / 1000)}:R> (بعد ${formatDuration(ms, lang)}).`, {
          fields: [{ name: 'التذكير', value: content, inline: false }],
        }),
      ],
      flags: 64,
    });
  },
};
