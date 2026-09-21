'use strict';

/**
 * presence-test.js
 * -------------------------------------------------------------
 * فحص حالة البوت (Presence):
 *
 *   ١) الاسم الافتراضي 𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅 + النوع «بث مباشر» (بنفسجي) + رابط البث + الحالة متصل
 *   ٢) التطبيق على البوت: نوع الحالة المرسل لديسكورد = Streaming مع الرابط
 *   ٣) التعديل من الموقع يُطبَّق فورًا (بلا إعادة تشغيل) ويُحفظ في الإعدادات
 *   ٤) التصحيح الذكي: نوع/حالة غير معروفة ⇒ ترجع للقيم الصحيحة · رابط ناقص ⇒ رابط افتراضي
 *   ٥) فشل ديسكورد ⇒ رجوع تلقائي لحالة «يلعب» (ما يبقى البوت بلا حالة) + سبب واضح
 *   ٦) الربط: الإقلاع · مسار الموقع · التشخيص (/api/status) · قسم اللوحة
 *
 * التشغيل: node presence-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityType } = require('discord.js');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nl-pres-')), 'presence.db');
process.env.DEMO_MODE = 'true';

let checks = 0;
const ok = (msg) => {
  checks += 1;
  console.log(`  ✔ ${msg}`);
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const GUILD = '1542345715949506630';

/** بوت وهمي: يخزّن آخر حالة انطلبت منه — أو يفشل لو طلبنا */
function fakeClient({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    user: {
      setPresence(payload) {
        calls.push(payload);
        if (fail) throw new Error('Invalid URL');
      },
      presence: {
        status: 'online',
        activities: [{ name: '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', type: ActivityType.Streaming, url: 'https://www.twitch.tv/never_land' }],
      },
    },
  };
}

(async () => {
  const db = require('../src/database');
  const config = require('../src/config');
  const presence = require('../src/systems/presence');

  console.log('\n═══ ١) القيم الافتراضية: الاسم والنوع واللون ═══');
  {
    const name = config.bot.presence.name;
    assert.strictEqual(name, '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', 'اسم الحالة الافتراضي خطأ');
    /* نص الاسم نفسه (نفس حروف الاسم المطلوب من المدير) */
    assert.ok(name.startsWith('𝑵') && name.includes('𝑳'), 'الاسم لازم يكون بالخط المزخرف المطلوب');
    assert.strictEqual(config.bot.presence.type, 'streaming', 'النوع الافتراضي لازم «بث مباشر»');
    assert.strictEqual(config.bot.presence.status, 'online', 'الحالة الافتراضية لازم متصل');
    assert.ok(/^https:\/\//.test(config.bot.presence.url), 'رابط البث الافتراضي خطأ');

    const info = presence.describe();
    assert.strictEqual(info.purple, true, 'لون الحالة لازم بنفسجي (نوع بث مباشر)');
    assert.ok(info.typeLabel.includes('بنفسجي'), 'وصف النوع لازم يوضّح اللون البنفسجي');
    assert.strictEqual(presence.applied(fakeClient()).purple, true, 'فحص «الحالة المطبّقة» ما كشف البث');
    ok('الاسم 𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅 · النوع بث مباشر (بنفسجي) · متصل · رابط بث افتراضي');
  }

  console.log('\n═══ ٢) التطبيق على البوت: النوع Streamning + الرابط ═══');
  {
    const client = fakeClient();
    const result = presence.apply(client);
    assert.strictEqual(result.ok, true, 'التطبيق فشل');
    assert.strictEqual(client.calls.length, 1, 'ما انبعت طلب حالة واحد');
    const payload = client.calls[0];
    assert.strictEqual(payload.activities[0].name, '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', 'الاسم المرسل للبوت خطأ');
    assert.strictEqual(payload.activities[0].type, ActivityType.Streaming, 'النوع المرسل لازم Streaming (بث مباشر)');
    assert.strictEqual(payload.activities[0].url, config.bot.presence.url, 'رابط البث ما انمرّر — ديسكورد يرفض البث بلا رابط');
    assert.strictEqual(payload.status, 'online', 'حالة الاتصال خطأ');
    ok('البوت استلم حالة بث مباشر باسم 𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅 + الرابط + متصل');
  }

  console.log('\n═══ ٣) التعديل من الموقع يُطبَّق فورًا ويُحفظ ═══');
  {
    const client = fakeClient();
    const saved = presence.save(client, GUILD, { name: '𝑵𝑬𝑾 𝑵𝑨𝑴𝑬', type: 'watching', status: 'dnd' });
    assert.strictEqual(saved.ok, true, 'الحفظ فشل');
    assert.strictEqual(client.calls.length, 1, 'التعديل ما انطبّق فورًا');
    assert.strictEqual(client.calls[0].activities[0].name, '𝑵𝑬𝑾 𝑵𝑨𝑴𝑬');
    assert.strictEqual(client.calls[0].activities[0].type, ActivityType.Watching, 'النوع ما تحدّث');
    assert.strictEqual(client.calls[0].activities[0].url, undefined, 'نوع «يشاهد» ما يحتاج رابط');
    assert.strictEqual(client.calls[0].status, 'dnd', 'حالة الاتصال ما تحدّثت');

    const stored = db.getGuildSettings(GUILD).presence;
    assert.strictEqual(stored.name, '𝑵𝑬𝑾 𝑵𝑨𝑴𝑬', 'الحالة ما انحفظت في الإعدادات');
    assert.strictEqual(stored.type, 'watching', 'النوع ما انحفظ');
    assert.strictEqual(presence.current(GUILD).name, '𝑵𝑬𝑾 𝑵𝑨𝑴𝑬', 'الحالة المحفوظة ما تُقرأ');

    /* نرجّع القيم المطلوبة (بث مباشر + الاسم المزخرف) */
    const back = presence.save(fakeClient(), GUILD, { name: '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', type: 'streaming', status: 'online' });
    assert.strictEqual(back.presence.type, 'streaming');
    assert.strictEqual(back.presence.name, '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅');
    ok('الحفظ من الموقع يحدّث البوت لحظيًا + يُحفظ في إعدادات السيرفر');
  }

  console.log('\n═══ ٤) تصحيح القيم غير الصحيحة ═══');
  {
    const weird = presence.normalize({ name: '   ', type: 'nonsense', status: 'sleeping', url: '' });
    assert.strictEqual(weird.name, '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', 'الاسم الفاضي لازم يرجع للافتراضي');
    assert.strictEqual(weird.type, 'streaming', 'النوع المجهول لازم يرجع لبث مباشر');
    assert.strictEqual(weird.status, 'online', 'حالة الاتصال المجهولة لازم ترجع لمتصل');
    assert.ok(weird.url.startsWith('https://'), 'الرابط الفاضي لازم يرجع للافتراضي');
    const longName = presence.normalize({ name: 'ا'.repeat(300) });
    assert.ok(longName.name.length <= 128, 'الاسم الطويل لازم يُقصّ (حد ديسكورد)');
    assert.deepStrictEqual(presence.STATUSES, ['online', 'idle', 'dnd', 'invisible'], 'أنواع حالة الاتصال تغيّرت');
    ok('قيم غير معروفة/ناقصة تُصحّح تلقائيًا بلا أعطال');
  }

  console.log('\n═══ ٥) فشل ديسكورد ⇒ رجوع تلقائي (ما يبقى بلا حالة) ═══');
  {
    const client = fakeClient({ fail: true });
    const result = presence.apply(client, { name: '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', type: 'streaming' });
    assert.strictEqual(result.ok, false, 'الفشل لازم يظهر كنتيجة');
    assert.ok(result.reason.includes('Invalid URL'), 'السبب الحقيقي لازم يرجع');
    assert.strictEqual(client.calls.length, 2, 'لازم يحاول مرة ثانية بحالة عادية');
    assert.strictEqual(client.calls[1].activities[0].type, ActivityType.Playing, 'الرجوع لازم يكون حالة «يلعب»');
    assert.strictEqual(client.calls[1].activities[0].name, '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', 'الاسم يبقى نفسه بالرجوع');
    ok('لو ديسكورد رفض (رابط غلط مثلًا) ⇒ يرجع لحالة عادية + يرجّع السبب');
  }

  console.log('\n═══ ٦) الربط: الإقلاع · الموقع · التشخيص · اللوحة ═══');
  {
    const ready = read('src/events/ready.js');
    assert.ok(/require\('\.\.\/systems\/presence'\)/.test(ready) && ready.includes('presence.apply(client)'), 'الإقلاع ما يضبط الحالة من النظام');
    assert.ok(!ready.includes('name: \'NEVER LAND\'') && !ready.includes('name: "NEVER LAND"'), 'الاسم القديم NEVER LAND لسا موجود بكود الإقلاع');

    const api = read('src/web/routes/api.js');
    assert.ok(api.includes("router.post('/guilds/:guildId/presence'"), 'مسار تعديل الحالة ناقص من الموقع');
    assert.ok(api.includes('presence.applied(client)'), 'التشخيص ما يعرض الحالة اللي شافها ديسكورد');

    const app = read('src/web/public/app.js') + read('src/web/public/app-sections.js');
    for (const key of ["'presence.name'", "'presence.type'", "'presence.url'", "'presence.status'", '/presence`']) {
      assert.ok(app.includes(key), `اللوحة ينقصها ${key}`);
    }
    assert.ok(app.includes('بث مباشر (بنفسجي)'), 'خيار البث المباشر البنفسجي ناقص من اللوحة');
    assert.ok(read('src/web/public/dash.css').includes('.pres-dot.live'), 'تنسيق النقطة البنفسجية ناقص');

    assert.strictEqual(config.bot.presence.name === 'NEVER LAND', false, 'ما لازم يرجع الاسم القديم أبدًا');
    ok('الإقلاع يضبط الحالة · الموقع يعدّلها فورًا · التشخيص يعرض المطبّق · اللوحة فيها القسم والمعاينة');
  }

  console.log(`\n🎉 حالة البوت جاهزة: 𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅 (بث مباشر بنفسجي) — ${checks} فحصًا\n`);
})().catch((err) => {
  console.error('\n❌ فشل الاختبار:', err.message);
  process.exitCode = 1;
});
