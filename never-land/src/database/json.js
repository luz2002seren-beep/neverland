'use strict';

/**
 * database/json.js
 * -------------------------------------------------------------
 * مشغّل احتياطي: يخزّن كل شيء في ملف JSON واحد بدون أي مكتبات خارجية.
 * يُستخدم إذا فشل تثبيت better-sqlite3 أو عبر DATABASE_DRIVER=json
 * (مناسب للسيرفرات الصغيرة والتجارب السريعة).
 * -------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');
const { mergeSettings } = require('./defaults');
const { migrateSettings } = require('./migrate');

/** إشعار البثّ الحيّ: أي كتابة إعدادات تصل للصفحات المفتوحة لحظيًا */
function notifyLive(guildId) {
  try {
    require('../lib/live').settingsChanged(guildId);
  } catch { /* البثّ ما يوقف الحفظ أبدًا */ }
}

let store = null;
let file = null;
let saveTimer = null;

const now = () => Date.now();
const today = () => new Date().toISOString().slice(0, 10);

const emptyStore = () => ({
  kv: {},
  guilds: {},
  cases: [],
  tickets: [],
  levels: {},
  xpPeriods: {},
  stats: {},
  reminders: [],
  audit: [],       // سجل النشاط (تدقيق) — آخر ٥٠٠٠ حدث
  counters: { cases: 0, tickets: 0, reminders: 0, audit: 0 },
});

/** كتابة مؤجّلة (debounced) لتقليل عمليات القرص */
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(file, JSON.stringify(store, null, 2));
  }, 250);
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}

function hydrateGuild(id, defaults) {
  const row = store.guilds[id];
  if (!row) return null;
  return {
    id,
    locale: row.locale || 'ar',
    premium: Boolean(row.premium),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    settings: migrateSettings(mergeSettings(defaults, row.settings || {})),
  };
}

module.exports = {
  name: 'json',

  init(config) {
    file = config.database.path.replace(/\.db$/, '.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        store = { ...emptyStore(), ...parsed };
        store.xpPeriods = parsed.xpPeriods || {};
      } catch {
        store = emptyStore();
      }
    } else {
      store = emptyStore();
      saveNow();
    }
    process.on('SIGINT', () => saveNow());
    process.on('SIGTERM', () => saveNow());
    return this;
  },
  /* ----------------------- المخزن العام (لقطات المزامنة) ----------------------- */

  getKV(key) {
    const row = store.kv[key];
    return row ? row.value : null;
  },

  setKV(key, value) {
    store.kv[key] = { value: String(value), updatedAt: now() };
    scheduleSave();
    return true;
  },

  delKV(key) {
    delete store.kv[key];
    scheduleSave();
    return true;
  },

  listKV(prefix = '') {
    return Object.entries(store.kv)
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, row]) => ({ key, value: row.value, updated_at: row.updatedAt }));
  },

  ensureGuild(guildId) {
    if (!store.guilds[guildId]) {
      store.guilds[guildId] = { settings: {}, locale: 'ar', premium: 0, createdAt: now(), updatedAt: now() };
      scheduleSave();
    }
  },

  getGuild(guildId, defaults) {
    this.ensureGuild(guildId);
    return hydrateGuild(guildId, defaults);
  },

  getAllGuilds(defaults) {
    return Object.keys(store.guilds)
      .map((id) => hydrateGuild(id, defaults))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  updateGuildSettings(guildId, patch, defaults) {
    this.ensureGuild(guildId);
    const row = store.guilds[guildId];
    row.settings = mergeSettings(row.settings || {}, patch);
    row.updatedAt = now();
    if (row.settings.language) row.locale = row.settings.language;
    scheduleSave();

    /* الرابط الحيّ: نُشعر الصفحات المفتوحة أن الإعدادات تغيّرت (بوت أو موقع) */
    notifyLive(guildId);

    return hydrateGuild(guildId, defaults);
  },

  setPremium(guildId, on) {
    this.ensureGuild(guildId);
    const row = store.guilds[guildId];
    row.premium = on ? 1 : 0;
    row.updatedAt = now();
    scheduleSave();
    return true;
  },

  setGuildPath(guildId, dotPath, value, defaults) {
    const patch = {};
    const keys = dotPath.split('.');
    let cursor = patch;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) cursor[key] = value;
      else cursor = cursor[key] = {};
    });
    return this.updateGuildSettings(guildId, patch, defaults);
  },

  deleteGuild(guildId) {
    delete store.guilds[guildId];
    for (const id of Object.keys(store.levels)) if (id.startsWith(`${guildId}:`)) delete store.levels[id];
    for (const id of Object.keys(store.xpPeriods)) if (id.startsWith(`${guildId}:`)) delete store.xpPeriods[id];
    scheduleSave();
  },

  /* ------------------------------- الحالات ------------------------------- */

  addCase(data) {
    const id = ++store.counters.cases;
    const row = {
      id,
      guild_id: data.guildId,
      type: data.type,
      user_id: data.userId,
      user_tag: data.userTag ?? null,
      moderator_id: data.moderatorId,
      moderator_tag: data.moderatorTag ?? null,
      reason: data.reason ?? null,
      duration: data.duration ?? null,
      active: data.active ?? 1,
      created_at: now(),
    };
    store.cases.push(row);
    scheduleSave();
    return row;
  },

  getCase(guildId, id) {
    return store.cases.find((c) => c.guild_id === guildId && c.id === Number(id)) || null;
  },

  listCases({ guildId, userId = null, type = null, active = null, limit = 50, offset = 0 }) {
    const filtered = store.cases
      .filter((c) => c.guild_id === guildId)
      .filter((c) => (userId ? c.user_id === userId : true))
      .filter((c) => (type ? c.type === type : true))
      .filter((c) => (active === null ? true : Boolean(c.active) === Boolean(active)))
      .sort((a, b) => b.id - a.id);
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  },

  countCases(guildId, { type = null, userId = null, active = null } = {}) {
    return this.listCases({ guildId, userId, type, active, limit: Infinity }).total;
  },

  updateCase(guildId, id, patch) {
    const row = this.getCase(guildId, id);
    if (!row) return null;
    for (const key of ['reason', 'active', 'duration']) {
      if (patch[key] !== undefined) row[key] = patch[key];
    }
    scheduleSave();
    return row;
  },

  deleteCase(guildId, id) {
    const index = store.cases.findIndex((c) => c.guild_id === guildId && c.id === Number(id));
    if (index === -1) return false;
    store.cases.splice(index, 1);
    scheduleSave();
    return true;
  },

  clearWarnings(guildId, userId) {
    const before = store.cases.length;
    store.cases = store.cases.filter((c) => !(c.guild_id === guildId && c.user_id === userId && c.type === 'warn'));
    scheduleSave();
    return before - store.cases.length;
  },

  /* ------------------------------- التذاكر ------------------------------- */

  createTicket({ guildId, channelId, userId, type }) {
    const row = {
      id: ++store.counters.tickets,
      guild_id: guildId,
      channel_id: channelId,
      user_id: userId,
      type,
      status: 'open',
      claimed_by: null,
      transcript: null,
      created_at: now(),
      closed_at: null,
    };
    store.tickets.push(row);
    scheduleSave();
    return row;
  },

  getTicketById(id) {
    return store.tickets.find((t) => t.id === Number(id)) || null;
  },

  getTicketByChannel(channelId) {
    return store.tickets.find((t) => t.channel_id === channelId) || null;
  },

  listTickets({ guildId, userId = null, status = null, limit = 50, offset = 0 }) {
    const filtered = store.tickets
      .filter((t) => t.guild_id === guildId)
      .filter((t) => (userId ? t.user_id === userId : true))
      .filter((t) => (status ? t.status === status : true))
      .sort((a, b) => b.id - a.id);
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  },

  countTickets(guildId, status = null) {
    return this.listTickets({ guildId, status, limit: Infinity }).total;
  },

  updateTicket(id, patch) {
    const row = this.getTicketById(id);
    if (!row) return null;
    for (const key of ['status', 'claimed_by', 'transcript', 'closed_at', 'type']) {
      if (patch[key] !== undefined) row[key] = patch[key];
    }
    scheduleSave();
    return row;
  },

  /* ------------------------------- الخبرة ------------------------------- */

  getLevelRow(guildId, userId) {
    return store.levels[`${guildId}:${userId}`] || null;
  },

  upsertLevel(guildId, userId, { xp, level, messages, voiceMinutes, lastXpAt, textXp = 0, voiceXp = 0, interactXp = 0, interactions = 0 }) {
    const row = {
      guild_id: guildId,
      user_id: userId,
      xp,
      level,
      messages,
      voice_minutes: voiceMinutes,
      last_xp_at: lastXpAt,
      text_xp: textXp,
      voice_xp: voiceXp,
      interact_xp: interactXp,
      interactions,
    };
    store.levels[`${guildId}:${userId}`] = row;
    scheduleSave();
    return row;
  },

  /** إضافة خبرة لفترة (يوم/أسبوع) */
  addPeriodXp(guildId, userId, period, key, { xp = 0, source = 'text', messages = 0, voiceMinutes = 0, interactions = 0, at = Date.now() } = {}) {
    const id = `${guildId}:${userId}:${period}:${key}`;
    const row = store.xpPeriods[id] || {
      guild_id: guildId,
      user_id: userId,
      period,
      period_key: key,
      xp: 0,
      text_xp: 0,
      voice_xp: 0,
      interact_xp: 0,
      messages: 0,
      voice_minutes: 0,
      interactions: 0,
      updated_at: at,
    };
    const column = source === 'voice' ? 'voice_xp' : source === 'interact' ? 'interact_xp' : 'text_xp';
    row.xp += xp;
    row[column] += xp;
    row.messages += messages;
    row.voice_minutes += voiceMinutes;
    row.interactions += interactions;
    row.updated_at = at;
    store.xpPeriods[id] = row;
    scheduleSave();
    return row;
  },

  getPeriodRow(guildId, userId, period, key) {
    return store.xpPeriods[`${guildId}:${userId}:${period}:${key}`] || null;
  },

  getPeriodLeaderboard(guildId, period, key, limit = 10, offset = 0) {
    return Object.values(store.xpPeriods)
      .filter((r) => r.guild_id === guildId && r.period === period && r.period_key === key && r.xp > 0)
      .sort((a, b) => b.xp - a.xp || a.updated_at - b.updated_at)
      .slice(offset, offset + limit);
  },

  countPeriodMembers(guildId, period, key) {
    return Object.values(store.xpPeriods)
      .filter((r) => r.guild_id === guildId && r.period === period && r.period_key === key && r.xp > 0).length;
  },

  /** ترتيب عضو داخل فترة معيّنة */
  getPeriodRank(guildId, userId, period, key) {
    const row = this.getPeriodRow(guildId, userId, period, key);
    if (!row || row.xp <= 0) return null;
    const better = Object.values(store.xpPeriods)
      .filter((r) => r.guild_id === guildId && r.period === period && r.period_key === key && r.xp > row.xp).length;
    return better + 1;
  },

  /** مسح فترات عضو */
  clearPeriods(guildId, userId) {
    for (const id of Object.keys(store.xpPeriods)) {
      if (id.startsWith(`${guildId}:${userId}:`)) delete store.xpPeriods[id];
    }
    scheduleSave();
    return true;
  },

  /** تصفير عضو بالكامل */
  resetLevel(guildId, userId) {
    delete store.levels[`${guildId}:${userId}`];
    this.clearPeriods(guildId, userId);
    return true;
  },

  /** إجماليات الخبرة حسب المصدر */
  getXpTotals(guildId, period = null, key = null) {
    const empty = { xp: 0, text_xp: 0, voice_xp: 0, interact_xp: 0, messages: 0, voice_minutes: 0, interactions: 0 };
    const rows = period && period !== 'all' && key
      ? Object.values(store.xpPeriods).filter((r) => r.guild_id === guildId && r.period === period && r.period_key === key)
      : Object.values(store.levels).filter((r) => r.guild_id === guildId);
    return rows.reduce((acc, r) => ({
      xp: acc.xp + (r.xp || 0),
      text_xp: acc.text_xp + (r.text_xp || 0),
      voice_xp: acc.voice_xp + (r.voice_xp || 0),
      interact_xp: acc.interact_xp + (r.interact_xp || 0),
      messages: acc.messages + (r.messages || 0),
      voice_minutes: acc.voice_minutes + (r.voice_minutes || 0),
      interactions: acc.interactions + (r.interactions || 0),
    }), empty);
  },

  getLeaderboard(guildId, limit = 10, offset = 0) {
    return Object.values(store.levels)
      .filter((r) => r.guild_id === guildId)
      .sort((a, b) => b.xp - a.xp)
      .slice(offset, offset + limit);
  },

  countTrackedMembers(guildId) {
    return Object.values(store.levels).filter((r) => r.guild_id === guildId).length;
  },

  /* --------------------------- إحصائيات يومية --------------------------- */

  bumpDaily(guildId, field, amount = 1) {
    if (!['messages', 'joins', 'leaves'].includes(field)) return;
    const day = today();
    const key = `${guildId}:${day}`;
    if (!store.stats[key]) store.stats[key] = { guild_id: guildId, day, messages: 0, joins: 0, leaves: 0 };
    store.stats[key][field] += amount;
    scheduleSave();
  },

  setDaily(guildId, day, { messages = 0, joins = 0, leaves = 0 } = {}) {
    store.stats[`${guildId}:${day}`] = { guild_id: guildId, day, messages, joins, leaves };
    scheduleSave();
  },

  getDailyStats(guildId, days = 14) {
    return Object.values(store.stats)
      .filter((s) => s.guild_id === guildId)
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .slice(-days);
  },

  /* ------------------------------ التذكيرات ------------------------------ */

  addReminder({ guildId, channelId, userId, content, remindAt }) {
    const row = { id: ++store.counters.reminders, guild_id: guildId, channel_id: channelId, user_id: userId, content, remind_at: remindAt };
    store.reminders.push(row);
    scheduleSave();
    return row;
  },

  dueReminders(ts = now()) {
    return store.reminders.filter((r) => r.remind_at <= ts);
  },

  deleteReminder(id) {
    const index = store.reminders.findIndex((r) => r.id === Number(id));
    if (index > -1) store.reminders.splice(index, 1);
    scheduleSave();
  },

  /* ------------------------------ سجل النشاط (تدقيق) ------------------------------ */

  addAudit(entry = {}) {
    const row = {
      id: (store.counters.audit = (store.counters.audit || 0) + 1),
      guildId: entry.guildId ?? null,
      actorId: entry.actorId ? String(entry.actorId) : null,
      actorName: entry.actorName ? String(entry.actorName).slice(0, 80) : null,
      action: String(entry.action || 'unknown').slice(0, 60),
      target: entry.target ? String(entry.target).slice(0, 120) : null,
      detail: entry.detail ? String(entry.detail).slice(0, 600) : null,
      ipHash: entry.ipHash ? String(entry.ipHash).slice(0, 32) : null,
      severity: ['info', 'warn', 'danger'].includes(entry.severity) ? entry.severity : 'info',
      at: Number(entry.at) || now(),
    };
    store.audit.push(row);
    if (store.audit.length > 5000) store.audit.splice(0, store.audit.length - 5000);
    scheduleSave();
    return row;
  },

  listAudit({ guildId = undefined, action = null, severity = null, limit = 50, offset = 0 } = {}) {
    let rows = store.audit;
    if (guildId === null) rows = rows.filter((r) => r.guildId === null);
    else if (guildId !== undefined) rows = rows.filter((r) => r.guildId === guildId);
    if (action) rows = rows.filter((r) => String(r.action).startsWith(action));
    if (severity) rows = rows.filter((r) => r.severity === severity);
    const sorted = [...rows].sort((a, b) => b.at - a.at || b.id - a.id);
    return {
      items: sorted.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(500, Math.max(1, limit))),
      total: sorted.length,
    };
  },

  countAudit({ guildId = undefined } = {}) {
    if (guildId === undefined) return store.audit.length;
    if (guildId === null) return store.audit.filter((r) => r.guildId === null).length;
    return store.audit.filter((r) => r.guildId === guildId).length;
  },

  /** تقليم السجل: يبقي أحدث «keep» حدث فقط (حدّ أدنى ١٠٠). */
  pruneAudit(keep = 5000) {
    const limitRows = Math.max(100, Number(keep) || 5000);
    const removed = Math.max(0, store.audit.length - limitRows);
    if (removed) {
      store.audit.splice(0, removed);
      scheduleSave();
    }
    return removed;
  },

  /* ------------------------------ لوحة التحكم ------------------------------ */

  getStats(guildId) {
    const levels = Object.values(store.levels).filter((r) => r.guild_id === guildId);
    return {
      cases: this.countCases(guildId),
      warnings: this.countCases(guildId, { type: 'warn' }),
      bans: this.countCases(guildId, { type: 'ban' }),
      kicks: this.countCases(guildId, { type: 'kick' }),
      timeouts: this.countCases(guildId, { type: 'timeout' }),
      tickets: this.countTickets(guildId),
      openTickets: this.countTickets(guildId, 'open'),
      trackedMembers: levels.length,
      xpSum: levels.reduce((sum, r) => sum + (r.xp || 0), 0),
      messages: levels.reduce((sum, r) => sum + (r.messages || 0), 0),
    };
  },

  close() {
    saveNow();
  },
};
