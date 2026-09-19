'use strict';

const { SlashCommandBuilder, SlashCommandSubcommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const leveling = require('../../systems/leveling');
const { humanize } = require('../../lib/utils');
const periods = require('../../lib/periods');

module.exports = {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('leveling')
      .setDescription('نظام الخبرة والمستويات: كتابي · صوتي · تفاعل — توب داي وتوب ويك');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(
      sub('rank', 'عرض رتبتك أو رتبة عضو').addUserOption((o) =>
        o.setName('العضو').setDescription('العضو').setRequired(false)),
    );

    builder.addSubcommand(
      sub('leaderboard', 'لوحة المتصدرين: توب داي · توب ويك · كل الأوقات')
        .addStringOption((o) =>
          o
            .setName('الفترة')
            .setDescription('المدة')
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
        .addIntegerOption((o) =>
          o.setName('الصفحة').setDescription('رقم الصفحة').setMinValue(1).setRequired(false)),
    );

    builder.addSubcommand(sub('sources', 'ملخص مصادر الخبرة: كتابي · صوتي · تفاعل'));

    builder.addSubcommand(
      sub('enable', 'تفعيل نظام المستويات (يحتاج صلاحية الإدارة)').addChannelOption((o) =>
        o.setName('قناة_الإعلان').setDescription('قناة إعلانات الترقية').addChannelTypes(ChannelType.GuildText).setRequired(false)),
    );

    builder.addSubcommand(sub('disable', 'تعطيل نظام المستويات'));

    builder.addSubcommand(
      sub('config', 'ضبط الخبرة: أحرف الرسالة · الفاصل الصوتي · مكافحة السبام')
        .addIntegerOption((o) => o.setName('خبرة_كتابية_لكل_أحرف').setDescription('كل كم حرف يأخذ العضو خبرة واحدة (الافتراضي 5)').setMinValue(1).setMaxValue(200))
        .addIntegerOption((o) => o.setName('سقف_الرسالة').setDescription('أقصى خبرة من الرسالة الواحدة').setMinValue(1).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('الفاصل_الصوتي').setDescription('كل كم ثانية يأخذ خبرة صوتية (الافتراضي 60)').setMinValue(30).setMaxValue(3600))
        .addIntegerOption((o) => o.setName('خبرة_كل_فاصل_صوتي').setDescription('كم خبرة في كل فاصل صوتي (الافتراضي 1)').setMinValue(1).setMaxValue(100))
        .addBooleanOption((o) => o.setName('خبرة_كتابية').setDescription('منح خبرة على الرسائل في الشات'))
        .addBooleanOption((o) => o.setName('خبرة_صوتية').setDescription('منح خبرة على البقاء في القنوات الصوتية'))
        .addBooleanOption((o) => o.setName('خبرة_تفاعل').setDescription('منح خبرة عند التفاعل مع رسائل الأعضاء'))
        .addIntegerOption((o) => o.setName('سقف_التفاعل_اليومي').setDescription('أقصى خبرة تفاعل في اليوم للعضو').setMinValue(0).setMaxValue(1000))
        .addBooleanOption((o) => o.setName('مكافحة_السبام').setDescription('إيقاف خبرة من يكرّر الكلام أو يسبام'))
        .addIntegerOption((o) => o.setName('مدة_منع_السبام').setDescription('كم دقيقة تُوقف خبرة المسبام (الافتراضي 5)').setMinValue(1).setMaxValue(120))
        .addIntegerOption((o) => o.setName('حد_التكرار').setDescription('كم مرة يتكرر نفس الكلام قبل اعتباره سبام (الافتراضي 3)').setMinValue(2).setMaxValue(20)),
    );

    builder.addSubcommand(
      sub('reward', 'إدارة مكافآت الرتب عند الوصول لمستوى معيّن')
        .addStringOption((o) =>
          o
            .setName('عملية')
            .setDescription('إضافة أو حذف')
            .setRequired(true)
            .addChoices({ name: 'إضافة', value: 'add' }, { name: 'حذف', value: 'remove' }))
        .addIntegerOption((o) => o.setName('المستوى').setDescription('المستوى المطلوب').setRequired(true).setMinValue(1).setMaxValue(500))
        .addRoleOption((o) => o.setName('الرتبة').setDescription('الرتبة الممنوحة').setRequired(false)),
    );

    builder.addSubcommand(sub('rewards', 'عرض كل مكافآت الرتب'));

    builder.addSubcommand(
      sub('reset', 'تصفير خبرة عضو (يحتاج إدارة)').addUserOption((o) =>
        o.setName('العضو').setDescription('العضو').setRequired(true)),
    );

    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();

    /* --------------------------- الترتيب --------------------------- */
    if (sub === 'rank') {
      const user = interaction.options.getUser('العضو') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [embeds.error('خطأ', 'ما قدرت ألاقي العضو.')], flags: 64 });
      return interaction.reply({ embeds: [leveling.rankEmbed(member, lang)] });
    }

    /* ----------------------- لوحة المتصدرين ----------------------- */
    if (sub === 'leaderboard') {
      const page = interaction.options.getInteger('الصفحة') || 1;
      const period = interaction.options.getString('الفترة') || 'day';
      const source = interaction.options.getString('النوع') || 'all';
      const board = leveling.getBoard(interaction.guildId, { period, source, page, perPage: 10 });
      return interaction.reply({
        embeds: [leveling.leaderboardEmbed(interaction.guildId, { period, source, page, perPage: 10 }, lang)],
        flags: board.rows.length ? undefined : 64,
      });
    }

    if (sub === 'sources') {
      return interaction.reply({ embeds: [leveling.sourcesEmbed(interaction.guildId, lang)], flags: 64 });
    }

    /* ---------------------------- التفعيل ---------------------------- */
    if (sub === 'enable' || sub === 'disable') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [embeds.error('صلاحيات', 'تحتاج صلاحية "إدارة السيرفر".')], flags: 64 });
      }
      const enabled = sub === 'enable';
      const channel = interaction.options.getChannel('قناة_الإعلان');
      db.updateGuildSettings(interaction.guildId, {
        leveling: { enabled, ...(channel ? { announceChannelId: channel.id } : {}) },
      });
      return interaction.reply({
        embeds: [
          embeds.success(
            'نظام المستويات',
            enabled
              ? `تم التفعيل. الخبرة تُمنح على: الرسائل (كتابي) · الرومات الصوتية (صوتي) · التفاعلات (تفاعل)${channel ? ` — وإعلان الترقيات في ${channel}` : ''}.`
              : 'تم تعطيل نظام المستويات.',
          ),
        ],
        flags: 64,
      });
    }

    /* ---------------------------- الضبط ---------------------------- */
    if (sub === 'config') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [embeds.error('صلاحيات', 'تحتاج صلاحية "إدارة السيرفر".')], flags: 64 });
      }
      const patch = {};
      const perChars = interaction.options.getInteger('خبرة_كتابية_لكل_أحرف');
      const msgCap = interaction.options.getInteger('سقف_الرسالة');
      const voiceInterval = interaction.options.getInteger('الفاصل_الصوتي');
      const voiceAmount = interaction.options.getInteger('خبرة_كل_فاصل_صوتي');
      const text = interaction.options.getBoolean('خبرة_كتابية');
      const voice = interaction.options.getBoolean('خبرة_صوتية');
      const interact = interaction.options.getBoolean('خبرة_تفاعل');
      const cap = interaction.options.getInteger('سقف_التفاعل_اليومي');
      const anti = interaction.options.getBoolean('مكافحة_السبام');
      const antiMinutes = interaction.options.getInteger('مدة_منع_السبام');
      const antiRepeats = interaction.options.getInteger('حد_التكرار');
      if (perChars) patch.textXpPerChars = perChars;
      if (msgCap) patch.maxTextXpPerMessage = msgCap;
      if (voiceInterval) patch.voiceIntervalSeconds = voiceInterval;
      if (voiceAmount) patch.voiceXpPerInterval = voiceAmount;
      if (text !== null) patch.textXp = text;
      if (voice !== null) patch.voiceXp = voice;
      if (interact !== null) patch.interactXp = interact;
      if (cap !== null) patch.interactDailyCap = cap;
      if (anti !== null || antiMinutes || antiRepeats) {
        patch.antiSpam = {
          ...(anti !== null ? { enabled: anti } : {}),
          ...(antiMinutes ? { muteMinutes: antiMinutes } : {}),
          ...(antiRepeats ? { repeatLimit: antiRepeats } : {}),
        };
      }

      db.updateGuildSettings(interaction.guildId, { leveling: { ...patch, enabled: true } });
      const cfg = db.getGuildSettings(interaction.guildId).leveling;
      return interaction.reply({
        embeds: [
          embeds.success('ضبط المستويات', undefined, {
            fields: [
              {
                name: 'الخبرة الكتابية',
                value: `كل ${cfg.textXpPerChars ?? 5} أحرف = ${cfg.textXpPerCharsAmount ?? 1} خبرة · سقف الرسالة ${cfg.maxTextXpPerMessage ?? 100}`,
                inline: true,
              },
              {
                name: 'الخبرة الصوتية',
                value: `كل ${cfg.voiceIntervalSeconds ?? 60} ثانية = ${cfg.voiceXpPerInterval ?? 1} خبرة`,
                inline: true,
              },
              { name: 'مصادر الخبرة', value: `كتابي ${cfg.textXp === false ? '✗' : '✓'} · صوتي ${cfg.voiceXp ? '✓' : '✗'} · تفاعل ${cfg.interactXp === false ? '✗' : '✓'}`, inline: false },
              {
                name: 'مكافحة السبام',
                value:
                  cfg.antiSpam?.enabled === false
                    ? 'معطّلة'
                    : `مفعّلة — تكرار ${cfg.antiSpam?.repeatLimit ?? 3} مرات أو ${cfg.antiSpam?.rateMessages ?? 8} رسائل في ${cfg.antiSpam?.rateSeconds ?? 10} ثانية = إيقاف الخبرة ${cfg.antiSpam?.muteMinutes ?? 5} دقايق`,
                inline: false,
              },
              { name: 'سقف التفاعل اليومي', value: `${cfg.interactDailyCap ?? 60} XP`, inline: true },
              { name: 'تجديد توب داي/توب ويك', value: `${cfg.resetOffsetHours || 0}+ UTC`, inline: true },
            ],
          }),
        ],
        flags: 64,
      });
    }

    /* --------------------------- المكافآت --------------------------- */
    if (sub === 'reward') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [embeds.error('صلاحيات', 'تحتاج صلاحية "إدارة السيرفر".')], flags: 64 });
      }
      const op = interaction.options.getString('عملية');
      const level = interaction.options.getInteger('المستوى');
      const role = interaction.options.getRole('الرتبة');
      const cfg = db.getGuildSettings(interaction.guildId).leveling;
      let rewards = (cfg.rewards || []).filter((r) => Number(r.level) !== level);

      if (op === 'add') {
        if (!role) return interaction.reply({ embeds: [embeds.error('خطأ', 'حدّد الرتبة للإضافة.')], flags: 64 });
        if (role.position >= interaction.guild.members.me.roles.highest.position) {
          return interaction.reply({ embeds: [embeds.error('رتبة أعلى مني', 'هذه الرتبة أعلى من رتبة البوت، ما أقدر أمنحها.')], flags: 64 });
        }
        rewards.push({ level, roleId: role.id });
      }

      rewards = rewards.sort((a, b) => a.level - b.level);
      db.updateGuildSettings(interaction.guildId, { leveling: { rewards, enabled: true } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'مكافآت المستويات',
            rewards.length ? rewards.map((r) => `• المستوى **${r.level}** ➜ <@&${r.roleId}>`).join('\n') : 'لا توجد مكافآت.',
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'rewards') {
      const rewards = db.getGuildSettings(interaction.guildId).leveling.rewards || [];
      return interaction.reply({
        embeds: [embeds.info('🎁 مكافآت الرتب', rewards.length ? rewards.map((r) => `• المستوى **${r.level}** ➜ <@&${r.roleId}>`).join('\n') : 'لا توجد مكافآت بعد.')],
        flags: 64,
      });
    }

    /* ---------------------------- التصفير ---------------------------- */
    if (sub === 'reset') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [embeds.error('صلاحيات', 'تحتاج صلاحية المسؤول.')], flags: 64 });
      }
      const user = interaction.options.getUser('العضو');
      if (typeof db.resetLevel === 'function') db.resetLevel(interaction.guildId, user.id);
      else db.upsertLevel(interaction.guildId, user.id, { xp: 0, level: 0, messages: 0, voiceMinutes: 0, lastXpAt: 0 });
      return interaction.reply({ embeds: [embeds.success('تصفير', `تم تصفير خبرة ${user} (المستويات + توب داي + توب ويك).`)] });
    }
  },
};
