'use strict';
/**
 * gate-test.js — اختبار بوابة الدخول على مستوى HTTP (بحقن جلسة وهمية).
 *   node gate-test.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const express = require('express');

const ROLE = '1549364852433354792';
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nl-gate-')), 'gate.db');
process.env.DEMO_MODE = 'false';
process.env.REQUIRED_ROLE_ID = ROLE;
const config = require('../src/config');
config.web.demoMode = false;          // نُطفئ وضع التطوير لاختبار البوابة الحقيقية
config.web.loginRequired = true;
config.web.requiredRoleId = ROLE;

// نحقن وحدة access وهمية للتحكم بنتيجة فحص الرول
const ACCESS_PATH = require.resolve('../src/web/access');
const realAccess = require('../src/web/access');
let nextResult = { ok: true, reason: 'ok', checked: true, guild: 'سيرفر الاختبار' };
require.cache[ACCESS_PATH] = {
  id: ACCESS_PATH,
  filename: ACCESS_PATH,
  loaded: true,
  exports: {
    ...realAccess,
    checkAccess: async () => nextResult,
    explain: realAccess.explain,
  },
};

const pages = require('../src/web/routes/pages');
const api = require('../src/web/routes/api');

const state = { user: null };   // نبدّله بين الحالات
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.session = state.user ? { user: state.user, guilds: [{ id: '100000000000000001', name: 'سيرفر', owner: true }] } : {};
    next();
  });
  a.use('/api', api);
  a.use('/', pages);
  return a;
}

async function listen(serverApp) {
  return new Promise((resolve) => {
    const s = serverApp.listen(0, () => resolve(s));
  });
}

(async () => {
  const user = { id: '555555555555555555', username: 'tester', globalName: 'المختبر' };
  const port1 = await listen(app());
  const base = `http://127.0.0.1:${port1.address().port}`;

  // 1) زائر بدون جلسة → تحويل لتسجيل الدخول
  const r1 = await fetch(`${base}/dashboard`, { redirect: 'manual' });
  console.log('١) زائر بدون تسجيل →', r1.status, r1.headers.get('location'));
  assert.strictEqual(r1.status, 302);
  assert.strictEqual(r1.headers.get('location'), '/auth/login');

  const r1b = await fetch(`${base}/`, { redirect: 'manual' });
  console.log('   الصفحة الرئيسية →', r1b.status, r1b.headers.get('location'));
  assert.strictEqual(r1b.status, 302, 'الرئيسية يجب أن تطلب تسجيل دخول');

  // 2) زائر على الـAPI → 401
  const r2 = await fetch(`${base}/api/guilds`, { redirect: 'manual' });
  const j2 = await r2.json();
  console.log('٢) زائر على الـAPI →', r2.status, '|', j2.message);
  assert.strictEqual(r2.status, 401);

  // 3) مسجّل لكن المالك ما أضافه → صفحة الانتظار
  state.user = user;
  const r3 = await fetch(`${base}/dashboard`, { redirect: 'manual' });
  const html3 = await r3.text();
  const hasDeny = html3.includes('بانتظار الموافقة');
  console.log('٣) مسجّل بدون سماح →', r3.status, '| بانتظار الموافقة:', hasDeny ? '✅' : '❌');
  assert.strictEqual(r3.status, 403);
  assert.ok(hasDeny, 'صفحة الانتظار غير صحيحة');

  const r3b = await fetch(`${base}/api/guilds/100000000000000001`, { redirect: 'manual' });
  const j3b = await r3b.json();
  console.log('   نفس الحالة على الـAPI →', r3b.status, '|', j3b.error);
  assert.strictEqual(r3b.status, 403);
  assert.strictEqual(j3b.error, 'not_allowed');

  // 4) المالك أضافه → يفتح
  const siteUsers = require('../src/web/siteUsers');
  const granted = siteUsers.grant(user.id, { by: '1', user: { username: user.username } });
  assert.strictEqual(granted.ok, true, granted.error || 'الإضافة فشلت');
  const r4 = await fetch(`${base}/dashboard`, { redirect: 'manual' });
  const html4 = await r4.text();
  console.log('٤) بعد الإضافة →', r4.status, '| قائمة السيرفرات:', html4.includes('اختيار السيرفر') ? '✅' : '❌');
  assert.strictEqual(r4.status, 200);

  const r4b = await fetch(`${base}/`);
  console.log('   الصفحة الرئيسية →', r4b.status);
  assert.strictEqual(r4b.status, 200);

  port1.close();
  delete require.cache[ACCESS_PATH];
  console.log('\n🎉 بوابة الدخول وقائمة السماح تعمل كما هو مطلوب');
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
