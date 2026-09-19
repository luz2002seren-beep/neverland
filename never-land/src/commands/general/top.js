'use strict';

/**
 * commands/general/top.js
 * -------------------------------------------------------------
 * /top — لوحة المتصدّرين بنظام الخبرة:
 *   • الفترات: اليوم (توب داي) · هذا الأسبوع (توب ويك) · كل الأوقات
 *   • المصادر: الكل · كتابي · صوتي · تفاعل
 * -------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const leveling = require('../../systems/leveling');
const periods = require('../../lib/periods');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('لوحة المتصدّرين: توب داي · توب ويك · كل الأوقات')
    .addStringOption((o) =>
      o
        .setName('الفترة')
        .setDescription('المدة المطلوبة للترتيب')
        .addChoices(
          { name: 'اليوم (توب داي)', value: 'day' },
          { name: 'هذا الأسبوع (توب ويك)', value: 'week' },
          { name: 'كل الأوقات', value: 'all' },
        ))
    .addStringOption((o) =>
      o
        .setName('النوع')
        .setDescription('نوع الخبرة')
        .addChoices(
          { name: 'الكل', value: 'all' },
          { name: 'كتابي (رسائل)', value: 'text' },
          { name: 'صوتي (رومات)', value: 'voice' },
          { name: 'تفاعل (ردود)', value: 'interact' },
        ))
    .addIntegerOption((o) => o.setName('الصفحة').setDescription('رقم الصفحة').setMinValue(1).setMaxValue(50)),

  async run(client, interaction, lang) {
    const period = interaction.options.getString('الفترة') || 'day';
    const source = interaction.options.getString('النوع') || 'all';
    const page = interaction.options.getInteger('الصفحة') || 1;

    const board = leveling.getBoard(interaction.guildId, { period, source, page, perPage: 10 });
    return interaction.reply({
      embeds: [leveling.leaderboardEmbed(interaction.guildId, { period, source, page, perPage: 10 }, lang)],
      flags: board.rows.length ? undefined : 64,
    });
  },
};
