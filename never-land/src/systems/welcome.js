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
let welcomeFrame = null;
try {
  welcomeFrame = require('../lib/welcomeFrame');
} catch {
  console.warn('[تنبيه] مولّد إطار الترحيب غير متوفّر — سنستخدم البطاقة العادية.');
}

/* حالة حيّة (تظهر في /api/status وللتشخيص) */
const STATE = { guilds: {} };

/* النص الافتراضي القديم (لتحديد إن العميل ما عدّله بنفسه) */
const OLD_DEFAULT_MESSAGE = 'أهلاً بك {user} في **{server}**، عدد الأعضاء الآن **{memberCount}**.';

/**
 * 🖼️ ترقية شكل الترحيب مرة واحدة لكل سيرفر: بطاقة قديمة ← إطار Never Land
 * (الأفتار داخل الدائرة) + تفعيل القناة والنص الجديد — وبس إذا ما كانت معدّلة بيد العميل.
 * @returns {string|null} الوضع الجديد إذا صارت الترقية
 */
function ensureStyle(guildId) {
  if (!guildId) return null;
  try {
    const raw = db.getGuildSettings(guildId)?.welcome || {};
    if (raw.styleUpgraded === true) return null;

    const defaults = require('../config').defaults.welcome;
    const patch = { styleUpgraded: true };
    if (raw.imageMode === undefined || raw.imageMode === 'card') patch.imageMode = 'frame';
    if (raw.frameImage === undefined) patch.frameImage = defaults.frameImage;
    if (raw.frameCircle === undefined) patch.frameCircle = defaults.frameCircle;
    if (!Array.isArray(raw.frameCircle) && raw.frameCircle && raw.frameCircle.cx === undefined) patch.frameCircle = defaults.frameCircle;
    if (!raw.channelId) patch.channelId = defaults.channelId;
    if (raw.enabled !== true) patch.enabled = true;
    if (!raw.message || raw.message === OLD_DEFAULT_MESSAGE) patch.message = defaults.message;

    db.updateGuildSettings(guildId, { welcome: patch });
    return patch.imageMode || 'kept';
  } catch {
    return null;
  }
}

/**
 * متغيّرات الداعي (Inv By) — تُستخدم في نص الترحيب.
 * @param {object|null} inviteInfo { code, inviter, uses }
 */
function inviterVars(inviteInfo) {
  const inviter = inviteInfo?.inviter || null;
  return {
    inviter: inviter ? (inviter.globalName || inviter.displayName || inviter.username || 'غير معروف') : 'غير معروف',
    inviterName: inviter ? (inviter.globalName || inviter.username || 'غير معروف') : 'غير معروف',
    inviterMention: inviter ? `<@${inviter.id}>` : 'غير معروف',
    inviteCode: inviteInfo?.code || 'غير معروف',
  };
}

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

  /* 🖼️ إطار Never Land: صورة الإطار + أفتار العضو داخل الدائرة الفارغة */
  if (mode === 'frame' && welcomeFrame?.available(cfg.frameImage)) {
    const made = await welcomeFrame.generate({
      avatarUrl: member.user.displayAvatarURL({ size: 512, extension: 'png' }),
      frame: cfg.frameImage,
      roi: cfg.frameCircle || null,
      format: 'webp',
    });
    if (made) {
      result.files.push(new AttachmentBuilder(made.buffer, { name: made.name }));
      result.imageRef = `attachment://${made.name}`;
      return result;
    }
    /* فشل التوليد؟ نكمل للبطاقة العادية */
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
async function handleMemberAdd(client, member, { inviteInfo = null } = {}) {
  const { guild } = member;
  ensureStyle(guild.id);
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
    const payload = await buildWelcomePayload(client, member, settings, { inviteInfo });
    const message = await sendTo(client, guild, settings.welcome.channelId, payload, settings.welcome.autoDeleteAfter || 0);
    STATE.guilds[guild.id] = {
      lastWelcomeAt: Date.now(),
      lastMember: { id: member.id, tag: member.user.tag },
      inviter: inviterVars(inviteInfo).inviter,
      channelId: settings.welcome.channelId,
      imageMode: settings.welcome.imageMode || 'frame',
      sent: Boolean(message),
      messageId: message?.id || null,
      test: false,
    };
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
  ensureStyle(member.guild.id);
  const settings = db.getGuildSettings(member.guild.id);
  const cfg = settings.welcome || {};

  /* إطار Never Land: نفس الصورة اللي تنزل للأعضاء */
  if ((cfg.imageMode || 'frame') === 'frame' && welcomeFrame?.available(cfg.frameImage)) {
    const made = await welcomeFrame.generate({
      avatarUrl: member.user.displayAvatarURL({ size: 512, extension: 'png' }),
      frame: cfg.frameImage,
      roi: cfg.frameCircle || null,
      format: 'png',
    });
    if (made) return made.buffer;
  }

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
async function buildWelcomePayload(client, member, settings, { inviteInfo = null } = {}) {
  const guild = member.guild;
  const vars = inviterVars(inviteInfo);
  const text = applyPlaceholders(settings.welcome.message, { user: member.user, member, guild, extra: vars });
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

/**
 * ✅ ترحيب تجريبي (لمراجعة الشكل): يرسل رسالة ترحيب حقيقية لعضو موجود في السيرفر
 * إلى قناة الترحيب — نفس الصورة (الإطار + الأفتار) ونفس النص تمامًا.
 * @returns {Promise<{ok:boolean, reason?:string, messageId?:string, channelId?:string}>}
 */
async function sendTestWelcome(client, guild, member, { inviteInfo = null, channelId = null, memberId = null } = {}) {
  const settings = db.getGuildSettings(guild.id);
  const target = channelId || settings.welcome.channelId;
  if (!target) return { ok: false, reason: 'noChannel' };

  const subject = member
    || (memberId ? await guild.members.fetch(memberId).catch(() => null) : null)
    || guild.members.me;
  if (!subject) return { ok: false, reason: 'noMember' };

  const payload = await buildWelcomePayload(client, subject, settings, { inviteInfo });
  const message = await sendTo(client, guild, target, payload, 0);
  if (!message) return { ok: false, reason: 'sendFailed' };

  STATE.guilds[guild.id] = {
    lastWelcomeAt: Date.now(),
    lastMember: { id: subject.id, tag: subject.user.tag },
    inviter: inviterVars(inviteInfo).inviter,
    channelId: target,
    imageMode: settings.welcome.imageMode || 'frame',
    sent: true,
    messageId: message.id,
    test: true,
  };
  return { ok: true, messageId: message.id, channelId: target, member: subject.user.tag, inviter: inviterVars(inviteInfo).inviter };
}

/** حالة الترحيب (للتشخيص) */
function status(guildId = null) {
  if (guildId) return STATE.guilds[guildId] || null;
  return STATE.guilds;
}

module.exports = {
  handleMemberAdd,
  handleMemberRemove,
  handleBoost,
  sendTo,
  buildWelcomeImage,
  buildWelcomePayload,
  previewCard,
  sendTestWelcome,
  inviterVars,
  ensureStyle,
  status,
};
