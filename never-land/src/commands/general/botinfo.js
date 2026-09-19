'use strict';

const { SlashCommandBuilder, version: djsVersion } = require('discord.js');
const embeds = require('../../lib/embeds');
const db = require('../../database');
const { formatDuration, humanize } = require('../../lib/utils');
const config = require('../../config');

module.exports = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('معلومات عن البوت وإحصائياته'),

  async run(client, interaction, lang) {
    const totalMembers = client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0);
    const uptime = formatDuration(Date.now() - client.startedAt, lang);

    const embed = embeds.base({
      color: 0x5865f2,
      title: '🤖 Never Land — بوت إدارة متكامل',
      description: [
        'بوت إدارة سيرفرات احترافي: حماية تلقائية، لوقات، تذاكر، مستويات، ترحيب، ولوحة تحكم ويب كاملة.',
        '',
        '**لماذا Never Land؟**',
        '✅ واجهة عربية بالكامل مع دعم الإنجليزية',
        '✅ لوحة تحكم ويب (تسجيل دخول ديسكورد + تعديل فوري)',
        '✅ حماية تلقائية متقدّمة ضد السبام والهجمات',
        '✅ كل الميزات مجانًا بدون Premium',
      ].join('\n'),
      thumbnail: client.user.displayAvatarURL({ size: 512 }),
      fields: [
        { name: 'السيرفرات', value: `\`${humanize(client.guilds.cache.size)}\``, inline: true },
        { name: 'المستخدمون', value: `\`${humanize(totalMembers)}\``, inline: true },
        { name: 'الأوامر', value: `\`${client.commands.size}\``, inline: true },
        { name: 'مدة التشغيل', value: uptime, inline: true },
        { name: 'discord.js', value: `\`v${djsVersion}\``, inline: true },
        { name: 'Node.js', value: `\`${process.version}\``, inline: true },
        { name: 'قاعدة البيانات', value: `\`${db.driverName}\``, inline: true },
        { name: 'الرتبة العليا', value: `\`${interaction.guild?.members.me?.roles.highest.name ?? '—'}\``, inline: true },
        { name: 'لوحة التحكم', value: 'اكتب **نيفر** في الشات — لأعضاء الموقع المسجّلين', inline: false },
      ],
      footer: 'بُني بـ discord.js v14',
    });

    await interaction.reply({ embeds: [embed] });
  },
};
