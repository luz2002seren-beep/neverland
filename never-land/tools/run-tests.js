#!/usr/bin/env node
/* ========================================================================
 * run-tests.js — مشغّل اختبارات متسامح مع الأخطاء (fault-tolerant)
 *
 * المشكلة اللي كيحلّها:
 *   «test:all» كان «A && B && C» — أي ملف كيفشل كيوقف الباقي، فما كتشوفش
 *   حالة الملفات الأخرى. وداخل smoke.js أي assert كيطيح كيوقف كل ما بعدو.
 *   التحليل سمّى هاد الشي بالاسم: «أي فشل كيوقف الباقي (وقعت فعلًا)».
 *
 * الحل:
 *   كل ملف اختبار كيتشغّل فعملية ابنة مستقلة، والكل كيتشغّل بغضّ النظر عن
 *   فشل واحد. فالاخير كيتطبع ملخّص (ناجح/فاشل + المدّة) وكيتخرج بـ 1 إلا
 *   كان شي ملف فشل. هكدا كتشوف كل الأعطال دفعة وحدة، بلا ما يخبّي واحد الآخر.
 *
 * الاستعمال:
 *   node tools/run-tests.js                 # الملفات الافتراضية الثلاثة
 *   node tools/run-tests.js tests/smoke.js  # ملفات محدّدة (للتشخيص)
 * ======================================================================== */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');

/* نفس مفاتيح البيئة اللي عزلها smoke.js — باش ما تتسرّبش بين العمليات. */
const PROJECT_ENV_KEYS = [
  'PUBLIC_ACCESS', 'LOGIN_REQUIRED', 'REQUIRED_ROLE_ID', 'OWNER_USER_ID',
  'SITE_ADMINS', 'SESSION_SECRET', 'ROLE_CACHE_SECONDS',
  'DEMO_MODE', 'DATABASE_PATH', 'DATABASE_DRIVER', 'DASHBOARD_URL',
  'DASHBOARD_PORT', 'PORT', 'RESET_COMMANDS', 'DEVELOPER_IDS',
  'DISCORD_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET',
];

function childEnv() {
  const env = { ...process.env };
  for (const key of PROJECT_ENV_KEYS) delete env[key];
  return env;
}

/* الملفات الافتراضية — نفس ترتيب «test:all» القديم. */
const DEFAULT_FILES = [
  // Discord bot runtime was removed; production CI now checks the website-only
  // process and public health route.
  'tests/site-runtime.test.js',
];

const argFiles = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = argFiles.length ? argFiles : DEFAULT_FILES;

const results = [];
for (const rel of files) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  let label = path.relative(ROOT, abs);
  if (!label || label.startsWith('..')) label = rel; // خارج المشروع: اعرضه كما مُرّر
  if (!fs.existsSync(abs)) {
    console.error(`\n✗ ${label} — الملف غير موجود`);
    results.push({ label, ok: false, ms: 0, reason: 'missing' });
    continue;
  }
  console.log(`\n${'═'.repeat(70)}\n▶ ${label}\n${'═'.repeat(70)}`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [abs], {
    cwd: ROOT,
    stdio: 'inherit', // البثّ المباشر يخلّي المستخدم يتابع التقدّم
    env: childEnv(),
  });
  const ms = Date.now() - started;
  const ok = run.status === 0;
  const reason = run.error ? run.error.message : run.signal ? `signal ${run.signal}` : `exit ${run.status}`;
  results.push({ label, ok, ms, reason });
  console.log(`${ok ? '✓' : '✗'} ${label} — ${ok ? 'ناجح' : `فاشل (${reason})`} · ${(ms / 1000).toFixed(1)}s`);
}

const passed = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

console.log(`\n${'═'.repeat(70)}\nملخّص الاختبارات\n${'═'.repeat(70)}`);
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}  (${(r.ms / 1000).toFixed(1)}s)${r.ok ? '' : ` — ${r.reason}`}`);
}
console.log(`${'─'.repeat(70)}\n  ${passed.length}/${results.length} ملفات ناجحة`);
if (failed.length) {
  console.log(`  الفاشلة: ${failed.map((f) => f.label).join('، ')}`);
  process.exit(1);
}
console.log('  🎉 كل ملفات الاختبار نجحت');
process.exit(0);
