'use strict';

/**
 * web/server.js
 * -------------------------------------------------------------
 * خادم لوحة التحكم: Express + جلسات + OAuth2 (ديسكورد) + واجهة برمجية.
 *
 * ملاحظة مهمة للمعاينة:
 *   عند تفعيل DEMO_MODE=true تعمل اللوحة ببيانات تجريبية بدون توكن
 *   وبدون تسجيل دخول — مفيد لتجربة الواجهة قبل ربط البوت.
 * -------------------------------------------------------------
 */

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');

const config = require('../config');
const db = require('../database');
const security = require('../lib/security');
const audit = require('../lib/audit');

let server = null;
/** مرجع مخزن الجلسات (يُستخدم لقطع جلسات عضو عند الحظر/الطرد) */
let sessionStore = null;

/**
 * قطع كل جلسات عضو معيّن (يُنادى عند الحظر أو «قطع الجلسات»).
 * @returns {Promise<number>} عدد الجلسات المقطوعة
 */
async function destroyUserSessions(userId) {
  if (!sessionStore || !userId) return 0;
  const wanted = String(userId);
  const sids = await new Promise((resolve) => sessionStore.all((err, list) => resolve(err ? [] : list || [])));
  let killed = 0;
  for (const sid of sids) {
    const sess = await new Promise((resolve) => sessionStore.get(sid, (err, value) => resolve(err ? null : value)));
    if (sess?.user?.id === wanted) {
      await new Promise((resolve) => sessionStore.destroy(sid, () => resolve()));
      killed += 1;
    }
  }
  return killed;
}

/**
 * عدد الجلسات النشطة لعضو معيّن (للعرض في لوحة المالك).
 * @returns {Promise<number>}
 */
async function countUserSessions(userId) {
  if (!sessionStore || !userId) return 0;
  const wanted = String(userId);
  const sids = await new Promise((resolve) => sessionStore.all((err, list) => resolve(err ? [] : list || [])));
  let found = 0;
  for (const sid of sids) {
    const sess = await new Promise((resolve) => sessionStore.get(sid, (err, value) => resolve(err ? null : value)));
    if (sess?.user?.id === wanted) found += 1;
  }
  return found;
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  /* مسارات الفحص الشائعة: نرد 404 بلا أي محتوى، وما نرجّع فيروس ولا نرد على المهاجم */
  app.use((req, res, next) => {
    const pathName = String(req.path || '').toLowerCase();
    if (/^\/(\.env|\.git|wp-admin|wp-login|phpmyadmin|server-status|cgi-bin|vendor\/phpunit)/.test(pathName)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    return next();
  });

  /* ------------------------------ دفاعات الموقع ------------------------------ */
  // ١) رؤوس أمان على كل رد (CSP · منع التأطير · HSTS · nosniff…)
  app.use(security.securityHeaders(config));

  // ٢) رفض الطلبات الغريبة الحجم قبل ما توصل للمعالجة
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // ٣) منع الطلبات من مواقع ثانية (CSRF) — طبقة ثانية مع SameSite=Lax
  app.use(security.csrfGuard());

  // ٤) حد عام لكل IP: ٣٠٠ طلب في الدقيقة للتصفّح العادي
  app.use(
    security.rateLimit({
      windowMs: 60_000,
      max: 300,
      skip: (req) => req.path === '/healthz' || req.path.startsWith('/assets'),
    }),
  );

  // ٥) حد أقسى على كتابة الواجهة البرمجية: ٩٠ طلبًا في الدقيقة
  app.use(
    '/api',
    security.rateLimit({
      windowMs: 60_000,
      max: 90,
      keyFn: (req) => `api:${security.clientIp(req)}`,
      skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    }),
  );

  // ٦) حدّ خاص لمسارات الدخول (منع التخمين والقصف)
  app.use(
    '/auth',
    security.rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `auth:${security.clientIp(req)}` }),
  );

  // جلسات محفوظة على القرص (تبقى بعد إعادة التشغيل) — داخل نفس مجلد قاعدة البيانات/الـVolume
  const { FileSessionStore } = require('./sessionStore');
  const sessionFile = path.join(path.dirname(config.database.path), 'sessions.json');
  const store = new FileSessionStore(sessionFile, 7 * 24 * 60 * 60 * 1000);
  sessionStore = store;
  setInterval(() => store.cleanup(), 3600 * 1000).unref?.();

  app.use(
    session({
      name: 'neverland.sid',
      secret: config.web.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // كوكي آمن تلقائيًا عندما يكون الرابط العام https (Railway/نطاقك)
        secure: /^https:/i.test(config.web.url),
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // ترويسات التخزين المؤقّت:
  //   • أصول الواجهة (CSS/JS) تُحمَّل مع بصمة نسخة في الرابط ⇒ تخزين طويل آمن
  //   • صفحات HTML بلا تخزين أبدًا حتى يرى الزائر الروابط الجديدة فورًا
  const VERSIONED_ASSETS = new Set(['style.css', 'dash.css', 'app.js', 'app-sections.js', 'icons.js']);
  app.use((req, res, next) => {
    const base = path.basename(req.path || '');
    if (VERSIONED_ASSETS.has(base)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (req.method === 'GET' && !path.extname(req.path || '') && !req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  });

  // الملفات الثابتة (CSS/JS)
  app.use(express.static(path.join(__dirname, 'public')));

  // خطوط الفاصل المتحركة (GIF) — تُخدم للّوحة والمعاينة
  app.use(
    '/autoline',
    express.static(path.join(__dirname, '..', '..', 'assets', 'autoline'), {
      maxAge: '7d',
      immutable: true,
      fallthrough: true,
    }),
  );

  // فحص صحة عام (للنشر: Railway/Render/Docker) — بلا تسجيل دخول وبلا بيانات حساسة
  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      ok: true,
      site: config.web.siteName,
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });

  /* سجل النشاط: تقليم دوري حتى لا يكبر بلا حد (آخر ٥٠٠٠ حدث) */
  try {
    const removed = db.pruneAudit?.(5000) || 0;
    if (removed) console.log(`[حماية] تقليم سجل النشاط: ${removed} حدث قديم.`);
    const timer = setInterval(() => {
      try {
        db.pruneAudit?.(5000);
      } catch {
        /* تجاهل */
      }
    }, 6 * 60 * 60 * 1000);
    timer.unref?.();
  } catch (err) {
    console.error('[تنبيه] تعذّر تجهيز سجل النشاط:', err.message);
  }

  // بيانات تجريبية عند تفعيل وضع المعاينة
  if (config.web.demoData) {
    require('./demo').seed();
    console.log('[تهيئة] ما في توكن Discord بعد: الصفحات تعرض بيانات العرض حتى تربط حسابك.');
  } else if (config.web.demoMode && config.bot.hasToken) {
    console.log('[تهيئة] تم اكتشاف توكن Discord: بيانات العرض متوقّفة، والموقع يستخدم بياناتك الحقيقية.');
    require('./demo').cleanup?.();
  }

  // سجل أعضاء الموقع: نحدّث آخر ظهور لكل من هو مسجّل دخول (بلا أي تأثير على السرعة)
  app.use((req, res, next) => {
    try {
      const sessionUser = req.session?.user;
      if (sessionUser?.id && !req.path.startsWith('/api/admin')) {
        require('./siteUsers').touch(sessionUser.id, { ip: req.ip, user: sessionUser });
      }
    } catch {
      /* تجاهل */
    }
    next();
  });

  // المسارات
  app.use('/auth', require('./routes/auth'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', require('./routes/api'));
  app.use('/', require('./routes/pages'));

  // 404
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
    const { layout, escapeHtml } = require('./routes/pages');
    const body = `
    <section class="site-hero" style="text-align:center">
      <span class="pill">خطأ 404</span>
      <h1>الصفحة غير موجودة</h1>
      <p class="muted">الرابط الذي فتحته غير صحيح أو تم نقله.</p>
      <div class="site-cta">
        <a class="btn btn-primary" href="/">العودة إلى الرئيسية</a>
        <a class="btn btn-ghost" href="/dashboard">لوحة التحكم</a>
      </div>
    </section>`;
    res.status(404).send(layout({ title: 'صفحة غير موجودة', body, req }));
  });

  // معالج الأخطاء
  app.use((err, req, res, _next) => {
  console.error('[خطأ] خطأ في لوحة التحكم:', err);
    /* أخطاء الطلب (4xx) نوضّحها للمستخدم · أخطاء الخادم (5xx) ما نسرّب تفاصيلها */
    const status = Number(err.status || err.statusCode) || 500;
    if (req.path.startsWith('/api/')) {
      if (status >= 500) {
        audit.record(req, { action: 'security.blocked', detail: `خطأ خادم في ${req.method} ${req.path}`, severity: 'warn' });
        return res.status(500).json({ error: 'server_error', message: 'صار خطأ داخلي — جرّب مرة ثانية.' });
      }
      return res.status(status).json({ error: err.code || 'request_error', message: err.message });
    }
    return res.status(status >= 500 ? 500 : status).send(status >= 500 ? 'خطأ داخلي في الخادم' : err.message);
  });

  return app;
}

function startServer() {
  if (server) return server;

  /* بوابة أمان قبل أي شيء: في الإنتاج نرفض الإقلاع بسر جلسات معلوم/قصير.
     موضوعة هنا (لا في index.js) لأنّ هذا هو المكان الوحيد الذي تُنشأ فيه
     الجلسات فعلًا، فلا يمكن لأي مسار إقلاع آخر أن يتجاوزها. */
  config.assertSessionSecretSafe();

  const app = createApp();
  const { port } = config.web;

  server = app.listen(port, '0.0.0.0', () => {
  console.log(`[الويب] الموقع شغّال على: ${config.web.url}`);
    console.log(`   (من نفس الجهاز: http://localhost:${port})`);
    if (!config.web.demoMode && !config.bot.clientSecret) {
   console.warn('[تنبيه] CLIENT_SECRET غير موجود — تسجيل الدخول لن يعمل. أضف DEMO_MODE=true للمعاينة.');
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
   console.error(`[خطأ] المنفذ ${port} مستخدم بالفعل. غيّر DASHBOARD_PORT في .env`);
    } else {
   console.error('[خطأ] خطأ في خادم اللوحة:', err.message);
    }
  });

  return server;
}

/** إيقاف خادم اللوحة */
function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = {
  createApp,
  startServer,
  stopServer,
  destroyUserSessions,
  countUserSessions,
  sessionToken: () => crypto.randomBytes(24).toString('hex'),
};
