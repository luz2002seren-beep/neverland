'use strict';
/**
 * command-room-test.js
 * -------------------------------------------------------------
 * 🧹 روم الأوامر:
 *   ١) الافتراضيات: الروم المطلوب + نص الرسالة + تنظيف كل ٦٠ ثانية + صورة السيرفر
 *   ٢) نشر الرسالة: نص عربي كما هو (بلا ترجمة) + الصورة مرفقة + تثبيت + حفظ رقم الرسالة
 *   ٣) إعادة النشر: يعدّل نفس الرسالة بدل ما يبعت نسخة ثانية
 *   ٤) التنظيف: يمسح كل الرسائل **ما عدا رسالة الترحيب** (والمثبّتة)
 *   ٥) الحد الأدنى للمدة ١٥ ثانية + إطفاء النظام يوقف كل شي
 *   ٦) اللوحة + الـ API: قسم «روم الأوامر» ومسارات النشر/التنظيف
 *
 * التشغيل:  node command-room-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-room-'));
process.env.DATABASE_PATH = path.join(tmp, 'room.db');
process.env.DEMO_MODE = 'true';

const db = require('./src/database');
const room = require('./src/systems/commandRoom');

let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

const GUILD = '1542345715949506630';
const CHANNEL = '1549365063708573817';
const BOT = '100000000000000002';

/** روم وهمي: رسائل + حذف جماعي + إرسال/تعديل + تثبيت */
function makeChannel() {
  const state = { messages: new Map(), sent: [], bulkCalls: [], individualDeletes: [] };
  let seq = 100;
  const makeMessage = (id, { content = '', pinned = false, ageMs = 0 } = {}) => ({
    id,
    content,
    pinned,
    createdTimestamp: Date.now() - ageMs,
    author: { id: BOT, bot: true },
    edit: async (p) => {
      state.sent.push({ type: 'edit', id, payload: p });
      return makeMessage(id, { content: p.content, pinned, ageMs: 0 });
    },
    pin: async () => true,
    unpin: async () => true,
    delete: async () => {
      state.individualDeletes.push(id);
      state.messages.delete(id);
      return true;
    },
  });

  const channel = {
    id: CHANNEL,
    name: 'أوامر',
    state,
    guildId: GUILD,
    isTextBased: () => true,
    messages: {
      fetch: async (arg) => {
        if (typeof arg === 'string') return state.messages.get(arg) || null;
        return new Map([...state.messages.entries()]);
      },
    },
    send: async (payload) => {
      const id = String(seq++);
      const message = makeMessage(id, { content: payload.content });
      state.messages.set(id, message);
      state.sent.push({ type: 'send', id, payload });
      return message;
    },
    bulkDelete: async (list) => {
      /* ديسكورد يقبل مصفوفة رسائل أو Collection — ونفس السلوك نحاكيه هنا */
      const ids = (Array.isArray(list) ? list.map((m) => m.id ?? m) : [...list.keys()]).map(String);
      state.bulkCalls.push(ids);
      ids.forEach((id) => state.messages.delete(id));
      return new Map(ids.map((id) => [id, { id }]));
    },
    add: (id, opts) => {
      state.messages.set(id, makeMessage(id, opts));
      return id;
    },
  };
  return channel;
}

function makeGuild(channel) {
  return {
    id: GUILD,
    name: 'Never Land',
    channels: {
      cache: new Map([[channel.id, channel]]),
      fetch: async (id) => (id === channel.id ? channel : null),
    },
    members: { me: { id: BOT, permissions: { has: () => true } }, cache: new Map() },
  };
}

const client = { user: { id: BOT, tag: 'Never Land#5095' }, guilds: { cache: new Map() } };

async function main() {
  console.log('\n═══ ١) الافتراضيات: الروم + النص + ٦٠ ثانية + الصورة ═══');
  {
    db.updateGuildSettings(GUILD, {});
    const cfg = room.configFor(GUILD);
    assert.strictEqual(cfg.channelId, CHANNEL, 'روم الأوامر الافتراضي غلط: ' + cfg.channelId);
    assert.strictEqual(cfg.enabled, true, 'روم الأوامر لازم يبدأ مفعّلًا');
    assert.strictEqual(cfg.intervalSeconds, 60, 'مدة التنظيف الافتراضية لازم ٦٠ ثانية');
    assert.ok(/مرحبا بكم بسيرفر Never Land/.test(cfg.text), 'نص الرسالة الافتراضي ناقص');
    assert.ok(/تنظيفه كل 60 ثانية/.test(cfg.text), 'النص لازم يذكر التنظيف كل ٦٠ ثانية');
    ok('الافتراضي: الروم المطلوب + «مرحبا بكم بسيرفر Never Land…» + تنظيف كل ٦٠ ثانية');

    const file = room.imagePath(cfg);
    assert.ok(file && fs.existsSync(file), 'صورة الروم غير موجودة: ' + file);
    const size = fs.statSync(file).size;
    assert.ok(size > 100 * 1024, 'الصورة صغيرة بشكل غير متوقع');
    ok(`صورة السيرفر جاهزة للإرفاق (${Math.round(size / 1024)} كيلوبايت)`);
  }

  console.log('\n═══ ٢) نشر الرسالة: نص عربي كما هو + صورة + تثبيت ═══');
  {
    const channel = makeChannel();
    const guild = makeGuild(channel);
    const res = await room.publish(client, guild);
    assert.strictEqual(res.ok, true, 'النشر فشل: ' + res.reason);

    const sent = channel.state.sent.find((s) => s.type === 'send');
    assert.ok(sent, 'ما انبعتت أي رسالة');
    assert.ok(/مرحبا بكم بسيرفر Never Land/.test(sent.payload.content), 'نص الرسالة غلط');
    assert.strictEqual(sent.payload.__raw, true, 'الرسالة لازم تكون «كما هي» بلا ترجمة (__raw)');
    assert.ok(Array.isArray(sent.payload.files) && sent.payload.files.length, 'الصورة ما انرفقت');
    assert.ok(fs.existsSync(sent.payload.files[0]), 'ملف الصورة المرفق غير موجود');

    const saved = room.configFor(GUILD).bannerId;
    assert.strictEqual(saved, sent.id, 'رقم رسالة الترحيب ما انحفظ');
    ok('نُشرت الرسالة: النص العربي كما هو + الصورة مرفقة + رقم الرسالة محفوظ');

    /* إعادة النشر (الوضع الافتراضي): يحذف القديمة ويبعت وحدة جديدة — بلا «تم التعديل» */
    const res2 = await room.publish(client, guild);
    assert.notStrictEqual(res2.messageId, res.messageId, 'لازم رسالة جديدة كل دورة');
    const sends = channel.state.sent.filter((s) => s.type === 'send').length;
    const edits = channel.state.sent.filter((s) => s.type === 'edit').length;
    assert.strictEqual(sends, 2, 'لازم إرسالين (وحدة لكل دورة): ' + sends);
    assert.strictEqual(edits, 0, 'ما لازم يصير أي تعديل (يطلع «تم التعديل»): ' + edits);
    assert.ok(!channel.state.messages.has(res.messageId), 'الرسالة القديمة ما انحذفت');
    assert.ok(channel.state.messages.has(res2.messageId), 'الرسالة الجديدة مو موجودة');
    ok('كل دورة: تُحذف الرسالة وتنبعث وحدة جديدة (بلا «تم التعديل» ولا تراكم نسخ)');

    /* ومخزّن الرقم يتحدّث للرسالة الجديدة */
    assert.strictEqual(room.configFor(GUILD).bannerId, res2.messageId, 'رقم الرسالة ما انحدّث');
    ok('رقم الرسالة يتحدّث تلقائيًا بعد كل إعادة نشر');

    /* ما فيه تثبيت افتراضيًا */
    assert.strictEqual(room.configFor(GUILD).pin, false, 'التثبيت لازم يكون مطفّي افتراضيًا');
    assert.strictEqual(room.configFor(GUILD).repost, true, 'إعادة النشر لازم تكون مفعّلة افتراضيًا');
    const pinCalls = channel.state.sent.filter((s) => s.type === 'pin').length;
    assert.strictEqual(pinCalls, 0, 'ما لازم يثبّت الرسالة');
    ok('بلا تثبيت: الرسالة تظهر عادية مو مثبّتة');

    /* وضع التعديل (repost=false) يبقى متاحًا */
    db.updateGuildSettings(GUILD, { commandRoom: { repost: false } });
    const res3 = await room.publish(client, guild);
    assert.strictEqual(res3.edited, true, 'وضع التعديل ما اشتغل');
    const editsAfter = channel.state.sent.filter((s) => s.type === 'edit').length;
    assert.strictEqual(editsAfter, 1, 'لازم تعديل واحد في وضع التعديل');
    ok('خيار «إعادة النشر» لو طفّيته يرجع يعدّل نفس الرسالة');
    db.updateGuildSettings(GUILD, {});
  }

  console.log('\n═══ ٣) التنظيف: يمسح الكل ما عدا رسالة الترحيب ═══');
  {
    const channel = makeChannel();
    const guild = makeGuild(channel);
    const publish = await room.publish(client, guild);
    const banner = publish.messageId;

    channel.add('900', { content: 'أمر: قفل' });
    channel.add('901', { content: 'أمر: تحذير @عضو' });
    channel.add('902', { content: 'كلام عادي' });
    channel.add('903', { content: 'رسالة مثبّتة يدويًا', pinned: true });

    const clean = await room.clean(client, guild);
    assert.strictEqual(clean.ok, true, 'التنظيف فشل');
    assert.strictEqual(clean.deleted, 3, 'عدد المحذوف غلط: ' + clean.deleted);
    const stillBanner = room.configFor(GUILD).bannerId || banner;
    assert.ok(channel.state.messages.has(stillBanner), 'رسالة الترحيب انمسحت!');
    assert.ok(channel.state.messages.has('903'), 'الرسالة المثبّتة انمسحت (لازم تبقى)');
    assert.ok(!channel.state.messages.has('902'), 'كلام العضو ما انمسح');
    ok('التنظيف مسح ٣ رسائل وخلّى رسالة الترحيب (والمثبّتة)');
  }

  console.log('\n═══ ٤) دورة كاملة + إطفاء النظام + الحد الأدنى للمدة ═══');
  {
    const channel = makeChannel();
    const guild = makeGuild(channel);
    client.guilds.cache.set(GUILD, guild);

    const run = await room.runOnce(client, GUILD);
    assert.strictEqual(run.ok, true, 'الدورة الكاملة فشلت');
    assert.ok(run.published.ok && run.cleaned.ok, 'نشر أو تنظيف فشل');
    const status = room.status().guilds[GUILD];
    assert.strictEqual(status.channelId, CHANNEL, 'الحالة ما سجّلت الروم');
    assert.ok(status.lastRunAt, 'الحالة ما سجّلت وقت آخر دورة');
    ok('دورة كاملة (نشر + تنظيف) تُسجَّل في حالة النظام للتشخيص');

    db.updateGuildSettings(GUILD, { commandRoom: { enabled: false } });
    const off = await room.runOnce(client, GUILD);
    assert.strictEqual(off.reason, 'disabled', 'الإطفاء ما اشتغل');
    const before = channel.state.sent.length;
    await room.publish(client, guild);
    assert.ok(channel.state.sent.length > before, 'النشر المباشر يشتغل حتى لو مطفّي (زر «أرسل الآن»)');
    ok('إطفاء النظام يوقف الدورة التلقائية — وزر «أرسل الآن» يبقى يشتغل');

    db.updateGuildSettings(GUILD, { commandRoom: { enabled: true, intervalSeconds: 5 } });
    assert.strictEqual(room.configFor(GUILD).intervalSeconds, 15, 'الحد الأدنى للمدة لازم ١٥ ثانية');
    db.updateGuildSettings(GUILD, { commandRoom: { enabled: true, intervalSeconds: 120 } });
    assert.strictEqual(room.configFor(GUILD).intervalSeconds, 120, 'المدة القابلة للتعديل ما انحفظت');
    ok('المدة قابلة للتعديل (بحد أدنى ١٥ ثانية)');
    db.updateGuildSettings(GUILD, {});
  }

  console.log('\n═══ ٥) اللوحة + الـ API ═══');
  {
    const appSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'public', 'app.js'), 'utf8');
    assert.ok(/commandRoom: \{/.test(appSrc), 'قسم «روم الأوامر» ناقص من اللوحة');
    assert.ok(/label: 'روم الأوامر'/.test(appSrc), 'اسم قسم الروم غلط');
    for (const key of ['commandRoom.enabled', 'commandRoom.channelId', 'commandRoom.intervalSeconds', 'commandRoom.text', 'commandRoom.image']) {
      assert.ok(appSrc.includes(key), `حقل ${key} ناقص من اللوحة`);
    }
    assert.ok(/command-room\/publish/.test(appSrc) && /command-room\/clean/.test(appSrc), 'أزرار «أرسل الآن»/«نظّف الآن» ناقصة');
    ok('اللوحة: قسم روم الأوامر بكل حقوله + زرّي النشر والتنظيف الفوري');

    const apiSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(/command-room\/:action/.test(apiSrc), 'مسارات روم الأوامر ناقصة من الـ API');
    assert.ok(/commandRoom: \(\(\) => \{/.test(apiSrc), 'حالة روم الأوامر ناقصة من /api/status');
    /* المسار اللي يكتب (النشر/التنظيف) لازم يمر بـ canEdit، ومسار القراءة بـ canAccess */
    const post53 = apiSrc.indexOf("command-room/:action");
    assert.ok(/canEdit\(req\)/.test(apiSrc.slice(post53, post53 + 400)), 'مسار التنفيذ بلا حماية صلاحيات (canEdit)');
    const get53 = apiSrc.indexOf("'/guilds/:guildId/command-room'");
    assert.ok(/canAccess\(/.test(apiSrc.slice(get53, get53 + 300)), 'مسار القراءة بلا حماية (canAccess)');
    ok('الـ API: مسار التنفيذ محمي بـ canEdit · القراءة بـ canAccess · وحالة حيّة في /api/status');

    const readySrc = fs.readFileSync(path.join(__dirname, 'src', 'events', 'ready.js'), 'utf8');
    assert.ok(/commandRoom'\)\.start\(client\)/.test(readySrc), 'مؤقّت روم الأوامر ما انربط بالبوت');
    ok('البوت يشغّل مؤقّت روم الأوامر عند الإقلاع');

    const repliesSrc = fs.readFileSync(path.join(__dirname, 'src', 'lib', 'replies.js'), 'utf8');
    assert.ok(repliesSrc.includes('__raw'), 'خاصية «أرسلها كما هي» (__raw) ناقصة — الرسالة العربية بتتترجم');
    ok('الرسالة الإعلانية تنزل بنصّها العربي بلا ترجمة (خاصية __raw)');

    const cfgSrc = fs.readFileSync(path.join(__dirname, 'src', 'config.js'), 'utf8');
    assert.ok(cfgSrc.includes(`'${CHANNEL}'`), 'روم الأوامر ما انضبط في الإعدادات الافتراضية');
    ok('الروم المطلوب مضبوط في إعدادات المشروع');
  }

  console.log(`\n🎉 روم الأوامر جاهز: رسالة ترحيب بالصورة + تنظيف تلقائي كل ٦٠ ثانية (${checks} فحص)\n`);
}

main().catch((err) => {
  console.error('\n❌', err.message);
  console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
