'use strict';

/**
 * web/siteUsers.js
 * -------------------------------------------------------------
 * سجلّ أعضاء الموقع: كل من سجّل دخول بحساب Discord يُحفظ هنا.
 *
 *  • المالك (OWNER_USER_ID) يرى السجل كامل ويدير الحالات.
 *  • حالات العضو:
 *      active   → طبيعي (تعديل حسب صلاحياته)
 *      viewonly → يشوف كل شي لكن ما يعدّل ولا يحفظ شي
 *      banned   → محظور من الموقع بالكامل (تُقطع جلسته فورًا)
 *
 * التخزين: داخل قاعدة البيانات (kv) ⇒ يبقى محفوظًا بعد كل إعادة نشر.
 * -------------------------------------------------------------
 */

const config = require('../config');
const db = require('../database');

const KV_KEY = 'site_users_v1';

/** الحالات المتاحة + وصفها بالعربي (تُستخدم في اللوحة) */
const STATUS = {
  active: { key: 'active', label: 'نشِط', desc: 'يستخدم الموقع بشكل طبيعي حسب صلاحياته', icon: 'check' },
  viewonly: { key: 'viewonly', label: 'مشاهدة فقط', desc: 'يشوف كل الصفحات والإعدادات لكن ما يقدر يعدّل أو يحفظ', icon: 'eye' },
  banned: { key: 'banned', label: 'محظور', desc: 'ممنوع من دخول الموقع نهائيًا وتُقطع جلسته فورًا', icon: 'ban' },
};

let cache = null;

/** مالك الموقع (رقم حسابه في ديسكورد) */
function ownerId() {
  return String(config.web.ownerUserId || '').trim();
}

/** هل هذا الحساب هو مالك الموقع؟ */
function isOwner(userId) {
  const id = String(userId || '');
  return Boolean(id) && id === ownerId();
}

/** قراءة السجل من قاعدة البيانات (مرة واحدة ثم كاش) */
function load() {
  if (cache) return cache;
  let users = {};
  try {
    const raw = db.getKV(KV_KEY);
    if (raw) users = JSON.parse(raw) || {};
  } catch {
    users = {};
  }
  cache = { users };
  return cache;
}

function save(store) {
  try {
    db.setKV(KV_KEY, JSON.stringify(store.users));
  } catch {
    /* لا نُسقط الطلب لو فشل الحفظ */
  }
}

/** شكل السجل الافتراضي لحساب جديد */
function emptyUser(user = {}) {
  const now = Date.now();
  return {
    id: String(user.id),
    username: user.username || '',
    globalName: user.globalName || user.global_name || user.username || '',
    avatar: user.avatar || null,
    status: 'active',
    allowed: false,
    firstSeen: now,
    lastSeen: now,
    visits: 0,
    guilds: 0,
    bannedAt: null,
    bannedBy: null,
    note: '',
  };
}

/**
 * تسجيل دخول عضو (أو تحديث بياناته) — تُنادى من /auth/callback.
 * لا تُلغي الحالة الإدارية (حظر/مشاهدة فقط) أبدًا.
 */
function recordLogin(user = {}, extra = {}) {
  const store = load();
  const id = String(user.id || '');
  if (!id) return null;

  const prev = store.users[id];
  const entry = prev ? { ...prev } : emptyUser(user);

  entry.username = user.username || entry.username;
  entry.globalName = user.globalName || user.global_name || entry.globalName;
  if (user.avatar !== undefined) entry.avatar = user.avatar || entry.avatar;
  entry.lastSeen = Date.now();
  entry.visits = (entry.visits || 0) + 1;
  entry.firstSeen = entry.firstSeen || Date.now();
  if (typeof extra.guilds === 'number') entry.guilds = extra.guilds;
  if (extra.ip) entry.lastIp = String(extra.ip).slice(0, 45);
  if (extra.userAgent) entry.ua = String(extra.userAgent).slice(0, 180);
  entry.lastLoginAt = Date.now();
  if (typeof entry.allowed !== 'boolean') entry.allowed = false;

  store.users[id] = entry;
  save(store);
  return entry;
}

/**
 * تحديث آخر ظهور (عند كل زيارة للموقع — خفيف على القرص).
 * لو العضو غير موجود في السجل (مثل من سجّل دخوله قبل هذه الميزة) نُضيفه تلقائيًا.
 */
function touch(userId, extra = {}) {
  const store = load();
  const id = String(userId || '');
  if (!id) return null;
  let entry = store.users[id];
  if (!entry) {
    entry = emptyUser(extra.user || { id });
    entry.visits = 1;
    store.users[id] = entry;
    save(store);
    return entry;
  }
  const now = Date.now();
  // نكتب على القرص مرة كل دقيقتين كحد أقصى لكل عضو
  const shouldSave = !entry.lastSeen || now - entry.lastSeen > 120 * 1000;
  entry.lastSeen = now;
  if (extra.ip) entry.lastIp = String(extra.ip).slice(0, 45);
  if (shouldSave) save(store);
  return entry;
}

/** حساب واحد بالمعرّف */
function get(userId) {
  return load().users[String(userId)] || null;
}

/** كل الحسابات مرتّبة (الأحدث ظهورًا أولًا) */
function list() {
  const store = load();
  return Object.values(store.users)
    .map((u) => ({
      ...u,
      status: u.status || 'active',
      allowed: isOwner(u.id) || u.allowed === true,
      isOwner: isOwner(u.id),
      isAdmin: isOwner(u.id),
    }))
    .sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      const waiting = (u) => !u.allowed && u.status !== 'banned';
      if (waiting(a) !== waiting(b)) return waiting(a) ? -1 : 1;
      if ((a.status === 'banned') !== (b.status === 'banned')) return a.status === 'banned' ? 1 : -1;
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });
}

/** عدد الحسابات المتابَعة */
function count() {
  return Object.keys(load().users).length;
}

/** حالة العضو (active افتراضيًا) */
function statusOf(userId) {
  if (isOwner(userId)) return 'active';
  const entry = get(userId);
  return entry?.status || 'active';
}

const isBanned = (userId) => statusOf(userId) === 'banned';
const isViewOnly = (userId) => statusOf(userId) === 'viewonly';

/** هل يسمح لهذا الحساب بدخول الموقع؟ المالك دائمًا، والباقي لازم يضيفهم المالك. */
function isAllowed(userId) {
  const id = String(userId || '');
  if (!id) return false;
  if (isOwner(id)) return true;
  if ((config.web.siteAdmins || []).map(String).includes(id)) return true;
  const entry = get(id);
  return Boolean(entry && entry.allowed === true && entry.status !== 'banned');
}

/**
 * إضافة حساب لقائمة الدخول (حتى قبل ما يسجّل).
 * المعرّف لازم يكون آيدي ديسكورد.
 */
function grant(userId, { by = null, user = {} } = {}) {
  const id = String(userId || '').trim();
  if (!/^\d{15,22}$/.test(id)) return { ok: false, error: 'bad_id' };
  if (isOwner(id)) return { ok: false, error: 'owner_protected' };

  const store = load();
  const prev = store.users[id];
  const entry = prev ? { ...prev } : emptyUser({ id, ...user });
  entry.allowed = true;
  entry.allowedAt = Date.now();
  entry.allowedBy = by ? String(by) : null;
  if (user.username) entry.username = user.username;
  if (user.globalName) entry.globalName = user.globalName;
  if (entry.status === 'banned') {
    entry.status = 'active';
    entry.bannedAt = null;
    entry.bannedBy = null;
  }
  store.users[id] = entry;
  save(store);
  return { ok: true, user: entry };
}

/** هل يُسمح لهذا الحساب بالتعديل؟ (الحظر والمشاهدة فقط يمنعان) */
function mayEdit(userId) {
  if (isOwner(userId)) return true;
  const st = statusOf(userId);
  return st === 'active';
}

/**
 * تغيير حالة حساب (يُستخدم من لوحة المالك فقط).
 * @returns {{ok:boolean, error?:string, user?:object}}
 */
function setStatus(userId, status, { reason = '', by = null } = {}) {
  const id = String(userId || '');
  if (!STATUS[status]) return { ok: false, error: 'status_unknown' };
  if (!id) return { ok: false, error: 'missing_id' };
  if (isOwner(id)) return { ok: false, error: 'owner_protected' };

  const store = load();
  const entry = store.users[id];
  if (!entry) return { ok: false, error: 'user_not_found' };

  entry.status = status;
  if (status === 'banned') {
    entry.bannedAt = Date.now();
    entry.bannedBy = by ? String(by) : null;
    entry.note = String(reason || '').slice(0, 200);
  } else {
    entry.bannedAt = null;
    entry.bannedBy = null;
    entry.note = String(reason || entry.note || '').slice(0, 200);
  }
  store.users[id] = entry;
  save(store);
  return { ok: true, user: entry };
}

/** حذف حساب من السجل (نسيان العضو) */
function forget(userId) {
  const id = String(userId || '');
  if (isOwner(id)) return { ok: false, error: 'owner_protected' };
  const store = load();
  if (!store.users[id]) return { ok: false, error: 'user_not_found' };
  delete store.users[id];
  save(store);
  return { ok: true };
}

/** إحصاءات سريعة للوحة */
function stats() {
  const users = list();
  const byStatus = { active: 0, viewonly: 0, banned: 0 };
  for (const u of users) byStatus[u.status] = (byStatus[u.status] || 0) + 1;
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  return {
    total: users.length,
    byStatus,
    onlineToday: users.filter((u) => (u.lastSeen || 0) > dayAgo).length,
    totalVisits: users.reduce((sum, u) => sum + (u.visits || 0), 0),
  };
}

/** إعادة تحميل السجل من القرص (لأغراض الاختبار) */
function reload() {
  cache = null;
  return load();
}

module.exports = {
  KV_KEY,
  STATUS,
  ownerId,
  isOwner,
  recordLogin,
  touch,
  get,
  list,
  count,
  statusOf,
  isBanned,
  isViewOnly,
  isAllowed,
  grant,
  mayEdit,
  setStatus,
  forget,
  stats,
  reload,
};
