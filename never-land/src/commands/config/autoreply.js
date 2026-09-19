'use strict';

/**
 * commands/config/autoreply.js
 * -------------------------------------------------------------
 * /autoreply — الردود التلقائية من داخل ديسكورد:
 *
 *   add     إضافة قاعدة (كلمات مفتاحية + الرد + نوع المطابقة + قناة اختيارية)
 *   remove  حذف قاعدة بالرقم (شوف الأرقام في list)
 *   list    عرض كل القواعد مع أرقامها
 *   enable / disable   تشغيل أو إيقاف النظام كامل
 *   config  ضبط عام: كل الرومات · الكولداون · حذف الرد بعد مدة · تجاهل البوتات
 *   test    تجربة نص وشوف أي قاعدة تطبقه (بلا إرسال)
 *   clear   حذف كل القواعد
 * -------------------------------------------------------------
 */

const { SlashCommandBuilder, SlashCommandSubcommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const autoreply = require('../../systems/autoreply');

/** معرّف قصير للقاعدة (يُستخدم في الكولداون) */
const makeId = () => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

const modeLabel = { contains: 'تحتوي', exact: 'مطابقة تمامًا', starts: 'تبدأ بـ' };

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],

  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('autoreply')
      .setDescription('الردود التلقائية: البوت يرد على كلمات مفتاحية في أي روم بالسيرفر');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(
      sub('add', 'إضافة رد تلقائي')
        .addStringOption((o) =>
          o
            .setName('الكلمات')
            .setDescription('كلمة أو أكثر يفصلها فاصلة — مثال: مرحبا، هلا، السلام عليكم')
            .setRequired(true))
        .addStringOption((o) =>
          o
            .setName('الرد')
            .setDescription('نص الرد — المتغيّرات: {user} {name} {server} {channel} — وفصل بين أكثر من رد بـ |')
            .setRequired(true))
        .addStringOption((o) =>
          o
            .setName('نوع_المطابقة')
            .setDescription('كيف نطابق الرسالة (الافتراضي: تحتوي على الكلمة)')
            .addChoices(
              { name: 'تحتوي على الكلمة', value: 'contains' },
              { name: 'الرسالة نفسها بالضبط', value: 'exact' },
              { name: 'تبدأ بالكلمة', value: 'starts' },
            ))
        .addChannelOption((o) =>
          o.setName('القناة').setDescription('حصر الرد بقناة واحدة (بدون = كل الرومات)').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addBooleanOption((o) => o.setName('تنبيه_العضو').setDescription('هل يعمل الرد منشن للعضو؟'))
        .addIntegerOption((o) => o.setName('الكولداون').setDescription('ثواني بين كل رد ورد لنفس العضو (0 = بلا)').setMinValue(0).setMaxValue(3600))
        .addIntegerOption((o) => o.setName('حذف_بعد').setDescription('حذف رد البوت بعد كذا ثانية (0 = يبقى)').setMinValue(0).setMaxValue(3600)),
    );

    builder.addSubcommand(
      sub('remove', 'حذف رد تلقائي برقمه').addIntegerOption((o) =>
        o.setName('الرقم').setDescription('رقم القاعدة من الأمر list').setRequired(true).setMinValue(1)),
    );

    builder.addSubcommand(sub('list', 'عرض كل الردود التلقائية'));
    builder.addSubcommand(sub('enable', 'تشغيل الردود التلقائية'));
    builder.addSubcommand(sub('disable', 'إيقاف الردود التلقائية'));
    builder.addSubcommand(sub('clear', 'حذف كل الردود التلقائية'));

    builder.addSubcommand(
      sub('config', 'ضبط عام للردود')
        .addBooleanOption((o) => o.setName('كل_الرومات').setDescription('الرد شغّال في كل قنوات السيرفر'))
        .addIntegerOption((o) => o.setName('الكولداون').setDescription('ثواني بين الردود لنفس العضو').setMinValue(0).setMaxValue(3600))
        .addIntegerOption((o) => o.setName('حذف_بعد').setDescription('حذف رد البوت بعد كذا ثانية (0 = يبقى)').setMinValue(0).setMaxValue(3600))
        .addBooleanOption((o) => o.setName('تجاهل_البوتات').setDescription('ما يرد على رسائل البوتات')),
    );

    builder.addSubcommand(
      sub('test', 'تجربة نص: أي قاعدة تطبقه؟ (بلا إرسال)').addStringOption((o) =>
        o.setName('النص').setDescription('النص للتجربة').setRequired(true)),
    );

    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();
    const cfg = db.getGuildSettings(interaction.guildId).autoReply || {};
    const rules = Array.isArray(cfg.rules) ? cfg.rules : [];

    /* ------------------------------ إضافة ------------------------------ */
    if (sub === 'add') {
      const triggers = interaction.options
        .getString('الكلمات')
        .split(/[,،|]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const reply = interaction.options.getString('الرد').trim();
      const match = interaction.options.getString('نوع_المطابقة') || 'contains';
      const channel = interaction.options.getChannel('القناة');
      const pingUser = interaction.options.getBoolean('تنبيه_العضو');
      const cooldown = interaction.options.getInteger('الكولداون');
      const del = interaction.options.getInteger('حذف_بعد');

      if (!triggers.length) return interaction.reply({ embeds: [embeds.error('كلمات ناقصة', 'اكتب كلمة واحدة على الأقل.')], flags: 64 });
      if (reply.length > 1500) return interaction.reply({ embeds: [embeds.error('الرد طويل', 'أقصى طول للرد ١٥٠٠ حرف.')], flags: 64 });

      const rule = {
        id: makeId(),
        triggers,
        match,
        reply,
        channels: channel ? [channel.id] : [],
        cooldownSeconds: cooldown === null ? cfg.cooldownSeconds ?? 15 : cooldown,
        deleteAfterSeconds: del === null ? cfg.deleteAfterSeconds ?? 0 : del,
        pingUser: pingUser === true,
        enabled: true,
      };

      db.updateGuildSettings(interaction.guildId, { autoReply: { enabled: true, rules: [...rules, rule] } });

      return interaction.reply({
        embeds: [
          embeds.success('تمت إضافة الرد التلقائي', undefined, {
            fields: [
              { name: 'الكلمات', value: triggers.join(' · '), inline: true },
              { name: 'نوع المطابقة', value: modeLabel[match], inline: true },
              { name: 'النطاق', value: channel ? `<#${channel.id}>` : 'كل رومات السيرفر', inline: true },
              { name: 'الرد', value: reply.slice(0, 900), inline: false },
            ],
          }),
        ],
        flags: 64,
      });
    }

    /* ------------------------------ حذف ------------------------------ */
    if (sub === 'remove') {
      const index = interaction.options.getInteger('الرقم') - 1;
      if (index < 0 || index >= rules.length) {
        return interaction.reply({ embeds: [embeds.error('رقم غير موجود', `عندك ${rules.length} قاعدة — استخدم /autoreply list للأرقام.`)], flags: 64 });
      }
      const removed = rules[index];
      const list = rules.filter((_, i) => i !== index);
      db.updateGuildSettings(interaction.guildId, { autoReply: { rules: list } });
      return interaction.reply({
        embeds: [embeds.success('تم الحذف', `الكلمات: ${autoreply.ruleTriggers(removed).join(' · ')}`)],
        flags: 64,
      });
    }

    /* ------------------------------ عرض ------------------------------ */
    if (sub === 'list') {
      if (!rules.length) {
        return interaction.reply({
          embeds: [
            embeds.info(
              'الردود التلقائية',
              'ما في أي رد تلقائي بعد. أضف واحدًا:\n`/autoreply add الكلمات: مرحبا، هلا  الرد: أهلًا {user}`',
            ),
          ],
          flags: 64,
        });
      }
      return interaction.reply({
        embeds: [
          embeds.info('الردود التلقائية', `${rules.length} قاعدة — الحالة: ${cfg.enabled ? 'مفعّلة' : 'معطّلة'}`, {
            fields: rules.slice(0, 20).map((rule, i) => ({
              name: `${i + 1}) ${autoreply.ruleTriggers(rule).slice(0, 4).join(' · ')}`.slice(0, 250),
              value: `${modeLabel[rule.match] || modeLabel.contains} · ${
                (rule.channels || []).length ? `<#${rule.channels[0]}>` : 'كل الرومات'
              } · كولداون ${rule.cooldownSeconds ?? cfg.cooldownSeconds ?? 15}ث\n${String(rule.reply || '').slice(0, 300)}`,
              inline: false,
            })),
          }),
        ],
        flags: 64,
      });
    }

    /* --------------------------- تشغيل/إيقاف --------------------------- */
    if (sub === 'enable' || sub === 'disable') {
      const enabled = sub === 'enable';
      db.updateGuildSettings(interaction.guildId, { autoReply: { enabled } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'الردود التلقائية',
            enabled
              ? rules.length
                ? `مفعّلة — ${rules.length} قاعدة تشتغل في كل الرومات.`
                : 'مفعّلة — بس لسا ما في قواعد. أضف واحدة: /autoreply add'
              : 'معطّلة.',
          ),
        ],
        flags: 64,
      });
    }

    /* ------------------------------ تفريغ ------------------------------ */
    if (sub === 'clear') {
      db.updateGuildSettings(interaction.guildId, { autoReply: { rules: [] } });
      return interaction.reply({ embeds: [embeds.success('تم الحذف', `انحذفت ${rules.length} قاعدة.`)], flags: 64 });
    }

    /* ------------------------------ ضبط ------------------------------ */
    if (sub === 'config') {
      const anywhere = interaction.options.getBoolean('كل_الرومات');
      const cooldown = interaction.options.getInteger('الكولداون');
      const del = interaction.options.getInteger('حذف_بعد');
      const ignoreBots = interaction.options.getBoolean('تجاهل_البوتات');
      const patch = {};
      if (anywhere !== null) patch.anywhereInServer = anywhere;
      if (cooldown !== null) patch.cooldownSeconds = cooldown;
      if (del !== null) patch.deleteAfterSeconds = del;
      if (ignoreBots !== null) patch.ignoreBots = ignoreBots;
      if (!Object.keys(patch).length) {
        return interaction.reply({ embeds: [embeds.error('ما في تعديل', 'حدّد خيارًا واحدًا على الأقل.')], flags: 64 });
      }
      db.updateGuildSettings(interaction.guildId, { autoReply: patch });
      const now = db.getGuildSettings(interaction.guildId).autoReply;
      return interaction.reply({
        embeds: [
          embeds.success('إعدادات الردود', undefined, {
            fields: [
              { name: 'النطاق', value: now.anywhereInServer === false ? 'حسب كل قاعدة' : 'كل رومات السيرفر', inline: true },
              { name: 'الكولداون', value: `${now.cooldownSeconds ?? 15} ثانية`, inline: true },
              { name: 'حذف الرد بعد', value: now.deleteAfterSeconds ? `${now.deleteAfterSeconds} ثانية` : 'يبقى', inline: true },
              { name: 'تجاهل البوتات', value: now.ignoreBots === false ? 'لا — يرد على البوتات' : 'نعم', inline: true },
            ],
          }),
        ],
        flags: 64,
      });
    }

    /* ------------------------------ تجربة ------------------------------ */
    if (sub === 'test') {
      const text = interaction.options.getString('النص');
      const found = autoreply.preview(interaction.guildId, text, interaction.channelId);
      if (!found.matched) {
        return interaction.reply({
          embeds: [
            embeds.error(
              'ما في قاعدة مطابقة',
              `النص «${text.slice(0, 120)}» ما طابق أي كلمة مفتاحية. عندك ${rules.length} قاعدة.`,
            ),
          ],
          flags: 64,
        });
      }
      return interaction.reply({
        embeds: [
          embeds.success('القاعدة المطابقة', undefined, {
            fields: [
              { name: 'الكلمات', value: found.triggers.join(' · '), inline: true },
              { name: 'الرد اللي بينرسل', value: String(found.rule.reply).slice(0, 900), inline: false },
            ],
          }),
        ],
        flags: 64,
      });
    }

    return interaction.reply({ embeds: [embeds.error('غير معروف', 'استخدم أحد أوامر /autoreply.')], flags: 64 });
  },
};
