'use strict';

const db = require('../database');
const logs = require('./logs');
const { isModerator } = require('./access');

const recent = new Map();

function containsBlockedWord(content, words) {
  const normalized = String(content || '').toLowerCase();
  return words.find((word) => normalized.includes(word)) || null;
}

function repeated(message, settings) {
  const now = Date.now();
  const key = `${message.guildId}:${message.author.id}`;
  const windowMs = settings.automod.duplicateWindowSeconds * 1000;
  const items = (recent.get(key) || []).filter((item) => now - item.at <= windowMs);
  const text = String(message.content || '').trim().toLowerCase();
  items.push({ at: now, text });
  recent.set(key, items.slice(-30));
  return text && items.filter((item) => item.text === text).length >= settings.automod.duplicateThreshold;
}

function shouldIgnore(message, settings) {
  if (!message.guild || message.author?.bot || !message.member) return true;
  if (isModerator(message.member, settings)) return true;
  return settings.automod.exemptRoleIds.some((roleId) => message.member.roles?.cache?.has(roleId));
}

async function enforce(message, settings, reason) {
  try { await message.delete(); } catch { /* Missing permission or already removed. */ }
  const member = message.member;
  let applied = 'deleted';
  if (settings.automod.action === 'timeout' && member?.moderatable) {
    try {
      await member.timeout(settings.automod.timeoutMinutes * 60_000, `Automod: ${reason}`);
      applied = `timed out for ${settings.automod.timeoutMinutes}m`;
    } catch { applied = 'deleted (timeout unavailable)'; }
  }
  if (settings.automod.action === 'warn' || settings.automod.action === 'timeout') {
    db.addCase({
      guildId: message.guild.id,
      type: settings.automod.action === 'timeout' ? 'timeout' : 'warn',
      userId: message.author.id,
      userTag: message.author.tag,
      moderatorId: message.client.user?.id || 'automod',
      moderatorTag: 'Never Land Automod',
      reason: `Automod: ${reason}`,
      duration: settings.automod.action === 'timeout' ? settings.automod.timeoutMinutes * 60_000 : null,
      active: settings.automod.action === 'timeout' ? 1 : 0,
    });
  }
  await logs.send(message.client, settings, 'moderation', {
    title: 'Automod action',
    description: `<@${message.author.id}>: ${reason}\nAction: **${applied}**\nChannel: <#${message.channelId}>`,
    color: 0xed4245,
  });
}

async function handle(message, settings) {
  if (!settings.modules.automod || !settings.automod.enabled || shouldIgnore(message, settings)) return;
  const mentionCount = (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0);
  if (mentionCount >= settings.automod.mentionLimit) return enforce(message, settings, `too many mentions (${mentionCount})`);
  const word = containsBlockedWord(message.content, settings.automod.blockedWords);
  if (word) return enforce(message, settings, 'blocked word');
  if (repeated(message, settings)) return enforce(message, settings, 'repeated message spam');
}

module.exports = { handle };
