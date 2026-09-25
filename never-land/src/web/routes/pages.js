'use strict';

/**
 * web/routes/pages.js
 * -------------------------------------------------------------
 * صفحات لوحة التحكم (HTML مُصمّم مباشرة داخل الخادم — بدون محرّك قوالب).
 *   /                 صفحة الترحيب
 *   /dashboard        قائمة السيرفرات
 *   /dashboard/:id    لوحة إعداد السيرفر (SPA تعمل بـ public/app.js)
 * -------------------------------------------------------------
 */

const express = require('express');
const config = require('../../config');
const webGuilds = require('../guilds');
const { guildIconUrl, initials } = require('../../lib/discordIcon');
const siteUsers = require('../siteUsers');
const db = require('../../database');
const premiumLib = require('../../lib/premium');

const router = express.Router();
const { icon, logoMark } = require('../public/icons');
const access = require('../access');

/**
 * بصمة الأصول (CSS/JS): تُحسب من محتوى الملفات، فيتغيّر الرابط تلقائيًا
 * مع أي تعديل ⇒ ما يبقى المتصفح يعرض نسخة قديمة (مشكلة الأيقونة الدائرة).
 */
const ASSET_FILES = ['style.css', 'dash.css', 'app.js', 'app-sections.js', 'icons.js', 'lang-dict.js', 'lang.js'];
const assetStamp = (() => {
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const path = require('node:path');
  const hash = crypto.createHash('sha1');
  for (const file of ASSET_FILES) {
    try {
      hash.update(fs.readFileSync(path.join(__dirname, '..', 'public', file)));
    } catch {
      hash.update(file);
    }
  }
  return hash.digest('hex').slice(0, 10);
})();

/** رابط الأصل مع بصمة النسخة */
const asset = (name) => `/${name}?v=${assetStamp}`;

/** تخطيط الصفحة العام */
/**
 * القالب العام — يأخذ nonce من الطلب (res.locals) ليشتغل السكربت الداخلي
 * مع سياسة أمان المحتوى الصارمة (CSP بلا unsafe-inline).
 * @param {object} options
 * @param {string} [options.nonce] يُمرَّر عادة من req.res.locals.cspNonce
 */
function pickLang(req, res) {
  const q = String(req?.query?.lang || '').toLowerCase();
  if (q === 'ar' || q === 'en' || q === 'fr') {
    if (res && typeof res.append === 'function') {
      res.append('Set-Cookie', `nl_lang=${q}; Path=/; Max-Age=31536000; SameSite=Lax`);
    }
    return q;
  }
  const m = String(req?.headers?.cookie || '').match(/(?:^|;\s*)nl_lang=(ar|en|fr)/);
  return m ? m[1] : 'ar';
}

const SITE_META = {
  ar: 'نظام إدارة سيرفرات ديسكورد: حماية تلقائية، سجلات، تذاكر، ترحيب، مستويات، ولوحة تحكم كاملة.',
  en: 'Discord server management: automod, logs, tickets, welcome, levels, and a full control panel.',
  fr: 'Gestion de serveurs Discord : automod, journaux, tickets, accueil, niveaux, et un panneau complet.',
};

function layout({ title, body, user = null, extraHead = '', bodyClass = '', nonce = '', req = null }) {
  const resolvedNonce = nonce || req?.res?.locals?.cspNonce || '';
  const n = resolvedNonce ? ` nonce="${resolvedNonce}"` : '';
  const lang = pickLang(req, req?.res);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const metaDesc = SITE_META[lang] || SITE_META.ar;
  const SITE_NAME = config.web.siteName;
  /* صفحة اللوحة تُعرف بأي صنف يحتوي كلمة dashboard (dashboard · dashboard-readonly · dashboard-owner) */
  const isDashboardPage = String(bodyClass).split(/\s+/).includes('dashboard');
  const userBox = user
    ? `<div class="user-box">
         <span class="user-name" data-nl-raw>${escapeHtml(user.globalName || user.username || 'مستخدم')}</span>
         <a class="btn btn-ghost" href="/auth/logout">${icon('logout', { size: 17 })} خروج</a>
       </div>`
    : `<a class="btn btn-primary" href="/auth/login">${icon('login', { size: 17 })} تسجيل الدخول بـ Discord</a>`;

  const langSwitch = `<div class="lang-switch" role="group" aria-label="${lang === 'fr' ? 'Langue' : lang === 'en' ? 'Language' : 'اللغة'}">
      <button type="button" class="lang-btn${lang === 'ar' ? ' on' : ''}" data-set-lang="ar" title="العربية" aria-label="العربية">ع</button>
      <button type="button" class="lang-btn${lang === 'en' ? ' on' : ''}" data-set-lang="en" title="English" aria-label="English">EN</button>
      <button type="button" class="lang-btn${lang === 'fr' ? ' on' : ''}" data-set-lang="fr" title="Français" aria-label="Français">FR</button>
    </div>`;

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${escapeHtml(metaDesc)}">
<meta name="theme-color" content="#0d1017" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f6fb" media="(prefers-color-scheme: light)">
<meta name="color-scheme" content="dark light">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${SITE_NAME}">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(title)} | ${SITE_NAME}">
<meta property="og:description" content="${escapeHtml(metaDesc)}">
<meta property="og:image" content="/icon.svg">
<meta name="twitter:card" content="summary">
<title>${escapeHtml(title)} | ${SITE_NAME}</title>
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="${asset('style.css')}">
${isDashboardPage ? `<link rel="stylesheet" href="${asset('dash.css')}">` : ''}
<script src="${asset('lang-dict.js')}"></script>
<script src="${asset('lang.js')}"></script>
<script${n}>
  /* السمة: المفضّل المحفوظ ← وإلا إعداد الجهاز نفسه (ليلي/نهاري/تلقائي) */
  (function () {
    var root = document.documentElement;
    var saved = null;
    try { saved = localStorage.getItem('neverland-theme'); } catch (e) {}
    var langSaved = null;
    try { langSaved = localStorage.getItem('neverland-lang'); } catch (e) {}
    if (!document.cookie.match(/(?:^|; )nl_lang=(ar|en|fr)/) && (langSaved === 'en' || langSaved === 'fr' || langSaved === 'ar')) {
      root.lang = langSaved;
      root.dir = langSaved === 'ar' ? 'rtl' : 'ltr';
    }
    if (root.lang === 'en' || root.lang === 'fr') root.dataset.langPending = '1';
    setTimeout(function () { root.removeAttribute('data-lang-pending'); }, 2500);
    function systemTheme() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    root.dataset.theme = saved === 'light' || saved === 'dark' ? saved : systemTheme();
    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
          var cur = null;
          try { cur = localStorage.getItem('neverland-theme'); } catch (err) {}
          if (cur !== 'light' && cur !== 'dark') root.dataset.theme = e.matches ? 'light' : 'dark';
        });
      } catch (e) {}
    }
  })();
</script>
${extraHead}
</head>
<body class="${bodyClass}">
<header class="topbar">
  <a class="brand" href="/" aria-label="Never Land">
    <span class="brand-logo">${logoMark(32)}</span>
    <span class="brand-text">Never<span class="accent">Land</span></span>
  </a>
  <nav class="nav">
    <a href="/#features">الميزات</a>
    <a href="/dashboard">لوحة التحكم</a>
    <a href="/#commands">الأوامر</a>
  </nav>
  <div class="auth">
    ${langSwitch}
    <button class="theme-toggle" id="themeToggle" title="تبديل الوضع الليلي والنهاري" aria-label="تبديل الوضع">${icon('moon', { size: 17 })}</button>
    ${userBox}
  </div>
</header>
<main class="container">
${body}
</main>
<footer class="footer">
  <div class="footer-brand">
    <span class="footer-logo">${logoMark(22)}</span>
    <span><b>${SITE_NAME}</b> — نظام إدارة سيرفرات ديسكورد</span>
  </div>
  <nav class="footer-links" aria-label="روابط التذييل">
    <a href="/">${icon('home', { size: 15 })} الرئيسية</a>
    <a href="/dashboard">${icon('server', { size: 15 })} السيرفرات</a>
    <a href="/api/status">${icon('activity', { size: 15 })} حالة الخدمة</a>
  </nav>
</footer>
<script${n}>
  (function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var moon = ${JSON.stringify(icon('moon', { size: 17 }))};
    var sun = ${JSON.stringify(icon('sun', { size: 17 }))};
    var autoIcon = ${JSON.stringify(icon('refresh', { size: 17 }))};
    var root = document.documentElement;
    var icon = { light: sun, dark: moon, auto: autoIcon };
    var label = { light: 'الوضع النهاري', dark: 'الوضع الليلي', auto: 'حسب إعداد الجهاز' };
    var stored = null;
    try { stored = localStorage.getItem('neverland-theme'); } catch (e) {}
    var mode = stored === 'light' || stored === 'dark' ? stored : 'auto';
    var paint = function () {
      var shown = mode === 'auto' ? (root.dataset.theme === 'light' ? 'light' : 'dark') : mode;
      btn.innerHTML = mode === 'auto' ? autoIcon : icon[shown];
      btn.title = label[mode] + ' — اضغط للتبديل';
      btn.setAttribute('aria-label', label[mode]);
    };
    paint();
    btn.addEventListener('click', function () {
      var order = { auto: 'light', light: 'dark', dark: 'auto' };
      mode = order[mode];
      try {
        if (mode === 'auto') localStorage.removeItem('neverland-theme');
        else localStorage.setItem('neverland-theme', mode);
      } catch (e) {}
      var system = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      root.dataset.theme = mode === 'auto' ? system : mode;
      paint();
    });
  })();
</script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * تحديد المشاهد:
 *  - مسجّل بـ Discord (أو وضع DEMO) → مشاهدة وتعديل
 *  - زائر مع الوصول العام (PUBLIC_ACCESS) → مشاهدة فقط
 *  - غير ذلك → تحويل لتسجيل الدخول
 */
async function requireAuth(req, res, next) {
  /* وضع التطوير (DEMO): دخول مباشر بدون توكن */
  if (config.web.demoData) {
    req.user = { id: '0', username: 'المسؤول', globalName: 'مسؤول السيرفر' };
    req.canEdit = true;
    req.roleResult = { ok: true, reason: 'demo', checked: false };
    return next();
  }

  /* 1) تأكيد الدخول */
  if (!req.session.user) {
    if (config.web.publicAccess && !config.web.loginRequired) {
      req.user = null;
      req.canEdit = false;
      req.roleResult = { ok: false, reason: 'guest', checked: false };
      return next();
    }
    req.session.returnTo = req.originalUrl || '/';
    return res.redirect('/auth/login');
  }

  /* 2) حالة العضو في سجل الموقع (حظر / مشاهدة فقط) — يفرضها المالك */
  req.user = req.session.user;
  req.isSiteOwner = siteUsers.isOwner(req.session.user.id);

  if (!req.isSiteOwner && siteUsers.isBanned(req.session.user.id)) {
    /* محظور: نعرض صفحة الحظر ونُبقي الجلسة حتى تبقى هويته معروفة —
       لو حذفنا الجلسة لصار زائرًا مجهولًا وشاهد الصفحات العامة. */
    const entry = siteUsers.get(req.session.user.id) || {};
    return res
      .status(403)
      .send(layout({ title: 'محظور من الموقع', body: bannedBody(req.user, entry), user: null, req }));
  }

  /* 3) مالك الموقع: دخول كامل دائمًا (ما يتأثّر بأي شرط رول) */
  if (req.isSiteOwner) {
    req.canEdit = true;
    req.roleResult = { ok: true, reason: 'site_owner', checked: true };
    req.roleOk = true;
    return next();
  }

  /* 4) قائمة السماح: المحاولة تتسجل وتظهر للمالك فقط، والدخول بعد ما يضيفه */
  siteUsers.touch(req.session.user.id, { user: req.session.user });
  if (!siteUsers.isAllowed(req.session.user.id)) {
    return res.status(403).send(layout({ title: 'بانتظار الموافقة', body: pendingBody(req.user), user: req.user, req }));
  }

  /* 5) مشاهدة فقط: يفتح كل الصفحات لكن بلا أي تعديل */
  if (siteUsers.isViewOnly(req.session.user.id)) {
    req.canEdit = false;
    req.viewOnly = true;
    req.roleResult = { ok: true, reason: 'view_only', checked: true };
    req.roleOk = true;
    return next();
  }

  req.canEdit = true;
  req.roleOk = true;
  req.roleResult = { ok: true, reason: 'allowed', checked: true };
  return next();
}

/** صفحة «محظور من الموقع» */
function bannedBody(user, entry = {}) {
  const who = user ? escapeHtml(user.globalName || user.username || '') : '';
  return `
  <section class="site-hero" style="text-align:center;max-width:700px;margin-inline:auto">
    <span class="pill">${icon('ban', { size: 15 })} محظور من الموقع</span>
    <h1>حسابك ممنوع من دخول الموقع</h1>
    <p class="muted">
      ${who ? `${who} — ` : ''}تم حظر حسابك من الموقع${entry.note ? ` للسبب التالي: <b data-nl-raw>${escapeHtml(entry.note)}</b>` : ''}.<br>
      لو تعتقد أن هذا خطأ، تواصل مع إدارة السيرفر.
    </p>
    <div class="site-cta">
      <a class="btn btn-ghost" href="/auth/logout">${icon('logout', { size: 16 })} خروج</a>
    </div>
  </section>`;
}

/** صفحة الانتظار: الحساب وصل للمالك، وما يدخل إلا بعد ما يضيفه */
function pendingBody(user) {
  const who = user ? escapeHtml(user.globalName || user.username) : '';
  return `
  <section class="site-hero" style="text-align:center;max-width:720px;margin-inline:auto">
    <span class="pill">${icon('shield', { size: 15 })} بانتظار الموافقة</span>
    <h1>طلبك وصل لمالك الموقع</h1>
    <p class="muted">حسابك <b>${who || 'حسابك'}</b> ظاهر عند المالك فقط. ما يفتح الموقع إلا بعد ما يضيفك من لوحة التحكم.</p>
    <div class="mock-panel" style="text-align:start;margin-top:18px">
      <div class="mock-title">${icon('userPlus', { size: 16 })} حسابك</div>
      <div class="mock-row"><span class="mock-ico">${icon('userPlus', { size: 16 })}</span> ${who || 'بدون اسم'}</div>
    </div>
    <div class="site-cta" style="margin-top:18px">
      <a class="btn btn-primary" href="/dashboard">${icon('refresh', { size: 16 })} أعدت المحاولة</a>
      <a class="btn btn-ghost" href="/auth/logout">${icon('logout', { size: 16 })} خروج</a>
    </div>
  </section>`;
}

/** قائمة السيرفرات العامة (لزائر بدون تسجيل): من البوت إن كان متصلًا، وإلا قائمة المعاينة */
/** صياغة «قبل كم» بالعربية لوقت المزامنة */
function sinceArabic(ts) {
  if (!ts) return 'لم تتم المزامنة بعد';
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return 'قبل لحظات';
  const min = Math.round(sec / 60);
  if (min < 60) return `قبل ${min} دقيقة`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  const day = Math.round(hr / 24);
  return `قبل ${day} يوم`;
}

function publicGuilds(req) {
  if (config.web.demoData) return require('../demo').DEMO_META.guilds;
  const client = (() => {
    try {
      return require('../../client');
    } catch {
      return null;
    }
  })();

  // ١) البوت متّصل الآن → بيانات حيّة مباشرة من ديسكورد
  if (client?.isReady?.()) {
    return [...client.guilds.cache.values()].map((g) => ({
      id: g.id,
      name: g.name,
      icon: guildIconUrl(g.id, g.iconURL?.({ size: 128, extension: 'png' }) || g.icon),
      memberCount: g.memberCount,
      ownerName: null,
      botPresent: true,
      syncedAt: Date.now(),
    }));
  }

  // ٢) البوت متوقّف → آخر لقطة مزامنة محفوظة في قاعدة البيانات
  return require('../../sync').listGuildMeta();
}

/* --------------------- ملفات الموقع الأساسية (أيقونة، مانيفست، روبوتات) --------------------- */

router.get('/icon.svg', (_req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=604800').send(logoMark(64));
});

router.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').json({
    name: config.web.siteName,
    short_name: config.web.siteName,
    description: 'نظام إدارة سيرفرات ديسكورد مع لوحة تحكم عربية',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0d1017',
    theme_color: '#5b6cff',
    dir: 'rtl',
    lang: 'ar',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  });
});

router.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\n');
});

router.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n',
  );
});

/* ---------------------------------- الصفحة الرئيسية ---------------------------------- */
router.get('/', requireAuth, (req, res) => {
  const loggedIn = Boolean(req.user || config.web.demoData);
  const supportUrl = config.web.supportUrl || null;

  const features = [
    { i: 'shield', t: 'حماية تلقائية', d: 'منع السبام والروابط والدعوات والمنشن الجماعي والكلمات الممنوعة، مع حماية من الهجمات.' },
    { i: 'hammer', t: 'أوامر إشراف', d: 'حظر دائم ومؤقت، طرد، إسكات، تحذيرات، وسجل حالات مرقّم لكل عضو.' },
    { i: 'scroll', t: 'سجلات شاملة', d: 'ثمانية وثلاثون حدثًا في تسع مجموعات، مع تحديد من نفّذ كل إجراء.' },
    { i: 'userPlus', t: 'ترحيب بالصورة', d: 'بطاقة ترحيب تُولَّد بالأفتار، ورسالة وداع، وشكر الدعم.' },
    { i: 'ticket', t: 'تذاكر بأربعة أنواع', d: 'الدعم الفني، التوثيق، الهدايا، وتقديم الإدارة، مع أرشيف محادثة عند الإغلاق.' },
    { i: 'clipboard', t: 'نموذج تقديم إدارة', d: 'نموذج من خمس خانات يصل لقناة الإدارة، مع قبول أو رفض ورسائل تلقائية.' },
    { i: 'lines', t: 'الخط الفاصل', d: 'خط تلقائي في قنوات التقديمات مع حذف الخط السابق في كل رسالة جديدة.' },
    { i: 'chart', t: 'مستويات وخبرة', d: 'خبرة على الرسائل والقنوات الصوتية، ومكافآت رتب، ولوحة متصدّرين.' },
    { i: 'sliders', t: 'لوحة تحكم عربية', d: 'تحكم كامل من المتصفح بثلاثة عشر قسمًا، مع وضع ليلي ونهاري، بدون أوامر.' },
    { i: 'server', t: 'استضافة ذاتية', d: 'يعمل على SQLite افتراضيًا مع بديل JSON، ودعم Docker وPM2.' },
    { i: 'crown', t: 'اشتراك بريميوم', d: 'خطط شهر و٣ أشهر وسنة. تطلبها من اللوحة، ومالك الموقع يفعّلها. الوحدات الحالية تبقى مجانية.' },
  ];

  const stats = [
    { i: 'terminal', n: '31', l: 'أمر سلاش' },
    { i: 'scroll', n: '38', l: 'حدث سجلات' },
    { i: 'layers', n: '11', l: 'نظامًا' },
    { i: 'sliders', n: '24', l: 'قسمًا في اللوحة' },
  ];

  const steps = [
    { t: 'ادخل للوحة', d: 'سجّل الدخول بحساب ديسكورد. المالك يضيفك لقائمة الدخول من لوحة التحكم.' },
    { t: 'اختر السيرفر', d: 'من قائمة السيرفرات اختر سيرفرك. اسمه يظهر أعلى الشريط الجانبي.' },
    { t: 'اختر الوحدة', d: 'من «إعدادات الوحدات» افتح الترحيب أو الحماية أو السجلات أو التذاكر.' },
    { t: 'فعّل واحفظ', d: 'شغّل مفتاح «مفعّل» أعلى الصفحة، ثم احفظ. البوت يطبّقها فورًا.' },
  ];

  const commands = [
    ['/ban', 'العضو:@Ahmed', 'السبب:نشر روابط', 'المدة:7d'],
    ['/autoline add', 'القناة:#التقديمات'],
    ['/welcome image', 'النوع:بطاقة مولَّدة بالأفتار'],
    ['/tickets applychannel', 'القناة:#قبول-إدارة'],
    ['/logs events', 'تحديد أحداث السجلات بالمجموعات'],
    ['/automod word', 'العملية:إضافة', 'الكلمة:كلمة_ممنوعة'],
    ['/premium'],
  ];

  const rows = [
    { i: 'userPlus', k: 'الترحيب', t: 'رحّب بالأعضاء بشكل احترافي', d: 'صورة ترحيب بالأفتار، رسالة وداع، وشكر الدعم. تُضبط من وحدة «الترحيب والوداع».' },
    { i: 'shield', k: 'الحماية', t: 'خلّ البوت يراقب السيرفر', d: 'منع السبام والروابط والكلمات، مع الحظر والطرد والإسكات من وحدة الإشراف.' },
    { i: 'scroll', k: 'السجلات', t: 'سجّل كل حدث في رومه', d: 'حذف الرسائل، الرتب، الدخول والخروج، والحظر. كل مجموعة أحداث لها قناة.' },
    { i: 'chart', k: 'المستويات', t: 'كافئ الأعضاء النشطين', d: 'خبرة على الرسائل والصوت، رتب عند الوصول لمستوى، ولوحة متصدرين.' },
    { i: 'ticket', k: 'التذاكر', t: 'استقبل الطلبات بتذاكر واضحة', d: 'أربعة أنواع، استلام، وأرشيف عند الإغلاق، مع نموذج تقديم الإدارة.' },
    { i: 'crown', k: 'الاشتراك', t: 'فعّل بريميوم لسيرفرك', d: 'اطلب شهرًا أو ٣ أشهر أو سنة من اللوحة. مالك الموقع يفعّل الخطة. الوحدات الحالية تبقى مجانية.' },
  ];

  const body = `
  <section class="site-hero">
    <div class="site-hero-copy">
      <span class="pill">${icon('bolt', { size: 15 })} لوحة عربية — نفس طريقة الاستخدام</span>
      <h1>خلّ سيرفرك <span class="grad">احترافي</span></h1>
      <p class="lead">
        ترحيب بالصورة، سجلات، إشراف، تذاكر، ومستويات.
        من الموقع: ادخل، اختر السيرفر، فعّل الوحدة.
      </p>
      <div class="site-cta">
        <a class="btn btn-primary btn-lg" href="${loggedIn ? '/dashboard' : '/auth/login'}">
          ${icon(loggedIn ? 'dashboard' : 'login', { size: 18 })} ${loggedIn ? 'لوحة التحكم' : 'تسجيل الدخول'}
        </a>
        <a class="btn btn-ghost btn-lg" href="#features">تصفح الميزات</a>
      </div>
    </div>
  </section>

  <div id="features" class="site-features">
    ${rows
      .map(
        (f, idx) => `<article class="site-feature pb-row${idx % 2 ? ' alt' : ''}">
          <div>
            <span class="fi">${icon(f.i, { size: 18 })} ${f.k}</span>
            <b>${f.t}</b>
            <p>${f.d}</p>
            <a class="pb-more" href="${loggedIn ? '/dashboard' : '/auth/login'}">افتح الوحدة من اللوحة</a>
          </div>
          <div class="site-hero-art" aria-hidden="true">
            <div class="mock-bar"><i></i><i></i><i></i></div>
            <div class="mock-title">${icon(f.i, { size: 16 })} ${f.k}</div>
            <div class="mock-row"><span class="lbl">الوحدة</span><span class="badge badge-ok">مفعّلة</span></div>
            <div class="mock-row"><span class="lbl">${f.t}</span><span class="val">من اللوحة</span></div>
          </div>
        </article>`,
      )
      .join('')}
  </div>

  <div class="section-title"><h2>طريقة الاستخدام</h2><span class="hr"></span></div>
  <div class="site-steps">
    ${steps
      .map(
        (st, i) => `<div class="site-step">
          <span class="n">${i + 1}</span>
          <b>${st.t}</b>
          <p>${st.d}</p>
        </div>`,
      )
      .join('')}
  </div>

  <div class="section-title" id="commands"><h2>الأوامر</h2><span class="hr"></span></div>
  <p class="muted pb-note">الأوامر اختيارية. الإعداد الأساسي من اللوحة، والأمر المكافئ يبقى في ديسكورد.</p>
  <pre class="cmd-preview">${commands
    .map((parts) => `<b>${escapeHtml(parts[0])}</b>  ${parts.slice(1).map((x) => escapeHtml(x)).join('  ')}`)
    .join('\n')}</pre>

  <div class="pb-cta">
    <h2>خلّ البوت يدير السيرفر</h2>
    <p>ادخل للوحة، اختر السيرفر، ثم فعّل الوحدة من الشريط الجانبي.</p>
    <a class="btn btn-primary btn-lg" href="/dashboard">${icon('dashboard', { size: 18 })} فتح لوحة التحكم</a>
  </div>`;

  res.send(layout({ title: 'بوت إدارة سيرفرات ديسكورد', body, user: req.user, req }));
});

/* ---------------------------------- قائمة السيرفرات ---------------------------------- */
router.get('/dashboard', requireAuth, async (req, res) => {
  const syncStatus = require('../../sync').getStatus();
  let guilds = [];
  if (req.canEdit) {
    // مصدر موثوق: جلسة الدخول + سيرفرات البوت الحيّة + آخر مزامنة
    guilds = await webGuilds.listUserGuilds(req);
  } else {
    // زائر: قائمة السيرفرات العامة (بدون تعديل)
    guilds = publicGuilds(req).map((g) => ({ ...g, owner: false, public: true }));
  }
  const isGuest = !req.canEdit;

  const withBot = guilds.filter((g) => g.botPresent).length;
  let premiumIds = new Set();
  try { premiumIds = premiumLib.activeIds(); } catch { premiumIds = new Set(); }
  const numLoc = pickLang(req) === 'fr' ? 'fr-FR' : pickLang(req) === 'en' ? 'en-US' : 'ar-EG';

  const guildPick = [];
  const cards = guilds.length
    ? guilds
        .map((g) => {
          const pick = guildPick.length;
          if (g.botPresent) guildPick.push({ id: String(g.id), icon: g.icon || null });
          const iconUrl = g.botPresent ? `/guild-icon/${pick}` : null;
          const thumb = iconUrl
            ? `<img class="guild-icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'guild-icon placeholder',textContent:this.dataset.initials}))" data-initials="${escapeHtml(initials(g.name))}">`
            : `<div class="guild-icon placeholder">${escapeHtml(initials(g.name))}</div>`;
          const cardInner = `
        ${thumb}
        <div class="guild-info">
          <b>${escapeHtml(g.name)}</b>
          ${premiumIds.has(String(g.id)) ? `<span class="prem-pill">${icon('star', { size: 13 })} بريميوم</span>` : ''}
          <span class="muted">
            ${g.memberCount ? `${Number(g.memberCount).toLocaleString('ar-EG')} عضو` : 'عدد الأعضاء غير متاح'}
            ${g.owner ? `— ${icon('crown', { size: 14 })} المالك` : ''}
          </span>
          <span class="muted sync-line">${icon('refresh', { size: 13 })} آخر مزامنة: ${sinceArabic(g.syncedAt)}</span>
        </div>
        <div class="guild-actions">
          ${
            g.botPresent
              ? `<span class="btn btn-primary btn-sm">${icon('settings', { size: 16 })} ${isGuest ? 'عرض' : 'إعداد'}</span>`
              : `<span class="badge badge-warn">${icon('warning', { size: 15 })} البوت غير مضاف</span>`
          }
        </div>`;
          return g.botPresent
            ? `<form method="post" action="/dashboard/open" class="guild-card-form"><input type="hidden" name="pick" value="${pick}"><button type="submit" class="guild-card" data-name="${escapeHtml(String(g.name || '').toLowerCase())}" data-bot="1">${cardInner}</button></form>`
            : `<div class="guild-card disabled" data-name="${escapeHtml(String(g.name || '').toLowerCase())}" data-bot="0">${cardInner}</div>`;
        })
        .join('')
    : `<div class="empty">
         <h3>لا توجد سيرفرات متاحة</h3>
         <p>تظهر السيرفرات التي تملك فيها صلاحية «إدارة السيرفر» وكان البوت مضافًا إليها.</p>
         <a class="btn btn-primary" href="/auth/login">${icon('login', { size: 17 })} إعادة تسجيل الدخول</a>
       </div>`;

  /* nonce لسكربت الصفحة الداخلي (مطلوب مع سياسة أمان المحتوى) */
  const n = res.locals.cspNonce ? ` nonce="${res.locals.cspNonce}"` : '';

  const body = `
  <div class="page-head">
    <div>
      <h1>اختر السيرفر</h1>
      <p class="muted">${guilds.length} سيرفر · البوت مضاف إلى ${withBot} منها. بعد الاختيار، فعّل الوحدة من الشريط الجانبي.${isGuest ? ' · عرض عام للقراءة فقط' : ''}</p>
    </div>
    <div class="head-actions">
      ${
        isGuest
          ? `<a class="btn btn-primary" href="/auth/login">${icon('login', { size: 17 })} تسجيل الدخول بـ Discord</a>`
          : `<button class="btn btn-primary" id="syncNowBtn">${icon('refresh', { size: 17 })} مزامنة الآن</button>
             <a class="btn btn-ghost" href="/auth/logout">${icon('logout', { size: 17 })} خروج</a>`
      }
    </div>
  </div>

  <p class="muted" id="syncInfo">آخر مزامنة مع ديسكورد: <b>${sinceArabic(syncStatus.at)}</b>${
    syncStatus.botOnline ? ' · البوت متّصل ويحدّث البيانات لحظيًا' : ''
  }</p>

  ${
    guilds.length
      ? `<div class="servers-toolbar">
           <span class="search-wrap">${icon('search', { size: 16 })}<input type="text" id="guildSearch" placeholder="ابحث عن سيرفر بالاسم"></span>
           <div class="seg" id="guildFilter">
             <button class="active" data-filter="all">الكل</button>
             <button data-filter="with">البوت مضاف</button>
             <button data-filter="without">بدون البوت</button>
           </div>
         </div>`
      : ''
  }

  <div class="guild-grid" id="guildGrid">${cards}</div>

  ${
    guilds.length
      ? `<script${n}>
           (function () {
             // «مزامنة الآن»: يحدّث بيانات السيرفرات من ديسكورد ثم يعيد تحميل الصفحة
             var syncBtn = document.getElementById('syncNowBtn');
             if (syncBtn) {
               syncBtn.addEventListener('click', async function () {
                 var original = syncBtn.innerHTML;
                 syncBtn.disabled = true;
                 syncBtn.textContent = 'جارٍ المزامنة...';
                 try {
                   var res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                   var data = await res.json();
                   if (!res.ok) throw new Error(data.message || 'تعذّرت المزامنة');
                   location.reload();
                 } catch (err) {
                   syncBtn.disabled = false;
                   syncBtn.innerHTML = original;
                   alert(err.message || 'تعذّرت المزامنة');
                 }
               });
             }

             var search = document.getElementById('guildSearch');
             var filter = document.getElementById('guildFilter');
             var grid = document.getElementById('guildGrid');
             if (!search || !grid) return;
             var cards = Array.prototype.slice.call(grid.querySelectorAll('.guild-card'));
             var mode = 'all';
             var apply = function () {
               var q = (search.value || '').trim().toLowerCase();
               var shown = 0;
               cards.forEach(function (c) {
                 var okName = !q || (c.dataset.name || '').indexOf(q) !== -1;
                 var okBot = mode === 'all' || (mode === 'with' ? c.dataset.bot === '1' : c.dataset.bot === '0');
                 var visible = okName && okBot;
                 var box = c.closest('form') || c;
                 box.style.display = visible ? '' : 'none';
                 if (visible) shown++;
               });
               var empty = grid.querySelector('.no-result');
               if (!shown && !empty) {
                 empty = document.createElement('div');
                 empty.className = 'empty no-result';
                 empty.innerHTML = '<h3>لا نتائج</h3><p>جرّب اسمًا آخر أو غيّر الفلتر.</p>';
                 grid.appendChild(empty);
               } else if (shown && empty) {
                 empty.remove();
               }
             };
             search.addEventListener('input', apply);
             filter.addEventListener('click', function (e) {
               var btn = e.target.closest('button');
               if (!btn) return;
               mode = btn.dataset.filter;
               filter.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
               apply();
             });
           })();
         </script>`
      : ''
  }`;

  if (req.session) {
    req.session.guildPick = guildPick;
    if (typeof req.session.save === 'function') {
      await new Promise((resolve) => req.session.save(() => resolve()));
    }
  }
  res.send(layout({ title: 'السيرفرات', body, user: req.user, req }));
});

/* ---------------------------------- لوحة إعداد سيرفر ---------------------------------- */

function rememberGuild(req, guildId) {
  if (!req.session || !guildId) return Promise.resolve();
  req.session.activeGuildId = String(guildId);
  return new Promise((resolve) => {
    if (typeof req.session.save === 'function') req.session.save(() => resolve());
    else resolve();
  });
}

/** المتصفح يفتح الصفحة. الاختبارات ترسل X-Requested-With وتبقى على الرد المباشر. */
function browserWantsHtml(req) {
  if (req.get('X-Requested-With')) return false;
  return String(req.get('Accept') || '').includes('text/html');
}

function sendGuildDashboard(req, res, guildId, { hideId = false } = {}) {
  const n = res.locals.cspNonce ? ` nonce="${res.locals.cspNonce}"` : '';
  const guildAttr = hideId ? '' : ` data-guild="${escapeHtml(guildId)}"`;
  const body = `
  <div id="app"${guildAttr} data-edit="${req.canEdit ? '1' : '0'}" data-owner="${req.isSiteOwner ? '1' : '0'}" data-viewonly="${req.viewOnly ? '1' : '0'}">
    <div class="loading">جارٍ تحميل الإعدادات...</div>
  </div>
  <script${n}>
    (function () {
      var path = String(location.pathname || '');
      while (path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
      var parts = path.split('/');
      if (parts.length !== 3 || parts[1] !== 'dashboard' || !/^[0-9]{15,25}$/.test(parts[2] || '')) return;
      try {
        history.replaceState(null, '', '/dashboard/server' + (location.search || '') + (location.hash || ''));
      } catch (e) {}
    })();
  </script>
  <script src="${asset('icons.js')}"></script>
  <script src="${asset('app.js')}"></script>
  <script src="${asset('app-sections.js')}"></script>`;

  res.send(
    layout({
      title: 'إعدادات السيرفر',
      body,
      user: req.user,
      req,
      bodyClass: `dashboard${req.canEdit ? '' : ' dashboard-readonly'}${req.isSiteOwner ? ' dashboard-owner' : ''}`,
    }),
  );
}

router.get('/guild-icon/:index', requireAuth, (req, res) => {
  const row = req.session?.guildPick?.[Number(req.params.index)];
  const url = row ? guildIconUrl(row.id, row.icon, 128) : null;
  if (!url) return res.status(404).end();
  return res.redirect(url);
});

router.post('/dashboard/open', requireAuth, async (req, res) => {
  const picked = req.session?.guildPick?.[Number(req.body?.pick)];
  const guildId = String(picked?.id || req.body?.guild || '');
  if (!/^\d{15,25}$/.test(guildId)) return res.redirect('/dashboard');
  if (!config.web.demoData) {
    const allowed = await webGuilds.canAccessGuild(req, guildId);
    if (!allowed) return res.status(403).send('ما عندك صلاحية الوصول لهذا السيرفر.');
  }
  await rememberGuild(req, guildId);
  return res.redirect(302, '/dashboard/server');
});

router.get('/dashboard/server', requireAuth, async (req, res) => {
  const guildId = String(req.session?.activeGuildId || '');
  if (!/^\d{15,25}$/.test(guildId)) return res.redirect('/dashboard');
  if (!config.web.demoData) {
    const allowed = await webGuilds.canAccessGuild(req, guildId);
    if (!allowed) return res.redirect('/dashboard');
  }
  return sendGuildDashboard(req, res, guildId, { hideId: true });
});

router.get('/dashboard/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;

  if (!config.web.demoData) {
    const allowed = await webGuilds.canAccessGuild(req, guildId);
    if (!allowed) {
      return res.status(403).send('ما عندك صلاحية الوصول لهذا السيرفر.');
    }
  }

  await rememberGuild(req, guildId);
  /* الرابط النظيف ما فيه رقم السيرفر. المتصفح يحافظ على #tickets بعد التحويل. */
  if (browserWantsHtml(req)) return res.redirect(302, '/dashboard/server');
  return sendGuildDashboard(req, res, guildId);
});

// نُصدّر الراوتر نفسه مع إرفاق دوال مساعدة (يستخدمها خادم اللوحة)
module.exports = Object.assign(router, { layout, escapeHtml });
