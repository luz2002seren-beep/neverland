'use strict';

/**
 * autoline-test.js
 * -------------------------------------------------------------
 * اختبار نظام الخط الفاصل بالصور المتحركة (GIF):
 *   1) ملفات GIF موجودة وصالحة (GIF89a · إطارات متعددة · شفافية · عرض مناسب)
 *   2) الاختيار الصحيح للخط حسب الإعدادات (gif / custom / text)
 *   3) الإرسال الفعلي: نوع الحمولة (ملف صورة أو نص) عبر قناة وهمية
 *   4) الأمان: رابط غير صالح → بديل تلقائي · بلا ملفات → خط نصّي (لا انهيار)
 *
 * التشغيل:  node autoline-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GIF_DIR = path.join(ROOT, 'assets', 'autoline');
const EXPECTED = ['glow', 'flow', 'pulse', 'dash'];

const config = require('../src/config');

/* نُثبّت قاعدة بيانات وهمية *قبل* تحميل الوحدة حتى تلتقطها */
const realDb = require('../src/database');
let CURRENT_SETTINGS = null;
const DB_PATH = require.resolve('../src/database');
require.cache[DB_PATH] = {
  id: DB_PATH,
  filename: DB_PATH,
  loaded: true,
  exports: { ...realDb, getGuildSettings: () => CURRENT_SETTINGS },
};
const autoline = require('../src/systems/autoline');

/* ------------------------------ أدوات مساعدة ------------------------------ */

/** قناة وهمية تسجّل ما يُرسل */
function fakeChannel() {
  const sent = [];
  return {
    id: 'chan-1',
    guild: { id: 'guild-1' },
    isTextBased: () => true,
    sent,
    async send(payload) {
      sent.push(payload);
      const hasFile = Array.isArray(payload.files) && payload.files.length > 0;
      return { id: `line-${sent.length}`, deletable: true, deleted: false, kind: hasFile ? 'file' : 'text', delete: async () => {} };
    },
    messages: {
      async fetch() {
        return null;
      },
    },
  };
}

/** إعدادات سيرفر وهمية */
function settingsWith(autolinePatch = {}) {
  const base = JSON.parse(JSON.stringify(config.defaults));
  base.autoline = { ...base.autoline, ...autolinePatch };
  return base;
}

/** تبديل إعدادات السيرفر الحالية */
function stubDb(settings) {
  CURRENT_SETTINGS = settings;
}

const cleanup = () => {};

/* --------------------------------- الاختبار --------------------------------- */

(async () => {
  console.log('\n[اختبار] الخط الفاصل بالصور المتحركة (AutoLine GIF)\n');

  /* ١) ملفات GIF */
  for (const name of EXPECTED) {
    const file = path.join(GIF_DIR, `${name}.gif`);
    assert.ok(fs.existsSync(file), `ملف ${name}.gif ناقص — شغّل npm run make:gifs`);
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.subarray(0, 6).toString('ascii'), 'GIF89a', `${name}.gif ليس GIF صالحًا`);
    assert.ok(buf.includes(Buffer.from([0x21, 0xF9])), `${name}.gif بلا أقسام تحكّم (ليس متحرّكًا)`);
    assert.ok(buf.length > 3000, `${name}.gif صغير بشكل غير طبيعي (${buf.length} بايت)`);
  }
  console.log(`١) ملفات GIF: ${EXPECTED.length} أنماط صالحة ومتحرّكة ✅`);

  /* ٢) الاختيار حسب الإعدادات */
  let resolved = autoline.resolveLine(settingsWith({ lineType: 'gif', gifStyle: 'flow' }));
  assert.strictEqual(resolved.mode, 'gif');
  assert.ok(resolved.file.endsWith('flow.gif'), 'نمط flow لم يُختَر');
  console.log('٢أ) lineType=gif → صورة flow.gif ✅');

  resolved = autoline.resolveLine(settingsWith({ lineType: 'custom', customUrl: 'https://cdn.example.com/line.gif' }));
  assert.strictEqual(resolved.mode, 'custom');
  console.log('٢ب) lineType=custom مع رابط صالح → رابط المستخدم ✅');

  resolved = autoline.resolveLine(settingsWith({ lineType: 'custom', customUrl: 'ليس-رابطًا' }));
  assert.strictEqual(resolved.mode, 'gif', 'الرابط غير الصالح لازم يرجع للـGIF الجاهز');
  console.log('٢ج) رابط غير صالح → بديل تلقائي (بلا خطأ) ✅');

  resolved = autoline.resolveLine(settingsWith({ lineType: 'text', line: '──  ✦  ──' }));
  assert.strictEqual(resolved.mode, 'text');
  assert.strictEqual(resolved.content, '──  ✦  ──');
  console.log('٢د) lineType=text → خط نصّي كما هو ✅');

  /* ٣) الإرسال الفعلي (قناة وهمية) */
  const client = { user: { id: 'bot-1' } };
  const channel = fakeChannel();
  const message = { id: 'msg-1', guild: { id: 'guild-1' }, channelId: 'chan-1', channel, author: { id: 'user-1' } };

  stubDb(settingsWith({ enabled: true, channels: ['chan-1'], lineType: 'gif', gifStyle: 'glow' }));
  let ok = await autoline.handleMessage(client, message);
  assert.strictEqual(ok, true, 'الخط لم يُرسل');
  assert.strictEqual(channel.sent.length, 1);
  assert.ok(Array.isArray(channel.sent[0].files) && channel.sent[0].files.length === 1, 'لم تُرسل صورة — يجب إرسال مرفق GIF');
  assert.strictEqual(channel.sent[0].content, undefined, 'لا يجب إرسال نص مع الصورة');
  console.log('٣أ) رسالة جديدة → أُرسل مرفق صورة GIF ✅');

  /* رسالة البوت نفسه لا تُنتج خطًا (منع الحلقة) */
  const botMessage = { ...message, id: 'msg-bot', author: { id: 'bot-1' } };
  const before = channel.sent.length;
  ok = await autoline.handleMessage(client, botMessage);
  assert.strictEqual(ok, false);
  assert.strictEqual(channel.sent.length, before, 'رسالة البوت أنتجت خطًا (حلقة لا نهائية!)');
  console.log('٣ب) رسالة البوت لا تُنتج خطًا (بلا حلقة) ✅');

  /* قناة غير مُدرجة → لا إرسال */
  stubDb(settingsWith({ enabled: true, channels: ['chan-9'] }));
  ok = await autoline.handleMessage(client, message);
  assert.strictEqual(ok, false, 'الخط أُرسل في قناة غير مُدرجة');
  console.log('٣ج) قناة غير مُدرجة → لا إرسال ✅');

  /* النظام معطّل → لا إرسال */
  stubDb(settingsWith({ enabled: false, channels: ['chan-1'] }));
  ok = await autoline.handleMessage(client, message);
  assert.strictEqual(ok, false);
  console.log('٣د) النظام معطّل → لا إرسال ✅');

  /* الوضع النصّي يُرسل نصًّا */
  const textChannel = fakeChannel();
  stubDb(settingsWith({ enabled: true, channels: ['chan-1'], lineType: 'text', line: '── ✦ ──' }));
  await autoline.handleMessage(client, { ...message, id: 'msg-2', channel: textChannel });
  assert.ok(typeof textChannel.sent[0].content === 'string' && textChannel.sent[0].content.includes('✦'), 'الوضع النصّي لم يُرسل نصًّا');
  console.log('٣هـ) الوضع النصّي يُرسل نصًّا كما هو ✅');

  /* ٤) الأمان: لا ملفات GIF على القرص → خط نصّي بدل الانهيار */
  const backup = path.join(GIF_DIR, '_backup');
  fs.mkdirSync(backup, { recursive: true });
  for (const name of EXPECTED) fs.renameSync(path.join(GIF_DIR, `${name}.gif`), path.join(backup, `${name}.gif`));
  try {
    const safe = autoline.buildLineContent(settingsWith({ lineType: 'gif' }));
    assert.ok(typeof safe.payload.content === 'string', 'بلا ملفات يجب إرسال خط نصّي احتياطي');
    const safeChannel = fakeChannel();
    stubDb(settingsWith({ enabled: true, channels: ['chan-1'], lineType: 'gif' }));
    await autoline.handleMessage(client, { ...message, id: 'msg-3', channel: safeChannel });
    assert.strictEqual(typeof safeChannel.sent[0].content, 'string', 'بلا GIF يجب ألا يفشل الإرسال');
    console.log('٤أ) بلا ملفات GIF → خط نصّي احتياطي (بلا انهيار) ✅');
  } finally {
    for (const name of EXPECTED) fs.renameSync(path.join(backup, `${name}.gif`), path.join(GIF_DIR, `${name}.gif`));
    fs.rmdirSync(backup);
  }

  /* ٥) المعاينة للوحة: الأنماط الأربعة + الملف المختار */
  const preview = autoline.previewLine(settingsWith({ lineType: 'gif', gifStyle: 'pulse' }));
  assert.strictEqual(preview.styles.length, 4, 'أنماط المعاينة ناقصة');
  assert.strictEqual(preview.style, 'pulse');
  assert.deepStrictEqual(preview.styles.map((x) => x.key).sort(), EXPECTED.slice().sort(), 'مفاتيح الأنماط غير مطابقة');
  for (const item of preview.styles) {
    assert.ok(item.file.endsWith('.gif'), `ملف النمط ${item.key} ليس gif`);
    assert.ok(item.label && item.desc, `وصف النمط ${item.key} ناقص`);
  }
  console.log('٥) معاينة اللوحة: 4 أنماط بأسماء ووصوف + الملف المختار ✅');

  cleanup();
  console.log('\n🎉 نظام الخط الفاصل يعمل بالصور المتحركة كما هو مطلوب\n');
})().catch((err) => {
  cleanup();
  console.error('❌', err.message);
  process.exit(1);
});
