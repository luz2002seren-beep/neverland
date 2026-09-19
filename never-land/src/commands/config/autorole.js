'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('الرتب التلقائية للأعضاء الجدد')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('إضافة رتبة تُمنح للأعضاء الجدد')
        .addRoleOption((o) => o.setName('الرتبة').setDescription('الرتبة').setRequired(true))
        .addBooleanOption((o) => o.setName('للبوتات').setDescription('تُمنح للبوتات فقط؟').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('حذف رتبة من قائمة الرتب التلقائية')
        .addRoleOption((o) => o.setName('الرتبة').setDescription('الرتبة').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('عرض الرتب التلقائية الحالية'))
    .addSubcommand((sub) => sub.setName('enable').setDescription('تفعيل الرتب التلقائية'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('تعطيل الرتب التلقائية')),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();
    const settings = db.getGuildSettings(interaction.guildId);

    if (sub === 'add') {
      const role = interaction.options.getRole('الرتبة');
      const forBots = interaction.options.getBoolean('للبوتات') ?? false;
      const me = interaction.guild.members.me;

      if (role.position >= me.roles.highest.position) {
        return interaction.reply({
          embeds: [embeds.error('رتبة أعلى مني', `الرتبة ${role} أعلى من رتبتي (${me.roles.highest}). ارفع رتبتي ثم أعد المحاولة.`)],
          flags: 64,
        });
      }
      if (role.managed) {
        return interaction.reply({ embeds: [embeds.error('رتبة مُدارة', 'هذه الرتبة مُدارة من تطبيق آخر ولا يمكن منحها يدويًا.')], flags: 64 });
      }

      const key = forBots ? 'botRoleIds' : 'roleIds';
      const list = new Set(settings.autorole[key] || []);
      list.add(role.id);
      db.updateGuildSettings(interaction.guildId, { autorole: { enabled: true, [key]: [...list] } });

      return interaction.reply({
        embeds: [embeds.success('الرتب التلقائية', `✅ سيحصل ${forBots ? 'كل بوت جديد' : 'كل عضو جديد'} على الرتبة ${role}.\n\n> تذكّر أن رتبة البوت يجب أن تكون أعلى من هذه الرتبة.`)],
        flags: 64,
      });
    }

    if (sub === 'remove') {
      const role = interaction.options.getRole('الرتبة');
      db.updateGuildSettings(interaction.guildId, {
        autorole: {
          roleIds: (settings.autorole.roleIds || []).filter((r) => r !== role.id),
          botRoleIds: (settings.autorole.botRoleIds || []).filter((r) => r !== role.id),
        },
      });
      return interaction.reply({ embeds: [embeds.success('حذف', `✅ تم حذف ${role} من الرتب التلقائية.`)], flags: 64 });
    }

    if (sub === 'list') {
      const cfg = db.getGuildSettings(interaction.guildId).autorole;
      return interaction.reply({
        embeds: [
          embeds.info('🎭 الرتب التلقائية', undefined, {
            fields: [
              { name: 'الحالة', value: cfg.enabled ? '🟢 مُفعّل' : '🔴 مُعطّل', inline: true },
              { name: 'للأعضاء', value: (cfg.roleIds || []).map((r) => `<@&${r}>`).join(' ') || 'لا يوجد', inline: false },
              { name: 'للبوتات', value: (cfg.botRoleIds || []).map((r) => `<@&${r}>`).join(' ') || 'لا يوجد', inline: false },
            ],
          }),
        ],
        flags: 64,
      });
    }

    if (sub === 'enable' || sub === 'disable') {
      db.updateGuildSettings(interaction.guildId, { autorole: { enabled: sub === 'enable' } });
      return interaction.reply({
        embeds: [embeds.success('الرتب التلقائية', sub === 'enable' ? '✅ تم التفعيل.' : '🔴 تم التعطيل.')],
        flags: 64,
      });
    }
  },
};
