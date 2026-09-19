'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database');
const setupWizard = require('../../systems/setupWizard');
const embeds = require('../../lib/embeds');

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('معالج إعداد البوت خطوة بخطوة (ترحيب، لوقات، حماية، تذاكر...)'),

  async run(client, interaction, lang) {
    const settings = db.getGuildSettings(interaction.guildId);

    await interaction.reply({
      embeds: [
        embeds.info(
          'بدء الإعداد',
          [
            'سنضبط البوت معًا في أقل من دقيقة ⚡',
            '',
            '**ما الذي ستحتاجه؟**',
            '• قناة للترحيب (اختياري)',
            '• قناة للسجلات (مستحسن)',
            '• رتبة للدعم إذا كنت ستستخدم التذاكر',
            '',
            'تلميح: رتبة البوت يجب أن تكون أعلى من رتب الأعضاء لإدارة الرتب والعقوبات.',
          ].join('\n'),
        ),
      ],
      flags: 64,
    });

    await interaction.followUp(setupWizard.mainPanel(settings));
  },
};
