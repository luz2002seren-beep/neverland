'use strict';

/**
 * systems/welcome.js
 * -------------------------------------------------------------
 * الترحيب والوداع والدعم (Boost) + الرتب التلقائية.
 *  • رسالة ترحيب نصية أو embed مع متغيّرات ({user} {server} {memberCount} {avatar}...)
 *  • صورة ترحيب: بطاقة مولَّدة بالأفتار (Card) / أفتار / صورة مخصّصة / بدون
 *  • ترحيب في الخاص • وداع • شكر الدعم (Boost) • رتب تلقائية • Anti-Raid
 * -------------------------------------------------------------
 */

const { PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const db = require('../database');
const { base } = require('../lib/embeds');
const { applyPlaceholders } = require('../lib/utils');
const welcomeCard = require('../lib/welcomeCard');

/** إرسال رسالة إلى قناة معينة مع خيار الحذف التلقائي */
async function sendTo(client, guild, channelId, payload, autoDeleteAfter = 0) {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return null;

  const me = guild.members.me;
  if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return null;

  const message = await channel.send(payload).catch((err) => {
  console.error('[تنبيه] فشل إرسال رسالة الترحيب:', err.message);
    return null;
  });
  if (message && autoDeleteAfter > 0) {
    setTimeout(() => message.delete().catch(() => {}), autoDeleteAfter);
  }
  return message;
}

/**
 * بناء صورة الترحيب حسب الإعداد (بطاقة / أفتار / مخصّصة).
 * @param {object} [opts]
 * @param {boolean} [opts.asFile] إرفاق الصورة كملف (لرسالة عادية بلا Embed)
 * @param {string} [opts.cardMessage] النص المرسوم على البطاقة
 * @returns {{files: Array, imageRef: ?string}}
 */
async function buildWelcomeImage(client, member, settings, opts = {}) {
  const cfg = settings.welcome;
  const mode = cfg.imageMode || 'none';
  const result = { files: [], imageRef: null };

  /* إرفاق صورة جاهزة كملف (تُستخدم مع الرسالة العادية بلا Embed) */
  const attachDownloaded = async (url, name = 'welcome.png') => {
    if (!url) return false;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Never Land/1.0' } });
      if (!res.ok) return false;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) return false;
      result.files.push(new AttachmentBuilder(buffer, { name }));
      return true;
    } catch {
      return false;
    }
  };

  if (mode === 'avatar') {
    const url = member.user.displayAvatarURL({ size: 512, extension: 'png' });
    if (opts.asFile) {
      if (await attachDownloaded(url, 'avatar.png')) {
        result.imageRef = 'attachment://avatar.png';
        return result;
      }
    }
    result.imageRef = url;
    return result;
  }

  if (mode === 'custom' && cfg.imageUrl) {
    const url = applyPlaceholders(cfg.imageUrl, { user: member.user, member, guild: member.guild });
    if (opts.asFile) {
      if (await attachDownloaded(url, 'welcome.png')) {
        result.imageRef = 'attachment://welcome.png';
        return result;
      }
    }
    result.imageRef = url;
    return result;
  }

  if (mode === 'card' && welcomeCard.available()) {
    /* النص المرسوم على الصورة: نص البطاقة المخصّص وإن ما في، نص رسالة الترحيب بلا تنسيق ماركداون */
    const cardText = applyPlaceholders(opts.cardMessage || cfg.cardMessage || 'أهلاً بك {displayName} في {server}', {
      user: member.user,
      member,
      guild: member.guild,
    }).replace(/[*_`~|]/g, '');

    const buffer = await welcomeCard.generateWelcomeCard({
      user: member.user,
      memberCount: member.guild.memberCount,
      guildName: member.guild.name,
      guildIcon: member.guild.iconURL({ size: 128 }),
      background: cfg.cardBackground || null,
      theme: cfg.cardTheme || null,
      message: cardText,
      footer: `${member.guild.name}`.length > 40 ? '' : `العضو رقم ${member.guild.memberCount}`,
    });
    if (buffer) {
      if (opts.asFile || cfg.attachImage !== false) {
        result.files.push(new AttachmentBuilder(buffer, { name: 'welcome.png' }));
        result.imageRef = 'attachment://welcome.png';
      } else {
        result.imageRef = member.user.displayAvatarURL({ size: 512, extension: 'png' });
      }
      return result;
    }
  }

  // احتياطي: صورة الأفتار
  if (mode !== 'none') result.imageRef = member.user.displayAvatarURL({ size: 512, extension: 'png' });
  return result;
}

/** ترحيب عضو جديد */
async function handleMemberAdd(client, member) {
  const { guild } = member;
  const settings = db.getGuildSettings(guild.id);
  const lang = settings.language || 'ar';

  /* --------- 1) الرتب التلقائية --------- */
  if (settings.autorole?.enabled) {
    const isBot = member.user.bot;
    const roles = isBot ? (settings.autorole.botRoleIds || []) : (settings.autorole.roleIds || []);
    for (const roleId of roles) {
      const role = guild.roles.cache.get(roleId);
      if (!role) continue;
      if (guild.members.me && role.position >= guild.members.me.roles.highest.position) continue;
      await member.roles.add(role, 'رتبة تلقائية (Autorole)').catch(() => {});
    }
  }

  /* --------- 2) رسالة الترحيب في القناة --------- */
  if (settings.welcome?.enabled && settings.welcome.channelId) {
    const payload = await buildWelcomePayload(client, member, settings);
    await sendTo(client, guild, settings.welcome.channelId, payload, settings.welcome.autoDeleteAfter || 0);
  }

  /* --------- 3) ترحيب خاص في الرسائل --------- */
  if (settings.welcome?.dm) {
    const dmText = applyPlaceholders(
      settings.welcome.dmMessage || (lang === 'ar' ? 'أهلاً بك في **{server}**! لا تنسَ قراءة القوانين 😊' : 'Welcome to **{server}**!'),
      { user: member.user, member, guild },
    );
    /* سياسة الخاص: ما نراسل الخاص إلا في الحالات المهمة (٣ حالات) — ترحيب الخاص يحتاج سماحًا صريحًا */
    const dmPolicy = require('../lib/dmPolicy');
    await dmPolicy.send(member, dmText, { kind: 'welcome', settings });
  }

  /* --------- 4) إحصاء --------- */
  db.bumpDaily(guild.id, 'joins');

  /* --------- 5) الحماية من الهجمات --------- */
  const automod = require('./automod');
  await automod.handleMemberJoin(client, member).catch(() => {});
}

/** وداع عضو */
async function handleMemberRemove(client, member) {
  const { guild } = member;
  const settings = db.getGuildSettings(guild.id);
  db.bumpDaily(guild.id, 'leaves');

  if (!settings.leave?.enabled || !settings.leave.channelId) return;
  const text = applyPlaceholders(settings.leave.message, { user: member.user, member, guild });
  const payload = settings.leave.embed === false
    ? { content: text }
    : {
        embeds: [
          base({
            color: 0xfee75c,
            title: 'غادر السيرفر',
            description: text,
            thumbnail: member.user.displayAvatarURL({ size: 256 }),
            fields: [{ name: 'الأعضاء الآن', value: `${guild.memberCount}`, inline: true }],
          }),
        ],
      };
  await sendTo(client, guild, settings.leave.channelId, payload);
}

/** دعم السيرفر (Boost) */
async function handleBoost(client, member) {
  const { guild } = member;
  const settings = db.getGuildSettings(guild.id);
  if (!settings.boost?.enabled || !settings.boost.channelId) return;

  const text = applyPlaceholders(settings.boost.message, { user: member.user, member, guild, level: guild.premiumTier });
  const payload = {
    embeds: [
      base({
        color: 0xff73fa,
        title: '🚀 دعم جديد للسيرفر!',
        description: text,
        thumbnail: member.user.displayAvatarURL({ size: 256 }),
        fields: [
          { name: 'مانح الدعم', value: `${member}`, inline: true },
          { name: 'مستوى السيرفر', value: `المستوى ${guild.premiumTier}`, inline: true },
          { name: 'عدد الدعمات', value: `${guild.premiumSubscriptionCount ?? 0}`, inline: true },
        ],
      }),
    ],
  };
  await sendTo(client, guild, settings.boost.channelId, payload);
}

/**
 * معاينة صورة الترحيب (يُستخدمها أمر /welcome test والاختبار من اللوحة).
 * تُبنى بنفس الإعدادات الحقيقية — بما فيها النص المرسوم على الصورة.
 */
async function previewCard(client, member) {
  const settings = db.getGuildSettings(member.guild.id);
  const cfg = settings.welcome || {};
  const cardText = applyPlaceholders(cfg.cardMessage || 'أهلاً بك {displayName} في {server}', {
    user: member.user,
    member,
    guild: member.guild,
  }).replace(/[*_`~|]/g, '');

  return welcomeCard.generateWelcomeCard({
    user: member.user,
    memberCount: member.guild.memberCount,
    guildName: member.guild.name,
    guildIcon: member.guild.iconURL({ size: 128 }),
    background: cfg.cardBackground || null,
    theme: cfg.cardTheme || null,
    message: cardText,
  });
}

/**
 * بناء رسالة الترحيب كاملة (صورة + نص) — تُستخدم عند دخول عضو وعند الاختبار.
 * @returns {{content:?string, embeds:Array, files:Array}}
 */
async function buildWelcomePayload(client, member, settings) {
  const guild = member.guild;
  const text = applyPlaceholders(settings.welcome.message, { user: member.user, member, guild });
  const plain = settings.welcome.embed === false;
  const { files, imageRef } = await buildWelcomeImage(client, member, settings, { asFile: plain });

  if (plain) {
    return { content: text, embeds: [], files, allowedMentions: { parse: ['users'] } };
  }

  return {
    content: undefined,
    embeds: [
      base({
        color: 0x57f287,
        title: `أهلاً بك في ${guild.name}`,
        description: text,
        thumbnail: settings.welcome.avatarThumbnail ? member.user.displayAvatarURL({ size: 256 }) : null,
        image: imageRef,
        fields: [
          { name: 'العضو', value: `${member} \`${member.user.tag}\``, inline: true },
          { name: 'الحساب أُنشئ', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'ترتيب الانضمام', value: `#${guild.memberCount}`, inline: true },
        ],
      }),
    ],
    files,
  };
}

module.exports = { handleMemberAdd, handleMemberRemove, handleBoost, sendTo, buildWelcomeImage, buildWelcomePayload, previewCard };
