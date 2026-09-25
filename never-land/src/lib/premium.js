'use strict';

/**
 * lib/premium.js
 * ------------------------------------------------------------
 * اشتراك البوت (مو دعم ديسكورد).
 * درجة ٢: 4 يورو بالشهر، 25 يورو بالسنة.
 * درجة ١: 7 يورو بالشهر، 60 يورو بالسنة — ميزاتها أقوى.
 * الدفع تحويل. الخطة تتفعل لما يتأكد وصول المبلغ.
 * الوحدات الحالية ما تنقفل.
 * ------------------------------------------------------------
 */

const crypto = require('node:crypto');
const db = require('../database');

const STORE_KEY = 'premium:subs';
const ORDER_KEY = 'premium:orders';
const PAY_KEY = 'premium:payout';
const DAY = 86400000;
const ORDER_LIFE = 7 * DAY;

const PLANS = {
  month: { id: 'month', days: 30, label: 'شهر', tier: 2 },
  quarter: { id: 'quarter', days: 90, label: '٣ أشهر', tier: 2 },
  year: { id: 'year', days: 365, label: 'سنة', tier: 2 },
  lifetime: { id: 'lifetime', days: 0, label: 'دائم', tier: 2 },
  g2m: { id: 'g2m', days: 30, label: 'درجة ثانية · شهر', tier: 2, amount: 400 },
  g2y: { id: 'g2y', days: 365, label: 'درجة ثانية · سنة', tier: 2, amount: 2500 },
  g1m: { id: 'g1m', days: 30, label: 'درجة أولى · شهر', tier: 1, amount: 700 },
  g1y: { id: 'g1y', days: 365, label: 'درجة أولى · سنة', tier: 1, amount: 6000 },
};

const OFFERS = ['g2m', 'g2y', 'g1m', 'g1y'];

const FEATURES = {
  2: [
    { title: 'شارة درجة ثانية', text: 'تاج على اسم السيرفر طول ما الاشتراك شغّال.' },
    { title: 'خبرة +25٪', text: 'الرسائل والصوت والتفاعل يعطون خبرة أعلى من المجاني.' },
    { title: 'سطر درجة ثانية', text: 'يظهر في الترحيب وداخل التذكرة.' },
    { title: 'بدون قفل', text: 'الترحيب والسجلات والتذاكر والإشراف تبقى شغّالة.' },
  ],
  1: [
    { title: 'شارة درجة أولى', text: 'تاج ذهبي أقوى من درجة ثانية.' },
    { title: 'خبرة +50٪ وزيادة', text: 'كل نقطة خبرة أعلى من درجة ثانية، مو بس من المجاني.' },
    { title: 'أولوية أقوى', text: 'سطر ترحيب بتاج، وأولوية أوضح داخل التذكرة.' },
    { title: 'بدون قفل', text: 'الوحدات الحالية تبقى شغّالة. الدرجة الأولى ما بتقفل شي.' },
  ],
};

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
    return parsed && typeof parsed === 'object' ? parsed : fallback;
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
    tier: null,
    until: null,
    active: false,
    status: 'free',
    requestedAt: null,
    requestNote: '',
    grantedAt: null,
  };
}

function loadSubs() {
  const raw = readJson(STORE_KEY, {});
  return raw && !Array.isArray(raw) ? raw : {};
}

function saveSubs(all) {
  writeJson(STORE_KEY, all);
}

function loadOrders() {
  const raw = readJson(ORDER_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function saveOrders(rows) {
  writeJson(ORDER_KEY, rows.slice(0, 80));
}

function syncFlag(guildId, on) {
  try {
    if (typeof db.setPremium === 'function') db.setPremium(guildId, Boolean(on));
  } catch {
    /* العمود اختياري — السجل في kv يكفي */
  }
}

function inferTier(row) {
  if (row.tier === 1 || row.tier === 2) return row.tier;
  const plan = PLANS[row.plan];
  if (plan?.tier) return plan.tier;
  return row.active ? 2 : null;
}

function normalize(raw) {
  const row = { ...blankSub(), ...(raw && typeof raw === 'object' ? raw : {}) };
  row.plan = PLANS[row.plan] ? row.plan : null;
  row.until = row.until ? Number(row.until) : null;
  if (!Number.isFinite(row.until)) row.until = null;
  row.active = Boolean(row.active);
  row.requestNote = hideIds(row.requestNote || '');
  row.tier = inferTier(row);
  if (row.active && row.until && row.until <= Date.now()) {
    row.active = false;
    row.tier = null;
    row.status = 'expired';
  }
  if (row.active) row.status = 'active';
  else if (!row.status || row.status === 'active') {
    row.status = row.requestedAt ? 'requested' : 'free';
  }
  if (!row.active) row.tier = null;
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

function money(cents) {
  const n = Number(cents) / 100;
  if (!Number.isFinite(n)) return '';
  return `${Number.isInteger(n) ? n : n.toFixed(2)} يورو`;
}

function tierLabel(tier) {
  if (tier === 1) return 'درجة أولى';
  if (tier === 2) return 'درجة ثانية';
  return '';
}

function statusLabel(row) {
  if (row.active && row.tier === 1) return 'درجة أولى';
  if (row.active) return 'درجة ثانية';
  if (row.status === 'requested') return 'طلب معلّق';
  if (row.status === 'expired') return 'منتهي';
  if (row.status === 'cancelled') return 'ملغى';
  return 'مجاني';
}

function effects(guildId) {
  try {
    const row = get(guildId);
    if (!row.active) return null;
    const tier = row.tier === 1 ? 1 : 2;
    return {
      tier,
      xpMul: tier === 1 ? 1.5 : 1.25,
      xpBonus: tier === 1 ? 1 : 0,
      welcome: tier === 1 ? '👑 درجة أولى' : '✨ درجة ثانية',
      ticket: tier === 1 ? 'أولوية درجة أولى.' : 'أولوية درجة ثانية.',
    };
  } catch {
    return null;
  }
}

function boostXp(guildId, amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return amount;
  try {
    const fx = effects(guildId);
    if (!fx) return n;
    return Math.ceil(n * fx.xpMul) + (fx.xpBonus || 0);
  } catch {
    return n;
  }
}

function welcomeLine(guildId) {
  return effects(guildId)?.welcome || '';
}

function ticketNote(guildId) {
  return effects(guildId)?.ticket || '';
}

function cleanAccount(value) {
  return String(value || '').replace(/[^\w@.+ -]/g, '').trim().slice(0, 64);
}

function displayAccount(value) {
  const raw = cleanAccount(value);
  if (!raw || /@/.test(raw)) return raw;
  const compact = raw.replace(/\s/g, '');
  if (compact.length < 12) return raw;
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

function cleanUrl(value) {
  const url = String(value || '').trim().slice(0, 180);
  return /^https:\/\//i.test(url) ? url : '';
}

function payout() {
  const raw = readJson(PAY_KEY, {});
  const src = raw && !Array.isArray(raw) ? raw : {};
  return {
    method: hideIds(src.method || '').slice(0, 40),
    holder: hideIds(src.holder || '').slice(0, 60),
    bank: hideIds(src.bank || '').slice(0, 40),
    account: cleanAccount(src.account || ''),
    note: hideIds(src.note || ''),
    payUrl: cleanUrl(src.payUrl || ''),
  };
}

function setPayout(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const next = {
    method: hideIds(src.method || '').slice(0, 40),
    holder: hideIds(src.holder || '').slice(0, 60),
    bank: hideIds(src.bank || '').slice(0, 40),
    account: cleanAccount(src.account || ''),
    note: hideIds(src.note || ''),
    payUrl: cleanUrl(src.payUrl || ''),
  };
  writeJson(PAY_KEY, next);
  return next;
}

function payoutPublic() {
  const row = payout();
  return {
    published: Boolean(row.account || row.payUrl),
    method: row.method,
    holder: row.holder,
    bank: row.bank,
    account: displayAccount(row.account),
    accountRaw: row.account,
    note: row.note,
    payUrl: row.payUrl,
  };
}

function offerCards() {
  return OFFERS.map((id) => {
    const plan = PLANS[id];
    return {
      id,
      tier: plan.tier,
      tierLabel: tierLabel(plan.tier),
      label: plan.label,
      days: plan.days,
      amount: plan.amount,
      price: money(plan.amount),
    };
  });
}

function prices() {
  return {
    month: '4 يورو',
    quarter: '',
    year: '25 يورو',
    note: 'درجة ٢: 4 يورو بالشهر و25 بالسنة. درجة ١: 7 يورو بالشهر و60 بالسنة.',
  };
}

function setPrices() {
  return prices();
}

function planCards() {
  return offerCards().map((offer) => ({
    id: offer.id,
    label: offer.label,
    days: offer.days,
    price: offer.price,
    tier: offer.tier,
  }));
}

function openOrder(guildId) {
  const now = Date.now();
  return loadOrders().find((row) => (
    String(row.guildId) === String(guildId)
    && (row.status === 'awaiting_transfer' || row.status === 'proof_sent')
    && now - Number(row.createdAt || 0) < ORDER_LIFE
  )) || null;
}

function orderView(row) {
  if (!row) return null;
  const plan = PLANS[row.offer] || null;
  return {
    id: String(row.id || ''),
    offer: plan ? plan.id : '',
    label: plan ? plan.label : '',
    tier: plan ? plan.tier : null,
    price: money(row.amount),
    status: row.status || 'awaiting_transfer',
    statusLabel: row.status === 'proof_sent' ? 'إثبات وصل' : 'بانتظار التحويل',
    proof: String(row.proof || '').slice(0, 40),
  };
}

function emptyView() {
  return {
    active: false,
    status: 'free',
    statusLabel: 'مجاني',
    plan: null,
    planLabel: '',
    tier: null,
    tierLabel: '',
    untilLabel: '',
    boost: '',
    requested: false,
    requestNote: '',
    prices: prices(),
    plans: planCards(),
    offers: offerCards(),
    features: FEATURES,
    benefits: FEATURES[2],
    pay: { ...payoutPublic(), order: null },
  };
}

function publicView(guildId) {
  try {
    const row = get(guildId);
    const plan = PLANS[row.plan] || null;
    const tier = row.active ? (row.tier === 1 ? 1 : 2) : null;
    return {
      active: Boolean(row.active),
      status: row.status || 'free',
      statusLabel: statusLabel(row),
      plan: plan ? plan.id : null,
      planLabel: plan ? plan.label : '',
      tier,
      tierLabel: tierLabel(tier),
      untilLabel: row.until ? formatUntil(row.until) : (row.active ? 'دائم' : ''),
      boost: tier === 1 ? 'خبرة +50٪ وأولوية أقوى' : (tier === 2 ? 'خبرة +25٪' : ''),
      requested: row.status === 'requested' && !row.active,
      requestNote: hideIds(row.requestNote || ''),
      prices: prices(),
      plans: planCards(),
      offers: offerCards(),
      features: FEATURES,
      benefits: tier === 1 ? FEATURES[1] : FEATURES[2],
      pay: { ...payoutPublic(), order: orderView(openOrder(guildId)) },
    };
  } catch {
    return emptyView();
  }
}

function newOrderId(existing) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let n = 0; n < 8; n += 1) {
    const bytes = crypto.randomBytes(6);
    let id = 'NL-';
    for (const byte of bytes) id += alphabet[byte % alphabet.length];
    if (!existing.has(id)) return id;
  }
  return `NL-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function checkout(guildId, offerId) {
  const plan = PLANS[offerId];
  if (!plan || !OFFERS.includes(plan.id)) {
    return { ok: false, error: 'plan', message: 'الخطة غير معروفة.', view: publicView(guildId) };
  }
  const current = get(guildId);
  if (current.active && !current.until) {
    return { ok: false, error: 'lifetime', message: 'الاشتراك دائم أصلًا.', view: publicView(guildId) };
  }
  const orders = loadOrders().filter((row) => {
    const fresh = Date.now() - Number(row.createdAt || 0) < ORDER_LIFE;
    return row.status === 'paid' || row.status === 'rejected' || fresh;
  });
  const known = new Set(orders.map((row) => row.id));
  const pending = orders.find((row) => (
    String(row.guildId) === String(guildId)
    && (row.status === 'awaiting_transfer' || row.status === 'proof_sent')
  ));
  const order = {
    id: pending?.id || newOrderId(known),
    guildId: String(guildId),
    offer: plan.id,
    amount: plan.amount,
    status: pending && pending.offer === plan.id && pending.proof ? 'proof_sent' : 'awaiting_transfer',
    proof: pending && pending.offer === plan.id ? (pending.proof || '') : '',
    createdAt: Date.now(),
  };
  const next = orders.filter((row) => row.id !== order.id);
  next.unshift(order);
  saveOrders(next);
  const pay = payout();
  const message = pay.account || pay.payUrl
    ? `طلب ${plan.label} بـ ${money(plan.amount)}. حوّل المبلغ واكتب رقم العملية.`
    : 'الطلب انحفظ. حساب التحويل لسا ما اننشر، والمالك يضيفه من الاشتراكات.';
  return { ok: true, message, view: publicView(guildId) };
}

function submitProof(guildId, orderId, proof) {
  const orders = loadOrders();
  const row = orders.find((item) => item.id === String(orderId || '') && String(item.guildId) === String(guildId));
  if (!row || (row.status !== 'awaiting_transfer' && row.status !== 'proof_sent')) {
    return { ok: false, error: 'order', message: 'ما في طلب تحويل مفتوح.', view: publicView(guildId) };
  }
  const ref = String(proof || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (ref.length < 3) {
    return { ok: false, error: 'proof', message: 'اكتب رقم العملية بعد التحويل.', view: publicView(guildId) };
  }
  row.proof = ref;
  row.status = 'proof_sent';
  row.proofAt = Date.now();
  saveOrders(orders);
  return { ok: true, message: 'وصل رقم العملية. الاشتراك يتفعل لما يتأكد المبلغ.', view: publicView(guildId) };
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
  return { ok: true, message: 'وصل الطلب. الدفع من قسم الاشتراك بالتحويل.', view: publicView(guildId) };
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
  const keepStronger = row.active && row.tier === 1 && plan.tier !== 1;
  row.plan = keepStronger && plan.days > 0 ? (row.plan || plan.id) : plan.id;
  row.tier = keepStronger ? 1 : (plan.tier || row.tier || 2);
  row.until = until;
  row.active = true;
  row.status = 'active';
  row.grantedAt = now;
  all[guildId] = row;
  saveSubs(all);
  syncFlag(guildId, true);
  const view = publicView(guildId);
  const message = until
    ? (keepStronger
      ? `انمدّت المدة إلى ${formatUntil(until)}، والدرجة الأولى بقيت.`
      : `تم تفعيل ${plan.label}. تنتهي ${formatUntil(until)}.`)
    : 'تم تفعيل الخطة الدائمة.';
  return { ok: true, message, view };
}

function confirmOrder(orderId) {
  const orders = loadOrders();
  const row = orders.find((item) => item.id === String(orderId || ''));
  if (!row) return { ok: false, error: 'order', message: 'طلب التحويل غير موجود.' };
  if (row.status === 'paid') return { ok: true, message: 'هذا التحويل متأكد من قبل.', view: publicView(row.guildId) };
  if (row.status !== 'awaiting_transfer' && row.status !== 'proof_sent') {
    return { ok: false, error: 'order', message: 'هذا الطلب مو بانتظار التأكيد.' };
  }
  const granted = grant(row.guildId, row.offer);
  if (!granted.ok) return granted;
  row.status = 'paid';
  row.paidAt = Date.now();
  saveOrders(orders);
  return { ok: true, message: granted.message, view: granted.view, guildId: row.guildId };
}

function rejectOrder(orderId) {
  const orders = loadOrders();
  const row = orders.find((item) => item.id === String(orderId || ''));
  if (!row) return { ok: false, error: 'order', message: 'طلب التحويل غير موجود.' };
  row.status = 'rejected';
  row.rejectedAt = Date.now();
  saveOrders(orders);
  return { ok: true, message: 'تم رفض التحويل. الاشتراك ما تفعّل.', view: publicView(row.guildId), guildId: row.guildId };
}

function pendingOrders() {
  const now = Date.now();
  return loadOrders()
    .filter((row) => (
      (row.status === 'awaiting_transfer' || row.status === 'proof_sent')
      && now - Number(row.createdAt || 0) < ORDER_LIFE
    ))
    .map((row) => {
      const plan = PLANS[row.offer] || null;
      const meta = guildMeta(row.guildId);
      return {
        id: row.id,
        name: meta.name,
        label: plan ? plan.label : '',
        tier: plan ? plan.tier : null,
        price: money(row.amount),
        status: row.status,
        statusLabel: row.status === 'proof_sent' ? 'إثبات وصل' : 'بانتظار التحويل',
        proof: String(row.proof || '').slice(0, 40),
        createdLabel: formatUntil(row.createdAt),
      };
    });
}

function revoke(guildId) {
  const all = loadSubs();
  const row = normalize(all[guildId]);
  row.active = false;
  row.until = null;
  row.plan = null;
  row.tier = null;
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
      tier: row.active ? row.tier : null,
      tierLabel: row.active ? tierLabel(row.tier) : '',
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
  FEATURES,
  BENEFITS: FEATURES[2],
  publicView,
  request,
  grant,
  revoke,
  prices,
  setPrices,
  payout,
  setPayout,
  checkout,
  submitProof,
  confirmOrder,
  rejectOrder,
  pendingOrders,
  offerCards,
  ownerList,
  activeIds,
  guildMeta,
  hideIds,
  boostXp,
  welcomeLine,
  ticketNote,
  effects,
};
