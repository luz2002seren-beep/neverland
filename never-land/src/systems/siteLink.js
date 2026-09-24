'use strict';

/**
 * systems/siteLink.js
 * -------------------------------------------------------------
 * رابط الموقع ما يطلع في أي رد من ردود البوت.
 *
 * الطريقة الوحيدة: عضو يكتب كلمة «نيفر» في الشات — وبشرط:
 *   المالك أضافه لقائمة دخول الموقع.
 *
 * غير هيك: رد قصير بلا أي رابط. ومالك الموقع يستثنى دائمًا.
 * -------------------------------------------------------------
 */

const config = require('../config');

/** الكلمات اللي تطلب رابط الموقع */
const WORDS = ['نيفر', 'نيفرلاند', 'never', 'neverland'];

/** فترة هدوء بسيطة: ما نكرّر الرد لنفس العضو بسرعة */
const COOLDOWN_MS = 30 * 1000;
const lastAt = new Map();

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** هل الرسالة هي كلمة طلب الرابط؟ (كلمة واحدة فقط) */
function isSiteWord(content) {
  const raw = String(content || '').trim();
  if (!raw || /\s/.test(raw)) return false;
  return WORDS.includes(normalize(raw));
}

/** عنده رول دخول الموقع؟ */
function hasSiteRole(member) {
  const roleId = String(config.web.requiredRoleId || '').trim();
  if (!roleId) return false;
  try {
    return Boolean(member?.roles?.cache?.has(roleId));
  } catch {
    return false;
  }
}

/** مسجّل بالموقع؟ (دخل بحساب ديسكورد مرة على الأقل) */
function isRegistered(userId) {
  try {
    const siteUsers = require('../web/siteUsers');
    const entry = siteUsers.get(userId);
    return Boolean(entry) && entry.status !== 'banned';
  } catch {
    return false;
  }
}

/** يستحق يشوف رابط الموقع؟ المالك دائمًا، والباقي من قائمة السماح. */
function allowed(member) {
  const id = String(member?.id || member?.user?.id || '');
  if (!id) return false;
  try {
    return require('../web/siteUsers').isAllowed(id);
  } catch {
    return false;
  }
}

function onCooldown(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const last = lastAt.get(key) || 0;
  if (now - last < COOLDOWN_MS) return true;
  if (lastAt.size > 500) lastAt.clear();
  lastAt.set(key, now);
  return false;
}

/** رابط صالح للنشر؟ */
function baseUrl() {
  const base = String(config.web.url || '').replace(/\/$/, '');
  return /^https?:\/\//i.test(base) ? base : '';
}

/**
 * كلمة «نيفر» في الشات.
 * @returns {Promise<boolean>} هل تعاملنا مع الرسالة؟
 */
async function handleMessage(client, message) {
  if (!message?.guild || message.author?.bot) return false;
  if (!isSiteWord(message.content)) return false;
  if (onCooldown(message.guild.id, message.author.id)) return true;

  const embeds = require('../lib/embeds');
  const base = baseUrl();

  if (!allowed(message.member)) {
    await message
      .reply({
        content: [
          'رابط الموقع ما يظهر إلا لمن أضافهم مالك الموقع لقائمة الدخول.',
          'سجّل دخولك مرة، وبعد ما يسمح لك المالك اكتب **نيفر** ويظهر لك الرابط.',
        ].join('\n'),
        allowedMentions: { repliedUser: false },
      })
      .catch(() => null);
    return true;
  }

  if (!base) {
    await message
      .reply({ content: 'رابط الموقع غير مضبوط حاليًا — الإدارة تضبطه من إعدادات الموقع.', allowedMentions: { repliedUser: false } })
      .catch(() => null);
    return true;
  }

  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
  const embed = embeds.base({
    color: 0x5865f2,
    title: 'موقع Never Land',
    description: 'ادخل من الزر. العنوان ما ينكتب في الرسالة.',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('افتح الموقع').setStyle(ButtonStyle.Link).setURL(base),
    new ButtonBuilder().setLabel('لوحة التحكم').setStyle(ButtonStyle.Link).setURL(`${base}/dashboard`),
  );

  await message
    .reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } })
    .catch(() => null);
  return true;
}

module.exports = { handleMessage, allowed, isSiteWord, hasSiteRole, isRegistered, WORDS };
