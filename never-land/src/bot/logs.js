'use strict';

const { EmbedBuilder } = require('discord.js');

const keyFor = {
  moderation: 'moderationChannelId',
  message: 'messageChannelId',
  member: 'memberChannelId',
  ticket: 'ticketChannelId',
  system: 'systemChannelId',
};

async function getChannel(client, id) {
  if (!id) return null;
  return client.channels.cache.get(id) || client.channels.fetch(id).catch(() => null);
}

async function send(client, settings, category, payload = {}) {
  if (!settings.modules?.logging || !settings.logs?.enabled) return false;
  const id = settings.logs[keyFor[category]] || settings.logs.systemChannelId;
  const channel = await getChannel(client, id);
  if (!channel?.isTextBased?.()) return false;

  const embed = payload instanceof EmbedBuilder
    ? payload
    : new EmbedBuilder()
      .setColor(payload.color || 0x5865f2)
      .setTitle(String(payload.title || 'Never Land').slice(0, 256))
      .setDescription(String(payload.description || '').slice(0, 4_000))
      .setTimestamp();
  try {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

module.exports = { send };
