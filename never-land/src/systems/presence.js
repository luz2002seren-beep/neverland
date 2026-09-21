'use strict';

/**
 * systems/presence.js
 * -------------------------------------------------------------
 * 🟣 حالة البوت (Presence) — اللي تظهر تحت اسمه في كل السيرفرات:
 *
 *   name   الاسم الظاهر (الافتراضي: 𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅)
 *   type   streaming = حالة بث (بنفسجية + شارة «مباشر») · playing · watching · listening · competing · custom
 *   url    رابط البث (مطلوب لنوع streaming — ديسكورد يقبل twitch/youtube)
 *   status online · idle · dnd · invisible
 *
 * • التعديل من الموقع يُطبَّق **فورًا** على البوت الشغّال (بلا إعادة تشغيل).
 * • لو الرابط غلط أو ديسكورد رفض الحالة ⇒ نرجع تلقائيًا لحالة «يشتغل» العادية
 *   ونرجع سبب الفشل (ما نخلي البوت بلا حالة أبدًا).
 * -------------------------------------------------------------
 */

const config = require('../config');
const db = require('../database');

/** أنواع الحالة المسموحة + كيف تُكتب بالعربي */
const TYPES = {
  streaming: { key: 'streaming', label: 'بث مباشر (بنفسجي)', verb: 'يبثّ', needsUrl: true },
  playing: { key: 'playing', label: 'يلعب', verb: 'يشتغل على' },
  watching: { key: 'watching', label: 'يشاهد', verb: 'يشاهد' },
  listening: { key: 'listening', label: 'يسمع', verb: 'يسمع' },
  competing: { key: 'competing', label: 'يتنافس', verb: 'يتنافس في' },
  custom: { key: 'custom', label: 'حالة مخصّصة', verb: 'الحالة' },
};

/** الحالات المسموحة (للتحقق) */
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

/** الأسماء العربية للحالات */
const STATUS_LABELS = {
  online: 'متصل',
  idle: 'خامل',
  dnd: 'الرجاء عدم الإزعاج',
  invisible: 'غير ظاهر',
};

/** رابط بث افتراضي — ديسكورد يطلب رابطًا لنوع «بث مباشر» */
const DEFAULT_STREAM_URL = 'https://www.twitch.tv/never_land';

/** تحويل الاسم لنوع discord.js */
function activityType(discord, type) {
  const map = {
    streaming: discord.ActivityType.Streaming,
    playing: discord.ActivityType.Playing,
    watching: discord.ActivityType.Watching,
    listening: discord.ActivityType.Listening,
    competing: discord.ActivityType.Competing,
    custom: discord.ActivityType.Custom,
  };
  return map[String(type || '').toLowerCase()] ?? discord.ActivityType.Streaming;
}

/** تصحيح القيم بما يقبله ديسكورد (بلا رمي أخطاء) */
function normalize(raw = {}) {
  const defaults = config.bot.presence || {};
  const type = TYPES[String(raw.type ?? defaults.type ?? 'streaming').toLowerCase()]
    ? String(raw.type ?? defaults.type ?? 'streaming').toLowerCase()
    : 'streaming';
  const status = STATUSES.includes(String(raw.status ?? defaults.status ?? 'online').toLowerCase())
    ? String(raw.status ?? defaults.status ?? 'online').toLowerCase()
    : 'online';
  const url = String(raw.url ?? defaults.url ?? DEFAULT_STREAM_URL).trim() || DEFAULT_STREAM_URL;
  const rawName = String(raw.name ?? defaults.name ?? '').trim();
  return {
    name: (rawName || String(defaults.name || '').trim() || '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅').slice(0, 128),
    type,
    url,
    status,
  };
}

/** الإعدادات الحالية: الافتراضي + أي تعديل محفوظ من الموقع */
function current(guildId = null) {
  const saved = guildId ? (db.getGuildSettings(guildId)?.presence || null) : null;
  return normalize(saved || {});
}

/** وصف مقروء للحالة (يُستخدم في اللوحة والتشخيص) */
function describe(value = null, guildId = null) {
  const p = value ? normalize(value) : current(guildId);
  const meta = TYPES[p.type] || TYPES.streaming;
  return {
    ...p,
    typeLabel: meta.label,
    statusLabel: STATUS_LABELS[p.status] || p.status,
    text: `${meta.verb} ${p.name}`,
    purple: p.type === 'streaming',
  };
}

/**
 * يطبّق الحالة على البوت الشغّال فورًا.
 * @returns {{ok:boolean, applied:object, reason?:string}}
 */
function apply(client, value = null) {
  const p = value ? normalize(value) : current();
  if (!client?.user?.setPresence) return { ok: false, applied: p, reason: 'noClient' };

  const { ActivityType } = require('discord.js');
  const type = activityType({ ActivityType }, p.type);
  const activity = { name: p.name, type };
  /* نوع «بث مباشر» يحتاج رابطًا — وإلا ديسكورد يرفض الحالة */
  if (type === ActivityType.Streaming || p.type === 'streaming') activity.url = p.url;

  try {
    client.user.setPresence({ activities: [activity], status: p.status });
  } catch (err) {
    /* فشل؟ نرجع لحالة عادية حتى ما يبقى البوت بلا حالة */
    const fallback = { name: p.name, type: ActivityType.Playing };
    try {
      client.user.setPresence({ activities: [fallback], status: p.status });
    } catch { /* تجاهل */ }
    return { ok: false, applied: p, reason: err.message };
  }

  STATE.last = { ...p, at: Date.now() };
  return { ok: true, applied: p };
}

/** الحالة كما شافها ديسكورد آخر مرة (للتشخيص الحيّ) */
function applied(client) {
  const activity = client?.user?.presence?.activities?.[0] || null;
  const typeName = activity ? Object.keys(require('discord.js').ActivityType).find((k) => require('discord.js').ActivityType[k] === activity.type) : null;
  return {
    name: activity?.name ?? null,
    type: typeName ? String(typeName).toLowerCase() : null,
    url: activity?.url ?? null,
    status: client?.user?.presence?.status ?? null,
    purple: Boolean(activity && Number(activity.type) === require('discord.js').ActivityType.Streaming),
  };
}

const STATE = { last: null };

/**
 * يحفظ الحالة من الموقع ويطبّقها فورًا.
 * @param {string} guildId السيرفر اللي جاي منه التعديل (يُحفظ في إعداداته)
 */
function save(client, guildId, patch = {}) {
  const next = normalize({ ...current(guildId), ...patch });
  if (!guildId) return { ok: false, reason: 'noGuild', presence: next };
  try {
    db.updateGuildSettings(guildId, { presence: next });
  } catch (err) {
    return { ok: false, reason: err.message, presence: next };
  }
  const result = apply(client, next);
  return { ...result, presence: next };
}

module.exports = {
  TYPES,
  STATUSES,
  STATUS_LABELS,
  DEFAULT_STREAM_URL,
  normalize,
  current,
  describe,
  apply,
  applied,
  save,
  state: () => STATE.last,
};
