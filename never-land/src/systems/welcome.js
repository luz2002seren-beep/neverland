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

/** مكان دائرة النسخة القديمة من الإطار (لمعرفة إن المدير عدّل الدائرة بيده) */
const OLD_FRAME_CIRCLES = [
  { cx: 0.33431, cy: 0.56543, r: 0.2525 },     /* الإطار الأول */
  { cx: 0.33398, cy: 0.56494, r: 0.25244 },    /* الإطار الثاني */
  { cx: 0.36325, cy: 0.55217, r: 0.13647 },    /* قيمة بالإطار الثالث حسبت غلط (r من العرض بدل الارتفاع) */
];

/** هل مكان الدائرة المحفوظ = مكان نسخة قديمة من الإطار؟ (يعني المدير ما ضبطه بيده) */
function isLegacyCircle(circle) {
  if (!circle || circle.cx === undefined) return true;
  return OLD_FRAME_CIRCLES.some(
    (old) => String(circle.cx) === String(old.cx) && String(circle.cy) === String(old.cy) && String(circle.r) === String(old.r),
  );
}

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

/** كود دعوة من نص/رابط: نحفظ الجزء الأخير فقط */
function normalizeInviteCode(value) {
  return String(value || '').trim().replace(/^<|>$/g, '').replace(/^https?:\/\/(discord\.gg|discord\.com\/invite)\//i, '').toLowerCase();
}

/**
 * 🧩 هل الدعوة عامة؟ (رابط عام/فانيتي · دعوة بوت · أو ما عرفنا صاحبها)
 * الخاص = رابط صنعه عضو بشري ⇒ يُمنشن هو. العام ⇒ يُمنشن publicInviterId.
 */
function isPublicInvite(inviteInfo, guild = null, cfg = null) {
  const defaults = require('../config').defaults.welcome;
  const settings = cfg || defaults;
  if (!inviteInfo?.code && !inviteInfo?.inviter) return true;

  const code = normalizeInviteCode(inviteInfo?.code);
  const list = (settings.publicInviteCodes || defaults.publicInviteCodes || []).map(normalizeInviteCode).filter(Boolean);
  if (code && list.includes(code)) return true;

  const vanity = normalizeInviteCode(guild?.vanityURLCode);
  if (code && vanity && code === vanity) return true;

  const inviter = inviteInfo?.inviter;
  if (!inviter) return true;
  if (inviter.bot) return true;
  return false;
}

/**
 * 🖼️ ترقية مكان دائرة الأفتار: لما نبدّل صورة الإطار بالنسخة الجديدة،
 * الإعدادات المحفوظة القديمة تبقى تشير لمكان الدائرة القديم ⇒ نحدّثها للجديد،
 * إلا لو المدير ضبط الدائرة بيده على قيم مختلفة (فما نلمسها).
 * (منفصلة عن ensureStyle لأن تلك تشتغل مرة واحدة فقط)
 * @returns {boolean} صار تحديث؟
 */
function ensureFrameLayout(guildId) {
  if (!guildId) return false;
  try {
    const raw = db.getGuildSettings(guildId)?.welcome || {};
    const defaults = require('../config').defaults.welcome;
    const circle = raw.frameCircle;
    const legacy = isLegacyCircle(circle);

    const patch = {};
    if (legacy) patch.frameCircle = defaults.frameCircle;
    if (!raw.frameImage) patch.frameImage = defaults.frameImage;
    if (!Object.keys(patch).length) return false;

    db.updateGuildSettings(guildId, { welcome: patch });
    console.log(`[الترحيب] تحديث مكان دائرة الأفتار لصورة الإطار الجديدة — السيرفر ${guildId}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * متغيّرات الداعي (Inv By) — تُستخدم في نص الترحيب.
 *  • دعوة خاصة ⇒ منشن صاحب الدعوة (أو اسمه لو المنشن مطفأ).
 *  • دعوة عامة/غير معروفة ⇒ منشن publicInviterId (بدل «غير معروف»).
 * @param {object|null} inviteInfo { code, inviter, uses }
 * @param {object|null} cfg إعدادات قسم الترحيب (اختياري — يُقرأ من الافتراضي)
 * @param {object|null} guild السيرفر (لكشف الفانيتي)
 */
function inviterVars(inviteInfo, cfg = null, guild = null) {
  const defaults = require('../config').defaults.welcome;
  const settings = cfg && typeof cfg === 'object' ? cfg : defaults;
  const useMention = settings.inviterMention === undefined ? defaults.inviterMention !== false : settings.inviterMention !== false;
  const fallbackId = String(settings.publicInviterId ?? defaults.publicInviterId ?? '').trim();
  const fallbackMention = /^\d{5,}$/.test(fallbackId) ? `<@${fallbackId}>` : null;

  const inviter = inviteInfo?.inviter || null;
  const isPublic = isPublicInvite(inviteInfo, guild, settings);
  const privateInviter = inviter && !isPublic ? inviter : null;

  const name = privateInviter ? (privateInviter.globalName || privateInviter.displayName || privateInviter.username || null) : null;
  const mention = privateInviter ? `<@${privateInviter.id}>` : fallbackMention;

  return {
    inviter: useMention ? (mention || 'غير معروف') : (name || (fallbackMention ? fallbackMention : 'غير معروف')),
    inviterName: name || 'غير معروف',
    inviterMention: mention || 'غير معروف',
    inviteCode: inviteInfo?.code || 'غير معروف',
    inviterIsPublic: isPublic,
    inviterId: privateInviter?.id || null,
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
      scale: Number(cfg.frameScale) > 0 ? Number(cfg.frameScale) : 1,
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
  let settings = db.getGuildSettings(guild.id);
  /* تصحيح أي إيموجي ناقص في النص (مرة واحدة — بعدها يصير موجود) */
  let failedEmojis = new Set();
  if (missingEmojis(guild, settings.welcome?.message).length) {
    const fix = await ensureEmojis(guild, settings.welcome, { client }).catch(() => null);
    /* اللي فشل رفعه (بلا صلاحية مثلًا) نبدّله بإيموجي يونيكود وقت الإرسال */
    failedEmojis = new Set((fix?.failed || []).map((f) => f.id));
    settings = db.getGuildSettings(guild.id);
  }
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
    const payloads = await buildWelcomeMessages(client, member, settings, { inviteInfo, failedEmojis });
    const messages = await sendWelcomeMessages(client, guild, settings.welcome.channelId, payloads, settings.welcome.autoDeleteAfter || 0);
    const vars = inviterVars(inviteInfo, settings.welcome, guild);
    STATE.guilds[guild.id] = {
      lastWelcomeAt: Date.now(),
      lastMember: { id: member.id, tag: member.user.tag },
      inviter: vars.inviter,
      inviterIsPublic: vars.inviterIsPublic,
      inviterId: vars.inviterId,
      channelId: settings.welcome.channelId,
      imageMode: settings.welcome.imageMode || 'frame',
      sent: messages.length > 0,
      messageId: messages[0]?.id || null,
      imageMessageId: messages[0]?.id || null,
      textMessageId: messages[1]?.id || null,
      messageIds: messages.map((m) => m.id),
      separateMessages: payloads.length > 1,
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
      scale: Number(cfg.frameScale) > 0 ? Number(cfg.frameScale) : 1,
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
 * 🔁 إيموجيات ما قدرنا نرفعها للسيرفر ⇒ نبدّلها بإيموجي يونيكود وقت الإرسال
 * (حتى ما يطلع «:os49:» نصًا قبيحًا في الرسالة).
 */
function sanitizeEmojiText(text, failedIds, fallback = '✨') {
  if (!failedIds?.size) return text;
  let out = String(text);
  for (const id of failedIds) {
    out = out.replace(new RegExp(`<a?:[\\w~]+:${id}>`, 'g'), fallback);
  }
  return out.replace(/[ \t]{2,}/g, ' ');
}

/**
 * 📤 رسائل الترحيب الجاهزة للإرسال: الصورة برسالة أولى ثم النص برسالة ثانية.
 * (وضع Embed يبقى رسالة واحدة — لأنه صورة داخل إمبد.)
 * @returns {Array<object>} مصفوفة حمولات تُرسل بالترتيب
 */
async function buildWelcomeMessages(client, member, settings, { inviteInfo = null, failedEmojis = null } = {}) {
  const cfg = settings.welcome || {};
  const defaults = require('../config').defaults.welcome;
  const full = await buildWelcomePayload(client, member, settings, { inviteInfo, failedEmojis });
  if (cfg.embed !== false) return [full];

  const fallback = cfg.emojiFallback ?? defaults.emojiFallback ?? '✨';
  const content = sanitizeEmojiText(full.content, failedEmojis, fallback);
  const textPayload = { content, embeds: [], allowedMentions: { parse: ['users'] } };
  const files = full.files || [];
  if (!files.length) return [textPayload];

  const imageFirst = cfg.imageFirst === undefined ? defaults.imageFirst !== false : cfg.imageFirst !== false;
  if (!imageFirst) return [{ ...textPayload, files }];
  return [{ files, allowedMentions: { parse: [] } }, textPayload];
}

/** إرسال مجموعة رسائل الترحيب بالترتيب (الصورة أولًا) — يرجع الرسائل المرسلة */
async function sendWelcomeMessages(client, guild, channelId, payloads, autoDeleteAfter = 0) {
  const sent = [];
  for (const payload of payloads) {
    const message = await sendTo(client, guild, channelId, payload, autoDeleteAfter);
    if (!message) break;
    sent.push(message);
  }
  return sent;
}

/**
 * بناء رسالة الترحيب كاملة (صورة + نص) في حمولة واحدة — تُستخدم للمعاينة.
 * @returns {{content:?string, embeds:Array, files:Array}}
 */
async function buildWelcomePayload(client, member, settings, { inviteInfo = null, failedEmojis = null } = {}) {
  const guild = member.guild;
  const vars = inviterVars(inviteInfo, settings.welcome, guild);
  const fallbackEmoji = settings.welcome.emojiFallback ?? (require('../config').defaults.welcome.emojiFallback || '✨');
  const text = sanitizeEmojiText(
    applyPlaceholders(settings.welcome.message, { user: member.user, member, guild, extra: vars }),
    failedEmojis,
    fallbackEmoji,
  );
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

  const payloads = await buildWelcomeMessages(client, subject, settings, { inviteInfo });
  const messages = await sendWelcomeMessages(client, guild, target, payloads, 0);
  if (!messages.length) return { ok: false, reason: 'sendFailed' };

  const vars = inviterVars(inviteInfo, settings.welcome, guild);
  STATE.guilds[guild.id] = {
    lastWelcomeAt: Date.now(),
    lastMember: { id: subject.id, tag: subject.user.tag },
    inviter: vars.inviter,
    inviterIsPublic: vars.inviterIsPublic,
    inviterId: vars.inviterId,
    channelId: target,
    imageMode: settings.welcome.imageMode || 'frame',
    sent: true,
    messageId: messages[0].id,
    imageMessageId: messages[0].id,
    textMessageId: messages[1]?.id || null,
    messageIds: messages.map((m) => m.id),
    separateMessages: payloads.length > 1,
    test: true,
  };
  return {
    ok: true,
    messageId: messages[0].id,
    messageIds: messages.map((m) => m.id),
    imageMessageId: messages[0].id,
    textMessageId: messages[1]?.id || null,
    separateMessages: payloads.length > 1,
    channelId: target,
    member: subject.user.tag,
    inviter: vars.inviter,
    inviterIsPublic: vars.inviterIsPublic,
  };
}

/**
 * 🔎 فحص الإيموجيات الخارجية في نص الترحيب: هل هي موجودة فعلًا في السيرفر؟
 * ديسكورد ما يعرض إيموجي سيرفر ثاني (يطبعه كنص «:os49:») — فننبّه المدير.
 * @returns {Array<{name:string, id:string, animated:boolean}>} الإيموجيات الناقصة
 */
function missingEmojis(guild, text) {
  const missing = [];
  const seen = new Set();
  const source = String(text || '');
  const re = /<(a?):([\w~]+):(\d{5,})>/g;
  let match = re.exec(source);
  while (match) {
    const [, animated, name, id] = match;
    if (!seen.has(id) && !guild?.emojis?.cache?.has?.(id)) {
      seen.add(id);
      missing.push({ name, id, animated: Boolean(animated) });
    }
    match = re.exec(source);
  }
  return missing;
}

/**
 * 🔁 تصحيح الإيموجيات الناقصة: أي إيموجي خارجي في نص الترحيب وغير موجود في السيرفر
 * ننزّله من سيرفرات ديسكورد (CDN العام) ونرفعه للسيرفر، ثم نبدّل رقمه في النص المحفوظ.
 * السبب: ديسكورد ما يعرض إيموجي سيرفر ثاني (يطبعه كنص «:os49:»).
 * @returns {Promise<{added:Array<{name:string,oldId:string,newId:string}>, failed:Array}>}
 */
async function ensureEmojis(guild, settings, { client = null } = {}) {
  const result = { added: [], failed: [] };
  if (!guild?.emojis?.create) return result;
  /* نقبل الشكلين: كائن إعدادات السيرفر أو كائن قسم الترحيب مباشرة */
  const cfg = settings?.welcome && typeof settings.welcome === 'object' ? settings.welcome : (settings || {});
  const text = String(cfg.message || '');
  const missing = missingEmojis(guild, text);
  if (!missing.length) return result;

  let message = text;
  for (const emoji of missing) {
    try {
      const ext = emoji.animated ? 'gif' : 'png';
      const res = await fetch(`https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=128`, {
        headers: { 'User-Agent': 'Never Land/1.0' },
      });
      if (!res.ok) {
        result.failed.push({ ...emoji, reason: `fetch_${res.status}` });
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) {
        result.failed.push({ ...emoji, reason: 'empty' });
        continue;
      }
      /* اسم الإيموجي المسموح: 2–32 حرفًا [a-zA-Z0-9_] */
      const safeName = String(emoji.name).replace(/[^\w]/g, '_').slice(0, 32) || 'nl_emoji';
      const name = safeName.length >= 2 ? safeName : `nl_${safeName}`;

      /* ١) نرفعه للسيرفر (الأفضل — يظهر لكل الأعضاء) · ٢) وإلا لإيموجيات البوت نفسها (بلا صلاحيات السيرفر) */
      let created = null;
      let reason = 'create_failed';
      try {
        created = await guild.emojis.create({ attachment: buffer, name, reason: 'إيموجي رسالة الترحيب (تصحيح تلقائي)' });
      } catch (err) {
        reason = err.message;
        created = null;
      }
      if (!created?.id && client?.application?.emojis?.create) {
        try {
          created = await client.application.emojis.create({ attachment: buffer, name });
          if (created?.id) reason = null;
        } catch (err) {
          reason = err.message;
          created = null;
        }
      }
      if (!created?.id) {
        result.failed.push({ ...emoji, reason });
        continue;
      }
      message = message.split(`<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`).join(`<${created.animated ? 'a' : ''}:${created.name}:${created.id}>`);
      result.added.push({ name: emoji.name, oldId: emoji.id, newId: created.id, scope: created.guild ? 'guild' : 'app' });
    } catch (err) {
      result.failed.push({ ...emoji, reason: err.message });
    }
  }

  if (result.added.length && message !== text) {
    try {
      db.updateGuildSettings(guild.id, { welcome: { ...cfg, message } });
      console.log(`[الترحيب] أُضيف ${result.added.length} إيموجي للسيرفر ${guild.id} وتحدّث نص الترحيب.`);
    } catch { /* نتجاهل */ }
  }
  return result;
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
  isPublicInvite,
  buildWelcomeMessages,
  sendWelcomeMessages,
  missingEmojis,
  ensureEmojis,
  ensureStyle,
  ensureFrameLayout,
  status,
};
