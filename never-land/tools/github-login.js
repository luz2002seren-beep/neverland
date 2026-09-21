#!/usr/bin/env node
/**
 * ربط GitHub بدون كلمة مرور (Device Flow) + إنشاء المستودع + رفع المشروع.
 *   node tools/github-login.js start                 → يعطي كودًا تدخله في github.com/login/device
 *   node tools/github-login.js finish <اسم> [vis]    → بعد الموافقة: ينشئ المستودع ويرفع الملفات
 *
 * متغيّرات اختيارية:
 *   NL_PROJECT   مجلد المشروع (افتراضيًا: المجلد الأب لهذا الملف)
 *   NL_GH_STATE  أين تُحفظ حالة Device Flow (افتراضيًا: مجلد النظام المؤقت)
 */
'use strict';
const fs = require('fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('child_process');

/* معرّف عميل OAuth العام الخاص بـ GitHub CLI — ليس سرًا (معلن في مصدر gh)،
   وموجود هنا لأن Device Flow يحتاج client_id معروفًا لدى GitHub. */
const CLIENT_ID = '178c6fc778ccc68e1d6a';

/* كانت هذه مسارات مطلقة من جهاز صاحب المشروع الأصلي، فالسكربت كان معطّلًا
   لأي شخص آخر. صارت تُشتقّ من مكان الملف وقابلة للضبط بمتغيّرات بيئة. */
const PROJECT = process.env.NL_PROJECT || path.join(__dirname, '..');
const STATE = process.env.NL_GH_STATE || path.join(os.tmpdir(), 'gh-device.json');

const arg = process.argv[2] || 'start';

async function start() {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: 'repo' }),
  });
  const data = await res.json();
  if (!data.device_code) throw new Error('فشل بدء الطلب: ' + JSON.stringify(data));
  fs.writeFileSync(STATE, JSON.stringify({ ...data, created: Date.now() }, null, 2));
  console.log('\n==================== كود ربط GitHub ====================');
  console.log(' 1) افتح الرابط:  ' + data.verification_uri);
  console.log(' 2) اكتب الكود:   ' + data.user_code);
  console.log(' 3) اضغط Authorize للموافقة');
  console.log('=======================================================\n');
  console.log('الكود صالح لمدة', Math.round(data.expires_in / 60), 'دقائق. بعد الموافقة قل: تم');
}

async function finish(repoName, visibility) {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  let token = null;
  for (let i = 0; i < 40; i++) {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: state.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const d = await res.json();
    if (d.access_token) { token = d.access_token; break; }
    if (d.error === 'authorization_pending') { await new Promise((r) => setTimeout(r, (state.interval || 5) * 1000)); continue; }
    if (d.error === 'slow_down') { await new Promise((r) => setTimeout(r, 8000)); continue; }
    throw new Error('تعذّر الحصول على التوكن: ' + JSON.stringify(d));
  }
  if (!token) throw new Error('لم تتم الموافقة بعد — افتح الرابط واكتب الكود ثم أعد المحاولة.');

  const me = await (await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'never-land' },
  })).json();
  if (!me.login) throw new Error('تعذّر قراءة الحساب: ' + JSON.stringify(me));
  console.log('✅ تم الربط بحساب:', me.login);

  const repoRes = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'never-land' },
    body: JSON.stringify({
      name: repoName,
      description: 'Never Land — بوت إدارة سيرفرات ديسكورد (discord.js v14) + موقع ولوحة تحكم عربية كاملة',
      private: visibility !== 'public',
      has_issues: true,
      has_wiki: false,
      topics: ['discord', 'discord-bot', 'arabic', 'dashboard', 'moderation', 'tickets', 'nodejs'],
    }),
  });
  const repo = await repoRes.json();
  const full = repo.full_name || `${me.login}/${repoName}`;
  console.log('📦 المستودع:', `https://github.com/${full}`);

  const remote = `https://${me.login}:${token}@github.com/${full}.git`;
  const run = (cmd) => execSync(cmd, { cwd: PROJECT, stdio: 'inherit' });
  try { run('git remote remove origin'); } catch (e) { /* لا يوجد */ }
  run(`git remote add origin ${remote}`);
  run('git push -u origin main');
  run(`git remote set-url origin https://github.com/${full}.git`);
  console.log('\n🎉 تم رفع المشروع بنجاح:', `https://github.com/${full}`);
}

const repoName = process.argv[3] || 'never-land';
const visibility = process.argv[4] || 'private';
(arg === 'finish' ? finish(repoName, visibility) : start()).catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
