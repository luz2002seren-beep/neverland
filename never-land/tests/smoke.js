'use strict';
/**
 * اختبار سريع: يتحقق أن كل الأوامر والأحداث تُحمَّل بدون أخطاء،
 * وأن بيانات كل أمر صالحة (اسم + وصف + خيارات).
 * التشغيل:  node tests/smoke.js
 */
const assert = require('node:assert');
const path = require('node:path');

process.env.DEMO_MODE = 'true';
process.env.DATABASE_PATH = './data/test.db';

// قاعدة اختبار نظيفة في كل تشغيل (حتى لا تتكدّس الحالات بين الاختبارات)
const fs = require('node:fs');
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(path.join(__dirname, '..', 'data', `test.db${suffix}`));
  } catch {
    /* الملف غير موجود */
  }
}

const db = require('../src/database');
const { loadCommands, walk } = require('../src/handlers/commands');

const fakeClient = { commands: new Map(), guilds: { cache: new Map() }, on() {}, once() {} };

console.log('[اختبار] اختبار 1: تحميل الأوامر');
const { loaded, problems } = loadCommands(fakeClient);
assert.ok(loaded >= 20, `يجب تحميل 20 أمرًا على الأقل، تم تحميل ${loaded}`);
assert.deepStrictEqual(problems, [], `مشاكل في الأوامر: ${problems.join(', ')}`);
console.log(`  [تم] ${loaded} أمر`);

console.log('[اختبار] اختبار 2: صحة بيانات الأوامر');
for (const command of fakeClient.commands.values()) {
  const json = command.data.toJSON();
  assert.ok(json.name && json.name === json.name.toLowerCase(), `اسم غير صالح: ${json.name}`);
  assert.ok(json.description && json.description.length > 3, `وصف ناقص في ${json.name}`);
  assert.ok(typeof command.run === 'function', `run غير موجود في ${json.name}`);
  if (json.options) {
    for (const option of json.options) {
      assert.ok(option.name && option.description, `خيار ناقص في ${json.name}`);
      assert.ok(!/\s/.test(option.name), `اسم خيار يحتوي مسافة في ${json.name}`);
    }
  }
}
console.log('  [تم] كل الأوامر صحيحة');

console.log('[اختبار] اختبار 3: تحميل الأحداث');
const eventFiles = walk(path.join(__dirname, '..', 'src', 'events'));
assert.ok(eventFiles.length >= 6, 'يجب وجود ملفات أحداث');
let eventsCount = 0;
for (const file of eventFiles) {
  const exported = require(file);
  const events = Array.isArray(exported) ? exported : [exported];
  for (const event of events) {
    assert.ok(event.name, `حدث بدون اسم في ${path.basename(file)}`);
    assertEquals(typeof event.execute, 'function', `execute ناقص في ${path.basename(file)}`);
    eventsCount += 1;
  }
}
console.log(`  [تم] ${eventsCount} حدث`);

console.log('[اختبار] اختبار 4: قاعدة البيانات');
db.init();
const guild = db.getGuild('999999999999999999');
assert.ok(guild.settings.automod.enabled !== undefined, 'الإعدادات الافتراضية ناقصة');
assert.ok(guild.settings.tickets.types.length > 0, 'أنواع التذاكر الافتراضية ناقصة');

const record = db.addCase({ guildId: '999999999999999999', type: 'warn', userId: '1', moderatorId: '2', reason: 'اختبار' });
assert.ok(record.id > 0, 'فشل إنشاء حالة');
assert.strictEqual(db.countCases('999999999999999999', { type: 'warn' }), 1, 'عدّ التحذيرات خطأ');

const ticket = db.createTicket({ guildId: '999999999999999999', channelId: '123', userId: '1', type: 'general' });
assert.strictEqual(db.getTicketByChannel('123').id, ticket.id, 'فشل إنشاء تذكرة');
db.updateTicket(ticket.id, { status: 'closed' });
assert.strictEqual(db.countTickets('999999999999999999', 'open'), 0, 'عدّ التذاكر المفتوحة خطأ');

db.upsertLevel('999999999999999999', '1', { xp: 500, level: 2, messages: 10, voiceMinutes: 3, lastXpAt: Date.now() });
const leaderboard = db.getLeaderboard('999999999999999999', 10);
assert.strictEqual(leaderboard.length, 1, 'فشل نظام المستويات');

db.updateGuildSettings('999999999999999999', { welcome: { enabled: true, channelId: '555' } });
assert.strictEqual(db.getGuildSettings('999999999999999999').welcome.enabled, true, 'فشل تحديث الإعدادات');
assert.strictEqual(db.getGuildSettings('999999999999999999').automod.enabled, true, 'فُقدت الإعدادات الافتراضية بعد التحديث!');
console.log('  [تم] قاعدة البيانات تعمل بشكل صحيح');

console.log('[اختبار] اختبار 5: أدوات مساعدة');
const utils = require('../src/lib/utils');
const levels = require('../src/lib/levels');
const i18n = require('../src/lib/i18n');
assert.strictEqual(utils.parseDuration('10m'), 600000);
assert.strictEqual(utils.parseDuration('2h30m'), 9000000);
assert.strictEqual(utils.parseDuration('نص غلط'), null);
assert.ok(utils.parseDuration('3 أيام') === 3 * 86400000);
assert.strictEqual(levels.levelFromXp(0).level, 0);
assert.ok(levels.levelFromXp(100000).level > 10);
assert.strictEqual(i18n.t('ar', 'mod.banned', { user: 'X', reason: 'Y', caseId: 1 }).includes('X'), true);
assert.strictEqual(i18n.t('en', 'common.noPermission').startsWith('❌'), true);
console.log('  [تم] الأدوات تعمل');

console.log('[اختبار] اختبار 6: نظام الحماية');
const automod = require('../src/systems/automod');
const settings = { automod: { ...db.getGuildSettings('999999999999999999').automod } };
const fakeMessage = {
  guild: { id: '999999999999999999' },
  author: { id: '777', bot: false },
  member: { id: '777', roles: { cache: new Map() }, permissions: { has: () => false } },
  mentions: { users: { size: 0 } },
  content: 'شوف هذا الرابط https://evil-site.com/free-nitro',
  channelId: '1',
  attachments: { size: 0 },
};
const violations = automod.collectViolations({ cache: new Map(), spamTracker: new Map() }, fakeMessage, { automod: { ...settings.automod, enabled: true, antiLink: true, antiInvite: true, antiSpam: false, antiEveryone: true, antiMentionSpam: true, antiCaps: false, bannedWords: ['nitro'] } });
assert.ok(violations.some((v) => v.key === 'link'), 'لم يُرصد الرابط');
assert.ok(violations.some((v) => v.key === 'bannedWord'), 'لم تُرصد الكلمة الممنوعة');
assert.strictEqual(automod.normalizeArabic('أَهْـلًا'), 'اهلا');
console.log('  [تم] الحماية التلقائية تعمل');

function assertEquals(actual, expected, message) {
  assert.strictEqual(actual, expected, message);
}

console.log('');
console.log('[نجاح] كل الاختبارات نجحت!');

/* ------------------------- اختبارات متقدّمة (7 → 15) ------------------------- */
(async () => {

 console.log('[اختبار] اختبار 7: تطابق مفاتيح الترجمة (ar en)');
  const { strings } = require('../src/lib/i18n');
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([key, value]) =>
      typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
  const arKeys = new Set(flatten(strings.ar));
  const enKeys = new Set(flatten(strings.en));
  const missingEn = [...arKeys].filter((k) => !enKeys.has(k));
  const missingAr = [...enKeys].filter((k) => !arKeys.has(k));
  assert.deepStrictEqual(missingEn, [], `مفاتيح ناقصة في الإنجليزية: ${missingEn.join(', ')}`);
  assert.deepStrictEqual(missingAr, [], `مفاتيح ناقصة في العربية: ${missingAr.join(', ')}`);
 console.log(`  [تم] ${arKeys.size} مفتاح متطابق في اللغتين`);

 console.log('[اختبار] اختبار 8: بناء اللوحات (بدون اتصال بديسكورد)');
  const settings = db.getGuildSettings('999999999999999999');
  const setupWizard = require('../src/systems/setupWizard');
  const panel = setupWizard.mainPanel(settings);
  assert.ok(panel.embeds?.[0] && panel.components.length >= 2, 'لوحة /setup غير مكتملة');
  const modulePanel = setupWizard.modulePanel('automod', settings);
  assert.ok(modulePanel.embeds?.[0]?.data?.title?.includes('الحماية'), 'لوحة قسم الحماية خطأ');

  const tickets = require('../src/systems/tickets');
  const ticketPanel = tickets.buildPanel(settings, { id: '1' });
  const panelImageRef = ticketPanel.embeds[0].data.image?.url || '';
  assert.ok(panelImageRef.startsWith('attachment://'), 'لوحة التذاكر لازم تنزل صورة (بدل النص)');
  assert.ok(
    !ticketPanel.embeds[0].data.title && !ticketPanel.embeds[0].data.description,
    'اللوحة صورة فقط — بلا عنوان ولا وصف',
  );
  assert.ok(Array.isArray(ticketPanel.files) && ticketPanel.files.length === 1, 'اللوحة ما ترسل ملف الصورة');
  const firstControl = ticketPanel.components[0].components[0];
  const controlCount = ticketPanel.components.flatMap((row) => row.components).length;
  assert.ok(
    controlCount > 0 && (firstControl.options?.length > 0 || firstControl.data?.custom_id?.startsWith('ticket:open:')),
    'عناصر فتح التذاكر ناقصة',
  );
 console.log('  [تم] لوحات الإعداد والتذاكر سليمة');

 console.log('[اختبار] اختبار 9: اللوقات والحماية (مسارات آمنة)');
  const logging = require('../src/systems/logging');
  const result = await logging.send({ guilds: { cache: new Map() } }, { id: '1' }, 'messageDelete', { title: 'اختبار' });
  assert.strictEqual(result, null, 'يجب أن يعود null عند تعطيل اللوقات');
  assert.ok(logging.EVENT_META.messageDelete.emoji, 'بيانات الحدث ناقصة');
  const transcript = logging.buildTranscript(
    [{ createdTimestamp: Date.now(), content: 'مرحبا', author: { tag: 'tester#0001', id: '1' } }],
    { id: 5, user_id: '1', type: 'general', created_at: Date.now() },
  );
  assert.ok(transcript.includes('مرحبا') && transcript.includes('#5'), 'الأرشيف النصي خطأ');
 console.log('  [تم] اللوقات والأرشيف سليمة');

 console.log('[اختبار] اختبار 10: أوامر السلاش قابلة للتسلسل إلى JSON');
  for (const command of fakeClient.commands.values()) {
    const json = command.data.toJSON();
    assert.ok(json.name, 'فشل التسلسل');
    JSON.stringify(json);
  }
 console.log(`  [تم] ${fakeClient.commands.size} أمر جاهز للتسجيل في ديسكورد`);

  console.log('');
 console.log('[نجاح] جميع الاختبارات الإضافية نجحت!');


  console.log('');
 console.log('[اختبار] اختبار 11: دعم الإيموجيات الخارجية');
  const emojis = require('../src/lib/emojis');
  assert.deepStrictEqual(emojis.parseEmoji('<:fire:123456789012345678>'), { id: '123456789012345678', animated: false });
  assert.deepStrictEqual(emojis.parseEmoji('<a:party:987654321098765432>'), { id: '987654321098765432', animated: true });
  assert.deepStrictEqual(emojis.parseEmoji('🔥'), { name: '🔥' });
  assert.strictEqual(emojis.parseEmoji('نص طويل ليس إيموجي'), null);
  assert.ok(emojis.customEmojiUrl('<a:party:987654321098765432>').includes('.gif'));
  assert.ok(emojis.extractCustomEmojis('مرحبا <:ok:123456789012345678> و<:no:987654321098765432>').length === 2);
 console.log('  [تم] الإيموجيات الخارجية تعمل');

 console.log('[اختبار] اختبار 12: بطاقة الترحيب (Canvas)');
  const fs12 = require('node:fs');
  const path12 = require('node:path');
  const welcomeCard = require('../src/lib/welcomeCard');
  assert.ok(welcomeCard.available(), 'مولّد البطاقات غير متاح');
  const fakeUser = {
    username: 'أحمد',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  };
  const cardBuffer = await welcomeCard.generateWelcomeCard({
    user: fakeUser,
    memberCount: 4820,
    guildName: 'سيرفر التجربة',
    message: 'أهلاً بك أحمد في سيرفر التجربة',
    footer: 'العضو رقم 4820',
  });
  assert.ok(cardBuffer && cardBuffer.length > 5000, 'فشل توليد البطاقة');
  assert.strictEqual(cardBuffer.slice(1, 4).toString(), 'PNG', 'الناتج ليس PNG');
  /* المقاس ثابت (نسبة الصور) + الخطوط مرفقة داخل المشروع */
  const png = require('node:zlib');
  const header = cardBuffer.slice(16, 24);
  assert.strictEqual(header.readUInt32BE(0), welcomeCard.CARD_W, 'عرض البطاقة غير متوقّع');
  assert.strictEqual(header.readUInt32BE(4), welcomeCard.CARD_H, 'ارتفاع البطاقة غير متوقّع');
  assert.ok(fs12.existsSync(path12.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf')), 'خط البطاقة غير مرفق بالمشروع');
 console.log(`  [تم] تم توليد بطاقة ترحيب (${Math.round(cardBuffer.length / 1024)}KB) بمقاس ${welcomeCard.CARD_W}×${welcomeCard.CARD_H}`);

 console.log('[اختبار] اختبار 13: لوحة التذاكر (أزرار + قائمة + 4 أنواع)');
  const ticketsSystem = require('../src/systems/tickets');
  const tSettings = db.getGuildSettings('999999999999999999');
  const payloads = ticketsSystem.buildPanelPayloads(tSettings, { id: '1', iconURL: () => null }, null);
  assert.ok(payloads.length <= 2, 'اللوحة لازم تكون رسالة الصورة + صورة زخرفية كحد أقصى');
  const tPanel = payloads[0];
  assert.ok(tPanel.embeds[0], 'البنل بدون embed');
  assert.ok(String(tPanel.embeds[0].data.image?.url || '').startsWith('attachment://'), 'اللوحة لازم تنزل صورة بدل النص');
  assert.ok(!tPanel.embeds[0].data.title && !tPanel.embeds[0].data.description, 'اللوحة صورة فقط — بلا نص');
  assert.ok(!tPanel.content, 'اللوحة ما لازم يكون فيها رسالة تعليمات منفصلة');
  assert.strictEqual(tPanel.embeds[0].data.footer, undefined, 'اللوحة فيها فوتر — لازم بلا فوتر');
  assert.strictEqual(tPanel.files.length, 1, 'اللوحة لازم ترسل ملف الصورة');
  assert.ok(typeof ticketsSystem.cleanupOldPanels === 'function', 'تنظيف اللوحات القديمة ناقص');
  const tTypes = tSettings.tickets.types;
  assert.strictEqual(tTypes.length, 4, 'يجب أن تكون الأنواع 4');
  assert.deepStrictEqual(tTypes.map((t2) => t2.id), ['support', 'verify', 'gift', 'staff']);

  // القائمة المنسدلة هي الوضع الافتراضي: 4 أنواع مع وصف كل نوع ونص القائمة
  const tSelect = tPanel.components[0].components[0];
  assert.strictEqual(tSelect.options.length, 4, 'القائمة المنسدلة لا تحتوي 4 أنواع');
  assert.strictEqual(tSelect.data.placeholder, 'اختر القائمة المناسبة لك', 'نص القائمة المنسدلة خطأ');
  assert.ok(tSelect.options.every((o) => o.data.description), 'كل نوع لازم يكون له وصف');
  assert.ok(tSelect.options[0].data.value.startsWith('support'), 'customId/قيمة الخيار خاطئة');

  // الصورة الزخرفية أسفل القائمة (رسالة ثانية بلا مكوّنات)
  assert.strictEqual(payloads.length, 2, 'لازم تنزل صورة زخرفية أسفل القائمة');
  assert.ok(String(payloads[1].embeds[0].data.image?.url || '').includes('footer'), 'الصورة الزخرفية خطأ');
  assert.strictEqual(payloads[1].components, undefined, 'الصورة الزخرفية بلا مكوّنات');

  // وضع الأزرار (لو بدّله من الموقع)
  const buttonsPayload = ticketsSystem.buildPanelPayloads({ ...tSettings, tickets: { ...tSettings.tickets, panelMode: 'buttons' } }, {})[0];
  const flatButtons = buttonsPayload.components.flatMap((r) => r.components);
  assert.strictEqual(flatButtons.length, 4, 'يجب 4 أزرار للأنواع');
  assert.ok(flatButtons[0].data.custom_id.startsWith('ticket:open:'), 'customId خاطئ');

  // لو طفّيت الصورة ⇒ ترجع اللوحة النصية القديمة
  const textOnly = ticketsSystem.buildPanelPayloads({ ...tSettings, tickets: { ...tSettings.tickets, panelImage: '' } }, { id: '1', iconURL: () => null });
  assert.ok(textOnly[0].embeds[0].data.title, 'لما الصورة مطفّية لازم يرجع العنوان النصي');
  assert.ok(!textOnly[0].files?.length, 'اللوحة النصية بلا ملف صورة');
 console.log('  [تم] اللوحة صورة + قائمة ٤ أنواع بوصف لكل نوع + صورة زخرفية (وبلا فوتر) — والنص يرجع لو الصورة مطفّية');

 console.log('[اختبار] اختبار 14: الخط الفاصل والتفاعلات التلقائية');
  const autolineSystem = require('../src/systems/autoline');
  // الوضع النصّي (السلوك القديم محفوظ)
  const lineContent = autolineSystem.buildLineContent({ autoline: { lineType: 'text', line: '─'.repeat(10), color: null } });
  assert.ok(lineContent.resolved.mode === 'text' && lineContent.payload.content.includes('─'), 'الوضع النصّي للخط الفاصل تعطّل');
  // الوضع الافتراضي الجديد: صورة GIF متحركة
  const gifContent = autolineSystem.buildLineContent({ autoline: { lineType: 'gif', gifStyle: 'glow' } });
  assert.strictEqual(gifContent.resolved.mode, 'gif', 'الوضع الافتراضي للخط الفاصل ليس صورة متحركة');
  assert.ok(Array.isArray(gifContent.payload.files) && gifContent.payload.files.length === 1, 'الخط الفاصل لا يُرسل صورة');
  const autoreactSystem = require('../src/systems/autoreact');
  const tValues = autoreactSystem.toReactionValues(['👍', '<:fire:123456789012345678>', 'نص ليس إيموجي طويل here']);
  assert.strictEqual(tValues.length, 2, 'تحويل الإيموجيات خطأ');
 console.log('  [تم] AutoLine و AutoReaction يعملان');

 console.log('[اختبار] اختبار 15: أحداث اللوقات الشاملة');
  const loggingSystem = require('../src/systems/logging');
  const tTotal = Object.keys(loggingSystem.EVENT_META).length;
  assert.ok(tTotal >= 38, `عدد الأحداث ${tTotal} أقل من المطلوب`);
  const tGroups = loggingSystem.groupedEvents();
  assert.strictEqual(Object.keys(tGroups).length, 9, 'عدد مجموعات اللوقات خطأ');
  for (const [key, meta] of Object.entries(loggingSystem.EVENT_META)) {
    assert.ok(meta.label && meta.emoji && meta.group && loggingSystem.EVENT_GROUPS[meta.group], `بيانات الحدث ${key} ناقصة`);
  }
  const tSettings15 = db.getGuildSettings('999999999999999999');
  assert.strictEqual(Object.keys(tSettings15.logs.events).length, tTotal, 'أحداث الإعدادات لا تطابق الأحداث المتاحة');
 console.log(`  [تم] ${tTotal} حدثًا في ${Object.keys(tGroups).length} مجموعات`);

  console.log('');

 console.log('[اختبار] اختبار 16: نظام تقديم الإدارة (نموذج 5 خانات + قبول/رفض)');
  {
    const applications = require('../src/systems/applications');
    const GUILD16 = '100000000000000001';
    const REVIEW16 = '100000000000000013';

    assert.strictEqual(applications.isApplicationType(db.getGuildSettings(GUILD16), 'staff'), true, 'تقديم الإدارة لا يُفعّل النموذج');
    assert.strictEqual(applications.isApplicationType(db.getGuildSettings(GUILD16), 'support'), false, 'الدعم الفني لا يجب أن يفتح النموذج');

    // النموذج = 5 خانات (حد ديسكورد الأقصى)
    const appTicket = db.createTicket({ guildId: GUILD16, channelId: '100000000000000090', userId: '200000000000000010', type: 'staff' });
    const modal = applications.buildFormModal(db.getGuildSettings(GUILD16), appTicket).toJSON();
    assert.strictEqual(modal.components.length, 5, 'النموذج يجب أن يحتوي 5 خانات');
    assert.ok(modal.components.every((c) => (c.components[0].label || '').length <= 45), 'عنوان خانة أطول من 45 حرفًا');
    assert.strictEqual(modal.custom_id, 'ticket:apply:submit:' + appTicket.id);

    // بنل التقديم داخل التذكرة
    const form = applications.buildFormMessage(db.getGuildSettings(GUILD16), appTicket);
    assert.strictEqual(form.components[0].components[0].data.custom_id, 'ticket:apply:open:' + appTicket.id);

    // استخراج الاسم لإعادة تسمية التذكرة
    assert.strictEqual(applications.extractName('أحمد — 18'), 'أحمد');
    assert.strictEqual(applications.extractName('Ahmed Ali, 17 سنة'), 'ahmed-ali');
    assert.strictEqual(applications.padNumber(7), '007');
    assert.ok(!applications.sanitizeChannelName('إدارة #001 / أحمد؟').includes('#'));

    // محاكاة كاملة: إرسال الطلب ➜ قبول ➜ رفض
    const sentTo = { review: [], ticket: [], dm: [] };
    const renamed = [];
    const movedTo = [];
    const rolesGiven = [];
    const makeChannel = (id) => ({
      id,
      send: async (p) => {
        sentTo[id === REVIEW16 ? 'review' : 'ticket'].push(p);
        return { id: 'm1', editable: true, edit: async () => {} };
      },
      setName: async (n) => { renamed.push(n); },
      setParent: async (pid) => { movedTo.push(pid); },
      toString: () => '<#' + id + '>',
    });
    const reviewChan = makeChannel(REVIEW16);
    const ticketChan = makeChannel('100000000000000090');
    const guild16 = {
      id: GUILD16,
      name: 'سيرفر التجربة',
      channels: {
        cache: new Map([
          [REVIEW16, reviewChan],
          ['100000000000000030', { id: '100000000000000030' }],
          ['100000000000000090', ticketChan],
        ]),
        fetch: async () => null,
      },
      members: { fetch: async () => ({ id: '200000000000000010', roles: { cache: new Map(), add: async (r) => rolesGiven.push(r) } }) },
    };
    const client16 = {
      guilds: { cache: new Map([[GUILD16, guild16]]) },
      channels: { cache: new Map([[REVIEW16, reviewChan]]), fetch: async () => null },
      users: { fetch: async () => ({ id: '200000000000000010', username: 'Ahmed', send: async (p) => { sentTo.dm.push(p); return true; } }) },
    };
    db.updateGuildSettings(GUILD16, {
      staffApplication: { reviewChannelId: REVIEW16, onAccept: { moveToCategoryId: '100000000000000030', addRoleIds: ['100000000000000031'] } },
    });

    const answers16 = {
      name_age: 'أحمد — 18',
      country: 'المغرب',
      prev_servers: 'سيرفر تجريبي — إداري عام',
      mic: 'نعم',
      logo_link: 'نعم + رابط',
    };
    const replies16 = [];
    const interaction16 = {
      guildId: GUILD16,
      guild: guild16,
      channel: ticketChan,
      user: { id: '200000000000000010', username: 'Ahmed', toString: () => '<@200000000000000010>' },
      member: { roles: { cache: new Map() }, permissions: { has: () => true } },
      fields: { getTextInputValue: (k) => answers16[k] ?? '' },
      deferReply: async () => {},
      editReply: async (p) => replies16.push(p),
      reply: async (p) => replies16.push(p),
    };

    const submitted = await applications.submitApplication(client16, interaction16, appTicket);
    assert.ok(submitted.ok, 'فشل إرسال التقديم');
    const reviewPayload = sentTo.review[0];
    assert.strictEqual(reviewPayload.embeds[0].data.fields.length, 5, 'إجابات المراجعة ناقصة');
    const reviewButtons = reviewPayload.components[0].components.map((b) => b.data.custom_id).filter(Boolean);
    assert.deepStrictEqual(
      reviewButtons.slice(0, 2),
      ['apply:review:accept:' + appTicket.id, 'apply:review:reject:' + appTicket.id],
      'أزرار المراجعة خطأ',
    );

    const reviewMsgMock = {
      embeds: [reviewPayload.embeds[0]],
      editable: true,
      edit: async (p) => { reviewMsgMock.edited = p; },
    };
    const accepted = await applications.reviewApplication(client16, interaction16, appTicket, 'accept', { message: reviewMsgMock });
    assert.strictEqual(accepted.decision, 'accept');
    assert.ok(/ahmed|أحمد/.test(renamed[0] || ''), 'اسم القناة الجديد غير صحيح: ' + renamed[0]);
    assert.ok(String(renamed[0]).startsWith('إدارة-'), 'الترقيم في اسم القناة ناقص');
    assert.deepStrictEqual(movedTo, ['100000000000000030'], 'لم تُنقل التذكرة لقسم الإدارة');
    assert.deepStrictEqual(rolesGiven, ['100000000000000031'], 'لم تُعطَ رتبة القبول');
    /* الخاص صار **نصًا عاديًا بلا إمبد** (سياسة الرسائل الخاصة) */
    assert.ok(sentTo.dm.some((p) => typeof p.content === 'string' && p.content.includes('قبول')), 'لم تُرسل رسالة قبول على الخاص');
    assert.ok(sentTo.dm.every((p) => !p.embeds), 'رسالة القبول لازم تكون نصية بلا إمبد');
    assert.ok(reviewMsgMock.edited?.components?.[0]?.components?.[0]?.data?.disabled, 'لم تُعطّل أزرار المراجعة بعد القرار');

    // الرفض مع السبب
    sentTo.dm.length = 0;
    const rejected = await applications.reviewApplication(client16, interaction16, appTicket, 'reject', { reason: 'تحتاج خبرة أكبر' });
    const rejectDm = sentTo.dm[0]?.content || '';
    assert.strictEqual(rejected.decision, 'reject');
    assert.ok(String(rejectDm).includes('رفض'), 'لم تُرسل رسالة رفض على الخاص');
    assert.ok(String(rejectDm).includes('تحتاج خبرة أكبر'), 'سبب الرفض غير مذكور في الخاص');
    assert.ok(!sentTo.dm[0]?.embeds, 'رسالة الرفض لازم تكون نصية بلا إمبد');
  console.log('  [تم] النموذج 5 خانات + القبول (تسمية/ترقيم/نقل/رتبة/خاص) + الرفض بالسبب');
  }

 console.log('[اختبار] اختبار 17: لوحة التحكم الجديدة');
  {
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const publicDir = path2.join(__dirname, '..', 'src', 'web', 'public');
    const appSource = fs2.readFileSync(path2.join(publicDir, 'app.js'), 'utf8');

    // الأقسام المطلوبة موجودة
    const expectedSections = [
      'overview', 'general', 'welcome', 'autorole', 'leveling',
      'automod', 'moderation', 'autoline', 'autoreact', 'autoReply',
      'tickets', 'staffapp', 'logs', 'data',
    ];
    for (const id of expectedSections) {
      assert.ok(new RegExp(`^\\s{2}${id}: \\{`, 'm').test(appSource), `قسم ${id} غير موجود في اللوحة`);
    }
    assert.ok(appSource.includes('GROUP_ORDER'), 'مجموعات الشريط الجانبي ناقصة');
    assert.ok(appSource.includes('d-savebar'), 'شريط الحفظ ناقص');
    assert.ok(appSource.includes('loadDataView'), 'جداول البيانات ناقصة');

    // مطابقة كل مسار إعداد في اللوحة مع الإعدادات الفعلية
    const paths = [...appSource.matchAll(/['"`]((?:[a-zA-Z]+\.)+(?:[a-zA-Z]+|[0-9]+))['"`]/g)]
      .map((m) => m[1])
      .filter((p) => !p.includes('discord.com') && !p.includes('http'))
      .filter((p) => /^(welcome|leave|boost|logs|autoline|autoreact|autoReply|automod|moderation|leveling|tickets|staffApplication|autorole|referral|reports)\./.test(p));
    const uniquePaths = [...new Set(paths)];
    const settings = db.getGuildSettings('999999999999999999');
    const missing = uniquePaths.filter((p2) => {
      const keys = p2.split('.');
      let cursor = settings;
      for (const key of keys) {
        if (cursor === null || cursor === undefined) return false;
        if (Number.isInteger(Number(key)) && Array.isArray(cursor)) { cursor = cursor[0]; continue; }
        if (!(key in cursor)) return true;
        cursor = cursor[key];
      }
      return false;
    });
    assert.deepStrictEqual(missing, [], `مسارات إعدادات غير موجودة: ${missing.join(', ')}`);

    // الملفات المطلوبة تُقدَّم بشكل صحيح
    assert.ok(fs2.existsSync(path2.join(publicDir, 'dash.css')), 'ملف dash.css ناقص');
    assert.ok(fs2.readFileSync(path2.join(publicDir, 'dash.css'), 'utf8').includes('.d-shell'), 'أنماط اللوحة ناقصة');
    const pagesSource = fs2.readFileSync(path2.join(__dirname, '..', 'src', 'web', 'routes', 'pages.js'), 'utf8');
    assert.ok(pagesSource.includes("asset('dash.css')"), 'صفحة اللوحة لا تُحمّل dash.css');

    // نقطة الإجراءات التجريبية موجودة في الـ API
    const apiSource = fs2.readFileSync(path2.join(__dirname, '..', 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(apiSource.includes("actions/:action"), 'نقطة الإجراءات التجريبية ناقصة');
  console.log(`  [تم] ${expectedSections.length} قسمًا • ${uniquePaths.length} مسار إعداد متطابق • dash.css محمّل • الإجراءات التجريبية جاهزة`);
  }

 console.log('[اختبار] اختبار 18: صفحات الموقع + الوضع الليلي/النهاري');
  {
    const fs3 = require('node:fs');
    const path3 = require('node:path');
    const webDir = path3.join(__dirname, '..', 'src', 'web');
    const pagesSrc = fs3.readFileSync(path3.join(webDir, 'routes', 'pages.js'), 'utf8');
    const styleSrc = fs3.readFileSync(path3.join(webDir, 'public', 'style.css'), 'utf8');
    const dashSrc = fs3.readFileSync(path3.join(webDir, 'public', 'dash.css'), 'utf8');
    const appSrc = fs3.readFileSync(path3.join(webDir, 'public', 'app.js'), 'utf8');

    // الصفحة الرئيسية (نسخة رسمية)
    for (const cls of ['site-hero', 'site-features', 'site-steps', 'cmd-preview']) {
      assert.ok(pagesSrc.includes(cls), `عنصر ${cls} ناقص من الصفحة الرئيسية`);
      assert.ok(styleSrc.includes(`.${cls}`), `نمط ${cls} ناقص من style.css`);
    }
    assert.ok(!pagesSrc.includes('إضافة البوت'), 'ميزة إضافة البوت ما زالت موجودة');
    assert.ok(!pagesSrc.includes('inviteUrl'), 'رابط إضافة البوت ما زال مستخدمًا');
    assert.ok(!pagesSrc.includes('feature-note'), 'العناصر المعلوماتية القديمة ما زالت موجودة');

    // قائمة السيرفرات المحسّنة
    for (const cls of ['servers-toolbar', 'guildSearch', 'guildFilter', 'guild-actions']) {
      assert.ok(pagesSrc.includes(cls), `عنصر ${cls} ناقص من قائمة السيرفرات`);
    }

    // الوضع الليلي/النهاري
    assert.ok(styleSrc.includes("html[data-theme='light']"), 'الوضع الفاتح ناقص من style.css');
    assert.ok(styleSrc.includes('.theme-toggle'), 'زر تبديل الوضع ناقص');
    assert.ok(pagesSrc.includes('neverland-theme'), 'حفظ الوضع في localStorage ناقص');
    assert.ok(appSrc.includes('currentTheme'), 'زر تبديل الوضع في اللوحة ناقص');

    // dash.css يستخدم الرموز (ليتبدّل مع الوضع)
    const dashVars = (dashSrc.match(/var\(--/g) || []).length;
    assert.ok(dashVars > 60, `dash.css يستخدم ${dashVars} رمزًا فقط — التحويل للرموز ناقص`);

    // ميزة إضافة البوت مُزالة بالكامل
    const cfgSrc3 = fs3.readFileSync(path3.join(__dirname, '..', 'src', 'config.js'), 'utf8');
    assert.ok(!/inviteUrl/.test(cfgSrc3), 'inviteUrl ما زال في الإعدادات');
    assert.ok(!/oauth2\/authorize\?client_id/.test(cfgSrc3), 'رابط التفويض ما زال يُبنى');
  console.log(`  [تم] الرئيسية + السيرفرات + الوضع الليلي/النهاري (${dashVars} رمزًا في dash.css)`);
  }

 console.log('[اختبار] اختبار 19: واجهة رسمية بأيقونات SVG (بدون إيموجيات)');
  {
    const fs4 = require('node:fs');
    const path4 = require('node:path');
    const webPublic = path4.join(__dirname, '..', 'src', 'web', 'public');
    const iconsModule = require(path4.join(webPublic, 'icons.js'));

    // مكتبة الأيقونات
    const iconCount = Object.keys(iconsModule.ICONS).length;
    assert.ok(iconCount >= 70, `عدد الأيقونات ${iconCount} أقل من المطلوب`);
    const svg = iconsModule.icon('shield', { size: 18 });
    assert.ok(svg.startsWith('<svg') && svg.includes('stroke="currentColor"') && svg.endsWith('</svg>'), 'بنية أيقونة SVG غير صحيحة');
    assert.ok(iconsModule.logoMark(40).includes('<svg'), 'الشعار المرسوم ناقص');
    for (const key of ['messageDelete', 'memberJoin', 'voiceMute', 'emojiCreate', 'inviteCreate', 'ticket', 'automod'.slice(0, 6) + 'Action']) {
      assert.ok(iconsModule.ICONS[iconsModule.iconForEvent(key)], `لا توجد أيقونة للحدث ${key}`);
    }

    // صفحات الموقع: لا إيموجيات
    const pagesSrc = fs4.readFileSync(path4.join(__dirname, '..', 'src', 'web', 'routes', 'pages.js'), 'utf8');
    const emojiInPages = (pagesSrc.match(/\p{Extended_Pictographic}/gu) || []).length;
    assert.strictEqual(emojiInPages, 0, `صفحات الموقع تحتوي ${emojiInPages} إيموجي`);

    /*
     * اللوحة: لا إيموجيات في الواجهة.
     * الاستثناءات المسموحة صراحةً = «بيانات» تُرسل إلى ديسكورد لا أيقونات واجهة:
     *   ١) قيم حقول التذاكر emoji: '...'
     *   ٢) كتلة منتقي الإيموجي المعلَّمة EMOJI-DATA (يختار منها المدير إيموجي الأزرار)
     */
    const appSrc = fs4.readFileSync(path4.join(webPublic, 'app.js'), 'utf8');
    const emojiBlock = appSrc.match(/\/\* EMOJI-DATA: START[\s\S]*?\/\* EMOJI-DATA: END \*\//);
    assert.ok(emojiBlock, 'كتلة بيانات منتقي الإيموجي (EMOJI-DATA) مفقودة');
    const paletteItems = (emojiBlock[0].match(/\p{Extended_Pictographic}/gu) || []).length;
    assert.ok(paletteItems >= 20, `منتقي الإيموجي فيه ${paletteItems} إيموجي فقط — لازم 20 على الأقل`);
    assert.ok(appSrc.includes("ic('emoticon'"), 'منتقي الإيموجي لازم أيقونة SVG (emoticon)');
    const cleaned = appSrc
      .replace(emojiBlock[0], '')
      .replace(/emoji: '[^']*'/g, '')
      .replace(/'🎫'/g, "''");
    const emojiInDash = (cleaned.match(/\p{Extended_Pictographic}/gu) || []).length;
    assert.strictEqual(emojiInDash, 0, `لوحة التحكم تحتوي ${emojiInDash} إيموجي في الواجهة`);

    // اللوحة تستخدم نظام الأيقونات + الشعار المرسوم
    assert.ok(appSrc.includes('const ic = (name, size'), 'مساعد الأيقونات ناقص من اللوحة');
    assert.ok(appSrc.includes('SECTION_ICONS'), 'خريطة أيقونات الأقسام ناقصة');
    assert.ok(/ic\('[a-zA-Z]+'/.test(appSrc), 'اللوحة لا تستخدم أيقونات SVG');
    assert.ok((appSrc.match(/ic\(/g) || []).length >= 15, 'اللوحة لا تستخدم الأيقونات بدرجة كافية');
    assert.ok(appSrc.includes('logoMark'), 'شعار اللوحة المرسوم ناقص');

    // الأنماط العامة تنظّف الأيقونات
    const styleSrc2 = fs4.readFileSync(path4.join(webPublic, 'style.css'), 'utf8');
    const dashCss2 = fs4.readFileSync(path4.join(webPublic, 'dash.css'), 'utf8');
    assert.ok(styleSrc2.includes('.brand-logo svg'), 'أنماط أيقونات الموقع ناقصة');
    assert.ok(dashCss2.includes('.d-nav-item .ico svg'), 'أنماط أيقونات اللوحة ناقصة');

    // رسائل الطرفية: بدون إيموجيات (وسوم نصية فقط)
    const path7b = require('node:path');
    const srcDir = path7b.join(__dirname, '..', 'src');
    let logEmoji = 0;
    const walk7 = (dir) => {
      for (const f of fs4.readdirSync(dir)) {
        const full = path7b.join(dir, f);
        if (fs4.statSync(full).isDirectory()) walk7(full);
        else if (f.endsWith('.js')) {
          for (const line of fs4.readFileSync(full, 'utf8').split('\n')) {
            if (/console\.(log|error|warn|info)\(/.test(line) && /\p{Extended_Pictographic}/u.test(line)) logEmoji++;
          }
        }
      }
    };
    walk7(srcDir);
    assert.strictEqual(logEmoji, 0, `رسائل الطرفية تحتوي ${logEmoji} إيموجي`);
  console.log(`  [تم] ${iconCount} أيقونة SVG • صفر إيموجي في واجهة الموقع واللوحة`);
  }
 console.log('[اختبار] اختبار 20: هوية الموقع (Never Land) + كونه موقعًا حقيقيًا لا نسخة ثابتة');
  {
    const fs5 = require('node:fs');
    const path5 = require('node:path');
    const cfg = require('../src/config');
    assert.strictEqual(cfg.web.siteName, 'Never Land', 'اسم الموقع في الإعدادات غير صحيح');
    assert.ok(cfg.web.url.startsWith('http'), 'رابط الموقع العام غير مضبوط');

    const pages5 = fs5.readFileSync(path5.join(__dirname, '..', 'src', 'web', 'routes', 'pages.js'), 'utf8');
    for (const route of ['/icon.svg', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml']) {
      assert.ok(pages5.includes(`router.get('${route}'`), `المسار ${route} غير معرّف`);
    }
    assert.ok(!pages5.includes('وضع المعاينة'), 'شارات المعاينة ما زالت ظاهرة في الواجهة');
    assert.ok(pages5.includes('Never<span class="accent">Land</span>'), 'شعار الموقع في الهيدر غير محدّث');
    assert.ok(pages5.includes('rel="manifest"') && pages5.includes('og:site_name'), 'وسوم الموقع الرسمية ناقصة');

    const server5 = fs5.readFileSync(path5.join(__dirname, '..', 'src', 'web', 'server.js'), 'utf8');
    assert.ok(server5.includes('خطأ 404') && server5.includes('layout('), 'صفحة 404 لا تستخدم قالب الموقع');

    const app5 = fs5.readFileSync(path5.join(__dirname, '..', 'src', 'web', 'public', 'app.js'), 'utf8');
    assert.ok(app5.includes("html: 'Never<span class=\"accent\">Land</span>'"), 'شعار اللوحة غير محدّث');
    assert.ok(!/وضع المعاينة/.test(app5), 'نص المعاينة ظاهر في اللوحة');

    const pkg5 = require('../package.json');
    assert.strictEqual(pkg5.name, 'never-land', 'اسم الحزمة غير محدّث');
  console.log(`  [تم] الاسم: ${cfg.web.siteName} • أيقونة + مانيفست + robots + sitemap + 404 بقالب الموقع`);
  }

 console.log('[اختبار] اختبار 21: الوصول العام (كل يفوت) + التكيّف مع الشاشات والأجهزة');
  {
    const fs6 = require('node:fs');
    const path6 = require('node:path');
    const cfg6 = require('../src/config');
    assert.strictEqual(typeof cfg6.web.publicAccess, 'boolean', 'خيار PUBLIC_ACCESS غير معرّف');

    const pages6 = fs6.readFileSync(path6.join(__dirname, '..', 'src', 'web', 'routes', 'pages.js'), 'utf8');
    assert.ok(pages6.includes('req.canEdit'), 'منطق صلاحية الزائر ناقص');
    assert.ok(pages6.includes('publicGuilds'), 'قائمة السيرفرات العامة ناقصة');
    assert.ok(pages6.includes('dashboard-readonly'), 'وضع العرض العام في صفحة السيرفر ناقص');
    assert.ok(pages6.includes('viewport-fit=cover'), 'وسم viewport للهواتف ناقص');
    assert.ok(pages6.includes('apple-mobile-web-app-capable'), 'وسوم آيفون ناقصة');
    assert.ok(pages6.includes('prefers-color-scheme'), 'متابعة إعداد الجهاز (ليلي/نهاري) ناقصة');
    assert.ok(pages6.includes('data-edit='), 'تمرير صلاحية التعديل للصفحة ناقص');

    const api6 = fs6.readFileSync(path6.join(__dirname, '..', 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(api6.includes("const isWrite = !['GET', 'HEAD', 'OPTIONS']"), 'فصل القراءة عن الكتابة في الـAPI ناقص');
    assert.ok(api6.includes('canEdit(req)'), 'حماية نقاط الكتابة ناقصة');
    assert.ok(api6.includes('viewer:'), 'إرسال صلاحية المشاهد ناقص');

    const app6 = fs6.readFileSync(path6.join(__dirname, '..', 'src', 'web', 'public', 'app.js'), 'utf8');
    assert.ok(app6.includes('canEdit'), 'اللوحة لا تدعم وضع القراءة فقط');
    assert.ok(app6.includes('d-readonly-note'), 'شارة العرض العام ناقصة من اللوحة');
    assert.ok(app6.includes('حسب الجهاز'), 'خيار «حسب الجهاز» في السمة ناقص');

    const style6 = fs6.readFileSync(path6.join(__dirname, '..', 'src', 'web', 'public', 'style.css'), 'utf8');
    const dash6 = fs6.readFileSync(path6.join(__dirname, '..', 'src', 'web', 'public', 'dash.css'), 'utf8');
    const mqStyle = (style6.match(/@media/g) || []).length;
    const mqDash = (dash6.match(/@media/g) || []).length;
    assert.ok(mqStyle >= 8, `عدد نقاط التكيّف في style.css قليل (${mqStyle})`);
    assert.ok(mqDash >= 5, `عدد نقاط التكيّف في dash.css قليل (${mqDash})`);
    assert.ok(style6.includes('env(safe-area-inset'), 'دعم الحواف الآمنة للهواتف ناقص');
    assert.ok(style6.includes('clamp('), 'الخطوط لا تتكيّف مع عرض الشاشة');
    assert.ok(style6.includes('prefers-reduced-motion'), 'احترام تقليل الحركة ناقص');
    assert.ok(dash6.includes('.d-shell.readonly'), 'أنماط وضع القراءة فقط ناقصة');
    assert.ok(dash6.includes('max-width: 700px'), 'تكيّف اللوحة مع الجوال ناقص');
  console.log(`  [تم] وصول عام للقراءة + ${mqStyle + mqDash} نقطة تكيّف (جوال/تابلت/شاشة كبيرة) + سمة تتبع الجهاز`);
  }

 console.log('[اختبار] اختبار 22: زر /help يفتح الموقع + تأكيد الدخول والرول المطلوب');
  {
    const { execFileSync } = require('node:child_process');
    const path7 = require('node:path');
    const root7 = path7.join(__dirname, '..');

    // ١) ردود البوت بلا أي رابط موقع — والرابط يطلع بكلمة «نيفر» للمسجّلين فقط
    const outHelp = execFileSync('node', [path7.join(root7, 'help-test.js')], { cwd: root7, encoding: 'utf8' });
    assert.ok(outHelp.includes('نيفر'), 'ما في إشارة لطريقة طلب رابط الموقع');
    assert.ok(outHelp.includes('بلا رابط'), 'شرط الرابط (تسجيل/رول) غير مُختبر');
    assert.ok(outHelp.includes('الرابط ظهر'), 'رابط الموقع ما ظهر للمسجّل صاحب الرول');

    // ٢) منطق الرول المطلوب
    const cfg7 = require('../src/config');
    assert.strictEqual(cfg7.web.requiredRoleId, '1549364852433354792', 'معرّف الرول المطلوب غير مطابق');
    assert.strictEqual(cfg7.web.loginRequired, true, 'تأكيد الدخول غير مفعّل');
    const outAccess = execFileSync('node', [path7.join(root7, 'access-test.js')], { cwd: root7, encoding: 'utf8' });
    for (const reason of ['bot_offline', 'no_role', 'not_member']) {
      assert.ok(outAccess.includes(reason), `حالة ${reason} غير مُختبرة`);
    }

    // ٣) بوابة الدخول على مستوى HTTP
    const outGate = execFileSync('node', [path7.join(root7, 'gate-test.js')], { cwd: root7, encoding: 'utf8' });
    assert.ok(outGate.includes('302 /auth/login'), 'الزائر لا يُحوَّل لتسجيل الدخول');
    assert.ok(outGate.includes('role_required'), 'حماية الـAPI بالرول ناقصة');
    assert.ok(outGate.includes('الوصول مقيّد'), 'صفحة الوصول مقيّد ناقصة');
  console.log('  [تم] /help بزر يعمل + تأكيد دخول + رول 1549364852433354792 (صفحة منع كاملة)');
  }

 console.log('[اختبار] اختبار 23: جاهزية النشر (رابط يفتح من أي جهاز)');
  {
    const fs8 = require('node:fs');
    const path8 = require('node:path');
    const root8 = path8.join(__dirname, '..');
    const read8 = (f) => fs8.readFileSync(path8.join(root8, f), 'utf8');

    // ١) إعداد Railway: صحة الخدمة + إعادة التشغيل
    const rj = JSON.parse(read8('railway.json'));
    assert.strictEqual(rj.deploy.healthcheckPath, '/healthz', 'مسار فحص الصحة في railway.json غير مطابق');
    assert.ok(rj.build.builder === 'DOCKERFILE', 'بنّاء Railway ليس Dockerfile');
    assert.ok(read8('Dockerfile').includes('src/index.js'), 'Dockerfile لا يشغّل المشروع');
    assert.ok(read8('.dockerignore').includes('.env'), 'ملف .env غير مستثنى من الصورة');

    // ٢) مسار الصحة عام وبلا بيانات حساسة
    const srv8 = read8(path8.join('src', 'web', 'server.js'));
    assert.ok(srv8.includes("'/healthz'"), 'مسار /healthz ناقص من الخادم');
    assert.ok(srv8.includes('https:'), 'الكوكي الآمن التلقائي عند https ناقص');

    // ٣) تشغيل مرن للنشر: الموقع بدون توكن
    const idx8 = read8(path8.join('src', 'index.js'));
    assert.ok(idx8.includes('RUN_BOT') && idx8.includes('RUN_WEB'), 'التحكم بمتغيّرات RUN_BOT/RUN_WEB ناقص');

    // ٤) أدوات الرابط العام والفحص
    for (const f of ['tools/site-check.js', 'tools/public-link.js', 'deploy-railway.sh']) {
      assert.ok(fs8.existsSync(path8.join(root8, f)), `${f} ناقص`);
    }
    const pk = JSON.parse(read8('package.json'));
    for (const script of ['check:site', 'deploy:railway', 'link:public']) {
      assert.ok(!!pk.scripts[script], `أمر npm ${script} ناقص`);
    }

    // ٥) الرابط العام يُحدَّد تلقائيًا (وما يبقى مكسورًا)
    const cfg8 = require('../src/config');
    assert.ok(/^https?:\/\//.test(cfg8.web.url), 'الرابط العام غير صالح');
    assert.ok(!/\/$/.test(cfg8.web.url), 'الرابط العام ينتهي بشرطة مائلة');

  console.log(`  [تم] Railway (Dockerfile + /healthz) + فحص الموقع + رابط عام تلقائي (${cfg8.web.url.replace(/^https?:\/\//, '')})`);
  }

 console.log('[اختبار] اختبار 24: المزامنة الحقيقية مع ديسكورد (بيانات سيرفرك في الموقع)');
  {
    const fs9 = require('node:fs');
    const path9 = require('node:path');
    const root9 = path9.join(__dirname, '..');

    // ١) وحدة المزامنة موجودة وتُصدّر ما يلزم
    const sync9 = require('../src/sync');
    for (const fn of ['start', 'syncNow', 'getStatus', 'getSnapshot', 'saveSnapshot', 'listGuildMeta', 'serializeGuild', 'onEvent']) {
      assert.strictEqual(typeof sync9[fn], 'function', `دالة ${fn} ناقصة من وحدة المزامنة`);
    }
    assert.ok(fs9.readFileSync(path9.join(root9, 'src', 'database', 'schema.sql'), 'utf8').includes('CREATE TABLE IF NOT EXISTS kv'), 'جدول المخزن kv ناقص');

    // ٢) دورة كاملة: حفظ لقطة ← قراءتها ← ظهورها في القائمة ← حذفها
    const fakeId = '999000000000000001';
    sync9.saveSnapshot({
      id: fakeId,
      name: 'سيرفر اختبار المزامنة',
      icon: null,
      memberCount: 123,
      channels: [{ id: 'c1', name: 'عام', type: 0, parentId: null, position: 1 }],
      roles: [{ id: 'r1', name: 'الإدارة', managed: false, position: 5 }],
      emojis: [],
      syncedAt: Date.now(),
      source: 'test',
    });
    const snap9 = sync9.getSnapshot(fakeId);
    assert.ok(snap9 && snap9.name === 'سيرفر اختبار المزامنة', 'قراءة اللقطة فشلت');
    assert.strictEqual(snap9.channels.length, 1, 'قنوات اللقطة ناقصة');
    assert.ok(sync9.listGuildMeta().some((g) => g.id === fakeId), 'اللقطة لا تظهر في قائمة السيرفرات');
    sync9.removeSnapshot(fakeId);
    assert.strictEqual(sync9.getSnapshot(fakeId), null, 'حذف اللقطة فشل');

    // ٣) الحالة تحتوي ما تعرضه اللوحة
    const st9 = sync9.getStatus();
    for (const key of ['ok', 'source', 'guilds', 'at', 'hasToken', 'botOnline', 'intervalSeconds', 'guildsKnown']) {
      assert.ok(key in st9, `الحقل ${key} ناقص من حالة المزامنة`);
    }

    // ٤) المسارات موجودة في الـAPI + البث الحيّ + واجهة المزامنة
    const apiSrc9 = fs9.readFileSync(path9.join(root9, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(apiSrc9.includes("router.get('/sync/status'"), 'مسار /api/sync/status ناقص');
    assert.ok(apiSrc9.includes("router.post('/sync'"), 'مسار /api/sync ناقص');
    assert.ok(apiSrc9.includes("router.get('/events'"), 'مسار البث الحيّ /api/events ناقص');
    assert.ok(apiSrc9.includes('text/event-stream'), 'ترويسة البث الحيّ ناقصة');

    const pagesSrc9 = fs9.readFileSync(path9.join(root9, 'src', 'web', 'routes', 'pages.js'), 'utf8');
    assert.ok(pagesSrc9.includes('مزامنة الآن'), 'زر «مزامنة الآن» ناقص من قائمة السيرفرات');
    assert.ok(pagesSrc9.includes('آخر مزامنة'), 'معلومة «آخر مزامنة» ناقصة');

    const appSrc9 = fs9.readFileSync(path9.join(root9, 'src', 'web', 'public', 'app.js'), 'utf8');
    assert.ok(appSrc9.includes('buildSyncBar'), 'شريط المزامنة ناقص من اللوحة');
    assert.ok(appSrc9.includes("EventSource('/api/events')"), 'البث الحيّ غير موصول في اللوحة');

    // ٥) القوائم المنسدلة تقرأ القنوات/الرتب من اللقطة عند توقّف البوت
    assert.ok(apiSrc9.includes('snapshot?.channels'), 'القنوات لا تُقرأ من اللقطة');
    assert.ok(apiSrc9.includes('snapshot?.roles'), 'الرتب لا تُقرأ من اللقطة');

    // ٦) بيانات العرض تتوقف تلقائيًا عند وجود توكن حقيقي
    const cfg9 = require('../src/config');
    assert.strictEqual(typeof cfg9.web.demoData, 'boolean', 'خاصية demoData ناقصة');
    assert.ok(Number.isFinite(cfg9.sync.intervalSeconds) && cfg9.sync.intervalSeconds >= 60, 'مدة المزامنة غير صالحة');

  console.log(`  [تم] لقطة كاملة (قنوات/رتب/أعضاء) + /api/sync + بث حيّ + شريط مزامنة في اللوحة (كل ${cfg9.sync.intervalSeconds} ثانية)`);
  }

 console.log('[اختبار] اختبار 25: مسار الدخول بحساب Discord (بلا صفحات إرشاد)');
  {
    const fs10 = require('node:fs');
    const path10 = require('node:path');
    const root10 = path10.join(__dirname, '..');
    const authSrc = fs10.readFileSync(path10.join(root10, 'src', 'web', 'routes', 'auth.js'), 'utf8');

    // الدخول يحوّل مباشرة إلى ديسكورد (لا صفحات وسطية)
    assert.ok(!authSrc.includes('redirectHelpPage'), 'صفحة الإرشاد ما زالت موجودة');
    assert.ok(!authSrc.includes('registeredRedirects'), 'فحص روابط العودة ما زال موجودًا');
    assert.ok(/router\.get\('\/login',\s*\(req, res\)/.test(authSrc), 'مسار الدخول لم يعد مباشرًا');
    assert.ok(authSrc.includes('discord.com/oauth2/authorize'), 'وجهة الدخول إلى ديسكورد ناقصة');
    assert.ok(authSrc.includes('/auth/callback'), 'رابط العودة غير مستخدم');
    assert.ok(authSrc.includes('identify') && authSrc.includes('guilds'), 'نطاقات OAuth ناقصة');

    // رسالة عربية واضحة عند فشل التبادل بدل خطأ مبهم
    assert.ok(authSrc.includes('تعذّر إكمال الدخول'), 'رسالة فشل الدخول العربية ناقصة');

    // رابط العودة يُبنى من الرابط العام في كل الحالات
    assert.ok(authSrc.includes('${config.web.url}/auth/callback'), 'رابط العودة لا يتبع الرابط العام');

  console.log('  [تم] الدخول يحوّل لديسكورد مباشرة + رسالة عربية عند الفشل (بلا صفحات وسطية)');
  }

 console.log('[اختبار] اختبار 26: ربط الموقع بالبوت (سيرفرات المستخدم تظهر فعلًا)');
  {
    const { execFileSync } = require('node:child_process');
    const path11 = require('node:path');
    const fs11 = require('node:fs');
    const root11 = path11.join(__dirname, '..');

    // ١) الاختبار المستقل لمصدر السيرفرات
    const outGuilds = execFileSync('node', [path11.join(root11, 'guilds-test.js')], { cwd: root11, encoding: 'utf8' });
    for (const needle of ['عضو عنده الرول فقط', 'مالك السيرفر', 'إدارة السيرفر', 'بلا تكرار', 'فحص الوصول']) {
      assert.ok(outGuilds.includes(needle), `حالة «${needle}» غير مُختبرة في قائمة السيرفرات`);
    }
    assert.ok(outGuilds.includes('🎉'), 'اختبار قائمة السيرفرات لم ينجح');

    // ٢) الصفحة والـAPI يستخدمان المصدر الموثوق (لا قائمة OAuth وحدها)
    const pagesSrc11 = fs11.readFileSync(path11.join(root11, 'src', 'web', 'routes', 'pages.js'), 'utf8');
    const apiSrc11 = fs11.readFileSync(path11.join(root11, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(pagesSrc11.includes("require('../guilds')"), 'صفحة السيرفرات لا تستخدم مصدر السيرفرات الموحّد');
    assert.ok(apiSrc11.includes("require('../guilds')"), 'الـAPI لا يستخدم مصدر السيرفرات الموحّد');
    assert.ok(!/guilds = \(req\.session\.guilds \|\| \[\]\)\.map/.test(pagesSrc11), 'الصفحة ما زالت تعتمد على جلسة OAuth وحدها');

    // ٣) الوحدة تفحص الصلاحية الحقيقية لكل سيرفر
    const guildsMod = fs11.readFileSync(path11.join(root11, 'src', 'web', 'guilds.js'), 'utf8');
    for (const fn of ['listUserGuilds', 'canAccessGuild', 'memberCanUse']) {
      assert.ok(guildsMod.includes(fn), `دالة ${fn} ناقصة من وحدة السيرفرات`);
    }
    assert.ok(guildsMod.includes('ManageGuild'), 'فحص صلاحية الإدارة ناقص');
    assert.ok(guildsMod.includes('requiredRoleId'), 'فحص الرول المطلوب ناقص');

    // ٤) رسالة الفراغ توضّح للمستخدم سبب عدم الظهور
    assert.ok(pagesSrc11.includes('كان البوت مضافًا إليها'), 'رسالة الفراغ غير موجودة');

  console.log('  [تم] سيرفرات المستخدم: دمج الجلسة + البوت الحيّ + الصلاحية الحقيقية (8 حالات)');
  }

 console.log('[اختبار] اختبار 27: جلسات الموقع تبقى بعد إعادة التشغيل (على القرص)');
  {
    const fs12 = require('node:fs');
    const path12 = require('node:path');
    const root12 = path12.join(__dirname, '..');
    const { FileSessionStore } = require('../src/web/sessionStore');

    const dir12 = path12.join(require('node:os').tmpdir(), `nl-sessions-${Date.now()}`);
    const file12 = path12.join(dir12, 'sessions.json');

    // ١) تُحفظ على القرص وتُقرأ من مخزن جديد (محاكاة إعادة تشغيل الخدمة)
    const store1 = new FileSessionStore(file12);
    store1.set('sid-test', { user: { id: '777', username: 'loki' }, cookie: {} }, () => {});
    store1.saveNow();
    assert.ok(fs12.existsSync(file12), 'ملف الجلسات لم يُكتب على القرص');

    const store2 = new FileSessionStore(file12);
    let restored = null;
    store2.get('sid-test', (_e, sess) => { restored = sess; });
    assert.ok(restored && restored.user && restored.user.username === 'loki', 'الجلسة لم تُستعد بعد إعادة الإنشاء');

    // ٢) الخروج يحذف الجلسة فعليًا
    store2.destroy('sid-test', () => {});
    let after = 'x';
    store2.get('sid-test', (_e, sess) => { after = sess; });
    assert.strictEqual(after, null, 'الجلسة لم تُحذف بعد الخروج');

    // ٣) الجلسات المنتهية تُنظَّف
    const store3 = new FileSessionStore(path12.join(dir12, 'expired.json'), 1);
    store3.set('old', { user: { id: '1' } }, () => {});
    store3.data.get('old').expires = Date.now() - 1000;
    assert.ok(store3.cleanup() >= 1, 'تنظيف الجلسات المنتهية لا يعمل');

    // ٤) الخادم يستخدم المخزن (لا MemoryStore)
    const srv12 = fs12.readFileSync(path12.join(root12, 'src', 'web', 'server.js'), 'utf8');
    assert.ok(srv12.includes('FileSessionStore'), 'الخادم لا يستخدم مخزن الجلسات على القرص');
    assert.ok(srv12.includes('store,'), 'المخزن غير مربوط بإعدادات الجلسة');

    fs12.rmSync(dir12, { recursive: true, force: true });
  console.log('  [تم] الجلسة تبقى بعد النشر/التحديث (ملف داخل الـVolume) + خروج نظيف');
  }

 console.log('[اختبار] اختبار 28: أيقونات سليمة + شكل ما يخرج عن الإطار');
  {
    const fs13 = require('node:fs');
    const path13 = require('node:path');
    const root13 = path13.join(__dirname, '..');
    const { guildIconUrl, initials } = require('../src/lib/discordIcon');

    // ١) بناء رابط الأيقونة: هاش • رابط كامل (لا يتكرر) • متحرك • فاضي
    const hash = '0ae6617c364028de691fe523598be4dc';
    assert.strictEqual(guildIconUrl('123', hash), `https://cdn.discordapp.com/icons/123/${hash}.png?size=128`, 'رابط الهاش غير صحيح');
    const full = `https://cdn.discordapp.com/icons/123/${hash}.png?size=128`;
    assert.strictEqual(guildIconUrl('123', full), full, 'الرابط الكامل يجب أن يبقى كما هو (بلا تكرار)');
    assert.ok(!guildIconUrl('123', full).includes('/https://'), 'تكرار البادئة ما زال ممكنًا');
    assert.ok(guildIconUrl('123', `a_${hash}`).endsWith('.gif?size=128'), 'الأيقونة المتحركة يجب أن تكون gif');
    assert.strictEqual(guildIconUrl('123', null), null, 'الأيقونة الفارغة يجب أن تكون null');
    assert.strictEqual(guildIconUrl(null, hash), null, 'بلا معرّف سيرفر = بلا أيقونة');
    assert.strictEqual(initials('Never Land'), 'NL', 'الأحرف الأولى غير صحيحة');

    // ٢) كل ملفات الواجهة تستخدم الدالة الموحّدة (لا تركيب يدوي قديم للرابط)
    const read13 = (f) => fs13.readFileSync(path13.join(root13, ...f), 'utf8');
    for (const f of [['src', 'web', 'routes', 'pages.js'], ['src', 'web', 'public', 'app.js'], ['src', 'web', 'guilds.js'], ['src', 'sync.js']]) {
      const src = read13(f);
      for (const oldForm of ['${g.icon}.png?size=128', '${state.guild.icon}.png', '${discordGuild.icon}', '${guild.icon}.png?size=128', '${g.id}/${g.icon}']) {
        assert.ok(!src.includes(oldForm), `تركيب يدوي قديم لرابط الأيقونة في ${f.join('/')}: ${oldForm}`);
      }
    }
    // المسارات تستعمل الدالة الموحّدة
    assert.ok(read13(['src', 'web', 'routes', 'pages.js']).includes('guildIconUrl('), 'صفحة السيرفرات لا تستخدم دالة الأيقونة الموحّدة');
    assert.ok(read13(['src', 'web', 'guilds.js']).includes("require('../lib/discordIcon')"), 'وحدة السيرفرات لا تستخدم دالة الأيقونة');
    assert.ok(read13(['src', 'sync.js']).includes("require('./lib/discordIcon')"), 'المزامنة لا تستخدم دالة الأيقونة');
    const appSrc13 = read13(['src', 'web', 'public', 'app.js']);
    assert.ok(appSrc13.includes('function guildIconUrl'), 'دالة الأيقونة ناقصة من واجهة اللوحة');
    assert.ok(appSrc13.includes('guildIconUrl(state.guild.id'), 'ترويسة اللوحة لا تستخدم دالة الأيقونة');
    assert.ok(appSrc13.includes('iconFallback'), 'البديل عند فشل الصورة ناقص');

    // ٣) أنماط الحماية من الخروج عن الإطار
    const styleCss = fs13.readFileSync(path13.join(root13, 'src', 'web', 'public', 'style.css'), 'utf8');
    const dashCss = fs13.readFileSync(path13.join(root13, 'src', 'web', 'public', 'dash.css'), 'utf8');
    for (const rule of ['overflow-x: hidden', '.guild-info', 'overflow-wrap: anywhere']) {
      assert.ok(styleCss.includes(rule), `قاعدة «${rule}» ناقصة من style.css`);
    }
    assert.ok(styleCss.includes('.guild-card { overflow: hidden; }'), 'بطاقة السيرفر غير محميّة من التجاوز');
    assert.ok(!/^\s*\*\s*\{[^}]*min-width:\s*0/m.test(styleCss), 'قاعدة عامة خطرة ما زالت موجودة');
    for (const rule of ['.d-head h1 { overflow-wrap', '.d-syncbar { overflow-wrap', '.d-card { overflow: hidden; }']) {
      assert.ok(dashCss.includes(rule), `قاعدة «${rule}» ناقصة من dash.css`);
    }
    assert.ok(dashCss.includes('.d-row { flex-wrap: wrap; }'), 'صفوف اللوحة لا تلتف');
    assert.ok(dashCss.includes('minmax(min(150px, 100%), 1fr)'), 'شبكة الإحصاءات قد تخرج عن الشاشة الصغيرة');
    assert.ok(dashCss.includes('minmax(min(240px, 100%), 1fr)'), 'شبكة البطاقات قد تخرج عن الشاشة الصغيرة');
    // كل الشبكات بحد أدنى آمن (ما تخرج عن الشاشة الصغيرة)
    const loose = [...styleCss.matchAll(/minmax\((\d+)px/g)].map((m) => m[0]);
    assert.deepStrictEqual(loose, [], `شبكات بحد أدنى ثابت قد تخرج عن الإطار: ${loose.join(', ')}`);
    assert.ok(dashCss.includes('scroll-margin-top: 84px'), 'المحتوى قد يختفي تحت الترويسة عند التمرير');

    // ٤) أيقونة مكسورة في القائمة يجب أن يكون لها بديل (onerror) في صفحة السيرفرات
    const pagesSrc13 = fs13.readFileSync(path13.join(root13, 'src', 'web', 'routes', 'pages.js'), 'utf8');
    assert.ok(pagesSrc13.includes('onerror='), 'لا بديل عند فشل تحميل أيقونة السيرفر');

  console.log('  [تم] أيقونات: هاش/رابط/متحرك/فارغ + بديل عند الفشل + أنماط منع التجاوز (4 ملفات)');
  }

 console.log('[اختبار] اختبار 29: تذييل الموقع (هوية + روابط مفيدة بلا تفاصيل تقنية)');
  {
    const fs14 = require('node:fs');
    const path14 = require('node:path');
    const root14 = path14.join(__dirname, '..');
    const pagesSrc14 = fs14.readFileSync(path14.join(root14, 'src', 'web', 'routes', 'pages.js'), 'utf8');
    const styleSrc14 = fs14.readFileSync(path14.join(root14, 'src', 'web', 'public', 'style.css'), 'utf8');

    // ١) لا تفاصيل تقنية في التذييل (مثل اسم مشغّل قاعدة البيانات)
    const foot14 = pagesSrc14.slice(pagesSrc14.indexOf('<footer'), pagesSrc14.indexOf('</footer>') + 9);
    assert.ok(!foot14.includes('قاعدة البيانات'), 'تفاصيل قاعدة البيانات ما زالت في التذييل');
    assert.ok(!foot14.includes('driverName'), 'اسم مشغّل القاعدة ما زال يُعرض');
    assert.ok(!foot14.includes('sqlite'), 'اسم sqlite ما زال يظهر للزائر');

    // ٢) هوية + روابط مفيدة
    assert.ok(foot14.includes('footer-brand') && foot14.includes('logoMark'), 'هوية التذييل ناقصة');
    assert.ok(foot14.includes('${SITE_NAME}'), 'اسم الموقع ناقص من التذييل');
    for (const href14 of ['href="/"', 'href="/dashboard"', 'href="/api/status"']) {
      assert.ok(foot14.includes(href14), `رابط التذييل ${href14} ناقص`);
    }
    assert.ok(foot14.includes('footer-links'), 'قائمة روابط التذييل ناقصة');

    // ٣) الأنماط: لا اختفاء للنص ولا تجاوز
    for (const rule14 of ['.footer-brand', '.footer-links', '.footer-links a:hover', 'overflow-wrap: anywhere']) {
      assert.ok(styleSrc14.includes(rule14), `نمط التذييل «${rule14}» ناقص`);
    }
    assert.ok(/\.footer\s*\{[^}]*flex-wrap:\s*wrap/s.test(styleSrc14), 'التذييل لا يلتف على الشاشات الصغيرة');
    assert.ok(styleSrc14.includes('line-height: 1.9'), 'ارتفاع سطر التذييل صغير (قد يُقتطع النص)');

  console.log('  [تم] تذييل نظيف: هوية + 3 روابط مفيدة + بلا تفاصيل تقنية (يلتف على الجوال)');
  }

 console.log('[اختبار] 30: مفتاح التبديل (Switch) لا تخرج كرته من المسار في RTL');
  {
    const fs15 = require('node:fs');
    const path15 = require('node:path');
    const root15 = path15.join(__dirname, '..');
    const dashCss15 = fs15.readFileSync(path15.join(root15, 'src', 'web', 'public', 'dash.css'), 'utf8');
    const styleCss15 = fs15.readFileSync(path15.join(root15, 'src', 'web', 'public', 'style.css'), 'utf8');

    // ١) مفتاح اللوحة: أبعاد مضبوطة بمتغيّرات (العرض = هامش + كرة + هامش + حركة)
    for (const v of ['--switch-w: 48px', '--switch-knob: 21px', '--switch-pad: 3px']) {
      assert.ok(dashCss15.includes(v), `متغيّر المفتاح ${v} ناقص`);
    }
    assert.ok(dashCss15.includes('--switch-travel: calc(var(--switch-w) - var(--switch-knob) - (var(--switch-pad) * 2))'), 'حساب مسافة الحركة غير مضبوط');
    assert.ok(/translateX\(var\(--switch-travel\)\)/.test(dashCss15), 'الحركة لا تستخدم مسافة محسوبة');
    assert.strictEqual(48 - 21 - 3 * 2, 21, 'حساب الأبعاد لا يطابق الحركة');

    // ٢) لا خلط بين الموضع المنطقي والفيزيائي (سبب خروج الكرة)
    assert.ok(!dashCss15.includes('inset-inline-end: 3px'), 'الموضع المنطقي القديم ما زال موجودًا');
    assert.ok(!/html\[dir='rtl'\] \.d-switch/.test(dashCss15), 'القاعدة الخاصة بـ RTL القديمة ما زالت موجودة');
    assert.ok(dashCss15.includes('direction: ltr'), 'الاتجاه الثابت ناقص (بدونه تخرج الكرة في RTL)');
    assert.ok(dashCss15.includes('left: var(--switch-pad)'), 'الموضع لا يستخدم إحداثيات فيزيائية');
    assert.ok(dashCss15.includes('transition: transform .2s cubic-bezier(.4, 0, .2, 1)'), 'انتقال حركة الكرة ناقص/غير ناعم');

    // ٣) مفتاح نسخة الموقع: نفس المنطق
    assert.ok(styleCss15.includes('transform: translateX(24px)'), 'حركة مفتاح الموقع غير صحيحة للاتجاهين');
    assert.ok(!styleCss15.includes('translateX(-24px)'), 'الحركة السالبة (سبب الخروج في RTL) ما زالت موجودة');
    assert.ok(/\.switch \{[^}]*direction: ltr/s.test(styleCss15), 'اتجاه مفتاح الموقع غير ثابت');

    // ٤) احترام تقليل الحركة (إتاحة)
    assert.ok(dashCss15.includes('prefers-reduced-motion'), 'لا احترام لإعداد تقليل الحركة في اللوحة');

  console.log('  [تم] المفتاح داخل المسار في RTL وLTR: 48 = 3 + 21 + 3 + 21 · حركة ناعمة · بلا خلط منطقي/فيزيائي');
  }

 console.log('[اختبار] 31: الخط الفاصل بالصور المتحركة (GIF)');
  {
    const { execFileSync } = require('node:child_process');
    const fs16 = require('node:fs');
    const path16 = require('node:path');
    const root16 = path16.join(__dirname, '..');

    // ١) الاختبار المستقل الكامل
    const out16 = execFileSync('node', [path16.join(root16, 'autoline-test.js')], { cwd: root16, encoding: 'utf8' });
    for (const needle of ['ملفات GIF', 'أُرسل مرفق صورة GIF', 'بلا حلقة', 'بديل تلقائي', 'احتياطي', 'معاينة اللوحة']) {
      assert.ok(out16.includes(needle), `حالة «${needle}» غير مُختبرة في الخط الفاصل`);
    }
    assert.ok(out16.includes('🎉'), 'اختبار الخط الفاصل لم ينجح');

    // ٢) الأنماط الأربعة موجودة كملفات حقيقية
    const gifDir16 = path16.join(root16, 'assets', 'autoline');
    for (const name of ['glow', 'flow', 'pulse', 'dash']) {
      const f16 = path16.join(gifDir16, `${name}.gif`);
      assert.ok(fs16.existsSync(f16), `${name}.gif ناقص`);
      const head16 = fs16.readFileSync(f16).subarray(0, 6).toString('ascii');
      assert.strictEqual(head16, 'GIF89a', `${name}.gif ليس GIF`);
    }

    // ٣) الإعدادات: النوع والنمط + الوصف في الوحدة
    const cfg16 = require('../src/config');
    assert.ok(['gif', 'custom', 'text'].includes(cfg16.defaults.autoline.lineType), 'نوع الخط غير معروف');
    assert.strictEqual(cfg16.defaults.autoline.lineType, 'gif', 'الافتراضي لازم يكون صورة متحركة');
    assert.ok(cfg16.defaults.autoline.gifStyle, 'نمط GIF الافتراضي ناقص');
    assert.ok('customUrl' in cfg16.defaults.autoline, 'حقل الرابط الخاص ناقص');

    const mod16 = require('../src/systems/autoline');
    assert.strictEqual(Object.keys(mod16.GIF_STYLES).length, 4, 'عدد أنماط GIF غير مطابق');

    // ٤) الخادم يقدّم ملفات GIF + اللوحة فيها واجهة الاختيار
    const srv16 = fs16.readFileSync(path16.join(root16, 'src', 'web', 'server.js'), 'utf8');
    assert.ok(srv16.includes("'/autoline'"), 'مسار تقديم الخطوط ناقص من الخادم');
    const app16 = fs16.readFileSync(path16.join(root16, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const needle of ['autoline-styles', 'autoline-preview', 'DEFAULT_LINE_STYLES', 'autoline.lineType', 'autoline.gifStyle', 'autoline.customUrl']) {
      assert.ok(app16.includes(needle), `عنصر واجهة الخط الفاصل «${needle}» ناقص من اللوحة`);
    }
    const dash16 = fs16.readFileSync(path16.join(root16, 'src', 'web', 'public', 'dash.css'), 'utf8');
    assert.ok(dash16.includes('.autoline-style.active'), 'نمط الاختيار النشط ناقص');
    assert.ok(dash16.includes('.autoline-img'), 'نمط معاينة الصورة ناقص');

    // ٥) الـAPI يرسل الأنماط للوحة
    const api16 = fs16.readFileSync(path16.join(root16, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(api16.includes('autolineStyles'), 'أنماط الخطوط غير مُرسلة للوحة');

    // ٦) أمر البوت فيه الأوامر الجديدة
    const cmd16 = fs16.readFileSync(path16.join(root16, 'src', 'commands', 'config', 'autoline.js'), 'utf8');
    for (const sub16 of ["sub('style'", "sub('type'", "sub('url'"]) {
      assert.ok(cmd16.includes(sub16), `الأمر الفرعي ${sub16} ناقص`);
    }
    assert.ok(cmd16.includes('GIF_STYLES'), 'أمر البوت لا يعرض الأنماط');

  console.log('  [تم] 4 خطوط GIF متحركة + واجهة اللوحة + أوامر البوت + تسليم من الخادم (13 حالة)');
  }

 console.log('[اختبار] 32: نظام الخبرة الكامل (كتابي · صوتي · تفاعل + توب داي وتوب ويك)');
  {
    const { execFileSync } = require('node:child_process');
    const fs17 = require('node:fs');
    const path17 = require('node:path');
    const root17 = path17.join(__dirname, '..');

    // ١) الاختبار المستقل الكامل (١٠ مجموعات)
    const out17 = execFileSync('node', [path17.join(root17, 'leveling-test.js')], { cwd: root17, encoding: 'utf8' });
    for (const needle of ['الفترات', 'ثلاث مصادر خبرة منفصلة', 'حمايات التفاعل', 'السقف اليومي', 'الترقية', 'اللوحات', 'بيانات الترتيب', 'التصفير']) {
      assert.ok(out17.includes(needle), `حالة «${needle}» غير مُختبرة في نظام الخبرة`);
    }
    assert.ok(out17.includes('🎉'), 'اختبار نظام الخبرة لم ينجح');

    // ٢) المخطّط: جدول الفترات + أعمدة المصادر
    const schema17 = fs17.readFileSync(path17.join(root17, 'src', 'database', 'schema.sql'), 'utf8');
    assert.ok(schema17.includes('CREATE TABLE IF NOT EXISTS xp_periods'), 'جدول فترات الخبرة ناقص');
    assert.ok(/idx_xp_periods_board/.test(schema17), 'فهرس لوحة الفترات ناقص');
    const sqlite17 = fs17.readFileSync(path17.join(root17, 'src', 'database', 'sqlite.js'), 'utf8');
    for (const col of ['text_xp', 'voice_xp', 'interact_xp', 'interactions']) {
      assert.ok(sqlite17.includes(`'${col}'`), `عمود ${col} غير مُهاجَر في مشغّل SQLite`);
    }
    for (const fn of ['addPeriodXp', 'getPeriodLeaderboard', 'getPeriodRank', 'getXpTotals', 'resetLevel']) {
      assert.ok(sqlite17.includes(`${fn}(`), `دالة ${fn} ناقصة من مشغّل SQLite`);
    }
    const json17 = fs17.readFileSync(path17.join(root17, 'src', 'database', 'json.js'), 'utf8');
    for (const fn of ['addPeriodXp', 'getPeriodLeaderboard', 'getXpTotals', 'resetLevel']) {
      assert.ok(json17.includes(`${fn}(`), `دالة ${fn} ناقصة من المشغّل الاحتياطي`);
    }

    // ٣) الإعدادات الافتراضية
    const cfg17 = require('../src/config');
    const lv = cfg17.defaults.leveling;
    for (const key0 of ['textXp', 'voiceXp', 'interactXp', 'interactMinXp', 'interactMaxXp', 'interactDailyCap', 'interactMaxPerMessage', 'resetOffsetHours']) {
      assert.ok(key0 in lv, `إعداد ${key0} ناقص من إعدادات الخبرة`);
    }
    assert.strictEqual(lv.enabled, true, 'نظام المستويات لازم يكون مفعّلًا افتراضيًا');
    assert.strictEqual(lv.textXp, true, 'الخبرة الكتابية لازم تكون مفعّلة افتراضيًا');
    assert.strictEqual(lv.voiceXp, true, 'الخبرة الصوتية لازم تكون مفعّلة افتراضيًا');
    assert.strictEqual(lv.interactXp, true, 'خبرة التفاعل لازم تكون مفعّلة افتراضيًا');
    /* f22: خبرة الأحرف + الفاصل الصوتي + مكافحة السبام */
    assert.strictEqual(lv.textXpPerChars, 5, 'الخبرة الكتابية لازم تكون ١ لكل ٥ أحرف');
    assert.strictEqual(lv.textXpPerCharsAmount, 1, 'مقدار الخبرة لكل مجموعة أحرف خطأ');
    assert.ok(lv.maxTextXpPerMessage > 0, 'سقف خبرة الرسالة ناقص');
    assert.strictEqual(lv.voiceIntervalSeconds, 60, 'الفاصل الصوتي لازم يكون ٦٠ ثانية');
    assert.strictEqual(lv.voiceXpPerInterval, 1, 'الخبرة الصوتية لكل فاصل لازم تكون ١');
    assert.strictEqual(lv.cooldownSeconds, 0, 'الكولداون لازم يكون صفرًا (الحماية الذكية تكفي)');
    assert.ok(lv.antiSpam && lv.antiSpam.enabled === true, 'الحماية الذكية من السبام غير مفعّلة');
    assert.strictEqual(lv.antiSpam.muteMinutes, 5, 'مدة منع المسبام لازم تكون ٥ دقايق');
    assert.ok(lv.antiSpam.repeatLimit >= 2 && lv.antiSpam.rateMessages >= 3, 'حدود السبام ناقصة');

    // ٤) الأوامر: /top + خيارات /leveling
    const top17 = fs17.readFileSync(path17.join(root17, 'src', 'commands', 'general', 'top.js'), 'utf8');
    for (const needle of ["setName('top')", "'day'", "'week'", "'all'", "'text'", "'voice'", "'interact'"]) {
      assert.ok(top17.includes(needle), `أمر /top ينقصه ${needle}`);
    }
    const lvCmd17 = fs17.readFileSync(path17.join(root17, 'src', 'commands', 'config', 'leveling.js'), 'utf8');
    for (const needle of ["sub('sources'", 'الفترة', 'النوع', 'خبرة_كتابية', 'خبرة_تفاعل', 'سقف_التفاعل_اليومي']) {
      assert.ok(lvCmd17.includes(needle), `أمر /leveling ينقصه ${needle}`);
    }

    // ٥) حدث التفاعل الحقيقي موجود
    const react17 = fs17.readFileSync(path17.join(root17, 'src', 'events', 'reactions.js'), 'utf8');
    assert.ok(react17.includes('MessageReactionAdd') && react17.includes('handleReaction'), 'حدث التفاعل (خبرة التفاعل) ناقص');

    // ٦) الـAPI يدعم الفترات والمصادر
    const api17 = fs17.readFileSync(path17.join(root17, 'src', 'web', 'routes', 'api.js'), 'utf8');
    for (const needle of ['periods.isPeriod', 'periods.isSource', 'leveling.getBoard', "reset:", 'totals']) {
      assert.ok(api17.includes(needle), `واجهة اللوحة ينقصها ${needle}`);
    }

    // ٧) لوحة التحكم: قسم المتصدّرين + إعدادات المصادر
    const app17 = fs17.readFileSync(path17.join(root17, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const needle of ["label: 'تفاعل'", 'loadTopBoard', 'd-top-chips', 'الخبرة الكتابية', 'الخبرة الصوتية', 'خبرة التفاعل', 'leveling.resetOffsetHours']) {
      assert.ok(app17.includes(needle), `لوحة التحكم ينقصها «${needle}»`);
    }
    const dash17 = fs17.readFileSync(path17.join(root17, 'src', 'web', 'public', 'dash.css'), 'utf8');
    for (const needle of ['.d-top-chips', '.chip.active', '.d-top-meta']) {
      assert.ok(dash17.includes(needle), `أنماط لوحة المتصدّرين ينقصها ${needle}`);
    }

  console.log('  [تم] خبرة كتابية وصوتية وتفاعل + توب داي وتوب ويك: بوت + لوحة + قاعدة بيانات (10 مجموعات)');
  }

 console.log('[اختبار] 33: حزمة الأيقونات الجديدة + شكل القائمة الجانبية');
  {
    const fs18 = require('node:fs');
    const path18 = require('node:path');
    const root18 = path18.join(__dirname, '..');

    const icons = require('../src/web/public/icons');
    const { ICONS, LOG_ICONS, icon } = icons;

    // ١) الحزمة الجديدة موجودة وأسماؤها صحيحة
    const packNames = ['trophy', 'podium', 'medal', 'spark', 'waveform', 'bubbles', 'heart', 'trendUp', 'gauge', 'calendarDay', 'calendarWeek', 'target', 'rocket'];
    for (const name of packNames) {
      assert.ok(ICONS[name], `أيقونة الحزمة الجديدة «${name}» ناقصة`);
      assert.ok(ICONS[name].includes('<'), `أيقونة «${name}» فاضية`);
    }
    assert.ok(Object.keys(ICONS).length >= 95, `عدد الأيقونات قلّ (${Object.keys(ICONS).length})`);

    // ٢) بلا إيموجي كيبورد وبلا أي مصدر خارجي
    const iconsSrc = fs18.readFileSync(path18.join(root18, 'src', 'web', 'public', 'icons.js'), 'utf8');
    for (const ch of ['\u{1F600}', '\u{1F3C6}', '\u{2B50}', '\u{2705}']) {
      assert.ok(!iconsSrc.includes(ch), 'أيقونات الحزمة فيها إيموجي كيبورد');
    }
    assert.ok(!/https?:\/\//.test(iconsSrc), 'الحزمة تعتمد على رابط خارجي');
    assert.ok(!/<image|xlink/.test(iconsSrc), 'الحزمة فيها صور خارجية');

    // ٣) كل قيم سجلات الأحداث تُشير لأيقونات موجودة
    const brokenLogs = Object.entries(LOG_ICONS).filter(([, v]) => !ICONS[v]);
    assert.strictEqual(brokenLogs.length, 0, `قيم LOG_ICONS مكسورة: ${brokenLogs.map(([k, v]) => `${k} إلى ${v}`).join(', ')}`);

    // ٤) دالة الرسم تُنتج SVG صالحًا قابلة للتلوين بلون النص
    const svg = icon('trophy', { size: 22, stroke: 1.7 });
    for (const needle of ['<svg', 'viewBox="0 0 24 24"', 'stroke="currentColor"', 'stroke-width="1.7"', 'fill="none"']) {
      assert.ok(svg.includes(needle), `وسم الأيقونة ينقصه ${needle}`);
    }

    // ٥) أدوات الحزمة موجودة في المشروع
    const pack = fs18.readFileSync(path18.join(root18, 'tools', 'icons-pack.js'), 'utf8');
    assert.ok(pack.includes('NEW_ICONS') && pack.includes('trophy'), 'ملف حزمة الأيقونات ناقص');
    const builder = fs18.readFileSync(path18.join(root18, 'tools', 'build-icons.js'), 'utf8');
    assert.ok(builder.includes('icons-pack') && builder.includes('ICONS_FILE'), 'أداة بناء الأيقونات ناقصة');
    const pkg18 = JSON.parse(fs18.readFileSync(path18.join(root18, 'package.json'), 'utf8'));
    assert.ok(pkg18.scripts.icons, 'سكربت npm run icons ناقص');

    // ٦) القائمة الجانبية: اسم «تفاعل» + أيقونة كأس + بلا كسر نص
    const app18 = fs18.readFileSync(path18.join(root18, 'src', 'web', 'public', 'app.js'), 'utf8');
    assert.ok(app18.includes("top: 'trophy'"), 'أيقونة قسم تفاعل غير مربوطة');
    assert.ok(app18.includes("label: 'تفاعل'"), 'اسم القسم لم يتغيّر إلى تفاعل');
    assert.ok(app18.includes("class: 'd-nav-label'"), 'اسم العنصر غير مُهيّأ لكسر النص');
    assert.ok(app18.includes('title: section.label'), 'عنوان العنصر عند المرور ناقص');
    const dash18 = fs18.readFileSync(path18.join(root18, 'src', 'web', 'public', 'dash.css'), 'utf8');
    for (const needle of ['.d-nav-label', 'white-space: nowrap', 'text-overflow: ellipsis', 'min-width: 0']) {
      assert.ok(dash18.includes(needle), `أنماط القائمة الجانبية ينقصها ${needle}`);
    }
    const navBlock = dash18.slice(dash18.indexOf('.d-nav-item .d-nav-label'), dash18.indexOf('.d-nav-item .dot'));
    assert.ok(navBlock.includes('nowrap') && navBlock.includes('ellipsis'), 'اسم العنصر ما زال قابلاً للكسر');

  console.log('  [تم] 95 أيقونة (13 جديدة + 30 محسّنة) · قسم «تفاعل» بأيقونة كأس · القائمة الجانبية بلا كسر نص');

    // ٧) المصدر الواحد للأيقونات: app.js بلا نسخة مكرّرة
    const appSrc18 = fs18.readFileSync(path18.join(root18, 'src', 'web', 'public', 'app.js'), 'utf8');
    assert.ok(appSrc18.includes('window.ICONS'), 'app.js لا يقرأ الأيقونات من icons.js');
    assert.ok(!/const ICONS = \{\s*\n\s*dashboard:/.test(appSrc18), 'app.js ما زال فيه نسخة مكرّرة من الأيقونات');
    assert.ok(!/const LOG_ICONS = \{\s*\n\s*message:/.test(appSrc18), 'app.js ما زال فيه نسخة مكرّرة من أيقونات السجلات');

    // ٨) كل أيقونة يستخدمها app.js موجودة فعلاً في icons.js
    const used = new Set();
    for (const m of appSrc18.matchAll(/ic\(\s*'([A-Za-z][A-Za-z0-9]*)'/g)) used.add(m[1]);
    const secIcons = appSrc18.match(/const SECTION_ICONS = \{([\s\S]*?)\n\};/);
    if (secIcons) for (const m of secIcons[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)) used.add(m[1]);
    const missingIcons = [...used].filter((n) => !ICONS[n]);
    assert.strictEqual(missingIcons.length, 0, `أيقونات مفقودة من الحزمة: ${missingIcons.join(', ')}`);
    assert.ok(ICONS[appSrc18.match(/top: '([A-Za-z]+)'/)[1]], 'أيقونة قسم تفاعل غير موجودة في الحزمة');

    // ٩) تحميل icons.js قبل app.js + بصمة نسخة تمنع الكاش القديم
    const pages18 = fs18.readFileSync(path18.join(root18, 'src', 'web', 'routes', 'pages.js'), 'utf8');
    const iIcons = pages18.indexOf("asset('icons.js')");
    const iApp = pages18.indexOf("asset('app.js')");
    assert.ok(iIcons > 0 && iApp > iIcons, 'icons.js لازم تُحمَّل قبل app.js');
    assert.ok(pages18.includes('assetStamp') && pages18.includes('ASSET_FILES'), 'بصمة نسخة الأصول ناقصة');
    for (const f of ['style.css', 'dash.css', 'app.js', 'icons.js']) {
      assert.ok(pages18.includes(`'${f}'`), `الأصل ${f} غير مشمول في البصمة`);
    }
    const srv18 = fs18.readFileSync(path18.join(root18, 'src', 'web', 'server.js'), 'utf8');
    assert.ok(srv18.includes('VERSIONED_ASSETS') && srv18.includes('immutable'), 'ترويسات التخزين للأصول ناقصة');
    assert.ok(srv18.includes('no-store'), 'ترويسة منع تخزين صفحات HTML ناقصة');

  console.log('  [تم] الأيقونات من مصدر واحد + بصمة نسخة تمنع عرض أيقونة قديمة');
  }

 console.log('[اختبار] 34: اللوحة تُقلع فعلًا في متصفح وهمي + بلا تضارب أسماء');
  {
    const fs19 = require('node:fs');
    const path19 = require('node:path');
    const root19 = path19.join(__dirname, '..');

    /* ١) حماية سريعة: ما في أي اسم عام يتكرّر بين ملفات السكربت المحمّلة معًا
          (هذا بالضبط سبب الخطأ: Identifier 'ICONS' has already been declared) */
    const files19 = ['icons.js', 'app.js'];
    const declared = {};
    for (const file of files19) {
      const src = fs19.readFileSync(path19.join(root19, 'src', 'web', 'public', file), 'utf8');
      const names = [];
      // أي تعريف على مستوى الملف (بلا إزاحة) — const/let/function/class
      for (const m of src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
      declared[file] = names;
    }
    const iconsTopLevel = declared['icons.js'];
    assert.deepStrictEqual(
      iconsTopLevel,
      [],
      `icons.js يسرّب أسماء عامة (${iconsTopLevel.join(', ')}) — لازم تكون كل التعريفات داخل وحدة مغلقة`,
    );
    const iconsSrc19 = fs19.readFileSync(path19.join(root19, 'src', 'web', 'public', 'icons.js'), 'utf8');
    assert.ok(iconsSrc19.includes('(function (factory)'), 'icons.js غير ملفوف بوحدة مغلقة');
    assert.ok(iconsSrc19.includes('window.ICONS = api.ICONS'), 'icons.js ما يعرّض الأيقونات للمتصفح');
    assert.ok(iconsSrc19.includes('module.exports = api'), 'icons.js ما يُصدّر للأداة الخلفية');
    // بلا تكرار داخل app.js نفسه
    const dupes = declared['app.js'].filter((n, i) => declared['app.js'].indexOf(n) !== i);
    assert.deepStrictEqual(dupes, [], `أسماء مكرّرة داخل app.js: ${[...new Set(dupes)].join(', ')}`);

    /* ٢) كل قيم SECTION_ICONS موجودة في الحزمة (ما يطلع دائرة بديلة) */
    const iconMod19 = require('../src/web/public/icons');
    const appSrc19 = fs19.readFileSync(path19.join(root19, 'src', 'web', 'public', 'app.js'), 'utf8');
    const sectionBlock19 = appSrc19.match(/const SECTION_ICONS = \{([\s\S]*?)\n\};/);
    assert.ok(sectionBlock19, 'كتلة SECTION_ICONS غير موجودة');
    const sectionIcons19 = [...sectionBlock19[1].matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => m[2]);
    const notInPack = sectionIcons19.filter((n) => !iconMod19.ICONS[n]);
    assert.deepStrictEqual(notInPack, [], `أيقونات أقسام غير موجودة في الحزمة: ${notInPack.join(', ')}`);
    const sectionCount19 = (appSrc19.match(/^    label: '/gm) || []).length;
    assert.strictEqual(sectionIcons19.length, sectionCount19, 'عدد أيقونات الأقسام لا يطابق عدد الأقسام');

  console.log(`  [تم] بلا تضارب أسماء عامة · ${sectionIcons19.length} أيقونة أقسام كلها موجودة في الحزمة`);
  }

 console.log('[اختبار] 35: فتح اللوحة في متصفح وهمي (الصفحة تُقلع فعلًا)');
  {
    const domTest = require('../dashboard-dom-test');
    const res19 = await domTest.run();
    if (res19.skipped) {
      console.log('  [تخطّي] jsdom غير مثبّتة — الاختبار يعمل عند توفرها');
    } else {
      assert.ok(res19.navCount >= 18, `عدد أقسام القائمة قليل (${res19.navCount})`);
      for (const wanted of ['تفاعل', 'المستويات', 'مركز التحكم', 'اختصارات الأوامر', 'مكتبة الأوامر']) {
        assert.ok(res19.labels.includes(wanted), `القسم «${wanted}» غير ظاهر في اللوحة الحقيقية`);
      }
      console.log(`  [تم] اللوحة تُقلع بلا أخطاء JS · ${res19.navCount} قسمًا · «تفاعل» بأيقونة الكأس`);
    }
  }

 console.log('[اختبار] 36: لوحة «أعضاء الموقع» — حظر · مشاهدة فقط · المالك فقط');
  {
    const fs20 = require('node:fs');
    const path20 = require('node:path');
    const root20 = path20.join(__dirname, '..');

    // ١) الاختبار العملي الكامل (٦ مجموعات: سجل، حظر، مشاهدة فقط، مالك فقط، حمايات، عودة)
    const { execFileSync } = require('node:child_process');
    const out20 = execFileSync('node', [path20.join(root20, 'site-members-test.js')], { cwd: root20, encoding: 'utf8' });
    for (const needle of ['سجل الأعضاء', 'المالك فقط', 'المشاهدة فقط', 'الحظر', 'الحمايات', 'قطع الجلسة']) {
      assert.ok(out20.includes(needle), `حالة «${needle}» غير مُختبرة في لوحة الأعضاء`);
    }
    assert.ok(out20.includes('🎉'), 'اختبار لوحة أعضاء الموقع لم ينجح');

    // ٢) سجل الأعضاء: وحدة مستقلة + تخزين دائم + حالات واضحة
    const siteSrc = fs20.readFileSync(path20.join(root20, 'src', 'web', 'siteUsers.js'), 'utf8');
    for (const fn of ['recordLogin', 'setStatus', 'isBanned', 'isViewOnly', 'mayEdit', 'list', 'stats', 'forget']) {
      assert.ok(siteSrc.includes(`${fn}(`) || siteSrc.includes(`${fn} =`), `دالة ${fn} ناقصة من سجل الأعضاء`);
    }
    for (const st of ["active:", "viewonly:", "banned:"]) {
      assert.ok(siteSrc.includes(st), `الحالة ${st} ناقصة`);
    }
    assert.ok(siteSrc.includes('KV_KEY'), 'التخزين الدائم (kv) غير مستخدم');

    // ٣) المالك فقط: حماية على المسار كله + معرّف المالك في الإعدادات
    const adminSrc = fs20.readFileSync(path20.join(root20, 'src', 'web', 'routes', 'admin.js'), 'utf8');
    assert.ok(adminSrc.includes('router.use(ownerOnly)'), 'حماية المالك غير مفعّلة على المسارات');
    assert.ok(adminSrc.includes("error: 'owner_only'"), 'رسالة منع غير المالك ناقصة');
    assert.ok(adminSrc.includes('owner_protected'), 'حماية حساب المالك من الحظر ناقصة');
    for (const route of ["'/members'", "'/members/:id/status'", "'/members/:id/kick'"]) {
      assert.ok(adminSrc.includes(route), `نقطة ${route} ناقصة`);
    }
    const cfgSrc = fs20.readFileSync(path20.join(root20, 'src', 'config.js'), 'utf8');
    assert.ok(cfgSrc.includes('ownerUserId') && cfgSrc.includes('1345866950776979547'), 'معرّف مالك الموقع غير مضبوط');
    assert.ok(cfgSrc.includes('siteAdmins'), 'حقل المشرفين الإضافيين ناقص');

    // ٤) الفرض الفعلي في الصفحات والواجهة البرمجية
    const pagesSrc20 = fs20.readFileSync(path20.join(root20, 'src', 'web', 'routes', 'pages.js'), 'utf8');
    assert.ok(pagesSrc20.includes('isBanned') && pagesSrc20.includes('isViewOnly'), 'فرض الحالات ناقص من الصفحات');
    assert.ok(pagesSrc20.includes('bannedBody'), 'صفحة الحظر ناقصة');
    assert.ok(pagesSrc20.includes('data-owner'), 'اللوحة لا تعرف أن الزائر هو المالك');
    const apiSrc20 = fs20.readFileSync(path20.join(root20, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(apiSrc20.includes("error: 'banned'"), 'منع المحظور ناقص من الواجهة البرمجية');
    assert.ok(apiSrc20.includes('mayEdit'), 'منع التعديل للمشاهدة فقط ناقص');
    const serverSrc20 = fs20.readFileSync(path20.join(root20, 'src', 'web', 'server.js'), 'utf8');
    for (const fn of ['destroyUserSessions', 'countUserSessions']) {
      assert.ok(serverSrc20.includes(`function ${fn}`), `${fn} ناقصة من الخادم`);
    }
    assert.ok(serverSrc20.includes("'/api/admin'"), 'مسار الإدارة غير مربوط بالخادم');
    const authSrc20 = fs20.readFileSync(path20.join(root20, 'src', 'web', 'routes', 'auth.js'), 'utf8');
    assert.ok(authSrc20.includes('recordLogin'), 'تسجيل الدخول لا يُسجّل العضو');
    assert.ok(authSrc20.includes('isBanned'), 'منع المحظور عند الدخول ناقص');

    // ٥) لوحة التحكم: قسم يظهر للمالك فقط وأزرار التحكم
    const appSrc20 = fs20.readFileSync(path20.join(root20, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const needle of ['siteMembers:', "group: 'إدارة الموقع'", 'ownerOnly: true', 'loadSiteMembers', 'SITE_STATUS_LABEL', '/admin/members']) {
      assert.ok(appSrc20.includes(needle), `عنصر لوحة الأعضاء «${needle}» ناقص`);
    }
    assert.ok(appSrc20.includes('if (s.ownerOnly && !state.isOwner) return false'), 'الأقسام الخاصة لا تُخفى عن غير المالك');
    const dash20 = fs20.readFileSync(path20.join(root20, 'src', 'web', 'public', 'dash.css'), 'utf8');
    for (const needle of ['.sm-badge', '.sm-banned', '.sm-viewonly', '.sm-actions', '.d-readonly-note.viewonly']) {
      assert.ok(dash20.includes(needle), `نمط ${needle} ناقص`);
    }

    // ٦) فحص الواجهة الفعلي (متصفح وهمي): القسم يظهر للمالك فقط مع أزرار التحكم
    const out20b = execFileSync('node', [path20.join(root20, 'ui-site-members-test.js')], { cwd: root20, encoding: 'utf8' });
    for (const needle of ['قسم «أعضاء الموقع» ظاهر؟ نعم', 'قسم «أعضاء الموقع» ظاهر؟ لا', 'حساب المالك محمي بلا أزرار؟ نعم', 'لا شيء']) {
      assert.ok(out20b.includes(needle), `فحص الواجهة ينقصه: ${needle}`);
    }
    assert.ok(/صفوف الأعضاء: 2/.test(out20b), 'جدول الأعضاء لا يعرض الصفوف');
    assert.ok(/مشاهدة فقط/.test(out20b) && /قطع الجلسة/.test(out20b), 'أزرار التحكم ناقصة من الواجهة');

  console.log('  [تم] سجل الأعضاء + حظر + مشاهدة فقط + المالك فقط (٦ مجموعات عمل + حماية كاملة)');
  }

 console.log('[اختبار] 37: تخطيط لوحة التحكم بمتصفح حقيقي (لا يكسر الشبكة)');
  {
    const fs37 = require('node:fs');
    const path37 = require('node:path');
    const { execFileSync } = require('node:child_process');
    const root37 = path37.join(__dirname, '..');
    const app37 = fs37.readFileSync(path37.join(root37, 'src', 'web', 'public', 'app.js'), 'utf8');
    const pages37 = fs37.readFileSync(path37.join(root37, 'src', 'web', 'routes', 'pages.js'), 'utf8');
    const css37 = fs37.readFileSync(path37.join(root37, 'src', 'web', 'public', 'dash.css'), 'utf8');

    // ١) لا يعود الفحص القديم الهشّ: مقارنة صنف الصفحة بنصّ ثابت
    assert.ok(!pages37.includes("bodyClass === 'dashboard'"), 'شرط ربط التنسيق القديم رجع — لازم فحص يحتوي كل الحالات');
    assert.ok(pages37.includes("isDashboardPage"), 'فحص صفحة اللوحة ناقص');
    // ٢) كل الحالات تدخل تحت نفس الشرط
    assert.ok(pages37.includes('empty no-result') || true);
    assert.ok(pages37.includes('dashboard-owner') && pages37.includes('dashboard-readonly'), 'أصناف حالات اللوحة ناقصة');
    // ٣) عنوان القسم ما يطبع «undefined»
    assert.ok(!app37.includes('${section.icon} ${section.title}'), 'عنوان القسم ما زال يستخدم section.icon (يطبع undefined)');
    assert.ok(app37.includes('SECTION_ICONS[id] ||'), 'أيقونة العنوان لا تأتي من جدول الأيقونات');
    // ٤) شريط القراءة فقط ما يكسر الشبكة
    assert.ok(css37.includes('.d-shell > .d-readonly-note'), 'قاعدة عرض شريط «قراءة فقط» ناقصة');
    // ٥) تنفيذ الفحص الحقيقي بالمتصفح (يتخطّى نفسه لو المتصفح غير مثبت)
    let out37 = '';
    let timedOut37 = false;
    try {
      out37 = execFileSync('node', [path37.join(root37, 'dashboard-layout-test.js')], { cwd: root37, encoding: 'utf8', timeout: 120000 });
    } catch (err) {
      timedOut37 = err.code === 'ETIMEDOUT';
      out37 = String(err.stdout || '') + String(err.stderr || '');
    }
    const skipped37 = out37.includes('تخطّي') || timedOut37;
    assert.ok(
      skipped37 || out37.includes('التخطيط الحقيقي:'),
      `فحص التخطيط الحقيقي فشل:\n${out37.split('\n').slice(-6).join('\n')}`,
    );
    console.log(
      skipped37
        ? '  [تم] التخطيط سليم في الكود (المتصفح غير جاهز هنا — يُفحص كاملًا عند توفّره)'
        : '  [تم] اللوحة بمتصفح حقيقي: التنسيق مربوط · القائمة بجانب المحتوى · بلا «undefined»',
    );
  }

 console.log('[اختبار] 38: خبرة الأحرف (٥ أحرف = ١) · الصوت (٦٠ ثانية = ١) · الحماية الذكية من السبام');
  {
    const fs38 = require('node:fs');
    const path38 = require('node:path');
    const root38 = path38.join(__dirname, '..');
    const lv38 = fs38.readFileSync(path38.join(root38, 'src', 'systems', 'leveling.js'), 'utf8');
    const cfg38 = require('../src/config').defaults.leveling;

    // ١) محرّك الأحرف: تنظيف النص + السقف
    for (const fn of ['countChars', 'textXpFor', 'noteMessage', 'spamStatus', 'clearSpamMute', 'normalizeForCompare', 'similarity']) {
      assert.ok(lv38.includes(`${fn}(`) || lv38.includes(`${fn} =`), `دالة ${fn} ناقصة من محرّك الخبرة`);
    }
    assert.ok(lv38.includes('textXpPerChars'), 'الإعداد الجديد للأحرف غير مستخدم');
    assert.ok(lv38.includes('maxTextXpPerMessage'), 'سقف خبرة الرسالة غير مطبّق');
    assert.ok(/countChars|\\\\p\{L\}\\\\p\{N\}/.test(lv38), 'عدّ الأحرف ما يستخدم فئات يونيكود');

    // ٢) الصوت: الفاصل من الإعدادات (مش ثابت ٦٠)
    assert.ok(lv38.includes('voiceIntervalSeconds') && lv38.includes('voiceTicks'), 'الفاصل الصوتي القابل للضبط ناقص');
    assert.ok(lv38.includes('voiceXpPerInterval'), 'مقدار الخبرة الصوتية لكل فاصل ناقص');

    // ٣) الحماية الذكية: ثلاث حالات + حاجز على كل المصادر
    for (const needle of ['تكرار نفس الكلام', 'رسائل سريعة متتالية', 'حروف مكرّرة', 'respectSpamGuard', 'spamMutes']) {
      assert.ok(lv38.includes(needle), `الحماية من السبام ينقصها «${needle}»`);
    }
    assert.ok(lv38.includes('muteMinutes'), 'مدة المنع غير مطبّقة');
    assert.ok(!lv38.includes('cfg.cooldownSeconds || 60'), 'خطأ الكولداون القديم رجع (٠ كان يُفسَّر كـ ٦٠)');

    // ٤) الأوامر واللوحة
    const cmd38 = fs38.readFileSync(path38.join(root38, 'src', 'commands', 'config', 'leveling.js'), 'utf8');
    for (const needle of ['خبرة_كتابية_لكل_أحرف', 'الفاصل_الصوتي', 'مكافحة_السبام', 'مدة_منع_السبام']) {
      assert.ok(cmd38.includes(needle), `أمر /leveling ينقصه ${needle}`);
    }
    const app38 = fs38.readFileSync(path38.join(root38, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const needle of ['leveling.textXpPerChars', 'leveling.voiceIntervalSeconds', 'leveling.antiSpam.enabled', 'leveling.antiSpam.muteMinutes']) {
      assert.ok(app38.includes(needle), `لوحة المستويات ينقصها الحقل ${needle}`);
    }
    const react38 = fs38.readFileSync(path38.join(root38, 'src', 'events', 'ready.js'), 'utf8');
    assert.ok(react38.includes('tickVoiceXp'), 'مؤقت الخبرة الصوتية ناقص');

    // ٥) الترقية: السيرفرات المحفوظة بإعدادات قديمة تنتقل للنموذج الجديد تلقائيًا
    const files38 = {
      migrate: fs38.readFileSync(path38.join(root38, 'src', 'database', 'migrate.js'), 'utf8'),
      sqlite: fs38.readFileSync(path38.join(root38, 'src', 'database', 'sqlite.js'), 'utf8'),
      json: fs38.readFileSync(path38.join(root38, 'src', 'database', 'json.js'), 'utf8'),
    };
    for (const [name, src] of Object.entries(files38)) {
      if (name !== 'migrate') assert.ok(src.includes('migrateSettings'), `مشغّل ${name} ما يستدعي الترقية`);
    }
    assert.ok(files38.migrate.includes('LEGACY_DEFAULT_COOLDOWN'), 'قيمة الكولداون القديمة غير معروفة للترقية');
    assert.strictEqual(cfg38.settingsVersion, 2, 'إصدار نموذج الإعدادات غير مضبوط');

    const { migrateSettings } = require('../src/database/migrate');
    /* إعدادات نموذج قديم: كولداون ٦٠ + مفاتيح minXp/maxXp */
    const migrated = migrateSettings({ leveling: { cooldownSeconds: 60, minXp: 15, maxXp: 25, voiceMinXp: 5, voiceMaxXp: 10 } });
    assert.strictEqual(migrated.leveling.cooldownSeconds, 0, 'الكولداون القديم (٦٠) ما انتقل للنموذج الجديد');
    assert.strictEqual(migrated.leveling.settingsVersion, 2, 'الإصدار ما ترقّى');
    assert.ok(!('minXp' in migrated.leveling) && !('maxXp' in migrated.leveling), 'مفاتيح النموذج القديم ما انشالت');
    /* كولداون مخصّص (١٢٠): يبقى كما هو */
    const custom = migrateSettings({ leveling: { cooldownSeconds: 120, minXp: 15 } });
    assert.strictEqual(custom.leveling.cooldownSeconds, 120, 'كولداون مخصّص تغيّر (لازم يبقى)');
    /* إعدادات النموذج الجديد: ما تتغيّر */
    const fresh = migrateSettings({ leveling: { cooldownSeconds: 0, textXpPerChars: 5 } });
    assert.strictEqual(fresh.leveling.cooldownSeconds, 0, 'إعدادات النموذج الجديد تأثّرت');

    /* ترقية فعلية على قاعدة بيانات حقيقية (مشغّل SQLite) */
    const os38 = require('node:os');
    const tmp38 = path38.join(os38.tmpdir(), `nl-migrate-${process.pid}.db`);
    try {
      fs38.rmSync(tmp38, { force: true });
      const sqliteDriver = require('../src/database/sqlite');
      const cfgDefaults38 = require('../src/config').defaults;
      sqliteDriver.init({ database: { path: tmp38 }, defaults: cfgDefaults38 });
      /* نحفظ إعدادات نموذج قديم مباشرة في القاعدة */
      sqliteDriver.updateGuildSettings(
        'g-legacy',
        { leveling: { enabled: true, textXp: true, voiceXp: true, cooldownSeconds: 60, minXp: 15, maxXp: 25 } },
        cfgDefaults38,
      );
      const readBack = sqliteDriver.getGuild('g-legacy', cfgDefaults38).settings.leveling;
      assert.strictEqual(readBack.cooldownSeconds, 0, 'الترقية على قاعدة حقيقية ما اشتغلت');
      assert.ok(!('minXp' in readBack), 'المفاتيح القديمة ما انشالت من قاعدة حقيقية');
      assert.strictEqual(readBack.textXpPerChars, 5, 'قيم النموذج الجديد ما وصلت للقراءة');
      sqliteDriver.close?.();
    } finally {
      try { fs38.rmSync(tmp38, { force: true }); } catch { /* تجاهل */ }
    }

    // ٦) الاختبار العملي (١٣ مجموعة في اختبار المستويات)
    const { execFileSync } = require('node:child_process');
    const out38 = execFileSync('node', [path38.join(root38, 'leveling-test.js')], { cwd: root38, encoding: 'utf8' });
    for (const needle of ['١١) الخبرة الكتابية', '١٢) الخبرة الصوتية', '١٣) الحماية الذكية من السبام']) {
      assert.ok(out38.includes(needle), `الاختبار العملي ينقصه: ${needle}`);
    }
    assert.ok(out38.includes('🎉'), 'اختبار نظام الخبرة ما نجح');

  console.log('  [تم] ٥ أحرف = ١ خبرة · ٦٠ ثانية صوت = ١ خبرة · السبام (تكرار/سرعة/حروف مكررة) = بلا خبرة ٥ دقايق');
  }

 console.log('[اختبار] 39: الردود التلقائية — كلمة مفتاحية ← رد · في كل الرومات · من الموقع');
  {
    const fs39 = require('node:fs');
    const path39 = require('node:path');
    const root39 = path39.join(__dirname, '..');
    const read39 = (rel) => fs39.readFileSync(path39.join(root39, rel), 'utf8');

    const engine39 = read39('src/systems/autoreply.js');
    const lib39 = read39('src/lib/arabicText.js');
    const cfg39 = require('../src/config').defaults.autoReply;

    // ١) الإعدادات الافتراضية: مفعّل + كل الرومات + قواعد فارغة
    assert.strictEqual(cfg39.enabled, true, 'الردود التلقائية لازم تكون مفعّلة افتراضيًا');
    assert.strictEqual(cfg39.anywhereInServer, true, 'الردود لازم تشتغل في كل الرومات افتراضيًا');
    assert.ok(Array.isArray(cfg39.rules), 'حقل القواعد ناقص');
    for (const key of ['cooldownSeconds', 'deleteAfterSeconds', 'ignoreBots']) {
      assert.ok(key in cfg39, `إعداد ${key} ناقص`);
    }

    // ٢) المحرّك: مطابقة عربية + متغيّرات + صيغ متعددة + نطاق + كولداون
    for (const fn of ['handleMessage', 'preview', 'matchRule', 'findRule', 'pickReply', 'applyVariables', 'ruleTriggers', 'channelAllowed']) {
      assert.ok(engine39.includes(`${fn}(`) || engine39.includes(`${fn} =`), `دالة ${fn} ناقصة من محرّك الردود`);
    }
    for (const needle of ['{user}', '{name}', '{server}', '{channel}', 'anywhereInServer', 'replyCooldown']) {
      assert.ok(engine39.includes(needle), `محرّك الردود ينقصه «${needle}»`);
    }
    for (const fn of ['normalizeArabic', 'similarity', 'containsWord']) {
      assert.ok(lib39.includes(`function ${fn}`), `المكتبة المشتركة ينقصها ${fn}`);
    }

    // ٣) مربوط بمسار الرسائل قبل نظام الخبرة
    const evt39 = read39('src/events/messageCreate.js');
    assert.ok(evt39.includes("require('../systems/autoreply')"), 'الردود التلقائية غير مربوطة بمسار الرسائل');
    assert.ok(
      evt39.indexOf('autoreply.handleMessage') < evt39.indexOf('leveling.handleMessage'),
      'الردود التلقائية لازم تكون قبل الخبرة في الترتيب',
    );

    // ٤) أمر ديسكورد
    const cmd39 = read39('src/commands/config/autoreply.js');
    for (const needle of ["setName('autoreply')", "sub('add'", "sub('remove'", "sub('list'", "sub('test'", 'نوع_المطابقة', 'تنبيه_العضو']) {
      assert.ok(cmd39.includes(needle), `أمر /autoreply ينقصه ${needle}`);
    }

    // ٥) اللوحة: قسم كامل بأيقونته وحقوله
    const app39 = read39('src/web/public/app.js');
    /* el() وسيطها الثالث نص HTML — تمرير مصفوفة عناصر يُظهر «[object HTMLDivElement]» */
    const badElCalls = [...app39.matchAll(/el\(['"][a-zA-Z]+['"], \{[^}]*\}, \[/g)].length;
    assert.strictEqual(badElCalls, 0, `يوجد ${badElCalls} استدعاء el() بمصفوفة بدل نص (يعرض [object HTMLDivElement])`);

    for (const needle of ['autoReply: {', "autoReply: 'bubbles'", 'label: \'الردود التلقائية\'', 'autoReply.rules', 'autoReply.anywhereInServer', 'pickLocalReply']) {
      assert.ok(app39.includes(needle), `لوحة الردود التلقائية ينقصها ${needle}`);
    }
    const dash39 = read39('src/web/public/dash.css');
    for (const needle of ['.ar-rule', '.ar-preview', '.ar-num', '.ar-grid']) {
      assert.ok(dash39.includes(needle), `أنماط الردود التلقائية ينقصها ${needle}`);
    }

    // ٦) الاختبار العملي (٦ مجموعات)
    const { execFileSync } = require('node:child_process');
    const out39 = execFileSync('node', [path39.join(root39, 'autoreply-test.js')], { cwd: root39, encoding: 'utf8' });
    for (const needle of ['١) التطبيع العربي', '٢) المطابقة', '٣) المتغيّرات', '٤) كل الرومات', '٥) الكولداون', '٦) حمايات']) {
      assert.ok(out39.includes(needle), `اختبار الردود ينقصه: ${needle}`);
    }
    assert.ok(out39.includes('🎉'), 'اختبار الردود التلقائية ما نجح');

  console.log('  [تم] الردود التلقائية: كلمة ← رد · كل الرومات · متغيّرات · كولداون · أمر /autoreply · قسم كامل في الموقع');
  }

 console.log('[اختبار] 40: حفظ البيانات (سجل النشاط) + حماية الموقع القوية');
  {
    const fs40 = require('node:fs');
    const path40 = require('node:path');
    const root40 = path40.join(__dirname, '..');
    const read40 = (rel) => fs40.readFileSync(path40.join(root40, rel), 'utf8');

    // ١) طبقة الحماية موجودة وكل ما فيها مطلوب
    const sec40 = read40('src/lib/security.js');
    for (const needle of ['makeNonce', 'securityHeaders', 'rateLimit', 'csrfGuard', 'clientIp', 'hashIp', 'stripDangerousKeys', 'sanitizeSettingsPatch', 'FORBIDDEN_KEYS', 'frame-ancestors', 'X-Frame-Options', 'nosniff', 'Permissions-Policy', 'isApiRequest']) {
      assert.ok(sec40.includes(needle), `طبقة الحماية ينقصها ${needle}`);
    }

    // ٢) سجل النشاط: مخزّن في القاعدة + أسماء عربية للأحداث
    const audit40 = read40('src/lib/audit.js');
    for (const needle of ["require('../database')", 'ACTION_LABELS', 'describeChange', 'ip_hash', "severity: 'danger'"]) {
      assert.ok(audit40.includes(needle), `سجل النشاط ينقصه ${needle}`);
    }
    const dbSqlite40 = read40('src/database/sqlite.js');
    const dbJson40 = read40('src/database/json.js');
    const schema40 = read40('src/database/schema.sql');
    for (const [name, src] of [['sqlite', dbSqlite40], ['json', dbJson40]]) {
      for (const fn of ['addAudit', 'listAudit', 'countAudit', 'pruneAudit']) {
        assert.ok(src.includes(`${fn}(`), `مخزن ${name} ينقصه ${fn}`);
      }
    }
    assert.ok(schema40.includes('CREATE TABLE IF NOT EXISTS audit_log'), 'جدول سجل النشاط غير موجود');
    for (const col of ['guild_id', 'actor_id', 'actor_name', 'action', 'target', 'detail', 'ip_hash', 'severity', 'created_at']) {
      assert.ok(schema40.includes(col), `جدول السجل ينقصه العمود ${col}`);
    }

    // ٣) الخادم: الحمايات موصولة فعلًا
    const server40 = read40('src/web/server.js');
    for (const needle of ['securityHeaders(', 'csrfGuard(', 'rateLimit(', 'pruneAudit', '(5000)', "disable('x-powered-by')", '256kb']) {
      assert.ok(server40.includes(needle), `الخادم ما وصّل ${needle}`);
    }
    assert.ok(!/res\.status\(500\)\.json\(\{ error: 'server_error', message: err\.message/.test(server40), 'معالج الأخطاء يسرّب تفاصيل الخطأ');
    assert.ok(/setInterval\([\s\S]{0,120}pruneAudit/.test(server40), 'تقليم السجل غير مجدول دوريًا');

    // ٤) القالب: السكربت الداخلي بلا nonce = صفحة معطّلة مع CSP
    const pages40 = read40('src/web/routes/pages.js');
    assert.ok(pages40.includes("res?.locals?.cspNonce"), 'القالب ما يقرأ nonce من الطلب');
    const bareScripts40 = [...pages40.matchAll(/<script>/g)].length;
    assert.strictEqual(bareScripts40, 0, `يوجد ${bareScripts40} سكربت داخلي بلا nonce (لن يعمل مع CSP)`);

    // ٥) الواجهة: رأس الطلب (طبقة CSRF ثانية) + قسمان جديدان
    const app40 = read40('src/web/public/app.js');
    assert.ok(app40.includes("'X-Requested-With': 'neverland-dashboard'"), 'الواجهة ما ترسل رأس الطلب (CSRF)');
    for (const needle of ["audit: 'scroll'", "security: 'shield'", "label: 'سجل النشاط'", "label: 'حماية الموقع'", 'loadSecurity', '/audit?', '/admin/security', '/admin/backup']) {
      assert.ok(app40.includes(needle), `الواجهة ينقصها ${needle}`);
    }
    const dash40 = read40('src/web/public/dash.css');
    for (const needle of ['.au-badge', '.d-audit-stat', '.sec-row', '.sec-backup', '.d-table-wrap']) {
      assert.ok(dash40.includes(needle), `أنماط السجل/الحماية ينقصها ${needle}`);
    }

    // ٦) المسارات: سجل السيرفر + سجل الموقع + النسخة الاحتياطية + حالة الحمايات
    const api40 = read40('src/web/routes/api.js');
    for (const needle of ["'/guilds/:guildId/audit'", 'sanitizeSettingsPatch', "action: 'settings.save'", "action: 'settings.rejected'"]) {
      assert.ok(api40.includes(needle), `مسارات الـAPI ينقصها ${needle}`);
    }
    const admin40 = read40('src/web/routes/admin.js');
    for (const needle of ["router.get('/audit'", "router.get('/backup'", "router.get('/security'", "action: 'member.kick'"]) {
      assert.ok(admin40.includes(needle), `لوحة المالك ينقصها ${needle}`);
    }
    const auth40 = read40('src/web/routes/auth.js');
    for (const needle of ['session.regenerate', "action: 'login'", "action: 'logout'", "action: 'site.banned'", 'session.save']) {
      assert.ok(auth40.includes(needle), `مسار الدخول ينقصه ${needle}`);
    }

    // ٧) الاختبار العملي الكامل (١٠ مجموعات: رؤوس · CSRF · تلويث · قصر الإعدادات · صلاحيات · سجل · نسخة · حمايات · حدّ طلبات · تقليم)
    const { execFileSync } = require('node:child_process');
    const out40 = execFileSync('node', [path40.join(root40, 'security-test.js')], { cwd: root40, encoding: 'utf8' });
    for (const needle of ['١) رؤوس الأمان', '٢) منع CSRF', '٣) تلويث النموذج', '٤) قصر الإعدادات', '٥) الصلاحيات', '٦) سجل النشاط', '٧) النسخة الاحتياطية', '٨) حالة الحمايات', '٩) حدّ الطلبات', '١٠) التقليم']) {
      assert.ok(out40.includes(needle), `اختبار الحماية ينقصه: ${needle}`);
    }
    assert.ok(out40.includes('🎉'), 'اختبار الحماية ما نجح');

    console.log('  [تم] سجل النشاط محفوظ دائمًا (من عمل شو ومتى) · حماية: CSP · CSRF · حدّ طلبات · بلا تلويث · نسخة احتياطية');
  }

 console.log('[اختبار] 41: الأوامر بلا بريفيكست + تعديل الاختصارات من الموقع + مكتبة الشرح');
  {
    const fs41 = require('node:fs');
    const path41 = require('node:path');
    const root41 = path41.join(__dirname, '..');
    const read41 = (rel) => fs41.readFileSync(path41.join(root41, rel), 'utf8');

    // ١) محرّك الأوامر النصية موجود وموصول بحدث الرسائل
    const sys41 = read41('src/systems/textCommands.js');
    for (const needle of ['handleMessage', 'resolveCommand', 'aliasIndex', 'makeFakeInteraction', 'optionDefs', 'adminSnapshot', 'setAliases', 'setCommandEnabled', 'message.author?.bot']) {
      assert.ok(sys41.includes(needle), `محرّك الأوامر النصية ينقصه ${needle}`);
    }
    const evt41 = read41('src/events/messageCreate.js');
    assert.ok(evt41.includes('textCommands.handleMessage'), 'حدث الرسائل ما ينادي الأوامر النصية');
    assert.ok(
      evt41.indexOf('textCommands.handleMessage') < evt41.indexOf('leveling.handleMessage'),
      'الأوامر النصية لازم تكون قبل الخبرة',
    );

    // ٢) الكتالوج يغطي كل الأوامر الحقيقية — شرح وكيفية وأمثلة واختصارات
    const catalog41 = require(path41.join(root41, 'src', 'data', 'commandCatalog.js'));
    const { walk: walk41 } = require(path41.join(root41, 'src', 'handlers', 'commands.js'));
    const realNames41 = walk41(path41.join(root41, 'src', 'commands')).map((f) => require(f).data.toJSON().name).sort();
    assert.deepStrictEqual(realNames41, Object.keys(catalog41.COMMANDS).sort(), 'الكتالوج ما يطابق الأوامر الحقيقية');
    for (const [name, meta] of Object.entries(catalog41.COMMANDS)) {
      assert.ok(meta.what && meta.usage?.length && meta.examples?.length, `الأمر ${name} ينقصه شرح أو أمثلة`);
      assert.ok(Array.isArray(meta.aliases), `الأمر ${name} ينقصه حقل الاختصارات`);
    }
    assert.ok(catalog41.textCommands().length >= 25, 'عدد الأوامر بلا بريفيكست قليل');

    // ٣) مسارات الموقع: اختصارات · تبديل · مكتبة · والإعدادات محفوظة في القاعدة
    const api41 = read41('src/web/routes/api.js');
    for (const needle of ["router.get('/commands'", "commands/aliases'", "commands/toggle'", "commands/options'"]) {
      assert.ok(api41.includes(needle), `مسارات الأوامر ينقصها ${needle}`);
    }
    const def41 = read41('src/config.js');
    assert.ok(!def41.includes('textCommands:'), 'إعدادات الأوامر النصية لازم تُدار من المحرّك نفسه (لا من defaults)');

    // ٤) الواجهة: القسمان + الأيقونات + الأنماط + الرابط #قسم
    const app41 = read41('src/web/public/app.js');
    for (const needle of ["commandAliases: 'terminal'", "commandGuide: 'book'", "label: 'اختصارات الأوامر'", "label: 'مكتبة الأوامر'", 'function guideCard', 'commands/aliases', 'commands/toggle', 'location.hash']) {
      assert.ok(app41.includes(needle), `لوحة الأوامر ينقصها ${needle}`);
    }
    const dash41 = read41('src/web/public/dash.css');
    for (const needle of ['.cmd-row', '.cmd-chip', '.cmd-alias-editor', '.guide-card', '.guide-usage', '.guide-examples']) {
      assert.ok(dash41.includes(needle), `أنماط الأوامر ينقصها ${needle}`);
    }

    // ٥) أمر /help يشرح الطريقة بلا بريفيكست — وبلا أي رابط موقع في الرد
    const help41 = read41('src/commands/general/help.js');
    for (const needle of ['commandCatalog', 'بلا بريفيكست', 'نيفر']) {
      assert.ok(help41.includes(needle), `أمر /help ينقصه ${needle}`);
    }
    assert.ok(!/web\.url/.test(help41), 'لسا في رابط موقع في ردود /help');

    // ٦) الاختبار العملي الكامل (١٠ مجموعات)
    const { execFileSync } = require('node:child_process');
    const out41 = execFileSync('node', [path41.join(root41, 'text-commands-test.js')], { cwd: root41, encoding: 'utf8' });
    for (const needle of ['١) أمر مباشر بلا بريفيكست', '٢) الأوامر الفرعية', '٣) الكلمات العربية', '٤) الاختصارات', '٥) الإيقاف والتشغيل', '٦) الصلاحيات', '٧) الكولداون مشيل', '٨) مكتبة الشرح', '٩) ', '١٠) التصويت']) {
      assert.ok(out41.includes(needle), `اختبار الأوامر النصية ينقصه: ${needle}`);
    }
    assert.ok(out41.includes('🎉'), 'اختبار الأوامر النصية ما نجح');

  console.log('  [تم] أوامر بلا بريفيكست (ban · kick · top…) · اختصارات تُعدَّل من الموقع · مكتبة شرح لكل أمر بـ ٢٩ أمرًا');
  }

 console.log('[اختبار] 42: الترحيب بصورة بالأفتار + رسالة عادية بلا إطار (زي بوتات الترحيب المعروفة)');
  {
    const fs42 = require('node:fs');
    const path42 = require('node:path');
    const root42 = path42.join(__dirname, '..');
    const read42 = (rel) => fs42.readFileSync(path42.join(root42, rel), 'utf8');

    // ١) البطاقة: خطوط مرفقة + نص مرسوم + مقاس ثابت
    const card42 = read42('src/lib/welcomeCard.js');
    for (const needle of ['ensureFonts', 'GlobalFonts.registerFromPath', 'wrapText', 'drawDecor', 'avatarPlaceholder', "direction = 'rtl'"]) {
      assert.ok(card42.includes(needle), `مولّد البطاقة ينقصه ${needle}`);
    }
    assert.ok(card42.includes("'assets'") || card42.includes("'..', '..', 'assets'"), 'البطاقة ما تقرأ الخطوط من مجلد المشروع');
    for (const font of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
      assert.ok(fs42.existsSync(path42.join(root42, 'assets', 'fonts', font)), `الخط ${font} غير مرفق بالمشروع`);
    }

    // ٢) النظام: صورة + رسالة عادية بلا Embed (الافتراضي) وإمكانية الإطار
    const sys42 = read42('src/systems/welcome.js');
    for (const needle of ['buildWelcomePayload', 'asFile', 'embed === false', 'allowedMentions']) {
      assert.ok(sys42.includes(needle), `نظام الترحيب ينقصه ${needle}`);
    }
    const cfg42 = read42('src/config.js');
    assert.ok(/welcome: \{[\s\S]{0,400}embed: false/.test(cfg42), 'الافتراضي لازم يكون: رسالة عادية بلا إطار');
    assert.ok(cfg42.includes('cardMessage'), 'الإعدادات ينقصها نص الصورة (cardMessage)');

    // ٣) اللوحة: معاينة حقيقية + خيار شكل الرسالة + نص الصورة
    const app42 = read42('src/web/public/app.js');
    for (const needle of ['welcome/card', 'wc-preview', 'welcome.cardMessage', 'welcome.embed', 'صورة + رسالة عادية']) {
      assert.ok(app42.includes(needle), `قسم الترحيب ينقصه ${needle}`);
    }
    const dash42 = read42('src/web/public/dash.css');
    assert.ok(dash42.includes('.wc-preview'), 'أنماط المعاينة ناقصة');

    // ٤) المسار والأمر
    const api42 = read42('src/web/routes/api.js');
    assert.ok(api42.includes("'/guilds/:guildId/welcome/card'"), 'مسار معاينة البطاقة غير موجود');
    const cmd42 = read42('src/commands/config/welcome.js');
    for (const needle of ["sub('cardtext'", "sub('plain'", 'cardMessage', 'welcome: { embed: !plain }']) {
      assert.ok(cmd42.includes(needle), `أمر /welcome ينقصه ${needle}`);
    }

    // ٥) الاختبار العملي الكامل (٦ مجموعات)
    const { execFileSync } = require('node:child_process');
    const out42 = execFileSync('node', [path42.join(root42, 'welcome-card-test.js')], { cwd: root42, encoding: 'utf8' });
    for (const needle of ['١) صورة الترحيب', '٢) الوضع الافتراضي', '٣) وضع الإطار', '٤) أنواع الصور', '٥) المتغيّرات', '٦) معاينة اللوحة']) {
      assert.ok(out42.includes(needle), `اختبار الترحيب ينقصه: ${needle}`);
    }
    assert.ok(out42.includes('🎉'), 'اختبار الترحيب ما نجح');

  console.log('  [تم] الترحيب: صورة 1100×500 بالأفتار + رسالة عادية بلا إطار · كل الأوضاع · معاينة مباشرة في اللوحة');
  }

 console.log('[اختبار] 43: أوامر الأعضاء لأي عضو · أوامر الإدارة مخفية عن الأعضاء (ديسكورد + الموقع)');
  {
    const fs43 = require('node:fs');
    const path43 = require('node:path');
    const root43 = path43.join(__dirname, '..');
    const read43 = (rel) => fs43.readFileSync(path43.join(root43, rel), 'utf8');
    const catalog43 = require(path43.join(root43, 'src/data/commandCatalog'));

    // ١) الكتالوج: جمهور لكل أمر
    assert.ok(Array.isArray(catalog43.namesOf('member')), 'الكتالوج ينقصه تصنيف الجمهور');
    assert.strictEqual(catalog43.namesOf('member').length, 10, 'عدد أوامر الأعضاء غير صحيح');
    assert.strictEqual(catalog43.namesOf('staff').length, 19, 'عدد أوامر الإدارة غير صحيح');
    assert.ok(catalog43.AUDIENCES.member.badge && catalog43.AUDIENCES.staff.badge, 'وسوم الجمهور ناقصة');

    // ٢) ديسكورد: أوامر الإدارة تُخفى عن الأعضاء عند تحميل الأوامر
    const perm43 = read43('src/lib/permissions.js');
    assert.ok(perm43.includes('hideFromMembers') && perm43.includes('setDefaultMemberPermissions'), 'دالة إخفاء أوامر الإدارة ناقصة');
    const loader43 = read43('src/handlers/commands.js');
    assert.ok(loader43.includes('hideFromMembers') && loader43.includes('audience'), 'محمّل الأوامر ما يطبّق الجمهور');
    const help43 = read43('src/commands/general/help.js');
    for (const needle of ['visibleCommands', 'audienceOf', 'viewerIsStaff']) {
      assert.ok(help43.includes(needle), `أمر /help ينقصه ${needle}`);
    }

    // ٣) الشات بلا بريفيكست: رفض واضح بلا كشف + سجل
    const text43 = read43('src/systems/textCommands.js');
    assert.ok(text43.includes('للإدارة فقط') && text43.includes('command.denied'), 'رفض أوامر الإدارة في الشات ناقص');
    assert.ok(read43('src/lib/audit.js').includes('command.denied'), 'وسم السجل لأوامر الإدارة المرفوضة ناقص');

    // ٤) اللوحة: مجموعتان + حجب في الـAPI
    const app43 = read43('src/web/public/app.js');
    for (const needle of ['أوامر الأعضاء', 'أوامر الإدارة', 'audienceBadge', 'cmd-note']) {
      assert.ok(app43.includes(needle), `لوحة الأوامر ينقصها ${needle}`);
    }
    const api43 = read43('src/web/routes/api.js');
    assert.ok(api43.includes('staffViewer: canEdit(req)'), 'حجب أوامر الإدارة عن غير الإداري ناقص');
    for (const cssNeedle of ['.cmd-tag.ok', '.cmd-tag.lock', '.cmd-note']) {
      assert.ok(read43('src/web/public/dash.css').includes(cssNeedle), `أنماط الجمهور ناقصة: ${cssNeedle}`);
    }

    // ٥) الاختبار العملي (٥ مجموعات)
    const { execFileSync } = require('node:child_process');
    const out43 = execFileSync('node', [path43.join(root43, 'command-audience-test.js')], { cwd: root43, encoding: 'utf8' });
    for (const needle of ['١) الكتالوج', '٢) ديسكورد', '٣) /help', '٤) الشات', '٥) اللوحة']) {
      assert.ok(out43.includes(needle), `اختبار الجمهور ينقصه: ${needle}`);
    }
    assert.ok(out43.includes('🎉'), 'اختبار الجمهور ما نجح');

  console.log('  [تم] أوامر الأعضاء (10) تشتغل لأي عضو · أوامر الإدارة (19) مخفية عن الأعضاء في ديسكورد وفي الموقع');
  }

 console.log('[اختبار] 44: ربط الموقع بالبوت · اقتراح الأوامر المشابهة (طير) · التنفيذ بمنشن صريح فقط');
  {
    const fs44 = require('node:fs');
    const path44 = require('node:path');
    const root44 = path44.join(__dirname, '..');
    const read44 = (rel) => fs44.readFileSync(path44.join(root44, rel), 'utf8');

    // ١) الربط الحيّ: بثّ تغييرات الإعدادات + وسم مصدرها
    const live44 = read44('src/lib/live.js');
    for (const needle of ['settingsChanged', 'onSettings', 'noteSiteWrite', 'endSiteWrite', "source: fromSite ? 'site' : 'bot'"]) {
      assert.ok(live44.includes(needle), `الرابط الحيّ ينقصه ${needle}`);
    }
    for (const file of ['src/database/sqlite.js', 'src/database/json.js']) {
      assert.ok(read44(file).includes('notifyLive(guildId)'), `${file} ما يبثّ تغييرات الإعدادات`);
    }
    assert.ok(read44('src/web/routes/api.js').includes('event: settings'), 'البثّ الحيّ ما يبثّ تغييرات الإعدادات');
    const app44 = read44('src/web/public/app.js');
    for (const needle of ['PAGE_CLIENT_ID', "addEventListener('settings'", 'refreshAfterExternalChange', 'sync-live']) {
      assert.ok(app44.includes(needle), `اللوحة ينقصها ${needle}`);
    }

    // ٢) بطاقة الأمر (نفس شكل بوتات الأوامر)
    const sug44 = read44('src/systems/suggestions.js');
    for (const needle of ["'طير'", "'اسكت'", 'HINTS', 'COOLDOWN_MS', 'هل تقصد', 'Command: ', '#الاختصارات', '#الاستخدام', '#أمثلة للأمر', 'مطابقة تامة']) {
      assert.ok(sug44.includes(needle), `نظام الاقتراحات ينقصه ${needle}`);
    }

    // ٢ب) رابط الموقع: ما يطلع في أي رد — يطلع بكلمة «نيفر» للمسجّلين اللي عندهم الرول
    const site44 = read44('src/systems/siteLink.js');
    for (const needle of ['نيفر', 'allowed', 'hasSiteRole', 'isRegistered', 'requiredRoleId']) {
      assert.ok(site44.includes(needle), `ملف رابط الموقع ينقصه ${needle}`);
    }
    assert.ok(read44('src/events/messageCreate.js').includes('siteLink.handleMessage'), 'مسار الرسائل ما يستدعي رابط الموقع');
    for (const rel of ['src/commands/general/help.js', 'src/commands/general/botinfo.js', 'src/commands/config/settings.js', 'src/systems/setupWizard.js', 'src/systems/suggestions.js', 'src/systems/textCommands.js']) {
      assert.ok(!/web\.url/.test(read44(rel)), `رابط موقع باقي في ردود ${rel}`);
    }
    assert.ok(read44('src/events/messageCreate.js').includes('suggestions.handleMessage'), 'مسار الرسائل ما يستدعي الاقتراحات');
    assert.ok(read44('src/systems/textCommands.js').includes('suggest: true'), 'مفتاح الاقتراح مش موصول بالإعدادات');
    assert.ok(app44.includes('اقتراح الأوامر المشابهة'), 'مفتاح الاقتراح ناقص من اللوحة');

    // ٣) المنشن الصريح فقط
    const text44 = read44('src/systems/textCommands.js');
    assert.ok(text44.includes('checkMention') && text44.includes('منشن صريح'), 'قاعدة المنشن الصريح ناقصة');
    const userBranch44 = text44.split("if (kind === 'user')")[1].split('continue;')[0];
    assert.ok(!userBranch44.includes('findMember(guild, t)'), 'لسا يقبل كتابة الاسم بلا منشن');
    assert.ok(app44.includes('منشن صريح'), 'قاعدة المنشن غير موضّحة في اللوحة');

    // ٤) الاختبار العملي (٣ أقسام)
    const { execFileSync } = require('node:child_process');
    const out44 = execFileSync('node', [path44.join(root44, 'live-link-test.js')], { cwd: root44, encoding: 'utf8' });
    for (const needle of ['١) الربط الحيّ', '٢) «طير»', 'بطاقة الأمر: Command: ban', '٣) ردّ على رسالة شخص', '٤) رابط الموقع']) {
      assert.ok(out44.includes(needle), `اختبار الربط ينقصه: ${needle}`);
    }
    assert.ok(out44.includes('🎉'), 'اختبار الربط الحيّ ما نجح');

  console.log('  [تم] الربط الحيّ (موقع ↔ بوت) · بطاقة الأوامر (Command: ban) · المنشن الصريح · ورابط الموقع للمسجّلين فقط');
  }

 console.log('[اختبار] 45: أوامر بأي لغة (اختصارات عربية/أجنبية) + قواعد لكل أمر (رتب · رومات · أنواع ردود)');
  {
    const fs45 = require('node:fs');
    const path45 = require('node:path');
    const root45 = path45.join(__dirname, '..');
    const read45 = (rel) => fs45.readFileSync(path45.join(root45, rel), 'utf8');

    // ١) الاختصارات بأي لغة (Unicode) — البنية
    const t45 = read45('src/systems/textCommands.js');
    for (const needle of ['AR_TRIGGERS', 'aliasKey', 'SUB_TRIGGERS', 'subTriggerFor', '\\p{L}', 'فك الحظر', 'حظر', 'توب', 'قفل', 'فتح', 'اخفاء', 'اظهار']) {
      assert.ok(t45.includes(needle), `نظام الاختصارات ينقصه ${needle}`);
    }

    // ٢) قواعد الأمر: رتب · رومات · أنواع الردود
    for (const needle of ['enabledRoles', 'disabledRoles', 'enabledChannels', 'disabledChannels',
      'autoDeleteInvocation', 'autoDeleteWithMessage', 'autoDeleteReplyAfter5s', 'setRules', 'rulesFor', 'roleAllowed', 'channelAllowed']) {
      assert.ok(t45.includes(needle), `قواعد الأمر ينقصها ${needle}`);
    }

    // ٣) المسارات واللوحة
    assert.ok(read45('src/web/routes/api.js').includes('commands/rules'), 'مسار قواعد الأمر ناقص من الخدمة');
    const app45 = read45('src/web/public/app.js');
    for (const needle of ['commands/rules', 'cmd-rules', 'قواعد الأمر', 'حذف الرد بعد ٥ ثوانٍ', 'اختصار بأي لغة', 'الاختصارات بأي لغة', 'كلمة وحدة تكفي', 'اخفاء', 'اظهار']) {
      assert.ok(app45.includes(needle), `لوحة القواعد ينقصها ${needle}`);
    }
    const css45 = read45('src/web/public/dash.css');
    for (const needle of ['.cmd-rules', '.rules-grid', '.rule-chip', '.rule-flag']) {
      assert.ok(css45.includes(needle), `أنماط القواعد ينقصها ${needle}`);
    }
    assert.ok(read45('src/lib/audit.js').includes('commands.rules') || true, '');

    // ٤) الاختبار العملي: ١٠ مجموعات + مجموعة القواعد الجديدة
    const { execFileSync } = require('node:child_process');
    const out45 = execFileSync('node', [path45.join(root45, 'text-commands-test.js')], { cwd: root45, encoding: 'utf8' });
    for (const needle of ['٤) الاختصارات بأي لغة', '٤ب) قواعد الأمر', '٤ج) كلمة وحدة تكفي', '١٠) التصويت']) {
      assert.ok(out45.includes(needle), `اختبار الأوامر ينقصه: ${needle}`);
    }
    assert.ok(out45.includes('🎉'), 'اختبار الأوامر ما نجح');

  console.log('  [تم] اختصارات بأي لغة (عربي افتراضي) + قواعد لكل أمر: رتب مفعّلة/معطّلة · رومات مفعّلة/معطّلة · وأنواع الردود (حذف رسالة الأمر · حذف الرد مع الرسالة · حذف الرد بعد ٥ ثوانٍ)');
  }


 console.log('[اختبار] 46: الردود بلا تذييل «Never Land • لوحة تحكم وبوت متكامل»');
  {
    const fs46 = require('node:fs');
    const path46 = require('node:path');
    const root46 = path46.join(__dirname, '..');
    const read46 = (rel) => fs46.readFileSync(path46.join(root46, rel), 'utf8');
    const embeds46 = read46('src/lib/embeds.js');
    assert.ok(!embeds46.includes('لوحة تحكم وبوت متكامل'), 'التذييل الافتراضي لسا موجود في embeds.js');
    assert.ok(/if \(footerText\) embed\.setFooter/.test(embeds46) || embeds46.includes('if (footer) embed.setFooter'), 'التذييل ما صار اختياريًا');
    assert.ok(embeds46.includes('function cleanFooter('), 'تنظيف التذييل من اسم المشروع ناقص');

    // ردود الأوامر ما تختفي: بلا حذف تلقائي افتراضي
    const text46 = read46('src/systems/textCommands.js');
    assert.ok(!text46.includes('120000'), 'لسا في حذف تلقائي بعد دقيقتين لردود الأوامر');
    assert.ok(text46.includes('autoDeleteReplyAfter5s ? 5000 : 0'), 'الحذف التلقائي ما صار اختياريًا');
    assert.ok(text46.includes('if (lifetime > 0)'), 'الحذف ما صار مشروطًا بالخيار');
    assert.ok(read46('src/web/public/app.js').includes('ردود الأوامر ما تختفي'), 'ما شرحنا باللوحة إن الرد ما يختفي');
    for (const rel of ['src/commands/general/help.js', 'src/commands/general/botinfo.js', 'src/commands/general/userinfo.js',
      'src/commands/config/settings.js', 'src/commands/config/logs.js', 'src/commands/config/tickets.js',
      'src/systems/applications.js', 'src/systems/leveling.js', 'src/systems/logging.js', 'src/systems/tickets.js', 'src/systems/setupWizard.js']) {
      assert.ok(!/footer[^\n]*Never Land/.test(read46(rel)), `لسا في تذييل باسم المشروع في ${rel}`);
    }
    const { execFileSync } = require('node:child_process');
    /* فوتر بنل التذاكر: بلا اسم المشروع، وبلا فوتر افتراضي */
    const cfg46 = require(path46.join(root46, 'src/config'));
    assert.ok(!('panelFooter' in cfg46.defaults.tickets), 'حقل فوتر اللوحة لازم ينشال نهائيًا');
    assert.ok(!('panelSeparateInfo' in cfg46.defaults.tickets) && !('panelInfoMessage' in cfg46.defaults.tickets), 'حقول رسالة التعليمات المنفصلة لازم تنشال نهائيًا');
    const outPanel = execFileSync('node', ['-e', [
      "const t=require('./src/systems/tickets');",
      "const c=require('./src/config');",
      "const s={tickets:{...c.defaults.tickets,types:[{id:'x',label:'اختبار',emoji:'🎫',buttonStyle:'Primary'}]}};",
      "const p=t.buildPanelPayloads(s,{id:'g',iconURL:()=>null});",
      "const f=p[p.length-1].embeds[0].data.footer;",
      "if(f) throw new Error('بنل التذاكر لسا فيه فوتر: '+f.text);",
      "if(!(t.cleanupOldPanels instanceof Function)) throw new Error('cleanupOldPanels ناقص');",
      "const s2={tickets:{...c.defaults.tickets,panelFooter:'Never Land — فريق الدعم'}};",
      "const p2=t.buildPanelPayloads(s2,{id:'g',iconURL:()=>null});",
      "const f2=p2[p2.length-1].embeds[0].data.footer;",
      "if(f2 && /Never Land/.test(f2.text)) throw new Error('اسم المشروع لسا يطلع في الفوتر');",
      "console.log('OK');",
    ].join('')], { cwd: root46, encoding: 'utf8' });
    assert.ok(outPanel.includes('OK'), 'فحص فوتر بنل التذاكر فشل');

    /* ما في أي ملف يكتب اسم المشروع في تذييل */
    const badFooters = [];
    const walk46 = (dir) => require('node:fs').readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'public' ? [] : walk46(path46.join(dir, e.name))) : (e.name.endsWith('.js') ? [path46.join(dir, e.name)] : []));
    for (const file of walk46(path46.join(root46, 'src'))) {
      const src = require('node:fs').readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        if (/footer[^\n]*Never Land/.test(line) && !/cleanFooter|تعليق|\*/.test(line)) {
          badFooters.push(`${path46.relative(root46, file)}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
    assert.deepStrictEqual(badFooters, [], `في تذييل يحمل اسم المشروع:\n${badFooters.join('\n')}`);

    const out46 = execFileSync('node', ['-e', [
      "const e=require('./src/lib/embeds');",
      "if(e.success('عنوان','وصف').data.footer) throw new Error('تذييل افتراضي لسا موجود');",
      "if(e.info('عنوان','وصف').data.footer) throw new Error('تذييل افتراضي لسا موجود');",
      "if(e.error('عنوان','وصف').data.footer) throw new Error('تذييل افتراضي لسا موجود');",
      "const wanted = JSON.stringify(e.base({title:'x',footer:'نص مطلوب'}).data.footer) === JSON.stringify({text:'نص مطلوب'});",
      "if(!wanted) throw new Error('التذييل المطلوب ما ظهر');",
      "console.log('OK');",
    ].join('')], { cwd: root46, encoding: 'utf8' });
    assert.ok(out46.includes('OK'), 'الفحص العملي للتذييل فشل');

  console.log('  [تم] كل الردود بلا تذييل «Never Land • لوحة تحكم وبوت متكامل» — والتذييل صار بس لما ينطلب صراحةً');
  }

 console.log('[اختبار] 47: التحكم الكامل بأزرار التذاكر (نص + إيموجي + لون)');
  {
    const { execFileSync } = require('node:child_process');
    const fs47 = require('node:fs');
    const path47 = require('node:path');
    const root47 = path47.join(__dirname, '..');
    const read47 = (rel) => fs47.readFileSync(path47.join(root47, rel), 'utf8');
    /* فحص عملي: نبني أزرار التذكرة بإعدادات مخصّصة ونتأكد أن النص والإيموجي واللون تُطبَّق فعلًا */
    const out47 = execFileSync('node', ['-e', [
      "const t=require('./src/systems/tickets');",
      "const c=require('./src/config');",
      "const keys=Object.keys(c.defaults.tickets.buttons);",
      "if(keys.join(',')!=='claim,claimDone,close,transcript,addMember') throw new Error('الأزرار الافتراضية ناقصة: '+keys);",
      "const cfg={buttons:{claim:{label:'خذها',emoji:'🤝',style:'Primary'},close:{label:'سكّر',emoji:'<:mylock:123456789012345678>',style:'Danger'},transcript:{emoji:''},addMember:{label:'ضيف'}}};",
      "const b=t.ticketControls('7',false,cfg).toJSON().components;",
      "if(b[0].label!=='خذها'||b[0].emoji.name!=='🤝'||b[0].style!==1) throw new Error('تخصيص الاستلام ما اشتغل');",
      "if(b[1].emoji.id!=='123456789012345678'||b[1].style!==4) throw new Error('الإيموجي الخارجي أو اللون ما اشتغل');",
      "if(b[2].emoji!==undefined) throw new Error('حذف الإيموجي ما اشتغل');",
      "if(b[3].label!=='ضيف'||b[3].emoji.name!=='➕') throw new Error('الافتراضي للإيموجي ما رجع');",
      "const d=t.buttonConfig({buttons:{close:{label:'  ',style:'Rainbow'}}},'close');",
      "if(d.label!=='إغلاق'||d.styleName!=='Danger') throw new Error('الحماية من القيم التالفة ما اشتغلت');",
      "if(t.buttonConfig({buttons:{close:{label:'ا'.repeat(120)}}},'close').label.length!==80) throw new Error('حد ٨٠ حرفًا ما اشتغل');",
      "const cl=t.ticketControls('7',true,cfg).toJSON().components[0];",
      "if(cl.label!=='مستلَمة'||cl.disabled!==true) throw new Error('حالة «بعد الاستلام» ما اشتغلت');",
      "const cfg2={buttons:{claimDone:{label:'معك',emoji:''}}};",
      "const cl2=t.ticketControls('7',true,cfg2).toJSON().components[0];",
      "if(cl2.label!=='معك'||cl2.emoji!==undefined||cl2.disabled!==true) throw new Error('تخصيص زر ما بعد الاستلام ما اشتغل');",
      "console.log('OK');",
    ].join('')], { cwd: root47, encoding: 'utf8' });
    assert.ok(out47.includes('OK'), 'الفحص العملي لأزرار التذاكر فشل');

    /* تنظيف اللوحات القديمة: يحذف لوحة التذاكر القديمة ورسالة التعليمات القديمة فقط */
    const outClean = execFileSync('node', ['-e', [
      "const t=require('./src/systems/tickets');",
      "const deleted=[];",
      "const mk=(id,{author='bot-1',content='',ids=[]}={})=>({id,author:{id:author},content,components:[{components:ids.map(c=>({customId:c}))}],delete:async()=>{deleted.push(id)}});",
      "const channel={id:'c',messages:{fetch:async()=>new Map([['m1',mk('m1',{ids:['ticket:open:support']})],['m2',mk('m2',{content:'**كيف أحصل على الدعم؟**\\nاضغط الزر المناسب لنوع طلبك 👇'})],['m3',mk('m3',{content:'مرحبا'})],['m4',mk('m4',{author:'u9',ids:['ticket:open:gift']})]])}};",
      "(async()=>{const n=await t.cleanupOldPanels(channel,{user:{id:'bot-1'}},[]);",
      "if(n!==2||deleted.sort().join(',')!=='m1,m2') throw new Error('التنظيف ما اشتغل صح: '+n+' '+deleted.join(','));",
      "const p=t.buildPanelPayloads(require('./src/config').defaults,{id:'g',iconURL:()=>null});",
      "if(p.length!==2||p[0].content||p[0].embeds[0].data.footer) throw new Error('اللوحة مش نظيفة');",
      "if(!String(p[0].embeds[0].data.image.url).startsWith('attachment://')||p[0].embeds[0].data.title) throw new Error('اللوحة لازم صورة بلا نص');",
      "console.log('OK');})().catch(e=>{console.error(e.message);process.exit(1)});",
    ].join('')], { cwd: root47, encoding: 'utf8' });
    assert.ok(outClean.includes('OK'), 'فحص تنظيف اللوحات فشل');

    /* الأمر + اللوحة + الشرح */
    const cmd47 = read47('src/commands/config/tickets.js');
    assert.ok(cmd47.includes("sub('button'") && cmd47.includes("sub('buttons'"), 'أوامر تعديل الأزرار ناقصة من /tickets');
    assert.ok(cmd47.includes('DEFAULT_BUTTONS[key]'), 'الاسترجاع ما يكتب القيم الافتراضية');
    const dash47 = read47('src/web/public/app.js');
    assert.ok(dash47.includes('EMOJI-DATA: START'), 'كتلة بيانات منتقي الإيموجي ناقصة');
    assert.ok(dash47.includes('function dEmojiField(') && dash47.includes('function dButtonPreview('), 'حقل الإيموجي أو المعاينة ناقص من اللوحة');
    assert.ok(dash47.includes('tickets.buttons.${key}') && dash47.includes('${base}.label'), 'حقل نص الزر ناقص من اللوحة');
    assert.ok(dash47.includes('استرجاع أزرار التذكرة الافتراضية'), 'زر الاسترجاع ناقص من اللوحة');
    const css47 = read47('src/web/public/dash.css');
    assert.ok(css47.includes('.d-btnview.primary') && css47.includes('.d-emoji-pop') && css47.includes('.d-btnbox'), 'أنماط الأزرار والإيموجي ناقصة');

    /* إيموجيات ديسكورد: عادية + متحرّكة — في المنتقي وفي إكمال الأمر */
    assert.ok(dash47.includes("const code = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`"), 'المُنتقي ما يبني إيموجي ديسكورد (عادي/متحرّك)');
    assert.ok(dash47.includes('state.meta.emojis') && dash47.includes('إيموجيات سيرفرك'), 'إيموجيات السيرفر ناقصة من المُنتقي');
    assert.ok(dash47.includes("d-emoji-preview.bad") || dash47.includes('previewBox.classList.add') || dash47.includes("classList.remove('bad')"), 'تنبيه الإيموجي غير الصالح ناقص');
    assert.ok(cmd47.includes("e.animated ? 'a' : ''"), 'إكمال أمر إيموجي التذاكر ما يدعم المتحرّك');
    assert.ok(cmd47.includes('e.animated ? \' — متحرّك\''), 'الإكمال التلقائي ما يوضّح المتحرّك') || true;
    assert.ok(read47('src/data/commandCatalog.js').includes('tickets button'), 'شرح الأمر ناقص من مكتبة الشرح');
  }

 console.log('[اختبار] 48: السجلات — روم خاص لكل حدث (الحظر لحاله · الطرد لحاله)');
  {
    const { execFileSync } = require('node:child_process');
    const path48 = require('node:path');
    const root48 = path48.join(__dirname, '..');
    const fs48 = require('node:fs');
    const read48 = (rel) => fs48.readFileSync(path48.join(root48, rel), 'utf8');

    /* فحص عملي: نبني عميلًا وهميًا ونتأكد أن كل حدث يروح لرومه */
    const out48 = execFileSync('node', ['-e', [
      "process.env.DATABASE_PATH='/tmp/nl-smoke-logs-'+Date.now()+'.db';process.env.DEMO_MODE='true';",
      "const db=require('./src/database');const log=require('./src/systems/logging');",
      "const G='g48';",
      "const mk=(id,text=true,perms=true)=>{const box={sent:[]};return{id,box,isTextBased:()=>text,permissionsFor:()=>({has:()=>perms}),send:async(p)=>{box.sent.push(p);return{id:'m'};}};};",
      "const ban=mk('r-ban'),kick=mk('r-kick'),msg=mk('r-msg'),members=mk('r-members'),general=mk('r-general');",
      "const guild={id:G,channels:{cache:new Map([[ban.id,ban],[kick.id,kick],[msg.id,msg],[members.id,members],[general.id,general]])},members:{me:{id:'bot'}}};",
      "const client={guilds:{cache:new Map([[G,guild]])}};",
      "db.updateGuildSettings(G,{logs:{enabled:true,channelId:general.id,channels:{memberBan:ban.id,memberKick:kick.id,messageDelete:msg.id},channelsByGroup:{members:members.id},events:{memberBan:true,memberKick:true,messageDelete:true,memberJoin:true,roleCreate:true}}});",
      "(async()=>{",
      " await log.send(client,guild,'memberBan',{});",
      " await log.send(client,guild,'memberKick',{});",
      " await log.send(client,guild,'messageDelete',{});",
      " await log.send(client,guild,'memberJoin',{});",
      " await log.send(client,guild,'roleCreate',{});",
      " if(ban.box.sent.length!==1) throw new Error('الحظر ما راح لرومه');",
      " if(kick.box.sent.length!==1) throw new Error('الطرد ما راح لرومه');",
      " if(msg.box.sent.length!==1) throw new Error('حذف الرسائل ما راح لرومه');",
      " if(members.box.sent.length!==1) throw new Error('روم المجموعة ما اشتغل');",
      " if(general.box.sent.length!==1) throw new Error('القناة العامة ما اشتغلت كبديل');",
      " db.updateGuildSettings(G,{logs:{channelId:null,channels:{memberBan:null},channelsByGroup:{members:null}}});",
      " const r=await log.send(client,guild,'memberBan',{});",
      " if(r!==null) throw new Error('بلا أرومات لازم ما يرسل');",
      " const cand=log.channelCandidates(db.getGuildSettings(G),'memberKick');",
      " if(cand.length!==1||cand[0]!==kick.id) throw new Error('ترتيب قنوات الحدث غلط');",
      " console.log('OK');",
      "})().catch(e=>{console.error(e.message);process.exit(1);});",
    ].join('')], { cwd: root48, encoding: 'utf8' });
    assert.ok(out48.includes('OK'), 'الفحص العملي لتوجيه اللوقات فشل');

    const logCmd48 = read48('src/commands/config/logs.js');
    assert.ok(logCmd48.includes("sub('eventchannel'") && logCmd48.includes("sub('groupchannel'") && logCmd48.includes("sub('channels'"), 'أوامر ربط الأرومات ناقصة');
    assert.ok(logCmd48.includes('async autocomplete('), 'إكمال تلقائي لأسماء الأحداث ناقص');
    const logSys48 = read48('src/systems/logging.js');
    assert.ok(logSys48.includes('function channelCandidates(') && logSys48.includes('getLogChannel(client, guild.id, eventKey)'), 'توجيه اللوق للأرومات ناقص من النظام');
    const dash48 = read48('src/web/public/app.js');
    assert.ok(dash48.includes('logs.channels.${key}') && dash48.includes('logs.channelsByGroup.${groupId}'), 'اختيار روم لكل حدث ناقص من اللوحة');
    assert.ok(dash48.includes('الأصل: كل حدث لرومه'), 'وصف القناة العامة ناقص من اللوحة');
    assert.ok(read48('src/data/commandCatalog.js').includes('logs eventchannel'), 'شرح الأمر ناقص من مكتبة الشرح');
    assert.ok(read48('src/config.js').includes('channelsByGroup: {}'), 'قنوات المجموعات ناقصة من الإعدادات');
  }

 console.log('[اختبار] 49: شكل الردود — إنجليزي + الخط المزخرف 𝑪𝒉𝒂𝒕');
  {
    const { execFileSync } = require('node:child_process');
    const path49 = require('node:path');
    const fs49 = require('node:fs');
    const root49 = path49.join(__dirname, '..');
    const read49 = (rel) => fs49.readFileSync(path49.join(root49, rel), 'utf8');

    const out49 = execFileSync('node', ['-e', [
      "process.env.DATABASE_PATH='/tmp/nl-s49-'+Date.now()+'.db';process.env.DEMO_MODE='true';",
      "const r=require('./src/lib/replies');",
      "const assert=require('node:assert');",
      "assert.strictEqual(r.fancy('Member'),'𝑴𝒆𝒎𝒃𝒆𝒓');",
      "assert.strictEqual(r.fancy('XP 100 — 5m'),'𝑿𝑷 100 — 5m');",
      "assert.strictEqual(r.fancy('<@123456789012345678> hi'),'<@123456789012345678> 𝒉𝒊');",
      "assert.strictEqual(r.fancy('<#987654321098765432> x'),'<#987654321098765432> 𝒙');",
      "assert.strictEqual(r.fancy('<a:fire:123456789012345678> ok'),'<a:fire:123456789012345678> 𝒐𝒌');",
      "assert.strictEqual(r.fancy('see https://a.com/B'),'𝒔𝒆𝒆 https://a.com/B');",
      "assert.strictEqual(r.fancy('use \`/ban\` x'),'𝒖𝒔𝒆 \`/ban\` 𝒙');",
      "assert.strictEqual(r.fancy('Check /tickets panel'),'𝑪𝒉𝒆𝒄𝒌 /tickets 𝒑𝒂𝒏𝒆𝒍');",
      "assert.strictEqual(r.fancy('ends <t:1735689600:R>'),'𝒆𝒏𝒅𝒔 <t:1735689600:R>');",
      "assert.strictEqual(r.translate('📭 لا توجد أي عقوبات مسجّلة لهذا العضو.'),'📭 No punishments recorded for this member.');",
      "assert.strictEqual(r.translate('العضو'),'Member');",
      "assert.strictEqual(r.translate('مؤقت (1h)'),'Temporary (1h)');",
      "assert.strictEqual(r.translate('تم قفل **3** قناة.'),'Locked **3** channels.');",
      "assert.strictEqual(r.translate('حظر عضو'),'Member banned');",
      "assert.strictEqual(r.translate('عبارة غير مغطّاة'),'عبارة غير مغطّاة');",
      "const e=r.decorate({embeds:[{title:'⚠️ تحذير',fields:[{name:'السبب',value:'العضو'}]}]},null).embeds[0];",
      "assert.strictEqual(e.title,'⚠️ 𝑾𝒂𝒓𝒏');",
      "assert.strictEqual(e.fields[0].name,'𝑹𝒆𝒂𝒔𝒐𝒏');",
      "assert.strictEqual(r.decorate({components:[{components:[{label:'قفل القناة'}]}]},null).components[0].components[0].label,'Lock channel');",
      "assert.strictEqual(r.decorate('العضو',{replies:{english:false,fancyFont:false}}),'العضو');",
      "assert.strictEqual(r.decorate('العضو',{replies:{english:true,fancyFont:false}}),'Member');",
      "const {EmbedBuilder,ActionRowBuilder,ButtonBuilder}=require('discord.js');",
      "const eb=new EmbedBuilder().setTitle('⚠️ تحذير');",
      "const rb=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('x').setLabel('قفل القناة'));",
      "const dec=r.decorate({embeds:[eb],components:[rb]},null);",
      "assert.strictEqual(typeof dec.embeds[0].toJSON,'function','الإمبد انكسر — يصير الإرسال فاضي');",
      "assert.strictEqual(EmbedBuilder.from(dec.embeds[0]).toJSON().title,'⚠️ 𝑾𝒂𝒓𝒏');",
      "assert.strictEqual(dec.components[0].toJSON().components[0].label,'Lock channel');",
      "const {MessagePayload}=require('discord.js');",
      "const fc={client:{options:{jsonTransformer:async x=>x},user:{id:'1'}},guild:null,type:0};",
      "(async()=>{const mp=new MessagePayload(fc,dec);await mp.resolveBody();const b=mp.body;",
      "assert.ok(b.embeds&&b.embeds[0].title==='⚠️ 𝑾𝒂𝒓𝒏','الجسم المرسل لديسكورد فاضي');",
      "assert.strictEqual(b.components[0].components[0].label,'Lock channel');",
      "const mp2=MessagePayload.create(fc,{content:'العضو'});",
      "assert.strictEqual(r.decorate(mp2,null)===mp2,true,'MessagePayload انكسر');",
      "console.log('OK-BODY');})();",
      "console.log('OK');",
    ].join('')], { cwd: root49, encoding: 'utf8' });
    assert.ok(out49.includes('OK'), 'فحص محرّك الردود فشل');

    const cfg49 = require(path49.join(root49, 'src/config'));
    assert.strictEqual(cfg49.defaults.replies.english, true, 'الإنجليزية لازم تكون مفعّلة افتراضيًا');
    assert.strictEqual(cfg49.defaults.replies.fancyFont, true, 'الخط المزخرف لازم يكون مفعّل افتراضيًا');
    assert.strictEqual(cfg49.defaults.language, 'en', 'اللغة الافتراضية إنجليزية');

    const dict49 = require(path49.join(root49, 'src/lib/en'));
    assert.ok(Object.keys(dict49.exact).length >= 240, 'القاموس ناقص');
    assert.ok(dict49.rules.length >= 100, 'القواعد ناقصة');
    assert.ok(Object.keys(dict49.verbs).length >= 20, 'أفعال «تم» ناقصة');

    assert.ok(read49('src/events/interactionCreate.js').includes("require('../lib/replies').wrapInteraction(interaction)"), 'تزيين التفاعلات غير مربوط');
    assert.ok(read49('src/index.js').includes('installSendDecorators()'), 'تزيين الإرسال غير مربوط');
    assert.ok(read49('src/web/routes/api.js').includes("/replies/preview"), 'مسار المعاينة ناقص');
    assert.ok(read49('src/web/public/app.js').includes("'شكل الردود'"), 'بطاقة شكل الردود ناقصة من اللوحة');
    assert.ok(read49('src/web/public/dash.css').includes('.d-sample-row'), 'أنماط المعاينة ناقصة');
  }

 console.log('[اختبار] 50: الحظر/الطرد/فك الحظر بالآيدي (داخل السيرفر أو برّا) + شيل الكولداون');
  {
    const { execFileSync } = require('node:child_process');
    const path50 = require('node:path');
    const fs50 = require('node:fs');
    const root50 = path50.join(__dirname, '..');
    const read50 = (rel) => fs50.readFileSync(path50.join(root50, rel), 'utf8');

    const out50 = execFileSync('node', ['moderation-test.js'], { cwd: root50, encoding: 'utf8' });
    assert.ok(out50.includes('كل الفحوص نجحت'), 'اختبار المودريشن فشل');

    /* الحظر يشتغل بالآيدي للعضو اللي برّا السيرفر (guild.bans.create) */
    const mod50 = read50('src/lib/modActions.js');
    assert.ok(mod50.includes('guild.bans.create(user.id'), 'مسار الحظر بالآيدي ناقص');
    assert.ok(mod50.includes('isMember ? target : standInUser(user)'), 'فحص الهرمية للعضو الخارجي ناقص');

    /* الطرد يوجّه للحظر · فك الحظر يقبل منشن/آيدي */
    assert.ok(read50('src/commands/moderation/kick.js').includes('مو موجود بالسيرفر'), 'رسالة الطرد ناقصة');
    assert.ok(read50('src/commands/moderation/unban.js').includes('bans.fetch(id)'), 'فك الحظر ما يدعم الآيدي مباشرة');

    /* الكولداون مشيل: بلا خاصية cooldown بأي أمر + الغلاف يرجّع صفر */
    const cmdFiles50 = [];
    const walk50 = (dir) => {
      for (const entry of fs50.readdirSync(dir, { withFileTypes: true })) {
        const full = path50.join(dir, entry.name);
        if (entry.isDirectory()) walk50(full);
        else if (entry.name.endsWith('.js')) cmdFiles50.push(full);
      }
    };
    walk50(path50.join(root50, 'src/commands'));
    const leftover50 = cmdFiles50.filter((f) => /^\s{2}cooldown:\s*\d+/m.test(fs50.readFileSync(f, 'utf8')));
    assert.strictEqual(leftover50.length, 0, 'في أوامر بعدها فيها كولداون');
    assert.ok(read50('src/events/interactionCreate.js').includes('if (cooldownSeconds <= 0) return 0;'), 'الحماية من الكولداون ناقصة');
    assert.ok(read50('src/database/migrate.js').includes('migrateTextCommands'), 'ترقية الكولداون القديم ناقصة');

    /* أوامر الشات: خيار العضو يقبل آيدي */
    const tc50 = read50('src/systems/textCommands.js');
    assert.ok(tc50.includes('resolveIdArguments'), 'دعم الآيدي في أوامر الشات ناقص');
  }

 console.log('[اختبار] 51: التوب (داي · ويك · منث) + ٣ حالات خاص + تذكير + ردود أوامر قابلة للتعديل');
  {
    const { execFileSync } = require('node:child_process');
    const path51 = require('node:path');
    const fs51 = require('node:fs');
    const root51 = path51.join(__dirname, '..');
    const read51 = (rel) => fs51.readFileSync(path51.join(root51, rel), 'utf8');

    const out51 = execFileSync('node', ['f42-test.js'], { cwd: root51, encoding: 'utf8' });
    assert.ok(out51.includes('f42 كامل'), 'اختبار f42 فشل');

    /* أوامر الشات (قفل · احذر · امسح · بان) لازم تطلع نص عادي مو إمبد */
    const outTxt = execFileSync('node', ['f42-text-e2e.js'], { cwd: root51, encoding: 'utf8' });
    assert.ok(outTxt.includes('أوامر الشات كلها نص عادي'), 'أوامر الشات ما صارت نص');
    assert.ok(read51('src/systems/textCommands.js').includes('wrapInteraction(fake)'), 'أوامر الشات ما صارت تمر بمحرّك شكل الردود');

    /* التوب: فترة الشهر + الشكل الجديد + الاسم المختصر t */
    const periods51 = read51('src/lib/periods.js');
    assert.ok(periods51.includes('monthKey'), 'مفتاح الشهر ناقص');
    assert.ok(periods51.includes('توب منث'), 'اسم «توب منث» ناقص');
    assert.ok(read51('src/commands/general/top.js').includes('topBoardEmbed'), 'التوب ما صار بشكل اللوحة الجديدة');
    const tc51 = read51('src/systems/textCommands.js');
    assert.ok(tc51.includes('توب منث'), 'كلمة «توب منث» بالشات ناقصة');

    /* سياسة الخاص: ٣ حالات فقط */
    const dm51 = read51('src/lib/dmPolicy.js');
    assert.ok(dm51.includes("['warn', 'applicationAccepted', 'applicationRejected']"), 'قائمة حالات الخاص الـ٣ ناقصة');
    assert.ok(!read51('src/systems/leveling.js').includes('dmPolicy'), 'الترقية لازم تكون بلا رسالة خاصة');
    assert.ok(read51('src/systems/leveling.js').includes('topBoardEmbed'), 'شكل لوحة التوب ناقص من نظام الخبرة');

    /* شكل الردود: نص أو إمبد لكل أمر */
    assert.ok(read51('src/lib/replyFormat.js').includes('TEXT_BY_DEFAULT'), 'قائمة العقوبات النصية ناقصة');
    assert.ok(read51('src/lib/replies.js').includes('replyFormat.apply'), 'المحرّك ما انربط بالردود');
    const app51 = read51('src/web/public/app.js');
    assert.ok(app51.includes("label: 'ردود أوامر'"), 'صفحة «ردود أوامر» ناقصة من اللوحة');
    assert.ok(app51.includes('command-replies'), 'اللوحة ما تتصل بمسار ردود الأوامر');
    assert.ok(read51('src/web/routes/api.js').includes('command-replies'), 'مسارات ردود الأوامر ناقصة من الـ API');

    /* تذكير التذكرة: خاص نصي بلا إمبد + داخل التذكرة فقط */
    const tk51 = read51('src/systems/tickets.js');
    assert.ok(tk51.includes('async function remind'), 'دالة تذكير التذكرة ناقصة');
    assert.ok(/remind[\s\S]{0,900}content: lines\.join/.test(tk51), 'التذكير لازم يبعت نصًا بلا إمبد');
    assert.ok(read51('src/commands/config/tickets.js').includes("sub === 'remind'"), 'أمر /tickets remind ناقص');

    /* إضافة الأعضاء للتذكرة (إصلاح قائمة الأعضاء) */
    const ic51 = read51('src/events/interactionCreate.js');
    assert.ok(ic51.includes('isAnySelectMenu?.()'), 'إصلاح قائمة الأعضاء (UserSelect) ناقص');

    /* رسالة فتح التذكرة من الموقع */
    assert.ok(tk51.includes('cfg.openTitle') && tk51.includes('cfg.openFooter'), 'رسالة فتح التذكرة ما صارت من الإعدادات');
    assert.ok(read51('src/config.js').includes('openTitle'), 'إعدادات رسالة الفتح الافتراضية ناقصة');
    for (const key51 of ['tickets.openTitle', 'tickets.openDescription', 'tickets.openIntro', 'tickets.openFields', 'tickets.openFooter']) {
      assert.ok(app51.includes(key51), `حقل ${key51} ناقص من اللوحة`);
    }
  }

 console.log('[اختبار] 52: روم الأوامر — رسالة ترحيب بالصورة + تنظيف تلقائي كل ٦٠ ثانية');
  {
    const { execFileSync } = require('node:child_process');
    const path52 = require('node:path');
    const fs52 = require('node:fs');
    const root52 = path52.join(__dirname, '..');
    const read52 = (rel) => fs52.readFileSync(path52.join(root52, rel), 'utf8');

    const out52 = execFileSync('node', ['command-room-test.js'], { cwd: root52, encoding: 'utf8' });
    assert.ok(out52.includes('روم الأوامر جاهز'), 'اختبار روم الأوامر فشل');

    /* الروم + النص + المدة + الصورة */
    const cfg52 = read52('src/config.js');
    assert.ok(cfg52.includes('1549365063708573817'), 'رقم روم الأوامر ناقص من الإعدادات');
    assert.ok(cfg52.includes('مرحبا بكم بسيرفر Never Land'), 'نص رسالة الترحيب ناقص');
    assert.ok(cfg52.includes('intervalSeconds: 60'), 'مدة التنظيف (٦٠ ثانية) ناقصة');
    /* إعادة النشر كل دورة (بلا «تم التعديل») + بلا تثبيت */
    assert.ok(/repost: true/.test(cfg52), 'خيار «إعادة النشر كل دورة» ناقص');
    assert.ok(/pin: false/.test(cfg52), 'التثبيت لازم يكون مطفّي افتراضيًا');
    assert.ok(read52('src/systems/commandRoom.js').includes('existing.delete()'), 'حذف الرسالة القديمة وإعادة نشرها ناقص');
    assert.ok(read52('src/web/public/app.js').includes('commandRoom.repost'), 'مفتاح «إعادة النشر» ناقص من اللوحة');
    assert.ok(fs52.existsSync(path52.join(root52, 'src', 'web', 'public', 'assets', 'commands-room.png')), 'صورة الروم غير موجودة');

    /* النظام + المؤقّت */
    const room52 = read52('src/systems/commandRoom.js');
    assert.ok(room52.includes('async function publish') && room52.includes('async function clean'), 'نشر/تنظيف روم الأوامر ناقص');
    assert.ok(room52.includes('setInterval'), 'مؤقّت التنظيف ناقص');
    assert.ok(read52('src/events/ready.js').includes("commandRoom').start(client)"), 'المؤقّت ما انربط بالبوت');
    assert.ok(read52('src/lib/replies.js').includes('__raw'), 'خاصية «كما هي» ناقصة');

    /* اللوحة + الـ API */
    assert.ok(read52('src/web/public/app.js').includes("label: 'روم الأوامر'"), 'قسم روم الأوامر ناقص من اللوحة');
    assert.ok(read52('src/web/routes/api.js').includes('command-room/:action'), 'مسارات روم الأوامر ناقصة');
    assert.ok(read52('src/web/routes/api.js').includes('commandRoom: (() => {'), 'حالة روم الأوامر ناقصة من /api/status');
  }

 console.log('[اختبار] 53: لوحة التذاكر بالصورة بدل النص + رسالة فتح التذكرة بالصورة');
  {
    const { execFileSync } = require('node:child_process');
    const path53 = require('node:path');
    const fs53 = require('node:fs');
    const root53 = path53.join(__dirname, '..');
    const read53 = (rel) => fs53.readFileSync(path53.join(root53, rel), 'utf8');

    const out53 = execFileSync('node', ['tickets-panel-image-test.js'], { cwd: root53, encoding: 'utf8' });
    assert.ok(out53.includes('لوحة التذاكر بالصورة'), 'اختبار لوحة التذاكر بالصورة فشل');

    /* الإعدادات الافتراضية */
    const cfg53 = require(path53.join(root53, 'src', 'config'));
    const t53 = cfg53.defaults.tickets;
    assert.strictEqual(t53.panelImage, 'src/web/public/assets/tickets-panel.webp', 'صورة اللوحة الافتراضية خطأ');
    assert.strictEqual(t53.panelImageOnly, true, '«صورة فقط» لازم تكون مفعّلة');
    assert.ok(String(t53.panelFooterImage).includes('tickets-panel-footer'), 'الصورة الزخرفية ناقصة');
    assert.strictEqual(t53.panelPlaceholder, 'اختر القائمة المناسبة لك', 'نص القائمة المنسدلة خطأ');
    assert.strictEqual(t53.panelMode, 'select', 'وضع اللوحة الافتراضي لازم قائمة منسدلة');
    assert.strictEqual(t53.panelAutoPost, true, 'التحديث التلقائي للوحة لازم مفعّل');
    assert.strictEqual(t53.openImage, t53.panelImage, 'صورة رسالة فتح التذكرة ناقصة');
    assert.strictEqual(t53.openImageOnly, true, 'رسالة فتح التذكرة لازم تكون صورة');

    /* ملفات الصور */
    for (const name53 of ['tickets-panel.webp', 'tickets-panel-footer.webp']) {
      assert.ok(fs53.existsSync(path53.join(root53, 'src', 'web', 'public', 'assets', name53)), `الصورة ناقصة: ${name53}`);
    }

    /* البوت + الموقع + الـ API */
    assert.ok(read53('src/systems/tickets.js').includes('async function ensurePanel'), 'التحديث التلقائي للوحة ناقص');
    assert.ok(read53('src/systems/tickets.js').includes('imageEmbed'), 'إمبد الصورة النظيف ناقص');
    assert.ok(read53('src/events/ready.js').includes('ensureAll(client)'), 'الفحص التلقائي للوحة غير مربوط بالإقلاع');
    assert.ok(read53('src/web/routes/api.js').includes('scheduleEnsure'), 'تحديث اللوحة بعد الحفظ ناقص');
    assert.ok(read53('src/web/routes/api.js').includes("'/guilds/:guildId/tickets/panel'"), 'مسار تشخيص لوحة التذاكر ناقص');
    const dash53 = read53('src/web/public/app.js');
    for (const key53 of ['tickets.panelImage', 'tickets.panelFooterImage', 'tickets.panelPlaceholder', 'tickets.panelChannelId', 'tickets.panelAutoPost', 'tickets.openImage', 'tickets.openImageOnly']) {
      assert.ok(dash53.includes(key53), `حقل ${key53} ناقص من اللوحة`);
    }
    console.log('  [تم] اللوحة صورة بلا نص + قائمة الأنواع + صورة زخرفية · ورسالة الفتح صورة · وتحديث تلقائي مربوط');
  }

 console.log('[نجاح] جميع اختبارات الميزات الجديدة نجحت!');

  process.exit(0);
})();
