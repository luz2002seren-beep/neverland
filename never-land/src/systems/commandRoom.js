'use strict';

/**
 * systems/commandRoom.js
 * -------------------------------------------------------------
 * 🧹 روم الأوامر: روم مخصّص للأوامر، البوت ينشر فيه **رسالة ترحيبية بصور السيرفر**،
 *     وبعدها **ينظّف كل الرسائل كل مدة محدّدة (٦٠ ثانية افتراضيًا)** — وما يمسح رسالته هو.
 *
 * كل شي قابل للتعديل من لوحة التحكم (قسم «روم الأوامر»):
 *   channelId · text · intervalSeconds · enabled · image
 *
 * الإعدادات تُحفظ في settings.commandRoom، مع افتراضيات من config.commandRoom.
 * -------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');
const db = require('../database');
const config = require('../config');

const ROOT = path.join(__dirname, '..', '..');
const BANNER_FILE = 'bannerId';

/* الحالة الحيّة (تظهر في /api/status للتشخيص) */
const STATE = {
  startedAt: 0,
  guilds: {},
};

const DEFAULTS = () => ({
  enabled: Boolean(config.commandRoom?.enabled),
  channelId: config.commandRoom?.channelId || null,
  text: config.commandRoom?.text || 'مرحبا بكم بسيرفر Never Land — هذا روم مخصص لاستخدام الأوامر وسيتم تنظيفه كل 60 ثانية.',
  intervalSeconds: Math.max(15, Number(config.commandRoom?.intervalSeconds) || 60),
  image: config.commandRoom?.image || 'src/web/public/assets/commands-room.png',
  pin: config.commandRoom?.pin === true,
  /* إعادة النشر: نحذف الرسالة ونبعت وحدة جديدة كل دورة (بلا «تم التعديل») */
  repost: config.commandRoom?.repost !== false,
});

/** إعدادات الروم لسيرفر (مع الافتراضيات) */
function configFor(guildId) {
  const defaults = DEFAULTS();
  let saved = {};
  try {
    saved = db.getGuildSettings(guildId)?.commandRoom || {};
  } catch {
    saved = {};
  }
  const interval = Number(saved.intervalSeconds ?? defaults.intervalSeconds);
  return {
    enabled: saved.enabled === undefined ? defaults.enabled : Boolean(saved.enabled),
    channelId: saved.channelId === undefined ? defaults.channelId : saved.channelId,
    text: (saved.text === undefined ? defaults.text : saved.text) || '',
    intervalSeconds: Math.min(3600, Math.max(15, Number.isFinite(interval) && interval > 0 ? interval : defaults.intervalSeconds)),
    image: saved.image === undefined ? defaults.image : saved.image,
    pin: saved.pin === undefined ? defaults.pin : Boolean(saved.pin),
    repost: saved.repost === undefined ? defaults.repost : Boolean(saved.repost),
    /* رقم رسالة الترحيب (محفوظ حتى ما نمسحها ونعرف نعدّلها) */
    bannerId: saved[BANNER_FILE] || null,
  };
}

/** يحفظ رقم رسالة الترحيب */
function saveBanner(guildId, messageId) {
  try {
    const current = db.getGuildSettings(guildId)?.commandRoom || {};
    db.updateGuildSettings(guildId, { commandRoom: { ...current, [BANNER_FILE]: messageId } });
  } catch { /* الحفظ فشل؟ نكمل — الرسالة نفسها انبعتت */ }
}

/** مسار ملف الصورة (يتحمّل رابط خارجي كذلك) */
function imagePath(cfg) {
  if (!cfg.image) return null;
  if (/^https?:\/\//i.test(cfg.image)) return cfg.image;
  const full = path.isAbsolute(cfg.image) ? cfg.image : path.join(ROOT, cfg.image);
  return fs.existsSync(full) ? full : null;
}

/**
 * 👋 ينشر (أو يعدّل) رسالة الترحيب بالصورة في روم الأوامر.
 * @returns {Promise<{ok:boolean, messageId?:string, edited?:boolean, reason?:string}>}
 */
async function publish(client, guild, { force = false } = {}) {
  const cfg = configFor(guild.id);
  if (!cfg.channelId) return { ok: false, reason: 'noChannel' };

  const channel = guild.channels.cache.get(cfg.channelId) || (await guild.channels.fetch(cfg.channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return { ok: false, reason: 'noChannel' };

  const file = imagePath(cfg);
  /* __raw: الرسالة تنزل بنصّها العربي كما هي (بلا ترجمة ولا خط مزخرف) */
  const payload = () => {
    const body = { content: cfg.text, __raw: true };
    if (file) body.files = [file];
    return body;
  };

  /* ١) في رسالة منشورة من قبل؟ */
  if (cfg.bannerId) {
    const existing = await channel.messages.fetch(cfg.bannerId).catch(() => null);
    if (existing) {
      if (cfg.repost) {
        /* إعادة النشر: نحذف القديمة (ونفك التثبيت إن كان مثبّتًا) ونبعت وحدة جديدة كل دورة */
        await existing.unpin().catch(() => {});
        await existing.delete().catch(() => {});
      } else if (!force) {
        /* وضع التعديل: نحدّث نفس الرسالة (تظهر عندها كلمة «تم التعديل») */
        const edited = await existing
          .edit(file ? { content: cfg.text, files: [file], __raw: true } : { content: cfg.text, __raw: true })
          .catch(() => null);
        if (edited) return { ok: true, messageId: existing.id, edited: true, channelId: channel.id };
      }
    }
  }

  /* ٢) ننشر رسالة جديدة (ونمسح النسخ القديمة لو موجودة) */
  const sent = await channel.send(payload()).catch((err) => {
    STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), lastError: `publish: ${err.message}` };
    return null;
  });
  if (!sent) return { ok: false, reason: 'sendFailed' };

  saveBanner(guild.id, sent.id);
  /* التثبيت ما إله معنى مع إعادة النشر كل دورة (الرسالة تُحذف وتُستبدل) — فما نثبّت */
  if (cfg.pin && !cfg.repost) await sent.pin().catch(() => {});
  return { ok: true, messageId: sent.id, edited: false, channelId: channel.id };
}

/**
 * 🧹 يمسح كل رسائل الروم ما عدا رسالة الترحيب.
 * @returns {Promise<{ok:boolean, deleted:number, reason?:string}>}
 */
async function clean(client, guild, { keepId = null } = {}) {
  const cfg = configFor(guild.id);
  if (!cfg.channelId) return { ok: false, deleted: 0, reason: 'noChannel' };

  const channel = guild.channels.cache.get(cfg.channelId) || (await guild.channels.fetch(cfg.channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return { ok: false, deleted: 0, reason: 'noChannel' };

  const keep = keepId || cfg.bannerId;
  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!fetched) return { ok: false, deleted: 0, reason: 'fetchFailed' };

  const toDelete = [...fetched.values()].filter((m) => m.id !== keep && !m.pinned);
  if (!toDelete.length) return { ok: true, deleted: 0, channelId: channel.id };

  let deleted = 0;

  /* ١) الحذف الجماعي أسرع — filterOld=true تخليه يتجاوز الأقدم من ١٤ يومًا */
  const bulkable = toDelete.filter((m) => Date.now() - m.createdTimestamp < 14 * 24 * 3600 * 1000);
  if (bulkable.length && typeof channel.bulkDelete === 'function') {
    const result = await channel.bulkDelete(bulkable, true).catch(() => null);
    if (result && typeof result.size === 'number') deleted += result.size;
    else {
      /* فشل الجماعي: نحذف واحد واحد */
      for (const message of bulkable) {
        const ok = await message.delete().then(() => true).catch(() => false);
        if (ok) deleted += 1;
      }
    }
  }

  /* ٢) القديمة (أكثر من ١٤ يومًا) تُحذف فرديًا */
  const old = toDelete.filter((m) => Date.now() - m.createdTimestamp >= 14 * 24 * 3600 * 1000);
  for (const message of old) {
    const ok = await message.delete().then(() => true).catch(() => false);
    if (ok) deleted += 1;
  }

  return { ok: true, deleted, channelId: channel.id };
}

/** دورة كاملة: تأكيد وجود رسالة الترحيب + تنظيف الباقي */
async function runOnce(client, guildId, { force = false } = {}) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { ok: false, reason: 'noGuild' };

  const cfg = configFor(guildId);
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };

  const published = await publish(client, guild, { force });
  const cleaned = await clean(client, guild);

  STATE.guilds[guildId] = {
    ...(STATE.guilds[guildId] || {}),
    enabled: cfg.enabled,
    channelId: cfg.channelId,
    intervalSeconds: cfg.intervalSeconds,
    bannerId: published.messageId || cfg.bannerId || null,
    lastRunAt: Date.now(),
    lastCleanedAt: cleaned.ok ? Date.now() : STATE.guilds[guildId]?.lastCleanedAt || null,
    deletedTotal: (STATE.guilds[guildId]?.deletedTotal || 0) + (cleaned.deleted || 0),
    lastDeleted: cleaned.deleted || 0,
    lastError: published.ok ? (cleaned.ok ? null : cleaned.reason) : published.reason,
  };

  return { ok: published.ok && cleaned.ok, published, cleaned };
}

/**
 * يشغّل المؤقّت العام: كل ١٠ ثوانٍ يفحص السيرفرات اللي حان وقت تنظيفها.
 * (كل سيرفر له مدته — الافتراضي ٦٠ ثانية)
 */
function start(client, { heartbeatMs = 10000 } = {}) {
  if (STATE.startedAt) return STATE.timer;
  STATE.startedAt = Date.now();

  const tick = async () => {
    for (const guild of client.guilds.cache.values()) {
      const cfg = configFor(guild.id);
      if (!cfg.enabled || !cfg.channelId) {
        STATE.guilds[guild.id] = {
          ...(STATE.guilds[guild.id] || {}),
          enabled: cfg.enabled,
          channelId: cfg.channelId,
          intervalSeconds: cfg.intervalSeconds,
        };
        continue;
      }
      const last = STATE.guilds[guild.id]?.lastRunAt || 0;
      if (Date.now() - last < cfg.intervalSeconds * 1000) continue;
      try {
        await runOnce(client, guild.id);
      } catch (err) {
        STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), lastError: err.message };
        console.error('[تنبيه] روم الأوامر:', err.message);
      }
    }
  };

  STATE.timer = setInterval(() => { tick().catch(() => {}); }, heartbeatMs);
  STATE.timer.unref?.();

  /* نشغّلها مرة فورًا بعد الإقلاع (نشر الرسالة + أول تنظيف) */
  setTimeout(() => { tick().catch(() => {}); }, 5000).unref?.();

  return STATE.timer;
}

/** حالة حيّة للتشخيص (تظهر في /api/status) */
function status() {
  return { startedAt: STATE.startedAt, guilds: STATE.guilds };
}

module.exports = { DEFAULTS, configFor, publish, clean, runOnce, start, status, imagePath };
