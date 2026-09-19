'use strict';

const { SlashCommandBuilder, SlashCommandSubcommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const autoline = require('../../systems/autoline');
const { stripCustomEmojis } = require('../../lib/emojis');

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('autoline')
      .setDescription('الخط الفاصل التلقائي: يرسل خطًا بعد كل رسالة في قنوات محدّدة');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(sub('enable', 'تفعيل الخط الفاصل التلقائي'));
    builder.addSubcommand(sub('disable', 'تعطيل الخط الفاصل التلقائي'));
    builder.addSubcommand(
      sub('add', 'إضافة قناة يعمل فيها الخط الفاصل').addChannelOption((o) =>
        o.setName('القناة').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    );
    builder.addSubcommand(
      sub('remove', 'إزالة قناة من الخط الفاصل').addChannelOption((o) =>
        o.setName('القناة').setDescription('القناة').setRequired(true)),
    );
    builder.addSubcommand(
      sub('style', 'شكل الخط المتحرك (GIF)').addStringOption((o) =>
        o.setName('النمط')
          .setDescription('اختر شكل الخط المتحرك')
          .setRequired(true)
          .addChoices(
            { name: 'توهّج — توهّج يمرّ على الخط', value: 'glow' },
            { name: 'تدفّق — تدرّج لوني متدفّق', value: 'flow' },
            { name: 'نبض — إضاءة تنبض بهدوء', value: 'pulse' },
            { name: 'شرطات — شرطات تتحرّك', value: 'dash' },
          )),
    );
    builder.addSubcommand(
      sub('type', 'نوع الخط: صورة GIF أو رابط خاص أو نص').addStringOption((o) =>
        o.setName('النوع')
          .setDescription('gif = صور جاهزة • custom = رابط صورتك • text = خط نصّي')
          .setRequired(true)
          .addChoices(
            { name: 'صورة GIF متحركة (جاهزة)', value: 'gif' },
            { name: 'رابط صورة/GIF خاص بي', value: 'custom' },
            { name: 'خط نصّي عادي', value: 'text' },
          )),
    );
    builder.addSubcommand(
      sub('url', 'رابط صورة/GIF خاص يُستخدم كخط فاصل').addStringOption((o) =>
        o.setName('الرابط').setDescription('رابط مباشر ينتهي بـ .gif أو .png أو .webp').setRequired(true)),
    );
    builder.addSubcommand(
      sub('line', 'نص الخط — يُستخدم عند اختيار النوع text').addStringOption((o) =>
        o.setName('النص').setDescription('نص الخط (يدعم إيموجيات خارجية)').setRequired(true).setMaxLength(120)),
    );
    builder.addSubcommand(
      sub('color', 'تلوين الخط (ليس له تأثير إلا في الـ embed)').addStringOption((o) =>
        o.setName('اللون').setDescription('كود اللون مثل #5865f2 أو اكتب remove للحذف').setRequired(true)),
    );
    builder.addSubcommand(sub('options', 'خيارات متقدّمة: حذف الخط السابق / الحذف التلقائي')
      .addBooleanOption((o) => o.setName('حذف_الخط_السابق').setDescription('حذف الخط السابق عند وصول رسالة جديدة'))
      .addIntegerOption((o) => o.setName('حذف_بعد_ثواني').setDescription('حذف الخط تلقائيًا بعد كم ثانية (0 = بدون)').setMinValue(0).setMaxValue(3600))
      .addBooleanOption((o) => o.setName('حذف_مع_الرسالة').setDescription('حذف الخط عند حذف رسالته')));
    builder.addSubcommand(sub('test', 'إرسال خط تجريبي في القناة الحالية'));
    builder.addSubcommand(sub('status', 'عرض إعدادات الخط الفاصل'));
    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();
    const settings = db.getGuildSettings(interaction.guildId);
    const cfg = settings.autoline;

    if (sub === 'enable' || sub === 'disable') {
      const enabled = sub === 'enable';
      if (enabled && !(cfg.channels || []).length) {
        return interaction.reply({ embeds: [embeds.error('لا توجد قنوات', 'أضف قناة أولًا: `/autoline add القناة:#مثال`')], flags: 64 });
      }
      db.updateGuildSettings(interaction.guildId, { autoline: { enabled } });
      return interaction.reply({
        embeds: [embeds.success('الخط الفاصل التلقائي', enabled ? '✅ تم التفعيل.' : '🔴 تم التعطيل.')],
        flags: 64,
      });
    }

    if (sub === 'add' || sub === 'remove') {
      const channel = interaction.options.getChannel('القناة');
      const list = new Set(cfg.channels || []);
      if (sub === 'add') list.add(channel.id);
      else list.delete(channel.id);
      db.updateGuildSettings(interaction.guildId, { autoline: { channels: [...list], enabled: sub === 'add' ? true : cfg.enabled } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'القنوات',
            sub === 'add'
              ? `✅ تمت إضافة ${channel} — سيُرسل خط فاصل بعد كل رسالة فيها.`
              : `✅ تمت إزالة ${channel}.`,
            {
              fields: [{ name: 'القنوات الحالية', value: [...list].map((c) => `<#${c}>`).join(' ') || 'لا يوجد', inline: false }],
            },
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'style') {
      const style = interaction.options.getString('النمط');
      const meta = autoline.GIF_STYLES[style];
      db.updateGuildSettings(interaction.guildId, { autoline: { gifStyle: style, lineType: 'gif' } });
      await interaction.deferReply({ flags: 64 });
      const sent = await autoline.sendTestLine(interaction.channel);
      if (sent?.deletable) setTimeout(() => sent.delete().catch(() => {}), 8000).unref?.();
      return interaction.editReply({
        embeds: [
          embeds.success('شكل الخط', `✅ صار الخط: **${meta.label}** — ${meta.desc}\n\nأرسلت نموذجًا في القناة (يُحذف بعد 8 ثوانٍ).`),
        ],
      });
    }

    if (sub === 'type') {
      const type = interaction.options.getString('النوع');
      db.updateGuildSettings(interaction.guildId, { autoline: { lineType: type } });
      const notes = {
        gif: '✅ الخط صار **صورة GIF متحركة**. اختر النمط بـ `/autoline style`.',
        custom: '✅ الخط صار من **رابطك الخاص** — أضف الرابط بـ `/autoline url`.',
        text: '✅ الخط صار **نصًّا عاديًا** — عدّله بـ `/autoline line`.',
      };
      return interaction.reply({ embeds: [embeds.success('نوع الخط', notes[type])], flags: 64 });
    }

    if (sub === 'url') {
      const url = interaction.options.getString('الرابط').trim();
      if (!autoline.isImageUrl(url)) {
        return interaction.reply({
          embeds: [embeds.error('رابط غير صالح', 'الرابط لازم يكون صورة مباشرة: `.gif` أو `.png` أو `.webp` أو `.jpg`')],
          flags: 64,
        });
      }
      db.updateGuildSettings(interaction.guildId, { autoline: { customUrl: url, lineType: 'custom' } });
      await interaction.deferReply({ flags: 64 });
      const sent = await autoline.sendTestLine(interaction.channel);
      if (sent?.deletable) setTimeout(() => sent.delete().catch(() => {}), 8000).unref?.();
      return interaction.editReply({
        embeds: [embeds.success('رابط الخط', '✅ حُفظ الرابط وصار الخط يُرسل منه مباشرة. النموذج أعلاه يُحذف بعد 8 ثوانٍ.')],
      });
    }

    if (sub === 'line') {
      const text = interaction.options.getString('النص');
      db.updateGuildSettings(interaction.guildId, { autoline: { line: text.trim() } });
      return interaction.reply({
        embeds: [embeds.success('شكل الخط', `✅ تم تحديث الخط.\n\n**المعاينة:**\n${stripCustomEmojis(text).trim() || '—'}`)],
        flags: 64,
      });
    }

    if (sub === 'color') {
      const value = interaction.options.getString('اللون').trim();
      const color = ['remove', 'حذف', '0'].includes(value.toLowerCase()) ? null : value;
      db.updateGuildSettings(interaction.guildId, { autoline: { color } });
      return interaction.reply({
        embeds: [embeds.success('لون الخط', color ? `✅ تم ضبط اللون على \`${color}\`.` : '✅ تم حذف اللون.')],
        flags: 64,
      });
    }

    if (sub === 'options') {
      const patch = {};
      const delPrev = interaction.options.getBoolean('حذف_الخط_السابق');
      const delAfter = interaction.options.getInteger('حذف_بعد_ثواني');
      const delWith = interaction.options.getBoolean('حذف_مع_الرسالة');
      if (delPrev !== null) patch.deletePrevious = delPrev;
      if (delAfter !== null) patch.deleteAfter = delAfter;
      if (delWith !== null) patch.deleteLineWithMessage = delWith;
      db.updateGuildSettings(interaction.guildId, { autoline: patch });
      const updated = db.getGuildSettings(interaction.guildId).autoline;
      return interaction.reply({
        embeds: [
          embeds.success('خيارات الخط الفاصل', undefined, {
            fields: [
              { name: 'حذف الخط السابق', value: updated.deletePrevious ? '🟢' : '🔴', inline: true },
              { name: 'حذف بعد', value: updated.deleteAfter ? `${updated.deleteAfter} ثانية` : 'أبدًا', inline: true },
              { name: 'حذف مع الرسالة', value: updated.deleteLineWithMessage ? '🟢' : '🔴', inline: true },
            ],
          }),
        ],
        flags: 64,
      });
    }

    if (sub === 'test') {
      await interaction.deferReply({ flags: 64 });
      const message = await autoline.sendTestLine(interaction.channel);
      if (message?.deletable) setTimeout(() => message.delete().catch(() => {}), 8000).unref?.();
      return interaction.editReply({
        embeds: [
          message
            ? embeds.success('تجربة', '✅ تم إرسال خط تجريبي في هذه القناة، سيُحذف تلقائيًا بعد 8 ثوانٍ.')
            : embeds.error('فشل', '❌ ما قدرت أرسل الخط. تأكد من صلاحية إرسال الرسائل.'),
        ],
      });
    }

    if (sub === 'status') {
      const onOff = (v) => (v ? '🟢' : '🔴');
      return interaction.reply({
        embeds: [
          embeds.info('➖ الخط الفاصل التلقائي', undefined, {
            fields: [
              { name: 'الحالة', value: onOff(cfg.enabled), inline: true },
              { name: 'نوع الخط', value: cfg.lineType === 'text' ? 'نصّي' : cfg.lineType === 'custom' ? 'رابط خاص' : 'صورة GIF متحركة', inline: true },
              {
                name: 'شكل الخط',
                value: cfg.lineType === 'custom'
                  ? String(cfg.customUrl || 'لم يُضبط')
                  : cfg.lineType === 'text'
                    ? String(stripCustomEmojis(cfg.line || '').slice(0, 60))
                    : `**${autoline.GIF_STYLES[cfg.gifStyle]?.label || 'توهّج'}**`,
                inline: false,
              },
              { name: 'القنوات', value: (cfg.channels || []).map((c) => `<#${c}>`).join(' ') || 'لا يوجد', inline: false },
              { name: 'حذف الخط السابق', value: onOff(cfg.deletePrevious), inline: true },
              { name: 'حذف تلقائي', value: cfg.deleteAfter ? `${cfg.deleteAfter} ثانية` : 'أبدًا', inline: true },
              { name: 'حذف مع الرسالة', value: onOff(cfg.deleteLineWithMessage), inline: true },
            ],
          }),
        ],
        flags: 64,
      });
    }
  },
};
