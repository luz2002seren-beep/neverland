'use strict';

/**
 * text-commands-test.js
 * -------------------------------------------------------------
 * اختبار الأوامر بدون بريفيكست (بلا ديسكورد حقيقي):
 *
 *   ١) أمر إنجليزي مباشر: ban @عضو سبب 7d ← نفس /ban
 *   ٢) الأوامر الفرعية: purge contains نص 100 · timeout add عضو 10m سبب
 *   ٣) الكلمات العربية ما تتحوّل أوامر · والبوتات ما تُنفّذ أوامر
 *   ٤) الاختصارات من الموقع: إضافة · حذف · منع التعارض · رفض غير الإنجليزي
 *   ٥) الإيقاف من الموقع يوقف كل الأوامر النصية
 *   ٦) الصلاحيات: عضو بلا صلاحية ما ينفّذ أمر إداري
 *   ٧) الكولداون مشيل: نفس الأمر يتنفّذ أكثر من مرة ورا بعض بلا انتظار
 *   ٨) كتالوج الشرح: كل أمر حقيقي موجود بالكتالوج وبالعكس (بلا نقص)
 *   ٩) الاختصارات المقترحة بلا تعارض مع أي شي
 *  ١٠) التصويت بخيارات مفصولة بـ | يعمل صح
 *
 * التشغيل: node text-commands-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const seedDb = (dir) => {
  process.env.DATABASE_PATH = path.join(dir, 'tc.db');
  return require('../src/database');
};

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-tc-'));
  const db = seedDb(tmp);
  const text = require('../src/systems/textCommands');
  const catalog = require('../src/data/commandCatalog');
  const { SlashCommandBuilder } = require('discord.js');

  const GUILD = '100000000000000777';

  /* ----------------------- ديسكورد وهمي ----------------------- */
  const calls = [];
  const member = { id: '111111111111111111', user: { id: '111111111111111111', username: 'ahmed', tag: 'ahmed#1' }, displayName: 'أحمد', permissions: { has: () => true } };
  const plainMember = { id: '222222222222222222', user: { id: '222222222222222222', username: 'guest', tag: 'guest#1' }, displayName: 'زائر', permissions: { has: () => false } };
  const channel = { id: '333333333333333333', name: 'عام' };
  const role = { id: '444444444444444444', name: 'دعم' };

  const guild = {
    id: GUILD,
    members: { cache: new Map([[member.id, member], [plainMember.id, plainMember]]), me: { permissions: { has: () => true } } },
    roles: { cache: new Map([[role.id, role]]) },
    channels: { cache: new Map([[channel.id, channel]]) },
  };

  const replies = [];
  const makeMessage = (content, author = plainMember) => ({
    guild,
    content,
    author: { id: author.id, tag: author.user.tag, username: author.user.username },
    member: author,
    channel,
    createdAt: new Date(),
    createdTimestamp: Date.now(),
    mentions: {
      members: { first: () => (content.includes(`<@${member.id}>`) ? member : null) },
      channels: { first: () => (content.includes(`<#${channel.id}>`) ? channel : null) },
    },
    reply: async (payload) => { replies.push(payload); return { delete: async () => {} }; },
  });

  /** أداة اختبار بخيارات: قناة مخصّصة · رتب · تتبّع حذف رسالة الأمر */
  const doItWith = async (content, opts = {}) => {
    const author = { ...plainMember, roles: { cache: new Map((opts.roles || []).map((r) => [r, {}])) } };
    const msg = makeMessage(content, author);
    msg.delete = async () => { msg._deleted = true; };
    if (opts.channelId) msg.channel = { ...channel, id: opts.channelId };
    const handled = await text.handleMessage(client, msg);
    return { handled, deleted: Boolean(msg._deleted) };
  };

  const commands = new Map();
  const register = (name, defs = [], options = {}) => {
    let builder = new SlashCommandBuilder().setName(name).setDescription(`أمر ${name}`);
    for (const def of defs) {
      if (def.sub) {
        const sub = new SlashCommandBuilder();
        builder = builder.addSubcommand((s) => {
          let built = s.setName(def.sub).setDescription(def.sub);
          for (const o of def.options || []) {
            if (o.type === 'user') built = built.addUserOption((x) => x.setName(o.name).setDescription(o.name).setRequired(!!o.required));
            else if (o.type === 'int') built = built.addIntegerOption((x) => x.setName(o.name).setDescription(o.name).setRequired(!!o.required));
            else built = built.addStringOption((x) => x.setName(o.name).setDescription(o.name).setRequired(!!o.required));
          }
          return built;
        });
      } else if (def.type === 'user') builder = builder.addUserOption((o) => o.setName(def.name).setDescription(def.name).setRequired(!!def.required));
      else if (def.type === 'int') builder = builder.addIntegerOption((o) => o.setName(def.name).setDescription(def.name).setRequired(!!def.required));
      else builder = builder.addStringOption((o) => o.setName(def.name).setDescription(def.name).setRequired(!!def.required));
    }

    commands.set(name, {
      data: builder,
      permissions: options.permissions || null,
      cooldown: options.cooldown ?? 0,
      run: async (client, interaction) => {
        calls.push({
          name,
          sub: interaction.options.getSubcommand?.() || null,
          who: interaction.user.id,
          args: Object.fromEntries(
            (Object.entries(catalog.COMMANDS[name]?.__capture || {})).map(([k]) => [k, null]),
          ),
          raw: {
            user: safeGet(interaction, 'getUser', ['العضو']),
            reason: safeGet(interaction, 'getString', ['السبب']),
            duration: safeGet(interaction, 'getString', ['المدة']),
            text: safeGet(interaction, 'getString', ['النص']),
            count: safeGet(interaction, 'getInteger', ['العدد']),
            period: safeGet(interaction, 'getString', ['الفترة']),
            type: safeGet(interaction, 'getString', ['النوع']),
            ping: safeGet(interaction, 'getBoolean', ['تنبيه_العضو']),
          },
        });
      },
    });
  };

  function safeGet(interaction, fn, names) {
    for (const n of names) {
      try {
        const value = interaction.options[fn](n);
        if (value !== null && value !== undefined) return value?.username || value;
      } catch { /* الوسيط غير موجود في هذا الأمر */ }
    }
    return null;
  }

  register('ban', [
    { name: 'العضو', type: 'user', required: true },
    { name: 'السبب', type: 'text' },
    { name: 'المدة', type: 'text' },
  ]);
  register('purge', [
    { sub: 'contains', options: [{ name: 'النص', type: 'text', required: true }, { name: 'العدد', type: 'int', required: true }] },
    { sub: 'messages', options: [{ name: 'العدد', type: 'int', required: true }] },
  ]);
  register('timeout', [
    { sub: 'add', options: [{ name: 'العضو', type: 'user', required: true }, { name: 'المدة', type: 'text', required: true }, { name: 'السبب', type: 'text' }] },
  ]);
  register('top', [{ name: 'الفترة', type: 'text' }, { name: 'النوع', type: 'text' }, { name: 'الصفحة', type: 'int' }]);
  register('poll', [
    { name: 'السؤال', type: 'text', required: true },
    { name: 'خيار1', type: 'text', required: true },
    { name: 'خيار2', type: 'text', required: true },
  ]);
  register('kick', [{ name: 'العضو', type: 'user', required: true }], { permissions: ['kick'] });
  register('help', []);
  register('unban', [{ name: 'العضو', type: 'text', required: true }]);
  register('lock', [
    { sub: 'channel', options: [{ name: 'القناة', type: 'text' }, { name: 'السبب', type: 'text' }] },
    { sub: 'unlock', options: [{ name: 'القناة', type: 'text' }] },
    { sub: 'hide', options: [{ name: 'القناة', type: 'text' }, { name: 'السبب', type: 'text' }] },
    { sub: 'show', options: [{ name: 'القناة', type: 'text' }] },
  ]);

  const client = { commands, user: { id: '1' } };

  /* التأكد إن حد الاستخدام صفر (مشيل) — له اختبار خاص (٧) */
  text.setOptions(GUILD, { cooldownSeconds: 0 });
  const doIt = (content, author) => text.handleMessage(client, makeMessage(content, author));

  /* ----------------------- ١) أوامر مباشرة ----------------------- */
  calls.length = 0;
  assert.strictEqual(await doIt('ban <@111111111111111111> سبام شديد 7d'), true, 'أمر ban بلا بريفيكست ما اشتغل');
  assert.strictEqual(calls.length, 1, 'الأمر ما نُفّذ');
  assert.strictEqual(calls[0].raw.user, 'ahmed', 'العضو ما انربط');
  assert.strictEqual(calls[0].raw.reason, 'سبام شديد', 'السبب انقطع (لازم ياخذ باقي الجملة)');
  assert.strictEqual(calls[0].raw.duration, '7d', 'المدة ما انربطت');
  console.log('١) أمر مباشر بلا بريفيكست: ban ahmed سبام شديد 7d ← العضو والسبب والمدة صح ✅');

  calls.length = 0;
  await doIt('ban <@111111111111111111>');
  assert.strictEqual(calls[0].raw.user, 'ahmed', 'المنشن ما انربط بالعضو');
  console.log('   والمنشن <@آيدي> يشتغل كذلك ✅');

  /* ----------------------- ٢) الأوامر الفرعية ----------------------- */
  calls.length = 0;
  await doIt('purge contains سبام 100');
  assert.strictEqual(calls[0].sub, 'contains', 'الأمر الفرعي ما انعرف');
  assert.strictEqual(calls[0].raw.text, 'سبام', 'النص ما انربط');
  assert.strictEqual(calls[0].raw.count, 100, 'العدد ما انربط');

  calls.length = 0;
  await doIt('timeout add <@111111111111111111> 10m إزعاج');
  assert.strictEqual(calls[0].sub, 'add');
  assert.strictEqual(calls[0].raw.user, 'ahmed');
  assert.strictEqual(calls[0].raw.duration, '10m');
  assert.strictEqual(calls[0].raw.reason, 'إزعاج');
  console.log('٢) الأوامر الفرعية: purge contains نص 100 · timeout add عضو 10m سبب ✅');

  calls.length = 0;
  await doIt('top week voice');
  assert.strictEqual(calls[0].raw.period, 'week', 'الفترة ما انربطت');
  assert.strictEqual(calls[0].raw.type, 'voice', 'النوع ما انربط');
  console.log('   top week voice ← الفترة والنوع ✅');

  /* ----------------------- ٣) ما يتنفّذ بالخطأ ----------------------- */
  calls.length = 0;
  for (const normal of ['شو أخباركم اليوم', 'بانته', 'بنشوفك بعدين', 'مرحبا كيف الحال']) {
    await doIt(normal);
  }
  assert.strictEqual(calls.length, 0, `رسائل عادية انفّذت أوامر: ${JSON.stringify(calls)}`);

  /* كلمة إنجليزية شائعة (top) قد تلمس أمرًا — الحل: إطفاء الأمر نفسه من الموقع */
  calls.length = 0;
  await doIt('top story');
  const triggeredByPlainWord = calls.length;
  const off = text.setCommandEnabled(GUILD, 'top', false);
  assert.strictEqual(off.ok, true, 'إطفاء الأمر من الموقع فشل');
  calls.length = 0;
  await doIt('top story');
  assert.strictEqual(calls.length, 0, 'الأمر المطفّي بقي يشتغل بلا بريفيكست');
  text.setCommandEnabled(GUILD, 'top', true);
  calls.length = 0;
  await doIt('top');
  assert.strictEqual(calls.length, 1, 'الأمر ما رجع بعد تشغيله');
  const botMessage = makeMessage('ban <@111111111111111111>');
  botMessage.author.bot = true;
  assert.strictEqual(await text.handleMessage(client, botMessage), false, 'البوت نفّذ أمرًا');
  console.log(`٣) الكلمات العربية والبوتات: ما تنفّذ شي · والأوامر المطفية من الموقع تتوقف ✅ (ملاحظة: كلمة إنجليزية شائعة مثل top قد تلمس الأمر${triggeredByPlainWord ? ' — والمفتاح لكل أمر يوقفها' : ''})`);

  /* ----------------------- ٤) الاختصارات (بأي لغة) ----------------------- */
  /* الافتراضي: اختصارات إنجليزية + عربية جاهزة لكل أمر */
  assert.strictEqual(text.resolveCommand(GUILD, 'حظر'), 'ban', 'الاختصار العربي «حظر» ما انعرف');
  assert.strictEqual(text.resolveCommand(GUILD, 'توب'), 'top', 'الاختصار العربي «توب» ما انعرف');
  assert.strictEqual(text.resolveCommand(GUILD, 'فكالحظر'), 'unban', 'اختصار الكلمتين «فك الحظر» ما انعرف');
  assert.strictEqual(text.resolveCommand(GUILD, 'مدير'), null, 'كلمة عشوائية انحسبت اختصارًا');

  calls.length = 0;
  await doIt('حظر <@111111111111111111> باند');
  assert.strictEqual(calls[0]?.name, 'ban', 'الاختصار العربي الافتراضي «حظر» ما نفّذ الحظر');

  calls.length = 0;
  await doIt('فك الحظر <@111111111111111111>');
  assert.strictEqual(calls[0]?.name, 'unban', 'اختصار الكلمتين ما نفّذ الأمر');

  /* إضافة اختصار بأي لغة من اللوحة */
  const arAdd = text.setAliases(GUILD, 'top', ['المتصدرين', 'yasakla']);
  assert.strictEqual(arAdd.ok, true, 'اختصار بأي لغة ما انقبل');
  assert.strictEqual(text.resolveCommand(GUILD, 'yasakla'), 'top', 'اختصار تركي ما اشتغل');

  /* اختصار محجوز لأمر ثاني (عربي افتراضي عند kick) → مرفوض */
  const clash = text.setAliases(GUILD, 'ban', ['طرد']);
  assert.strictEqual(clash.ok, false, 'اختصار عربي محجوز انقبل!');
  assert.strictEqual(clash.takenBy['طرد'], 'kick', 'التعارض العربي ما انكشف صح');

  /* رمز غلط → مرفوض */
  const badAlias = text.setAliases(GUILD, 'ban', ['!!!']);
  assert.strictEqual(badAlias.ok, false, 'اختصار غير صالح انقبل!');

  /* إضافة/حذف اختصار إنجليزي (كما قبل) */
  const okAdd = text.setAliases(GUILD, 'ban', ['bn', 'حظر']);
  assert.strictEqual(okAdd.ok, true, 'إضافة الاختصار فشلت');

  calls.length = 0;
  await doIt('bn <@111111111111111111>');
  assert.strictEqual(calls[0]?.name, 'ban', 'الاختصار المضاف ما اشتغل');

  const taken = text.setAliases(GUILD, 'kick', ['bn']);
  assert.strictEqual(taken.ok, false, 'اختصار محجوز انقبل لأمر ثاني!');
  assert.strictEqual(taken.takenBy.bn, 'ban', 'التعارض ما انكشف صح');

  const removed = text.setAliases(GUILD, 'ban', []);
  assert.strictEqual(removed.ok, true);
  calls.length = 0;
  await doIt('bn <@111111111111111111>', plainMember);
  assert.strictEqual(calls.length, 0, 'الاختصار المحذوف بقي شغّال');

  calls.length = 0;
  await doIt('ban <@111111111111111111>');
  assert.strictEqual(calls[0]?.name, 'ban', 'اسم الأمر نفسه ما اشتغل بعد حذف الاختصار');
  console.log('٤) الاختصارات بأي لغة: عربي افتراضي (حظر · توب · فك الحظر) · إضافة تركي/عربي · منع التعارض · حذف — كله صح ✅');

  /* سيرفر محفوظ من قبل باختصارات إنجليزية: الاختصارات العربية تنضم له، وإذا شالها ما ترجع */
  const LEGACY = '100000000000008888';
  db.updateGuildSettings(LEGACY, { textCommands: { aliases: { help: ['h'] } } });
  assert.deepStrictEqual(text.configFor(LEGACY).aliases.help, ['h', 'مساعدة'], 'الاختصار العربي ما انضم للمحفوظ القديم');
  assert.deepStrictEqual(text.configFor(LEGACY).aliases.ban, ['b', 'حظر', 'باند'], 'اختصارات الحظر ما انضمت للمحفوظ القديم');
  text.setAliases(LEGACY, 'help', ['h']);
  assert.deepStrictEqual(text.configFor(LEGACY).aliases.help, ['h'], 'الاختصار اللي شاله صاحب السيرفر رجع من حاله');
  text.setAliases(LEGACY, 'help', ['h', 'مساعدة']);
  assert.deepStrictEqual(text.configFor(LEGACY).aliases.help, ['h', 'مساعدة'], 'الاختصار اللي رجّعه صاحب السيرفر ما رجع');
  console.log('   والاختصارات العربية تنضم للسيرفرات المحفوظة من قبل، والمحذوف يبقى محذوف ✅');

  /* ----------------------- ٤ب) قواعد الأمر ----------------------- */
  /* رومات: قناة معطّلة = ما يشتغل · قناة مفعّلة = بس فيها */
  const savedRules = text.setRules(GUILD, 'ban', { disabledChannels: ['900000000000000001'] });
  assert.strictEqual(savedRules.ok, true, 'حفظ قواعد الأمر فشل');
  assert.deepStrictEqual(text.rulesFor(GUILD, 'ban').disabledChannels, ['900000000000000001'], 'القناة المعطّلة ما انحفظت');

  calls.length = 0;
  await doItWith('ban <@111111111111111111>', { channelId: '900000000000000001' });
  assert.strictEqual(calls.length, 0, 'الأمر اشتغل في روم معطّل!');

  text.setRules(GUILD, 'ban', { disabledChannels: [], enabledChannels: ['900000000000000002'] });
  calls.length = 0;
  await doItWith('ban <@111111111111111111>', { channelId: '900000000000000003' });
  assert.strictEqual(calls.length, 0, 'الأمر اشتغل في روم مو من القائمة المفعّلة!');

  calls.length = 0;
  await doItWith('ban <@111111111111111111>', { channelId: '900000000000000002' });
  assert.strictEqual(calls[0]?.name, 'ban', 'الأمر ما اشتغل في الروم المفعّل');
  text.setRules(GUILD, 'ban', { enabledChannels: [] });

  /* رتب: معطّلة = ممنوع · مفعّلة = بس أصحابها */
  const roleId = '900000000000000009';
  text.setRules(GUILD, 'ban', { disabledRoles: [roleId] });
  calls.length = 0;
  await doItWith('ban <@111111111111111111>', { roles: [roleId] });
  assert.strictEqual(calls.length, 0, 'الأمر اشتغل لعضو عنده رتبة معطّلة!');

  text.setRules(GUILD, 'ban', { disabledRoles: [], enabledRoles: [roleId] });
  calls.length = 0;
  await doIt('ban <@111111111111111111>');
  assert.strictEqual(calls.length, 0, 'الأمر اشتغل لعضو مو من الرتب المفعّلة!');

  calls.length = 0;
  await doItWith('ban <@111111111111111111>', { roles: [roleId] });
  assert.strictEqual(calls[0]?.name, 'ban', 'الأمر ما اشتغل لصاحب الرتبة المفعّلة');

  /* أنواع الردود: رسالة الأمر تنحذف فورًا لو الخيار شغّال */
  text.setRules(GUILD, 'ban', { enabledRoles: [], autoDeleteInvocation: true });
  const rules = text.rulesFor(GUILD, 'ban');
  assert.strictEqual(rules.autoDeleteInvocation, true, 'خيار حذف رسالة الأمر ما انحفظ');
  assert.strictEqual(text.rulesFor(GUILD, 'ban').autoDeleteWithMessage, false, 'خيار غلط انشغل لحاله');
  const delResult = await doItWith('ban <@111111111111111111>');
  assert.strictEqual(delResult.deleted, true, 'رسالة الأمر ما انحذفت مع الخيار');
  text.setRules(GUILD, 'ban', { autoDeleteInvocation: false });

  assert.strictEqual(text.setRules(GUILD, 'nope', {}).ok, false, 'أمر غير موجود انقبل');
  assert.strictEqual(text.setRules(GUILD, 'ban', { disabledRoles: ['abc'] }).ok, false, 'معرّف غلط انقبل');
  console.log('٤ب) قواعد الأمر: رومات مفعّلة/معطّلة · رتب مفعّلة/معطّلة · حذف رسالة الأمر — كله صح ✅');

  /* ----------------------- ٤ج) قفل وفتح الروم بكلمة وحدة ----------------------- */
  calls.length = 0;
  await doIt('قفل');
  assert.strictEqual(calls.at(-1)?.name, 'lock', '«قفل» ما نفّذ أمر القفل');
  assert.strictEqual(calls.at(-1)?.sub, 'channel', '«قفل» ما قفل الروم (الأمر الفرعي غلط)');

  calls.length = 0;
  await doIt('فتح');
  assert.strictEqual(calls.at(-1)?.name, 'lock', '«فتح» ما نفّذ أمر الفتح');
  assert.strictEqual(calls.at(-1)?.sub, 'unlock', '«فتح» ما فتح الروم (الأمر الفرعي غلط)');

  calls.length = 0;
  await doIt('اقفل');
  assert.strictEqual(calls.at(-1)?.sub, 'channel', '«اقفل» ما قفل الروم');
  calls.length = 0;
  await doIt('افتح');
  assert.strictEqual(calls.at(-1)?.sub, 'unlock', '«افتح» ما فتح الروم');
  calls.length = 0;
  await doIt('سكر');
  assert.strictEqual(calls.at(-1)?.sub, 'channel', '«سكر» ما قفل الروم');

  /* إخفاء وإظهار الروم */
  calls.length = 0;
  await doIt('اخفاء');
  assert.strictEqual(calls.at(-1)?.name, 'lock', '«اخفاء» ما نفّذ أمر القفل');
  assert.strictEqual(calls.at(-1)?.sub, 'hide', '«اخفاء» ما خفّى الروم');
  calls.length = 0;
  await doIt('اظهار');
  assert.strictEqual(calls.at(-1)?.sub, 'show', '«اظهار» ما أظهر الروم');
  calls.length = 0;
  await doIt('اخفي');
  assert.strictEqual(calls.at(-1)?.sub, 'hide', '«اخفي» ما خفّى الروم');

  /* والأمر الفرعي المكتوب صريحًا يبقى شغّال: lock unlock يفتح */
  calls.length = 0;
  await doIt('lock unlock');
  assert.strictEqual(calls.at(-1)?.sub, 'unlock', 'الأمر الفرعي الصريح ما اشتغل');

  /* «مسح» لحالها: تنظيف ١٠٠ رسالة بلا ما تكتب عددًا */
  calls.length = 0;
  await doIt('مسح');
  assert.strictEqual(calls.at(-1)?.name, 'purge', '«مسح» ما نفّذ التنظيف');
  assert.strictEqual(calls.at(-1)?.sub, 'messages', '«مسح» ما اختار أمر التنظيف الفرعي');
  assert.strictEqual(calls.at(-1)?.raw.count, 100, '«مسح» ما افترض ١٠٠ رسالة');
  calls.length = 0;
  await doIt('مسح 20');
  assert.strictEqual(calls.at(-1)?.raw.count, 20, '«مسح 20» ما أخذ الرقم المكتوب');
  console.log('٤ج) كلمة وحدة تكفي: قفل · فتح · اخفاء · اظهار · مسح (١٠٠ رسالة افتراضيًا) ✅');

  /* ----------------------- ٥) الإيقاف والإعدادات ----------------------- */
  const turnedOff = text.setOptions(GUILD, { enabled: false });
  assert.strictEqual(turnedOff.ok, true);
  calls.length = 0;
  assert.strictEqual(await doIt('ban <@111111111111111111>'), false, 'الأوامر شغّالة رغم إيقافها من الموقع!');
  text.setOptions(GUILD, { enabled: true });
  calls.length = 0;
  assert.strictEqual(await doIt('ban <@111111111111111111>'), true, 'الأوامر ما رجعت بعد التشغيل');
  console.log('٥) الإيقاف والتشغيل من الموقع يُطبَّقان فورًا ✅');

  /* ----------------------- ٦) الصلاحيات ----------------------- */
  calls.length = 0;
  replies.length = 0;
  const guestResult = await doIt('kick <@111111111111111111>', plainMember);
  assert.strictEqual(guestResult, true, 'الأمر ما تعامل وياه');
  assert.strictEqual(calls.length, 0, 'عضو بلا صلاحية نفّذ أمرًا إداريًا!');
  assert.ok(String(replies[replies.length - 1]?.content || '').length > 5, 'ما في رسالة توضّح نقص الصلاحية');
  console.log('٦) الصلاحيات: عضو بلا صلاحية ما ينفّذ الأوامر الإدارية ✅');

  /* ----------------------- ٧) بلا كولداون ----------------------- */
  /* حتى لو محفوظ رقم قديم، الكولداون مشيل: كل استدعاء يتنفّذ فورًا بلا رسالة انتظار */
  text.setOptions(GUILD, { cooldownSeconds: 30 });
  assert.strictEqual(text.configFor(GUILD).cooldownSeconds, 0, 'الكولداون المشيل رجع من الإعدادات المحفوظة');
  calls.length = 0;
  replies.length = 0;
  await doIt('help');
  await doIt('help');
  await doIt('help');
  assert.strictEqual(calls.length, 3, 'الأوامر ما تنفّذت بلا انتظار (الكولداون لسا يمنع)');
  assert.ok(!/استنى|انتظر/.test(String(replies[replies.length - 1]?.content || '')), 'طلع رسالة انتظار مع إن الكولداون مشيل');
  text.setOptions(GUILD, { cooldownSeconds: 0 });
  console.log('٧) الكولداون مشيل: ٣ استدعاءات ورا بعض كلهم تنفّذوا بلا انتظار ✅');

  /* ----------------------- ٨) الكتالوج يغطي كل الأوامر ----------------------- */
  const { walk } = require('../src/handlers/commands');
  const files = walk(path.join(__dirname, '..', 'src', 'commands'));
  const realNames = files.map((f) => require(f).data.toJSON().name).sort();
  assert.deepStrictEqual(realNames, Object.keys(catalog.COMMANDS).sort(), 'الكتالوج ما يطابق الأوامر الحقيقية (زيادة أو نقص)');
  for (const [name, meta] of Object.entries(catalog.COMMANDS)) {
    assert.ok(meta.label && meta.what, `الأمر ${name} ينقصه شرح`);
    assert.ok(meta.usage?.length, `الأمر ${name} ينقصه كيف يُكتب`);
    assert.ok(meta.examples?.length, `الأمر ${name} ينقصه مثال`);
    assert.ok(meta.category && catalog.CATEGORIES[meta.category], `الأمر ${name} تصنيفه غير معروف`);
  }
  console.log(`٨) مكتبة الشرح تغطي كل الأوامر (${realNames.length} أمر) بشرح وكيفية وأمثلة ✅`);

  /* ----------------------- ٩) الاختصارات المقترحة بلا تعارض ----------------------- */
  const snap = text.adminSnapshot(GUILD, realNames);
  const usedAliases = new Map();
  const clashes = [];
  for (const item of snap.items) {
    for (const alias of item.aliases) {
      if (usedAliases.has(alias)) clashes.push(`${alias}: ${usedAliases.get(alias)} ↔ ${item.name}`);
      else usedAliases.set(alias, item.name);
      if (usedAliases.has(alias) && item.conflict.length) clashes.push(`معلن كتعارض: ${alias}`);
    }
  }
  assert.deepStrictEqual(clashes, [], `تعارض بالاختصارات الافتراضية: ${clashes.join(' · ')}`);
  const suggestions = snap.items.map((i) => i.suggested);
  assert.strictEqual(new Set(suggestions).size, suggestions.length, 'الاقتراحات فيها تكرار');
  console.log(`٩) ${usedAliases.size} اختصار افتراضي بلا أي تعارض + اقتراحات فريدة ✅`);

  /* ----------------------- ١٠) التصويت ----------------------- */
  calls.length = 0;
  await doIt('poll أفضل وقت | المغرب | العشاء');
  assert.strictEqual(calls[0]?.name, 'poll', 'أمر التصويت ما اشتغل');
  console.log('١٠) التصويت: poll سؤال | خيار | خيار ✅');

  console.log('\n🎉 الأوامر بلا بريفيكست + الاختصارات + مكتبة الشرح كلها تعمل\n');
  return { ok: true };
}

module.exports = { run };

if (require.main === module) {
  console.log('\n[اختبار] الأوامر بدون بريفيكست + اختصارات من الموقع\n');
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
