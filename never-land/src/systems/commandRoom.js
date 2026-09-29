'use strict';

/**
 * systems/commandRoom.js
 * -------------------------------------------------------------
 * 🧹 روم الأوامر: روم مخصّص للأوامر، البوت ينشر فيه **رسالة ترحيبية بصور السيرفر**،
 *     وبعدها **ينظّف كل الرسائل كل مدة محدّدة (٦٠ ثانية افتراضيًا)** — وما يمسح رسالته هو.
 *
 * كل شي قابل للتعديل من لوحة التحكم (قسم «روم الأوامر»):
 *   channelId · text · intervalSeconds · enabled · image · pin · repost
 *
 * الإعدادات تُحفظ في settings.commandRoom، مع افتراضيات من config.defaults.commandRoom.
 *
 * إضافات مهمّة:
 *   • النصّ القديم المحفوظ في الإعدادات يُرقّى تلقائيًا لأحدث نص (ما تبقى نسخة قديمة).
 *   • الإيموجي الخارجي (من سيرفر ثاني) يُضاف تلقائيًا للسيرفر — وإلا لإيموجيات البوت —
 *     ويُبدَّل رقمه في النص، وإن فشل كل شي يتحوّل لبديل يونيكود (✨) بدل النصّ القبيح «:lc0_66:».
 * -------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../database');
const config = require('../config');

const ROOT = path.join(__dirname, '..', '..');
const BANNER_FILE = 'bannerId';

/**
 * البانر الافتراضي (بالصيغة الحالية WebP). نرجع له احتياطيًا إذا كان المسار المحفوظ
 * من نسخة أقدم (مثل .png) غير موجود — حتى ما تختفي صورة الروم بصمت.
 */
const DEFAULT_BANNER = 'src/web/public/assets/commands-room.webp';

/** إعدادات المشروع (الافتراضيات) — تدعم الشكلين: داخل defaults أو في الجذر */
const CONFIG_ROOM = () => config.defaults?.commandRoom || config.commandRoom || {};

/** نصّ احتياطي لو ما في إعدادات محفوظة أصلًا */
const FALLBACK_TEXT = [
  '•    <a:lc0_66:1113856970638774292> 𝐍𝐄𝐕𝐄𝐑 𝐋𝐀𝐍𝐃 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 <a:lc0_66:1113856970638774292>    •',
  '',
  '> 𝑨 𝒑𝒓𝒊𝒗𝒂𝒕𝒆 𝒔𝒑𝒂𝒄𝒆 𝒇𝒐𝒓 𝒂𝒍𝒍 𝒚𝒐𝒖𝒓 𝒃𝒐𝒕 𝒄𝒐𝒎𝒎𝒂𝒏𝒅𝒔.',
  '',
  '> 𝑪𝒍𝒆𝒂𝒏𝒆𝒅 𝒂𝒖𝒕𝒐𝒎𝒂𝒕𝒊𝒄𝒂𝒍𝒍𝒚 𝒆𝒗𝒆𝒓𝒚 𝟔𝟎 𝒔𝒆𝒄𝒐𝒏𝒅𝒔.',
].join('\n');

/**
 * نصوص سابقة لرسالة الروم: أي إعداد محفوظ يطابقها (يتجاهل الإيموجي والمسافات)
 * يُرقّى تلقائيًا للنص الحالي — فلا يبقى على السيرفر نصّ قديم أبدًا.
 */
const PREVIOUS_TEXTS = [
  /* النسخة العربية القديمة */
  'مرحبا بكم بسيرفر Never Land — هذا روم مخصص لاستخدام الأوامر وسيتم تنظيفه كل 60 ثانية.',
  /* نسخة إنجليزية سابقة (قبل إضافة السطر الفاضي بين السطرين) */
  [
    '•   <a:emoji_20:1551627166142308522> 𝐍𝐄𝐕𝐄𝐑 𝐋𝐀𝐍𝐃 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 <a:emoji_20:1551627166142308522>   •',
    '',
    '> 𝑨 𝒑𝒓𝒊𝒗𝒂𝒕𝒆 𝒔𝒑𝒂𝒄𝒆 𝒇𝒐𝒓 𝒂𝒍𝒍 𝒚𝒐𝒖𝒓 𝒃𝒐𝒕 𝒄𝒐𝒎𝒎𝒂𝒏𝒅𝒔.',
    '> 𝑪𝒍𝒆𝒂𝒏𝒆𝒅 𝒂𝒖𝒕𝒐𝒎𝒂𝒕𝒊𝒄𝒂𝒍𝒍𝒚 𝒆𝒗𝒆𝒓𝒚 𝟔𝟎 𝒔𝒆𝒄𝒐𝒏𝒅𝒔.',
  ].join('\n'),
];

/* الحالة الحيّة (تظهر في /api/status للتشخيص) */
const STATE = {
  startedAt: 0,
  guilds: {},
};

const DEFAULTS = () => {
  const cfg = CONFIG_ROOM();
  return {
    enabled: Boolean(cfg.enabled),
    channelId: cfg.channelId || null,
    text: cfg.text || FALLBACK_TEXT,
    intervalSeconds: Math.max(15, Number(cfg.intervalSeconds) || 60),
    image: cfg.image || DEFAULT_BANNER,
    pin: cfg.pin === true,
    /* إعادة النشر: نحذف الرسالة ونبعت وحدة جديدة كل دورة (بلا «تم التعديل») */
    repost: cfg.repost !== false,
    /* بديل الإيموجي اللي ما قدرنا نضيفه لسيرفر (يونيكود) */
    emojiFallback: cfg.emojiFallback || '✨',
  };
};

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
    emojiFallback: saved.emojiFallback === undefined ? defaults.emojiFallback : (saved.emojiFallback || defaults.emojiFallback),
    /* رقم رسالة الترحيب (محفوظ حتى ما نمسحها ونعرف نعدّلها) */
    bannerId: saved[BANNER_FILE] || null,
  };
}

/* ------------------------------------------------------------------
 * 🔁 ترقية النص القديم: نقارن **المعنى** مش الحرف (نتجاهل الإيموجي والمسافات)
 * ------------------------------------------------------------------ */
function normalizeText(value) {
  return String(value || '')
    /* أي إيموجي = نفسه (نقارن الكلام مش رقم الإيموجي) */
    .replace(/<a?:[\w~]+:\d+>/g, '<:e:>')
    /* تجاهل فرق المسافات الزايدة/الناقصة داخل السطر — لكن **السطر الفاضي محسوب** */
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PREVIOUS_NORMALIZED = new Set(PREVIOUS_TEXTS.map(normalizeText));

/**
 * لو النص المحفوظ نسخة قديمة معروفة ⇒ نحفظ النص الحالي مكانه.
 * @returns {?string} النص الجديد لو صار تغيير
 */
function upgradeText(guildId) {
  let saved = null;
  try {
    saved = db.getGuildSettings(guildId)?.commandRoom || null;
  } catch {
    return null;
  }
  if (!saved?.text) return null;
  if (!PREVIOUS_NORMALIZED.has(normalizeText(saved.text))) return null;

  const next = DEFAULTS().text;
  if (normalizeText(next) === normalizeText(saved.text)) return null;
  try {
    db.updateGuildSettings(guildId, { commandRoom: { ...saved, text: next } });
  } catch {
    return null;
  }
  return next;
}

/* ------------------------------------------------------------------
 * 🎴 الإيموجيات الخارجية: ديسكورد ما يعرض إيموجي سيرفر ثاني (يطبعه «:lc0_66:»)
 *    نسوّي زي رسالة الترحيب: نضيف الإيموجي للسيرفر ← وإلا لإيموجيات البوت ← وإلا ✨
 * ------------------------------------------------------------------ */
const EMOJI_MARKUP = /<(a?):([\w~]+):(\d{5,})>/g;

/** كل إيموجيات النص (بلا تكرار) */
function emojiRefs(text) {
  const source = String(text || '');
  const re = new RegExp(EMOJI_MARKUP.source, 'g');
  const out = [];
  const seen = new Set();
  let match = re.exec(source);
  while (match) {
    const [, animated, name, id] = match;
    if (!seen.has(id)) {
      seen.add(id);
      out.push({ animated: Boolean(animated), name, id });
    }
    match = re.exec(source);
  }
  return out;
}

/** تنزيل صورة الإيموجي من CDN ديسكورد + بصمتها (نستعملها لكشف النسخ المكرّرة) */
async function downloadEmoji(ref, fetchImpl) {
  const ext = ref.animated ? 'gif' : 'png';
  const res = await fetchImpl(`https://cdn.discordapp.com/emojis/${ref.id}.${ext}?size=128`, {
    headers: { 'User-Agent': 'Never Land/1.0' },
  }).catch(() => null);
  if (!res?.ok) return { ok: false, reason: `fetch_${res?.status ?? 'failed'}` };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) return { ok: false, reason: 'empty' };
  return { ok: true, buffer, hash: crypto.createHash('sha256').update(buffer).digest('hex') };
}

/**
 * حماية: أي وعد ما يخلّص بمدة معيّنة يُتجاوز بقيمة بديلة —
 * عشان سيرفر واحد (رومه مش موجود مثلًا) ما يعلّق باقي السيرفرات كلها.
 */
function raceTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(fallback), ms);
      t.unref?.();
    }),
  ]);
}

/* فهرس إيموجيات السيرفر بالبصمة — نتجنّب إضافة إيموجي موجود بنفس الصورة */
const EMOJI_INDEX = new Map();

/** تنفيذ متوازٍ محدود (ما نفتح ٥٠ طلب مرة وحدة) */
async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]).catch(() => null);
    }
  });
  await Promise.all(workers);
  return out;
}

async function emojiIndex(guild, fetchImpl) {
  const size = guild?.emojis?.cache?.size || 0;
  const cached = EMOJI_INDEX.get(guild.id);
  if (cached && cached.size === size && Date.now() - cached.at < 10 * 60 * 1000) return cached.byHash;

  const list = [...(guild?.emojis?.cache?.values?.() || [])].slice(0, 60);
  const byHash = new Map();
  const loaded = await mapLimit(list, 6, async (emoji) => {
    const url = typeof emoji.imageURL === 'function'
      ? emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 128 })
      : emoji.url;
    if (!url) return null;
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Never Land/1.0' } }).catch(() => null);
    if (!res?.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return null;
    return { hash: crypto.createHash('sha256').update(buffer).digest('hex'), emoji };
  });
  for (const item of loaded) if (item) byHash.set(item.hash, item.emoji);

  EMOJI_INDEX.set(guild.id, { at: Date.now(), size, byHash });
  return byHash;
}

/** نضيف الإيموجي للسيرفر (الأفضل — يظهر لكل الأعضاء) ← وإلا لإيموجيات البوت */
async function createEmoji(client, guild, ref, buffer) {
  const safe = String(ref.name || '').replace(/[^\w]/g, '_').slice(0, 32) || 'nl_emoji';
  const name = safe.length >= 2 ? safe : `nl_${safe}`;

  try {
    const created = await guild.emojis.create({ attachment: buffer, name, reason: 'إيموجي رسالة روم الأوامر (تصحيح تلقائي)' });
    if (created?.id) return { ok: true, emoji: created, scope: 'guild' };
  } catch (err) {
    if (!client?.application?.emojis?.create) return { ok: false, reason: err.message };
  }

  if (client?.application?.emojis?.create) {
    try {
      const created = await client.application.emojis.create({ attachment: buffer, name });
      if (created?.id) return { ok: true, emoji: created, scope: 'app' };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }
  return { ok: false, reason: 'create_failed' };
}

/** تبديل الإيموجي في النص (بنفس الشكل الجديد) */
function replaceEmoji(text, ref, target) {
  const from = `<${ref.animated ? 'a' : ''}:${ref.name}:${ref.id}>`;
  const to = `<${target.animated ? 'a' : ''}:${target.name}:${target.id}>`;
  return String(text).split(from).join(to);
}

/** حذف الإيموجي من النص ووضع بديل يونيكود */
function dropEmoji(text, ref, fallback) {
  const from = `<${ref.animated ? 'a' : ''}:${ref.name}:${ref.id}>`;
  return String(text).split(from).join(fallback);
}

/**
 * 🎴 تصحيح إيموجيات الرسالة: كل إيموجي مو موجود بالسيرفر ⇒ نضيفه ونبدّل رقمه،
 * وإن فشل ⇒ بديل يونيكود (المعنى: ما يطلع «:lc0_66:» نصًّا قبيحًا في الرسالة).
 * @returns {Promise<{text:string, added:Array, reused:Array, failed:Array, changed:boolean}>}
 */
async function fixExternalEmojis(client, guild, text, { fetchImpl = fetch, fallback = '✨' } = {}) {
  const refs = emojiRefs(text);
  const none = { text, added: [], reused: [], failed: [], changed: false };
  if (!refs.length || !guild?.emojis?.cache?.has) return none;

  /* الموجود بالسيرفر أصلًا ما نلمسه */
  const missing = refs.filter((ref) => !guild.emojis.cache.has(ref.id));
  if (!missing.length) return none;

  let out = String(text);
  const added = [];
  const reused = [];
  const failed = [];
  let index = null;

  for (const ref of missing) {
    const downloaded = await downloadEmoji(ref, fetchImpl);
    if (!downloaded.ok) {
      failed.push({ ...ref, reason: downloaded.reason });
      out = dropEmoji(out, ref, fallback);
      continue;
    }

    /* نفس الصورة موجودة عندنا؟ نستعملها بدل ما نضيف نسخة مكرّرة */
    if (index === null) index = await emojiIndex(guild, fetchImpl);
    const twin = index.get(downloaded.hash);
    if (twin?.id) {
      out = replaceEmoji(out, ref, twin);
      reused.push({ name: ref.name, oldId: ref.id, newId: twin.id, newName: twin.name });
      continue;
    }

    const created = await createEmoji(client, guild, ref, downloaded.buffer);
    if (!created.ok) {
      failed.push({ ...ref, reason: created.reason });
      out = dropEmoji(out, ref, fallback);
      continue;
    }
    out = replaceEmoji(out, ref, created.emoji);
    added.push({ name: ref.name, oldId: ref.id, newId: created.emoji.id, scope: created.scope });
  }

  return { text: out, added, reused, failed, changed: Boolean(added.length || reused.length) };
}

/** يحفظ رقم رسالة الترحيب */
function saveBanner(guildId, messageId) {
  try {
    const current = db.getGuildSettings(guildId)?.commandRoom || {};
    db.updateGuildSettings(guildId, { commandRoom: { ...current, [BANNER_FILE]: messageId } });
  } catch { /* الحفظ فشل؟ نكمل — الرسالة نفسها انبعتت */ }
}

/** يحفظ النص المصحّح (بعد تبديل أرقام الإيموجيات) */
function saveText(guildId, text) {
  try {
    const current = db.getGuildSettings(guildId)?.commandRoom || {};
    db.updateGuildSettings(guildId, { commandRoom: { ...current, text } });
    return true;
  } catch {
    return false;
  }
}

/** مسار ملف الصورة: يتحمّل رابطًا خارجيًا · ويرجع للصورة الافتراضية لو المسار المحفوظ ناقص */
function imagePath(cfg = {}) {
  const resolve = (value) => {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const full = path.isAbsolute(value) ? value : path.join(ROOT, value);
    return fs.existsSync(full) ? full : null;
  };
  /* الصورة المحفوظة ← وإلا الافتراضية (لو تغيّر مسار قديم أو انحذف الملف) */
  return resolve(cfg.image) || resolve(DEFAULT_BANNER) || resolve(DEFAULTS().image);
}

/**
 * 👋 ينشر (أو يعدّل) رسالة الترحيب بالصورة في روم الأوامر.
 * @returns {Promise<{ok:boolean, messageId?:string, edited?:boolean, text?:string, emojis?:object, reason?:string}>}
 */
async function publish(client, guild, { force = false } = {}) {
  upgradeText(guild.id); /* نص قديم محفوظ ⇒ نرقّيه للنص الحالي */
  const cfg = configFor(guild.id);
  if (!cfg.channelId) return { ok: false, reason: 'noChannel' };

  let fetchError = null;
  const channel = guild.channels.cache.get(cfg.channelId)
    || (await raceTimeout(
      guild.channels.fetch(cfg.channelId).catch((err) => { fetchError = err.message || 'fetch_failed'; return null; }),
      8000,
      null,
    ));
  if (!channel && !fetchError) fetchError = 'fetch_timeout';
  if (!channel?.isTextBased?.()) {
    return { ok: false, reason: 'noChannel', error: fetchError || `cacheSize=${guild.channels.cache.size} type=${channel?.type}` };
  }

  /* الإيموجيات الخارجية: تُضاف للسيرفر ويُبدَّل رقمها في النص (وإلا بديل ✨) */
  const emojis = await fixExternalEmojis(client, guild, cfg.text, { fallback: cfg.emojiFallback });
  if (emojis.changed) saveText(guild.id, emojis.text);
  const content = emojis.text;

  const file = imagePath(cfg);
  /* __raw: الرسالة تنزل بنصّها العربي كما هي (بلا ترجمة ولا خط مزخرف) */
  const payload = () => {
    const body = { content, __raw: true };
    if (file) body.files = [file];
    return body;
  };

  STATE.guilds[guild.id] = {
    ...(STATE.guilds[guild.id] || {}),
    emojis: { added: emojis.added, reused: emojis.reused, failed: emojis.failed },
  };

  /* ١) في رسالة منشورة من قبل؟ */
  if (cfg.bannerId) {
    const existing = await raceTimeout(channel.messages.fetch(cfg.bannerId).catch(() => null), 10000, null);
    if (existing) {
      if (cfg.repost) {
        /* إعادة النشر: نحذف القديمة (ونفك التثبيت إن كان مثبّتًا) ونبعت وحدة جديدة كل دورة */
        await raceTimeout(existing.unpin().catch(() => {}), 10000, null);
        await raceTimeout(existing.delete().catch(() => {}), 10000, null);
      } else if (!force) {
        /* وضع التعديل: نحدّث نفس الرسالة (تظهر عندها كلمة «تم التعديل») */
        const edited = await existing
          .edit(file ? { content, files: [file], __raw: true } : { content, __raw: true })
          .catch(() => null);
        if (edited) return { ok: true, messageId: existing.id, edited: true, channelId: channel.id, text: content, emojis };
      }
    }
  }

  /* ٢) ننشر رسالة جديدة (ونمسح النسخ القديمة لو موجودة) */
  let sendError = null;
  const sent = await raceTimeout(channel.send(payload()).catch((err) => {
    sendError = err.message;
    STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), lastError: `publish: ${err.message}` };
    return null;
  }), 25000, null);
  if (!sent) return { ok: false, reason: 'sendFailed', error: sendError || 'send_timeout' };

  saveBanner(guild.id, sent.id);
  /* التثبيت ما إله معنى مع إعادة النشر كل دورة (الرسالة تُحذف وتُستبدل) — فما نثبّت */
  if (cfg.pin && !cfg.repost) await sent.pin().catch(() => {});
  return { ok: true, messageId: sent.id, edited: false, channelId: channel.id, text: content, emojis };
}

/**
 * 🧹 يمسح كل رسائل الروم ما عدا رسالة الترحيب.
 * @returns {Promise<{ok:boolean, deleted:number, reason?:string}>}
 */
async function clean(client, guild, { keepId = null } = {}) {
  const cfg = configFor(guild.id);
  if (!cfg.channelId) return { ok: false, deleted: 0, reason: 'noChannel' };

  const channel = guild.channels.cache.get(cfg.channelId)
    || (await raceTimeout(guild.channels.fetch(cfg.channelId).catch(() => null), 8000, null));
  if (!channel?.isTextBased?.()) return { ok: false, deleted: 0, reason: 'noChannel' };

  const keep = keepId || cfg.bannerId;
  let fetchError = null;
  const fetched = await raceTimeout(
    channel.messages.fetch({ limit: 100 }).catch((err) => { fetchError = err.message; return null; }),
    15000,
    null,
  );
  if (!fetched) return { ok: false, deleted: 0, reason: 'fetchFailed', error: fetchError || 'fetch_timeout' };

  const toDelete = [...fetched.values()].filter((m) => m.id !== keep && !m.pinned);
  if (!toDelete.length) return { ok: true, deleted: 0, channelId: channel.id };

  let deleted = 0;

  /* ١) الحذف الجماعي أسرع — filterOld=true تخليه يتجاوز الأقدم من ١٤ يومًا */
  const bulkable = toDelete.filter((m) => Date.now() - m.createdTimestamp < 14 * 24 * 3600 * 1000);
  if (bulkable.length && typeof channel.bulkDelete === 'function') {
    const result = await raceTimeout(channel.bulkDelete(bulkable, true).catch(() => null), 20000, null);
    if (result && typeof result.size === 'number') deleted += result.size;
    else {
      /* فشل الجماعي: نحذف واحد واحد */
      for (const message of bulkable) {
        const ok = await raceTimeout(message.delete().then(() => true).catch(() => false), 10000, false);
        if (ok) deleted += 1;
      }
    }
  }

  /* ٢) القديمة (أكثر من ١٤ يومًا) تُحذف فرديًا */
  const old = toDelete.filter((m) => Date.now() - m.createdTimestamp >= 14 * 24 * 3600 * 1000);
  for (const message of old) {
    const ok = await raceTimeout(message.delete().then(() => true).catch(() => false), 10000, false);
    if (ok) deleted += 1;
  }

  return { ok: true, deleted, channelId: channel.id };
}

/** دورة كاملة: تأكيد وجود رسالة الترحيب + تنظيف الباقي */
async function runOnce(client, guildId, { force = false } = {}) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.warn('[روم الأوامر] السيرفر غير موجود في الكاش:', guildId);
    return { ok: false, reason: 'noGuild' };
  }

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
    text: published.text || cfg.text,
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
    const guilds = [...client.guilds.cache.values()];
    if (!STATE.sawGuilds) {
      STATE.sawGuilds = guilds.length;
      console.log(`[روم الأوامر] الفحص الدوري بدأ — البوت يشوف ${guilds.length} سيرفر.`);
    }
    for (const guild of guilds) {
      let cfg;
      try {
        cfg = configFor(guild.id);
      } catch (err) {
        console.error('[روم الأوامر] تعذّر قراءة الإعدادات:', err.message);
        continue;
      }
      if (!STATE.guilds[guild.id]?.loggedCfg) {
        STATE.guilds[guild.id] = {
          ...(STATE.guilds[guild.id] || {}),
          loggedCfg: true,
          enabled: cfg.enabled,
          channelId: cfg.channelId,
        };
        console.log(`[روم الأوامر] فحص: ${guild.name} · مفعّل=${cfg.enabled} · الروم=${cfg.channelId} · كل ${cfg.intervalSeconds}ث`);
      }
      if (!cfg.enabled || !cfg.channelId) {
        STATE.guilds[guild.id] = {
          ...(STATE.guilds[guild.id] || {}),
          enabled: cfg.enabled,
          channelId: cfg.channelId,
          intervalSeconds: cfg.intervalSeconds,
        };
        continue;
      }
      const state = STATE.guilds[guild.id] || {};
      /* سيرفر رومه غير موجود (إعداد عام أو روم انحذف): نتخطّاه مدة ونعيد المحاولة بعدين */
      if (state.skipUntil && state.skipUntil > Date.now()) continue;
      const last = state.lastRunAt || 0;
      if (Date.now() - last < cfg.intervalSeconds * 1000) continue;
      try {
        const result = await raceTimeout(runOnce(client, guild.id), 90000, { ok: false, reason: 'دورة معلّقة (مهلة ٤٥ ثانية)' }, 45000);
        const roomMissing = result.published?.reason === 'noChannel' || result.cleaned?.reason === 'noChannel';
        if (roomMissing) {
          /* ما نعلّق الدورات: نوقف هذا السيرفر ٣٠ دقيقة ونكمّل الباقي */
          STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), skipUntil: Date.now() + 30 * 60 * 1000, lastRunAt: Date.now() };
        }
        if (!result.ok) {
          const reason = result.reason && !result.published
            ? result.reason
            : (result.published?.ok === false
              ? `publish:${result.published.reason}${result.published.error ? ` (${result.published.error})` : ''}`
              : `clean:${result.cleaned?.reason}${result.cleaned?.error ? ` (${result.cleaned.error})` : ''}`);
          if (STATE.guilds[guild.id]?.reportedReason !== reason) {
            STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), reportedReason: reason };
            console.warn(`[روم الأوامر] تعذّرت الدورة — ${reason} · الروم ${cfg.channelId}`);
          }
        } else {
          if (STATE.guilds[guild.id]?.reportedReason) {
            STATE.guilds[guild.id] = { ...STATE.guilds[guild.id], reportedReason: null };
            console.log('[روم الأوامر] رجع يشتغل تمام.');
          }
          /* أول دورة ناجحة لكل سيرفر: نطبع سطرًا واحدًا للتأكيد (بعدها بلا إغراق) */
          if (!STATE.guilds[guild.id]?.loggedOnce) {
            STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), loggedOnce: true };
            console.log(`[روم الأوامر] دورة ناجحة: الرسالة ${result.published?.messageId} · انمسح ${result.cleaned?.deleted || 0} رسالة · كل ${cfg.intervalSeconds} ثانية`);
          }
        }
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

module.exports = {
  DEFAULT_BANNER,
  DEFAULTS,
  configFor,
  publish,
  clean,
  runOnce,
  start,
  status,
  imagePath,
  /* أدوات الإيموجي + ترقية النص (للفحص والتشخيص) */
  emojiRefs,
  fixExternalEmojis,
  upgradeText,
  normalizeText,
  PREVIOUS_TEXTS,
};
