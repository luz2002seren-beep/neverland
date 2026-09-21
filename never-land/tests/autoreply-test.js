'use strict';

/**
 * autoreply-test.js
 * -------------------------------------------------------------
 * اختبار الردود التلقائية (بلا ديسكورد حقيقي):
 *
 *   ١) المطابقة: تحتوي · مطابقة تمامًا · تبدأ بـ — ويتجاهل التشكيل والهمزات
 *   ٢) أكثر من كلمة مفتاحية للقاعدة الواحدة
 *   ٣) المتغيّرات: {user} {name} {server} {channel}
 *   ٤) أكثر من صيغة رد (|) → يختار البوت واحدة
 *   ٥) النطاق: كل الرومات افتراضيًا · أو قناة محدّدة
 *   ٦) الكولداون: ما يرد مرتين بسرعة على نفس العضو
 *   ٧) الحمايات: بلا رد على البوتات · بلا رد لو النظام معطّل · بلا رد لو ما في مطابقة
 *   ٨) قاعدة واحدة ترد فقط (الأولى المطابقة) — ولا تعطّل خبرة العضو
 *
 * التشغيل:  node autoreply-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const config = require('../src/config');
const arabicText = require('../src/lib/arabicText');

/* ------------------------- قاعدة بيانات وهمية بالذاكرة ------------------------- */

let settings = null;

const mockDb = {
  getGuildSettings: () => settings,
  updateGuildSettings: () => settings,
};

const dbPath = require.resolve('../src/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDb };
const autoreply = require('../src/systems/autoreply');

const GUILD = 'guild-test';
const CHAN_A = 'chan-a';
const CHAN_B = 'chan-b';

function settingsFor(patch = {}) {
  const base = JSON.parse(JSON.stringify(config.defaults.autoReply));
  settings = { autoReply: { ...base, ...patch } };
  return settings.autoReply;
}

function fakeMessage(content, { authorId = 'member-1', bot = false, channelId = CHAN_A, name = 'أحمد' } = {}) {
  const sent = [];
  const message = {
    content,
    channelId,
    guild: { id: GUILD, name: 'Never Land' },
    member: { id: authorId, displayName: name, username: `user${authorId}` },
    author: { id: authorId, bot, displayName: name, username: `user${authorId}` },
    channel: {
      id: channelId,
      isTextBased: () => true,
      send: async (payload) => {
        const msg = { ...payload, deleted: false, delete: async () => { msg.deleted = true; } };
        sent.push(msg);
        return msg;
      },
    },
    reply: async (payload) => {
      const msg = { ...payload, deleted: false, delete: async () => { msg.deleted = true; } };
      sent.push(msg);
      return msg;
    },
  };
  return { message, sent };
}

const client = { user: { id: 'bot-1' } };

/* --------------------------------- الاختبار --------------------------------- */

(async () => {
  console.log('\n[اختبار] الردود التلقائية: كلمات مفتاحية · متغيّرات · نطاق · كولداون\n');

  /* ١) مباني التطبيع العربي */
  assert.strictEqual(arabicText.normalizeArabic('مَرْحَبًا'), arabicText.normalizeArabic('مرحبا'), 'التشكيل ما انشال');
  assert.strictEqual(arabicText.normalizeArabic('أهلاً'), arabicText.normalizeArabic('اهلا'), 'الهمزات ما توحّدت');
  assert.strictEqual(arabicText.normalizeArabic('تحيّة'), arabicText.normalizeArabic('تحيه'), 'التاء المربوطة ما توحّدت');

  /* ٢) المطابقة: تحتوي · تمامًا · تبدأ */
  const contains = { triggers: ['مرحبا'], match: 'contains', reply: 'x' };
  assert.ok(autoreply.matchRule(contains, 'يا شباب مرحبا فيكم'), 'مطابقة «تحتوي» فشلت');
  assert.ok(autoreply.matchRule(contains, 'مرحبا'), 'مطابقة كلمة واحدة فشلت');
  assert.ok(!autoreply.matchRule(contains, 'بيحب التعاون'), 'مطابقة خاطئة (نص فيه الحروف بس مش الكلمة)');
  /* كلمة كاملة: الكلمة الملتصقة داخل كلمة أطول ما تُحسب */
  assert.ok(!autoreply.matchRule(contains, 'هياهاياهايي'), '«هاي» انحسبت داخل كلمة أطول');
  assert.ok(!autoreply.matchRule(contains, 'مرحبااااا'), 'كلمة ملتصقة انحسبت مطابقة');
  assert.ok(autoreply.matchRule(contains, 'يا جماعة مرحبا فيكم'), 'الكلمة بوسط الجملة ما اشتغلت');
  const exact = { triggers: ['help'], match: 'exact', reply: 'x' };
  assert.ok(autoreply.matchRule(exact, 'help'), 'مطابقة تامة فشلت');
  assert.ok(!autoreply.matchRule(exact, 'help me please'), 'مطابقة تامة قبلت نصًا زائدًا');
  const starts = { triggers: ['تذكرة'], match: 'starts', reply: 'x' };
  assert.ok(autoreply.matchRule(starts, 'تذكرة جديدة بليز'), 'مطابقة «تبدأ بـ» فشلت');
  assert.ok(!autoreply.matchRule(starts, 'بدي تذكرة'), '«تبدأ بـ» قبلت الكلمة في الوسط');

  /* ٣) أكثر من كلمة للقاعدة + التشكيل */
  const multi = { triggers: ['مرحبا', 'هلا', 'السلام عليكم'], match: 'contains', reply: 'x' };
  assert.ok(autoreply.matchRule(multi, 'هلا والله'), 'كلمة ثانية ما اشتغلت');
  assert.ok(autoreply.matchRule(multi, 'السلام عليكم ورحمة الله'), 'العبارة المركّبة ما اشتغلت');
  assert.ok(autoreply.matchRule(multi, 'مَرْحَبا يا جماعة'), 'التشكيل منع المطابقة');
  assert.deepStrictEqual(autoreply.ruleTriggers({ triggers: 'a، b, c' }), ['a', 'b', 'c'], 'فصل الكلمات ما اشتغل');

  /* ٤) المتغيّرات */
  const { message } = fakeMessage('مرحبا');
  const filled = autoreply.applyVariables('أهلًا {user} — {name} من {server} في {channel}', { message });
  assert.ok(filled.includes('<@member-1>'), 'متغيّر {user} ما اشتغل');
  assert.ok(filled.includes('أحمد'), 'متغيّر {name} ما اشتغل');
  assert.ok(filled.includes('Never Land'), 'متغيّر {server} ما اشتغل');
  assert.ok(filled.includes(`<#${CHAN_A}>`), 'متغيّر {channel} ما اشتغل');

  /* ٥) صيغ الرد المتعددة */
  assert.strictEqual(autoreply.pickReply('رد واحد'), 'رد واحد');
  assert.strictEqual(autoreply.pickReply('أول | ثاني', () => 0), 'أول');
  assert.strictEqual(autoreply.pickReply('أول | ثاني', () => 0.99), 'ثاني');
  assert.strictEqual(autoreply.pickReply('', () => 0), '');

  /* ٦) رد فعلي: كل الرومات */
  autoreply.clearCooldowns();
  settingsFor({
    enabled: true,
    anywhereInServer: true,
    cooldownSeconds: 15,
    rules: [
      { id: 'r1', triggers: ['مرحبا', 'هلا'], match: 'contains', reply: 'أهلًا {user} 👋', channels: [], cooldownSeconds: 0, enabled: true },
      { id: 'r2', triggers: ['مساعدة'], match: 'contains', reply: 'تواصل مع الإدارة', channels: [], cooldownSeconds: 0, enabled: true },
    ],
  });

  const first = fakeMessage('مرحبا شباب');
  const res1 = await autoreply.handleMessage(client, first.message);
  assert.strictEqual(res1.replied, true, 'ما رد على الرسالة');
  assert.strictEqual(first.sent.length, 1, 'عدد الردود خطأ');
  assert.ok(first.sent[0].content.includes('<@member-1>'), 'الرد ما عوّض {user}');
  assert.strictEqual(first.sent[0].allowedMentions.repliedUser, false, 'الرد يعمل منشن افتراضيًا (لازم يكون اختياري)');

  /* ٧) في أي روم — حتى روم ثاني */
  const otherRoom = fakeMessage('هلا', { channelId: CHAN_B });
  const res2 = await autoreply.handleMessage(client, otherRoom.message);
  assert.strictEqual(res2.replied, true, 'ما رد في روم ثاني (المطلوب: كل الرومات)');

  /* ٨) بلا مطابقة → بلا رد */
  const noMatch = fakeMessage('كلام عادي جدا');
  const res3 = await autoreply.handleMessage(client, noMatch.message);
  assert.strictEqual(res3.replied, false, 'رد بدون كلمة مفتاحية');
  assert.strictEqual(noMatch.sent.length, 0, 'أرسل رد بدون مطابقة');

  /* ٩) قاعدة واحدة فقط ترد (الأولى) */
  settingsFor({
    enabled: true,
    anywhereInServer: true,
    cooldownSeconds: 0,
    rules: [
      { id: 'r1', triggers: ['مرحبا'], match: 'contains', reply: 'الرد الأول', channels: [], cooldownSeconds: 0 },
      { id: 'r2', triggers: ['مرحبا'], match: 'contains', reply: 'الرد الثاني', channels: [], cooldownSeconds: 0 },
    ],
  });
  autoreply.clearCooldowns();
  const both = fakeMessage('مرحبا');
  await autoreply.handleMessage(client, both.message);
  assert.strictEqual(both.sent.length, 1, 'أكثر من قاعدة ردّت على نفس الرسالة');
  assert.strictEqual(both.sent[0].content, 'الرد الأول', 'القاعدة الأولى ما كانت هي اللي ردّت');

  /* ١٠) النطاق: قناة محدّدة فقط */
  settingsFor({
    enabled: true,
    anywhereInServer: false,
    cooldownSeconds: 0,
    rules: [{ id: 'r1', triggers: ['مرحبا'], match: 'contains', reply: 'في روم الترحيب بس', channels: [CHAN_A], cooldownSeconds: 0 }],
  });
  autoreply.clearCooldowns();
  const inRoom = fakeMessage('مرحبا', { channelId: CHAN_A });
  assert.strictEqual((await autoreply.handleMessage(client, inRoom.message)).replied, true, 'ما رد في الروم المحدّد');
  const outRoom = fakeMessage('مرحبا', { channelId: CHAN_B });
  assert.strictEqual((await autoreply.handleMessage(client, outRoom.message)).replied, false, 'رد في روم غير مسموح');

  /* ١١) الكولداون */
  settingsFor({
    enabled: true,
    anywhereInServer: true,
    cooldownSeconds: 15,
    rules: [{ id: 'r1', triggers: ['مرحبا'], match: 'contains', reply: 'أهلًا', channels: [] }],
  });
  autoreply.clearCooldowns();
  const c1 = fakeMessage('مرحبا');
  const c2 = fakeMessage('مرحبا');
  assert.strictEqual((await autoreply.handleMessage(client, c1.message)).replied, true, 'الرد الأول ما اشتغل');
  const cooled = await autoreply.handleMessage(client, c2.message);
  assert.strictEqual(cooled.replied, false, 'رد مرتين بسرعة رغم الكولداون');
  assert.strictEqual(cooled.reason, 'cooldown', 'سبب المنع خطأ');
  /* عضو ثاني: الكولداون لكل عضو لحاله */
  const otherMember = fakeMessage('مرحبا', { authorId: 'member-9' });
  assert.strictEqual((await autoreply.handleMessage(client, otherMember.message)).replied, true, 'الكولداون منع عضوًا آخر بالخطأ');

  /* ١٢) الحمايات: البوتات · النظام معطّل · قاعدة معطّلة */
  settingsFor({
    enabled: true,
    anywhereInServer: true,
    cooldownSeconds: 0,
    rules: [{ id: 'r1', triggers: ['مرحبا'], match: 'contains', reply: 'أهلًا', channels: [] }],
  });
  const botMsg = fakeMessage('مرحبا', { authorId: 'bot-2', bot: true });
  assert.strictEqual((await autoreply.handleMessage(client, botMsg.message)).replied, false, 'رد على بوت');

  settingsFor({ enabled: false, rules: [{ id: 'r1', triggers: ['مرحبا'], match: 'contains', reply: 'أهلًا', channels: [] }] });
  const offMsg = fakeMessage('مرحبا');
  assert.strictEqual((await autoreply.handleMessage(client, offMsg.message)).replied, false, 'رد والنظام معطّل');

  settingsFor({ enabled: true, cooldownSeconds: 0, rules: [{ id: 'r1', triggers: ['مرحبا'], match: 'contains', reply: 'أهلًا', channels: [], enabled: false }] });
  const disabledRule = fakeMessage('مرحبا');
  assert.strictEqual((await autoreply.handleMessage(client, disabledRule.message)).replied, false, 'قاعدة معطّلة ردّت');

  /* ١٣) حذف الرد بعد مدة (+ صيغ متعددة) */
  settingsFor({
    enabled: true,
    cooldownSeconds: 0,
    rules: [{ id: 'r1', triggers: ['تنظيف'], match: 'contains', reply: 'رد مؤقت', channels: [], deleteAfterSeconds: 3600 }],
  });
  autoreply.clearCooldowns();
  const delMsg = fakeMessage('تنظيف');
  const delRes = await autoreply.handleMessage(client, delMsg.message);
  assert.strictEqual(delRes.replied, true, 'رد الحذف ما اشتغل');
  assert.strictEqual(typeof delMsg.sent[0].delete, 'function', 'الرد ما فيه إمكانية حذف');

  /* ١٤) معاينة (تُستخدم في /autoreply test) */
  const preview = autoreply.preview(GUILD, 'تنظيف بليز', CHAN_A);
  assert.strictEqual(preview.matched, true, 'المعاينة ما لقيت القاعدة');
  assert.ok(preview.triggers.includes('تنظيف'), 'المعاينة ما رجّعت الكلمات');

  /* ١٥) الافتراضيات */
  const defaults = config.defaults.autoReply;
  assert.strictEqual(defaults.enabled, true, 'النظام لازم يكون مفعّلًا افتراضيًا');
  assert.strictEqual(defaults.anywhereInServer, true, 'الرد لازم يشتغل في كل الرومات افتراضيًا');
  assert.ok(Array.isArray(defaults.rules), 'حقل القواعد ناقص');

  console.log('١) التطبيع العربي: تشكيل · همزات · تاء مربوطة ✅');
  console.log('٢) المطابقة: تحتوي · تمامًا · تبدأ بـ + أكثر من كلمة ✅');
  console.log('٣) المتغيّرات {user} {name} {server} {channel} + صيغ الرد المتعددة ✅');
  console.log('٤) كل الرومات افتراضيًا + حصر بقناة عند الحاجة ✅');
  console.log('٥) الكولداون لكل عضو + قاعدة واحدة ترد فقط ✅');
  console.log('٦) حمايات: بلا بوتات · بلا رد لو معطّل · بلا مطابقة = بلا رد ✅');

  console.log('\n🎉 الردود التلقائية تعمل كما هو مطلوب\n');
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
