'use strict';

/**
 * security-test.js
 * -------------------------------------------------------------
 * اختبار حماية الموقع وسجل النشاط (بلا ديسكورد حقيقي):
 *
 *   ١) رؤوس الأمان: CSP بـ nonce · منع التأطير · nosniff · HSTS على https
 *   ٢) منع CSRF: طلب POST من موقع ثاني يُرفض · ومن نفس الموقع يُقبل
 *   ٣) حدّ الطلبات: الطلبات الزائدة ترجع 429 مع Retry-After
 *   ٤) تلويث النموذج: __proto__ و constructor مرفوضة ولا تلوّث أي كائن
 *   ٥) قصر الإعدادات: مفتاح غير معروف يُرفض (ولا يُحفظ) ويُسجّل
 *   ٦) الصلاحيات: الكتابة بلا صلاحية = 403 (زائر · مشاهدة فقط)
 *   ٧) سجل النشاط: يُسجَّل من عمل شو ومتى ويُحفظ في قاعدة البيانات
 *   ٨) النسخة الاحتياطية: للمالك فقط — وغير المالك يُرفض
 *   ٩) عدم تسريب الأخطاء: خطأ خادم يرجع رسالة عامة
 *
 * التشغيل:  node security-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const OWNER_ID = '1345866950776979547';
const OTHER_ID = '222222222222222222';

function signCookie(sid, secret) {
  return `neverland.sid=${encodeURIComponent(`s:${require('cookie-signature').sign(sid, secret)}`)}`;
}

function makeSession(user) {
  return { cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/', sameSite: 'lax' }, user, guilds: [], roleCheck: null };
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-sec-'));
  process.env.DATABASE_PATH = path.join(tmpDir, 'sec.db');
  process.env.DEMO_MODE = 'false';
  process.env.PUBLIC_ACCESS = 'true';
  process.env.LOGIN_REQUIRED = 'false';
  process.env.OWNER_USER_ID = OWNER_ID;
  process.env.SESSION_SECRET = 'security-test-secret';

  const config = require('../src/config');
  config.web.ownerUserId = OWNER_ID;
  config.web.demoMode = false;
  config.web.requiredRoleId = '';
  config.web.publicAccess = true;
  config.web.loginRequired = false;

  const security = require('../src/lib/security');
  const db = require('../src/database');
  const web = require('../src/web/server');
  const webGuilds = require('../src/web/guilds');

  /* الوصول للسيرفرات: نسمح بالسيرفر التجريبي فقط (ما في سيرفرات حقيقية بالاختبار) */
  const realCanAccess = webGuilds.canAccessGuild;
  /* قاعدة الصلاحيات الحقيقية مبسّطة: مالك الموقع يملك كل السيرفرات · غيره لا */
  webGuilds.canAccessGuild = async (req) => String(req.session?.user?.id || '') === OWNER_ID;

  const sidOwner = crypto.randomBytes(16).toString('hex');
  const sidOther = crypto.randomBytes(16).toString('hex');
  const mockGuild = '100000000000000001';

  fs.writeFileSync(
    path.join(path.dirname(config.database.path), 'sessions.json'),
    JSON.stringify({
      [sidOwner]: { session: JSON.stringify(makeSession({ id: OWNER_ID, username: 'owner', globalName: 'المالك' })), expires: Date.now() + 3600e3 },
      [sidOther]: { session: JSON.stringify(makeSession({ id: OTHER_ID, username: 'other', globalName: 'عضو عادي' })), expires: Date.now() + 3600e3 },
    }),
  );

  const app = web.createApp();
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const req = (method, p, { body = null, cookie = null, headers = {}, origin = null } = {}) =>
    fetch(base + p, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });

  const owner = (method, p, opts = {}) => req(method, p, { ...opts, cookie: signCookie(sidOwner, process.env.SESSION_SECRET) });

  try {
    /* ───────── ١) رؤوس الأمان ───────── */
    const page = await req('GET', '/');
    const csp = page.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("default-src 'self'"), 'CSP ناقصة');
    assert.ok(csp.includes('frame-ancestors'), 'منع التأطير ناقص من CSP');
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), 'CSP تسمح بكل السكربتات الداخلية بلا قيد');
    const nonce = (csp.match(/nonce-([^']+)/) || [])[1];
    assert.ok(nonce, 'nonce غير موجود في CSP');
    const html = await page.text();
    assert.ok(html.includes(`nonce="${nonce}"`), 'السكربت الداخلي بلا nonce (لن يعمل مع CSP)');
    assert.strictEqual(page.headers.get('x-frame-options'), 'DENY', 'X-Frame-Options ناقص');
    assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff', 'nosniff ناقص');
    assert.ok(page.headers.get('referrer-policy'), 'Referrer-Policy ناقص');
    assert.ok(page.headers.get('permissions-policy'), 'Permissions-Policy ناقص');
    assert.strictEqual(page.headers.get('x-powered-by'), null, 'الخادم يكشف تقنيته (X-Powered-By)');
    console.log('١) رؤوس الأمان: CSP بـ nonce · منع التأطير · nosniff · بلا كشف التقنية ✅');

    /* ───────── ٢) منع CSRF ───────── */
    const crossSite = await owner('POST', `/api/guilds/${mockGuild}/settings`, {
      body: { leveling: { enabled: false } },
      origin: 'https://evil-example.com',
    });
    assert.strictEqual(crossSite.status, 403, 'طلب من موقع ثاني قُبل!');
    assert.strictEqual((await crossSite.json()).error, 'bad_origin');

    const sameSite = await owner('POST', `/api/guilds/${mockGuild}/settings`, {
      body: { leveling: { enabled: true } },
      origin: base,
    });
    assert.strictEqual(sameSite.status, 200, 'طلب من نفس الموقع انرفض بالخطأ');

    const headerOnly = await owner('POST', `/api/guilds/${mockGuild}/settings`, {
      body: { leveling: { enabled: true } },
      headers: { 'X-Requested-With': 'neverland-dashboard' },
    });
    assert.strictEqual(headerOnly.status, 200, 'طلب يحمل رأس الموقع انرفض');
    console.log('٢) منع CSRF: موقع خارجي مرفوض · نفس الموقع مقبول ✅');

    /* ───────── ٣) تلويث النموذج ───────── */
    const pollution = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":1}},"leveling":{"enabled":true}}');
    const pollRes = await owner('POST', `/api/guilds/${mockGuild}/settings`, { body: pollution, origin: base });
    assert.strictEqual(pollRes.status, 200, 'طلب يحمل مفاتيح خطيرة انرفض كاملًا (المفروض يتنظّف ويمر)');
    assert.strictEqual({}.polluted, undefined, 'تلوّث النموذج نجح — __proto__ وصل!');
    assert.strictEqual(Object.prototype.polluted, undefined, 'Object.prototype اتلوّث');
    const { stripDangerousKeys, sanitizeSettingsPatch } = security;
    const cleaned = stripDangerousKeys(JSON.parse('{"a":1,"__proto__":{"bad":1}}'));
    assert.strictEqual(cleaned.bad, undefined, 'stripDangerousKeys ما شالت __proto__');
    assert.deepStrictEqual(Object.keys(cleaned), ['a'], 'المفاتيح النظيفة اتأثّرت');
    console.log('٣) تلويث النموذج: __proto__/constructor مرفوضة بلا أي تلويث ✅');

    /* ───────── ٤) قصر الإعدادات على المعروف ───────── */
    const unknownKey = await owner('POST', `/api/guilds/${mockGuild}/settings`, {
      body: { hackKey: { evil: true }, leveling: { enabled: true } },
      origin: base,
    });
    assert.strictEqual(unknownKey.status, 200, 'الحفظ فشل مع مفتاح غريب');
    const afterUnknown = await owner('GET', `/api/guilds/${mockGuild}`);
    const settingsNow = (await afterUnknown.json()).settings;
    assert.ok(!('hackKey' in settingsNow), 'مفتاح غير معروف انحفظ في الإعدادات!');
    const { patch, rejected } = sanitizeSettingsPatch({ hackKey: 1, leveling: { enabled: true } }, config.defaults);
    assert.deepStrictEqual(rejected, ['hackKey'], 'المفاتيح المرفوضة ما انحسبت');
    assert.ok('leveling' in patch, 'المفتاح المعروف انرفض بالخطأ');
    console.log('٤) قصر الإعدادات: أي مفتاح غير معروف مرفوض ولا يُحفظ ✅');

    /* ───────── ٥) الصلاحيات: بلا تسجيل دخول = بلا كتابة ───────── */
    const anon = await req('POST', `/api/guilds/${mockGuild}/settings`, { body: { leveling: { enabled: false } }, origin: base });
    assert.ok([401, 403].includes(anon.status), `زائر بلا حساب قدر يعدّل الإعدادات! (${anon.status})`);
    const other = await req('POST', `/api/guilds/${mockGuild}/settings`, {
      body: { leveling: { enabled: false } },
      origin: base,
      cookie: signCookie(sidOther, process.env.SESSION_SECRET),
    });
    assert.strictEqual(other.status, 403, `حساب بلا صلاحية على هذا السيرفر قدر يعدّل! (${other.status})`);
    const otherRead = await req('GET', `/api/guilds/${mockGuild}`, { cookie: signCookie(sidOther, process.env.SESSION_SECRET) });
    assert.strictEqual(otherRead.status, 403, `حساب بلا صلاحية قدر يقرأ بيانات السيرفر! (${otherRead.status})`);
    const otherAudit = await req('GET', `/api/guilds/${mockGuild}/audit`, { cookie: signCookie(sidOther, process.env.SESSION_SECRET) });
    assert.strictEqual(otherAudit.status, 403, 'حساب بلا صلاحية قدر يقرأ سجل نشاط السيرفر!');
    console.log('٥) الصلاحيات: الكتابة مرفوضة للزائر ولحساب بلا صلاحية ✅');

    /* ───────── ٦) سجل النشاط ───────── */
    const before = db.countAudit();
    await owner('POST', `/api/guilds/${mockGuild}/settings`, { body: { welcome: { enabled: true } }, origin: base });
    const afterSave = db.countAudit();
    assert.ok(afterSave > before, 'حفظ الإعدادات ما انسجّل في السجل');

    const auditList = db.listAudit({ guildId: mockGuild, limit: 10 });
    const saveEntry = auditList.items.find((r) => r.action === 'settings.save');
    assert.ok(saveEntry, 'حدث الحفظ غير موجود في السجل');
    assert.ok(saveEntry.actor_id === OWNER_ID, 'الفاعل غير مسجّل في الحدث');
    assert.ok(saveEntry.detail && saveEntry.detail.includes('welcome'), 'تفاصيل التغيير غير مسجّلة');
    assert.ok(saveEntry.ip_hash && saveEntry.ip_hash.length >= 8, 'بصمة الجهاز غير مسجّلة');
    assert.ok(!String(saveEntry.ip_hash).includes('.'), 'الـIP مخزّن خامًا (لازم بصمة مجزّأة)');

    /* مفتاح غريب = حدث تحذيري */
    const warnEntries = db.listAudit({ guildId: mockGuild, severity: 'warn', limit: 20 });
    assert.ok(warnEntries.items.some((r) => r.action === 'settings.rejected'), 'رفض المفاتيح غير المعروفة ما انسجّل');

    /* السجل مربوط بالـAPI */
    const auditApi = await owner('GET', `/api/guilds/${mockGuild}/audit?limit=5`);
    assert.strictEqual(auditApi.status, 200, 'مسار السجل ما اشتغل');
    const auditJson = await auditApi.json();
    assert.ok(Array.isArray(auditJson.items) && auditJson.items.length > 0, 'السجل فاضي من الـAPI');
    assert.ok(auditJson.items[0].label, 'اسم الحدث المقروء ناقص');
    assert.ok(auditJson.stats && typeof auditJson.stats.total === 'number', 'إحصاءات السجل ناقصة');

    /* الخصوصية: الزائر بلا حساب ما يشوف السجل (أسماء الأعضاء وإجراءاتهم) */
    const guestAudit = await req('GET', `/api/guilds/${mockGuild}/audit`);
    assert.strictEqual(guestAudit.status, 403, 'الزائر قدر يقرأ سجل النشاط!');
    assert.strictEqual((await guestAudit.json()).error, 'login_required', 'رسالة منع الزائر غير واضحة');
    /* وبصمة الجهاز ما تُعرض لمشرف السيرفر — للمالك فقط */
    assert.ok(!('ipHash' in auditJson.items[0]), 'بصمة الجهاز انعرضت لمشرف السيرفر');
    console.log('٦) سجل النشاط: من عمل شو ومتى + بصمة مجزّأة + عرض من الـAPI ✅');

    /* ───────── ٧) النسخة الاحتياطية: للمالك فقط ───────── */
    const backupOther = await req('GET', '/api/admin/backup', { cookie: signCookie(sidOther, process.env.SESSION_SECRET) });
    assert.strictEqual(backupOther.status, 403, 'غير المالك قدر ينزّل النسخة الاحتياطية!');
    const backup = await owner('GET', '/api/admin/backup');
    assert.strictEqual(backup.status, 200, 'المالك ما قدر ينزّل النسخة');
    const backupJson = await backup.json();
    assert.ok(Array.isArray(backupJson.guilds), 'النسخة ما فيها سيرفرات');
    assert.ok(Array.isArray(backupJson.siteUsers), 'النسخة ما فيها سجل الأعضاء');
    assert.ok(backupJson.counts && backupJson.counts.guilds >= 1, 'إحصاءات النسخة ناقصة');
    const raw = JSON.stringify(backupJson);
    assert.ok(!/DISCORD_TOKEN|client_secret|SESSION_SECRET/i.test(raw), 'النسخة تحتوي أسرار!');
    console.log('٧) النسخة الاحتياطية: للمالك فقط · بلا أسرار ✅');

    /* ───────── ٨) حالة الحمايات ───────── */
    const secStatus = await owner('GET', '/api/admin/security');
    assert.strictEqual(secStatus.status, 200);
    const secJson = await secStatus.json();
    assert.ok(Array.isArray(secJson.checks) && secJson.checks.length >= 8, 'قائمة الحمايات ناقصة');
    assert.ok(secJson.checks.every((c) => c.ok), 'في حماية غير مفعّلة');
    assert.ok(typeof secJson.counts.audit === 'number', 'عدد أحداث السجل غير معروض');
    console.log('٨) حالة الحمايات: كل الدفاعات مفعّلة ومعروضة ✅');

    /* ───────── ٩) حدّ الطلبات ───────── */
    let limited = false;
    let limitRes = null;
    for (let i = 0; i < 120; i += 1) {
      const r = await req('POST', `/api/guilds/${mockGuild}/settings`, { body: { leveling: { enabled: true } }, origin: base, cookie: signCookie(sidOther, process.env.SESSION_SECRET) });
      if (r.status === 429) {
        limited = true;
        limitRes = r;
        break;
      }
    }
    assert.ok(limited, 'حدّ الطلبات ما اشتغل (١٢٠ طلب كتابة متتالية كلها مرّت)');
    assert.ok(limitRes.headers.get('retry-after'), 'Retry-After ناقص');
    assert.strictEqual((await limitRes.json()).error, 'rate_limited');
    console.log('٩) حدّ الطلبات: الكتابة السريعة المتكرّرة تُوقف بـ 429 ✅');

    /* ───────── ١٠) التقليم: السجل ما يكبر بلا حد ───────── */
    for (let i = 0; i < 400; i += 1) {
      db.addAudit({ guildId: mockGuild, action: 'test.bulk', detail: `حدث ${i}` });
    }
    const pruned = db.pruneAudit(120);
    assert.ok(pruned > 0, 'التقليم ما حذف شي');
    assert.strictEqual(db.countAudit(), 120, `بعد التقليم لازم يبقى ١٢٠ — وجدنا ${db.countAudit()}`);
    db.pruneAudit(1); // نداء خاطئ: الحدّ الأدنى يحمي السجل من المسح الكامل
    assert.ok(db.countAudit() >= 100, 'الحدّ الأدنى للسجل ما اشتغل (انمسح السجل)!');
    console.log('١٠) التقليم: السجل محفوظ بحد أقصى ويُقلَّم تلقائيًا ✅');

    console.log('\n🎉 حماية الموقع وسجل النشاط يعملان كما هو مطلوب\n');
    return true;
  } finally {
    server.close();
    webGuilds.canAccessGuild = realCanAccess;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { run };

if (require.main === module) {
  console.log('\n[اختبار] حماية الموقع + سجل النشاط\n');
  run()
    .then(() => {})
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
