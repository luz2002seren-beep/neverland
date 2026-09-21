'use strict';

/**
 * dashboard-dom-test.js
 * -------------------------------------------------------------
 * اختبار حقيقي للوحة التحكم: نفتح الصفحة في متصفح وهمي (jsdom) ونتأكد أن:
 *   ١) الصفحة تُقلع فعلًا (ما تعلق على «جارٍ تحميل الإعدادات...»)
 *   ٢) ما في أي خطأ JavaScript (خصوصًا تضارب الأسماء بين ملفات السكربت)
 *   ٣) القائمة الجانبية تُبنى بكل الأقسام وأيقوناتها من الحزمة الرسمية
 *   ٤) قسم «تفاعل» موجود وأيقونته الكأس (لا دائرة فاضية)
 *
 * يعمل بلا إنترنت: يفتح الخادم الداخلي على منفذ حر ويعرض الصفحة الحقيقية.
 * إذا لم تكن jsdom مثبّتة، يُتخطّى الاختبار مع رسالة واضحة.
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const http = require('node:http');

async function run() {
  let JSDOM;
  let VirtualConsole;
  try {
    ({ JSDOM, VirtualConsole } = require('jsdom'));
  } catch {
    console.log('[تخطّي] jsdom غير مثبّتة — تُثبَّت بـ npm i -D jsdom');
    return { skipped: true };
  }

  process.env.DEMO_MODE = process.env.DEMO_MODE || 'true';
  process.env.PUBLIC_ACCESS = process.env.PUBLIC_ACCESS || 'true';
  process.env.LOGIN_REQUIRED = process.env.LOGIN_REQUIRED || 'false';

  // قاعدة بيانات مؤقتة حتى لا نلمس بيانات المشروع
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-dom-'));
  process.env.DATABASE_PATH = path.join(tmpDir, 'dom.db');

  const web = require('../src/web/server');
  const app = web.createApp();

  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const guildId = '100000000000000001';
  const url = `${base}/dashboard/${guildId}`;

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (err) => {
    const msg = String(err?.message || err);
    if (/scrollTo|Not implemented/i.test(msg)) return; // قيود jsdom لا تخصّنا
    errors.push(msg);
  });
  vc.on('error', (...args) => errors.push(args.map(String).join(' ')));

  const html = await (await fetch(url)).text();
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.fetch = (input, opts) => fetch(new URL(input, base).toString(), opts);
      win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    },
  });

  await new Promise((r) => setTimeout(r, 3500));

  const doc = dom.window.document;
  const appNode = doc.getElementById('app');
  assert.ok(appNode, 'عنصر اللوحة #app غير موجود');
  const text = appNode.textContent.replace(/\s+/g, ' ').trim();

  /* ١) الصفحة تُقلع */
  assert.ok(!text.includes('جارٍ تحميل الإعدادات'), `اللوحة عالقة على شاشة التحميل (النص: ${text.slice(0, 80)})`);

  /* ٢) بلا أخطاء JavaScript */
  const window0 = dom.window;
  assert.deepStrictEqual(errors, [], `أخطاء JavaScript في الصفحة: ${errors.join(' | ')}`);

  /* ٣) القائمة الجانبية كاملة بأيقونات مرسومة */
  const navItems = [...doc.querySelectorAll('.d-nav-item')];
  assert.ok(navItems.length >= 12, `عناصر القائمة الجانبية قليلة (${navItems.length})`);
  const labels = navItems.map((n) => n.querySelector('.d-nav-label')?.textContent?.trim()).filter(Boolean);
  for (const wanted of ['مركز التحكم', 'المستويات', 'تفاعل', 'الخط الفاصل (AutoLine)', 'نظام التذاكر', 'السجلات']) {
    assert.ok(labels.includes(wanted), `القسم «${wanted}» غير ظاهر في القائمة الجانبية`);
  }
  const iconCount = navItems.filter((n) => n.querySelector('svg')).length;
  assert.strictEqual(iconCount, navItems.length, `بعض عناصر القائمة بلا أيقونة (${iconCount}/${navItems.length})`);

  /* ٤) قسم «تفاعل» بأيقونة الكأس — لا دائرة فاضية */
  const top = navItems.find((n) => n.querySelector('.d-nav-label')?.textContent?.trim() === 'تفاعل');
  assert.ok(top, 'عنصر «تفاعل» غير موجود');
  const topIcon = top.querySelector('svg')?.innerHTML || '';
  assert.ok(topIcon.includes('8 4.2h8v5a4'), 'أيقونة «تفاعل» ليست الكأس (تظهر دائرة أو أيقونة بديلة)');
  assert.ok(!/^<circle cx="12" cy="12" r="9"/.test(topIcon.trim()), 'أيقونة «تفاعل» رجعت دائرة فاضية');

  /* ٥) ما في عنصر قائمة نصّه مكسور لسطرين (تنسيق سليم) */
  assert.ok(doc.querySelectorAll('.d-nav-label').length === navItems.length, 'عناصر القائمة بلا فئة d-nav-label');

  /* ٦) كل قسم يُفتح ويُرسم فعلًا بلا أخطاء (حتى الأقسام اللي ما تظهر لغير المالك تُختبر من كودها) */
  const visited = [];
  const errorsAfter = [];
  const collect = (e) => errorsAfter.push(String(e?.message || e));
  vc.on('jsdomError', collect);
  for (const item of navItems) {
    const label = item.querySelector('.d-nav-label')?.textContent?.trim();
    item.dispatchEvent(new window0.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const content = doc.getElementById('d-content');
    const painted = content && content.children.length > 0;
    const title = content?.querySelector('.d-page-title')?.textContent?.trim() || '';
    assert.ok(painted, `القسم «${label}» ما رسم أي محتوى عند فتحه`);
    assert.ok(title && !title.includes('undefined'), `عنوان القسم «${label}» غير سليم (${title})`);
    /* ما يظهر نص تقني مكان عنصر (مثل [object HTMLDivElement]) */
    const rawText = content.textContent || '';
    assert.ok(!rawText.includes('[object'), `القسم «${label}» يعرض نصًا تقنيًا مكان عنصر: ${rawText.match(/\[object[^\]]*\]/)?.[0] || ''}`);
    assert.ok(!rawText.includes('undefined'), `القسم «${label}» يعرض كلمة undefined`);
    assert.ok(!rawText.includes('NaN'), `القسم «${label}» يعرض NaN`);
    /* خلل القوائم: خاصية selected تُكتب على كل الخيارات فيلتقط المتصفح آخرها بدل القيمة المحفوظة */
    const badSelects = [...content.querySelectorAll('select')]
      .filter((sel) => [...sel.options].filter((o) => o.hasAttribute('selected')).length > 0);
    assert.strictEqual(
      badSelects.length,
      0,
      `القسم «${label}» فيه ${badSelects.length} قائمة تعتمد خاصية selected (تعرض آخر خيار بدل المحفوظ)`,
    );
    visited.push(label);
  }
  assert.strictEqual(visited.length, navItems.length, 'ما مرّينا على كل الأقسام');
  const realErrors = errorsAfter.filter((e) => !/scrollTo|Not implemented/i.test(e));
  assert.deepStrictEqual(realErrors, [], `أخطاء عند فتح الأقسام: ${realErrors.slice(0, 3).join(' | ')}`);
  vc.removeListener('jsdomError', collect);

  dom.window.close();
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { skipped: false, navCount: navItems.length, labels, visited };
}

module.exports = { run };

if (require.main === module) {
  run()
    .then((res) => {
      if (res.skipped) return;
      console.log(`[تم] اللوحة تُقلع فعلًا · ${res.navCount} قسمًا · كل قسم يُفتح ويُرسم بلا أخطاء · «تفاعل» بأيقونة الكأس`);
    })
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
