'use strict';

const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../lib/embeds');

const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('إنشاء تصويت سريع في القناة')
    .addStringOption((o) => o.setName('السؤال').setDescription('سؤال التصويت').setRequired(true).setMaxLength(250))
    .addStringOption((o) => o.setName('خيار1').setDescription('الخيار الأول').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('خيار2').setDescription('الخيار الثاني').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('خيار3').setDescription('الخيار الثالث').setMaxLength(80))
    .addStringOption((o) => o.setName('خيار4').setDescription('الخيار الرابع').setMaxLength(80))
    .addStringOption((o) => o.setName('خيار5').setDescription('الخيار الخامس').setMaxLength(80)),

  async run(client, interaction, lang) {
    const question = interaction.options.getString('السؤال');
    const options = ['خيار1', 'خيار2', 'خيار3', 'خيار4', 'خيار5']
      .map((key) => interaction.options.getString(key))
      .filter(Boolean);

    const lines = options.map((opt, i) => `${NUM_EMOJI[i]} ${opt}`);

    const message = await interaction.reply({
      embeds: [
        embeds.base({
          color: 0x5865f2,
          title: '📊 تصويت',
          description: `**${question}**\n\n${lines.join('\n')}`,
          footer: `بواسطة ${interaction.user.username}`,
        }),
      ],
      fetchReply: true,
    });

    for (let i = 0; i < options.length; i += 1) {
      await message.react(NUM_EMOJI[i]).catch(() => {});
    }
  },
};
