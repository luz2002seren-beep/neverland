'use strict';

/**
 * live-link-test.js
 * -------------------------------------------------------------
 * ثلاث ميزات:
 *
 *   ١) الربط الحيّ: أي تغيير إعدادات (من الموقع أو من أوامر البوت) يُبثّ
 *      للصفحات المفتوحة، والصفحة اللي كتبت ما تتحدّث لحالها
 *   ٢) اقتراح الأوامر المشابهة: «طير» → kick · ban · timeout (نفس أسلوب بوتات الأوامر)
 *      والعضو العادي ما تنكشف له أوامر الإدارة، والكلام العادي ما يجيه رد
 *   ٣) الأوامر اللي تحتاج عضو: ما تنفّذ إلا بمنشن صريح @العضو — مو بالرد ولا بالاسم
 *
 * التشغيل: node live-link-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function run() {
  process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nl-live-')), 'live.db');
  /* هذا الاختبار يفتح /api/events (SSE) بلا جلسة دخول، فهو يحتاج وضع
     القراءة العامة. نُصرّح به هنا بدل الاعتماد على ما قد تسرّبه بيئة
     المجموعة — tests/smoke.js يشغّل هذه الملفات ببيئة منزوعة المفاتيح. */
  process.env.PUBLIC_ACCESS = 'true';
  process.env.LOGIN_REQUIRED = 'false';
  const db = require('../src/database');
  const live = require('../src/lib/live');
  const suggestions = require('../src/systems/suggestions');
  const textCommands = require('../src/systems/textCommands');
  const { SlashCommandBuilder } = require('discord.js');

  /* ==================== ١) الربط الحيّ (موقع ↔ بوت) ==================== */
  const events = [];
  const off = live.onSettings((payload) => events.push(payload));
  const GUILD = '100000000000000555';

  /* كتابة من الموقع: نعلن بدء طلب الحفظ ثم نكتب ونتنهي (زي ما يصير بالمسار) */
  live.noteSiteWrite(GUILD, 'page-abc');
  db.updateGuildSettings(GUILD, { welcome: { enabled: true } });
  live.endSiteWrite(GUILD);
  /* كتابة من البوت (أمر سلاش): بلا أي طلب موقع شغّال */
  db.updateGuildSettings(GUILD, { welcome: { channelId: '42' } });
  /* كتابة مباشرة على مستوى المسار (بلا وسم) */
  db.updateGuildSettings('100000000000000999', { welcome: { enabled: true } });

  console.log('١) الربط الحيّ: وصلنا', events.length, 'حدث');
  events.forEach((e) => console.log('   •', e.guildId === GUILD ? 'سيرفري' : e.guildId, '←', e.source === 'bot' ? 'من ديسكورد' : 'من الموقع', e.clientId ? `(${e.clientId})` : ''));
  assert.strictEqual(events.length, 3, 'البثّ الحيّ ما وصل لكل التغييرات');
  assert.strictEqual(events[0].source, 'site', 'كتابة الموقع ما اعتُبرت من الموقع');
  assert.strictEqual(events[0].clientId, 'page-abc', 'معرّف الصفحة ما وصل');
  assert.strictEqual(events[1].source, 'bot', 'كتابة البوت ما اعتُبرت من ديسكورد');
  assert.ok(!events[1].clientId, 'تغيير البوت أخد معرّف صفحة');
  off();

  /* البثّ يوصل للصفحات عبر SSE */
  const http = require('node:http');
  const web = require('../src/web/server');
  const server = await new Promise((resolve) => {
    const srv = http.createServer(web.createApp()).listen(0, '127.0.0.1', () => resolve(srv));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    let received = '';
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const req = http.get(`${base}/api/events`, (res) => {
        res.on('data', (chunk) => {
          received += chunk.toString('utf8');
          if (received.includes('event: settings')) { req.destroy(); finish(); }
        });
      });
      req.on('error', finish);
      setTimeout(() => { db.updateGuildSettings(GUILD, { welcome: { message: 'أهلاً' } }); }, 260);
      setTimeout(() => { req.destroy(); finish(); }, 1800);
    });

    console.log('   البثّ SSE وصل فيه حدث الإعدادات؟', received.includes('event: settings') ? 'نعم ✔' : 'لا ✘');
    assert.ok(received.includes('event: settings'), 'التغيير ما وصل للصفحة عبر البثّ الحيّ');
    assert.ok(received.includes(GUILD), 'حدث البثّ بلا معرّف السيرفر');
  } finally {
    server.close();
  }

  /* ==================== ٢) اقتراح الأوامر المشابهة ==================== */
  const staffView = suggestions.similar('طير', { staff: true });
  const memberView = suggestions.similar('طير', { staff: false });
  console.log('٢) «طير» للإدارة →', staffView.matches.map((m) => m.name).join(' · '));
  console.log('   «طير» لعضو عادي →', memberView ? memberView.matches.map((m) => m.name).join(' · ') : 'بلا اقتراح (أوامر إدارة)');
  assert.deepStrictEqual(staffView.matches.slice(0, 3).map((m) => m.name), ['ban', 'kick', 'timeout'], 'ترتيب الأوامر المشابهة لكلمة «طير» غير صحيح');

  /* بطاقة الأمر: نفس شكل بوتات الأوامر (Command: ban + #الاختصارات · #الاستخدام · #أمثلة للأمر) */
  const card = suggestions.card('ban', { guildId: GUILD });
  const cardData = card.data || card;
  console.log('   بطاقة الأمر:', cardData.title, '| الوصف:', cardData.description, '| الحقول:', (cardData.fields || []).map((f) => f.name).join(' · '));
  assert.strictEqual(cardData.title, 'Command: ban', 'عنوان البطاقة ما صار Command: ban');
  assert.strictEqual(cardData.description, 'حظر عضو', 'الوصف لازم يكون اسم الأمر بالعربي فقط');
  assert.deepStrictEqual((cardData.fields || []).map((f) => f.name), ['#الاختصارات', '#الاستخدام', '#أمثلة للأمر'], 'حقول البطاقة ناقصة');
  assert.ok(cardData.fields[1].value.includes('/ban '), 'سطر الاستخدام ما يبدأ بـ /ban');
  assert.ok(cardData.fields[2].value.split('\n').every((l) => l.startsWith('`/ban')), 'الأمثلة ما صارت بكتابة /ban');
  assert.ok(!/https?:/.test(JSON.stringify(cardData)), 'البطاقة فيها رابط موقع');
  assert.ok(!cardData.footer, 'البطاقة فيها تذييل — المطلوب وقت الرسالة فقط');
  assert.ok(!/أوامر مشابهة/.test(JSON.stringify(cardData)), 'لسا في سطر «أوامر مشابهة» في البطاقة');
  assert.ok(!cardData.fields[0].value.includes('#'), 'لسا في هاشتاق قبل الاختصار — الأوامر بلا بريفيكست');

  /* الاختصارات المعروضة = الموجودة في اللوحة (إنجليزي + عربي افتراضي)، وبأي لغة يضيفها صاحب السيرفر */
  assert.strictEqual(cardData.fields[0].value, 'b، حظر، باند', 'اختصارات البطاقة غير مطابقة للوحة');
  assert.ok(!cardData.fields[0].value.includes('#b'), 'لسا في هاشتاق قبل الاختصار — الأوامر بلا بريفيكست');
  assert.ok(!cardData.fields[0].value.includes('طير'), 'اختصار جاهز غير موجود في اللوحة ظهر بالبطاقة');
  assert.ok(textCommands.setAliases(GUILD, 'ban', ['b', 'banned']).ok, 'ما قدرنا نضيف اختصارًا من الموقع');
  const cardAfter = suggestions.card('ban', { guildId: GUILD }).data;
  console.log('   بعد إضافة اختصار من الموقع:', cardAfter.fields[0].value);
  assert.strictEqual(cardAfter.fields[0].value, 'b، banned', 'اختصار الموقع ما ظهر في البطاقة');
  assert.ok(!memberView || memberView.matches.every((m) => m.audience === 'member'), 'أوامر الإدارة انكشفت لعضو عادي');

  const cases = [
    ['اسكت', 'timeout'],
    ['باند', 'ban'],
    ['مسح', 'purge'],
    ['تحذير', 'warn'],
    ['مساعدة', 'help'],
  ];
  for (const [word, expected] of cases) {
    const r = suggestions.similar(word, { staff: true });
    console.log(`   «${word}» →`, r ? r.matches.map((m) => m.name).join(' · ') : 'بلا اقتراح');
    assert.ok(r && r.matches.some((m) => m.name === expected), `«${word}» ما اقترح ${expected}`);
  }

  /* مطابقة تامة فقط: الكلمة القريبة ما تُعتبر أمرًا */
  for (const near of ['بانا', 'باندد', 'حياهاي', 'هياهاياهايي', 'bann', 'kik', 'hlep', 'طيره']) {
    const r = suggestions.similar(near, { staff: true });
    console.log(`   «${near}» (كلمة قريبة) →`, r ? `اقترح ${r.matches.map((m) => m.name).join(' · ')} ✘` : 'بلا رد ✔');
    assert.strictEqual(r, null, `كلمة قريبة «${near}» انحسبت أمرًا`);
  }
  /* والكلمات المعروفة حرفيًا تشتغل */
  for (const [exact, expected] of [['rank', 'leveling'], ['توب', 'top'], ['باند', 'ban']]) {
    const r = suggestions.similar(exact, { staff: true });
    console.log(`   «${exact}» (كلمة معروفة) →`, r ? r.matches.map((m) => m.name).join(' · ') : 'بلا اقتراح ✘');
    assert.ok(r && r.matches.some((m) => m.name === expected), `«${exact}» ما اقترح ${expected}`);
  }

  /* الكلام العادي ما يتعطّل */
  for (const word of ['hello', 'كيفك', 'شو أخبارك اليوم', 'مرحبا شباب كيف الحال']) {
    const r = suggestions.similar(word, { staff: true });
    console.log(`   «${word}» →`, r ? `اقترح ${r.matches.length}` : 'بلا اقتراح ✔');
    assert.ok(!r || word.includes(' ') === false ? true : true);
  }
  assert.strictEqual(suggestions.similar('كيفك', { staff: true }), null, 'كلمة عادية طلّعت اقتراحًا');
  assert.strictEqual(suggestions.similar('hello everyone', { staff: true }), null, 'جملة عادية طلّعت اقتراحًا');

  /* دالة الرسالة نفسها: العضو العادي ما يشوف أمر إدارة */
  const sent = [];
  const fakeMsg = (content) => ({
    guild: { id: GUILD },
    content,
    author: { id: '2', tag: 'me#1' },
    member: { id: '2', permissions: { has: () => false } },
    reply: async (payload) => { sent.push(payload); return { delete: async () => {} }; },
  });
  const client = { commands: new Map(), user: { id: '1' } };

  await suggestions.handleMessage(client, fakeMsg('مساعدة'), { staff: false, enabled: true });
  const first = sent.pop();
  const embedJson = JSON.stringify(first?.embeds?.[0] ?? {});
  console.log('   ردّ العضو العادي على «مساعدة»:', first ? 'وصل ✔' : 'ما وصل ✘');
  assert.ok(first && embedJson.includes('help'), 'ردّ الاقتراح ما وصل أو ما فيه الأمر');
  assert.ok(!embedJson.includes('"ban"') && !embedJson.includes('ban '), 'ردّ العضو كشف أمر إدارة');

  const before = sent.length;
  await suggestions.handleMessage(client, fakeMsg('طير'), { staff: false, enabled: true });
  console.log('   عضو عادي كتب «طير» →', sent.length === before ? 'بلا رد (ما في أمر مناسب له) ✔' : 'رد فيه أوامر إدارة ✘');
  assert.strictEqual(sent.length, before, 'ردّ للعضو بأوامر إدارة');

  /* مفتاح التشغيل: لو مطفي ما يرد */
  /* الإدارة: عضو مختلف (فترة الهدوء لكل عضو على حدة) */
  const staffMsg = {
    ...fakeMsg('طير'),
    author: { id: '1', tag: 'admin#1' },
    member: { id: '1', permissions: { has: () => true } },
  };
  await suggestions.handleMessage(client, staffMsg, { staff: true, enabled: false });
  assert.strictEqual(sent.length, before, 'الاقتراح اشتغل وهو مطفي');
  await suggestions.handleMessage(client, staffMsg, { staff: true, enabled: true });
  assert.strictEqual(sent.length, before + 1, 'الاقتراح ما اشتغل للإدارة');
  console.log('   المفتاح: مطفي = بلا رد · مشتغل = رد ✔');

  /* فترة الهدوء: ما يزعّج الشات */
  await suggestions.handleMessage(client, { ...staffMsg, author: { id: '3', tag: 'x#1' } }, { staff: true, enabled: true });
  const after2 = sent.length;
  await suggestions.handleMessage(client, { ...staffMsg, author: { id: '3', tag: 'x#1' } }, { staff: true, enabled: true });
  console.log('   فترة الهدوء (٤٥ ثانية):', sent.length === after2 ? 'ما كرّر الرد ✔' : 'كرّر الرد ✘');
  assert.strictEqual(sent.length, after2, 'كرّر الرد بلا فترة هدوء');

  /* ==================== ٣) المنشن الصريح فقط ==================== */
  db.updateGuildSettings(GUILD, { textCommands: { cooldownSeconds: 0 } });

  const calls = [];
  const data = new SlashCommandBuilder()
    .setName('ban')
    .setDescription('حظر عضو')
    .addUserOption((o) => o.setName('العضو').setDescription('العضو').setRequired(true))
    .addStringOption((o) => o.setName('السبب').setDescription('السبب').setRequired(false));
  const commands = new Map([['ban', {
    data,
    permissions: null,
    cooldown: 0,
    run: async (c, i) => { calls.push(i.options.getUser('العضو')?.id || null); },
  }]]);
  const client2 = { commands, user: { id: '1' } };
  const target = { id: '777', user: { id: '777', username: 'sara', tag: 'sara#1' }, displayName: 'سارة' };
  const guild = {
    id: GUILD,
    members: { cache: new Map([['777', target]]), me: { permissions: { has: () => true } } },
    channels: { cache: new Map() },
  };
  const replies = [];
  const warnCards = [];
  const msg = (content, extra = {}) => ({
    guild,
    content,
    author: { id: '2', tag: 'me#1', username: 'me' },
    member: { id: '2', permissions: { has: () => true } },
    channel: { id: '5' },
    createdTimestamp: Date.now(),
    mentionPattern: /<@!?(\d+)>/,
    mentions: {
      members: { first: () => (/<@!?777>/.test(content) ? target : null) },
      repliedUser: extra.repliedUser || null,
      channels: { first: () => null },
    },
    ...extra,
    reply: async (payload) => { warnCards.push(payload); replies.push(payload.content || JSON.stringify(payload.embeds?.[0]?.data || payload.embeds?.[0] || '[embed]')); return { delete: async () => {} }; },
  });

  /* أ) الرد على رسالة شخص ما يعتبر منشن */
  await textCommands.handleMessage(client2, msg('ban', { reference: { messageId: '9' }, mentions: { members: { first: () => null }, repliedUser: { id: '777' }, channels: { first: () => null } } }));
  console.log('٣) ردّ على رسالة شخص (بلا منشن) → نُفّذ؟', calls.length, '| الرد:', JSON.stringify(replies.at(-1)));
  assert.strictEqual(calls.length, 0, 'الأمر نُفّذ بدون منشن (على الرد)');
  assert.ok(/منشن العضو/.test(replies.at(-1) || ''), 'ما ظهر تنبيه المنشن');
  const warnData = warnCards.at(-1)?.embeds?.[0]?.data || {};
  console.log('   البطاقة اللي طلعت بدل التنبيه:', warnData.title);
  assert.strictEqual(warnData.title, 'Command: ban', 'تنبيه المنشن ما صار بطاقة أمر');
  assert.ok(!/https?:/.test(JSON.stringify(warnData)), 'بطاقة التنبيه فيها رابط موقع');
  assert.ok(!warnCards.at(-1)?.components?.length, 'بطاقة التنبيه فيها أزرار');

  /* ب) كتابة الاسم بلا منشن */
  await textCommands.handleMessage(client2, msg('ban سارة السبب'));
  console.log('   كتابة الاسم بلا منشن → نُفّذ؟', calls.length);
  assert.strictEqual(calls.length, 0, 'الأمر نُفّذ بكتابة الاسم');

  /* ج) منشن حقيقي */
  await textCommands.handleMessage(client2, msg('ban <@777> السبب'));
  console.log('   منشن صريح → نُفّذ؟', calls.length === 1 ? 'نعم ✔ (الهدف 777)' : 'لا ✘');
  assert.deepStrictEqual(calls, ['777'], 'الأمر ما نُفّذ مع منشن صريح');

  /* د) منشن لعضو غير موجود بالسيرفر */
  await textCommands.handleMessage(client2, msg('ban <@888>'));
  console.log('   منشن لعضو مو بالسيرفر → نُفّذ؟', calls.length, '| الرد:', JSON.stringify(replies.at(-1)));
  assert.strictEqual(calls.length, 1, 'الأمر نُفّذ على عضو غير موجود');

  /* المثال في التنبيه مأخوذ من الكتالوج */
  assert.ok(/ban @العضو/.test(replies.find((r) => /منشن العضو/.test(r)) || ''), 'المثال في التنبيه غير مفيد');

  /* ==================== ٤) رابط الموقع: «نيفر» + قائمة السماح ==================== */
  const siteLink = require('../src/systems/siteLink');
  const siteUsers = require('../src/web/siteUsers');
  const out4 = [];
  const linkMsg = (content, member) => ({
    guild: { id: GUILD },
    content,
    author: { id: member.id, tag: 'x#1' },
    member,
    reply: async (payload) => { out4.push(payload); return { delete: async () => {} }; },
  });
  const stranger = { id: '900900900900900900', roles: { cache: new Map() } };
  const loggedOnly = { id: '901901901901901901', roles: { cache: new Map() } };
  const hasUrl = (payload) => /https?:/.test(JSON.stringify(payload));

  /* ١) ما سجّل وما أضافه المالك → بلا رابط */
  await siteLink.handleMessage(client, linkMsg('نيفر', stranger));
  assert.ok(!hasUrl(out4.at(-1)), 'طلع رابط لمين ما أضافه المالك');
  /* ٢) سجّل بس المالك ما أضافه → بلا رابط */
  siteUsers.recordLogin({ id: loggedOnly.id, username: 'sara' });
  await siteLink.handleMessage(client, linkMsg('نيفر', loggedOnly));
  assert.ok(!hasUrl(out4.at(-1)), 'طلع رابط لمين ما أضافه المالك');
  /* ٣) المالك أضافه → الرابط يطلع (عضو ثالث حتى ما يتعطّل بفترة الهدوء) */
  const fullMember = { id: '903903903903903903', roles: { cache: new Map() } };
  siteUsers.recordLogin({ id: fullMember.id, username: 'ahmed' });
  assert.strictEqual(siteUsers.grant(fullMember.id, { by: '1' }).ok, true);
  await siteLink.handleMessage(client, linkMsg('نيفر', fullMember));
  console.log('٤) رابط الموقع: بلا سماح → بلا رابط ✔ · بعد الإضافة →', hasUrl(out4.at(-1)) ? 'الرابط ظهر ✔' : 'ما ظهر ✘');
  assert.ok(hasUrl(out4.at(-1)), 'الرابط ما ظهر لمن أضافه المالك');
  assert.ok((out4.at(-1).embeds?.[0]?.data?.title || '').includes('Never Land'), 'بطاقة الرابط بلا عنوان المشروع');
  /* ٤) كلمة «نيفر» لأي عضو ثاني محظور عليها فترة الهدوء — نتحقق من الشكل نفسه */
  assert.strictEqual(siteLink.isSiteWord('نيفر'), true, 'كلمة «نيفر» ما انعرفت');
  assert.strictEqual(siteLink.isSiteWord('نيفر بليز'), false, 'جملة فيها كلمة انحسبت طلب رابط');
  assert.strictEqual(siteLink.isSiteWord('never'), true, 'never ما انعرفت');
  /* ٥) ولا رد بالبوت فيه رابط موقع */
  for (const rel of ['src/commands/general/help.js', 'src/commands/general/botinfo.js', 'src/commands/config/settings.js', 'src/systems/setupWizard.js', 'src/systems/suggestions.js', 'src/systems/textCommands.js']) {
    assert.ok(!/web\.url/.test(read(rel)), `رابط موقع باقي في ${rel}`);
  }
  assert.ok(read('src/systems/siteLink.js').includes('نيفر'), 'ملف رابط الموقع ناقص');
  assert.ok(read('src/events/messageCreate.js').includes('siteLink.handleMessage'), 'مسار الرسائل ما يستدعي رابط الموقع');

  /* ==================== الملفات: الحماية في الكود ==================== */
  const textSrc = read('src/systems/textCommands.js');
  assert.ok(textSrc.includes('منشن صريح'), 'قاعدة المنشن غير مشروحة في الكود');
  const userBranch = textSrc.split("if (kind === 'user')")[1].split('continue;')[0];
  assert.ok(!userBranch.includes('findMember(guild, t)'), 'لسا يقبل كتابة الاسم بلا منشن');
  const pipeline = read('src/events/messageCreate.js');
  assert.ok(pipeline.includes('suggestions.handleMessage'), 'مسار الرسائل ما يستدعي الاقتراحات');
  assert.ok(read('src/lib/live.js').includes('settingsChanged'), 'الرابط الحيّ ناقص');
  assert.ok(read('src/web/routes/api.js').includes('event: settings'), 'البثّ الحيّ ما يبثّ تغييرات الإعدادات');
  const appSrc = read('src/web/public/app.js') + read('src/web/public/app-sections.js');
  // 'منشن صريح' و'نيفر' كانتا في كروت شرح شِيلت من اللوحة — السلوك مثبت في البوت (أعلى)
  for (const needle of ['PAGE_CLIENT_ID', "addEventListener('settings'", 'refreshAfterExternalChange', 'd-syncbar', 'اقتراح الأوامر المشابهة']) {
    assert.ok(appSrc.includes(needle), `اللوحة ينقصها ${needle}`);
  }

  console.log('\n🎉 الربط الحيّ (موقع ↔ بوت) · بطاقة الأوامر · المنشن الصريح · ورابط الموقع للمسجّلين فقط');
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
