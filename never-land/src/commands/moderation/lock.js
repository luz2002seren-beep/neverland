'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../lib/embeds');
const { t } = require('../../lib/i18n');
const config = require('../../config');
const discordProxy = require('../../lib/discordRestProxy');

const SEND_BITS = BigInt(PermissionFlagsBits.SendMessages) | BigInt(PermissionFlagsBits.SendMessagesInThreads);

async function putOverwrite(channel, role, lock, reason) {
  const current = channel.permissionOverwrites.cache.get(role.id);
  let allow = BigInt(current?.allow?.bitfield ?? current?.allow ?? 0);
  let deny = BigInt(current?.deny?.bitfield ?? current?.deny ?? 0);
  if (lock) {
    allow &= ~SEND_BITS;
    deny |= SEND_BITS;
  } else {
    allow &= ~SEND_BITS;
    deny &= ~SEND_BITS;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const payload = { type: 0, allow: allow.toString(), deny: deny.toString() };
    const proxied = await discordProxy.request('PUT', `/channels/${channel.id}/permissions/${role.id}`, payload, { reason }).catch((err) => {
      if (discordProxy.enabled()) throw err;
      return null;
    });
    if (proxied !== null) return true;
    const res = await fetch(`https://discord.com/api/v10/channels/${channel.id}/permissions/${role.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${config.bot.token}`,
        'Content-Type': 'application/json',
        'X-Audit-Log-Reason': encodeURIComponent(reason).slice(0, 512),
        'User-Agent': 'NeverLandBot (https://never-land-production.up.railway.app, 1.0)',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${res.status} ${data?.message || res.statusText}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

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
      const auditReason = `${lock ? 'قفل' : 'فتح'} بواسطة ${interaction.user.tag} | ${reason}`;
      try {
        await putOverwrite(channel, interaction.guild.roles.everyone, lock, auditReason);
      } catch (err) {
        console.error('[lock] تعديل الصلاحيات المباشر فشل:', err?.message || err);
        await Promise.race([
          channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            {
              SendMessages: lock ? false : null,
              SendMessagesInThreads: lock ? false : null,
            },
            { reason: auditReason },
          ),
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error('مهلة تعديل الصلاحيات')), 5000);
            timer.unref?.();
          }),
        ]).catch((err2) => console.error('[lock] تعديل الصلاحيات فشل:', err2?.message || err2));
      }
    };

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('القناة') || interaction.channel;
      await applyLock(channel, true);
      interaction.__replyVars = { channel: `${channel}`, reason, action: 'قفل' };
      return interaction.editReply({ embeds: [embeds.success('قفل القناة', t(lang, 'mod.channelLocked', { channel: `${channel}` }))] });
    }

    if (sub === 'unlock') {
      const channel = interaction.options.getChannel('القناة') || interaction.channel;
      await applyLock(channel, false);
      interaction.__replyVars = { channel: `${channel}`, reason, action: 'فتح' };
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
