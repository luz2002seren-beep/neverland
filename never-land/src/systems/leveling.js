'use strict';

/**
 * systems/leveling.js
 * -------------------------------------------------------------
 * نظام الخبرة والمستويات (كامل):
 *
 *  المصادر (كل مصدر له إعداد مستقل):
 *    • كتابي   text     — خبرة على الرسائل في الشات
 *    • صوتي    voice    — خبرة على البقاء في الرومات الصوتية
 *    • تفاعل   interact — خبرة على التفاعلات التي تستلمها على رسائلك
 *
 *  الفترات:
 *    • توب داي  — لوحة متصدّرين تُصفَّر كل يوم
 *    • توب ويك  — لوحة متصدّرين تُصفَّر كل أسبوع (الإثنين)
 *    • كل الأوقات — الترتيب العام بالمستويات
 *
 *  الحمايات:
 *    • تفاعل واحد فقط لكل شخص على نفس الرسالة
 *    • كولداون بين نفس الشخصين (يمنع التفاعل المتبادل السريع)
 *    • سقف تفاعلات لكل رسالة + سقف تفاعل يومي لكل عضو
 *    • استثناء قنوات ورتب، ومنع رسائل البوتات
 * -------------------------------------------------------------
 */

const db = require('../database');
const { levelFromXp } = require('../lib/levels');
const { base } = require('../lib/embeds');
const { progressBar, humanize } = require('../lib/utils');
const { t } = require('../lib/i18n');
const periods = require('../lib/periods');
const arabicText = require('../lib/arabicText');

/** توليد خبرة عشوائية داخل المجال المحدّد */
const randomXp = (min, max) => {
  const lo = Math.max(1, Number(min) || 15);
  const hi = Math.max(lo, Number(max) || 25);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
};

/* ==========================================================================
 * الخبرة الكتابية: ١ خبرة لكل ٥ أحرف
 * ========================================================================== */

/** تنظيف النص قبل العدّ: بلا مسافات · بلا إيموجي · بلا منشن · بلا روابط طويلة */
function countChars(raw) {
  const text = String(raw || '')
    .replace(/<a?:\w+:\d+>/g, ' ') // إيموجي مخصص
    .replace(/https?:\/\/\S+/g, 'x') // الرابط = حرف واحد
    .replace(/<@[!&]?\d+>/g, ' ') // منشن
    .replace(/<#\d+>/g, ' ') // قناة
    .replace(/[\u200B-\u200F\uFEFF]/g, ''); // محارف صفرية العرض
  const marks = text.match(/[\p{L}\p{N}]/gu); // حروف وأرقام فقط
  return marks ? marks.length : 0;
}

/**
 * خبرة الرسالة = (عدد الأحرف ÷ ٥) × ١ — بأرضية، وبحد أدنى ١ خبرة لأي رسالة فيها حرف.
 * مثال: «مرحبا» (٥) = ١ · «كيفكم اليوم» (١١) = ٢ · «السلام عليكم ورحمة الله» (٢٠) = ٤
 */
function textXpFor(content, cfg = {}) {
  const chars = countChars(content);
  if (!chars) return { xp: 0, chars: 0 };
  const perChars = Math.max(1, Number(cfg.textXpPerChars ?? 5));
  const perAmount = Math.max(1, Number(cfg.textXpPerCharsAmount ?? 1));
  const cap = Math.max(1, Number(cfg.maxTextXpPerMessage ?? 100));
  const xp = Math.min(cap, Math.max(1, Math.floor(chars / perChars) * perAmount));
  return { xp, chars };
}

/* ==========================================================================
 * الحماية الذكية من السبام
 *   • تكرار نفس الكلام (تشابه نصّي ٨٥٪+)
 *   • رسائل سريعة متتالية
 *   • حروف مكرّرة (ااااااا) / رموز مكرّرة
 *   العقوبة: لا خبرة له (كتابي · صوتي · تفاعل) لمدة ٥ دقايق.
 * ========================================================================== */

/** عدّاد مؤقتات الرومات الصوتية لكل سيرفر (لضبط الفاصل الزمني) */
const voiceTicks = new Map();

/** آخر رسائل كل عضو: `${guildId}:${userId}` → [{at, text}] */
const msgHistory = new Map();
/** من هو ممنوع من الخبرة الآن: `${guildId}:${userId}` → وقت الانتهاء */
const spamMutes = new Map();

/** تنظيف للمقارنة — من المكتبة المشتركة (نفس منطق الردود التلقائية) */
const normalizeForCompare = arabicText.normalizeArabic;

/** معامل تشابه (Dice على الثنائيات) — من المكتبة المشتركة */
const similarity = arabicText.similarity;

/** هل هذا العضو ممنوع من الخبرة الآن؟ */
function spamStatus(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const until = spamMutes.get(key) || 0;
  const now = Date.now();
  if (until && until <= now) {
    spamMutes.delete(key);
    return { muted: false, remainingMs: 0, until: 0 };
  }
  return { muted: until > now, remainingMs: Math.max(0, until - now), until };
}

/** فحص رسالة جديدة: هل هي سبام؟ ولو نعم → نوقف خبرته ٥ دقايق */
function noteMessage(guildId, userId, content, cfg = {}) {
  const key = `${guildId}:${userId}`;
  const anti = cfg.antiSpam || {};
  const now = Date.now();

  if (anti.enabled === false) return { spam: false, muted: false };

  const clean = normalizeForCompare(content);
  const windowMs = Math.max(10, Number(anti.windowSeconds ?? 90)) * 1000;
  const history = (msgHistory.get(key) || []).filter((m) => now - m.at < windowMs);
  history.push({ at: now, text: clean });
  if (history.length > 30) history.splice(0, history.length - 30);
  msgHistory.set(key, history);

  const reasons = [];

  /* ١) تكرار نفس الكلام (تشابه ٨٥٪+) */
  const repeatLimit = Math.max(2, Number(anti.repeatLimit ?? 3));
  if (clean.length >= 3) {
    const threshold = Number(anti.similarity ?? 0.85);
    const dupes = history.filter((m) => m.text.length >= 3 && similarity(m.text, clean) >= threshold).length;
    if (dupes >= repeatLimit) reasons.push('تكرار نفس الكلام');
  }

  /* ٢) رسائل سريعة متتالية */
  const rateWindow = Math.max(2, Number(anti.rateSeconds ?? 12)) * 1000;
  const rateLimit = Math.max(3, Number(anti.rateMessages ?? 7));
  const burst = history.filter((m) => now - m.at < rateWindow).length;
  if (burst >= rateLimit) reasons.push('رسائل سريعة متتالية');

  /* ٣) حروف/رموز مكرّرة (ااااااا · !!!!!!!) */
  const repeatChars = Math.max(4, Number(anti.repeatChars ?? 8));
  const raw = String(content || '');
  if (new RegExp(`(.)\\1{${repeatChars - 1},}`, 'u').test(raw)) reasons.push('حروف مكرّرة');

  /* تنظيف الذاكرة */
  if (msgHistory.size > 3000) msgHistory.clear();
  if (spamMutes.size > 3000) {
    for (const [k, until] of spamMutes) if (until <= now) spamMutes.delete(k);
  }

  if (!reasons.length) return { spam: false, muted: spamStatus(guildId, userId).muted };

  const minutes = Math.max(1, Number(anti.muteMinutes ?? 5));
  const until = now + minutes * 60 * 1000;
  spamMutes.set(key, until);
  msgHistory.delete(key); // نبدأ صفحة جديدة بعد العقوبة
  console.log(`[حماية] سبام من عضو (${reasons[0]}) — إيقاف خبرته ${minutes} دقائق`);

  return { spam: true, muted: true, until, reason: reasons[0], minutes };
}

/** رفع الحظر اليدوي (للاختبار/أمر إداري) */
function clearSpamMute(guildId, userId) {
  return spamMutes.delete(`${guildId}:${userId}`);
}

/** معرفة سبب سبام مسجّل (للعرض) */
function spamReason(guildId, userId) {
  return spamStatus(guildId, userId);
}

/* --------------------------- حمايات التفاعل (ذاكرة) --------------------------- */

/** من تفاعل مع كل رسالة (نمنع تكرار نفس الشخص + نحدّد سقفًا لكل رسالة) */
const reactionSeen = new Map();
/** كولداون بين (المتفاعل → صاحب الرسالة) */
const pairCooldown = new Map();

const PAIR_COOLDOWN_MS = 60 * 1000;

function pruneReactionCaches() {
  if (reactionSeen.size > 5000) reactionSeen.clear();
  if (pairCooldown.size > 5000) {
    const cutoff = Date.now() - PAIR_COOLDOWN_MS;
    for (const [key, ts] of pairCooldown) if (ts < cutoff) pairCooldown.delete(key);
  }
}

/** هل المصدر مفعّل في إعدادات السيرفر؟ */
function sourceEnabled(cfg, source) {
  if (!cfg) return false;
  if (source === 'voice') return cfg.voiceXp !== false;
  if (source === 'interact') return cfg.interactXp !== false;
  return cfg.textXp !== false; // text
}

/** توزيع الخبرة على المصادر في الفترات */
function bumpPeriods(guildId, userId, amount, source, counters, cfg, at = Date.now()) {
  for (const period of ['day', 'week', 'month']) {
    const key = periods.periodKey(period, new Date(at), cfg);
    if (!key) continue;
    db.addPeriodXp(guildId, userId, period, key, { xp: amount, source, ...counters, at });
  }
}

/**
 * إضافة خبرة لعضو مع فحص الكولداون والترقية.
 * @param {object} client عميل ديسكورد
 * @param {object} member العضو
 * @param {number} amount كمية الخبرة
 * @param {{source?:'text'|'voice'|'interact', bypassCooldown?:boolean, messages?:number, voiceMinutes?:number, interactions?:number}} options
 * @returns {Promise<{leveledUp:boolean, level:number, xp:number, source:string}|null>}
 */
async function addXp(client, member, amount, options = {}) {
  try {
    if (!member?.guild || member.user?.bot) return null;
    const { source = 'text', bypassCooldown = false, messages = 0, voiceMinutes = 0, interactions = 0 } = options;

    const guild = member.guild;
    const settings = db.getGuildSettings(guild.id);
    const cfg = settings.leveling;
    if (!cfg?.enabled) return null;
    if (!sourceEnabled(cfg, source)) return null;

    /* الحماية الذكية: الممنوع بسبب سبام ما ياخذ خبرة من أي مصدر (كتابي · صوتي · تفاعل) */
    if (options.respectSpamGuard !== false && spamStatus(guild.id, member.id).muted) return null;

    const row = db.getLevelRow(guild.id, member.id);
    const now = Date.now();
    const cooldownMs = Math.max(0, Number(cfg.cooldownSeconds ?? 60)) * 1000; // ٠ = بلا كولداون

    // الكولداون يخصّ الخبرة الكتابية فقط (الصوتية والتفاعل لها حماياتها)
    if (source === 'text' && !bypassCooldown && row && now - row.last_xp_at < cooldownMs) return null;

    try {
      amount = require('../lib/premium').boostXp(guild.id, amount);
    } catch {
      /* الاشتراك اختياري — الخبرة العادية تبقى */
    }
    const xp = (row?.xp ?? 0) + amount;
    const before = levelFromXp(row?.xp ?? 0).level;
    const after = levelFromXp(xp);

    db.upsertLevel(guild.id, member.id, {
      xp,
      level: after.level,
      messages: (row?.messages ?? 0) + (source === 'text' ? 1 : 0) * (messages || (bypassCooldown ? 0 : 1)),
      voiceMinutes: (row?.voice_minutes ?? 0) + voiceMinutes,
      interactions: (row?.interactions ?? 0) + interactions,
      textXp: (row?.text_xp ?? 0) + (source === 'text' ? amount : 0),
      voiceXp: (row?.voice_xp ?? 0) + (source === 'voice' ? amount : 0),
      interactXp: (row?.interact_xp ?? 0) + (source === 'interact' ? amount : 0),
      lastXpAt: source === 'text' ? now : row?.last_xp_at ?? now,
    });

    // تحديث فترات توب داي / توب ويك
    bumpPeriods(
      guild.id,
      member.id,
      amount,
      source,
      {
        messages: source === 'text' ? messages || (bypassCooldown ? 0 : 1) : 0,
        voiceMinutes,
        interactions,
      },
      cfg,
      now,
    );

    if (after.level > before) {
      await handleLevelUp(client, member, after.level, cfg);
      return { leveledUp: true, level: after.level, xp, source };
    }
    return { leveledUp: false, level: after.level, xp, source };
  } catch (err) {
    console.error('[تنبيه] خطأ نظام المستويات:', err.message);
    return null;
  }
}

/** الترقية: رسالة + مكافآت الرتب */
async function handleLevelUp(client, member, level, cfg) {
  const guild = member.guild;

  // مكافأة الرتب
  const reward = (cfg.rewards || []).find((r) => Number(r.level) === Number(level));
  if (reward?.roleId) {
    const role = guild.roles.cache.get(reward.roleId);
    if (role && guild.members.me && role.position < guild.members.me.roles.highest.position) {
      await member.roles.add(role, `مكافأة المستوى ${level}`).catch(() => {});
    }
  }

  const text = String(cfg.levelUpMessage || 'وصل {user} إلى المستوى **{level}**.')
    .replace(/\{user\}/g, `${member}`)
    .replace(/\{level\}/g, String(level))
    .replace(/\{server\}/g, guild.name);

  const channel = cfg.announceChannelId ? guild.channels.cache.get(cfg.announceChannelId) : null;
  const payload = { content: text };

  /* بلا رسالة خاصة للفل — التنبيه للروم المحدّد فقط (السياسة: الخاص = تحذير · قبول · رفض) */
  if (channel?.isTextBased?.() && !cfg.silent) await channel.send(payload).catch(() => {});
}

/** XP القنوات الصوتية — تُنادى كل دقيقة من المؤقت العام */
async function tickVoiceXp(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      const settings = db.getGuildSettings(guild.id);
      const cfg = settings.leveling;
      if (!cfg?.enabled || !cfg.voiceXp) continue;

      /* الفاصل الصوتي: المؤقت يشتغل كل دقيقة، ونمنح كل ما مرّ الفاصل المطلوب */
      const intervalSeconds = Math.max(30, Number(cfg.voiceIntervalSeconds ?? 60));
      voiceTicks.set(guild.id, (voiceTicks.get(guild.id) || 0) + 1);
      const ticksNeeded = Math.max(1, Math.round(intervalSeconds / 60));
      if (voiceTicks.get(guild.id) % ticksNeeded !== 0) continue;

      const afkChannelId = guild.afkChannelId;
      for (const state of guild.voiceStates.cache.values()) {
        const member = state.member;
        if (!member || member.user.bot) continue;
        if (!state.channelId || state.channelId === afkChannelId) continue;
        if (state.selfDeaf || state.deaf) continue;
        // لا خبرة إذا كان وحده في القناة
        const humans = state.channel?.members?.filter((m) => !m.user.bot).size ?? 0;
        if (humans < 2) continue;
        if ((cfg.ignoredRoles || []).some((r) => member.roles.cache.has(r))) continue;

        const perInterval = Math.max(1, Number(cfg.voiceXpPerInterval ?? 1));
        await addXp(client, member, perInterval, {
          source: 'voice',
          bypassCooldown: true,
          voiceMinutes: Math.round(intervalSeconds / 60),
        });
      }
    }
  } catch (err) {
    console.error('[تنبيه] خطأ XP الصوتي:', err.message);
  }
}

/** معالجة رسالة ومنح خبرة كتابية */
async function handleMessage(client, message) {
  if (!message.guild || !message.member || message.author.bot) return null;
  const settings = db.getGuildSettings(message.guild.id);
  const cfg = settings.leveling;
  if (!cfg?.enabled || cfg.textXp === false) return null;

  // استثناء قنوات محددة
  if ((cfg.ignoredChannels || []).includes(message.channelId)) return null;
  if ((cfg.ignoredRoles || []).some((r) => message.member.roles.cache.has(r))) return null;

  /* فحص السبام أولًا: تكرار الكلام أو رسائل سريعة = بلا خبرة ٥ دقايق */
  const spam = noteMessage(message.guild.id, message.author.id, message.content, cfg);
  if (spam.muted) return { blocked: true, reason: spam.reason || 'spam_mute' };

  const { xp, chars } = textXpFor(message.content, cfg);
  if (!xp) return null; // رسالة بلا حروف (إيموجي/صور فقط) = بلا خبرة

  db.bumpDaily(message.guild.id, 'messages');
  return addXp(client, message.member, xp, { source: 'text', messages: 1, chars });
}

/**
 * خبرة التفاعل: شخص تفاعل مع رسالة عضو → خبرة لصاحب الرسالة.
 * حمايات: بلا بوتات، بلا تفاعل على نفسك، تفاعل واحد لكل شخص لكل رسالة،
 *         سقف لكل رسالة، كولداون بين نفس الشخصين، وسقف يومي.
 */
async function handleReaction(client, reaction, user) {
  try {
    if (!user || user.bot) return false;

    // نجلب الرسالة كاملة لو كانت جزئية (رسائل قديمة)
    let message = reaction.message;
    if (message?.partial) message = await message.fetch().catch(() => null);
    if (!message?.guild) return false;
    if (message.author?.bot) return false;
    if (message.author?.id === user.id) return false; // ما تاخذ خبرة على تفاعلك على رسالتك

    const guild = message.guild;
    const cfg = db.getGuildSettings(guild.id).leveling;
    if (!cfg?.enabled || cfg.interactXp === false) return false;
    if ((cfg.ignoredChannels || []).includes(message.channelId)) return false;

    const member = message.member || (await guild.members.fetch(message.author.id).catch(() => null));
    if (!member || member.user.bot) return false;
    if ((cfg.ignoredRoles || []).some((r) => member.roles.cache.has(r))) return false;

    pruneReactionCaches();

    // سقف التفاعلات لكل رسالة + منع تكرار نفس الشخص
    const seenKey = `${guild.id}:${message.id}`;
    const seen = reactionSeen.get(seenKey) || new Set();
    const maxPerMessage = Math.max(1, Number(cfg.interactMaxPerMessage ?? 5));
    if (seen.has(user.id)) return false;
    if (seen.size >= maxPerMessage) return false;
    seen.add(user.id);
    reactionSeen.set(seenKey, seen);

    // كولداون بين نفس المتفاعل ونفس صاحب الرسالة (يمنع التبادل السريع)
    const pairKey = `${user.id}:${member.id}`;
    const lastAt = pairCooldown.get(pairKey) || 0;
    if (Date.now() - lastAt < PAIR_COOLDOWN_MS) return false;
    pairCooldown.set(pairKey, Date.now());

    // السقف اليومي للتفاعل
    const cap = Math.max(0, Number(cfg.interactDailyCap ?? 60));
    const dayRow = db.getPeriodRow(guild.id, member.id, 'day', periods.dayKey(new Date(), cfg));
    const usedToday = dayRow?.interact_xp ?? 0;
    if (cap && usedToday >= cap) return false;

    let amount = randomXp(cfg.interactMinXp ?? 2, cfg.interactMaxXp ?? 5);
    if (cap) amount = Math.min(amount, cap - usedToday);

    const granted = await addXp(client, member, amount, { source: 'interact', interactions: 1, bypassCooldown: true });

    // مكافأة اختيارية لمن تفاعل (تشجيع التفاعل المجتمعي)
    if (cfg.interactGivenXp) {
      const reactor = guild.members.cache.get(user.id) || (await guild.members.fetch(user.id).catch(() => null));
      if (reactor && !reactor.user.bot) {
        await addXp(client, reactor, 1, { source: 'interact', bypassCooldown: true });
      }
    }

    return Boolean(granted);
  } catch (err) {
    console.error('[تنبيه] خطأ خبرة التفاعل:', err.message);
    return false;
  }
}

/* ---------------------------------- الاستعلامات ---------------------------------- */

const GLOBAL_RANK_LIMIT = 1000;

/** بيانات ترتيب عضو: عام + اليوم + الأسبوع + توزيع المصادر */
function getRankData(guildId, userId) {
  const cfg = db.getGuildSettings(guildId).leveling || {};
  const now = new Date();

  const row = db.getLevelRow(guildId, userId) || { xp: 0, level: 0, messages: 0, voice_minutes: 0 };
  const info = levelFromXp(row.xp);
  const board = db.getLeaderboard(guildId, GLOBAL_RANK_LIMIT, 0);
  const position = board.findIndex((r) => r.user_id === userId) + 1;

  const dayKey = periods.dayKey(now, cfg);
  const weekKey = periods.weekKey(now, cfg);
  const dayRow = db.getPeriodRow(guildId, userId, 'day', dayKey);
  const weekRow = db.getPeriodRow(guildId, userId, 'week', weekKey);

  return {
    ...info,
    xp: row.xp,
    messages: row.messages,
    voiceMinutes: row.voice_minutes,
    interactions: row.interactions ?? 0,
    textXp: row.text_xp ?? 0,
    voiceXp: row.voice_xp ?? 0,
    interactXp: row.interact_xp ?? 0,
    rank: position || board.length + 1,
    total: board.length,
    day: { xp: dayRow?.xp ?? 0, rank: db.getPeriodRank(guildId, userId, 'day', dayKey), key: dayKey, reset: periods.resetLabel('day', now, cfg) },
    week: { xp: weekRow?.xp ?? 0, rank: db.getPeriodRank(guildId, userId, 'week', weekKey), key: weekKey, reset: periods.resetLabel('week', now, cfg) },
  };
}

/**
 * صفوف لوحة المتصدّرين لأي فترة/مصدر (يُستخدم في البوت والموقع).
 * @returns {{ rows:Array, total:number, period:string, source:string, key:string|null, reset:string, totals:object }}
 */
function getBoard(guildId, { period = 'day', source = 'all', page = 1, perPage = 10 } = {}) {
  const cfg = db.getGuildSettings(guildId).leveling || {};
  const now = new Date();
  const safePeriod = periods.isPeriod(period) ? period : 'day';
  const safeSource = periods.isSource(source) ? source : 'all';
  const key = periods.periodKey(safePeriod, now, cfg);

  const offset = Math.max(0, (Math.max(1, page) - 1) * perPage);

  if (safePeriod === 'all' || !key) {
    let rows = db.getLeaderboard(guildId, GLOBAL_RANK_LIMIT, 0);
    if (safeSource !== 'all') rows = rows.filter((r) => (r[periods.SOURCES[safeSource].column] || 0) > 0);
    const column = periods.SOURCES[safeSource].column;
    if (safeSource !== 'all') rows = [...rows].sort((a, b) => (b[column] || 0) - (a[column] || 0));
    return {
      rows: rows.slice(offset, offset + perPage).map((r) => ({ ...r, board_xp: r[column] || 0, level: r.level ?? levelFromXp(r.xp).level })),
      total: rows.length,
      period: 'all',
      source: safeSource,
      key: null,
      reset: 'بلا تجديد',
      totals: db.getXpTotals(guildId),
    };
  }

  // فترات (يوم/أسبوع)
  const pool = db.getPeriodLeaderboard(guildId, safePeriod, key, GLOBAL_RANK_LIMIT, 0);
  const column = periods.SOURCES[safeSource].column;
  let rows = pool;
  if (safeSource !== 'all') rows = [...pool].filter((r) => (r[column] || 0) > 0).sort((a, b) => (b[column] || 0) - (a[column] || 0));

  return {
    rows: rows.slice(offset, offset + perPage).map((r) => ({ ...r, board_xp: r[column] || 0, level: (db.getLevelRow(guildId, r.user_id) || {}).level ?? 0 })),
    total: rows.length,
    period: safePeriod,
    source: safeSource,
    key,
    reset: periods.resetLabel(safePeriod, now, cfg),
    totals: db.getXpTotals(guildId, safePeriod, key),
  };
}

/* ---------------------------------- الإمبيدات ---------------------------------- */

/** بناء embed الترتيب الشخصي */
function rankEmbed(member, lang = 'ar') {
  const data = getRankData(member.guild.id, member.id);
  const bar = progressBar(data.xpIntoLevel, data.xpForNext, 12);
  const ar = lang === 'ar';
  const rankText = (info) => (info.rank ? `#${info.rank}` : '—');

  return base({
    color: 0x5865f2,
    title: t(lang, 'leveling.rankTitle', { user: member.user.username }),
    thumbnail: member.user.displayAvatarURL({ size: 256 }),
    fields: [
      { name: t(lang, 'leveling.level'), value: `**${data.level}**`, inline: true },
      { name: ar ? 'الترتيب العام' : 'Global rank', value: `**${rankText(data)}** / ${data.total}`, inline: true },
      { name: t(lang, 'leveling.xp'), value: `**${humanize(data.xp)}** XP`, inline: true },
      { name: `${data.xpIntoLevel} / ${data.xpForNext} XP`, value: `${bar}`, inline: false },
      {
        name: ar ? 'توب داي (اليوم)' : 'Daily',
        value: `${ar ? 'الخبرة' : 'XP'}: **${humanize(data.day.xp)}**\n${ar ? 'الترتيب' : 'Rank'}: **${rankText(data.day)}**\n_${data.day.reset}_`,
        inline: true,
      },
      {
        name: ar ? 'توب ويك (هذا الأسبوع)' : 'Weekly',
        value: `${ar ? 'الخبرة' : 'XP'}: **${humanize(data.week.xp)}**\n${ar ? 'الترتيب' : 'Rank'}: **${rankText(data.week)}**\n_${data.week.reset}_`,
        inline: true,
      },
      {
        name: ar ? 'مصادر الخبرة' : 'XP sources',
        value: [
          `${ar ? 'كتابي' : 'Text'}: **${humanize(data.textXp)}**`,
          `${ar ? 'صوتي' : 'Voice'}: **${humanize(data.voiceXp)}**`,
          `${ar ? 'تفاعل' : 'Interactions'}: **${humanize(data.interactXp)}**`,
        ].join(' • '),
        inline: false,
      },
      { name: ar ? 'رسائل' : 'Messages', value: `**${humanize(data.messages)}**`, inline: true },
      { name: ar ? 'دقائق صوتية' : 'Voice minutes', value: `**${humanize(data.voiceMinutes)}**`, inline: true },
      { name: ar ? 'تفاعلات' : 'Reactions', value: `**${humanize(data.interactions)}**`, inline: true },
    ],
  });
}

/** بناء embed لوحة المتصدّرين (تدعم اليوم/الأسبوع/الكل + المصدر) */
function leaderboardEmbed(guildId, rowsOrOptions = [], lang = 'ar', pageArg = 1, perPageArg = 10) {
  const ar = lang === 'ar';

  // استدعاء قديم: (guildId, rows, lang, page)
  const legacy = Array.isArray(rowsOrOptions);
  const options = legacy ? { period: 'all', source: 'all', page: pageArg, perPage: perPageArg, presetRows: rowsOrOptions } : rowsOrOptions;

  const board = legacy
    ? {
        rows: options.presetRows.slice((options.page - 1) * options.perPage, options.page * options.perPage)
          .map((r) => ({ ...r, board_xp: r.xp, level: r.level ?? levelFromXp(r.xp).level })),
        total: options.presetRows.length,
        period: 'all',
        source: 'all',
        key: null,
        reset: 'بلا تجديد',
      }
    : getBoard(guildId, options);

  const periodMeta = periods.PERIODS[board.period] || periods.PERIODS.all;
  const sourceMeta = periods.SOURCES[board.source] || periods.SOURCES.all;
  const page = Math.max(1, Number(options.page) || 1);
  const title = board.period === 'all'
    ? (ar ? 'لوحة المتصدّرين — كل الأوقات' : 'Leaderboard — All time')
    : (ar ? `لوحة المتصدّرين — ${periodMeta.short}` : `Leaderboard — ${periodMeta.key}`);

  if (!board.rows.length) {
    return base({
      color: 0x5865f2,
      title,
      description: ar ? 'ما في بيانات لهذه الفترة بعد — خلّوا الأعضاء يتفاعلون!' : 'No data for this period yet.',
      footer: board.source !== 'all' ? `${ar ? 'المصدر' : 'Source'}: ${sourceMeta.label}` : undefined,
    });
  }

  const medals = ['01', '02', '03']; // بلا إيموجي كيبورد
  const start = (page - 1) * (options.perPage || 10);
  const lines = board.rows.map((row, i) => {
    const position = start + i + 1;
    const badge = position <= 3 ? `**${medals[position - 1]}**` : `\`#${position}\``;
    const xp = humanize(row.board_xp ?? row.xp);
    const level = row.level ?? 0;
    const breakdown = board.source === 'all' && board.period !== 'all'
      ? ` • K:${humanize(row.text_xp || 0)} V:${humanize(row.voice_xp || 0)} I:${humanize(row.interact_xp || 0)}`
      : '';
    return `${badge} <@${row.user_id}> — **${xp}** XP (${ar ? 'مستوى' : 'lvl'} ${level})${breakdown}`;
  });

  const totalsLine = board.period === 'all'
    ? null
    : (ar
      ? `مجموع خبرة الفترة: **${humanize(board.totals?.xp || 0)}** XP • مشاركون: **${board.total}**`
      : `Period total: **${humanize(board.totals?.xp || 0)}** XP • Participants: **${board.total}**`);

  return base({
    color: board.period === 'week' ? 0x57f287 : board.period === 'day' ? 0xfee75c : 0x5865f2,
    title: `${ar ? 'توب' : 'Top'} — ${title.replace(ar ? 'لوحة المتصدّرين — ' : 'Leaderboard — ', '')}`,
    description: lines.join('\n'),
    fields: [
      ...(totalsLine ? [{ name: ar ? 'إحصاء الفترة' : 'Period stats', value: totalsLine, inline: false }] : []),
      {
        name: ar ? 'التفاصيل' : 'Details',
        value: ar
          ? `الفترة: **${periodMeta.label}** • المصدر: **${sourceMeta.label}**\n${board.reset}`
          : `Period: **${periodMeta.key}** • Source: **${sourceMeta.key}**\n${board.reset}`,
        inline: false,
      },
    ],
    footer: `${ar ? 'صفحة' : 'Page'} ${page} • ${ar ? 'K كتابي · V صوتي · I تفاعل' : 'K text · V voice · I interactions'}`,
  });
}

/**
 * 🏆 لوحة المتصدّرين بالتنظيم المعروف (توب داي · توب ويك · توب منث):
 *   • العنوان: توب — الفترة · النوع (مثال: توب — توب داي · كتابي)
 *   • كل سطر: ميدالية/رقم + المنشن + الخبرة + المستوى
 *   • الفوتر: الصفحة من المجموع + وقت التجديد
 * تُستخدم في /top (سلاش) وفي أوامر الشات: t day · t week · t month · t text week 2
 */
function topBoardEmbed(guildId, { period = 'day', source = 'all', page = 1, perPage = 10 } = {}, lang = 'ar') {
  const ar = lang === 'ar';
  const pageNum = Math.max(1, Number(page) || 1);
  const board = getBoard(guildId, { period, source, page: pageNum, perPage });
  const periodMeta = periods.PERIODS[board.period] || periods.PERIODS.day;
  const sourceMeta = periods.SOURCES[board.source] || periods.SOURCES.all;
  const pages = Math.max(1, Math.ceil(board.total / perPage));
  const title = `🏆 ${ar ? 'توب' : 'Top'} — ${ar ? periodMeta.short : periodMeta.key}${board.source === 'all' ? '' : ` · ${sourceMeta.label}`}`;

  if (!board.rows.length) {
    return base({
      color: 0x5865f2,
      title,
      description: ar
        ? 'ما في بيانات لهذه الفترة بعد — خلّوا الأعضاء يكتبون ويتكلمون في الرومات الصوتية!'
        : 'No data for this period yet.',
      footer: ar ? 'يتجدّد تلقائيًا' : 'Resets automatically',
    });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const start = (pageNum - 1) * perPage;
  const lines = board.rows.map((row, i) => {
    const position = start + i + 1;
    const badge = position <= 3 ? medals[position - 1] : `**#${position}**`;
    const xp = humanize(row.board_xp ?? row.xp ?? 0);
    const level = row.level ?? 0;
    const extra = board.source === 'all'
      ? ` · ${ar ? 'م' : 'T'}:${humanize(row.text_xp || 0)} ${ar ? 'ص' : 'V'}:${humanize(row.voice_xp || 0)}`
      : '';
    return `${badge} <@${row.user_id}> — **${xp}** XP · ${ar ? 'مستوى' : 'lvl'} **${level}**${extra}`;
  });

  const reset = board.period === 'all' ? (ar ? 'بلا تجديد' : 'All time') : board.reset;

  return base({
    color: board.period === 'week' ? 0x57f287 : board.period === 'month' ? 0xeb459e : board.period === 'day' ? 0xfee75c : 0x5865f2,
    title,
    description: lines.join('\n'),
    fields: [
      { name: ar ? 'المشاركون' : 'Participants', value: `**${board.total}**`, inline: true },
      { name: ar ? 'مجموع الخبرة' : 'Total XP', value: `**${humanize(board.totals?.xp || 0)}**`, inline: true },
      { name: ar ? 'التجديد' : 'Resets', value: reset, inline: true },
      ...(pages > 1 ? [{ name: ar ? 'الصفحة' : 'Page', value: `${pageNum}/${pages}`, inline: true }] : []),
    ],
    /* بلا تذييل — رقم الصفحة يظهر في الحقول فقط لو في أكثر من صفحة */
  });
}

/** embed بسيط لملخص المصادر (نظرة سريعة) */
function sourcesEmbed(guildId, lang = 'ar') {
  const ar = lang === 'ar';
  const totals = {
    all: db.getXpTotals(guildId),
    day: (() => {
      const cfg = db.getGuildSettings(guildId).leveling || {};
      return db.getXpTotals(guildId, 'day', periods.dayKey(new Date(), cfg));
    })(),
    week: (() => {
      const cfg = db.getGuildSettings(guildId).leveling || {};
      return db.getXpTotals(guildId, 'week', periods.weekKey(new Date(), cfg));
    })(),
    month: (() => {
      const cfg = db.getGuildSettings(guildId).leveling || {};
      return db.getXpTotals(guildId, 'month', periods.monthKey(new Date(), cfg));
    })(),
  };
  const cfg = db.getGuildSettings(guildId).leveling || {};
  const how = ar
    ? `**كيف تُحسب الخبرة**\nكتابي: كل **${cfg.textXpPerChars ?? 5} أحرف** = **${cfg.textXpPerCharsAmount ?? 1}** خبرة\nصوتي: كل **${cfg.voiceIntervalSeconds ?? 60} ثانية** في الروم = **${cfg.voiceXpPerInterval ?? 1}** خبرة\nتفاعل: خبرة لما يتفاعل الأعضاء مع رسائلك\n${
        cfg.antiSpam?.enabled === false
          ? ''
          : `حماية السبام: من يكرّر الكلام أو يسبام → **بلا خبرة ${cfg.antiSpam?.muteMinutes ?? 5} دقايق**`
      }`
    : `Text: every **${cfg.textXpPerChars ?? 5} chars** = **${cfg.textXpPerCharsAmount ?? 1}** XP · Voice: every **${cfg.voiceIntervalSeconds ?? 60}s** = **${cfg.voiceXpPerInterval ?? 1}** XP`;

  return base({
    color: 0x5865f2,
    title: ar ? 'مصادر الخبرة في السيرفر' : 'Server XP sources',
    fields: [
      { name: ar ? 'طريقة الحساب' : 'How XP works', value: how, inline: false },
      ...periods.PERIOD_KEYS.map((key) => ({
        name: periods.PERIODS[key].short,
        value: ar
          ? `الإجمالي: **${humanize(totals[key].xp)}** XP\nكتابي: **${humanize(totals[key].text_xp)}** • صوتي: **${humanize(totals[key].voice_xp)}** • تفاعل: **${humanize(totals[key].interact_xp)}**`
          : `Total: **${humanize(totals[key].xp)}** XP\nText: **${humanize(totals[key].text_xp)}** • Voice: **${humanize(totals[key].voice_xp)}** • Interactions: **${humanize(totals[key].interact_xp)}**`,
        inline: false,
      })),
    ],
      });
}

module.exports = {
  addXp,
  handleMessage,
  handleReaction,
  tickVoiceXp,
  handleLevelUp,
  getRankData,
  getBoard,
  rankEmbed,
  leaderboardEmbed,
  topBoardEmbed,
  sourcesEmbed,
  levelFromXp,
  PERIODS: periods.PERIODS,
  SOURCES: periods.SOURCES,
  randomXp,
  /* الخبرة الكتابية بالأحرف */
  countChars,
  textXpFor,
  /* الحماية الذكية من السبام */
  noteMessage,
  spamStatus,
  spamReason,
  clearSpamMute,
  normalizeForCompare,
  similarity,
};
