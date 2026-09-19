'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../lib/embeds');
const { t } = require('../../lib/i18n');

module.exports = {
  permissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('قفل أو فتح قناة (منع الأعضاء من الكتابة)')
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('قفل قناة')
        .addChannelOption((o) => o.setName('القناة').setDescription('القناة').setRequired(false))
        .addStringOption((o) => o.setName('السبب').setDescription('السبب').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unlock')
        .setDescription('فتح قناة')
        .addChannelOption((o) => o.setName('القناة').setDescription('القناة').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('قفل كل القنوات النصية (حالة طوارئ)')
        .addStringOption((o) => o.setName('السبب').setDescription('السبب').setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName('unlockall').setDescription('فتح كل القنوات النصية'))
    .addSubcommand((sub) =>
      sub
        .setName('hide')
        .setDescription('إخفاء قناة عن الأعضاء (@everyone)')
        .addChannelOption((o) => o.setName('القناة').setDescription('القناة').setRequired(false))
        .addStringOption((o) => o.setName('السبب').setDescription('السبب').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('إظهار قناة مخفية من جديد')
        .addChannelOption((o) => o.setName('القناة').setDescription('القناة').setRequired(false)),
    ),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const reason = interaction.options.getString('السبب') || 'بدون سبب';

    const applyLock = async (channel, lock) => {
      await channel.permissionOverwrites
        .edit(
          interaction.guild.roles.everyone,
          {
            SendMessages: lock ? false : null,
            SendMessagesInThreads: lock ? false : null,
          },
          { reason: `${lock ? 'قفل' : 'فتح'} بواسطة ${interaction.user.tag} | ${reason}` },
        )
        .catch(() => {});
    };

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('القناة') || interaction.channel;
      await applyLock(channel, true);
      return interaction.editReply({ embeds: [embeds.success('قفل القناة', t(lang, 'mod.channelLocked', { channel: `${channel}` }))] });
    }

    if (sub === 'unlock') {
      const channel = interaction.options.getChannel('القناة') || interaction.channel;
      await applyLock(channel, false);
      return interaction.editReply({ embeds: [embeds.success('فتح القناة', t(lang, 'mod.channelUnlocked', { channel: `${channel}` }))] });
    }

    /* إخفاء الروم: @everyone ما يشوفه — وإظهاره: يرجعلهم */
    const applyHidden = async (channel, hidden) => {
      await channel.permissionOverwrites
        .edit(
          interaction.guild.roles.everyone,
          { ViewChannel: hidden ? false : null },
          { reason: `${hidden ? 'إخفاء' : 'إظهار'} بواسطة ${interaction.user.tag} | ${reason}` },
        )
        .catch(() => {});
    };

    if (sub === 'hide') {
      const channel = interaction.options.getChannel('القناة') || interaction.channel;
      await applyHidden(channel, true);
      return interaction.editReply({ embeds: [embeds.success('إخفاء القناة', `تم إخفاء ${channel} عن الأعضاء.`)] });
    }

    if (sub === 'show') {
      const channel = interaction.options.getChannel('القناة') || interaction.channel;
      await applyHidden(channel, false);
      return interaction.editReply({ embeds: [embeds.success('إظهار القناة', `تم إظهار ${channel} من جديد للأعضاء.`)] });
    }

    if (sub === 'all') {
      const channels = interaction.guild.channels.cache.filter((c) => c.isTextBased() && c.viewable && !c.isThread());
      let count = 0;
      for (const channel of channels.values()) {
        const me = interaction.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) continue;
        await applyLock(channel, true);
        count += 1;
      }
      return interaction.editReply({ embeds: [embeds.success('قفل عام 🔒', `تم قفل **${count}** قناة.\n**السبب:** ${reason}`)] });
    }

    if (sub === 'unlockall') {
      const channels = interaction.guild.channels.cache.filter((c) => c.isTextBased() && c.viewable && !c.isThread());
      let count = 0;
      for (const channel of channels.values()) {
        const me = interaction.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) continue;
        await applyLock(channel, false);
        count += 1;
      }
      return interaction.editReply({ embeds: [embeds.success('فتح عام 🔓', `تم فتح **${count}** قناة.`)] });
    }
  },
};
