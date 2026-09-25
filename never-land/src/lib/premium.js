'use strict';

/**
 * lib/premium.js
 * ------------------------------------------------------------
 * اشتراك البوت (مو دعم ديسكورد، ومو بوابة دفع).
 * المالك يفعّل الخطة من الموقع. مشرف السيرفر يطلبها من اللوحة.
 * الوحدات الحالية تبقى شغّالة — البريميوم يضيف شارة وخطة، ما يقفل شي.
 * ------------------------------------------------------------
 */

const db = require('../database');

const STORE_KEY = 'premium:subs';
const PRICE_KEY = 'premium:prices';
const DAY = 86400000;

const PLANS = {
  month: { id: 'month', days: 30, label: 'شهر' },
  quarter: { id: 'quarter', days: 90, label: '٣ أشهر' },
  year: { id: 'year', days: 365, label: 'سنة' },
  lifetime: { id: 'lifetime', days: 0, label: 'دائم' },
};

const BENEFITS = [
  { title: 'شارة في اللوحة', text: 'تاج ذهبي على اسم السيرفر لما الخطة شغّالة.' },
  { title: 'أمر premium', text: 'يعرض الخطة وتاريخ الانتهاء داخل ديسكورد.' },
  { title: 'تفعيل من المالك', text: 'الطلب يوصل لقائمة الاشتراكات، والمالك يفعّل المدة.' },
  { title: 'بدون قفل', text: 'الترحيب والسجلات والتذاكر والإشراف تبقى شغّالة.' },
];

function hideIds(text) {
  return String(text || '')
    .replace(/\d{15,25}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 180);
}

function readJson(key, fallback) {
  try {
    const raw = db.getKV(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  db.setKV(key, JSON.stringify(value));
}

function blankSub() {
  return {
    plan: null,
    until: null,
    active: false,
    status: 'free',
    requestedAt: null,
    requestNote: '',
    grantedAt: null,
  };
}

function loadSubs() {
  return readJson(STORE_KEY, {});
}

function saveSubs(all) {
  writeJson(STORE_KEY, all);
}

function syncFlag(guildId, on) {
  try {
    if (typeof db.setPremium === 'function') db.setPremium(guildId, Boolean(on));
  } catch {
    /* العمود اختياري — السجل في kv يكفي */
  }
}

function normalize(raw) {
  const row = { ...blankSub(), ...(raw && typeof raw === 'object' ? raw : {}) };
  row.plan = PLANS[row.plan] ? row.plan : null;
  row.until = row.until ? Number(row.until) : null;
  if (!Number.isFinite(row.until)) row.until = null;
  row.active = Boolean(row.active);
  row.requestNote = hideIds(row.requestNote || '');
  if (row.active && row.until && row.until <= Date.now()) {
    row.active = false;
    row.status = 'expired';
  }
  if (row.active) row.status = 'active';
  else if (!row.status || row.status === 'active') {
    row.status = row.requestedAt ? 'requested' : 'free';
  }
  return row;
}

function get(guildId) {
  const all = loadSubs();
  const row = normalize(all[guildId]);
  const stored = all[guildId];
  if (stored && stored.active && !row.active) {
    all[guildId] = row;
    saveSubs(all);
    syncFlag(guildId, false);
  }
  return row;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatUntil(until) {
  const d = new Date(Number(until));
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function statusLabel(row) {
  if (row.active) return 'بريميوم';
  if (row.status === 'requested') return 'طلب معلّق';
  if (row.status === 'expired') return 'منتهي';
  if (row.status === 'cancelled') return 'ملغى';
  return 'مجاني';
}

function prices() {
  const raw = readJson(PRICE_KEY, {});
  return {
    month: hideIds(raw.month || '').slice(0, 40),
    quarter: hideIds(raw.quarter || '').slice(0, 40),
    year: hideIds(raw.year || '').slice(0, 40),
    note: hideIds(raw.note || ''),
  };
}

function setPrices(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const next = {
    month: hideIds(src.month || '').slice(0, 40),
    quarter: hideIds(src.quarter || '').slice(0, 40),
    year: hideIds(src.year || '').slice(0, 40),
    note: hideIds(src.note || ''),
  };
  writeJson(PRICE_KEY, next);
  return next;
}

function planCards() {
  const p = prices();
  return ['month', 'quarter', 'year', 'lifetime'].map((id) => ({
    id,
    label: PLANS[id].label,
    days: PLANS[id].days,
    price: id === 'lifetime' ? '' : (p[id] || ''),
  }));
}

function emptyView() {
  return {
    active: false,
    status: 'free',
    statusLabel: 'مجاني',
    plan: null,
    planLabel: '',
    untilLabel: '',
    requested: false,
    requestNote: '',
    prices: { month: '', quarter: '', year: '', note: '' },
    plans: ['month', 'quarter', 'year', 'lifetime'].map((id) => ({
      id,
      label: PLANS[id].label,
      days: PLANS[id].days,
      price: '',
    })),
    benefits: BENEFITS,
  };
}

function publicView(guildId) {
  try {
    const row = get(guildId);
    const plan = PLANS[row.plan] || null;
    return {
      active: Boolean(row.active),
      status: row.status || 'free',
      statusLabel: statusLabel(row),
      plan: plan ? plan.id : null,
      planLabel: plan ? plan.label : '',
      untilLabel: row.until ? formatUntil(row.until) : (row.active ? 'دائم' : ''),
      requested: row.status === 'requested' && !row.active,
      requestNote: hideIds(row.requestNote || ''),
      prices: prices(),
      plans: planCards(),
      benefits: BENEFITS,
    };
  } catch {
    return emptyView();
  }
}

function request(guildId, note) {
  const all = loadSubs();
  const row = normalize(all[guildId]);
  if (row.active) {
    return { ok: false, error: 'active', message: 'الاشتراك شغّال أصلًا.', view: publicView(guildId) };
  }
  row.status = 'requested';
  row.requestedAt = Date.now();
  row.requestNote = hideIds(note);
  row.active = false;
  all[guildId] = row;
  saveSubs(all);
  return { ok: true, message: 'وصل الطلب لمالك الموقع.', view: publicView(guildId) };
}

function grant(guildId, planId) {
  const plan = PLANS[planId];
  if (!plan) return { ok: false, error: 'plan', message: 'الخطة غير معروفة.' };
  const all = loadSubs();
  const row = normalize(all[guildId]);
  const now = Date.now();
  if (row.active && !row.until && plan.days > 0) {
    return { ok: true, message: 'الاشتراك دائم أصلًا.', view: publicView(guildId) };
  }
  let until = null;
  if (plan.days > 0) {
    const base = row.active && row.until && row.until > now ? row.until : now;
    until = base + plan.days * DAY;
  }
  row.plan = plan.id;
  row.until = until;
  row.active = true;
  row.status = 'active';
  row.grantedAt = now;
  all[guildId] = row;
  saveSubs(all);
  syncFlag(guildId, true);
  const view = publicView(guildId);
  const message = until
    ? `تم تفعيل الخطة (${plan.label}). تنتهي ${formatUntil(until)}.`
    : 'تم تفعيل الخطة الدائمة.';
  return { ok: true, message, view };
}

function revoke(guildId) {
  const all = loadSubs();
  const row = normalize(all[guildId]);
  row.active = false;
  row.until = null;
  row.plan = null;
  row.status = row.requestedAt ? 'cancelled' : 'free';
  all[guildId] = row;
  saveSubs(all);
  syncFlag(guildId, false);
  return {
    ok: true,
    message: 'تم إلغاء البريميوم. الوحدات المجانية تبقى شغّالة.',
    view: publicView(guildId),
  };
}

function guildMeta(guildId) {
  let name = '';
  let members = null;
  try {
    const snap = require('../sync').getSnapshot(guildId);
    if (snap?.name) name = String(snap.name);
    if (Number.isFinite(Number(snap?.memberCount))) members = Number(snap.memberCount);
  } catch {
    /* اللقطة اختيارية */
  }
  if (!name) {
    try {
      const client = require('../client');
      const guild = client?.guilds?.cache?.get(String(guildId));
      if (guild?.name) name = String(guild.name);
      if (Number.isFinite(Number(guild?.memberCount))) members = Number(guild.memberCount);
    } catch {
      /* البوت مو لازم يكون محمّل مع الموقع */
    }
  }
  name = hideIds(name).slice(0, 80);
  return { name: name || 'سيرفر', members: Number.isFinite(members) ? members : null };
}

function knownGuildIds() {
  const ids = new Set();
  try {
    for (const id of require('../sync').listIds()) ids.add(String(id));
  } catch {
    /* بلا لقطات */
  }
  try {
    const cache = require('../client')?.guilds?.cache;
    if (cache) for (const id of cache.keys()) ids.add(String(id));
  } catch {
    /* بلا بوت */
  }
  try {
    const guilds = typeof db.getAllGuilds === 'function' ? db.getAllGuilds() : [];
    if (Array.isArray(guilds)) {
      for (const guild of guilds) if (guild?.id) ids.add(String(guild.id));
    }
  } catch {
    /* القاعدة لسا ما انفتحت */
  }
  for (const id of Object.keys(loadSubs())) ids.add(String(id));
  return [...ids].filter((id) => /^\d{15,25}$/.test(id));
}

function ownerList() {
  const all = loadSubs();
  let changed = false;
  const rows = knownGuildIds().map((guildId) => {
    const row = normalize(all[guildId]);
    if (all[guildId] && all[guildId].active && !row.active) {
      all[guildId] = row;
      changed = true;
      syncFlag(guildId, false);
    }
    const plan = PLANS[row.plan] || null;
    const meta = guildMeta(guildId);
    return {
      guildId,
      name: meta.name,
      members: meta.members,
      status: row.status || 'free',
      statusLabel: statusLabel(row),
      active: Boolean(row.active),
      planLabel: plan ? plan.label : '',
      untilLabel: row.until ? formatUntil(row.until) : (row.active ? 'دائم' : ''),
      note: hideIds(row.requestNote || ''),
      requested: row.status === 'requested' && !row.active,
    };
  });
  if (changed) saveSubs(all);
  rows.sort((a, b) => {
    const rank = (s) => (s.requested ? 0 : s.active ? 1 : 2);
    return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'ar');
  });
  return rows;
}

function activeIds() {
  const all = loadSubs();
  let changed = false;
  const set = new Set();
  for (const [id, raw] of Object.entries(all)) {
    const row = normalize(raw);
    if (raw && raw.active && !row.active) {
      all[id] = row;
      changed = true;
      syncFlag(id, false);
    }
    if (row.active) set.add(String(id));
  }
  if (changed) saveSubs(all);
  return set;
}

module.exports = {
  PLANS,
  BENEFITS,
  publicView,
  request,
  grant,
  revoke,
  prices,
  setPrices,
  ownerList,
  activeIds,
  guildMeta,
  hideIds,
};
