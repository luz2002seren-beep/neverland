'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const config = require('../../config');
const { t } = require('../../lib/i18n');

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('إعدادات البوت العامة: عرض الحالة، اللغة، لوحة التحكم، إعادة الضبط')
    .addSubcommand((sub) => sub.setName('status').setDescription('عرض كل إعدادات البوت في هذا السيرفر'))
    .addSubcommand((sub) =>
      sub
        .setName('language')
        .setDescription('تغيير لغة ردود البوت')
        .addStringOption((o) =>
          o
            .setName('اللغة')
            .setDescription('اختر اللغة')
            .setRequired(true)
            .addChoices({ name: 'العربية', value: 'ar' }, { name: 'English', value: 'en' })),
    )
    .addSubcommand((sub) => sub.setName('dashboard').setDescription('رابط لوحة التحكم وطريقة الدخول'))
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('إعادة كل إعدادات البوت في السيرفر إلى الافتراضي')
        .addBooleanOption((o) => o.setName('تأكيد').setDescription('اكتب نعم للتأكيد').setRequired(true)),
    ),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();

    /* --------------------------- الحالة --------------------------- */
    if (sub === 'status') {
      const settings = db.getGuildSettings(interaction.guildId);
      const stats = db.getStats(interaction.guildId);
      const onOff = (v) => (v ? '🟢 مُفعّل' : '🔴 مُعطّل');

      const embed = embeds.base({
        color: 0x5865f2,
        title: '⚙️ إعدادات Never Land في هذا السيرفر',
        fields: [
          { name: '🌐 اللغة', value: settings.language === 'ar' ? 'العربية' : 'English', inline: true },
          { name: '👋 الترحيب', value: `${onOff(settings.welcome.enabled)}\n${settings.welcome.channelId ? `<#${settings.welcome.channelId}>` : 'بدون قناة'}`, inline: true },
          { name: '👋 الوداع', value: `${onOff(settings.leave.enabled)}\n${settings.leave.channelId ? `<#${settings.leave.channelId}>` : 'بدون قناة'}`, inline: true },
          { name: '📜 اللوقات', value: `${onOff(settings.logs.enabled)}\n${settings.logs.channelId ? `<#${settings.logs.channelId}>` : 'بدون قناة'}`, inline: true },
          {
            name: '🛡️ الحماية التلقائية',
            value: `${onOff(settings.automod.enabled)}\nسبام: ${settings.automod.antiSpam ? '✅' : '❌'} • روابط: ${settings.automod.antiLink ? '✅' : '❌'} • دعوات: ${settings.automod.antiInvite ? '✅' : '❌'}\nالعقوبة: \`${settings.automod.punishment}\``,
            inline: true,
          },
          { name: '🎫 التذاكر', value: `${onOff(settings.tickets.enabled)}\n${settings.tickets.categoryId ? `<#${settings.tickets.categoryId}>` : 'بدون قسم'}`, inline: true },
          { name: '📈 المستويات', value: `${onOff(settings.leveling.enabled)}\nكل ${settings.leveling.textXpPerChars ?? 5} أحرف = 1 خبرة`, inline: true },
          { name: '🎭 الرتب التلقائية', value: `${onOff(settings.autorole.enabled)}\n${(settings.autorole.roleIds || []).length} رتبة`, inline: true },
          { name: '🚀 الدعم', value: onOff(settings.boost.enabled), inline: true },
          {
            name: '📊 إحصائيات',
            value: `حالات: **${stats.cases}** • تذاكر: **${stats.tickets}** • أعضاء مسجّلون: **${stats.trackedMembers}**`,
            inline: false,
          },
        ],
              });

      /* بلا زر رابط: رابط الموقع يطلع بكلمة «نيفر» في الشات */
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    /* --------------------------- اللغة --------------------------- */
    if (sub === 'language') {
      const value = interaction.options.getString('اللغة');
      db.updateGuildSettings(interaction.guildId, { language: value });
      return interaction.reply({
        embeds: [
          embeds.success(
            'اللغة',
            value === 'ar' ? '✅ تم ضبط لغة البوت على **العربية**.' : '✅ Bot language set to **English**.',
          ),
        ],
        flags: 64,
      });
    }

    /* ------------------------ لوحة التحكم ------------------------ */
    if (sub === 'dashboard') {
      return interaction.reply({
        embeds: [
          embeds.info('🌐 لوحة التحكم', [
            'رابط الموقع ما يظهر في الردود — اكتب كلمة **نيفر** في الشات ويظهر لأعضاء الموقع المسجّلين.',
            '',
            '**كيف أدخل؟**',
            '1️⃣ افتح الرابط في المتصفح.',
            '2️⃣ اضغط "تسجيل الدخول بـ Discord".',
            '3️⃣ اختر السيرفر الذي تريد إدارته (تحتاج صلاحية "إدارة السيرفر").',
            '4️⃣ عدّل كل الإعدادات واضغط حفظ — التغييرات تُطبَّق فورًا.',
            '',
            '**ما يمكنك فعله من اللوحة؟**',
            '• الترحيب والوداع • اللوقات • الحماية التلقائية',
            '• التذاكر • المستويات والمكافآت • الرتب التلقائية',
            '• عرض الحالات والتذاكر والإحصائيات',
          ].join('\n')),
        ],
        flags: 64,
      });
    }

    /* --------------------------- إعادة الضبط --------------------------- */
    if (sub === 'reset') {
      const confirm = interaction.options.getBoolean('تأكيد');
      if (!confirm) {
        return interaction.reply({ content: '❌ تم الإلغاء (لم تؤكّد).', flags: 64 });
      }
      db.deleteGuild(interaction.guildId);
      db.getGuild(interaction.guildId);
      return interaction.reply({
        embeds: [embeds.success('إعادة الضبط', '✅ تمت إعادة كل الإعدادات إلى القيم الافتراضية.')],
        flags: 64,
      });
    }
  },
};
