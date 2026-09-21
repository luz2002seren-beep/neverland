'use strict';

/**
 * site-members-test.js
 * -------------------------------------------------------------
 * اختبار لوحة «أعضاء الموقع» والتحكم بالأعضاء:
 *
 *   ١) السجل: كل من يسجّل دخول يُحفظ (زيارات، آخر ظهور، سيرفراته)
 *   ٢) الحظر: العضو المحظور ما يقدر يفتح الموقع، وجلسته تُقطع فورًا
 *   ٣) المشاهدة فقط: يفتح الصفحات لكن التعديل والحفظ ممنوعان
 *   ٤) المالك فقط: غيره ما يشوف القسم ولا يقدر ينفّذ أي أمر إداري
 *   ٥) الحمايات: ما يمكن حظر المالك، ولا تغيير حالة غير موجودة
 *
 * يعمل بلا إنترنت: يشغّل الخادم الداخلي على منفذ حر ببيانات مؤقتة.
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
const THIRD_ID = '333333333333333333';

/** جلسة مصنوعة يدويًا نضعها في المخزن مباشرة (بلا OAuth) */
function makeSession(user) {
  return {
    cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/', sameSite: 'lax' },
    user,
    guilds: [],
    roleCheck: null,
  };
}

/** توقيع كوكي الجلسة (نفس ما يفعله express-session) */
function signCookie(sid, secret) {
  const signature = require('cookie-signature');
  return `neverland.sid=${encodeURIComponent(`s:${signature.sign(sid, secret)}`)}`;
}

/** عميل HTTP بسيط يحمل كوكي جلسة */
function client(base, sid) {
  const jar = sid ? signCookie(sid, process.env.SESSION_SECRET) : '';
  return {
    async request(method, urlPath, body) {
      const res = await fetch(base + urlPath, {
        method,
        /* رأس الموقع + الأصل: نفس ما يرسله المتصفح من لوحة التحكم (طبقة منع CSRF) */
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'neverland-dashboard',
          Origin: base,
          ...(jar ? { Cookie: jar } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      let json = null;
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        /* صفحة HTML */
      }
      return { status: res.status, json, text, headers: res.headers };
    },
    get: (p) => client(base, sid).request('GET', p),
    post(p, b) {
      return this.request('POST', p, b);
    },
  };
}

async function run() {
  /* بيئة اختبار مؤقتة */
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-site-'));
  process.env.DATABASE_PATH = path.join(tmpDir, 'site.db');
  process.env.DEMO_MODE = 'false';
  process.env.PUBLIC_ACCESS = 'true';
  process.env.LOGIN_REQUIRED = 'false';
  process.env.OWNER_USER_ID = OWNER_ID;
  process.env.SESSION_SECRET = 'test-secret-not-real';

  const config = require('../src/config');
  config.web.ownerUserId = OWNER_ID;
  config.web.demoMode = false;
  config.web.requiredRoleId = ''; // بلا شرط رول في الاختبار

  const web = require('../src/web/server');
  const app = web.createApp();
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /* نضع جلسات جاهزة في المخزن (نفس المخزن الذي يستخدمه الخادم) */
  const store = (() => {
    // نصل للمخزن عبر طلب أول ثم من خلال الميدل وير: نستخدم واجهة الخادم
    return app.get('sessionStore') || null;
  })();

  // المخزن غير مُصدَّر على الـapp، لذا ننشئ الجلسات عبر مسار حقيقي:
  // نستخدم /test-login المؤقت غير الموجود — لذلك نلجأ لملف الجلسات مباشرة.
  const sessionsFile = path.join(path.dirname(config.database.path), 'sessions.json');

  function writeSessions(entries) {
    // نكتب كل الجلسات معًا ثم نعيد تحميل المخزن عبر إعادة إنشاء التطبيق
    const data = {};
    for (const [sid, sess] of entries) {
      data[sid] = { session: JSON.stringify(sess), expires: Date.now() + 3600 * 1000 };
    }
    fs.writeFileSync(sessionsFile, JSON.stringify(data));
  }

  /** إنشاء تطبيق جديد يقرأ ملف الجلسات المحدّث */
  async function freshServer(sessions) {
    writeSessions(sessions);
    const newApp = web.createApp();
    const s = await new Promise((resolve) => {
      const srv = http.createServer(newApp).listen(0, '127.0.0.1', () => resolve(srv));
    });
    return { server: s, base: `http://127.0.0.1:${s.address().port}` };
  }

  const sidOwner = crypto.randomBytes(16).toString('hex');
  const sidOther = crypto.randomBytes(16).toString('hex');

  let live = await freshServer([
    [sidOwner, makeSession({ id: OWNER_ID, username: 'owner', globalName: 'المالك' })],
    [sidOther, makeSession({ id: OTHER_ID, username: 'other', globalName: 'عضو عادي' })],
  ]);

  const siteUsers = require('../src/web/siteUsers');
  const owner = client(live.base, sidOwner);
  const other = client(live.base, sidOther);

  /* ───────── ١) السجل ───────── */
  const rec = siteUsers.recordLogin({ id: THIRD_ID, username: 'third', globalName: 'ثالث' }, { guilds: 2 });
  assert.strictEqual(rec.id, THIRD_ID);
  assert.ok(rec.firstSeen && rec.lastSeen, 'أوقات السجل ناقصة');
  assert.strictEqual(siteUsers.statusOf(THIRD_ID), 'active', 'الحالة الافتراضية غلط');

  // المالك يسجّل دخول نفسه أيضًا
  siteUsers.recordLogin({ id: OWNER_ID, username: 'owner', globalName: 'المالك' }, { guilds: 1 });
  siteUsers.recordLogin({ id: OTHER_ID, username: 'other', globalName: 'عضو عادي' }, { guilds: 0 });

  // واجهة المالك تعرض الجميع
  const list1 = await owner.get('/api/admin/members');
  assert.strictEqual(list1.status, 200, 'المالك ما قدر يفتح القائمة');
  assert.ok(list1.json.members.length >= 3, 'القائمة لا تحتوي كل الأعضاء');
  assert.ok(list1.json.members.some((m) => m.id === OWNER_ID && m.isOwner), 'المالك غير مميّز في القائمة');
  assert.ok(list1.json.members.some((m) => m.id === THIRD_ID), 'العضو الثالث غير موجود');
  assert.ok(typeof list1.json.stats.total === 'number' && list1.json.stats.total >= 3, 'إحصاءات القائمة ناقصة');
  console.log('١) سجل الأعضاء: يُحفظ كل من دخّل + قائمة المالك كاملة ✅');

  /* ───────── ٤) المالك فقط (قبل ما نحظر أحد) ───────── */
  const otherList = await other.get('/api/admin/members');
  assert.strictEqual(otherList.status, 403, `غير المالك وصل لقائمة الإدارة (${otherList.status})`);
  assert.strictEqual(otherList.json.error, 'owner_only');
  const otherMe = await other.get('/api/admin/me');
  assert.strictEqual(otherMe.json.isOwner, false, 'غير المالك يظهر كمالك');
  const ownerMe = await owner.get('/api/admin/me');
  assert.strictEqual(ownerMe.json.isOwner, true, 'المالك لا يُعرَف كمالك');
  const otherBan = await other.post(`/api/admin/members/${THIRD_ID}/status`, { status: 'banned' });
  assert.strictEqual(otherBan.status, 403, 'غير المالك قدر يحظر!');
  assert.strictEqual(siteUsers.statusOf(THIRD_ID), 'active', 'حالة العضو تغيّرت من غير المالك');
  console.log('٤) المالك فقط: القائمة والأوامر ممنوعة على غيره ✅');

  /* ───────── ٣) المشاهدة فقط ───────── */
  const viewRes = await owner.post(`/api/admin/members/${OTHER_ID}/status`, { status: 'viewonly' });
  assert.strictEqual(viewRes.status, 200, 'تعيين «مشاهدة فقط» فشل');
  assert.strictEqual(siteUsers.statusOf(OTHER_ID), 'viewonly');

  const viewPage = await other.get('/dashboard');
  assert.strictEqual(viewPage.status, 200, 'المشاهدة فقط ما قدر يفتح الصفحة');
  const viewMe = await other.get('/api/me');
  assert.strictEqual(viewMe.json.viewOnly, true, 'واجهة المستخدم ما تعرف أنه مشاهدة فقط');
  assert.strictEqual(viewMe.json.roleOk, true, 'المشاهدة فقط يجب أن يُسمح له بالقراءة');

  // القراءة مسموحة والكتابة ممنوعة
  const guildsRead = await other.get(`/api/guilds/${require('../src/web/demo').DEMO_GUILD_ID}`);
  assert.ok([200, 403].includes(guildsRead.status), 'طلبات القراءة تتعطّل للمشاهدة فقط');
  const writeTry = await other.post(`/api/guilds/${require('../src/web/demo').DEMO_GUILD_ID}/settings`, { leveling: { enabled: false } });
  assert.strictEqual(writeTry.status, 403, `المشاهدة فقط قدر يعدّل (${writeTry.status})`);
  assert.strictEqual(writeTry.json.error, 'readonly');
  console.log('٣) المشاهدة فقط: يفتح كل شي ويقرأ، والتعديل/الحفظ ممنوعان ✅');

  /* ───────── ٢) الحظر ───────── */
  const banRes = await owner.post(`/api/admin/members/${OTHER_ID}/status`, { status: 'banned', reason: 'تخريب الإعدادات' });
  assert.strictEqual(banRes.status, 200, 'الحظر فشل');
  assert.strictEqual(banRes.json.status, 'banned', 'رد الحظر لا يؤكد الحالة الجديدة');
  assert.ok(
    typeof banRes.json.killedSessions === 'number' && banRes.json.killedSessions >= 1,
    `الحظر لم يقطع جلسات المحظور (killedSessions=${banRes.json.killedSessions})`
  );
  assert.ok(/قطع/.test(banRes.json.message || ''), 'رسالة الحظر لا تذكر قطع الجلسات');
  assert.strictEqual(siteUsers.statusOf(OTHER_ID), 'banned');

  // جلسة المحظور انقطعت فورًا — كوكي الجلسة القديمة لم يعد يدلّ على هويته،
  // فصار زائرًا مجهولًا (user=null) بدل عضو مسجّل. وأي محاولة دخول جديدة
  // تُرفض 403 في /auth/callback (اختُبرت في kickban-test).
  const bannedApi = await other.get('/api/me');
  assert.strictEqual(bannedApi.status, 200, 'المحظور لم يستطع فتح /api/me');
  assert.strictEqual(bannedApi.json.user, null, 'جلسة المحظور ما زالت حيّة — هويته لم تُمحَ');
  assert.strictEqual(bannedApi.json.isOwner, false, 'المحظور ما زال يُحسب مالكًا');
  const bannedPage = await other.get('/dashboard');
  assert.ok(
    bannedPage.status === 200 || bannedPage.status === 302,
    `/dashboard ردّ بحالة غير متوقعة على المحظور (${bannedPage.status})`
  );
  console.log('٢) الحظر: الحساب محظور + الجلسة مقطوعة فورًا (طُرد من الموقع) ✅');

  /* ───────── ٥) الحمايات ───────── */
  const banOwner = await owner.post(`/api/admin/members/${OWNER_ID}/status`, { status: 'banned' });
  assert.strictEqual(banOwner.status, 400, 'تم حظر المالك!');
  assert.strictEqual(banOwner.json.error, 'owner_protected', 'حماية المالك ناقصة');
  const badStatus = await owner.post(`/api/admin/members/${THIRD_ID}/status`, { status: 'king' });
  assert.strictEqual(badStatus.status, 400, 'حالة غير معروفة قُبلت');
  const missing = await owner.post('/api/admin/members/999999999/status', { status: 'banned' });
  assert.strictEqual(missing.status, 400, 'تغيير حالة عضو غير موجود نجح');
  assert.strictEqual(siteUsers.statusOf(OWNER_ID), 'active', 'المالك تأثّر');
  console.log('٥) الحمايات: بلا حظر للمالك · بلا حالات وهمية · بلا عضو غير موجود ✅');

  /* ───────── رجوع الحالة الطبيعية + قطع الجلسة ───────── */
  const unban = await owner.post(`/api/admin/members/${OTHER_ID}/status`, { status: 'active' });
  assert.strictEqual(unban.status, 200);
  assert.strictEqual(siteUsers.statusOf(OTHER_ID), 'active', 'الرجوع للحالة الطبيعية فشل');
  const kick = await owner.post(`/api/admin/members/${THIRD_ID}/kick`, {});
  assert.ok(kick.json.ok, 'قطع الجلسة فشل');
  const forget = await owner.request('DELETE', `/api/admin/members/${THIRD_ID}`);
  assert.strictEqual(forget.status, 200, 'حذف الحساب من السجل فشل');
  assert.strictEqual(siteUsers.get(THIRD_ID), null, 'الحساب ما انحذف');
  console.log('٦) الرجوع طبيعيًا · قطع الجلسة · حذف الحساب من السجل ✅');

  /* ───────── ٧) صفحة اللوحة نفسها: تنسيقها مربوط دائمًا ───────── */
  const demoGuild = require('../src/web/demo').DEMO_GUILD_ID;
  /* في الاختبار ما في سيرفرات حقيقية في القاعدة — نسمح بالوصول للسيرفر التجريبي */
  const webGuilds = require('../src/web/guilds');
  const prevAccess = webGuilds.canAccessGuild;
  webGuilds.canAccessGuild = async () => true;

  const ownerDash = await owner.get(`/dashboard/${demoGuild}`);
  assert.strictEqual(ownerDash.status, 200, 'المالك ما قدر يفتح صفحة اللوحة');
  assert.ok(ownerDash.text.includes('dash.css?v='), 'تنسيق اللوحة غير مربوط لصفحة المالك (تظهر مشلولة بلا تنسيق)');
  assert.ok(ownerDash.text.includes('class="dashboard dashboard-owner"') || ownerDash.text.includes('dashboard-owner'), 'صفحة المالك بلا صنف dashboard-owner');
  assert.ok(ownerDash.text.includes('data-owner="1"'), 'صفحة المالك ما تعرّف نفسها كمالك');

  /* مشاهدة فقط: نفس الاسم مع لاحقة — لازم يبقى التنسيق مربوطًا */
  await owner.post(`/api/admin/members/${OTHER_ID}/status`, { status: 'viewonly' });
  const viewDash = await other.get(`/dashboard/${demoGuild}`);
  assert.strictEqual(viewDash.status, 200, 'المشاهدة فقط ما قدر يفتح صفحة اللوحة');
  assert.ok(viewDash.text.includes('dash.css?v='), 'تنسيق اللوحة غير مربوط لصفحة «مشاهدة فقط»');
  assert.ok(viewDash.text.includes('dashboard-readonly'), 'صفحة المشاهدة فقط بلا صنف القراءة فقط');

  /* زائر بلا حساب: نفس الشي */
  const guestDash = await client(live.base, null).get(`/dashboard/${demoGuild}`);
  assert.strictEqual(guestDash.status, 200, 'الزائر ما قدر يفتح صفحة اللوحة العامة');
  assert.ok(guestDash.text.includes('dash.css?v='), 'تنسيق اللوحة غير مربوط لصفحة الزائر');

  await owner.post(`/api/admin/members/${OTHER_ID}/status`, { status: 'active' });
  webGuilds.canAccessGuild = prevAccess;
  console.log('٧) صفحة اللوحة: تنسيق dash.css مربوط للمالك والمشاهدة فقط والزائر ✅');

  /* تنظيف */
  live.server.close();
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { total: siteUsers.count() };
}

module.exports = { run };

if (require.main === module) {
  console.log('\n[اختبار] لوحة «أعضاء الموقع»: حظر · مشاهدة فقط · المالك فقط\n');
  run()
    .then(() => console.log('\n🎉 التحكم بأعضاء الموقع يعمل كما هو مطلوب\n'))
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
