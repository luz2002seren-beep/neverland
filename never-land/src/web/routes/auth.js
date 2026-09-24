'use strict';

/**
 * web/routes/auth.js
 * -------------------------------------------------------------
 * تسجيل الدخول عبر ديسكورد (OAuth2):
 *   1) الصلاحية العامة للوحة: القسم 0x20 (MANAGE_GUILD) أو 0x8 (ADMIN).
 *   2) شرط الدخول الفعلي: قائمة السماح في siteUsers — يضيفها مالك الموقع،
 *      ومن لم يُضف بعد يرى صفحة «بانتظار الموافقة».
 * -------------------------------------------------------------
 */

const express = require('express');
const config = require('../../config');
const siteUsers = require('../siteUsers');
const audit = require('../../lib/audit');

const router = express.Router();

const SCOPES = ['identify', 'guilds'];
const API = 'https://discord.com/api/v10';

/** رابط الدخول */
router.get('/login', (req, res) => {
  if (config.web.demoData) return res.redirect('/dashboard');
  if (!config.bot.clientSecret) {
    return res.status(400).send('لم يتم ضبط CLIENT_SECRET في ملف .env — لا يمكن تسجيل الدخول.');
  }

  const state = require('../server').sessionToken();
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: config.bot.clientId,
    redirect_uri: `${config.web.url}/auth/callback`,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    prompt: 'consent',
  });

  return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

/** نقطة العودة من ديسكورد */
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) return res.status(400).send('لم يتم إرجاع كود التفويض من ديسكورد.');
  if (state !== req.session.oauthState) return res.status(400).send('حالة OAuth غير صحيحة (CSRF). أعد المحاولة.');

  try {
    const tokenResponse = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.bot.clientId,
        client_secret: config.bot.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: `${config.web.url}/auth/callback`,
      }),
    });

    const token = await tokenResponse.json();
    if (!token.access_token) {
      console.error('[تنبيه] فشل تبادل التوكن:', token?.error || token);
      const isRedirectIssue = token?.error === 'invalid_grant' || token?.error === 'invalid_request';
      return res.status(401).send(
        isRedirectIssue
          ? 'تعذّر إكمال الدخول. تأكد أن رابط العودة مسجّل في بوابة ديسكورد، ثم حاول مرة أخرى.'
          : 'فشل تسجيل الدخول مع ديسكورد. حاول مرة أخرى.',
      );
    }

    const [user, guilds] = await Promise.all([
      fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } }).then((r) => r.json()),
      fetch(`${API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${token.access_token}` } }).then((r) => r.json()),
    ]);

    // الصلاحيات: إدارة السيرفر أو مسؤول (0x20 / 0x8)
    const manageable = (Array.isArray(guilds) ? guilds : [])
      .filter((g) => (Number(g.permissions) & 0x20) === 0x20 || (Number(g.permissions) & 0x8) === 0x8)
      .map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner }));

    /* الحظر: لا نفتح جلسة أصلًا لمن حظره المالك */
    if (!siteUsers.isOwner(user.id) && siteUsers.isBanned(user.id)) {
      const entry = siteUsers.get(user.id) || {};
      audit.record(req, {
        action: 'site.banned',
        target: user.id,
        detail: `محاولة دخول بحساب محظور${entry.note ? ` — السبب: ${entry.note}` : ''}`,
        severity: 'danger',
        actor: { id: user.id, name: user.global_name || user.username },
      });
      req.session.destroy(() => {});
      return res.status(403).send(
        `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
         <meta name="viewport" content="width=device-width, initial-scale=1"><title>محظور من الموقع</title>
         <style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
           font-family:system-ui,"Segoe UI",Tahoma,sans-serif;background:#0b0e17;color:#e6e9f5;text-align:center;padding:24px}
           .box{max-width:520px;background:#12172a;border:1px solid #232a44;border-radius:16px;padding:26px}
           h1{margin:0 0 10px;font-size:1.3rem}p{color:#8d97b4;line-height:1.9;margin:0}
           code{direction:ltr;background:#1b2138;padding:2px 7px;border-radius:6px}</style></head>
         <body><div class="box"><h1>هذا الحساب محظور من الموقع</h1>
           <p>تم منع حسابك من دخول الموقع${entry.note ? ` — السبب: ${String(entry.note).replace(/[<>]/g, '')}` : ''}.<br>
           لو تعتقد أن هذا خطأ، تواصل مع إدارة السيرفر.</p>
           <p style="margin-top:12px"><code>${String(user.id)}</code></p>
         </div></body></html>`,
      );
    }

    /* حماية: نجدد معرّف الجلسة بعد الدخول (يمنع تثبيت الجلسة / session fixation) */
    const sessionPayload = {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        globalName: user.global_name || user.username,
      },
      returnTo: req.session.returnTo,
    };
    await new Promise((resolve) => req.session.regenerate(() => resolve()));

    req.session.user = sessionPayload.user;
    if (sessionPayload.returnTo) req.session.returnTo = sessionPayload.returnTo;
    req.session.guilds = manageable;
    req.session.accessToken = token.access_token;
    req.session.roleCheck = null; // فحص جديد للرول بعد كل دخول

    /* تسجيل العضو في سجل الموقع (يظهر عند المالك في لوحة «أعضاء الموقع») */
    siteUsers.recordLogin(
      { id: user.id, username: user.username, avatar: user.avatar, globalName: user.global_name },
      { guilds: manageable.length, ip: req.ip, userAgent: req.get('user-agent') },
    );

    audit.record(req, {
      action: 'login',
      target: user.id,
      detail: `دخول بحساب ${user.global_name || user.username} · سيرفراته: ${manageable.length}`,
    });

    const back = req.session.returnTo && req.session.returnTo.startsWith('/') ? req.session.returnTo : '/dashboard';
    delete req.session.returnTo;
    /* نحفظ الجلسة قبل التحويل حتى تكون جاهزة فورًا */
    return req.session.save(() => res.redirect(back));
  } catch (err) {
    console.error('خطأ OAuth:', err);
    return res.status(500).send('حدث خطأ أثناء تسجيل الدخول. جرّب مرة أخرى.');
  }
});

/** خروج */
router.get('/logout', (req, res) => {
  audit.record(req, { action: 'logout', target: req.session?.user?.id || null });
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
