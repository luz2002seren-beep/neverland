'use strict';

const { SlashCommandBuilder, SlashCommandSubcommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');

const TOGGLES = {
  'anti-spam': { key: 'antiSpam', label: 'مضاد السبام' },
  'anti-link': { key: 'antiLink', label: 'مضاد الروابط' },
  'anti-invite': { key: 'antiInvite', label: 'مضاد دعوات السيرفرات' },
  'anti-everyone': { key: 'antiEveryone', label: 'مضاد منشن الجميع' },
  'anti-mention': { key: 'antiMentionSpam', label: 'مضاد المنشن الجماعي' },
  'anti-caps': { key: 'antiCaps', label: 'مضاد الحروف الكبيرة' },
};

const TOGGLE_CHOICES = Object.entries(TOGGLES).map(([value, def]) => ({ name: def.label, value }));

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('automod')
      .setDescription('إعداد الحماية التلقائية (مضاد السبام، الروابط، الكلمات الممنوعة...)');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(sub('enable', 'تفعيل الحماية التلقائية'));
    builder.addSubcommand(sub('disable', 'تعطيل الحماية التلقائية'));

    builder.addSubcommand(
      sub('toggle', 'تفعيل أو تعطيل حماية معيّنة').addStringOption((o) =>
        o.setName('الحماية').setDescription('نوع الحماية').setRequired(true).addChoices(...TOGGLE_CHOICES)),
    );

    builder.addSubcommand(
      sub('punishment', 'تحديد العقوبة عند رصد مخالفة').addStringOption((o) =>
        o
          .setName('العقوبة')
          .setDescription('العقوبة المطبّقة')
          .setRequired(true)
          .addChoices(
            { name: 'حذف الرسالة فقط', value: 'delete' },
            { name: 'تحذير', value: 'warn' },
            { name: 'إسكات مؤقت', value: 'timeout' },
            { name: 'طرد', value: 'kick' },
            { name: 'حظر', value: 'ban' },
          )),
    );

    builder.addSubcommand(
      sub('limits', 'ضبط حدود السبام')
        .addIntegerOption((o) =>
          o.setName('عدد_الرسائل').setDescription('عدد الرسائل المسموح به').setMinValue(2).setMaxValue(50))
        .addIntegerOption((o) =>
          o.setName('خلال_ثواني').setDescription('خلال كم ثانية').setMinValue(1).setMaxValue(60))
        .addIntegerOption((o) =>
          o.setName('مدة_الإسكات').setDescription('مدة الإسكات بالدقائق عند اختيار timeout').setMinValue(1).setMaxValue(10080)),
    );

    builder.addSubcommand(
      sub('word', 'إدارة الكلمات الممنوعة (إضافة/حذف)')
        .addStringOption((o) =>
          o
            .setName('عملية')
            .setDescription('إضافة أو حذف')
            .setRequired(true)
            .addChoices({ name: 'إضافة', value: 'add' }, { name: 'حذف', value: 'remove' }))
        .addStringOption((o) => o.setName('الكلمة').setDescription('الكلمة المطلوبة').setRequired(true)),
    );

    builder.addSubcommand(sub('words', 'عرض كل الكلمات الممنوعة'));

    builder.addSubcommand(
      sub('whitelist', 'استثناء قناة أو رتبة من الحماية')
        .addChannelOption((o) =>
          o.setName('القناة').setDescription('قناة مستثناة').addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName('الرتبة').setDescription('رتبة مستثناة')),
    );

    builder.addSubcommand(sub('status', 'عرض إعدادات الحماية الحالية'));
    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();
    const onOff = (v) => (v ? '🟢' : '🔴');

    if (sub === 'enable' || sub === 'disable') {
      db.updateGuildSettings(interaction.guildId, { automod: { enabled: sub === 'enable' } });
      return interaction.reply({
        embeds: [embeds.success('الحماية التلقائية', sub === 'enable' ? '✅ تم التفعيل.' : '🔴 تم التعطيل.')],
        flags: 64,
      });
    }

    if (sub === 'toggle') {
      const id = interaction.options.getString('الحماية');
      const { key, label } = TOGGLES[id];
      const current = db.getGuildSettings(interaction.guildId).automod;
      const next = !current[key];
      db.updateGuildSettings(interaction.guildId, { automod: { [key]: next } });
      return interaction.reply({
        embeds: [embeds.success('الحماية', `${next ? '🟢 تم تفعيل' : '🔴 تم تعطيل'} **${label}**.`)],
        flags: 64,
      });
    }

    if (sub === 'punishment') {
      const punishment = interaction.options.getString('العقوبة');
      db.updateGuildSettings(interaction.guildId, { automod: { punishment } });
      return interaction.reply({
        embeds: [
          embeds.success('العقوبة', `✅ العقوبة الحالية عند رصد مخالفة: **${punishment}**\n\n> تلميح: \`timeout\` و\`kick\` و\`ban\` تحتاج أن تكون رتبة البوت أعلى من العضو.`),
        ],
        flags: 64,
      });
    }

    if (sub === 'limits') {
      const messages = interaction.options.getInteger('عدد_الرسائل');
      const seconds = interaction.options.getInteger('خلال_ثواني');
      const timeoutMinutes = interaction.options.getInteger('مدة_الإسكات');
      const patch = {};
      if (messages) patch.spamMessages = messages;
      if (seconds) patch.spamIntervalSeconds = seconds;
      if (timeoutMinutes) patch.timeoutMinutes = timeoutMinutes;
      db.updateGuildSettings(interaction.guildId, { automod: patch });

      const am = db.getGuildSettings(interaction.guildId).automod;
      return interaction.reply({
        embeds: [
          embeds.success(
            'حدود الحماية',
            `✅ سيتم اعتبار الرسائل سبام إذا تجاوزت **${am.spamMessages}** رسائل خلال **${am.spamIntervalSeconds}** ثانية.\n**مدة الإسكات:** ${am.timeoutMinutes} دقيقة.`,
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'word') {
      const op = interaction.options.getString('عملية');
      const word = interaction.options.getString('الكلمة').trim();
      const am = db.getGuildSettings(interaction.guildId).automod;
      const words = new Set(am.bannedWords || []);

      if (op === 'add') words.add(word);
      else words.delete(word);

      db.updateGuildSettings(interaction.guildId, { automod: { bannedWords: [...words], enabled: true } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'الكلمات الممنوعة',
            op === 'add' ? `✅ تمت إضافة \`${word}\` (${words.size} كلمة).` : `✅ تم حذف \`${word}\` (${words.size} كلمة).`,
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'words') {
      const words = db.getGuildSettings(interaction.guildId).automod.bannedWords || [];
      return interaction.reply({
        embeds: [
          embeds.info('🚫 الكلمات الممنوعة', words.length ? words.map((w) => `\`${w}\``).join(' • ').slice(0, 3000) : 'لا توجد كلمات مسجّلة بعد. أضف بـ `/automod word`.'),
        ],
        flags: 64,
      });
    }

    if (sub === 'whitelist') {
      const channel = interaction.options.getChannel('القناة');
      const role = interaction.options.getRole('الرتبة');
      const am = db.getGuildSettings(interaction.guildId).automod;
      const patch = {};

      if (channel) {
        const list = am.whitelistChannels || [];
        patch.whitelistChannels = list.includes(channel.id) ? list.filter((c) => c !== channel.id) : [...list, channel.id];
      }
      if (role) {
        const list = am.whitelistRoles || [];
        patch.whitelistRoles = list.includes(role.id) ? list.filter((r) => r !== role.id) : [...list, role.id];
      }
      if (!channel && !role) {
        return interaction.reply({ embeds: [embeds.error('حدّد عنصرًا', 'اختر قناة أو رتبة.')], flags: 64 });
      }

      db.updateGuildSettings(interaction.guildId, { automod: patch });
      const updated = db.getGuildSettings(interaction.guildId).automod;
      return interaction.reply({
        embeds: [
          embeds.success(
            'الاستثناءات',
            [
              `**قنوات مستثناة:** ${(updated.whitelistChannels || []).map((c) => `<#${c}>`).join(' ') || 'لا يوجد'}`,
              `**رتب مستثناة:** ${(updated.whitelistRoles || []).map((r) => `<@&${r}>`).join(' ') || 'لا يوجد'}`,
            ].join('\n'),
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'status') {
      const am = db.getGuildSettings(interaction.guildId).automod;
      return interaction.reply({
        embeds: [
          embeds.info('🛡️ حالة الحماية التلقائية', undefined, {
            fields: [
              { name: 'الحالة العامة', value: am.enabled ? '🟢 مُفعّل' : '🔴 مُعطّل', inline: true },
              { name: 'العقوبة', value: `\`${am.punishment}\``, inline: true },
              { name: 'الحد', value: `${am.spamMessages} رسالة / ${am.spamIntervalSeconds} ث`, inline: true },
              { name: 'مضاد السبام', value: onOff(am.antiSpam), inline: true },
              { name: 'مضاد الروابط', value: onOff(am.antiLink), inline: true },
              { name: 'مضاد الدعوات', value: onOff(am.antiInvite), inline: true },
              { name: 'مضاد منشن الجميع', value: onOff(am.antiEveryone), inline: true },
              { name: 'مضاد المنشن الجماعي', value: onOff(am.antiMentionSpam), inline: true },
              { name: 'مضاد الحروف الكبيرة', value: onOff(am.antiCaps), inline: true },
              { name: 'الكلمات الممنوعة', value: `${(am.bannedWords || []).length} كلمة`, inline: true },
              { name: 'قنوات مستثناة', value: `${(am.whitelistChannels || []).length}`, inline: true },
              { name: 'رتب مستثناة', value: `${(am.whitelistRoles || []).length}`, inline: true },
            ],
          }),
        ],
        flags: 64,
      });
    }
  },
};
