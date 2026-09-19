'use strict';

/**
 * lib/periods.js
 * -------------------------------------------------------------
 * محرّك الفترات لنظام الخبرة: يومي (توب داي) وأسبوعي (توب ويك).
 *
 *  • dayKey   → 2026-09-18
 *  • weekKey  → 2026-W38   (الأسبوع يبدأ الإثنين — معيار ISO)
 *  • كل الحسابات على أساس منطقة زمنية قابلة للضبط بإزاحة عن UTC
 *    (leveling.resetOffsetHours) حتى يتجدّد التوب في الوقت اللي يناسبك.
 * -------------------------------------------------------------
 */

/** إزاحة المنطقة الزمنية بالساعات (من الإعدادات) */
function offsetHours(cfg) {
  const raw = Number(cfg?.resetOffsetHours ?? cfg?.timezoneOffsetHours ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(-12, Math.min(14, Math.round(raw)));
}

/** تاريخ مُزاح حسب المنطقة المطلوبة */
function shifted(date = new Date(), cfg) {
  const ms = date instanceof Date ? date.getTime() : Number(date) || Date.now();
  return new Date(ms + offsetHours(cfg) * 3600 * 1000);
}

/** مفتاح اليوم: YYYY-MM-DD */
function dayKey(date = new Date(), cfg) {
  return shifted(date, cfg).toISOString().slice(0, 10);
}

/** مفتاح الأسبوع: YYYY-Www (بداية الأسبوع الإثنين) */
function weekKey(date = new Date(), cfg) {
  const d = shifted(date, cfg);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO: الخميس هو مرجع تحديد رقم الأسبوع/السنة
  const dayNum = target.getUTCDay() || 7; // الأحد = 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** مفتاح الشهر: YYYY-MM */
function monthKey(date = new Date(), cfg) {
  return shifted(date, cfg).toISOString().slice(0, 7);
}

/** مفتاح الفترة المطلوبة */
function periodKey(period, date = new Date(), cfg) {
  if (period === 'week') return weekKey(date, cfg);
  if (period === 'month') return monthKey(date, cfg);
  if (period === 'day') return dayKey(date, cfg);
  return null; // 'all' = كل الأوقات (بلا مفتاح)
}

/** بداية ونهاية فترة معيّنة (لحساب وقت التجديد) */
function periodRange(period, date = new Date(), cfg) {
  const nowMs = date instanceof Date ? date.getTime() : Number(date) || Date.now();
  const local = shifted(new Date(nowMs), cfg); // الوقت المحلي المطلوب
  const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const back = offsetHours(cfg) * 3600 * 1000;

  if (period === 'week') {
    const dayNum = local.getUTCDay() || 7; // الأحد = 7 → الإثنين بداية الأسبوع
    const startLocal = base - (dayNum - 1) * 86400000;
    return { start: startLocal - back, end: startLocal + 7 * 86400000 - back };
  }
  if (period === 'month') {
    const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
    const endLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
    return { start: startLocal - back, end: endLocal - back };
  }
  if (period === 'day') {
    return { start: base - back, end: base + 86400000 - back };
  }
  return { start: 0, end: null }; // كل الأوقات
}

/** كم بقي حتى تجديد الفترة (بالمللي ثانية) */
function msUntilReset(period, date = new Date(), cfg) {
  if (period !== 'day' && period !== 'week' && period !== 'month') return null;
  const { end } = periodRange(period, date, cfg);
  const nowMs = date instanceof Date ? date.getTime() : Number(date) || Date.now();
  return Math.max(0, end - nowMs);
}

/** نص عربي مختصر لوقت التجديد */
function resetLabel(period, date = new Date(), cfg) {
  const ms = msUntilReset(period, date, cfg);
  if (ms === null) return 'بلا تجديد';
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} يوم`);
  if (hours) parts.push(`${hours} ساعة`);
  if (!days && minutes) parts.push(`${minutes} دقيقة`);
  return parts.length ? `يتجدّد بعد ${parts.join(' و')}` : 'يتجدّد الآن';
}

/** الفترات المتاحة (تُستخدم في البوت واللوحة) */
const PERIODS = {
  day: { key: 'day', label: 'اليوم', short: 'توب داي', desc: 'المتصدّرون منذ بداية اليوم', icon: 'clock' },
  month: { key: 'month', label: 'هذا الشهر', short: 'توب منث', desc: 'المتصدّرون منذ بداية الشهر', icon: 'calendar' },
  week: { key: 'week', label: 'هذا الأسبوع', short: 'توب ويك', desc: 'المتصدّرون من الإثنين حتى الآن', icon: 'activity' },
  all: { key: 'all', label: 'كل الأوقات', short: 'كل الأوقات', desc: 'الترتيب العام للمستويات', icon: 'crown' },
};

const PERIOD_KEYS = Object.keys(PERIODS);

/** مصادر الخبرة (تُستخدم في البوت واللوحة) */
const SOURCES = {
  all: { key: 'all', label: 'الكل', column: 'xp', desc: 'كل مصادر الخبرة' },
  text: { key: 'text', label: 'كتابي', column: 'text_xp', desc: 'خبرة الرسائل في الشات' },
  voice: { key: 'voice', label: 'صوتي', column: 'voice_xp', desc: 'خبرة البقاء في الرومات الصوتية' },
  interact: { key: 'interact', label: 'تفاعل', column: 'interact_xp', desc: 'خبرة التفاعلات على رسائلك' },
};

const SOURCE_KEYS = Object.keys(SOURCES);

/** التحقق من قيمة فترة/مصدر قادمة من المستخدم أو الرابط */
const isPeriod = (p) => PERIOD_KEYS.includes(String(p));
const isSource = (s) => SOURCE_KEYS.includes(String(s));

module.exports = {
  offsetHours,
  dayKey,
  weekKey,
  monthKey,
  periodKey,
  periodRange,
  msUntilReset,
  resetLabel,
  PERIODS,
  PERIOD_KEYS,
  SOURCES,
  SOURCE_KEYS,
  isPeriod,
  isSource,
};
