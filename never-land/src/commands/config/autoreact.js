'use strict';

const { SlashCommandBuilder, SlashCommandSubcommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const autoreact = require('../../systems/autoreact');

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('autoreact')
      .setDescription('التفاعلات التلقائية: إيموجيات تُضاف تلقائيًا لرسائل قنوات محدّدة');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(sub('enable', 'تفعيل التفاعلات التلقائية'));
    builder.addSubcommand(sub('disable', 'تعطيل التفاعلات التلقائية'));
    builder.addSubcommand(
      sub('channel', 'إضافة/إزالة قناة للتفاعل التلقائي').addChannelOption((o) =>
        o.setName('القناة').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    );
    builder.addSubcommand(
      sub('emoji', 'إضافة إيموجي للتفاعل التلقائي (يدعم الإيموجيات الخارجية)')
        .addStringOption((o) => o.setName('العملية').setDescription('إضافة أو حذف').setRequired(true)
          .addChoices({ name: 'إضافة', value: 'add' }, { name: 'حذف', value: 'remove' }))
        .addStringOption((o) => o.setName('الإيموجي').setDescription('مثال: 👍 أو <:name:123456789012345678>').setRequired(true)),
    );
    builder.addSubcommand(
      sub('word', 'تفاعل عند احتواء الرسالة على كلمة معيّنة')
        .addStringOption((o) => o.setName('العملية').setDescription('إضافة أو حذف').setRequired(true)
          .addChoices({ name: 'إضافة', value: 'add' }, { name: 'حذف', value: 'remove' }))
        .addStringOption((o) => o.setName('الكلمة').setDescription('الكلمة المفتاحية').setRequired(true))
        .addStringOption((o) => o.setName('الإيموجي').setDescription('الإيموجي للتفاعل').setRequired(false)),
    );
    builder.addSubcommand(sub('test', 'إرسال رسالة تجريبية ورؤية التفاعلات'));
    builder.addSubcommand(sub('status', 'عرض الإعدادات الحالية'));
    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();
    const settings = db.getGuildSettings(interaction.guildId);
    const cfg = settings.autoreact;

    if (sub === 'enable' || sub === 'disable') {
      const enabled = sub === 'enable';
      if (enabled && !(cfg.channels || []).length && !(cfg.words || []).length) {
        return interaction.reply({
          embeds: [embeds.error('لا يوجد إعداد', 'أضف قناة `/autoreact channel` أو كلمة `/autoreact word` أولًا.')],
          flags: 64,
        });
      }
      db.updateGuildSettings(interaction.guildId, { autoreact: { enabled } });
      return interaction.reply({
        embeds: [embeds.success('التفاعلات التلقائية', enabled ? '✅ تم التفعيل.' : '🔴 تم التعطيل.')],
        flags: 64,
      });
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('القناة');
      const list = new Set(cfg.channels || []);
      const exists = list.has(channel.id);
      if (exists) list.delete(channel.id);
      else list.add(channel.id);
      db.updateGuildSettings(interaction.guildId, { autoreact: { channels: [...list], enabled: true } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'القنوات',
            exists ? `✅ تمت إزالة ${channel}.` : `✅ سيتم التفاعل تلقائيًا على كل رسالة في ${channel}.`,
            { fields: [{ name: 'القنوات', value: [...list].map((c) => `<#${c}>`).join(' ') || 'لا يوجد', inline: false }] },
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'emoji') {
      const op = interaction.options.getString('العملية');
      const raw = interaction.options.getString('الإيموجي').trim();
      const parsed = require('../../lib/emojis').parseEmoji(raw);
      if (!parsed) {
        return interaction.reply({ embeds: [embeds.error('إيموجي غير صالح', 'جرّب إيموجي عادي أو إيموجي من سيرفرك `<:name:id>`.')], flags: 64 });
      }
      const list = new Set(cfg.emojis || []);
      if (op === 'add') list.add(raw);
      else list.delete(raw);
      db.updateGuildSettings(interaction.guildId, { autoreact: { emojis: [...list], enabled: true } });
      return interaction.reply({
        embeds: [embeds.success('الإيموجيات', `${op === 'add' ? '✅ تمت الإضافة' : '✅ تم الحذف'}\n\n**القائمة:** ${[...list].join(' ') || 'فارغة'}`)],
        flags: 64,
      });
    }

    if (sub === 'word') {
      const op = interaction.options.getString('العملية');
      const word = interaction.options.getString('الكلمة').trim().toLowerCase();
      const emoji = interaction.options.getString('الإيموجي');
      let words = [...(cfg.words || [])];

      if (op === 'add') {
        if (!emoji) return interaction.reply({ embeds: [embeds.error('ناقص', 'حدّد الإيموجي للتتفاعل به.')], flags: 64 });
        words = words.filter((w) => w.word !== word);
        words.push({ word, emoji: emoji.trim() });
      } else {
        words = words.filter((w) => w.word !== word);
      }

      db.updateGuildSettings(interaction.guildId, { autoreact: { words, enabled: true } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'التفاعل بالكلمات',
            words.length
              ? words.map((w) => `• \`${w.word}\` ➜ ${w.emoji}`).join('\n')
              : 'لا توجد كلمات مسجّلة.',
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'test') {
      await interaction.deferReply({ flags: 64 });
      const message = await interaction.channel.send({ content: '🧪 رسالة تجريبية للتفاعلات التلقائية — شاهد التفاعلات على هذه الرسالة.' }).catch(() => null);
      if (!message) return interaction.editReply({ embeds: [embeds.error('فشل', 'ما قدرت أرسل رسالة.')] });
      await autoreact.reactNow(message, cfg.emojis || []);
      const wordRule = (cfg.words || [])[0];
      if (wordRule) await autoreact.reactNow({ react: (e) => message.react(e) }, [wordRule.emoji]);
      return interaction.editReply({ embeds: [embeds.success('تجربة', '✅ تفاعلت مع الرسالة التجريبية.')] });
    }

    if (sub === 'status') {
      const onOff = (v) => (v ? '🟢' : '🔴');
      return interaction.reply({
        embeds: [
          embeds.info('😀 التفاعلات التلقائية', undefined, {
            fields: [
              { name: 'الحالة', value: onOff(cfg.enabled), inline: true },
              { name: 'تجاهل البوتات', value: onOff(cfg.ignoreBots), inline: true },
              { name: 'القنوات', value: (cfg.channels || []).map((c) => `<#${c}>`).join(' ') || 'لا يوجد', inline: false },
              { name: 'الإيموجيات', value: (cfg.emojis || []).join(' ') || 'لا يوجد', inline: false },
              { name: 'قواعد الكلمات', value: (cfg.words || []).map((w) => `\`${w.word}\` ➜ ${w.emoji}`).join('\n') || 'لا يوجد', inline: false },
            ],
          }),
        ],
        flags: 64,
      });
    }
  },
};
