'use strict';

/**
 * command-audience-test.js
 * -------------------------------------------------------------
 * أوامر الأعضاء وأوامر الإدارة (بلا ديسكورد حقيقي):
 *
 *   ١) الكتالوج: كل أمر له جمهور واضح — ١٠ أوامر أعضاء · ١٩ أمر إدارة · بلا أمر ضايع
 *   ٢) ديسكورد: أوامر الإدارة عليها default_member_permissions (يعني ديسكورد نفسه
 *      ما يعرضها للأعضاء) · وأوامر الأعضاء بلا أي قيد
 *   ٣) /help: العضو العادي يشوف أوامر الأعضاء فقط · الإدارة تشوف الكل · تفاصيل أمر
 *      إدارة ما تنفتح لعضو عادي
 *   ٤) الشات بلا بريفيكست: العضو ينفّذ أمر عضو عادي مباشرة · وأمر إدارة ينرفض
 *      بلا ما نكشف كيف يُستعمل، وينتسجّل في سجل النشاط
 *   ٥) اللوحة: قسم «اختصارات الأوامر» ومكتبة الأوامر يعرضان المجموعتين، وأوامر
 *      الإدارة تنحجب من المصدر (الـAPI) عن أي مشاهد بلا صلاحية تعديل
 *
 * التشغيل: node command-audience-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = __dirname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function run() {
  const db = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-aud-'));
    process.env.DATABASE_PATH = path.join(dir, 'aud.db');
    return require('./src/database');
  })();

  const catalog = require('./src/data/commandCatalog');
  const { Collection } = require('discord.js');

  /* ------------------------- ١) الكتالوج ------------------------- */
  const memberNames = catalog.namesOf('member');
  const staffNames = catalog.namesOf('staff');
  const allNames = Object.keys(catalog.COMMANDS);
  console.log('١) الكتالوج:', memberNames.length, 'أمر أعضاء ·', staffNames.length, 'أمر إدارة · المجموع', allNames.length);
  console.log('   أوامر الأعضاء:', memberNames.join(' · '));
  assert.strictEqual(allNames.length, 30, 'عدد الأوامر تغيّر');
  assert.strictEqual(memberNames.length, 10, 'عدد أوامر الأعضاء لازم يكون ١٠');
  assert.strictEqual(staffNames.length, 20, 'عدد أوامر الإدارة لازم يكون ٢٠');
  assert.strictEqual(memberNames.length + staffNames.length, allNames.length, 'في أمر بلا جمهور');
  for (const name of allNames) {
    const aud = catalog.audienceOf(name);
    assert.ok(['member', 'staff'].includes(aud), `الأمر ${name} بلا جمهور واضح`);
    /* أمر العضو ما له صلاحية مطلوبة · وأمر الإدارة له */
    const perm = catalog.COMMANDS[name].perm;
    if (aud === 'member') assert.ok(!perm, `أمر العضو ${name} عنده صلاحية مطلوبة!`);
    else assert.ok(perm, `أمر الإدارة ${name} بلا صلاحية محدّدة`);
  }
  assert.ok(catalog.AUDIENCES.member.label.includes('الأعضاء'), 'تسمية جمهور الأعضاء ناقصة');
  assert.ok(catalog.AUDIENCES.staff.label.includes('الإدارة'), 'تسمية جمهور الإدارة ناقصة');

  /* ------------------------- ٢) ديسكورد ------------------------- */
  const client = { commands: new Collection() };
  const { loadCommands } = require('./src/handlers/commands');
  const { loaded } = loadCommands(client);
  const staffCmds = [...client.commands.values()].filter((c) => c.audience === 'staff');
  const memberCmds = [...client.commands.values()].filter((c) => c.audience === 'member');
  console.log('٢) ديسكورد: حُمّل', loaded, 'أمر —', staffCmds.length, 'منها بصلاحيات (مخفية عن الأعضاء)');
  assert.strictEqual(loaded, 30, 'الأوامر ما تحمّلت كاملة');
  assert.strictEqual(staffCmds.length, 20, 'عدد أوامر الإدارة المحمّلة غير صحيح');
  assert.strictEqual(memberCmds.length, 10, 'عدد أوامر الأعضاء المحمّلة غير صحيح');
  for (const cmd of staffCmds) {
    const json = cmd.data.toJSON();
    assert.ok(json.default_member_permissions, `أمر الإدارة ${cmd.data.name} ما انخفى عن الأعضاء في ديسكورد`);
    assert.ok(cmd.hiddenFromMembers === true, `${cmd.data.name} ما تطبّق عليه الإخفاء`);
  }
  for (const cmd of memberCmds) {
    assert.ok(!cmd.data.toJSON().default_member_permissions, `أمر العضو ${cmd.data.name} صار محجوب — لازم يشتغل للجميع`);
  }
  console.log('   مثال:', staffCmds[0].data.name, '→ default_member_permissions =', staffCmds[0].data.toJSON().default_member_permissions);

  /* ------------------------- ٣) /help ------------------------- */
  const help = require('./src/commands/general/help');
  const staffMember = { id: '1', guild: { ownerId: '9' }, permissions: { has: (p) => p === 'ManageGuild' || p === 32n } };
  const plainMember = { id: '2', guild: { ownerId: '9' }, permissions: { has: () => false } };

  const memberView = help.visibleCommands(client, plainMember).map((c) => c.data.name).sort();
  const staffView = help.visibleCommands(client, staffMember).map((c) => c.data.name);
  console.log('٣) /help: العضو يشوف', memberView.length, 'أمر · الإدارة تشوف', staffView.length);
  assert.strictEqual(memberView.length, 10, 'العضو لازم يشوف أوامر الأعضاء فقط');
  assert.strictEqual(staffView.length, 30, 'الإدارة لازم تشوف كل الأوامر');
  for (const name of staffNames) assert.ok(!memberView.includes(name), `أمر الإدارة ${name} ظاهر للعضو!`);

  const replies = [];
  const fake = (member, specific = null) => ({
    member,
    guild: { id: '100000000000000001' },
    guildId: '100000000000000001',
    options: { getString: () => specific, getFocused: () => '' },
    reply: async (payload) => { replies.push(payload); return payload; },
  });
  await help.run(client, fake(plainMember, 'ban'), 'ar');
  const denied = replies.pop();
  assert.ok(!denied.embeds?.length, 'العضو شاف تفاصيل أمر إدارة');
  assert.ok(/ما لقيت/.test(denied.content || ''), 'ما ظهر رد الرفض للعضو');
  await help.run(client, fake(staffMember, 'ban'), 'ar');
  const allowed = replies.pop();
  assert.ok(allowed.embeds?.length, 'الإدارة ما قدرت تفتح تفاصيل أمر الإدارة');
  console.log('   العضو طلب /help ban → رفض ✔ · الإدارة → تفاصيل كاملة ✔');

  /* ------------------- ٤) الشات بلا بريفيكست ------------------- */
  const text = require('./src/systems/textCommands');
  const { SlashCommandBuilder } = require('discord.js');
  const GUILD = '100000000000000321';

  const calls = [];
  const build = (name, withPerm = false) => {
    const data = new SlashCommandBuilder().setName(name).setDescription(`أمر ${name}`);
    return {
      data,
      permissions: withPerm ? ['ManageGuild'] : null,
      cooldown: 0,
      run: async () => { calls.push(name); },
    };
  };
  const commands = new Map([
    ['ping', build('ping')],
    ['top', build('top')],
    ['ban', build('ban', true)],
  ]);
  const client2 = { commands, user: { id: '1' } };

  const guild = { id: GUILD, members: { cache: new Map(), me: { permissions: { has: () => true } } }, channels: { cache: new Map() } };
  const memberReplies = [];
  const staffReplies = [];
  const makeMessage = (content, author, sink) => ({
    guild,
    content,
    author: { id: author.id, tag: author.tag, username: author.username },
    member: author,
    channel: { id: '555' },
    createdTimestamp: Date.now(),
    mentions: { members: { first: () => null }, channels: { first: () => null } },
    reply: async (payload) => { sink.push(payload); return { delete: async () => {} }; },
  });
  const plain = { id: '222', tag: 'زائر#1', username: 'guest', permissions: { has: () => false } };
  const admin = { id: '111', tag: 'أحمد#1', username: 'ahmed', permissions: { has: () => true } };

  /* بلا حدّ استخدام في هذا الاختبار حتى نقيس الصلاحيات لا التوقيت */
  db.updateGuildSettings(GUILD, { textCommands: { cooldownSeconds: 0 } });

  /* العضو العادي: ping يشتغل · ban ينرفض */
  await text.handleMessage(client2, makeMessage('ping', plain, memberReplies));
  await text.handleMessage(client2, makeMessage('top', plain, memberReplies));
  await text.handleMessage(client2, makeMessage('ban', plain, memberReplies));

  console.log('٤) الشات: العضو شغّل', calls.join(' · ') || 'ولا أمر', '| ردود:', memberReplies.length);
  assert.deepStrictEqual(calls, ['ping', 'top'], 'أوامر الأعضاء ما اشتغلت للعضو العادي');
  assert.strictEqual(memberReplies.length, 1, 'المفروض رد واحد فقط: رفض أمر الإدارة');
  assert.ok(/للإدارة فقط/.test(memberReplies[0].content || ''), 'رد الرفض غير واضح');
  for (const word of ['السبب', 'العضو', 'صلاحية']) {
    assert.ok(!(memberReplies[0].content || '').includes(word), 'رد الرفض كشف تفاصيل أمر الإدارة');
  }

  /* الإدارة: ban يشتغل */
  const before = calls.length;
  await text.handleMessage(client2, makeMessage('ban', admin, staffReplies));
  console.log('   الإدارة كتبت ban →', calls.length > before ? 'نُفّذ ✔' : 'ما نُفّذ ✘');
  assert.ok(calls.includes('ban'), 'أمر الإدارة ما اشتغل للإدارة');

  /* السجل: محاولة العضو مسجّلة */
  const audit = require('./src/lib/audit');
  const deniedRows = db.listAudit({ guildId: GUILD, limit: 50 }).items.filter((r) => r.action === 'command.denied');
  console.log('   سجل النشاط: محاولات مرفوضة =', deniedRows.length, '| الوصف:', audit.ACTION_LABELS['command.denied']);
  assert.ok(deniedRows.length >= 1, 'محاولة العضو ما انتسجلت في سجل النشاط');

  /* ------------------------- ٥) اللوحة ------------------------- */
  const snapAdmin = text.adminSnapshot(GUILD, ['ping', 'ban'], { staffViewer: true });
  const snapMember = text.adminSnapshot(GUILD, ['ping', 'ban'], { staffViewer: false });
  console.log('٥) اللوحة: للإدارة', snapAdmin.items.length, 'أمر · لغير الإداري', snapMember.items.length, 'أمر (محجوب', snapMember.counts.hiddenFromViewer, ')');
  assert.strictEqual(snapAdmin.items.length, 30, 'لوحة الإدارة لازم تعرض كل الأوامر');
  assert.strictEqual(snapMember.items.length, 10, 'لوحة العضو لازم تعرض أوامر الأعضاء فقط');
  assert.strictEqual(snapAdmin.counts.member, 10, 'عدّاد أوامر الأعضاء غير صحيح');
  assert.strictEqual(snapAdmin.counts.staff, 20, 'عدّاد أوامر الإدارة غير صحيح');
  assert.ok(snapMember.items.every((i) => i.audience === 'member'), 'أمر إدارة تسرّب لغير الإداري');
  assert.ok(snapAdmin.items.every((i) => i.audienceBadge), 'وسم الجمهور ناقص في اللوحة');

  const appSrc = read('src/web/public/app.js');
  for (const needle of ['أوامر الأعضاء', 'أوامر الإدارة', 'audiences', 'audienceBadge', 'cmd-note']) {
    assert.ok(appSrc.includes(needle), `واجهة اللوحة ينقصها ${needle}`);
  }
  const apiSrc = read('src/web/routes/api.js');
  assert.ok(apiSrc.includes('staffViewer: canEdit(req)'), 'مسار الاختصارات ما يحجب أوامر الإدارة عن غير الإداري');
  assert.ok(apiSrc.includes('hiddenFromViewer'), 'مكتبة الأوامر ما ترجّع عدد المحجوب');
  assert.ok(!/audienceBadge\s*:\s*'[^']*[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(appSrc), 'وسم الجمهور فيه إيموجي');
  const cssSrc = read('src/web/public/dash.css');
  elseCheck: {
    for (const needle of ['.cmd-tag.ok', '.cmd-tag.lock', '.cmd-note']) {
      assert.ok(cssSrc.includes(needle), `الأنماط ينقصها ${needle}`);
    }
  }

  /*
   * المسار الحقيقي: زائر بلا تسجيل دخول لازم يشوف أوامر الأعضاء فقط.
   * نطفي وضع العرض لأنّه يمنح صلاحية تعديل تلقائيًا (وهو وضع تجربة محلي فقط).
   *
   * ونثبّت وضع الوصول أيضًا: بعض اختبارات اللوحة (dashboard-dom-test وغيرها)
   * تعدّل process.env.PUBLIC_ACCESS/LOGIN_REQUIRED في نفس العملية، و tests/smoke.js
   * يشغّل هذا الملف بعملية ابنة ترث تلك البيئة. بلا تثبيت، الوصول العام للقراءة
   * (PUBLIC_ACCESS=true + LOGIN_REQUIRED=false) يخلّي GET /api/commands يرجّع 200
   * فيفشل التأكيد هنا رغم أنّ أوامر الإدارة تظل محجوبة فعلًا.
   */
  const config = require('./src/config');
  const demoWas = config.web.demoMode;
  const publicWas = config.web.publicAccess;
  const loginWas = config.web.loginRequired;
  config.web.demoMode = false;
  config.web.publicAccess = false;
  config.web.loginRequired = true;

  const http = require('node:http');
  const web = require('./src/web/server');
  const server = await new Promise((resolve) => {
    const srv = http.createServer(web.createApp()).listen(0, '127.0.0.1', () => resolve(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    /* زائر بلا تسجيل دخول: ما يشوف ولا أمر إدارة — ولا حتى قائمة الأوامر نفسها */
    const libRes = await fetch(`${base}/api/commands`);
    console.log('   /api/commands كزائر →', libRes.status, '(محجوب)');
    assert.ok(libRes.status === 401 || libRes.status === 403, 'مكتبة الأوامر مفتوحة لزائر');

    const panelRes = await fetch(`${base}/api/guilds/${GUILD}/commands`);
    console.log('   /api/guilds/…/commands كزائر →', panelRes.status, '(محجوب)');
    assert.ok([401, 403].includes(panelRes.status), 'لوحة اختصارات سيرفر مفتوحة لزائر');

    /* ومشاهد مسجّل بلا صلاحية تعديل: أوامر الأعضاء فقط (نفس منطق المسار) */
    const forMember = text.adminSnapshot(GUILD, [], { staffViewer: false });
    console.log('   مشاهد بلا صلاحية تعديل →', forMember.items.length, 'أمر أعضاء · محجوب عنه', forMember.counts.hiddenFromViewer);
    assert.strictEqual(forMember.items.length, 10, 'مشاهد بلا صلاحية شاف أوامر إدارة');
    assert.strictEqual(forMember.counts.hiddenFromViewer, 20, 'عدد المحجوب لمشاهد بلا صلاحية غير صحيح');
  } finally {
    config.web.demoMode = demoWas;
    config.web.publicAccess = publicWas;
    config.web.loginRequired = loginWas;
    server.close();
  }

  console.log('\n🎉 أوامر الأعضاء شغّالة للجميع · أوامر الإدارة مخفية عن الأعضاء في ديسكورد وفي الموقع');
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
