'use strict';

/**
 * lib/utils.js
 * -------------------------------------------------------------
 * أدوات مساعدة عامة: تحويل المدد الزمنية، التنسيق، الأدوات النصية.
 * -------------------------------------------------------------
 */

const DURATION_UNITS = {
  s: 1000,
  sec: 1000,
  ثانية: 1000,
  ثواني: 1000,
  m: 60 * 1000,
  min: 60 * 1000,
  دقيقة: 60 * 1000,
  دقائق: 60 * 1000,
  h: 60 * 60 * 1000,
  hr: 60 * 60 * 1000,
  ساعة: 60 * 60 * 1000,
  ساعات: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  يوم: 24 * 60 * 60 * 1000,
  أيام: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  أسبوع: 7 * 24 * 60 * 60 * 1000,
  mo: 30 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  شهر: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
  سنة: 365 * 24 * 60 * 60 * 1000,
};

/**
 * تحويل نص مثل "10m" أو "2h30m" أو "3 أيام" إلى مللي ثانية.
 * @param {string} input
 * @returns {number|null} عدد المللي ثانية أو null إذا فشل التحويل
 */
function parseDuration(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return input;
  const str = String(input).trim().toLowerCase();
  if (!str) return null;

  // أرقام فقط = دقائق (سلوك مريح للمستخدم)
  if (/^\d+$/.test(str)) return Number(str) * 60 * 1000;

  let total = 0;
  let matched = false;
  const regex = /(\d+(?:\.\d+)?)\s*([a-zء-ي]+)/g;
  let m;
  while ((m = regex.exec(str)) !== null) {
    const value = Number.parseFloat(m[1]);
    const unit = m[2];
    const factor = DURATION_UNITS[unit] ?? DURATION_UNITS[unit[0]];
    if (!factor) continue;
    total += value * factor;
    matched = true;
  }
  return matched && total > 0 ? Math.floor(total) : null;
}

/**
 * تنسيق مدة بالمللي ثانية إلى نص عربي/إنجليزي مقروء.
 */
function formatDuration(ms, lang = 'ar') {
  if (!ms || ms <= 0) return lang === 'ar' ? '0 ثانية' : '0s';
  const units = lang === 'ar'
    ? [['يوم', 86400000], ['ساعة', 3600000], ['دقيقة', 60000], ['ثانية', 1000]]
    : [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];

  const parts = [];
  let rest = ms;
  for (const [label, size] of units) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      parts.push(lang === 'ar' ? `${value} ${label}` : `${value}${label}`);
      rest -= value * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(lang === 'ar' ? ' و' : ' ');
}

/** تنسيق وقت نسبي مبسّط (منذ ...) */
function timeAgo(timestamp, lang = 'ar') {
  const diff = Date.now() - new Date(timestamp).getTime();
  if (diff < 60000) return lang === 'ar' ? 'قبل لحظات' : 'just now';
  return lang === 'ar'
    ? `قبل ${formatDuration(diff, 'ar')}`
    : `${formatDuration(diff, 'en')} ago`;
}

/** تقطيع المصفوفة إلى مجموعات */
function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** تقصير نص طويل مع إضافة ... */
function truncate(text, max = 1024) {
  const str = String(text ?? '');
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

/** أرقام بشكل مقروء: 1200 -> 1.2K */
function humanize(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(num);
}

/** شريط تقدّم نصي: ▰▰▰▱▱▱▱▱▱▱ */
function progressBar(current, max, size = 10) {
  const ratio = max <= 0 ? 0 : Math.min(Math.max(current / max, 0), 1);
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(size - filled, 0));
}

/** التحقق من إمكانية تحويل نص إلى snowflake صحيح */
function isSnowflake(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

/** أخذ عنصر عشوائي من مصفوفة */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** دالة انتظار */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** استبدال المتغيرات في رسائل الترحيب */
function applyPlaceholders(text, { user, member, guild, level, extra } = {}) {
  const memberCount = guild?.memberCount ?? 0;
  const map = {
    user: user ? `<@${user.id}>` : '',
    username: user?.username ?? '',
    tag: user?.tag ?? user?.username ?? '',
    server: guild?.name ?? '',
    memberCount: String(memberCount),
    memberCountOrdinal: `${memberCount}`,
    level: String(level ?? ''),
    boostLevel: String(guild?.premiumTier ?? 0),
    createdAt: user?.createdAt ? formatDate(user.createdAt) : '',
    joinedAt: member?.joinedAt ? formatDate(member.joinedAt) : '',
  };
  map.server_icon = guild?.iconURL?.({ size: 256 }) ?? '';
  map.icon = map.server_icon;
  map.avatar = user?.displayAvatarURL?.({ size: 256 }) ?? '';
  map.avatarUrl = user?.displayAvatarURL?.({ size: 512, extension: 'png' }) ?? '';
  map.displayName = member?.displayName ?? user?.username ?? '';
  map.id = user?.id ?? '';
  map.mention = user ? `<@${user.id}>` : '';
  /* متغيّرات إضافية (مثل الداعي {inviter}) */
  if (extra && typeof extra === 'object') for (const [k, v] of Object.entries(extra)) map[k] = String(v ?? '');
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, key) => (map[key] !== undefined ? map[key] : m));
}

/** تاريخ مقروء */
function formatDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** خريطة زمنية بسيطة لحساب الـ XP في دقائق لوحة التحكم */
const toMinutes = (ms) => Math.floor((Number(ms) || 0) / 60000);

module.exports = {
  parseDuration,
  formatDuration,
  timeAgo,
  chunk,
  truncate,
  humanize,
  progressBar,
  isSnowflake,
  pickRandom,
  sleep,
  applyPlaceholders,
  formatDate,
  toMinutes,
  DURATION_UNITS,
};
