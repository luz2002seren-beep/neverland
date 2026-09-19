'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../lib/embeds');
const db = require('../../database');
const leveling = require('../../systems/leveling');
const { formatDate, progressBar } = require('../../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('معلومات تفصيلية عن عضو (الحساب، الرتب، السجل، المستوى)')
    .addUserOption((o) => o.setName('العضو').setDescription('العضو المطلوب').setRequired(false)),

  async run(client, interaction, lang) {
    await interaction.deferReply();
    const user = interaction.options.getUser('العضو') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const fields = [
      { name: 'الاسم', value: `\`${user.tag}\``, inline: true },
      { name: 'الآيدي', value: `\`${user.id}\``, inline: true },
      { name: 'بوت؟', value: user.bot ? '🤖 نعم' : '👤 لا', inline: true },
      { name: 'الحساب أُنشئ', value: `${formatDate(user.createdAt)}\n(<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`, inline: true },
    ];

    if (member) {
      const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
      fields.push(
        { name: 'انضم للسيرفر', value: member.joinedTimestamp ? `${formatDate(member.joinedAt)}\n(<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : '—', inline: true },
        { name: 'الرتبة العليا', value: `${member.roles.highest}`, inline: true },
        { name: 'الرتب', value: roles.size ? roles.map((r) => `${r}`).slice(0, 20).join(' ').slice(0, 1000) : 'لا يوجد', inline: false },
      );

      if (member.isCommunicationDisabled?.()) {
        fields.push({ name: '🔇 مُسكَت حاليًا', value: `حتى <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`, inline: false });
      }

      // الحالات المسجّلة
      const stats = db.getStats(interaction.guild.id);
      const userStats = ['warn', 'ban', 'kick', 'timeout']
        .map((type) => `${type}: **${db.countCases(interaction.guild.id, { type, userId: user.id })}**`)
        .join(' • ');
      fields.push({ name: '⚠️ السجل', value: userStats, inline: false });

      // الترتيب والمستوى
      const rank = leveling.getRankData(interaction.guild.id, user.id);
      if (rank.xp > 0) {
        fields.push({
          name: '📈 المستوى',
          value: `**${rank.level}** • ${rank.xp} XP • الترتيب #${rank.rank}/${rank.total}\n${progressBar(rank.xpIntoLevel, rank.xpForNext, 10)} (${rank.xpIntoLevel}/${rank.xpForNext})`,
          inline: false,
        });
      }
      void stats;
    }

    const embed = embeds.base({
      color: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : 0x5865f2,
      title: `👤 ${user.username}`,
      thumbnail: user.displayAvatarURL({ size: 512, dynamic: true }),
      image: member?.bannerURL?.({ size: 1024 }) || undefined,
      fields,
      footer: `${interaction.guild.name}`,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
