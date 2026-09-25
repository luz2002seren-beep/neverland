'use strict';

const { SlashCommandBuilder, ChannelType, GuildVerificationLevel, GuildExplicitContentFilter } = require('discord.js');
const embeds = require('../../lib/embeds');
const db = require('../../database');
const { humanize, formatDate } = require('../../lib/utils');

const VERIFICATION = {
  [GuildVerificationLevel.None]: 'لا يوجد',
  [GuildVerificationLevel.Low]: 'منخفض',
  [GuildVerificationLevel.Medium]: 'متوسط',
  [GuildVerificationLevel.High]: 'عالي',
  [GuildVerificationLevel.VeryHigh]: 'عالي جدًا',
};

module.exports = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('معلومات تفصيلية عن السيرفر'),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const guild = interaction.guild;
    await guild.fetch().catch(() => {});

    const owner = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const counts = {
      text: channels.filter((c) => c.type === ChannelType.GuildText).size,
      voice: channels.filter((c) => c.type === ChannelType.GuildVoice).size,
      category: channels.filter((c) => c.type === ChannelType.GuildCategory).size,
      threads: channels.filter((c) => c.isThread?.()).size,
    };

    const bots = guild.members.cache.filter((m) => m.user.bot).size;
    const settings = db.getGuildSettings(guild.id);
    const stats = db.getStats(guild.id);
    const onOff = (v) => (v ? '🟢' : '🔴');

    const embed = embeds.base({
      color: 0x5865f2,
      title: `🏰 ${guild.name}`,
      description: guild.description || undefined,
      thumbnail: guild.iconURL({ size: 256 }),
      image: guild.bannerURL({ size: 1024 }) || undefined,
      fields: [
        { name: 'المالك', value: owner ? `${owner.user}` : '—', inline: true },
        { name: 'الآيدي', value: `\`${guild.id}\``, inline: true },
        { name: 'أُنشئ', value: `${formatDate(guild.createdAt)}`, inline: true },
        { name: 'الأعضاء', value: `**${humanize(guild.memberCount)}** (بوتات: ${bots})`, inline: true },
        { name: 'القنوات', value: `💬 ${counts.text} • 🔊 ${counts.voice} • 📂 ${counts.category} • 🧵 ${counts.threads}`, inline: true },
        { name: 'الرتب', value: `\`${guild.roles.cache.size}\``, inline: true },
        { name: 'الإيموجيات', value: `\`${guild.emojis.cache.size}\``, inline: true },
        { name: 'مستوى الدعم', value: `المستوى ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} دعم)`, inline: true },
        { name: 'مستوى التحقق', value: VERIFICATION[guild.verificationLevel] ?? '—', inline: true },
        { name: 'اللغة', value: settings.language === 'ar' ? 'العربية 🇸🇦' : 'English 🇬🇧', inline: true },
        {
          name: 'خطة البوت',
          value: (() => {
            const view = require('../../lib/premium').publicView(guild.id);
            if (!view.active) return 'مجاني';
            return ['بريميوم', view.planLabel, view.untilLabel].filter(Boolean).join(' · ');
          })(),
          inline: true,
        },
        { name: 'فلتر المحتوى', value: guild.explicitContentFilter === GuildExplicitContentFilter.Disabled ? 'معطّل' : 'مفعّل', inline: true },
        {
          name: '📊 إحصائيات البوت هنا',
          value: [
            `عقوبات: **${stats.cases}** • تحذيرات: **${stats.warnings}**`,
            `حظر: **${stats.bans}** • طرد: **${stats.kicks}** • إسكاتات: **${stats.timeouts}**`,
            `تذاكر: **${stats.tickets}** (مفتوحة: ${stats.openTickets})`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '⚙️ الأنظمة',
          value: [
            `ترحيب ${onOff(settings.welcome.enabled)} • وداع ${onOff(settings.leave.enabled)} • لوقات ${onOff(settings.logs.enabled)}`,
            `حماية ${onOff(settings.automod.enabled)} • تذاكر ${onOff(settings.tickets.enabled)} • مستويات ${onOff(settings.leveling.enabled)}`,
          ].join('\n'),
          inline: false,
        },
      ],
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
