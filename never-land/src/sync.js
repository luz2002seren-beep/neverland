'use strict';

/**
 * sync.js
 * -------------------------------------------------------------
 * المزامنة الحقيقية بين ديسكورد والموقع.
 *
 * تحفظ «لقطة» (snapshot) لكل سيرفر البوت موجود فيه:
 *   الاسم • الأيقونة • عدد الأعضاء • المالك • القنوات • الرتب • الإيموجيات • الرتب الإدارية
 * في قاعدة البيانات، فيقرأها الموقع مباشرة:
 *   - اللوحة تعرض بيانات سيرفرك الحقيقية حتى لو أُعيد تشغيل الموقع أو غاب البوت لحظة.
 *   - القوائم المنسدلة في اللوحة (قنوات/رتب) تصير قنوات سيرفرك الحقيقي وأسماءه.
 *   - كل عملية حفظ من الموقع تنطبق على السيرفر فورًا (البوت يقرأ الإعدادات من نفس القاعدة).
 *
 * المصادر:
 *   1) البوت المتّصل في نفس العملية  ← أدق وأسرع (قنوات + رتب + أعضاء)
 *   2) واجهة ديسكورد REST بالتوكن  ← عند توقّف البوت: تحديث الأسماء/الأيقونات على الأقل
 *   3) اللقطة المحفوظة              ← عند غياب الاثنين: الموقع يظلّ يعرض آخر بيانات معروفة
 *
 * المزامنة تشتغل: عند الإقلاع • كل فترة (SYNC_INTERVAL_SECONDS) • عند أي تغيير
 * (سيرفر/قناة/رتبة) • وبالضغط على «مزامنة الآن» من اللوحة.
 * -------------------------------------------------------------
 */

const config = require('./config');
const db = require('./database');
const { guildIconUrl } = require('./lib/discordIcon');

const KEY_STATUS = 'sync:status';
const keyGuild = (id) => `sync:guild:${id}`;
const KEY_LIST = 'sync:list';

const DEFAULTS_STATUS = {
  ok: false,
  running: false,
  source: null,      // client | rest | none
  guilds: 0,
  at: null,          // آخر مزامنة ناجحة (مللي ثانية)
  error: null,
};

let status = { ...DEFAULTS_STATUS };
let timer = null;
let onChange = null;          // دالة تُنادى بعد كل مزامنة (للبث الحيّ)
const listeners = new Set();

/* ------------------------------------------------------------------ */
/*                              أدوات عامة                             */
/* ------------------------------------------------------------------ */

const now = () => Date.now();

/** قراءة لقطة سيرفر */
function getSnapshot(guildId) {
  const raw = db.getKV(keyGuild(guildId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** حفظ لقطة سيرفر + تحديث فهرستها */
function saveSnapshot(snap) {
  db.setKV(keyGuild(snap.id), JSON.stringify(snap));
  const list = listIds();
  if (!list.includes(snap.id)) {
    list.push(snap.id);
    db.setKV(KEY_LIST, JSON.stringify(list));
  }
  return snap;
}

/** حذف لقطة سيرفر (عند خروج البوت منه) */
function removeSnapshot(guildId) {
  db.delKV(keyGuild(guildId));
  db.setKV(KEY_LIST, JSON.stringify(listIds().filter((id) => id !== guildId)));
}

/** فهرس معرّفات السيرفرات المزامَنة */
function listIds() {
  const raw = db.getKV(KEY_LIST);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** كل اللقطات (لقائمة السيرفرات في الموقع) */
function listSnapshots() {
  return listIds()
    .map((id) => getSnapshot(id))
    .filter(Boolean)
    .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
}

/** ملخّص خفيف للعرض (بدون قنوات/رتب) */
function listGuildMeta() {
  return listSnapshots().map((s) => ({
    id: s.id,
    name: s.name,
    icon: s.icon,
    memberCount: s.memberCount,
    ownerName: s.ownerName,
    botPresent: true,
    syncedAt: s.syncedAt,
  }));
}

/* ------------------------------------------------------------------ */
/*                          تحويل بيانات ديسكورد                        */
/* ------------------------------------------------------------------ */

/** تحويل سيرفر discord.js إلى لقطة محفوظة */
function serializeGuild(guild, previous = null) {
  const channels = [...(guild.channels?.cache?.values?.() ?? [])]
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId ?? null,
      position: c.rawPosition ?? c.position ?? 0,
      nsfw: Boolean(c.nsfw),
    }))
    .sort((a, b) => a.type - b.type || a.position - b.position);

  const roles = [...(guild.roles?.cache?.values?.() ?? [])]
    .filter((r) => r.id !== guild.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.hexColor ?? null,
      position: r.position ?? 0,
      managed: Boolean(r.managed),
      mentionable: Boolean(r.mentionable),
      hoist: Boolean(r.hoist),
      permissions: r.permissions?.bitfield ? String(r.permissions.bitfield) : null,
    }))
    .sort((a, b) => b.position - a.position);

  const emojis = [...(guild.emojis?.cache?.values?.() ?? [])].slice(0, 100).map((e) => ({
    id: e.id,
    name: e.name,
    animated: Boolean(e.animated),
  }));

  return {
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL?.({ size: 128, extension: 'png' }) || guild.icon || null,
    memberCount: guild.memberCount ?? previous?.memberCount ?? null,
    ownerId: guild.ownerId ?? previous?.ownerId ?? null,
    ownerName: previous?.ownerName ?? null,
    createdAt: guild.createdTimestamp ?? previous?.createdAt ?? null,
    premiumTier: guild.premiumTier ?? previous?.premiumTier ?? null,
    channels: channels.length ? channels : previous?.channels ?? [],
    roles: roles.length ? roles : previous?.roles ?? [],
    emojis: emojis.length ? emojis : previous?.emojis ?? [],
    syncedAt: now(),
    source: 'client',
  };
}

/** لقطة مبسّطة من واجهة REST (عند توقّف البوت): الأسماء والأيقونات على الأقل */
function mergeRestGuild(restGuild, previous = null) {
  const icon = guildIconUrl(restGuild.id, restGuild.icon) || guildIconUrl(restGuild.id, previous?.icon) || null;
  return {
    ...(previous || {}),
    id: restGuild.id,
    name: restGuild.name || previous?.name || restGuild.id,
    icon,
    ownerId: restGuild.owner_id ?? previous?.ownerId ?? null,
    channels: previous?.channels ?? [],
    roles: previous?.roles ?? [],
    emojis: previous?.emojis ?? [],
    syncedAt: now(),
    source: 'rest',
  };
}

/* ------------------------------------------------------------------ */
/*                             المزامنة نفسها                          */
/* ------------------------------------------------------------------ */

/** مزامنة كل السيرفرات من البوت المتّصل */
function syncFromClient(client) {
  const guilds = [...client.guilds.cache.values()];
  const seen = new Set();

  for (const guild of guilds) {
    seen.add(guild.id);
    saveSnapshot(serializeGuild(guild, getSnapshot(guild.id)));
  }

  // سيرفرات خرج منها البوت → نحذف لقطتها
  for (const id of listIds()) {
    if (!seen.has(id)) removeSnapshot(id);
  }

  return { guilds: guilds.length, source: 'client' };
}

/** مزامنة عبر REST (البوت متوقّف لكن التوكن موجود) */
let restBlockedUntil = 0;

async function syncViaRest() {
  if (Date.now() < restBlockedUntil) return { guilds: listIds().length, source: 'rest' };
  const token = config.bot.token;
  if (!config.bot.hasToken) throw new Error('لا يوجد توكن');

  const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'NeverLand (dashboard)' },
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || 60);
    restBlockedUntil = Date.now() + Math.min(Math.max(retryAfter, 30), 300) * 1000;
    throw new Error('واجهة ديسكورد طلبت الانتظار');
  }
  if (!res.ok) throw new Error(`واجهة ديسكورد ردّت ${res.status}`);
  const guilds = await res.json();
  const seen = new Set();

  for (const g of Array.isArray(guilds) ? guilds : []) {
    seen.add(g.id);
    saveSnapshot(mergeRestGuild(g, getSnapshot(g.id)));
  }

  return { guilds: seen.size, source: 'rest' };
}

/** مزامنة الآن (تختار المصدر تلقائيًا) */
async function syncNow({ client = null, silent = false } = {}) {
  if (!config.sync.enabled) return getStatus();
  if (status.running) return getStatus();

  status.running = true;
  try {
    let result = null;

    const live = client || safeClient();
    if (live?.isReady?.()) {
      result = syncFromClient(live);
    } else if (config.bot.hasToken) {
      result = await syncViaRest();
    } else {
      result = { guilds: listIds().length, source: 'none' };
    }

    status = {
      ok: result.source !== 'none',
      running: false,
      source: result.source,
      guilds: result.source === 'none' ? listIds().length : result.guilds,
      at: result.source === 'none' ? status.at : now(),
      error: null,
    };
    db.setKV(KEY_STATUS, JSON.stringify(status));
    notify('sync', getStatus());
    if (!silent) {
      console.log(`[مزامنة] ${status.guilds} سيرفر — المصدر: ${status.source}${status.ok ? '' : ' (لا توكن بعد)'}`);
    }
  } catch (err) {
    status = { ...status, running: false, error: err.message };
    db.setKV(KEY_STATUS, JSON.stringify(status));
    notify('sync-error', { message: err.message });
    console.error('[تنبيه] فشل المزامنة:', err.message);
  }

  return getStatus();
}

/** حالة المزامنة الحالية */
function getStatus() {
  const live = safeClient();
  return {
    ...status,
    intervalSeconds: config.sync.intervalSeconds,
    hasToken: config.bot.hasToken,
    botOnline: Boolean(live?.isReady?.()),
    guildsKnown: listIds().length,
  };
}

/** تنبيه المستمعين (للبث الحيّ إلى المتصفح) */
function notify(event, payload) {
  for (const fn of listeners) {
    try {
      fn(event, payload);
    } catch { /* لا نُسقط المزامنة بسبب مستمع */ }
  }
  if (onChange) {
    try {
      onChange(event, payload);
    } catch { /* تجاهل */ }
  }
}

/** الاشتراك بالبث الحيّ */
function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** غلاف آمن لاستيراد البوت (قد لا يكون محمّلًا في الموقع فقط) */
function safeClient() {
  try {
    return require('./client');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*                        التشغيل التلقائي والربط                       */
/* ------------------------------------------------------------------ */

/**
 * يبدأ المزامنة: عند جهوزية البوت + كل فترة + عند أي تغيير في السيرفرات.
 * @param {import('discord.js').Client} client
 */
function start(client) {
  if (!config.sync.enabled) {
    console.log('[مزامنة] المزامنة التلقائية معطّلة (SYNC_ENABLED=false).');
    return;
  }

  const run = () => syncNow({ client, silent: true }).catch(() => {});

  // ١) عند جهوزية البوت
  if (client.isReady?.()) run();
  client.once?.('clientReady', run);
  client.on?.('ready', run);

  // ٢) كل فترة
  if (timer) clearInterval(timer);
  timer = setInterval(run, config.sync.intervalSeconds * 1000);

  // ٣) عند أي تغيير مهم في السيرفر
  const resyncGuild = (guild) => {
    try {
      saveSnapshot(serializeGuild(guild, getSnapshot(guild.id)));
      notify('sync', getStatus());
    } catch { /* تجاهل */ }
  };

  client.on?.('guildCreate', resyncGuild);
  client.on?.('guildUpdate', resyncGuild);
  client.on?.('channelCreate', (c) => c.guild && resyncGuild(c.guild));
  client.on?.('channelUpdate', (c) => c.guild && resyncGuild(c.guild));
  client.on?.('channelDelete', (c) => c.guild && resyncGuild(c.guild));
  client.on?.('roleCreate', (r) => r.guild && resyncGuild(r.guild));
  client.on?.('roleUpdate', (r) => r.guild && resyncGuild(r.guild));
  client.on?.('roleDelete', (r) => r.guild && resyncGuild(r.guild));
  client.on?.('guildDelete', (g) => {
    removeSnapshot(g.id);
    notify('sync', getStatus());
  });

  console.log(`[مزامنة] المزامنة التلقائية فعّالة — كل ${config.sync.intervalSeconds} ثانية.`);
}

/** إيقاف المزامنة */
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start,
  stop,
  syncNow,
  getStatus,
  onEvent,
  getSnapshot,
  saveSnapshot,
  removeSnapshot,
  listSnapshots,
  listGuildMeta,
  serializeGuild,
  syncFromClient,
  syncViaRest,
};
