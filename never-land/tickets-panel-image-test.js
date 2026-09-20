'use strict';

/**
 * tickets-panel-image-test.js
 * -------------------------------------------------------------
 * فحص لوحة التذاكر بالصورة (بدل النص) + رسالة فتح التذكرة بالصورة:
 *   ١) اللوحة الافتراضية = صورة السيرفر + قائمة الأنواع تحتها (بلا أي نص)
 *   ٢) صورة زخرفية اختيارية أسفل القائمة
 *   ٣) الصورة موجودة على القرص فعلًا (webp) وبمقاس معقول
 *   ٤) إطفاء الصورة يرجّع اللوحة النصية القديمة (بلا كسر)
 *   ٥) بصمة اللوحة: تتغيّر مع الصورة/الأنواع/الوضع ⇒ تحديث تلقائي
 *   ٦) ensurePanel: نشر أول مرة · ما يعيد النشر بلا تغيير · يعيد النشر لو تغيّر شي
 *   ٧) تنظيف اللوحة القديمة + الصورة الزخرفية القديمة + رسالة التعليمات القديمة
 *   ٨) ترقية شكل اللوحة مرة واحدة (أزرار ← قائمة منسدلة)
 *   ٩) ربط التحديث التلقائي (ready + حفظ الإعدادات + مسار التشخيص)
 *
 * التشغيل:  node tickets-panel-image-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-panel-'));
process.env.DATABASE_PATH = path.join(tmp, 'panel.db');
process.env.DEMO_MODE = 'true';

const db = require('./src/database');
const tickets = require('./src/systems/tickets');

let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

const GUILD = '800000000000000001';
const BOT = '800000000000000099';
const PANEL_CHANNEL = '800000000000000111';
const OTHER_CHANNEL = '800000000000000222';

const HERO = 'src/web/public/assets/tickets-panel.webp';
const FOOTER = 'src/web/public/assets/tickets-panel-footer.webp';

/** رسالة وهمية */
const mkMessage = (id, { author = BOT, content = '', components = [], images = [] } = {}) => ({
  id,
  author: { id: author, bot: author === BOT },
  content,
  pinned: false,
  components: components.map((customId) => ({ components: [{ customId }] })),
  embeds: images.map((url) => ({ image: { url } })),
  createdTimestamp: Date.now(),
  delete: async () => { mkMessage.deleted.push(id); return true; },
});
mkMessage.deleted = [];

function mkChannel(id, name, messages = []) {
  const store = new Map(messages.map((m) => [m.id, m]));
  const state = { sent: [] };
  const channel = {
    id,
    name,
    type: 0,
    isTextBased: () => true,
    messages: { fetch: async () => new Map(store) },
    bulkDelete: async () => ({ size: 0 }),
    send: async (payload) => {
      const message = { id: `sent-${id}-${state.sent.length + 1}`, payload };
      state.sent.push(message);
      return message;
    },
    state,
  };
  return channel;
}

function mkGuild(channels) {
  const cache = new Map(channels.map((c) => [c.id, c]));
  return {
    id: GUILD,
    name: 'Test Server',
    client: { user: { id: BOT } },
    channels: { cache, fetch: async (id) => cache.get(id) || null },
  };
}

const resetTickets = (patch = {}) => {
  const current = db.getGuildSettings(GUILD).tickets || {};
  db.updateGuildSettings(GUILD, { tickets: { ...current, ...patch } });
  return db.getGuildSettings(GUILD).tickets;
};

async function main() {
  console.log('\n═══ ١) الصور موجودة فعلًا في المشروع ═══');
  {
    for (const rel of [HERO, FOOTER]) {
      const full = path.join(__dirname, rel);
      assert.ok(fs.existsSync(full), `الصورة ناقصة: ${rel}`);
      const size = fs.statSync(full).size;
      assert.ok(size > 20000 && size < 1024 * 1024, `مقاس الصورة غير مناسب (${size} بايت): ${rel}`);
      const head = fs.readFileSync(full).subarray(0, 12).toString('ascii');
      assert.ok(head.includes('WEBP'), `الملف ليس صورة webp صالحة: ${rel}`);
    }
    assert.strictEqual(tickets.DEFAULT_PANEL_IMAGE, HERO, 'مسار صورة اللوحة الافتراضية خطأ');
    const names = tickets.panelImageNames({ panelImage: HERO, panelFooterImage: FOOTER });
    assert.deepStrictEqual(names.sort(), ['tickets-panel-footer.webp', 'tickets-panel.webp'], 'أسماء صور اللوحة خطأ');
    ok('صورة اللوحة + الصورة الزخرفية موجودة (webp بمقاس معقول) + أسماء الملفات معروفة');
  }

  console.log('\n═══ ٢) اللوحة الافتراضية: صورة + قائمة (بلا نص) ═══');
  {
    const settings = { tickets: { ...db.getGuildSettings(GUILD).tickets, panelImage: HERO, panelFooterImage: FOOTER, panelImageOnly: true, panelMode: 'select' } };
    const payloads = tickets.buildPanelPayloads(settings, { id: GUILD, iconURL: () => null });
    assert.strictEqual(payloads.length, 2, 'اللوحة لازم تنزل برسالتين: الصورة + الصورة الزخرفية');

    const hero = payloads[0];
    assert.ok(String(hero.embeds[0].data.image?.url || '').startsWith('attachment://tickets-panel'), 'اللوحة لازم تكون صورة');
    assert.ok(!hero.embeds[0].data.title && !hero.embeds[0].data.description && !hero.embeds[0].data.footer, 'اللوحة صورة فقط — بلا نص ولا تذييل');
    assert.ok(!hero.embeds[0].data.timestamp, 'اللوحة بلا وقت ظاهر');
    assert.strictEqual(hero.files.length, 1, 'ملف الصورة ناقص');
    assert.ok(!hero.content, 'اللوحة بلا أي نص معها');

    const select = hero.components[0].components[0];
    assert.strictEqual(select.options.length, 4, 'القائمة لازم تحتوي 4 أنواع');
    assert.strictEqual(select.data.placeholder, 'اختر القائمة المناسبة لك', 'نص القائمة المنسدلة خطأ');
    assert.ok(select.options.every((option) => option.data.description), 'كل نوع لازم يكون له وصف تحت الاسم');
    assert.deepStrictEqual(select.options.map((o) => o.data.value), ['support', 'verify', 'gift', 'staff'], 'ترتيب الأنواع خطأ');

    const footer = payloads[1];
    assert.ok(String(footer.embeds[0].data.image?.url || '').includes('tickets-panel-footer'), 'الصورة الزخرفية خطأ');
    assert.strictEqual(footer.embeds[0].data.title, undefined, 'الصورة الزخرفية بلا نص');
    assert.strictEqual(footer.components, undefined, 'الصورة الزخرفية بلا مكوّنات');
    ok('اللوحة صورة كاملة (بلا عنوان/وصف/تذييل) + قائمة «اختر القائمة المناسبة لك» بـ4 أنواع بوصف + صورة زخرفية أسفلها');
  }

  console.log('\n═══ ٣) إطفاء الصورة يرجّع اللوحة النصية (بلا كسر) ═══');
  {
    const base = db.getGuildSettings(GUILD).tickets;
    const textPanel = tickets.buildPanelPayloads(
      { tickets: { ...base, panelImage: '', panelFooterImage: '', panelMode: 'buttons' } },
      { id: GUILD, iconURL: () => null },
    );
    assert.strictEqual(textPanel.length, 1, 'اللوحة النصية رسالة واحدة');
    assert.ok(textPanel[0].embeds[0].data.title, 'العنوان النصي رجع فاضي');
    assert.ok(!textPanel[0].files?.length, 'اللوحة النصية بلا ملف صورة');
    assert.ok(textPanel[0].components[0].components[0].data.custom_id.startsWith('ticket:open:'), 'أزرار الأنواع ناقصة');

    const noImageOnly = tickets.buildPanelPayloads(
      { tickets: { ...base, panelImage: HERO, panelFooterImage: '', panelImageOnly: false } },
      { id: GUILD, iconURL: () => null },
    );
    assert.ok(noImageOnly[0].embeds[0].data.title, 'panelImageOnly=false لازم ترجع اللوحة النصية');
    ok('إطفاء الصورة (أو panelImageOnly=false) يرجّع اللوحة النصية بأزرار الأنواع — ما في شي انكسر');
  }

  console.log('\n═══ ٤) بصمة اللوحة (تحديث تلقائي) ═══');
  {
    const base = { ...db.getGuildSettings(GUILD).tickets, panelImage: HERO, panelFooterImage: FOOTER, panelMode: 'select' };
    const sig = tickets.panelSignature(base);
    assert.strictEqual(sig, tickets.panelSignature({ ...base }), 'البصمة لازم تكون ثابتة لو ما تغيّر شي');
    assert.notStrictEqual(sig, tickets.panelSignature({ ...base, panelImage: 'src/web/public/assets/commands-room.png' }), 'تغيير الصورة لازم يغيّر البصمة');
    assert.notStrictEqual(sig, tickets.panelSignature({ ...base, panelFooterImage: '' }), 'شيل الصورة الزخرفية لازم يغيّر البصمة');
    assert.notStrictEqual(sig, tickets.panelSignature({ ...base, panelMode: 'buttons' }), 'تغيير الوضع لازم يغيّر البصمة');
    assert.notStrictEqual(
      sig,
      tickets.panelSignature({ ...base, types: [{ id: 'new', label: 'نوع جديد', description: '', emoji: '🎫' }] }),
      'تغيير الأنواع لازم يغيّر البصمة',
    );
    ok('البصمة تتغيّر مع الصورة/الصورة الزخرفية/الوضع/الأنواع — وتبقى ثابتة بلا تغيير');
  }

  console.log('\n═══ ٥) ensurePanel: نشر · ما يعيد النشر بلا تغيير · إعادة نشر عند التغيير ═══');
  {
    /* قناة فيها لوحة قديمة (بلا صورة) — البوت يلقاها لحاله */
    const oldPanel = mkMessage('old-panel', { components: ['ticket:open'] });
    const panelChannel = mkChannel(PANEL_CHANNEL, '・𝑇𝑖𝑐𝑘𝑒𝑡𝑠', [oldPanel]);
    const otherChannel = mkChannel(OTHER_CHANNEL, '・𝑪𝒉𝒂𝒕', [mkMessage('chat-1', { author: 'user-1', content: 'هلا' })]);
    const guild = mkGuild([panelChannel, otherChannel]);

    mkMessage.deleted = [];
    resetTickets({ enabled: true, categoryId: '800000000000000777', panelImage: HERO, panelFooterImage: FOOTER, panelImageOnly: true, panelAutoPost: true, panelChannelId: null, panelSignature: null });

    const first = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(first.ok, true, 'النشر الأول فشل: ' + first.reason);
    assert.strictEqual(first.reason, 'posted', 'أول تشغيل لازم ينشر: ' + first.reason);
    assert.strictEqual(first.channelId, PANEL_CHANNEL, 'البوت ما لقى قناة اللوحة');
    assert.strictEqual(first.sent, 2, 'لازم رسالتين (الصورة + الزخرفية)');
    assert.deepStrictEqual(mkMessage.deleted, ['old-panel'], 'اللوحة القديمة ما انحذفت');
    assert.strictEqual(panelChannel.state.sent.length, 2, 'ما انبعتت اللوحة في القناة الصح');
    assert.ok(String(panelChannel.state.sent[0].payload.embeds[0].data.image.url).includes('tickets-panel.webp'), 'اللوحة المنشورة ليست صورة');

    const saved = db.getGuildSettings(GUILD).tickets;
    assert.strictEqual(saved.panelChannelId, PANEL_CHANNEL, 'قناة اللوحة ما انحفظت');
    assert.strictEqual(saved.panelSignature, tickets.panelSignature(saved), 'بصمة اللوحة ما انحفظت');

    /* تشغيل ثاني: ما يعيد النشر */
    const second = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(second.reason, 'upToDate', 'ما المفروض يعيد النشر بلا تغيير: ' + second.reason);
    assert.strictEqual(panelChannel.state.sent.length, 2, 'انبعتت رسائل زيادة بلا داعي');

    /* تغيير الأنواع ⇒ إعادة نشر تلقائية */
    resetTickets({ types: [{ id: 'new', label: 'نوع جديد', description: 'وصف', emoji: '🎫', buttonStyle: 'Primary' }] });
    const third = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(third.reason, 'posted', 'تغيير الأنواع لازم يعيد النشر: ' + third.reason);
    assert.strictEqual(panelChannel.state.sent.length, 4, 'اللوحة الجديدة ما انبعتت');

    /* إطفاء التحديث التلقائي */
    resetTickets({ panelAutoPost: false, panelSignature: null });
    const off = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(off.reason, 'autoOff', 'إطفاء التحديث التلقائي ما اشتغل: ' + off.reason);

    /* التذاكر مطفّية */
    resetTickets({ panelAutoPost: true, enabled: false });
    const disabled = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(disabled.reason, 'disabled', 'التذاكر مطفّية → ما ينشر: ' + disabled.reason);

    /* حالة التشخيص تُسجَّل */
    const status = tickets.status(GUILD);
    assert.ok(status && status.channelId === PANEL_CHANNEL, 'حالة اللوحة للتشخيص ناقصة');
    ok('ensurePanel: ينشر أول مرة (ويحذف اللوحة القديمة) · ما يكرّر بلا تغيير · يعيد النشر عند التغيير · ويحترم الإطفاء');
  }

  console.log('\n═══ ٦) ترقية شكل اللوحة مرة واحدة (أزرار ← قائمة منسدلة) ═══');
  {
    const panelChannel = mkChannel(PANEL_CHANNEL, '・𝑇𝑖𝑐𝑘𝑒𝑡𝑠', []);
    const guild = mkGuild([panelChannel]);
    /* إعداد قديم: أزرار + ما صارت عليه ترقية بعد */
    resetTickets({ enabled: true, panelMode: 'buttons', panelAutoPost: true, panelSignature: null, panelChannelId: PANEL_CHANNEL, panelLookUpgraded: false });

    const result = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(db.getGuildSettings(GUILD).tickets.panelMode, 'select', 'الترقية ما صارت (لازم قائمة منسدلة)');
    assert.strictEqual(result.ok, true, 'بعد الترقية لازم ينشر اللوحة: ' + result.reason);
    /* رسالة اللوحة هي اللي فيها المكوّنات (الصورة الزخرفية بلا مكوّنات) */
    const panelsSent = () => panelChannel.state.sent.filter((message) => message.payload.components);
    const components = panelsSent().at(-1).payload.components[0].components[0];
    assert.ok(components.options, 'اللوحة المنشورة لازم تكون قائمة منسدلة');

    /* ما تترقّى مرتين (لو المدير رجّعها أزرار، تبقى أزرار) */
    resetTickets({ panelMode: 'buttons', panelSignature: null });
    assert.strictEqual(db.getGuildSettings(GUILD).tickets.panelLookUpgraded, true, 'علامة الترقية ما انحفظت');
    await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(db.getGuildSettings(GUILD).tickets.panelMode, 'buttons', 'اختيار المدير انلغى بالغلط');
    const buttons = panelsSent().at(-1).payload.components[0].components;
    assert.ok(buttons[0].data.custom_id.startsWith('ticket:open:'), 'أزرار الأنواع ما انبعتت');
    ok('ترقية مرة واحدة لأزرار قديمة ← قائمة منسدلة — وبعدها اختيار المدير محترم (ما تتكرر)');
  }

  console.log('\n═══ ٧) تنظيف اللوحات القديمة (لوحة نصية + صورة زخرفية + رسالة تعليمات) ═══');
  {
    const messages = [
      mkMessage('m-panel', { components: ['ticket:open'] }),
      mkMessage('m-footer', { images: ['https://cdn.discordapp.com/attachments/1/2/tickets-panel-footer.webp'] }),
      mkMessage('m-hero', { images: ['https://cdn.discordapp.com/attachments/1/2/tickets-panel.webp'], components: ['ticket:open'] }),
      mkMessage('m-intro', { content: '**كيف أحصل على الدعم؟**\nاضغط الزر المناسب لنوع طلبك 👇' }),
      mkMessage('m-user', { author: 'user-1', content: 'محتاج مساعدة', images: ['https://cdn.discordapp.com/attachments/9/9/random.png'] }),
    ];
    const channel = mkChannel(PANEL_CHANNEL, '・𝑇𝑖𝑐𝑘𝑒𝑡𝑠', messages);
    mkMessage.deleted = [];
    const removed = await tickets.cleanupOldPanels(channel, { user: { id: BOT } }, [], { config: { panelImage: HERO, panelFooterImage: FOOTER } });
    assert.strictEqual(removed, 4, 'لازم ينحذف: اللوحة + الزخرفية + نسخة ثانية + رسالة التعليمات');
    assert.ok(!mkMessage.deleted.includes('m-user'), 'رسالة العضو انحذفت — لازم تبقى');
    ok('التنظيف يحذف اللوحة القديمة (أي نسخة) + الصورة الزخرفية + رسالة التعليمات — ويترك رسائل الأعضاء');
  }

  console.log('\n═══ ٨) ربط التحديث التلقائي (تشغيل البوت + الموقع + التشخيص) ═══');
  {
    const readySrc = fs.readFileSync(path.join(__dirname, 'src', 'events', 'ready.js'), 'utf8');
    assert.ok(/systems\/tickets['"]\)\s*\.ensureAll|ensureAll\(client\)/.test(readySrc), 'التشغيل التلقائي للوحة التذاكر غير مربوط عند إقلاع البوت');

    const apiSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(/scheduleEnsure/.test(apiSrc), 'حفظ الإعدادات ما يحدّث اللوحة تلقائيًا');
    assert.ok(/tickets\/panel'/.test(apiSrc), 'مسار تشخيص لوحة التذاكر ناقص');
    assert.ok(/ticketsPanel/.test(apiSrc), 'حالة لوحة التذاكر ناقصة من /api/status');
    assert.ok(/panelFooterImage/.test(apiSrc), 'الصورة الزخرفية ناقصة من مسار التشخيص');

    const cmdSrc = fs.readFileSync(path.join(__dirname, 'src', 'commands', 'config', 'tickets.js'), 'utf8');
    assert.ok(/ensurePanel/.test(cmdSrc), 'أمر /tickets panel ما صار يستخدم مسار الصورة');

    const appSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const key of ['tickets.panelImage', 'tickets.panelImageOnly', 'tickets.panelFooterImage', 'tickets.panelPlaceholder', 'tickets.panelChannelId', 'tickets.panelAutoPost', 'tickets.openImage', 'tickets.openImageOnly']) {
      assert.ok(appSrc.includes(key), `حقل ${key} ناقص من الموقع`);
    }
    ok('الموقع فيه كل حقول الصور · البوت يحدّث اللوحة عند الإقلاع وعند الحفظ · ومسار تشخيص يبيّن اللوحة الحيّة');
  }

  console.log(`\n🎉 لوحة التذاكر بالصورة: جاهزة (${checks} فحصًا)\n`);
}

main().catch((err) => {
  console.error('\n❌ فشل الاختبار:', err.message);
  process.exitCode = 1;
});
