'use strict';

/**
 * lib/dmPolicy.js
 * -------------------------------------------------------------
 * سياسة الرسائل الخاصة: البوت **ما يراسل الخاص** إلا في الحالات المهمة فقط:
 *
 *   ١) تحذير عضو            (warn)
 *   ٢) قبول تقديم الإدارة    (applicationAccepted)
 *   ٣) رفض تقديم الإدارة     (applicationRejected)
 *
 * وأي شي ثاني (لفل · فتح تذكرة · إغلاق تذكرة · حظر/طرد/إسكات · ترحيب)
 * **ما يُرسل للخاص أبدًا** — مكانه الروم أو اللوق.
 *
 * الاستثناء الوحيد: إجراء صريح يطلبه إداري بنفسه (زر/أمر) مثل «تذكير عضو بتذكرته» —
 * هذا مو إشعار تلقائي، فيُنفَّذ بطلب مباشر عبر الدالة actionAllowed.
 * -------------------------------------------------------------
 */

/** الإشعارات التلقائية المسموح بها للخاص (٣ فقط) */
const ALLOWED = ['warn', 'applicationAccepted', 'applicationRejected'];

/** تسميات عربية للوحة التحكم */
const LABELS = {
  warn: 'تحذير عضو',
  applicationAccepted: 'قبول تقديم الإدارة',
  applicationRejected: 'رفض تقديم الإدارة',
};

/**
 * هل يُسمح بإرسال هذا النوع للخاص؟
 * @param {string} kind نوع الإشعار
 * @param {object} [settings] إعدادات السيرفر (دعم dm.extraKinds لمن يريد توسيعها يدويًا)
 */
function allowed(kind, settings) {
  if (!kind) return false;
  if (ALLOWED.includes(kind)) return true;
  const extra = settings?.dm?.extraKinds;
  return Array.isArray(extra) && extra.includes(kind);
}

/**
 * إجراء يطلبه إداري صريح (مو إشعار تلقائي) — مثل التذكير بتذكرة.
 * مفعّل افتراضيًا وقابل للتعطيل من الإعدادات dm.manual = false.
 */
function actionAllowed(kind, settings) {
  if (allowed(kind, settings)) return true;
  const manual = settings?.dm?.manual !== false;
  return manual && ['ticketRemind', 'manualRemind'].includes(kind);
}

/** إرسال رسالة خاصة نصية فقط (بلا إمبد) مع فحص السياسة */
async function send(user, content, { kind, settings } = {}) {
  if (!user?.send) return false;
  if (kind && !allowed(kind, settings) && !actionAllowed(kind, settings)) return false;
  const text = typeof content === 'string' ? content : String(content?.content || '');
  if (!text.trim()) return false;
  return user.send({ content: text.slice(0, 1900) }).then(() => true).catch(() => false);
}

module.exports = { ALLOWED, LABELS, allowed, actionAllowed, send };
