'use strict';

/**
 * tests/docs-check.js
 * -------------------------------------------------------------
 * فحص سلامة التوثيق: يمنع نوعين من الانحدار وقعا فعلًا في هذا المستودع
 *
 *   ١) روابط نسبية مكسورة — never-land/README-جذر-المستودع.md كان نسخة من
 *      README الجذر، فكانت روابطه العشرة كلها تشير إلى مسارات غير موجودة.
 *   ٢) أرقام قديمة — التوثيق كان يقول 27 أمرًا و13 قسمًا و20 اختبارًا
 *      بينما الكود فيه 30 و22 و56.
 *
 * الأرقام تُقاس من الكود مباشرة، فلا تُكتب يدويًا في مكانين.
 *
 * التشغيل:  node tests/docs-check.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ✓ ${label}`);
};

/** كل ملفات Markdown المتتبَّعة (بلا node_modules) */
function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

/* ==================== ١) الروابط النسبية ==================== */
function checkLinks() {
  console.log('١) الروابط النسبية في ملفات Markdown');
  const files = markdownFiles(REPO);
  assert.ok(files.length >= 4, `عدد ملفات Markdown مريب: ${files.length}`);

  const broken = [];
  let checked = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#|data:)/i.test(target)) continue;
      checked += 1;
      const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(REPO, file)} → ${target}`);
      }
    }
  }
  assert.deepStrictEqual(broken, [], `روابط نسبية مكسورة:\n    ${broken.join('\n    ')}`);
  ok(`${checked} رابطًا نسبيًا في ${files.length} ملفات — كلها صالحة`);
}

/* ==================== ٢) الأرقام مقابل الكود ==================== */
function checkNumbers() {
  console.log('٢) أرقام التوثيق مطابقة للكود');

  process.env.DATABASE_PATH = path.join(require('node:os').tmpdir(), `nl-docs-${Date.now()}.db`);
  const catalog = require('../src/data/commandCatalog');
  const logging = require('../src/systems/logging');

  const commands = Object.keys(catalog.COMMANDS).length;
  const logEvents = Object.keys(logging.EVENT_META).length;
  const systems = fs.readdirSync(path.join(ROOT, 'src', 'systems')).filter((f) => f.endsWith('.js')).length;

  /* أحداث ديسكورد: نقيسها من المحمّل نفسه لا بالعدّ اليدوي،
     لأن كل ملف قد يُصدّر حدثًا واحدًا أو مصفوفة أحداث. */
  const registered = [];
  const fakeClient = { on: (n) => registered.push(n), once: (n) => registered.push(n), errorCount: 0 };
  const { loadEvents } = require('../src/handlers/events');
  const discordEvents = loadEvents(fakeClient).loaded;
  assert.deepStrictEqual(
    loadEvents({ on() {}, once() {}, errorCount: 0 }).problems || [],
    [],
    'محمّل الأحداث رجّع مشاكل — القياس غير موثوق',
  );

  /* أقسام اللوحة: نعدّ مفاتيح SECTIONS على العمق الأول فقط */
  const app = fs.readFileSync(path.join(ROOT, 'src', 'web', 'public', 'app.js'), 'utf8');
  const start = app.indexOf('const SECTIONS = {');
  assert.ok(start > -1, 'ما لقيتش const SECTIONS في app.js');
  let depth = 0;
  let sections = 0;
  for (let i = start + 'const SECTIONS = '.length; i < app.length; i += 1) {
    const ch = app[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
    } else if (depth === 1 && /[A-Za-z0-9_-]/.test(ch)) {
      /* بداية مفتاح على العمق الأول — نتأكد أنه يتبعه «: {» */
      const keyMatch = /^([A-Za-z0-9_-]+)\s*:\s*\{/.exec(app.slice(i));
      if (keyMatch) {
        sections += 1;
        i += keyMatch[0].length - 1;
        depth += 1;
      } else {
        while (i < app.length && !/[\s,]/.test(app[i])) i += 1;
      }
    }
  }

  /* عدد الاختبارات: كل console.log('[اختبار] …') في smoke.js */
  const smoke = fs.readFileSync(path.join(ROOT, 'tests', 'smoke.js'), 'utf8');
  const tests = (smoke.match(/console\.log\('\[اختبار\]/g) || []).length;
  assert.ok(tests > 40, `عدد الاختبارات المقروء من smoke.js مريب: ${tests}`);

  const measured = { commands, logEvents, discordEvents, systems, sections, tests };
  console.log(
    `   مقاس من الكود: ${commands} أمرًا · ${discordEvents} حدث ديسكورد · ${logEvents} حدث سجل · ` +
      `${systems} نظامًا · ${sections} قسمًا · ${tests} اختبارًا`,
  );

  /*
   * كل ادّعاء مربوط بسياقه: «أحداث ديسكورد» غير «أحداث السجل»، والخلط بينهما
   * يعطي إنذارات كاذبة. لذلك كل نمط يحدّد المعنى الذي يقصده صراحةً.
   */
  const claims = [
    { re: /(\d+)\s+أمر/g, key: 'commands', label: 'أوامر' },
    { re: /الأحداث\s*\((\d+)\s+حدثًا?\)/g, key: 'discordEvents', label: 'أحداث ديسكورد' },
    { re: /←\s*(\d+)\s+حدث:/g, key: 'discordEvents', label: 'أحداث ديسكورد' },
    { re: /السجلات\s*\((\d+)\s+حدثًا/g, key: 'logEvents', label: 'أحداث سجل' },
    { re: /(\d+)\s+حدثًا في \d+ مجموعات/g, key: 'logEvents', label: 'أحداث سجل' },
    { re: /(\d+)\s+حدث سجل/g, key: 'logEvents', label: 'أحداث سجل' },
    { re: /بـ?\s?\**(\d+)\s+قسمًا/g, key: 'sections', label: 'أقسام اللوحة' },
    { re: /\((\d+)\s+اختبارًا\)/g, key: 'tests', label: 'اختبارات' },
    { re: /(\d+)\s+نظامًا/g, key: 'systems', label: 'أنظمة' },
  ];

  const mismatches = [];
  let checkedClaims = 0;
  for (const file of markdownFiles(REPO)) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const { re, key, label } of claims) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        checkedClaims += 1;
        const said = Number(m[1]);
        if (said !== measured[key]) {
          mismatches.push(`${rel}: يقول ${said} ${label} بينما الكود فيه ${measured[key]}`);
        }
      }
    }
  }
  assert.ok(checkedClaims > 10, `عدد الادّعاءات المفحوصة قليل بشكل مريب: ${checkedClaims}`);
  assert.deepStrictEqual(mismatches, [], `أرقام توثيق قديمة:\n    ${mismatches.join('\n    ')}`);
  ok(`${checkedClaims} ادّعاءً رقميًا في التوثيق — كلها مطابقة للقياس`);

  /* التأكد أن README الجذر يذكر الأرقام الأساسية صراحةً (وإلا الفحص يمرّ فارغًا) */
  const rootReadme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  for (const key of ['commands', 'sections', 'tests', 'logEvents']) {
    assert.ok(
      rootReadme.includes(String(measured[key])),
      `README ما كيتحدثش عن ${key} (${measured[key]})`,
    );
  }
  ok('README يذكر الأرقام الأساسية صراحةً (الفحص ليس فارغًا)');
}

checkLinks();
checkNumbers();
console.log(`\n📚 التوثيق سليم (${passed} مجموعة)`);
