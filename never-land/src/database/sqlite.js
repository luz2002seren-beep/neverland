'use strict';

/**
 * database/sqlite.js
 * -------------------------------------------------------------
 * مشغّل قاعدة البيانات الأساسي (SQLite عبر better-sqlite3).
 * أسرع من JSON بمراحل ومناسب للبوتات الكبيرة.
 * -------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { mergeSettings } = require('./defaults');
const { migrateSettings } = require('./migrate');

/** إشعار البثّ الحيّ: أي كتابة إعدادات تصل للصفحات المفتوحة لحظيًا */
function notifyLive(guildId) {
  try {
    require('../lib/live').settingsChanged(guildId);
  } catch { /* البثّ ما يوقف الحفظ أبدًا */ }
}

let db = null;

const now = () => Date.now();

const today = () => new Date().toISOString().slice(0, 10);

/** تحويل صف السيرفر إلى كائن جاهز مع الإعدادات مدموجة */
function hydrateGuild(row, defaults) {
  if (!row) return null;
  let settings = {};
  try {
    settings = JSON.parse(row.settings || '{}');
  } catch {
    settings = {};
  }
  return {
    id: row.id,
    locale: row.locale,
    premium: Boolean(row.premium),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settings: migrateSettings(mergeSettings(defaults, settings)),
  };
}

/** إضافة أعمدة جديدة لقواعد البيانات القديمة (آمنة: تتجاهل ما هو موجود) */
function migrate() {
  /* جدول سجل النشاط (يُنشأ لو ما كان — آمن للتكرار) */
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT, actor_id TEXT, actor_name TEXT, action TEXT NOT NULL,
        target TEXT, detail TEXT, ip_hash TEXT, severity TEXT NOT NULL DEFAULT 'info',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit_log(guild_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    `);
  } catch (err) {
    console.error('[تنبيه] تعذّر تجهيز جدول سجل النشاط:', err.message);
  }

  const wanted = [
    ['levels', 'text_xp', 'INTEGER NOT NULL DEFAULT 0'],
    ['levels', 'voice_xp', 'INTEGER NOT NULL DEFAULT 0'],
    ['levels', 'interact_xp', 'INTEGER NOT NULL DEFAULT 0'],
    ['levels', 'interactions', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [table, column, type] of wanted) {
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
    } catch {
      /* العمود موجود مسبقًا — لا شيء */
    }
  }
}

module.exports = {
  name: 'sqlite',

  init(config) {
    const file = config.database.path;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
    migrate();
    return this;
  },

  /* ----------------------- المخزن العام (لقطات المزامنة) ----------------------- */

  getKV(key) {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setKV(key, value) {
    db.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, String(value), now());
    return true;
  },

  delKV(key) {
    db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    return true;
  },

  listKV(prefix = '') {
    return db.prepare('SELECT key, value, updated_at FROM kv WHERE key LIKE ? ORDER BY key').all(`${prefix}%`);
  },

  /* ----------------------- السيرفرات والإعدادات ----------------------- */

  ensureGuild(guildId) {
    const exists = db.prepare('SELECT id FROM guilds WHERE id = ?').get(guildId);
    if (!exists) {
      db.prepare('INSERT INTO guilds (id, settings, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, '{}', 'ar', now(), now());
    }
  },

  getGuild(guildId, defaults) {
    this.ensureGuild(guildId);
    return hydrateGuild(db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId), defaults);
  },

  getAllGuilds(defaults) {
    return db.prepare('SELECT * FROM guilds ORDER BY updated_at DESC').all().map((r) => hydrateGuild(r, defaults));
  },

  updateGuildSettings(guildId, patch, defaults) {
    this.ensureGuild(guildId);
    const current = hydrateGuild(db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId), defaults);
    const merged = mergeSettings(current.settings, patch);
    db.prepare('UPDATE guilds SET settings = ?, locale = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), merged.language || current.locale, now(), guildId);

    /* الرابط الحيّ: نُشعر الصفحات المفتوحة أن الإعدادات تغيّرت (بوت أو موقع) */
    notifyLive(guildId);

    return { ...current, settings: merged, updatedAt: now() };
  },

  setPremium(guildId, on) {
    this.ensureGuild(guildId);
    db.prepare('UPDATE guilds SET premium = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, now(), guildId);
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
    db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId);
    db.prepare('DELETE FROM levels WHERE guild_id = ?').run(guildId);
    db.prepare('DELETE FROM xp_periods WHERE guild_id = ?').run(guildId);
  },

  /* ------------------------------- الحالات ------------------------------- */

  addCase({ guildId, type, userId, userTag = null, moderatorId, moderatorTag = null, reason = null, duration = null, active = 1 }) {
    const info = db.prepare(`
      INSERT INTO cases (guild_id, type, user_id, user_tag, moderator_id, moderator_tag, reason, duration, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, type, userId, userTag, moderatorId, moderatorTag, reason, duration, active, now());
    return this.getCase(guildId, info.lastInsertRowid);
  },

  getCase(guildId, id) {
    return db.prepare('SELECT * FROM cases WHERE guild_id = ? AND id = ?').get(guildId, id) || null;
  },

  listCases({ guildId, userId = null, type = null, active = null, limit = 50, offset = 0 }) {
    const where = ['guild_id = ?'];
    const params = [guildId];
    if (userId) {
      where.push('user_id = ?');
      params.push(userId);
    }
    if (type) {
      where.push('type = ?');
      params.push(type);
    }
    if (active !== null) {
      where.push('active = ?');
      params.push(active ? 1 : 0);
    }
    const clause = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM cases WHERE ${clause}`).get(...params).c;
    const items = db.prepare(`SELECT * FROM cases WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { items, total };
  },

  countCases(guildId, { type = null, userId = null, active = null } = {}) {
    const where = ['guild_id = ?'];
    const params = [guildId];
    if (type) {
      where.push('type = ?');
      params.push(type);
    }
    if (userId) {
      where.push('user_id = ?');
      params.push(userId);
    }
    if (active !== null) {
      where.push('active = ?');
      params.push(active ? 1 : 0);
    }
    return db.prepare(`SELECT COUNT(*) AS c FROM cases WHERE ${where.join(' AND ')}`).get(...params).c;
  },

  updateCase(guildId, id, patch) {
    const allowed = ['reason', 'active', 'duration'];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return this.getCase(guildId, id);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE cases SET ${sets} WHERE guild_id = ? AND id = ?`)
      .run(...keys.map((k) => patch[k]), guildId, id);
    return this.getCase(guildId, id);
  },

  deleteCase(guildId, id) {
    return db.prepare('DELETE FROM cases WHERE guild_id = ? AND id = ?').run(guildId, id).changes > 0;
  },

  /** حذف كل تحذيرات عضو */
  clearWarnings(guildId, userId) {
    return db.prepare('DELETE FROM cases WHERE guild_id = ? AND user_id = ? AND type = ?')
      .run(guildId, userId, 'warn').changes;
  },

  /* ------------------------------- التذاكر ------------------------------- */

  createTicket({ guildId, channelId, userId, type }) {
    const info = db.prepare(`
      INSERT INTO tickets (guild_id, channel_id, user_id, type, status, created_at)
      VALUES (?, ?, ?, ?, 'open', ?)
    `).run(guildId, channelId, userId, type, now());
    return this.getTicketById(info.lastInsertRowid);
  },

  getTicketById(id) {
    return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) || null;
  },

  getTicketByChannel(channelId) {
    return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) || null;
  },

  listTickets({ guildId, userId = null, status = null, limit = 50, offset = 0 }) {
    const where = ['guild_id = ?'];
    const params = [guildId];
    if (userId) {
      where.push('user_id = ?');
      params.push(userId);
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const clause = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE ${clause}`).get(...params).c;
    const items = db.prepare(`SELECT * FROM tickets WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { items, total };
  },

  countTickets(guildId, status = null) {
    if (status) {
      return db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = ?').get(guildId, status).c;
    }
    return db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ?').get(guildId).c;
  },

  updateTicket(id, patch) {
    const allowed = ['status', 'claimed_by', 'transcript', 'closed_at', 'type'];
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE tickets SET ${sets} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
    }
    return this.getTicketById(id);
  },

  /* ------------------------------- الخبرة ------------------------------- */

  getLevelRow(guildId, userId) {
    return db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId) || null;
  },

  upsertLevel(guildId, userId, { xp, level, messages, voiceMinutes, lastXpAt, textXp = 0, voiceXp = 0, interactXp = 0, interactions = 0 }) {
    db.prepare(`
      INSERT INTO levels (guild_id, user_id, xp, level, messages, voice_minutes, last_xp_at, text_xp, voice_xp, interact_xp, interactions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        xp = excluded.xp,
        level = excluded.level,
        messages = excluded.messages,
        voice_minutes = excluded.voice_minutes,
        last_xp_at = excluded.last_xp_at,
        text_xp = excluded.text_xp,
        voice_xp = excluded.voice_xp,
        interact_xp = excluded.interact_xp,
        interactions = excluded.interactions
    `).run(guildId, userId, xp, level, messages, voiceMinutes, lastXpAt, textXp, voiceXp, interactXp, interactions);
    return this.getLevelRow(guildId, userId);
  },

  /** إضافة خبرة لفترة (يوم/أسبوع) — تُنشئ الصف تلقائيًا */
  addPeriodXp(guildId, userId, period, key, { xp = 0, source = 'text', messages = 0, voiceMinutes = 0, interactions = 0, at = Date.now() } = {}) {
    const column = source === 'voice' ? 'voice_xp' : source === 'interact' ? 'interact_xp' : 'text_xp';
    db.prepare(`
      INSERT INTO xp_periods (guild_id, user_id, period, period_key, xp, text_xp, voice_xp, interact_xp, messages, voice_minutes, interactions, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?)
      ON CONFLICT (guild_id, user_id, period, period_key) DO NOTHING
    `).run(guildId, userId, period, key, at);
    db.prepare(`
      UPDATE xp_periods
         SET xp = xp + ?,
             ${column} = ${column} + ?,
             messages = messages + ?,
             voice_minutes = voice_minutes + ?,
             interactions = interactions + ?,
             updated_at = ?
       WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key = ?
    `).run(xp, xp, messages, voiceMinutes, interactions, at, guildId, userId, period, key);
    return this.getPeriodRow(guildId, userId, period, key);
  },

  getPeriodRow(guildId, userId, period, key) {
    return db.prepare('SELECT * FROM xp_periods WHERE guild_id = ? AND user_id = ? AND period = ? AND period_key = ?')
      .get(guildId, userId, period, key) || null;
  },

  getPeriodLeaderboard(guildId, period, key, limit = 10, offset = 0) {
    return db.prepare(`
      SELECT * FROM xp_periods
       WHERE guild_id = ? AND period = ? AND period_key = ? AND xp > 0
       ORDER BY xp DESC, updated_at ASC
       LIMIT ? OFFSET ?
    `).all(guildId, period, key, limit, offset);
  },

  countPeriodMembers(guildId, period, key) {
    return db.prepare('SELECT COUNT(*) AS c FROM xp_periods WHERE guild_id = ? AND period = ? AND period_key = ? AND xp > 0')
      .get(guildId, period, key).c;
  },

  /** ترتيب عضو داخل فترة معيّنة (1 = الأول) */
  getPeriodRank(guildId, userId, period, key) {
    const row = this.getPeriodRow(guildId, userId, period, key);
    if (!row || row.xp <= 0) return null;
    const better = db.prepare('SELECT COUNT(*) AS c FROM xp_periods WHERE guild_id = ? AND period = ? AND period_key = ? AND xp > ?')
      .get(guildId, period, key, row.xp).c;
    return better + 1;
  },

  /** مسح فترات عضو (يُستخدم عند التصفير) */
  clearPeriods(guildId, userId) {
    db.prepare('DELETE FROM xp_periods WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  },

  /** تصفير عضو بالكامل: المستويات + الفترات */
  resetLevel(guildId, userId) {
    db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    db.prepare('DELETE FROM xp_periods WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    return true;
  },

  /** إجماليات الخبرة حسب المصدر (لوحة التحكم) */
  getXpTotals(guildId, period = null, key = null) {
    if (period && period !== 'all' && key) {
      return db.prepare(`
        SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(text_xp), 0) AS text_xp,
               COALESCE(SUM(voice_xp), 0) AS voice_xp, COALESCE(SUM(interact_xp), 0) AS interact_xp,
               COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_minutes), 0) AS voice_minutes,
               COALESCE(SUM(interactions), 0) AS interactions
          FROM xp_periods WHERE guild_id = ? AND period = ? AND period_key = ?
      `).get(guildId, period, key);
    }
    return db.prepare(`
      SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(text_xp), 0) AS text_xp,
             COALESCE(SUM(voice_xp), 0) AS voice_xp, COALESCE(SUM(interact_xp), 0) AS interact_xp,
             COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_minutes), 0) AS voice_minutes,
             COALESCE(SUM(interactions), 0) AS interactions
        FROM levels WHERE guild_id = ?
    `).get(guildId);
  },

  getLeaderboard(guildId, limit = 10, offset = 0) {
    return db.prepare('SELECT * FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?')
      .all(guildId, limit, offset);
  },

  countTrackedMembers(guildId) {
    return db.prepare('SELECT COUNT(*) AS c FROM levels WHERE guild_id = ?').get(guildId).c;
  },

  /* --------------------------- إحصائيات يومية --------------------------- */

  bumpDaily(guildId, field, amount = 1) {
    const day = today();
    if (!['messages', 'joins', 'leaves'].includes(field)) return;
    db.prepare(`
      INSERT INTO stats_daily (guild_id, day, messages, joins, leaves) VALUES (?, ?, 0, 0, 0)
      ON CONFLICT (guild_id, day) DO NOTHING
    `).run(guildId, day);
    db.prepare(`UPDATE stats_daily SET ${field} = ${field} + ? WHERE guild_id = ? AND day = ?`)
      .run(amount, guildId, day);
  },

  /** كتابة إحصائية يوم محدّد (تُستخدم في البيانات التجريبية والتقارير) */
  setDaily(guildId, day, { messages = 0, joins = 0, leaves = 0 } = {}) {
    db.prepare(`
      INSERT INTO stats_daily (guild_id, day, messages, joins, leaves) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, day) DO UPDATE SET
        messages = excluded.messages, joins = excluded.joins, leaves = excluded.leaves
    `).run(guildId, day, messages, joins, leaves);
  },

  getDailyStats(guildId, days = 14) {
    return db.prepare('SELECT * FROM stats_daily WHERE guild_id = ? ORDER BY day DESC LIMIT ?').all(guildId, days).reverse();
  },

  /* ------------------------------ التذكيرات ------------------------------ */

  addReminder({ guildId, channelId, userId, content, remindAt }) {
    const info = db.prepare(`
      INSERT INTO reminders (guild_id, channel_id, user_id, content, remind_at) VALUES (?, ?, ?, ?, ?)
    `).run(guildId, channelId, userId, content, remindAt);
    return db.prepare('SELECT * FROM reminders WHERE id = ?').get(info.lastInsertRowid);
  },

  dueReminders(ts = now()) {
    return db.prepare('SELECT * FROM reminders WHERE remind_at <= ?').all(ts);
  },

  deleteReminder(id) {
    db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
  },

  /* ------------------------------ سجل النشاط (تدقيق) ------------------------------ */

  addAudit(entry = {}) {
    const row = {
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
    const info = db
      .prepare(
        `INSERT INTO audit_log (guild_id, actor_id, actor_name, action, target, detail, ip_hash, severity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.guildId, row.actorId, row.actorName, row.action, row.target, row.detail, row.ipHash, row.severity, row.at);
    return { id: Number(info.lastInsertRowid), ...row };
  },

  listAudit({ guildId = undefined, action = null, severity = null, limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (guildId === null) {
      where.push('guild_id IS NULL');
    } else if (guildId !== undefined) {
      where.push('guild_id = ?');
      params.push(guildId);
    }
    if (action) {
      where.push('action LIKE ?');
      params.push(`${action}%`);
    }
    if (severity) {
      where.push('severity = ?');
      params.push(severity);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const items = db
      .prepare(`SELECT * FROM audit_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, Math.min(500, Math.max(1, limit)), Math.max(0, offset));
    const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${clause}`).get(...params).c;
    return { items, total };
  },

  countAudit({ guildId = undefined } = {}) {
    if (guildId === undefined) return db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
    if (guildId === null) return db.prepare('SELECT COUNT(*) AS c FROM audit_log WHERE guild_id IS NULL').get().c;
    return db.prepare('SELECT COUNT(*) AS c FROM audit_log WHERE guild_id = ?').get(guildId).c;
  },

  /**
   * تقليم السجل: يبقي أحدث «keep» حدث فقط.
   * ملاحظة: حدّ أدنى ١٠٠ حدث حتى لا يمسح أي نداء خاطئ السجل كامل.
   */
  pruneAudit(keep = 5000) {
    const limitRows = Math.max(100, Number(keep) || 5000);
    const info = db
      .prepare('DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ?)')
      .run(limitRows);
    return info.changes;
  },

  /* ------------------------------ لوحة التحكم ------------------------------ */

  getStats(guildId) {
    return {
      cases: this.countCases(guildId),
      warnings: this.countCases(guildId, { type: 'warn' }),
      bans: this.countCases(guildId, { type: 'ban' }),
      kicks: this.countCases(guildId, { type: 'kick' }),
      timeouts: this.countCases(guildId, { type: 'timeout' }),
      tickets: this.countTickets(guildId),
      openTickets: this.countTickets(guildId, 'open'),
      trackedMembers: this.countTrackedMembers(guildId),
      xpSum: db.prepare('SELECT COALESCE(SUM(xp), 0) AS s FROM levels WHERE guild_id = ?').get(guildId).s,
      messages: db.prepare('SELECT COALESCE(SUM(messages), 0) AS s FROM levels WHERE guild_id = ?').get(guildId).s,
    };
  },

  close() {
    if (db) db.close();
    db = null;
  },
};
