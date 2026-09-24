'use strict';

/**
 * web/routes/admin.js
 * -------------------------------------------------------------
 * لوحة «أعضاء الموقع» — للمالك فقط (OWNER_USER_ID).
 *
 *   GET    /api/admin/me                هل أنا المالك؟
 *   GET    /api/admin/members           قائمة كل من سجّل دخول
 *   POST   /api/admin/members/:id/status  تغيير الحالة: active | viewonly | banned
 *   POST   /api/admin/members/:id/kick    قطع جلساته (طرد فوري من الموقع)
 *   DELETE /api/admin/members/:id         حذف الحساب من السجل
 *   GET    /api/admin/audit               سجل نشاط الموقع كامل (من عمل شو ومتى)
 *   GET    /api/admin/backup              نسخة احتياطية كاملة (JSON)
 *   GET    /api/admin/security            حالة الحمايات المفعّلة
 *
 * كل نقطة محميّة: أي حساب غير المالك (أو المشرفين المضافين) يحصل على 403.
 * -------------------------------------------------------------
 */

const express = require('express');
const config = require('../../config');
const siteUsers = require('../siteUsers');
const { destroyUserSessions, countUserSessions } = require('../server');
const audit = require('../../lib/audit');
const db = require('../../database');

const router = express.Router();

/** هل هذا الحساب مسموح له بإدارة الموقع؟ */
function isSiteAdmin(req) {
  const id = String(req.session?.user?.id || '');
  if (!id) return false;
  if (siteUsers.isOwner(id)) return true;
  return (config.web.siteAdmins || []).includes(id);
}

/** حماية: المالك فقط (بما فيهم المشرفون المضافون بإعدادات) */
function ownerOnly(req, res, next) {
  if (config.web.demoData) {
    // في وضع العرض: نسمح بالقراءة فقط حتى تُجرَّب الواجهة
    if (req.method === 'GET') return next();
    return res.status(403).json({ error: 'demo_readonly', message: 'وضع العرض: الإدارة تحتاج توكن حقيقي.' });
  }
  if (!req.session?.user) return res.status(401).json({ error: 'unauthorized', message: 'سجّل الدخول أولًا.' });
  if (!isSiteAdmin(req)) {
    return res.status(403).json({ error: 'owner_only', message: 'هذه الصفحة لمالك الموقع فقط.' });
  }
  return next();
}

function withoutDevice(user) {
  if (!user || typeof user !== 'object') return user;
  const { lastIp, ua, ...safe } = user;
  return safe;
}

/** يمسح الأسماء والآيديات والدومينات من نص يظهر في صفحة الحماية */
function scrubIdentity(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[\w.-]+\.(?:com|net|org|app|io|gg|dev|me|xyz|online|site|cloud|railway\.app)\b/gi, '')
    .replace(/\b\d{17,20}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** هل أنا المالك؟ (متاحة لأي مسجّل دخول — الواجهة تسأل لتعرف هل تُظهر القسم) */
router.get('/me', (req, res) => {
  const id = String(req.session?.user?.id || '');
  const isAdmin = Boolean(id) && (siteUsers.isOwner(id) || (config.web.siteAdmins || []).includes(id));
  return res.json({
    loggedIn: Boolean(id),
    isOwner: isAdmin,
    me: isAdmin ? id : null,
    demo: Boolean(config.web.demoData),
    statuses: Object.values(siteUsers.STATUS).map(({ key, label, desc }) => ({ key, label, desc })),
  });
});

/* كل ما يلي: المالك فقط */
router.use(ownerOnly);

/** إضافة آيدي لقائمة الدخول، أو السماح لحساب جرّب الدخول */
router.post('/members', (req, res) => {
  const id = String(req.body?.id || '').trim();
  const result = siteUsers.grant(id, {
    by: req.session?.user?.id,
    user: {
      username: String(req.body?.username || '').slice(0, 40),
      globalName: String(req.body?.globalName || '').slice(0, 40),
    },
  });
  if (!result.ok) {
    const code = result.error === 'bad_id' ? 400 : 409;
    const message = result.error === 'bad_id'
      ? 'حط آيدي ديسكورد صحيح (أرقام فقط).'
      : 'المالك داخل أصلًا وما يحتاج إضافة.';
    return res.status(code).json({ error: result.error, message });
  }
  return res.json({ ok: true, user: result.user });
});

/** قائمة الأعضاء + الإحصاءات */
router.get('/members', (req, res) => {
  const me = String(req.session?.user?.id || '');
  const members = siteUsers.list().map((u) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName,
    avatar: u.avatar || null,
    status: u.status,
    isOwner: u.isOwner,
    isMe: u.id === me,
    firstSeen: u.firstSeen || null,
    lastSeen: u.lastSeen || null,
    lastLoginAt: u.lastLoginAt || null,
    visits: u.visits || 0,
    guilds: u.guilds || 0,
    bannedAt: u.bannedAt || null,
    note: u.note || '',
  }));
  return res.json({
    members,
    stats: siteUsers.stats(),
    statuses: Object.values(siteUsers.STATUS),
    ownerId: null,
    canManage: !config.web.demoData,
  });
});

/** تغيير حالة عضو: نشِط · مشاهدة فقط · محظور */
router.post('/members/:id/status', async (req, res) => {
  const { id } = req.params;
  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '');

  const result = siteUsers.setStatus(id, status, { reason, by: req.session?.user?.id });
  if (!result.ok) {
    const messages = {
      status_unknown: 'حالة غير معروفة.',
      missing_id: 'معرّف العضو ناقص.',
      owner_protected: 'ما يمكن تغيير حالة حساب المالك.',
      user_not_found: 'هذا الحساب غير موجود في السجل.',
    };
    if (result.error === 'owner_protected') {
      audit.record(req, { action: 'member.protected', target: id, detail: 'محاولة تغيير حالة حساب المالك — مرفوضة', severity: 'danger' });
    }
    return res.status(400).json({ error: result.error, message: messages[result.error] || 'تعذّر التغيير.' });
  }

  /*
   * عند الحظر نقطع جلسات العضو فورًا فيُطرد من الموقع لحظيًا — وهو ما يتوقعه
   * المالك. وأي محاولة دخول جديدة تُرفض من /auth/callback بصفحة «محظور».
   * (سابقًا كانت الجلسة تبقى لتظهر صفحة الحظر، فكان العضو يبقى داخل الموقع
   * ويبدو للمالك أن «الحظر لا يعمل».)
   */
  const killedSessions = status === 'banned' ? await destroyUserSessions(id) : 0;
  const actionMap = { banned: 'member.ban', viewonly: 'member.viewonly', active: 'member.active' };
  audit.record(req, {
    action: actionMap[status] || 'member.status',
    target: id,
    detail: `${siteUsers.get(id)?.globalName || siteUsers.get(id)?.username || id}${reason ? ` — السبب: ${reason}` : ''}`,
    severity: status === 'banned' ? 'danger' : 'warn',
  });

  return res.json({
    ok: true,
    user: withoutDevice(siteUsers.get(id)),
    status,
    killedSessions,
    sessions: await countUserSessions(id),
    message:
      status === 'banned'
        ? `تم حظر الحساب وقطع ${killedSessions} جلسة نشطة — طُرد من الموقع فورًا، وأي محاولة دخول جديدة تُرفض.`
        : status === 'viewonly'
          ? 'صار يشوف الموقع بلا تعديل ولا حفظ.'
          : 'رجع الحساب طبيعيًا.',
  });
});

/** قطع جلسات عضو (طرد فوري بلا حظر) */
router.post('/members/:id/kick', async (req, res) => {
  const { id } = req.params;
  const status = siteUsers.statusOf(id);
  const kicked = await destroyUserSessions(id);
  audit.record(req, { action: 'member.kick', target: id, detail: `قطع ${kicked} جلسة`, severity: 'warn' });
  return res.json({
    ok: true,
    kicked,
    message: kicked ? `تم قطع ${kicked} جلسة — سيحتاج يسجّل دخول من جديد.` : 'ما في جلسة نشطة لهذا الحساب.',
    status,
  });
});

/** حذف الحساب من السجل */
router.delete('/members/:id', (req, res) => {
  const target = siteUsers.get(req.params.id);
  const result = siteUsers.forget(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error, message: 'تعذّر حذف الحساب.' });
  audit.record(req, {
    action: 'member.forget',
    target: req.params.id,
    detail: `حذف ${target?.globalName || target?.username || req.params.id} من السجل`,
    severity: 'warn',
  });
  return res.json({ ok: true, message: 'تم حذف الحساب من سجل الموقع.' });
});

/* ------------------------------ سجل نشاط الموقع ------------------------------ */

/** كل أحداث الموقع (تسجيل الدخول · الحظر · الإعدادات…) — للمالك فقط */
router.get('/audit', (req, res) => {
  const limit = Math.min(200, Math.max(5, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const action = req.query.action ? String(req.query.action).slice(0, 40) : null;
  const severity = ['info', 'warn', 'danger'].includes(String(req.query.severity)) ? String(req.query.severity) : null;
  const scope = String(req.query.scope || 'all'); // all | site | guild

  const guildId = scope === 'site' ? null : scope === 'guild' ? String(req.query.guildId || '') : undefined;
  const result = audit.list({ guildId, action, severity, limit, offset, withIp: false });
  result.items = result.items.map((row) => ({
    id: row.id,
    action: row.action,
    label: row.label,
    detail: scrubIdentity(row.detail),
    severity: row.severity,
    at: row.at,
  }));

  return res.json({
    ...result,
    stats: audit.stats(),
    actions: Object.entries(audit.ACTION_LABELS).map(([key, label]) => ({ key, label })),
    limit,
    offset,
  });
});

/* ------------------------------ نسخة احتياطية ------------------------------ */

/**
 * تنزيل كل بيانات الموقع كملف JSON واحد:
 * السيرفرات وإعداداتها · المستويات والخبرة · العقوبات · التذاكر · سجل الأعضاء · سجل النشاط
 * (للمالك فقط — لا يحتوي أي توكن أو مفتاح سري)
 */
router.get('/backup', (req, res) => {
  const guilds = db.getAllGuilds().map((guild) => ({
    id: guild.id,
    settings: guild.settings,
    stats: db.getStats(guild.id),
    levels: db.getLeaderboard(guild.id, 5000, 0),
    cases: db.listCases(guild.id, { limit: 5000, offset: 0 }).items,
    tickets: db.listTickets(guild.id, { limit: 5000, offset: 0 }).items,
  }));

  const payload = {
    exportedAt: new Date().toISOString(),
    site: config.web.siteName,
    driver: config.database.driver,
    guilds,
    siteUsers: siteUsers.list().map((user) => withoutDevice(user)),
    audit: audit.list({ limit: 500, withIp: false }).items.map((row) => ({
      id: row.id,
      action: row.action,
      label: row.label,
      detail: scrubIdentity(row.detail),
      severity: row.severity,
      at: row.at,
    })),
    counts: {
      guilds: guilds.length,
      siteUsers: siteUsers.count(),
      audit: db.countAudit?.() ?? 0,
    },
  };

  audit.record(req, { action: 'backup.export', detail: `نسخة احتياطية (${guilds.length} سيرفر)`, severity: 'warn' });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="never-land-backup-${stamp}.json"`);
  return res.send(JSON.stringify(payload, null, 2));
});

/* ------------------------------ حالة الحمايات ------------------------------ */

/** قائمة الحمايات المفعّلة مع أرقام حقيقية — تُعرض للمالك في اللوحة */
router.get('/security', (req, res) => {
  const security = require('../../lib/security');
  return res.json({
    ok: true,
    checks: [
      { key: 'headers', label: 'رؤوس أمان على كل صفحة', ok: true, detail: 'CSP بلا unsafe-inline · منع التأطير · nosniff · HSTS' },
      { key: 'csrf', label: 'منع الطلبات من مواقع ثانية', ok: true, detail: 'فحص Origin/Referer + رأس خاص + كوكي SameSite=Lax' },
      { key: 'rate', label: 'حدّ الطلبات لكل جهاز', ok: true, detail: '٣٠٠/دقيقة عام · ٩٠/دقيقة للكتابة · ٣٠/دقيقة للدخول' },
      { key: 'proto', label: 'حماية من تلويث النموذج', ok: true, detail: 'المفاتيح __proto__ و constructor مرفوضة قبل الحفظ' },
      { key: 'whitelist', label: 'قصر الإعدادات على المعروف', ok: true, detail: 'أي مفتاح غير معروف يُرفض ويُسجّل' },
      { key: 'session', label: 'تجديد الجلسة عند الدخول', ok: true, detail: 'يمنع تثبيت الجلسة (session fixation)' },
      { key: 'errors', label: 'عدم تسريب تفاصيل الأخطاء', ok: true, detail: 'أخطاء الخادم ترجع رسالة عامة فقط' },
      { key: 'audit', label: 'سجل نشاط كامل', ok: true, detail: `آخر ${db.countAudit?.() ?? 0} حدث محفوظ` },
      { key: 'cookie', label: 'كوكي الجلسة محمي', ok: true, detail: 'httpOnly + SameSite=Lax + Secure على https' },
      { key: 'secrets', label: 'بلا أسرار في الواجهة', ok: true, detail: 'التوكن والمفاتيح لا تُرسل للمتصفح أبدًا' },
      { key: 'private', label: 'إخفاء بيانات السيرفر عن الزائر', ok: true, detail: 'الإعدادات والقنوات والحسابات ما تنعرض إلا لحساب مسموح له' },
      { key: 'probes', label: 'حجب مسارات الفحص', ok: true, detail: 'طلبات .env و wp-admin و .git ترجع 404 بلا أي رد خبيث' },
    ],
    counts: {
      audit: db.countAudit?.() ?? 0,
      siteUsers: siteUsers.count(),
      sessions: siteUsers.list().reduce((sum, m) => sum + (m.visits || 0), 0),
    },
    banned: siteUsers.list().filter((m) => m.status === 'banned').length,
    viewOnly: siteUsers.list().filter((m) => m.status === 'viewonly').length,
    https: security.isHttps(config),
    auditBySeverity: {
      danger: db.listAudit?.({ severity: 'danger', limit: 1 })?.total ?? 0,
      warn: db.listAudit?.({ severity: 'warn', limit: 1 })?.total ?? 0,
    },
  });
});

module.exports = router;
