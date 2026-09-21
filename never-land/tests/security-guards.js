'use strict';

/**
 * tests/security-guards.js
 * -------------------------------------------------------------
 * حواجز أمان لا تتغيّر: تعمل كاختبار انحدار (regression) للثغرات
 * التي أُغلقت، حتى لا تعود في تعديل لاحق دون أن يُلاحظها أحد.
 *
 *   ١) سر الجلسات: القيم المعلنة مرفوضة، والبوابة ترفض الإقلاع في الإنتاج
 *   ٢) البوابة مربوطة فعليًا بخادم الويب (لا يمكن تجاوزها)
 *   ٣) لا أسرار حقيقية مرفوعة في المستودع
 *   ٤) .env.example سليم بنيويًا (لا سطور شاردة تُسقط القيم)
 *   ٥) عزل بيئة الاختبارات الابنة ما زال قائمًا
 *
 * التشغيل:  node tests/security-guards.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** القيم المعلنة التي يجب أن تبقى مرفوضة */
const PUBLISHED_SECRETS = ['never-land-change-me', 'غيّر_هذا_النص_الطويل_لحماية_الجلسات'];

let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ✓ ${label}`);
};

function run() {
  /* بيئة معزولة: هذا الفحص يغيّر process.env فيستعيده دائمًا */
  const envSnapshot = { ...process.env };
  const restoreEnv = () => {
    for (const k of Object.keys(process.env)) if (!(k in envSnapshot)) delete process.env[k];
    Object.assign(process.env, envSnapshot);
  };

  process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nl-guard-')), 'g.db');
  delete process.env.SESSION_SECRET;
  delete process.env.DEMO_MODE;

  const config = require('../src/config');

  try {
    /* ==================== ١) سر الجلسات ==================== */
    console.log('١) سر الجلسات: القيم المعلنة مرفوضة');

    for (const secret of PUBLISHED_SECRETS) {
      config.web.sessionSecret = secret;
      assert.strictEqual(
        config.sessionSecretIsWeak(),
        true,
        `السر المعلَن «${secret.slice(0, 24)}…» ما رُفضش!`,
      );
    }
    ok('السرّان المعلنان (الإنجليزي والعربي) مرفوضان');

    config.web.sessionSecret = 'short';
    assert.strictEqual(config.sessionSecretIsWeak(), true, 'السر القصير ما رُفضش');
    ok('السر الأقصر من 32 محرفًا مرفوض');

    const strong = 'a'.repeat(64);
    config.web.sessionSecret = strong;
    assert.strictEqual(config.sessionSecretIsWeak(), false, 'السر القوي رُفض بالغلط');
    ok('السر العشوائي الطويل مقبول');

    /* ==================== ٢) بوابة الإنتاج ==================== */
    console.log('٢) بوابة fail-closed في الإنتاج');

    const NODE_ENV = process.env.NODE_ENV;
    try {
      config.web.demoMode = false;

      process.env.NODE_ENV = 'production';
      config.web.sessionSecret = 'never-land-change-me';
      let threw = null;
      try {
        config.assertSessionSecretSafe();
      } catch (err) {
        threw = err;
      }
      assert.ok(threw, 'البوابة ما رفضاتش الإقلاع بسر معلَن في الإنتاج!');
      assert.strictEqual(
        threw.code,
        'INSECURE_SESSION_SECRET',
        'الوسم مفقود — try/catch في index.js غادي يبتلع الخطأ',
      );
      assert.ok(threw.message.includes('SESSION_SECRET'), 'الرسالة ما كتوضّحش السبب');
      /* علامة ASCII ثابتة يعتمد عليها CI — النص العربي في grep هشّ */
      assert.ok(
        threw.message.includes('[FATAL] INSECURE_SESSION_SECRET'),
        'العلامة الثابتة مفقودة — تأكيد CI غادي ينكسر',
      );
      ok('إنتاج + سر معلَن ⇒ رفض مع err.code صحيح + علامة ASCII ثابتة');

      config.web.sessionSecret = strong;
      assert.doesNotThrow(() => config.assertSessionSecretSafe(), 'السر القوي رُفض في الإنتاج');
      ok('إنتاج + سر قوي ⇒ إقلاع');

      /* وضع المعاينة مستثنى (محلي، بلا بيانات حقيقية) */
      config.web.demoMode = true;
      config.web.sessionSecret = 'never-land-change-me';
      assert.doesNotThrow(() => config.assertSessionSecretSafe(), 'وضع المعاينة انسدّ بالغلط');
      ok('DEMO_MODE ⇒ مستثنى من الرفض');

      /* التطوير: تحذير فقط */
      process.env.NODE_ENV = 'development';
      config.web.demoMode = false;
      assert.doesNotThrow(() => config.assertSessionSecretSafe(), 'التطوير انسدّ بالغلط');
      assert.ok(
        config.validate().some((p) => p.includes('SESSION_SECRET')),
        'التطوير ما كيعطيش تحذيرًا على السر الضعيف',
      );
      ok('تطوير + سر ضعيف ⇒ تحذير في validate() بلا إيقاف');
    } finally {
      if (NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = NODE_ENV;
      config.web.demoMode = false;
    }

    /* ==================== ٣) البوابة مربوطة بالخادم ==================== */
    console.log('٣) البوابة مربوطة فعليًا بخادم الويب');

    const serverSrc = read('src/web/server.js');
    assert.ok(
      /function startServer\(\)[\s\S]{0,400}config\.assertSessionSecretSafe\(\)/.test(serverSrc),
      'startServer() ما كيناديش assertSessionSecretSafe — البوابة قابلة للتجاوز!',
    );
    ok('startServer() ينادي assertSessionSecretSafe قبل إنشاء التطبيق');

    const indexSrc = read('src/index.js');
    assert.ok(
      indexSrc.includes("err.code === 'INSECURE_SESSION_SECRET'"),
      'index.js ما كيميّزش الرفض الأمني — غادي يتابع بواجهة مكشوفة',
    );
    assert.ok(
      /INSECURE_SESSION_SECRET[\s\S]{0,200}process\.exit\(1\)/.test(indexSrc),
      'الرفض الأمني ما كيوقفش العملية',
    );
    ok('index.js يخرج بـ exit(1) على الرفض الأمني بدل المتابعة');

    /* ==================== ٤) لا أسرار في المستودع ==================== */
    console.log('٤) المستودع خالٍ من الأسرار');

    /* نفحص المستودع كاملًا (لا مجلد never-land وحده) — ملف .env في الجذر
       خطر بنفس القدر. `git ls-files` من مجلد فرعي يرجّع مسارات نسبية له،
       لذلك ننطلق من جذر المستودع صراحةً. */
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const tracked = execFileSync('git', ['ls-files'], { cwd: toplevel, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

    /* `.env` وكل تنويعاته (.env.local, .env.production…) مرفوضة،
       لكن `.env.example` مشروع لأنه قالب بلا قيم حقيقية. */
    const isRealEnvFile = (f) => /(^|\/)\.env(\.[^/]+)?$/.test(f) && !/\.example$/.test(f);
    assert.ok(
      !tracked.some(isRealEnvFile),
      `ملف بيئة حقيقي مرفوع: ${tracked.filter(isRealEnvFile).join(', ')}`,
    );
    assert.ok(
      !tracked.some((f) => /\.db(-wal|-shm)?$/.test(f)),
      'قاعدة بيانات مرفوعة في المستودع!',
    );
    assert.ok(tracked.length > 50, `قائمة الملفات المتتبَّعة صغيرة بشكل مريب: ${tracked.length}`);
    ok(`لا .env ولا *.db في المستودع كاملًا (${tracked.length} ملف متتبَّع)`);

    /* .env.example خاصو يحمل القيمة البديلة فقط، ماشي سرًا حقيقيًا */
    const dotenv = require('dotenv');
    const example = dotenv.parse(read('.env.example'));
    assert.strictEqual(
      example.SESSION_SECRET,
      PUBLISHED_SECRETS[1],
      '.env.example خاصو يحمل القيمة البديلة المعلومة فقط',
    );
    ok('.env.example يحمل القيمة البديلة فقط (بلا سر حقيقي)');

    /* فحص بنيوي: أي سطر غير تعليق وغير إسناد = قيمة ضائعة (سبب الثغرة الأصلية) */
    const stray = read('.env.example')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .filter((line) => !/^[A-Z][A-Z0-9_]*=/.test(line));
    assert.deepStrictEqual(stray, [], `سطور شاردة في .env.example: ${stray.join(' | ')}`);
    ok('.env.example بلا سطور شاردة (كل قيمة مربوطة بمفتاحها)');

    /* قيم الوصول المفترضة في .env.example خاصها تكون الآمنة */
    assert.strictEqual(example.PUBLIC_ACCESS, 'false', '.env.example كيقترح وصولاً عامًا!');
    assert.strictEqual(example.LOGIN_REQUIRED, 'true', '.env.example ما كيطلبش تسجيل الدخول!');
    assert.strictEqual(example.DEMO_MODE, 'false', '.env.example كيقترح وضع المعاينة!');
    ok('.env.example يقترح الإعدادات الآمنة (PUBLIC_ACCESS=false, LOGIN_REQUIRED=true)');

    /* ==================== ٥) عزل بيئة الاختبارات ==================== */
    console.log('٥) عزل بيئة الاختبارات الابنة');

    const smokeSrc = read('tests/smoke.js');
    assert.ok(smokeSrc.includes('function childEnv('), 'childEnv() مفقودة من smoke.js');
    assert.ok(
      smokeSrc.includes("'PUBLIC_ACCESS'") && smokeSrc.includes("'LOGIN_REQUIRED'"),
      'قائمة المفاتيح المنزوعة ما كتغطيش مفاتيح الوصول',
    );
    ok('childEnv() موجودة وتغطي مفاتيح الوصول');

    /* كل execFileSync لازم يمرّ عبر childEnv — وإلا رجع التسريب */
    const childCalls = (smokeSrc.match(/execFileSync\(/g) || []).length;
    const isolated = (smokeSrc.match(/env: childEnv\(\)/g) || []).length;
    assert.strictEqual(
      childCalls,
      isolated,
      `${childCalls - isolated} استدعاء execFileSync بلا عزل بيئة!`,
    );
    ok(`كل الـ${childCalls} استدعاء execFileSync معزولة بـ childEnv()`);
  } finally {
    restoreEnv();
  }

  console.log(`\n🔐 كل الحواجز الأمنية قائمة (${passed} مجموعة)`);
}

run();
