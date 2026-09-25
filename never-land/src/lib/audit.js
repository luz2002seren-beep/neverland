'use strict';

/**
 * lib/audit.js
 * -------------------------------------------------------------
 * سجل النشاط (التدقيق): كل حدث مهم يُحفظ في قاعدة البيانات.
 *
 * يُسجّل: الدخول والخروج · محاولات الدخول المرفوضة · تغيير الإعدادات
 *         (مع تفصيل شو انغيّر) · أوامر المالك (حظر · مشاهدة فقط · قطع جلسة)
 *         · الطلبات المرفوضة والمشبوهة.
 *
 * الـIP لا يُخزَّن خامًا — نخزّن بصمة مجزّأة (نفس الجهاز = نفس البصمة).
 * -------------------------------------------------------------
 */

const db = require('../database');
const { hashIp, clientIp } = require('./security');

const MASK = '•••';

/** تجهيز نص وصفي مختصر للتغيير (بدون أي بيانات حسّاسة) */
function describeChange(patch, { maxKeys = 6 } = {}) {
  if (!patch || typeof patch !== 'object') return '';
  const parts = [];
  for (const [key, value] of Object.entries(patch)) {
    if (parts.length >= maxKeys) {
      parts.push('…');
      break;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = Object.keys(value).slice(0, 4).join('، ');
      parts.push(`${key}: {${nested}${Object.keys(value).length > 4 ? '…' : ''}}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}: [${value.length} عنصر]`);
    } else {
      parts.push(`${key}: ${String(value).slice(0, 40)}`);
    }
  }
  return parts.join(' · ');
}

/**
 * تسجيل حدث في السجل.
 * @param {object|null} req طلب Express (لتعبئة الفاعل والجهاز) — يقبل null
 * @param {{action:string, guildId?:string|null, target?:string|null, detail?:string|null,
 *          severity?:'info'|'warn'|'danger', actor?:{id:string,name?:string}|null}} entry
 */
function record(req, entry = {}) {
  try {
    const actor = entry.actor || (req?.session?.user ? { id: req.session.user.id, name: req.session.user.globalName || req.session.user.username } : null);
    /* بعض الأحداث تجي من ديسكورد (رسالة) لا من طلب ويب — req يكون null أو بلا headers */
    const ip = req && req.headers ? clientIp(req) : '';
    const saved = db.addAudit({
      guildId: entry.guildId ?? null,
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      action: entry.action,
      target: entry.target || null,
      detail: entry.detail || null,
      ipHash: ip ? hashIp(ip) : null,
      severity: entry.severity || 'info',
      at: Date.now(),
    });
    return saved;
  } catch (err) {
    console.error('[تنبيه] تعذّر كتابة سجل النشاط:', err.message);
    return null;
  }
}

/** تسجيل حدث على مستوى الموقع (بلا سيرفر) */
function site(entry) {
  return record(null, { ...entry, guildId: null });
}

/** تسجيل حدث داخل سيرفر */
function guild(req, guildId, entry) {
  return record(req, { ...entry, guildId });
}

/**
 * قائمة السجل مع أسماء مقروءة للأحداث (للعرض في الواجهة).
 * @param {{guildId?:string|null, action?:string, severity?:string, limit?:number, offset?:number}} query
 */
function list(query = {}) {
  const { withIp = false, ...rest } = query;
  const result = db.listAudit(rest);
  return {
    total: result.total,
    items: result.items.map((row) => ({
      id: row.id,
      guildId: row.guild_id ?? row.guildId ?? null,
      actorId: row.actor_id ?? row.actorId ?? null,
      actorName: row.actor_name ?? row.actorName ?? null,
      action: row.action,
      label: ACTION_LABELS[row.action] || row.action,
      target: row.target,
      detail: row.detail,
      /* بصمة الجهاز (مجزّأة دائمًا) — للمالك فقط، ما تُعرض لمشرفي السيرفرات */
      ...(withIp ? { ipHash: row.ip_hash ?? row.ipHash ?? null } : {}),
      severity: row.severity,
      at: row.created_at ?? row.at ?? null,
    })),
  };
}

/** أسماء عربية مقروءة للأحداث */
const ACTION_LABELS = {
  'login': 'تسجيل دخول',
  'login.denied': 'محاولة دخول مرفوضة',
  'logout': 'خروج',
  'settings.save': 'حفظ إعدادات السيرفر',
  'settings.rejected': 'إعدادات مرفوضة',
  'member.ban': 'حظر عضو من الموقع',
  'member.viewonly': 'تقييد عضو (مشاهدة فقط)',
  'member.active': 'إرجاع عضو لحالته الطبيعية',
  'member.kick': 'قطع جلسة عضو',
  'member.forget': 'حذف عضو من السجل',
  'member.protected': 'محاولة على حساب المالك (مرفوضة)',
  'action.welcomeTest': 'إرسال رسالة ترحيب تجريبية',
  'action.ticketPanel': 'إرسال لوحة التذاكر',
  'action.autolineTest': 'تجربة الخط الفاصل',
  'sync.now': 'مزامنة السيرفرات',
  'security.blocked': 'طلب محجوب للحماية',
  'security.rateLimited': 'تجاوز حد الطلبات',
  'security.csrf': 'طلب من مصدر غير موثوق',
  'backup.export': 'تصدير نسخة احتياطية',
  'site.banned': 'محاولة دخول حساب محظور',
  'command.text': 'أمر بلا بريفيكست',
  'command.denied': 'محاولة استعمال أمر إدارة (مرفوضة)',
  'command.suggest': 'اقتراح أوامر مشابهة',
  'settings.live': 'تحديث فوري (موقع/بوت)',
  'premium.request': 'طلب اشتراك',
  'premium.grant': 'تفعيل بريميوم',
  'premium.revoke': 'إلغاء بريميوم',
  'premium.prices': 'أسعار الخطط',
  'premium.checkout': 'طلب تحويل',
  'premium.proof': 'إثبات تحويل',
  'premium.confirm': 'تأكيد تحويل',
  'premium.reject': 'رفض تحويل',
  'premium.payout': 'حساب التحويل',
};

/** إحصاءات سريعة للسجل (للوحة الحماية) */
function stats({ guildId = undefined } = {}) {
  const total = db.countAudit({ guildId });
  const danger = db.listAudit({ guildId, severity: 'danger', limit: 1 }).total;
  const warn = db.listAudit({ guildId, severity: 'warn', limit: 1 }).total;
  const today = db.listAudit({ guildId, limit: 500 }).items.filter((r) => {
    const at = r.created_at ?? r.at ?? 0;
    return Date.now() - at < 24 * 60 * 60 * 1000;
  }).length;
  return { total, danger, warn, today };
}

module.exports = { record, site, guild, list, stats, describeChange, ACTION_LABELS, MASK };
