'use strict';

const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../lib/embeds');
const premium = require('../../lib/premium');
const { t } = require('../../lib/i18n');

function planName(lang, view) {
  if (!view.plan) return t(lang, 'premium.plan');
  const key = `premium.${view.plan}`;
  const name = t(lang, key);
  return name === key ? (view.planLabel || t(lang, 'premium.plan')) : name;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('حالة اشتراك البوت في هذا السيرفر'),

  async run(client, interaction, lang) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: t(lang, 'premium.guildOnly') }).catch(() => {});
      return;
    }
    const view = premium.publicView(guild.id);
    const until = !view.untilLabel || view.untilLabel === 'دائم'
      ? t(lang, 'premium.lifetime')
      : view.untilLabel;
    const description = view.active
      ? t(lang, 'premium.active', { plan: planName(lang, view), until })
      : t(lang, 'premium.free');
    await interaction.reply({ embeds: [embeds.info(t(lang, 'premium.title'), description)] }).catch(() => {});
  },
};
