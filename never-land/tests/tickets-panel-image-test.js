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

const db = require('../src/database');
const tickets = require('../src/systems/tickets');

let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

const GUILD = '800000000000000001';
const BOT = '800000000000000099';
const PANEL_CHANNEL = '800000000000000111';
const OTHER_CHANNEL = '800000000000000222';

const HERO = 'src/web/public/assets/tickets-panel-v5.webp';
const FOOTER = 'src/web/public/assets/tickets-panel-footer.webp'; // نسخة قديمة (للتنظيف فقط)

/** رسالة وهمية */
const mkMessage = (id, { author = BOT, content = '', components = [], images = [], attachments = [] } = {}) => ({
  id,
  author: { id: author, bot: author === BOT },
  content,
  pinned: false,
  components: components.map((customId) => ({ components: [{ customId }] })),
  embeds: images.map((url) => ({ image: { url } })),
  attachments: new Map(attachments.map((a) => [a.name, a])),
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
  console.log('\n═══ ١) صورة اللوحة: صورة بخلفية شفافة فعلًا ═══');
  {
    const full = path.join(__dirname, '..', HERO);
    assert.ok(fs.existsSync(full), `الصورة ناقصة: ${HERO}`);
    const buffer = fs.readFileSync(full);

    /* نتعرّف على الصيغة من التوقيع، ثم نتحقق من قناة الشفافية بأسلوبها.
       المقصود الحقيقي: الصورة ما تكونش بخلفية سوداء — أي أن فيها شفافية فعلًا. */
    const isPng = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const isWebp =
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    assert.ok(isPng || isWebp, `الصورة ليست PNG ولا WebP (توقيع: ${buffer.subarray(0, 4).toString('hex')})`);

    if (isPng) {
      /* PNG: نوع اللون في IHDR — 6 يعني RGBA */
      assert.strictEqual(buffer[25], 6, 'الصورة بلا قناة شفافية (لازم RGBA) — يعني الخلفية السوداء ترجع');
    } else {
      /* WebP: chunk VP8X وراية الشفافية في البايت الأول من الرايات (bit 4) */
      assert.strictEqual(buffer.subarray(12, 16).toString('ascii'), 'VP8X', 'WebP بلا ترويسة VP8X');
      assert.strictEqual((buffer[20] >> 4) & 1, 1, 'WebP بلا قناة شفافية — يعني الخلفية السوداء ترجع');
    }
    assert.ok(buffer.length > 50000, 'الصورة صغيرة بشكل غير متوقّع');

    /* الدليل القاطع: نفكّ الصورة ونتأكد أن فيها بكسلات شفافة فعلًا */
    const { loadImage, createCanvas } = require('@napi-rs/canvas');
    const img = await loadImage(buffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
    let transparent = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 10) transparent += 1;
    assert.ok(transparent > 0, 'الصورة معتمة كاملة — الشفافية ضاعت');

    /* ما بقيت أي نسخة قديمة (سوداء/خط زخرفي/PNG ما قبل WebP) داخل المشروع */
    for (const old of ['tickets-panel.webp', 'tickets-panel-footer.webp', 'tickets-panel.png']) {
      assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'web', 'public', 'assets', old)), `نسخة قديمة لسا موجودة: ${old}`);
    }
    assert.strictEqual(tickets.DEFAULT_PANEL_IMAGE, HERO, 'مسار صورة اللوحة الافتراضية خطأ');
    assert.strictEqual(require(path.join(__dirname, '..', 'src', 'config')).defaults.tickets.panelFooterImage, '', 'الخط الزخرفي لازم يكون مطفّي');
    const names = tickets.panelImageNames({ panelImage: HERO, panelFooterImage: '' });
    assert.ok(names.includes('tickets-panel-v5.webp'), 'اسم الصورة الجديدة ناقص');
    assert.ok(
      names.includes('tickets-panel.webp') &&
        names.includes('tickets-panel-footer.webp') &&
        names.includes('tickets-panel.png'),
      'أسماء النسخ القديمة ناقصة (لازم تتنظّف من الرومات)',
    );
    const ratio = ((transparent / (pixels.length / 4)) * 100).toFixed(1);
    ok(`صورة اللوحة ${isPng ? 'PNG' : 'WebP'} بخلفية شفافة (${ratio}% بكسلات شفافة) · بلا خط زخرفي · وأسماء النسخ القديمة معروفة للتنظيف`);
  }

  console.log('\n═══ ٢) اللوحة الافتراضية: صورة + قائمة (بلا نص) ═══');
  {
    const settings = { tickets: { ...db.getGuildSettings(GUILD).tickets, panelImage: HERO, panelFooterImage: '', panelImageOnly: true, panelMode: 'select' } };
    const payloads = tickets.buildPanelPayloads(settings, { id: GUILD, iconURL: () => null });
    assert.strictEqual(payloads.length, 1, 'اللوحة رسالة واحدة: صورة + قائمة تحتها (بلا خط)');

    const hero = payloads[0];
    /* 🖼️ صورة عادية: مرفق مباشر — بلا أي إمبد (ولا عنوان ولا وصف ولا تذييل) */
    assert.strictEqual(hero.embeds, undefined, 'اللوحة لازم تكون صورة عادية بلا إمبد');
    assert.strictEqual(hero.files.length, 1, 'ملف الصورة ناقص');
    assert.ok(!hero.content, 'اللوحة بلا أي نص معها');

    const select = hero.components[0].components[0];
    assert.strictEqual(select.options.length, 4, 'القائمة لازم تحتوي 4 أنواع');
    assert.strictEqual(select.data.placeholder, 'اختر القائمة المناسبة لك', 'نص القائمة المنسدلة خطأ');
    assert.ok(select.options.every((option) => option.data.description), 'كل نوع لازم يكون له وصف تحت الاسم');
    assert.deepStrictEqual(select.options.map((o) => o.data.value), ['support', 'verify', 'gift', 'staff'], 'ترتيب الأنواع خطأ');

    /* لو حبّ المدير يرجّع خط/صورة تحت القائمة — لسا مدعومة */
    const withFooter = tickets.buildPanelPayloads({ tickets: { ...settings.tickets, panelFooterImage: 'src/web/public/assets/commands-room.webp' } }, { id: GUILD, iconURL: () => null });
    assert.strictEqual(withFooter.length, 2, 'الخط/الصورة الاختيارية تحت القائمة ما اشتغلت');
    assert.deepStrictEqual(withFooter[1].files.map((f) => f.name), ['commands-room.webp'], 'ملف الخط الاختياري خطأ');
    ok('اللوحة صورة شفافة واحدة (بلا عنوان/وصف/تذييل) + قائمة «اختر القائمة المناسبة لك» بـ4 أنواع بوصف — وبلا خط تحتها');
  }

  console.log('\n═══ ٣) إطفاء الصورة يرجّع اللوحة النصية (بلا كسر) ═══');
  {
    const base = db.getGuildSettings(GUILD).tickets;
    const textPanel = tickets.buildPanelPayloads(
      { tickets: { ...base, panelImage: '', panelFooterImage: '', panelMode: 'buttons' } },
      { id: GUILD, iconURL: () => null },
    );
    assert.strictEqual(textPanel.length, 1, 'اللوحة النصية رسالة واحدة');
    assert.ok(textPanel[0].embeds?.[0]?.data?.title, 'العنوان النصي رجع فاضي');
    assert.ok(!textPanel[0].files?.length, 'اللوحة النصية بلا ملف صورة');
    assert.ok(textPanel[0].components[0].components[0].data.custom_id.startsWith('ticket:open:'), 'أزرار الأنواع ناقصة');

    const noImageOnly = tickets.buildPanelPayloads(
      { tickets: { ...base, panelImage: HERO, panelFooterImage: '', panelImageOnly: false } },
      { id: GUILD, iconURL: () => null },
    );
    assert.ok(noImageOnly[0].embeds?.[0]?.data?.title, 'panelImageOnly=false لازم ترجع اللوحة النصية');
    ok('إطفاء الصورة (أو panelImageOnly=false) يرجّع اللوحة النصية بأزرار الأنواع — ما في شي انكسر');
  }

  console.log('\n═══ ٤) بصمة اللوحة (تحديث تلقائي) ═══');
  {
    const base = { ...db.getGuildSettings(GUILD).tickets, panelImage: HERO, panelFooterImage: '', panelMode: 'select' };
    const sig = tickets.panelSignature(base);
    assert.strictEqual(sig, tickets.panelSignature({ ...base }), 'البصمة لازم تكون ثابتة لو ما تغيّر شي');
    assert.notStrictEqual(sig, tickets.panelSignature({ ...base, panelImage: 'src/web/public/assets/commands-room.webp' }), 'تغيير الصورة لازم يغيّر البصمة');
    assert.notStrictEqual(sig, tickets.panelSignature({ ...base, panelFooterImage: 'src/web/public/assets/commands-room.webp' }), 'إضافة خط تحت القائمة لازم يغيّر البصمة');
    /* القيم المنقرضة (webp/خط قديم) تُعتبر «بلا صورة» ⇒ نفس بصمة الوضع الحالي (بلا إعادة نشر عبثية) */
    assert.strictEqual(
      tickets.panelSignature({ ...base, panelImage: 'src/web/public/assets/tickets-panel.webp', panelFooterImage: FOOTER }),
      sig,
      'النسخ المنقرضة لازم تُحسب كأنها هي الصورة الشفافة الحالية',
    );
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
    resetTickets({ enabled: true, categoryId: '800000000000000777', panelImage: HERO, panelFooterImage: '', panelImageOnly: true, panelAutoPost: true, panelChannelId: null, panelSignature: null });

    const first = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(first.ok, true, 'النشر الأول فشل: ' + first.reason);
    assert.strictEqual(first.reason, 'posted', 'أول تشغيل لازم ينشر: ' + first.reason);
    assert.strictEqual(first.channelId, PANEL_CHANNEL, 'البوت ما لقى قناة اللوحة');
    assert.strictEqual(first.sent, 1, 'لازم رسالة واحدة (الصورة + القائمة)');
    assert.deepStrictEqual(mkMessage.deleted, ['old-panel'], 'اللوحة القديمة ما انحذفت');
    assert.strictEqual(panelChannel.state.sent.length, 1, 'ما انبعتت اللوحة في القناة الصح');
    assert.deepStrictEqual(panelChannel.state.sent[0].payload.files.map((f) => f.name), ['tickets-panel-v5.webp'], 'اللوحة المنشورة ليست صورة');
    assert.strictEqual(panelChannel.state.sent[0].payload.embeds, undefined, 'اللوحة المنشورة فيها إمبد — لازم صورة عادية');

    const saved = db.getGuildSettings(GUILD).tickets;
    assert.strictEqual(saved.panelChannelId, PANEL_CHANNEL, 'قناة اللوحة ما انحفظت');
    assert.strictEqual(saved.panelSignature, tickets.panelSignature(saved), 'بصمة اللوحة ما انحفظت');

    /* تشغيل ثاني: ما يعيد النشر */
    const second = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(second.reason, 'upToDate', 'ما المفروض يعيد النشر بلا تغيير: ' + second.reason);
    assert.strictEqual(panelChannel.state.sent.length, 1, 'انبعتت رسائل زيادة بلا داعي');

    /* تغيير الأنواع ⇒ إعادة نشر تلقائية */
    resetTickets({ types: [{ id: 'new', label: 'نوع جديد', description: 'وصف', emoji: '🎫', buttonStyle: 'Primary' }] });
    const third = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(third.reason, 'posted', 'تغيير الأنواع لازم يعيد النشر: ' + third.reason);
    assert.strictEqual(panelChannel.state.sent.length, 2, 'اللوحة الجديدة ما انبعتت');

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

  console.log('\n═══ ٥-ب) لو ما في لوحة منشورة ولا قناة محفوظة → قناة التذاكر نفسها ═══');
  {
    const ticketsChannel = { ...mkChannel(PANEL_CHANNEL, 'ོ・𝑻𝒊𝒄𝒌𝒆𝒕𝒔', []), parentId: '800000000000000777' };
    const chatChannel = { ...mkChannel(OTHER_CHANNEL, 'ོ・𝑪𝒉𝒂𝒕', []), parentId: '800000000000000888' };
    const guild = mkGuild([ticketsChannel, chatChannel]);
    resetTickets({ enabled: true, categoryId: '800000000000000777', panelChannelId: null, panelSignature: null, panelAutoPost: true, panelMode: 'select' });
    const result = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(result.ok, true, 'لازم يلقى قناة التذاكر وينشر: ' + result.reason);
    assert.strictEqual(result.channelId, PANEL_CHANNEL, 'البوت نشر في قناة غلط');
    assert.strictEqual(chatChannel.state.sent.length, 0, 'انبعت شي في روم عام — خطأ');
    ok('ما في لوحة منشورة ولا قناة محفوظة؟ البوت ينشر في قناة التذاكر داخل قسم التذاكر لحاله');
  }

  console.log('\n═══ ٥-ج) تصليح الإعدادات المحفوظة القديمة (صورة سوداء/خط محذوف) ═══');
  {
    const panelChannel = mkChannel(PANEL_CHANNEL, '・𝑇𝑖𝑐𝑘𝑒𝑡𝑠', []);
    const guild = mkGuild([panelChannel]);
    /* إعدادات محفوظة قديمة: صورة webp + خط زخرفي — الملفات ما عادت موجودة */
    resetTickets({
      enabled: true,
      panelImage: 'src/web/public/assets/tickets-panel.webp',
      panelFooterImage: 'src/web/public/assets/tickets-panel-footer.webp',
      openImage: 'src/web/public/assets/tickets-panel.webp',
      panelChannelId: PANEL_CHANNEL,
      panelSignature: null,
      panelAutoPost: true,
    });
    const result = await tickets.ensurePanel({ user: { id: BOT } }, guild, {});
    assert.strictEqual(result.ok, true, 'التصليح فشل: ' + result.reason);
    assert.strictEqual(result.sent, 1, 'لازم رسالة واحدة (بلا خط)');
    const stored = db.getGuildSettings(GUILD).tickets;
    assert.strictEqual(stored.panelImage, HERO, 'الصورة المحفوظة ما تصلّحت');
    assert.strictEqual(stored.panelFooterImage, '', 'الخط المحفوظ ما انشال');
    assert.strictEqual(stored.openImage, HERO, 'صورة التذكرة المحفوظة ما تصلّحت');
    assert.deepStrictEqual(panelChannel.state.sent[0].payload.files.map((f) => f.name), ['tickets-panel-v5.webp'], 'المنشور ما صار صورة اللوحة الجديدة');
    assert.strictEqual(panelChannel.state.sent.at(-1).payload.embeds, undefined, 'المنشور فيه إمبد');
    ok('إعدادات قديمة (webp + خط) تصلّحت لحالها: PNG شفاف · بلا خط · وبلا إمبد');
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
      mkMessage('m-plain-footer', { attachments: [{ name: 'tickets-panel-footer.webp', url: 'https://cdn.discordapp.com/attachments/3/4/tickets-panel-footer.webp' }] }),
      mkMessage('m-hero', { images: ['https://cdn.discordapp.com/attachments/1/2/tickets-panel.webp'], components: ['ticket:open'] }),
      mkMessage('m-intro', { content: '**كيف أحصل على الدعم؟**\nاضغط الزر المناسب لنوع طلبك 👇' }),
      mkMessage('m-user', { author: 'user-1', content: 'محتاج مساعدة', images: ['https://cdn.discordapp.com/attachments/9/9/random.png'] }),
    ];
    const channel = mkChannel(PANEL_CHANNEL, '・𝑇𝑖𝑐𝑘𝑒𝑡𝑠', messages);
    mkMessage.deleted = [];
    const removed = await tickets.cleanupOldPanels(channel, { user: { id: BOT } }, [], { config: { panelImage: HERO, panelFooterImage: '' } });
    assert.strictEqual(removed, 5, 'لازم ينحذف: اللوحة + الخط القديم (إمبد + مرفق) + نسخة ثانية + رسالة التعليمات');
    assert.ok(!mkMessage.deleted.includes('m-user'), 'رسالة العضو انحذفت — لازم تبقى');
    ok('التنظيف يحذف اللوحة القديمة (أي نسخة) + الصورة الزخرفية + رسالة التعليمات — ويترك رسائل الأعضاء');
  }

  console.log('\n═══ ٨) ربط التحديث التلقائي (تشغيل البوت + الموقع + التشخيص) ═══');
  {
    const readySrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'events', 'ready.js'), 'utf8');
    assert.ok(/systems\/tickets['"]\)\s*\.ensureAll|ensureAll\(client\)/.test(readySrc), 'التشغيل التلقائي للوحة التذاكر غير مربوط عند إقلاع البوت');

    const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(/scheduleEnsure/.test(apiSrc), 'حفظ الإعدادات ما يحدّث اللوحة تلقائيًا');
    assert.ok(/tickets\/panel'/.test(apiSrc), 'مسار تشخيص لوحة التذاكر ناقص');
    assert.ok(/ticketsPanel/.test(apiSrc), 'حالة لوحة التذاكر ناقصة من /api/status');
    assert.ok(/panelFooterImage/.test(apiSrc), 'الخط تحت القائمة ناقص من مسار التشخيص');
    assert.ok(apiSrc.includes('storedPanelImage') && apiSrc.includes('effectiveImages'), 'التشخيص ما يبيّن الصورة الفعّالة');
    assert.ok(/kind: m.embeds\?\.length \? 'embed' : 'attachment'/.test(apiSrc), 'التشخيص ما يفرّق بين المرفق والإمبد');
    assert.ok(!/imageEmbed/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'systems', 'tickets.js'), 'utf8')), 'خلّفت دالة إمبد الصورة — لازم صورة عادية بلا إمبد');

    const cmdSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'config', 'tickets.js'), 'utf8');
    assert.ok(/ensurePanel/.test(cmdSrc), 'أمر /tickets panel ما صار يستخدم مسار الصورة');

    const appSrc = (fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'app-sections.js'), 'utf8'));
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
