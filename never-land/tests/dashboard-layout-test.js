'use strict';

/**
 * dashboard-layout-test.js
 * -------------------------------------------------------------
 * اختبار التخطيط الحقيقي للوحة التحكم بمتصفح Chromium حقيقي.
 *
 * يكشف ما لا يكشفه jsdom (لأنه لا يرسم ولا يحسب التنسيق):
 *   • ملف dash.css مربوط فعلًا بصفحة اللوحة (بكل الحالات: مالك · مشاهدة فقط · زائر)
 *   • .d-shell تخطيطها flex — القائمة الجانبية بجانب المحتوى، لا فوقه
 *   • المحتوى ظاهر داخل الشاشة (مو تحت الشاشة)
 *   • عنوان القسم نظيف بلا كلمة «undefined»
 *   • صفر أخطاء JS
 *
 * يتخطّى نفسه (بنجاح) لو playwright غير مثبت — فلا يعطّل النشر.
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const OWNER_ID = '1345866950776979547';
const VIEW_ID = '444444444444444444';
const SHOT = process.env.LAYOUT_SHOT === '1';
const SHOT_PATH = path.join(os.tmpdir(), 'never-land-dashboard.png');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function signCookieValue(sid, secret) {
  const signature = require('cookie-signature');
  return `s%3A${encodeURIComponent(signature.sign(sid, secret))}`;
}

async function run({ quiet = false } = {}) {
  const say = (...a) => {
    if (!quiet) console.log(...a);
  };

  const playwright = loadPlaywright();
  if (!playwright) {
    say('  [تخطّي] متصفح الاختبار (playwright) غير مثبت — تخطّي فحص التخطيط الحقيقي');
    return { skipped: true };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-layout-'));
  process.env.DATABASE_PATH = path.join(tmpDir, 'layout.db');
  process.env.DEMO_MODE = 'false';
  process.env.PUBLIC_ACCESS = 'true';
  process.env.LOGIN_REQUIRED = 'false';
  process.env.OWNER_USER_ID = OWNER_ID;
  process.env.SESSION_SECRET = 'layout-test-secret';

  const config = require('../src/config');
  config.web.ownerUserId = OWNER_ID;
  config.web.demoMode = false;
  config.web.requiredRoleId = '';
  config.web.publicAccess = true;
  config.web.loginRequired = false;

  const web = require('../src/web/server');
  const webGuilds = require('../src/web/guilds');
  const prevAccess = webGuilds.canAccessGuild;
  webGuilds.canAccessGuild = async () => true; // ما في سيرفرات حقيقية في قاعدة الاختبار

  const sessDir = path.dirname(config.database.path);
  const sid = crypto.randomBytes(16).toString('hex');
  const sidView = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(
    path.join(sessDir, 'sessions.json'),
    JSON.stringify({
      [sid]: {
        session: JSON.stringify({
          cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/', sameSite: 'lax' },
          user: { id: OWNER_ID, username: 'owner', globalName: 'المالك' },
          guilds: [],
          roleCheck: null,
        }),
        expires: Date.now() + 3600 * 1000,
      },
      [sidView]: {
        session: JSON.stringify({
          cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/', sameSite: 'lax' },
          user: { id: VIEW_ID, username: 'viewer', globalName: 'مشاهدة فقط' },
          guilds: [],
          roleCheck: null,
        }),
        expires: Date.now() + 3600 * 1000,
      },
    }),
  );

  const app = web.createApp();
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const demoGuild = require('../src/web/demo').DEMO_GUILD_ID;

  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (err) {
    /* المتصفح غير منزّل على هذا الجهاز → نتخطّى بهدوء بدل ما نفشّل النشر */
    if (/Executable doesn't exist|playwright install|browserType\.launch/i.test(String(err.message))) {
      webGuilds.canAccessGuild = prevAccess;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      say('  [تخطّي] متصفح Chromium غير منزّل على هذا الجهاز — تخطّي فحص التخطيط الحقيقي');
      return { skipped: true, reason: 'no_browser' };
    }
    throw err;
  }
  const errors = [];
  const measured = [];

  try {
    /* ── الحالات الثلاث: مالك · مشاهدة فقط · زائر ── */
    const siteUsers = require('../src/web/siteUsers');
    siteUsers.recordLogin({ id: VIEW_ID, username: 'viewer', globalName: 'مشاهدة فقط' }, { guilds: 1 });
    siteUsers.grant(VIEW_ID, { by: OWNER_ID });
    const st = siteUsers.setStatus(VIEW_ID, 'viewonly', { reason: 'اختبار التخطيط' });
    assert.ok(st.ok, `تعيين «مشاهدة فقط» فشل: ${st.error}`);

    for (const who of ['owner', 'viewonly', 'guest']) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const sidOf = who === 'owner' ? sid : who === 'viewonly' ? sidView : null;
      if (sidOf) {
        await context.addCookies([
          { name: 'neverland.sid', value: signCookieValue(sidOf, process.env.SESSION_SECRET), domain: '127.0.0.1', path: '/' },
        ]);
      }
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(`${who}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') pageErrors.push(`${who} console: ${m.text()}`);
      });

      await page.goto(`${base}/dashboard/${demoGuild}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1200);

      const info = await page.evaluate(() => {
        const box = (sel) => {
          const n = document.querySelector(sel);
          if (!n) return null;
          const r = n.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const shell = document.querySelector('.d-shell');
        const title = document.querySelector('.d-page-title');
        return {
          sheets: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href')),
          shellDisplay: shell ? getComputedStyle(shell).display : null,
          side: box('.d-side'),
          main: box('.d-main'),
          content: box('#d-content'),
          contentChildren: document.getElementById('d-content')?.children.length ?? 0,
          title: title ? title.textContent.trim() : null,
          navCount: document.querySelectorAll('.d-nav-item').length,
          viewportH: window.innerHeight,
          viewportW: window.innerWidth,
        };
      });

      /* ١) ملف التنسيق مربوط فعلًا */
      assert.ok(
        info.sheets.some((h) => String(h).includes('dash.css')),
        `[${who}] ملف dash.css غير مربوط — اللوحة تظهر مشلولة بلا تنسيق`,
      );
      /* ٢) التخطيط: شبكة/صفّ (القائمة بجانب المحتوى) */
      assert.ok(
        ['grid', 'flex'].includes(info.shellDisplay),
        `[${who}] تخطيط اللوحة منهار (وجد: ${info.shellDisplay}) — المتوقع شبكة/صفّ`,
      );
      assert.ok(info.side && info.main, `[${who}] عناصر التخطيط ناقصة`);
      assert.ok(
        Math.abs(info.side.y - info.main.y) < 80 && info.main.x !== info.side.x,
        `[${who}] القائمة والمحتوى فوق بعضهما بدل ما يكونا جنبًا إلى جنب (القائمة y=${info.side.y} · المحتوى y=${info.main.y})`,
      );
      /* ٣) المحتوى ظاهر: موجود وعلى الشاشة وبداخله عناصر */
      assert.ok(info.contentChildren > 0, `[${who}] منطقة المحتوى فارغة`);
      assert.ok(info.content.y < info.viewportH, `[${who}] المحتوى تحت الشاشة (y=${info.content.y} > ${info.viewportH})`);
      /* ٤) العنوان نظيف */
      assert.ok(info.title && !info.title.includes('undefined'), `[${who}] عنوان القسم فيه «undefined»: ${info.title}`);
      /* ٥) الأقسام ظاهرة + قسم المالك لا يظهر لغير المالك */
      /* ٢٠ قسمًا للجميع (منها «اختصارات الأوامر» · «ردود أوامر» · «روم الأوامر» · «مكتبة الأوامر» · «سجل النشاط»)
         وقسمان خاصّان بالمالك: «حماية الموقع» و«أعضاء الموقع» */
      assert.ok(info.navCount >= 20, `[${who}] عدد أقسام القائمة ${info.navCount}`);
      if (who === 'owner') {
        assert.ok(info.navCount >= 22, `[المالك] عدد الأقسام ${info.navCount} — ينقصه قسمان خاصّان بالمالك`);
      } else {
        assert.ok(info.navCount <= 20, `[${who}] يرى أقسام المالك! (${info.navCount})`);
      }
      /* ٦) شريط القراءة فقط لا يكسر الشبكة */
      if (who !== 'owner') {
        const banner = await page.evaluate(() => {
          const n = document.querySelector('.d-shell > .d-readonly-note');
          if (!n) return null;
          const r = n.getBoundingClientRect();
          const shell = document.querySelector('.d-shell').getBoundingClientRect();
          return { w: Math.round(r.width), shellW: Math.round(shell.width) };
        });
        assert.ok(banner, `[${who}] شريط «قراءة فقط» غير ظاهر`);
        assert.ok(
          banner.w > banner.shellW * 0.9,
          `[${who}] شريط «قراءة فقط» يكسر الشبكة (عرضه ${banner.w} من ${banner.shellW})`,
        );
      }

      measured.push({ who, ...info });
      if (pageErrors.length) errors.push(...pageErrors);

      if (SHOT) {
        await page.screenshot({ path: `${SHOT_PATH.replace(/\.png$/, '')}-${who}.png`, fullPage: false });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    webGuilds.canAccessGuild = prevAccess;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.strictEqual(errors.length, 0, `أخطاء في المتصفح: ${errors.slice(0, 3).join(' · ')}`);

  say(
    `  [تم] التخطيط الحقيقي: dash.css مربوط · القائمة بجانب المحتوى · المحتوى ظاهر · بلا «undefined» ` +
      `(المالك ${measured[0].navCount} قسم · مشاهدة فقط ${measured[1].navCount} · الزائر ${measured[2].navCount})`,
  );
  if (SHOT) say(`  [صورة] ${SHOT_PATH}`);
  return { skipped: false, measured };
}

module.exports = { run };

if (require.main === module) {
  console.log('\n[اختبار] تخطيط لوحة التحكم بمتصفح حقيقي\n');
  run()
    .then(() => {
      console.log('\n🎉 تخطيط اللوحة سليم في المتصفح\n');
      /* نقفل العملية بنفسنا: بعض مسارات التخطّي (بلا متصفح) تترك مقبضًا مفتوحًا */
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
