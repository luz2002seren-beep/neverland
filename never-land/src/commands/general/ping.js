'use strict';

const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../lib/embeds');
const { formatDuration } = require('../../lib/utils');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('قياس سرعة استجابة البوت وجودة الاتصال'),

  async run(client, interaction, lang) {
    const sent = await interaction.reply({ content: '🏓 يقيس...', fetchReply: true }).catch(() => null);
    const roundtrip = sent ? sent.createdTimestamp - interaction.createdTimestamp : 0;

    const embed = embeds.info('🏓 بونج!', 'إحصائيات الاتصال الحالية:', {
      fields: [
        { name: 'زمن الاستجابة', value: `\`${roundtrip}ms\``, inline: true },
        { name: 'زمن البوابة (WebSocket)', value: `\`${Math.round(client.ws.ping)}ms\``, inline: true },
        { name: 'مدة التشغيل', value: formatDuration(Date.now() - client.startedAt, lang), inline: true },
        { name: 'استهلاك الذاكرة', value: `\`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB\``, inline: true },
        { name: 'السيرفرات', value: `\`${client.guilds.cache.size}\``, inline: true },
        { name: 'الأخطاء المسجلة', value: `\`${client.errorCount}\``, inline: true },
      ],
    });

    await interaction.editReply({ content: null, embeds: [embed] }).catch(() => {});
  },
};
