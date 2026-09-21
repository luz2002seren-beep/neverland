'use strict';

/**
 * role-command-test.js
 * -------------------------------------------------------------
 * فحص أمر إعطاء/سحب الرتب (`role` · «رول»):
 *
 *   ١) الأمر نفسه: الاسم · الصلاحيات · الخيارات (منشن + آيدي للعضو والرتبة + إزالة + سبب)
 *   ٢) الكتالوج واختصارات الشات (رول · رتبة · رتب) + الرد الافتراضي نص
 *   ٣) التنفيذ الحقيقي (ديسكورد وهمي): منشن · آيدي · أكثر من رتبة · سحب
 *      + كل حالات المنع: @everyone · رتبة بوت · رتبة أعلى من البوت · أعلى من الإداري
 *      + عضو مو بالسيرفر · رتبة مو موجودة · خطأ ديسكورد ما ينبلع
 *   ٤) الشات بلا بريفيكست: «رول @عضو @رتبة» و«رول آيدي آيدي» يشتغلوا بنفس الكود
 *   ٥) الربط: التحميل التلقائي · تسجيل اللوق · قيم المتغيّرات لصفحة «ردود اوامر»
 *
 * التشغيل: node role-command-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nl-role-')), 'role.db');
process.env.DEMO_MODE = 'true';

let checks = 0;
const ok = (msg) => {
  checks += 1;
  console.log(`  ✔ ${msg}`);
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ------------------------- ديسكورد وهمي ------------------------- */

const GUILD = '1542345715949506630';
const BOT_ID = '900000000000000001';
const MOD_ID = '900000000000000002';
const OWNER_ID = '900000000000000003';
const PLAIN_MOD_ID = '900000000000000004';
const MEMBER_ID = '900000000000000010';
const MEMBER_ID_2 = '900000000000000011';

function perms(list = []) {
  return { has: (flag) => (Array.isArray(flag) ? flag.some((f) => list.includes(f)) : list.includes(flag)) };
}

function makeRole(id, name, position, extra = {}) {
  return { id, name, position, managed: false, toString: () => `<@&${id}>`, ...extra };
}

function makeMember({ id, name, position = 1, permissions = [], roles = [], user = null }) {
  const cache = new Map(roles.map((r) => [r.id, r]));
  return {
    id,
    user: user || { id, username: name, tag: `${name}#0001`, toString: () => `<@${id}>`, displayAvatarURL: () => `https://cdn/${id}.png`, bot: false },
    displayName: name,
    toString: () => `<@${id}>`,
    permissions: perms(permissions),
    roles: {
      cache,
      highest: { position },
      add: async (role, reason) => {
        cache.set(role.id, role);
        global.__calls.add.push({ member: id, role: role.id, reason });
      },
      remove: async (role, reason) => {
        cache.delete(role.id);
        global.__calls.remove.push({ member: id, role: role.id, reason });
      },
    },
  };
}

/** عالم وهمي كامل + التفاعل */
function makeWorld({ botPosition = 50, botPermissions = [PermissionFlagsBits.ManageRoles], addError = null, guildOwnerId = OWNER_ID } = {}) {
  global.__calls = { add: [], remove: [], logs: [], replies: [] };

  const everyone = makeRole(GUILD, '@everyone', 0);
  const support = makeRole('900000000000000100', 'دعم', 5);
  const vip = makeRole('900000000000000101', 'VIP', 6);
  const staffRole = makeRole('900000000000000102', 'إدارة', 40);
  const adminRole = makeRole('900000000000000103', 'أدمن', 80);
  const botRole = makeRole('900000000000000104', 'رتبة بوت', 3, { managed: true });

  const allRoles = [everyone, support, vip, staffRole, adminRole, botRole];
  const rolesCache = new Map(allRoles.map((r) => [r.id, r]));

  const botMember = makeMember({ id: BOT_ID, name: 'never-land', position: botPosition, permissions: botPermissions, roles: [makeRole('900000000000000099', 'بوت', botPosition)] });
  botMember.roles.highest = { position: botPosition };
  botMember.permissions = perms(botPermissions);

  const executor = makeMember({ id: MOD_ID, name: 'المشرف', position: 60, permissions: [PermissionFlagsBits.ManageRoles], roles: [makeRole('900000000000000105', 'مشرف', 60)] });
  const plainMod = makeMember({ id: PLAIN_MOD_ID, name: 'مشرف صغير', position: 10, permissions: [PermissionFlagsBits.ManageRoles], roles: [makeRole('900000000000000106', 'مشرف صغير', 10)] });
  const owner = makeMember({ id: OWNER_ID, name: 'المالك', position: 100, permissions: [PermissionFlagsBits.Administrator], roles: [adminRole] });
  const target = makeMember({ id: MEMBER_ID, name: 'عضو', position: 1, permissions: [], roles: [] });
  const target2 = makeMember({ id: MEMBER_ID_2, name: 'عضو٢', position: 1, permissions: [], roles: [] });

  const membersCache = new Map([
    [BOT_ID, botMember],
    [MOD_ID, executor],
    [OWNER_ID, owner],
    [target.id, target],
    [target2.id, target2],
  ]);

  const guild = {
    id: GUILD,
    name: 'Never Land',
    ownerId: guildOwnerId,
    roles: {
      cache: rolesCache,
      fetch: async (id) => rolesCache.get(id) || Promise.reject(new Error('Unknown Role')),
    },
    members: {
      cache: membersCache,
      me: botMember,
      fetchMe: async () => botMember,
      fetch: async (id) => membersCache.get(id) || Promise.reject(new Error('Unknown Member')),
    },
  };

  const mkInteraction = ({ actor = executor, userOption = null, roleOption = null, userIds = null, roleIds = null, remove = false, reason = null } = {}) => ({
    guild,
    guildId: GUILD,
    user: actor.user,
    member: actor,
    deferReply: async () => {},
    editReply: async (payload) => {
      global.__calls.replies.push(payload);
      return payload;
    },
    options: {
      getUser: (n) => (n === 'العضو' ? userOption : null),
      getRole: (n) => (n === 'الرتبة' ? roleOption : null),
      getString: (n) => {
        if (n === 'آيدي') return userIds;
        if (n === 'آيدي-الرتبة') return roleIds;
        if (n === 'السبب') return reason;
        return null;
      },
      getBoolean: (n) => (n === 'إزالة' ? remove : null),
      getSubcommand: () => null,
    },
  });

  const run = async (args) => {
    const command = require('../src/commands/moderation/role.js');
    const interaction = mkInteraction(args);
    await command.run({ guilds: { cache: new Map() } }, interaction, 'ar');
    const reply = global.__calls.replies.at(-1);
    const embed = reply?.embeds?.[0]?.data || reply?.embeds?.[0] || {};
    return { interaction, reply, embed, text: `${embed.title || ''}\n${embed.description || ''}` };
  };

  return { guild, roles: { everyone, support, vip, staffRole, adminRole, botRole }, members: { botMember, executor, plainMod, owner, target, target2 }, run, mkInteraction };
}

(async () => {
  const db = require('../src/database');
  const catalog = require('../src/data/commandCatalog');
  const logging = require('../src/systems/logging');
  const command = require('../src/commands/moderation/role.js');
  const text = require('../src/systems/textCommands');

  /* تسجيل اللوقات بدون ديسكورد حقيقي */
  const realLog = logging.logModAction;
  logging.logModAction = async (client, guild, entry) => {
    global.__calls.logs.push(entry);
    return true;
  };

  console.log('\n═══ ١) الأمر نفسه: الاسم · الصلاحيات · الخيارات ═══');
  {
    assert.strictEqual(command.data.name, 'role', 'اسم الأمر لازم role');
    assert.ok(command.permissions.includes(PermissionFlagsBits.ManageRoles), 'الأمر لازم يطلب صلاحية إدارة الرتب');
    assert.ok(command.botPermissions.includes(PermissionFlagsBits.ManageRoles), 'البوت لازم يكون عنده إدارة الرتب');
    assert.strictEqual(typeof command.run, 'function', 'الأمر بلا دالة run');

    const json = command.data.toJSON();
    const names = json.options.map((o) => o.name);
    assert.deepStrictEqual(names, ['العضو', 'الرتبة', 'آيدي', 'آيدي-الرتبة', 'إزالة', 'السبب'], 'خيارات الأمر تغيّرت');
    const type = (n) => json.options.find((o) => o.name === n).type;
    assert.strictEqual(type('العضو'), 6, 'خيار العضو لازم يكون «عضو» (منشن)');
    assert.strictEqual(type('الرتبة'), 8, 'خيار الرتبة لازم يكون «رتبة» (منشن/قائمة)');
    assert.strictEqual(type('آيدي'), 3, 'خيار آيدي العضو لازم نص');
    assert.strictEqual(type('آيدي-الرتبة'), 3, 'خيار آيدي الرتبة لازم نص');
    assert.strictEqual(type('إزالة'), 5, 'خيار الإزالة لازم «نعم/لا»');
    assert.ok(json.options.every((o) => !o.required), 'كل الخيارات اختيارية (منشن أو آيدي)');
    assert.ok(/آيدي/.test(json.description), 'الوصف لازم يوضّح أنه يشتغل بالآيدي');
    ok('`/role` جاهز: عضو بالمنشن · رتبة بالمنشن · آيديهات للاثنين · «إزالة» للسحب · السبب للوق');
  }

  console.log('\n═══ ٢) الكتالوج واختصارات الشات ═══');
  {
    const meta = catalog.COMMANDS.role;
    assert.ok(meta, 'أمر role مو موجود في الكتالوج (ما يظهر بلوحة الموقع)');
    assert.strictEqual(catalog.audienceOf('role'), 'staff', 'أمر role لازم يكون أمر إدارة');
    assert.strictEqual(meta.category, 'moderation', 'تصنيف الأمر لازم moderation');
    assert.ok(meta.perm, 'أمر الإدارة لازم صلاحية مطلوبة');
    assert.strictEqual(meta.text, true, 'الأمر لازم يشتغل في الشات بلا بريفيكست');
    assert.ok(meta.examples.some((e) => /^\d{15,}/.test(String(e).split(' ')[1] || '')), 'لازم مثال بالآيدي');
    assert.ok(meta.usage.some((u) => u.includes('إزالة')), 'لازم يوضّح طريقة السحب');

    for (const word of ['رول', 'رتبة', 'رتب']) {
      assert.strictEqual(text.resolveCommand(GUILD, word), 'role', `اختصار «${word}» ما انعرف`);
    }
    const replyFormat = require('../src/lib/replyFormat');
    assert.strictEqual(replyFormat.defaultMode('role'), 'text', 'الرد الافتراضي لازم رسالة نصية (زي باقي العقوبات)');
    ok('الكتالوج فيه الأمر + الجمهور إدارة + اختصارات «رول · رتبة · رتب» + الرد نص افتراضيًا');
  }

  console.log('\n═══ ٣) التنفيذ الحقيقي (ديسكورد وهمي) ═══');
  {
    /* أ) منشن عضو + منشن رتبة */
    let w = makeWorld();
    let out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.vip, reason: 'عضو مميز' });
    assert.strictEqual(global.__calls.add.length, 1, 'الرتبة ما انعطت بالمنشن');
    assert.strictEqual(global.__calls.add[0].role, w.roles.vip.id, 'انعطت رتبة غلط');
    assert.ok(global.__calls.add[0].reason.includes('عضو مميز'), 'السبب ما انتقل لسجل ديسكورد');
    assert.ok(/انعطت/.test(out.text), 'الرد ما يقول إن الرتبة انعطت');
    assert.ok(out.interaction.__replyVars.user.includes(MEMBER_ID), 'قيم المتغيّرات ({user}) ناقصة');
    assert.strictEqual(out.interaction.__replyVars.count, '1', 'عدد الرتب بالرد خطأ');
    assert.strictEqual(global.__calls.logs.length, 1, 'ما انسجّلت العملية في اللوقات');
    assert.ok(/إعطاء رتبة/.test(global.__calls.logs[0].action), 'نوع اللوق خطأ');
    ok('منشن العضو + منشن الرتبة: الرتبة انعطت فعلًا + رد واضح + تسجيل لوق');

    /* ب) عضو بالآيدي + رتبة بالآيدي */
    w = makeWorld();
    out = await w.run({ userIds: MEMBER_ID, roleIds: w.roles.vip.id });
    assert.strictEqual(global.__calls.add.length, 1, 'الآيدي للعضو/الرتبة ما اشتغل');
    assert.strictEqual(global.__calls.add[0].member, MEMBER_ID);
    assert.strictEqual(global.__calls.add[0].role, w.roles.vip.id);
    ok('عضو بالآيدي + رتبة بالآيدي (بدون أي منشن) — شغّال');

    /* ج) أكثر من رتبة بآيديهات مفصولة بفاصلة */
    w = makeWorld();
    out = await w.run({ userIds: MEMBER_ID, roleIds: `${w.roles.support.id}, ${w.roles.vip.id}` });
    assert.strictEqual(global.__calls.add.length, 2, 'أكثر من رتبة ما اشتغل');
    assert.deepStrictEqual(global.__calls.add.map((c) => c.role), [w.roles.support.id, w.roles.vip.id], 'الرتب المتعددة غلط');
    assert.strictEqual(out.interaction.__replyVars.count, '2');
    ok('أكثر من رتبة بنفس الأمر (آيديهات مفصولة بفاصلة) — شغّال');

    /* د) السحب */
    w = makeWorld();
    w.members.target.roles.cache.set(w.roles.support.id, w.roles.support);
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.support, remove: true, reason: 'انتهت المدة' });
    assert.strictEqual(global.__calls.remove.length, 1, 'سحب الرتبة ما اشتغل');
    assert.strictEqual(global.__calls.add.length, 0, 'سحب رتبة لازم ما يعطي');
    assert.ok(global.__calls.logs.length === 1 && /سحب رتبة/.test(global.__calls.logs[0].action), 'لوق السحب ناقص');
    ok('«إزالة» تسحب الرتبة + تسجّل «سحب رتبة» في اللوقات');

    /* هـ) عنده الرتبة أصلًا */
    w = makeWorld();
    w.members.target.roles.cache.set(w.roles.support.id, w.roles.support);
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.support });
    assert.strictEqual(global.__calls.add.length, 0, 'ما لازم ينعطى رتبة عنده إياها');
    assert.ok(/عنده هي الرتبة أصلًا/.test(out.text), 'الرد ما يوضّح إنه عنده الرتبة');
    ok('إذا العضو عنده الرتبة → ما ينبعت طلب لديسكورد والرد يوضّح السبب');

    /* و) البوت بلا صلاحية إدارة الرتب */
    w = makeWorld({ botPermissions: [] });
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.vip });
    assert.strictEqual(global.__calls.add.length, 0, 'ما لازم ينفّذ والبوت بلا صلاحية');
    assert.ok(/إدارة الرتب/.test(out.text), 'الرد ما يشرح نقص صلاحية البوت');
    ok('البوت بلا «إدارة الرتب» → منع + شرح السبب (بدل فشل صامت)');

    /* ز) الرتبة أعلى من رتبة البوت */
    w = makeWorld({ botPosition: 30 });
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.adminRole });
    assert.strictEqual(global.__calls.add.length, 0, 'ما لازم يعطي رتبة أعلى من البوت');
    assert.ok(/أقل من هذه الرتبة|رتبة البوت/.test(out.text), 'الرد ما يشرح ترتيب رتبة البوت');
    ok('الرتبة أعلى من رتبة البوت → منع + شرح «ارفع رتبة البوت»');

    /* ح) الرتبة أعلى من الإداري (غير أدمن/أونر) — رتبة البوت أعلى منها حتى يبان منع ترتيب الإداري */
    w = makeWorld({ botPosition: 95 });
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.adminRole, actor: w.members.executor });
    assert.strictEqual(global.__calls.add.length, 0, 'مشرف ما لازم يعطي رتبة أعلى منه');
    assert.ok(/أعلى من رتبتك/.test(out.text), 'الرد ما يشرح ترتيب رتبة الإداري');
    ok('الرتبة أعلى من رتبة الإداري → منع + شرح واضح');

    /* ط) الأونر يعطي رتبة أعلى منه (رتبة البوت فوقها) */
    w = makeWorld({ botPosition: 95 });
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.adminRole, actor: w.members.owner });
    assert.strictEqual(global.__calls.add.length, 1, 'الأونر لازم يقدر يعطي الرتبة');
    ok('صاحب السيرفر (الأونر) يقدر يعطي أي رتبة تحت رتبة البوت');

    /* ي) المشرف الصغير يحاول على عضو أعلى منه */
    w = makeWorld();
    out = await w.run({ userOption: { id: MOD_ID }, roleOption: w.roles.support, actor: w.members.plainMod });
    assert.strictEqual(global.__calls.add.length, 0, 'مشرف أدنى ما لازم يعدّل رتبة عضو أعلى منه');
    assert.ok(/رتبته أعلى منك/.test(out.text), 'الرد ما يشرح ترتيب العضو المستهدف');
    ok('العضو المستهدف أعلى من الإداري → منع + شرح');

    /* ك) رتبة @everyone + رتبة بوت */
    w = makeWorld();
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.everyone });
    assert.ok(/everyone/.test(out.text), 'رتبة @everyone لازم تُمنع برسالة واضحة');
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.botRole });
    assert.ok(/Integration|بوت/.test(out.text), 'رتبة البوت/التكامل لازم تُمنع برسالة واضحة');
    assert.strictEqual(global.__calls.add.length, 0);
    ok('رتبة @everyone ورتبة التكامل (managed) → منع برسالة واضحة');

    /* ل) عضو مو بالسيرفر */
    w = makeWorld();
    out = await w.run({ userIds: '900000000000009999', roleIds: w.roles.vip.id });
    assert.strictEqual(global.__calls.add.length, 0);
    assert.ok(/مو موجود بالسيرفر/.test(out.text), 'الرد ما يوضّح إن العضو مو بالسيرفر');
    ok('عضو مو بالسيرفر → رسالة واضحة بلا أي تنفيذ');

    /* م) رتبة بآيدي مو موجود */
    w = makeWorld();
    out = await w.run({ userOption: { id: MEMBER_ID }, roleIds: '900000000000008888' });
    assert.strictEqual(global.__calls.add.length, 0);
    assert.ok(/ما قدرت ألاقي الرتبة/.test(out.text), 'الرد ما يوضّح إن الرتبة مو موجودة');
    assert.ok(out.text.includes('900000000000008888'), 'لازم يذكر الآيدي الغلط');
    ok('رتبة بآيدي غير موجود → رسالة واضحة تذكر الآيدي');

    /* ن) خطأ ديسكورد من roles.add ما ينبلع */
    w = makeWorld();
    w.members.target.roles.add = async () => {
      const err = new Error('Missing Permissions');
      err.code = 50013;
      throw err;
    };
    out = await w.run({ userOption: { id: MEMBER_ID }, roleOption: w.roles.vip });
    assert.ok(/ما زبط/.test(out.text), 'الرد لازم يبيّن إنه ما زبط');
    assert.ok(/صلاحية كافية/.test(out.text), 'لازم يترجم خطأ ديسكورد لشرح مفهوم');
    assert.strictEqual(global.__calls.logs.length, 0, 'ما لازم يسجّل نجاح لعملية فشلت');
    ok('فشل ديسكورد يظهر بالرد بسببه الحقيقي (ما في نجاح كذّاب)');

    /* س) بلا أي مدخل */
    w = makeWorld();
    out = await w.run({});
    assert.ok(/حدّد العضو/.test(out.text), 'لازم يوضّح طريقة الاستعمال لما ما في مدخلات');
    assert.ok(/رول/.test(out.text), 'لازم يعطي مثال جاهز');
    ok('بلا مدخلات → شرح الاستعمال مع مثال جاهز');
  }

  console.log('\n═══ ٤) نفس الأمر في الشات بلا بريفيكست ═══');
  {
    /* نركّب عميل وهمي فيه الأمر الحقيقي ونمرّر رسالة شات */
    const w = makeWorld();
    const client = { commands: new Map([['role', require('../src/commands/moderation/role.js')]]), user: { id: BOT_ID } };
    text.setOptions(GUILD, { enabled: true, cooldownSeconds: 0 });

    const channel = { id: '900000000000000200', name: 'اوامر', permissionsFor: () => ({ has: () => true }) };
    const replies = [];
    const mkMessage = (content) => ({
      guild: w.guild,
      content,
      author: { id: MOD_ID, tag: 'المشرف#0001', username: 'المشرف', bot: false },
      member: w.members.executor,
      channel,
      createdAt: new Date(),
      createdTimestamp: Date.now(),
      mentions: {
        members: { first: () => (content.includes(`<@${MEMBER_ID}>`) ? w.members.target : null) },
        channels: { first: () => null },
      },
      delete: async () => {},
      reply: async (payload) => {
        replies.push(payload);
        return { delete: async () => {} };
      },
    });

    /* أ) «رول @عضو @رتبة» */
    global.__calls.add.length = 0;
    const handled = await text.handleMessage(client, mkMessage(`رول <@${MEMBER_ID}> <@&${w.roles.vip.id}>`));
    assert.strictEqual(handled, true, 'رسالة «رول» ما تعاملنا معها');
    assert.strictEqual(global.__calls.add.length, 1, 'الرتبة ما انعطت من الشات (منشن)');
    assert.strictEqual(global.__calls.add[0].role, w.roles.vip.id, 'رتبة غلط من الشات');

    /* ب) «رول آيدي آيدي» */
    global.__calls.add.length = 0;
    await text.handleMessage(client, mkMessage(`رول ${MEMBER_ID} ${w.roles.support.id}`));
    assert.strictEqual(global.__calls.add.length, 1, 'الأمر بالآيديهات ما اشتغل من الشات');
    assert.strictEqual(global.__calls.add[0].member, MEMBER_ID, 'العضو بالآيدي ما انحل صح');
    assert.strictEqual(global.__calls.add[0].role, w.roles.support.id, 'الرتبة بالآيدي ما انحلت صح');

    /* ج) «رتبة @عضو @رتبة إزالة نعم» */
    w.members.target.roles.cache.set(w.roles.support.id, w.roles.support);
    global.__calls.remove.length = 0;
    await text.handleMessage(client, mkMessage(`رتبة <@${MEMBER_ID}> <@&${w.roles.support.id}> نعم`));
    assert.strictEqual(global.__calls.remove.length, 1, 'السحب من الشات ما اشتغل');
    ok('«رول @عضو @رتبة» · «رول آيدي آيدي» · «رتبة … نعم» — كلها تنفّذ نفس كود الأمر');
  }

  console.log('\n═══ ٥) الربط: التحميل التلقائي · الموقع · اللوقات ═══');
  {
    const loader = read('src/handlers/commands.js');
    assert.ok(loader.includes('walk(commandsPath)'), 'محلّل الأوامر لازم يقرأ المجلدات تلقائيًا (بلا تسجيل يدوي)');
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'commands', 'moderation', 'role.js')), 'ملف الأمر مو بمجلد moderation');

    const events = read('src/events/messageCreate.js');
    assert.ok(/textCommands|handleMessage/.test(events), 'الشات لازم يمرّ على نظام الأوامر بلا بريفيكست');

    const app = read('src/web/public/app.js');
    const apiSrc = read('src/web/routes/api.js');
    assert.ok(apiSrc.includes('catalog.COMMANDS'), 'الموقع لازم يقرأ الكتالوج (فيظهر الأمر بصفحة الأوامر وردود اوامر)');
    assert.ok(app.includes('commandReplies'), 'صفحة «ردود اوامر» ناقصة');
    ok('الأمر يُحمَّل تلقائيًا · يظهر في الموقع (أوامر + ردود اوامر) · ويسجّل في اللوقات');

    logging.logModAction = realLog;
    /* تنظيف قاعدة الاختبار */
    db.close?.();
  }

  console.log(`\n🎉 أمر الرتب جاهز وشغّال (${checks} فحصًا)\n`);
})().catch((err) => {
  console.error('\n❌ فشل الاختبار:', err.message);
  process.exitCode = 1;
});
