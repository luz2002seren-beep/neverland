'use strict';

/**
 * commands/general/top.js
 * -------------------------------------------------------------
 * /top — لوحة المتصدّرين بنفس تنظيم لوحات الترتيب المعروفة:
 *
 *   /top                  ⇒ توب اليوم (كتابي + صوتي)
 *   /top day              ⇒ توب اليوم
 *   /top week             ⇒ توب الأسبوع
 *   /top month            ⇒ توب الشهر
 *   /top text day         ⇒ توب اليوم — رسائل فقط
 *   /top voice week       ⇒ توب الأسبوع — صوت فقط
 *   /top text week 2      ⇒ الصفحة الثانية
 *
 * وفي الشات بلا بريفيكست:  t day · t week · t month · t text week 2
 * -------------------------------------------------------------
 */

const { SlashCommandBuilder } = require('discord.js');
const leveling = require('../../systems/leveling');
const periods = require('../../lib/periods');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('لوحة المتصدّرين: توب داي · توب ويك · توب منث (كتابي أو صوتي)')
    .addStringOption((o) =>
      o
        .setName('النوع')
        .setDescription('نوع الخبرة')
        .addChoices(
          { name: 'كتابي (رسائل)', value: 'text' },
          { name: 'صوتي (رومات)', value: 'voice' },
          { name: 'تفاعل (ردود)', value: 'interact' },
          { name: 'الكل', value: 'all' },
        ))
    .addStringOption((o) =>
      o
        .setName('الفترة')
        .setDescription('المدة المطلوبة للترتيب')
        .addChoices(
          { name: 'اليوم (توب داي)', value: 'day' },
          { name: 'هذا الأسبوع (توب ويك)', value: 'week' },
          { name: 'هذا الشهر (توب منث)', value: 'month' },
          { name: 'كل الأوقات', value: 'all' },
        ))
    .addIntegerOption((o) => o.setName('الصفحة').setDescription('رقم الصفحة').setMinValue(1).setMaxValue(50)),

  async run(client, interaction, lang) {
    const period = (interaction.options.getString('الفترة') || 'day').toLowerCase();
    const source = (interaction.options.getString('النوع') || 'all').toLowerCase();
    const page = interaction.options.getInteger('الصفحة') || 1;

    const safePeriod = periods.isPeriod(period) ? period : 'day';
    const safeSource = periods.isSource(source) ? source : 'all';

    const options = { period: safePeriod, source: safeSource, page, perPage: 10 };
    const board = leveling.getBoard(interaction.guildId, options);

    /* القيم غير الصالحة ما تطلع خطأ — ترجع للأفتراضي المعروفة */
    const pages = Math.max(1, Math.ceil(board.total / options.perPage));
    const safePage = Math.min(page, pages);

    return interaction.reply({
      embeds: [leveling.topBoardEmbed(interaction.guildId, { ...options, page: safePage }, lang)],
      flags: board.total ? undefined : 64,
    });
  },
};
