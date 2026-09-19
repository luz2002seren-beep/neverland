'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embeds = require('../../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('عرض صورة العضو أو البانر الخاص به')
    .addUserOption((o) => o.setName('العضو').setDescription('العضو المطلوب').setRequired(false))
    .addStringOption((o) =>
      o
        .setName('النوع')
        .setDescription('ما تريد عرضه')
        .addChoices(
          { name: 'الصورة (Avatar)', value: 'avatar' },
          { name: 'البانر (Banner)', value: 'banner' },
          { name: 'صورة السيرفر (Icon)', value: 'server' },
        )
        .setRequired(false)),

  async run(client, interaction, lang) {
    const user = interaction.options.getUser('العضو') || interaction.user;
    const kind = interaction.options.getString('النوع') || 'avatar';

    const full = await client.users.fetch(user.id, { force: true }).catch(() => user);

    if (kind === 'server') {
      const icon = interaction.guild.iconURL({ size: 1024, dynamic: true });
      if (!icon) return interaction.reply({ content: '❌ هذا السيرفر ما عنده صورة.', flags: 64 });
      return interaction.reply({
        embeds: [embeds.info(`صورة ${interaction.guild.name}`, undefined, { image: icon })],
      });
    }

    if (kind === 'banner') {
      const banner = full.bannerURL?.({ size: 1024, dynamic: true });
      if (!banner) return interaction.reply({ content: '❌ هذا المستخدم ما عنده بانر.', flags: 64 });
      return interaction.reply({
        embeds: [embeds.info(`بانر ${user.username}`, undefined, { image: banner })],
      });
    }

    const avatar = full.displayAvatarURL({ size: 1024, dynamic: true });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('PNG').setStyle(ButtonStyle.Link).setURL(full.displayAvatarURL({ size: 1024, extension: 'png' })),
      new ButtonBuilder().setLabel('JPG').setStyle(ButtonStyle.Link).setURL(full.displayAvatarURL({ size: 1024, extension: 'jpg' })),
      new ButtonBuilder().setLabel('WEBP').setStyle(ButtonStyle.Link).setURL(full.displayAvatarURL({ size: 1024, extension: 'webp' })),
    );

    await interaction.reply({
      embeds: [embeds.info(`صورة ${user.username}`, `[رابط مباشر](${avatar})`, { image: avatar, thumbnail: null })],
      components: [row],
    });
  },
};
