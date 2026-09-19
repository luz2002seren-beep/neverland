'use strict';

const { SlashCommandBuilder, SlashCommandSubcommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const welcomeSystem = require('../../systems/welcome');
const welcomeCard = require('../../lib/welcomeCard');
const { applyPlaceholders } = require('../../lib/utils');

const PLACEHOLDERS =
  '**المتغيّرات:** `{user}` منشن • `{username}` الاسم • `{displayName}` الاسم الظاهر • `{server}` السيرفر • `{memberCount}` عدد الأعضاء • `{avatar}` رابط الصورة • `{createdAt}` • `{joinedAt}`';

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('إعداد رسائل الترحيب والوداع والدعم + صورة الترحيب');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(
      sub('channel', 'تحديد قناة الترحيب').addChannelOption((o) =>
        o.setName('القناة').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    );

    builder.addSubcommand(
      sub('message', 'تعديل نص رسالة الترحيب')
        .addStringOption((o) => o.setName('النص').setDescription('نص الرسالة مع المتغيّرات').setRequired(true).setMaxLength(1500))
        .addBooleanOption((o) => o.setName('embed').setDescription('إرسالها كـ embed أنيق؟').setRequired(false)),
    );

    builder.addSubcommand(
      sub('image', 'صورة الترحيب: بطاقة بالأفتار / أفتار / صورة مخصّصة / بدون')
        .addStringOption((o) =>
          o
            .setName('النوع')
            .setDescription('نوع الصورة')
            .setRequired(true)
            .addChoices(
              { name: '🖼️ بطاقة مولَّدة بالأفتار (Card)', value: 'card' },
              { name: '👤 صورة الأفتار فقط', value: 'avatar' },
              { name: '🔗 رابط صورة مخصّصة', value: 'custom' },
              { name: '🚫 بدون صورة', value: 'none' },
            ))
        .addStringOption((o) => o.setName('الرابط').setDescription('رابط الصورة (عند اختيار صورة مخصّصة)').setRequired(false))
        .addStringOption((o) => o.setName('خلفية').setDescription('رابط خلفية للبطاقة (اختياري)').setRequired(false))
        .addBooleanOption((o) => o.setName('صورة_مرفقة').setDescription('إرسال الصورة كمرفق (أفضل جودة)').setRequired(false)),
    );

    builder.addSubcommand(
      sub('cardtext', 'النص الذي يُرسم على صورة الترحيب')
        .addStringOption((o) =>
          o.setName('النص').setDescription('مثال: أهلاً بك {displayName} في {server}').setRequired(true).setMaxLength(120)),
    );

    builder.addSubcommand(
      sub('plain', 'شكل رسالة الترحيب: صورة + رسالة عادية (بدون إطار) أو داخل Embed').addBooleanOption((o) =>
        o.setName('مفعل').setDescription('نعم = صورة + رسالة عادية بلا إطار (الطريقة الاحترافية)').setRequired(true)),
    );

    builder.addSubcommand(sub('enable', 'تفعيل الترحيب'));
    builder.addSubcommand(sub('disable', 'تعطيل الترحيب'));

    builder.addSubcommand(
      sub('dm', 'تفعيل/تعطيل رسالة ترحيب في الخاص').addBooleanOption((o) =>
        o.setName('الحالة').setDescription('تفعيل؟').setRequired(true)),
    );

    builder.addSubcommand(
      sub('test', 'إرسال ترحيب تجريبي (مع الصورة) لتراه بنفسك').addUserOption((o) =>
        o.setName('العضو').setDescription('العضو التجريبي').setRequired(false)),
    );

    builder.addSubcommand(
      sub('leave', 'إعداد رسالة الوداع')
        .addChannelOption((o) => o.setName('القناة').setDescription('قناة الوداع').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption((o) => o.setName('النص').setDescription('نص رسالة الوداع').setRequired(false)),
    );

    builder.addSubcommand(
      sub('boost', 'إعداد رسالة شكر الدعم (Boost)')
        .addChannelOption((o) => o.setName('القناة').setDescription('قناة الدعم').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption((o) => o.setName('النص').setDescription('نص الرسالة').setRequired(false)),
    );

    builder.addSubcommand(sub('status', 'عرض إعدادات الترحيب الحالية'));
    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('القناة');
      db.updateGuildSettings(interaction.guildId, { welcome: { enabled: true, channelId: channel.id } });
      return interaction.reply({
        embeds: [embeds.success('قناة الترحيب', `✅ تم ضبط الترحيب على ${channel} وتفعيله.\n\n${PLACEHOLDERS}`)],
        flags: 64,
      });
    }

    if (sub === 'message') {
      const text = interaction.options.getString('النص');
      const embed = interaction.options.getBoolean('embed');
      db.updateGuildSettings(interaction.guildId, { welcome: { message: text, ...(embed === null ? {} : { embed }) } });
      const preview = applyPlaceholders(text, { user: interaction.user, member: interaction.member, guild: interaction.guild });
      return interaction.reply({
        embeds: [embeds.success('رسالة الترحيب', `✅ تم الحفظ.\n\n**معاينة:**\n${preview}`, { footer: 'المتغيّرات: {user} {username} {server} {memberCount} {avatar}' })],
        flags: 64,
      });
    }

    if (sub === 'image') {
      const mode = interaction.options.getString('النوع');
      const url = interaction.options.getString('الرابط');
      const background = interaction.options.getString('خلفية');
      const attach = interaction.options.getBoolean('صورة_مرفقة');

      if (mode === 'custom' && !url) {
        return interaction.reply({ embeds: [embeds.error('ناقص', 'حدّد رابط الصورة مع النوع "صورة مخصّصة".')], flags: 64 });
      }

      db.updateGuildSettings(interaction.guildId, {
        welcome: {
          imageMode: mode,
          ...(url ? { imageUrl: url } : {}),
          ...(background ? { cardBackground: background } : {}),
          ...(attach === null ? {} : { attachImage: attach }),
        },
      });

      // معاينة مباشرة للبطاقة
      if (mode === 'card' && welcomeCard.available()) {
        await interaction.deferReply({ flags: 64 });
        const buffer = await welcomeSystem.previewCard(client, interaction.member);
        if (buffer) {
          return interaction.editReply({
            embeds: [embeds.success('صورة الترحيب', '✅ تم ضبط النوع على **بطاقة مولَّدة بالأفتار**. هذه معاينة:')],
            files: [new AttachmentBuilder(buffer, { name: 'preview.png' })],
          });
        }
      }

      return interaction.reply({
        embeds: [
          embeds.success('صورة الترحيب', undefined, {
            fields: [
              { name: 'النوع', value: mode, inline: true },
              { name: 'الصورة المخصّصة', value: url || '—', inline: false },
              { name: 'الخلفية', value: background || 'افتراضية', inline: true },
            ],
          }),
        ],
        flags: 64,
      });
    }

    if (sub === 'cardtext') {
      const text = interaction.options.getString('النص');
      db.updateGuildSettings(interaction.guildId, { welcome: { cardMessage: text } });
      const preview = applyPlaceholders(text, { user: interaction.user, member: interaction.member, guild: interaction.guild });
      return interaction.reply({
        embeds: [
          embeds.success('النص على صورة الترحيب', `✅ صار يُرسم على البطاقة:\n**${preview}**`, {
            footer: 'المتغيّرات: {displayName} {username} {server} {memberCount}',
          }),
        ],
        flags: 64,
      });
    }

    if (sub === 'plain') {
      const plain = interaction.options.getBoolean('مفعل');
      db.updateGuildSettings(interaction.guildId, { welcome: { embed: !plain } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'شكل رسالة الترحيب',
            plain
              ? '✅ صار الترحيب: **صورة بالأفتار + رسالة عادية** بدون إطار (نفس طريقة بوتات الترحيب المعروفة).'
              : '✅ صار الترحيب يظهر **داخل إطار Embed** أنيق.',
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'enable' || sub === 'disable') {
      db.updateGuildSettings(interaction.guildId, { welcome: { enabled: sub === 'enable' } });
      return interaction.reply({
        embeds: [embeds.success('الترحيب', sub === 'enable' ? '✅ تم تفعيل الترحيب.' : '🔴 تم تعطيل الترحيب.')],
        flags: 64,
      });
    }

    if (sub === 'dm') {
      const value = interaction.options.getBoolean('الحالة');
      db.updateGuildSettings(interaction.guildId, { welcome: { dm: value } });
      return interaction.reply({
        embeds: [embeds.success('الترحيب الخاص', value ? '✅ سأرسل رسالة ترحيب في الخاص.' : '🔴 تم تعطيل الترحيب في الخاص.')],
        flags: 64,
      });
    }

    if (sub === 'test') {
      await interaction.deferReply({ flags: 64 });
      const member = interaction.options.getMember('العضو') || interaction.member;
      const settings = db.getGuildSettings(interaction.guildId);
      const text = applyPlaceholders(settings.welcome.message, { user: member.user, member, guild: interaction.guild });
      const channel = settings.welcome.channelId ? interaction.guild.channels.cache.get(settings.welcome.channelId) : interaction.channel;
      if (!channel) return interaction.editReply({ embeds: [embeds.error('لا توجد قناة', 'حدّد قناة الترحيب أولًا: `/welcome channel`')] });

      const { files, imageRef } = await welcomeSystem.buildWelcomeImage(client, member, settings);
      await channel.send({
        embeds: [
          embeds.base({
            color: 0x57f287,
            title: `👋 (تجربة) أهلاً بك في ${interaction.guild.name}`,
            description: text,
            thumbnail: member.user.displayAvatarURL({ size: 256 }),
            image: imageRef,
          }),
        ],
        files,
      });

      return interaction.editReply({ embeds: [embeds.success('تجربة', `✅ أرسلت ترحيبًا تجريبيًا في ${channel}.`)] });
    }

    if (sub === 'leave') {
      const channel = interaction.options.getChannel('القناة');
      const text = interaction.options.getString('النص');
      db.updateGuildSettings(interaction.guildId, { leave: { enabled: true, channelId: channel.id, ...(text ? { message: text } : {}) } });
      return interaction.reply({ embeds: [embeds.success('رسالة الوداع', `✅ تم ضبطها على ${channel}.\n\n${PLACEHOLDERS}`)], flags: 64 });
    }

    if (sub === 'boost') {
      const channel = interaction.options.getChannel('القناة');
      const text = interaction.options.getString('النص');
      db.updateGuildSettings(interaction.guildId, { boost: { enabled: true, channelId: channel.id, ...(text ? { message: text } : {}) } });
      return interaction.reply({ embeds: [embeds.success('رسالة الدعم', `✅ تم ضبطها على ${channel}.`)], flags: 64 });
    }

    if (sub === 'status') {
      const cfg = db.getGuildSettings(interaction.guildId).welcome;
      const onOff = (v) => (v ? '🟢' : '🔴');
      const modes = { card: 'بطاقة مولَّدة بالأفتار 🖼️', avatar: 'أفتار العضو 👤', custom: 'صورة مخصّصة 🔗', none: 'بدون 🚫' };
      return interaction.reply({
        embeds: [
          embeds.info('👋 إعدادات الترحيب', undefined, {
            fields: [
              { name: 'الحالة', value: onOff(cfg.enabled), inline: true },
              { name: 'القناة', value: cfg.channelId ? `<#${cfg.channelId}>` : 'غير محدّدة', inline: true },
              { name: 'ترحيب بالخاص', value: onOff(cfg.dm), inline: true },
              { name: 'صورة الترحيب', value: modes[cfg.imageMode] || cfg.imageMode, inline: true },
              { name: 'مولّد البطاقات', value: welcomeCard.available() ? '🟢 متاح' : '🔴 غير متاح (استخدم avatar)', inline: true },
              { name: 'النص', value: `\`\`\`${String(cfg.message).slice(0, 200)}\`\`\``, inline: false },
            ],
          }),
        ],
        flags: 64,
      });
    }
  },
};
