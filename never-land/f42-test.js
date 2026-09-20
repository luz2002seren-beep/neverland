'use strict';

/**
 * f42-test.js
 * -------------------------------------------------------------
 * ١) /top بأسلوب اللوحات المعروفة: توب داي · توب ويك · توب منث + كتابي/صوتي + صفحات
 * ٢) أوامر الشات القصيرة: t day · t week · t month · توب منث
 * ٣) سياسة الرسائل الخاصة: ٣ حالات فقط (تحذير · قبول · رفض)
 * ٤) شكل الرد: نص عادي أو إمبد (replyFormat) — والعقوبات نصية افتراضيًا
 * ٥) تذكير التذكرة: يعمل داخل تذكرة مفتوحة فقط + رسالة خاصة نصية بلا إمبد
 * ٦) إضافة أعضاء للتذكرة: قائمة الأعضاء (UserSelect) صارت تشتغل + أكثر من عضو
 * ٧) رسالة فتح التذكرة كلها من الموقع (عنوان · وصف · حقول · تذييل)
 * ٨) لوحة «ردود أوامر» موجودة في الموقع + مسار الـ API
 *
 * التشغيل:  node f42-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-f42-'));
process.env.DATABASE_PATH = path.join(tmp, 'f42.db');
process.env.DEMO_MODE = 'true';

const db = require('./src/database');
const periods = require('./src/lib/periods');
const leveling = require('./src/systems/leveling');
const replyFormat = require('./src/lib/replyFormat');
const dmPolicy = require('./src/lib/dmPolicy');
const tickets = require('./src/systems/tickets');
const textCommands = require('./src/systems/textCommands');

let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

const GUILD = '600000000000000001';

function resetSettings(patch = {}) {
  db.updateGuildSettings(GUILD, patch);
}

async function main() {
  console.log('\n═══ ١) التوب: الفترات الثلاث (داي · ويك · منث) ═══');
  {
    assert.strictEqual(periods.monthKey(new Date('2026-09-20T10:00:00Z')), '2026-09', 'مفتاح الشهر لازم YYYY-MM');
    assert.strictEqual(periods.monthKey(new Date('2026-10-01T00:10:00Z')), '2026-10', 'مفتاح الشهر عبر الشهور خطأ');
    assert.ok(periods.PERIOD_KEYS.includes('month'), 'فترة الشهر ناقصة من PERIOD_KEYS');
    assert.ok(periods.PERIODS.month, 'وصف فترة الشهر ناقص');
    assert.strictEqual(periods.PERIODS.month.short, 'توب منث', 'اسم الفترة لازم يكون «توب منث»');
    assert.ok(/شهر/.test(periods.PERIODS.month.desc), 'وصف الفترة ناقص');
    const label = periods.resetLabel('month', new Date());
    assert.ok(/يتجدّد|يوم/.test(String(label)), 'وصف تجديد الشهر ناقص: ' + label);
    const range = periods.periodRange('month', new Date('2026-09-20T10:00:00Z'));
    assert.ok(range && range.start && range.end, 'مدى الشهر ناقص');
    ok('الفترة الثالثة «توب منث» (مفتاح YYYY-MM + وقت التجديد)');
  }

  console.log('\n═══ ٢) تجميع الخبرة لكل فترة (داي/ويك/منث) ═══');
  {
    resetSettings({ leveling: { enabled: true, cooldownSeconds: 0, textXpPerChars: 5, textXpPerCharsAmount: 1 } });
    const client = { user: { id: '100000000000000002' }, guilds: { cache: new Map() } };
    const member = {
      id: '200000000000000010',
      user: { id: '200000000000000010', bot: false, tag: 'Ahmed#0001', username: 'Ahmed' },
      roles: { cache: [] },
      guild: { id: GUILD, name: 'Test Server' },
    };
    const settings = db.getGuildSettings(GUILD);
    for (let i = 0; i < 3; i += 1) {
      await leveling.addXp(client, member, 10, { source: 'text', messages: 1, bypassCooldown: true });
    }
    const cfg = settings.leveling || {};
    const day = db.getPeriodRow(GUILD, member.id, 'day', periods.dayKey(new Date(), cfg));
    const week = db.getPeriodRow(GUILD, member.id, 'week', periods.weekKey(new Date(), cfg));
    const month = db.getPeriodRow(GUILD, member.id, 'month', periods.monthKey(new Date(), cfg));
    assert.ok(day && day.xp === 30, 'خبرة اليوم خطأ: ' + (day && day.xp));
    assert.ok(week && week.xp === 30, 'خبرة الأسبوع خطأ: ' + (week && week.xp));
    assert.ok(month && month.xp === 30, 'خبرة الشهر خطأ: ' + (month && month.xp));
    ok('كل خبرة تُحدّث الفترات الثلاث (يوم 30 · أسبوع 30 · شهر 30)');
  }

  console.log('\n═══ ٣) شكل رد /top (إمبيد بنفس التنظيم) ═══');
  {
    resetSettings();
    const embed = leveling.topBoardEmbed(GUILD, { period: 'day', source: 'text', page: 1, perPage: 10 }, 'ar');
    const data = embed.toJSON ? embed.toJSON() : embed.data || embed;
    assert.ok(data.title, 'إمبيد التوب بلا عنوان');
    assert.ok(/توب/.test(data.title), 'العنوان لازم يبدأ بـ«توب»: ' + data.title);
    assert.ok(/داي|day/i.test(data.title + JSON.stringify(data.fields || [])), 'اسم الفترة ناقص من الإمبيد');
    const body = (data.description || '') + (data.fields || []).map((f) => `${f.name} ${f.value}`).join('\n');
    assert.ok(/🥇|🥈|🥉/.test(body) || /ما في|لا يوجد/.test(body), 'ترتيب الأعضاء (ميداليات) ناقص');
    assert.ok(/XP/.test(body), 'قيمة الخبرة ناقصة من التوب');
    /* بلا فوتر نهائيًا — ولا أي تلميح أوامر زي «استخدم t day 1» */
    assert.strictEqual(data.footer, undefined, 'التوب لازم يكون بلا فوتر: ' + JSON.stringify(data.footer));
    assert.ok(!/استخدم|use `t/i.test(JSON.stringify(data)), 'لسا في تلميح «استخدم t day» داخل التوب');
    assert.ok(!/NaN/.test(JSON.stringify(data)), 'التوب فيه NaN');
    ok('إمبيد /top: عنوان «توب — توب داي» + ميداليات + خبرة — بلا فوتر وبلا تلميح أوامر');

    /* الترجمة الإنجليزية + الخط المزخرف تشمل نصوص التوب الجديدة */
    const replies = require('./src/lib/replies');
    const cfg = { english: true, fancyFont: false };
    const titleEn = replies.decorateText(String(data.title), cfg);
    assert.ok(!/[\u0600-\u06FF]/.test(titleEn), 'عنوان التوب ما انترجم للإنجليزية: ' + titleEn);
    for (const line of String(data.description || '').split('\n').slice(0, 2)) {
      if (!line.includes('<@')) continue;
      const en = replies.decorateText(line, cfg);
      assert.ok(!/[\u0600-\u06FF]/.test(en), 'سطر الأعضاء ما انترجم: ' + en);
    }
    const resetEn = replies.decorateText(String((data.fields || []).find((f) => f.name === 'التجديد')?.value || 'بلا تجديد'), cfg);
    assert.ok(!/[\u0600-\u06FF]/.test(resetEn), 'نص التجديد ما انترجم: ' + resetEn);
    ok('نصوص التوب تنترجم للإنجليزية (العنوان · أسطر الأعضاء · التجديد)');
  }

  console.log('\n═══ ٤) خيارات الأمر /top (النوع · الفترة · الصفحة) + t day ═══');
  {
    const topSrc = fs.readFileSync(path.join(__dirname, 'src', 'commands', 'general', 'top.js'), 'utf8');
    assert.ok(/require\('\.\.\/\.\.\/lib\/periods'\)/.test(topSrc), 'أمر التوب ما صار يستعمل الفترات المشتركة');
    assert.ok(/isPeriod/.test(topSrc), 'التحقق من الفترة ناقص');
    assert.ok(/month/.test(topSrc), 'خيار «توب منث» ناقص من الأمر');
    assert.ok(/topBoardEmbed/.test(topSrc), 'أمر التوب ما صار يستعمل اللوحة الجديدة');
    assert.ok(/text/.test(topSrc) && /voice/.test(topSrc), 'خيارات المصدر (كتابي/صوتي) ناقصة');

    const tcSrc = fs.readFileSync(path.join(__dirname, 'src', 'systems', 'textCommands.js'), 'utf8');
    assert.ok(/'توب منث'|توب منث/.test(tcSrc), 'أمر الشات «توب منث» ناقص');
    assert.ok(/top.*'t'|'t'.*top/.test(tcSrc), 'الاسم القصير t ناقص');

    /* t day → يفتح أمر التوب بفترة اليوم (نفس مسار أوامر الشات الحقيقي) */
    const topCommand = require('./src/commands/general/top');
    const replies = [];
    const client = {
      user: { id: '100000000000000002' },
      commands: new Map([['top', topCommand]]),
    };
    const fakeGuild = {
      id: GUILD,
      name: 'Test',
      channels: { cache: new Map() },
      members: { fetch: async () => null, cache: new Map() },
      me: { id: '100000000000000002' },
    };
    const msg = {
      id: '400000000000000001',
      content: 't day',
      author: { id: '200000000000000010', bot: false, username: 'Ahmed', tag: 'Ahmed#0001' },
      member: { id: '200000000000000010', permissions: { has: () => false }, roles: { cache: [] } },
      guild: fakeGuild,
      channel: { id: '500000000000000005', send: async (p) => { replies.push(p); return p; }, permissionsFor: () => ({ has: () => true }) },
      reply: async (p) => { replies.push(p); return p; },
      client,
      inGuild: () => true,
      mentions: { users: { first: () => null } },
    };
    const handled = await textCommands.handleMessage(client, msg, 'ar');
    assert.strictEqual(handled, true, 'أمر الشات t day ما انعالج');
    /* الرد يمر بمحرّك الردود كامل (شكل + ترجمة + خط) — نفحص بنية لوحة التوب */
    const topPayload = replies.find((p) => (p.embeds || []).length) || {};
    const topData = topPayload.embeds?.[0]?.data || topPayload.embeds?.[0] || {};
    assert.ok(String(topData.title || '').includes('🏆'), 'رد t day ما فيه عنوان لوحة التوب: ' + JSON.stringify(topData).slice(0, 120));
    assert.ok(/🥇|🥈|🥉|<@\d+/.test(String(topData.description || '')), 'رد t day ما فيه ترتيب أعضاء: ' + String(topData.description || '').slice(0, 120));
    assert.ok((topData.fields || []).length >= 3, 'رد t day ما فيه حقول اللوحة');
    ok('t day بالشات يشتغل ويفتح لوحة التوب (نفس /top)');

    /* كلمة غير صالحة (t banana) ⇒ ترجع للافتراضي بلا خطأ */
    replies.length = 0;
    const msg2 = { ...msg, content: 't banana' };
    const handled2 = await textCommands.handleMessage(client, msg2, 'ar');
    assert.strictEqual(handled2, true, 'القيمة غير الصالحة ما انعالجت');
    assert.ok(!/خطأ|error/i.test(JSON.stringify(replies)), 'القيمة غير الصالحة لازم ترجع للافتراضي بلا خطأ');
    ok('قيمة غير صالحة (t banana) ترجع لافتراضي اليوم بلا رسالة خطأ');
  }

  console.log('\n═══ ٥) سياسة الرسائل الخاصة: ٣ حالات فقط ═══');
  {
    resetSettings();
    const settings = db.getGuildSettings(GUILD);
    for (const kind of ['warn', 'applicationAccepted', 'applicationRejected']) {
      assert.strictEqual(dmPolicy.allowed(kind, settings), true, `المسموح مرفوض: ${kind}`);
    }
    for (const kind of ['levelUp', 'ticketClose', 'welcome', 'ticketRemindAuto', 'ticketOpen']) {
      assert.strictEqual(dmPolicy.allowed(kind, settings), false, `الممنوع مسموح: ${kind}`);
    }
    assert.deepStrictEqual(dmPolicy.ALLOWED, ['warn', 'applicationAccepted', 'applicationRejected'], 'قائمة الحالات الثلاث تغيّرت');
    ok('المسموح ٣ فقط: تحذير · قبول التقديم · رفض التقديم (والباقي ممنوع)');

    /* إجراء صريح من الإدارة (تذكير) مسموح يدويًا */
    assert.strictEqual(dmPolicy.actionAllowed('ticketRemind', settings), true, 'التذكير اليدوي ممنوع');
    ok('التذكير اليدوي (تذكير) إجراء صريح من الإدارة ⇒ مسموح');

    /* إنذار فعلي يوصل الخاص كنص عادي */
    const sent = [];
    const target = { id: '200000000000000010', tag: 'Ahmed#0001', send: async (p) => { sent.push(p); return {}; } };
    const warnSent = await dmPolicy.send(target, 'تحذير تجريبي', { kind: 'warn', settings });
    assert.strictEqual(warnSent, true, 'تحذير ما وصل على الخاص');
    assert.strictEqual(sent.length, 1, 'لازم رسالة واحدة');
    assert.ok(!sent[0].embeds, 'رسالة التحذير لازم تكون نصية بلا إمبد');

    /* مستوى جديد ما يبعت خاص */
    const blocked = await dmPolicy.send(target, 'وصلت مستوى جديد', { kind: 'levelUp', settings });
    assert.strictEqual(blocked, false, 'الترقية بعثت خاص وهذا ممنوع');
    assert.strictEqual(sent.length, 1, 'ما لازم تنبعت رسالة إضافية');
    ok('التحذير يوصل الخاص نصًا · ورسائل المستويات ما توصل أبدًا');

    /* الاستثناء اليدوي: dm.extraKinds من الإعدادات */
    resetSettings({ dm: { extraKinds: ['ticketClose'] } });
    assert.strictEqual(dmPolicy.allowed('ticketClose', db.getGuildSettings(GUILD)), true, 'الإضافة اليدوية ما اشتغلت');
    resetSettings();
    ok('باب استثناء يدوي للإدارة (settings.dm.extraKinds)');
  }

  console.log('\n═══ ٦) شكل الرد: نص عادي أو إمبد ═══');
  {
    resetSettings();
    for (const cmd of ['ban', 'kick', 'unban', 'warn', 'purge', 'lock', 'slowmode', 'timeout', 'untimeout', 'member']) {
      assert.strictEqual(replyFormat.defaultMode(cmd), 'text', `${cmd} لازم يكون نصي افتراضيًا`);
    }
    assert.strictEqual(replyFormat.defaultMode('top'), 'embed', 'التوب لازم يبقى إمبد');
    assert.strictEqual(replyFormat.defaultMode('help'), 'embed', 'المساعدة لازم تبقى إمبد');
    ok('العقوبات (حظر/طرد/تحذير/تنظيف/قفل…) نصية افتراضيًا — والبقية إمبد');

    const settings = db.getGuildSettings(GUILD);
    const textOut = replyFormat.apply({ content: 'تم الحظر' }, {
      commandName: 'ban',
      settings,
      vars: { user: '@عضو', reason: 'سبام', case: '12' },
    });
    assert.ok(textOut.content && !textOut.embeds, 'الحظر لازم يطلع نص عادي');
    ok('رد الحظر يطلع رسالة نصية بلا إمبد (شكل الرد الافتراضي)');

    /* نص مخصّص من الموقع */
    const custom = JSON.parse(JSON.stringify(settings));
    custom.commandReplies = { ban: { mode: 'text', text: '🔨 تم حظر {user} — السبب: {reason} · حالة #{case}' } };
    const filled = replyFormat.apply({ content: 'تم الحظر' }, {
      commandName: 'ban',
      settings: custom,
      vars: { user: '@أحمد', reason: 'سبام', case: '7' },
    });
    assert.strictEqual(filled.content, '🔨 تم حظر @أحمد — السبب: سبام · حالة #7', 'المتغيّرات ما انستبدلت: ' + filled.content);
    ok('نص الرد المخصّص من اللوحة ينستبدل بمتغيّراته ({user} · {reason} · {case})');

    /* العقوبات: إمبيد الأمر يتحوّل لنص منظّم حتى لو ما فيه قالب مخصّص */
    const converted = replyFormat.apply(
      { embeds: [{ data: { title: '🧹 تنظيف', description: 'تم حذف **25** رسالة.' } }] },
      { commandName: 'purge', settings, vars: {} },
    );
    assert.ok(converted.content && !converted.embeds, 'التنظيف لازم يطلع نص عادي بلا إمبد');
    assert.ok(converted.content.includes('25'), 'محتوى الرسالة ضاع بالتحويل: ' + converted.content);
    ok('ردود العقوبات تتحوّل من إمبد لنص عادي (المحتوى محفوظ)');

    /* إمبد اختياري */
    const asEmbed = JSON.parse(JSON.stringify(settings));
    asEmbed.commandReplies = { warn: { mode: 'embed', title: 'تحذير' } };
    const embedOut = replyFormat.apply({ content: 'تم التحذير' }, { commandName: 'warn', settings: asEmbed, vars: { user: '@أحمد' } });
    assert.ok(embedOut.embeds && embedOut.embeds.length, 'الوضع «إمبد» ما بنى إمبد');
    ok('لو المدير اختار «إمبد» يطلع الرد بإطار إمبد');

    /* المعاينة (تستخدمها صفحة «ردود أوامر») */
    const preview = replyFormat.preview('ban', custom, { label: 'حظر' });
    assert.ok(preview.before && preview.after, 'المعاينة ناقصة');
    assert.ok(preview.after.includes('@') || preview.after.length > 3, 'معاينة النص المخصّص فاضية');
    ok('replyFormat.preview() يرجّع قبل/بعد للمعاينة في الموقع');

    /* الأسطر الحقيقية: أمر الحظر يستدعي المحرّك عبر الردود */
    const repliesSrc = fs.readFileSync(path.join(__dirname, 'src', 'lib', 'replies.js'), 'utf8');
    assert.ok(/replyFormat\.apply/.test(repliesSrc), 'محرّك شكل الرد ما انربط بمحرّك الردود');
    const banSrc = fs.readFileSync(path.join(__dirname, 'src', 'commands', 'moderation', 'ban.js'), 'utf8');
    assert.ok(/__replyVars/.test(banSrc), 'متغيّرات رد الحظر (الحالة/السبب) ناقصة');
    ok('المحرّك مربوط بالردود الحقيقية + متغيّرات العقوبات موجودة');
  }

  console.log('\n═══ ٧) تذكير التذكرة: داخل التذكرة فقط + خاص نصي ═══');
  {
    resetSettings();
    /* خارج تذكرة ⇒ مرفوض */
    const outside = await tickets.remind(
      { user: { id: '100000000000000002' } },
      { channel: { id: '999000000000000999' }, guild: { id: GUILD, name: 'Test' }, target: { id: '200000000000000010' } },
    );
    assert.strictEqual(outside.ok, false, 'التذكير لازم يُرفض خارج غرفة التذكرة');
    assert.strictEqual(outside.reason, 'notATicket');
    ok('«تذكير» خارج غرفة التذكرة ⇒ مرفوض');

    /* داخل تذكرة ⇒ رسالة خاصة نصية بلا إمبد */
    const ticket = db.createTicket({ guildId: GUILD, userId: '200000000000000010', channelId: '501000000000000501', type: 'support' });
    const sent = [];
    const target = { id: '200000000000000010', tag: 'Ahmed#0001', send: async (p) => { sent.push(p); return {}; } };
    const res = await tickets.remind(
      { user: { id: '100000000000000002' } },
      { channel: { id: '501000000000000501' }, guild: { id: GUILD, name: 'Test Server' }, target, note: 'رجاءً ردّ علينا', by: { tag: 'Mod#0001' } },
    );
    assert.strictEqual(res.ok, true, 'التذكير داخل التذكرة فشل');
    assert.strictEqual(res.sent, true, 'رسالة التذكير ما انبعثت');
    assert.strictEqual(sent.length, 1, 'لازم رسالة واحدة');
    assert.ok(!sent[0].embeds, 'تذكير التذكرة لازم يكون **بلا إمبد**');
    assert.ok(sent[0].content.includes(`#${ticket.id}`), 'التذكير لازم يذكر رقم التذكرة');
    assert.ok(sent[0].content.includes('رجاءً ردّ علينا'), 'نص الرسالة المخصّصة ناقص');

    /* التذكير ينترجم للإنجليزية (زي باقي الردود) — مع بقاء اسم العضو كما هو */
    const replies2 = require('./src/lib/replies');
    /* نسخة الخاص في الإرسال الحقيقي تمر بمحرّك الردود (decorate) — نتأكد إن القاموس يغطي النص */
    const reminderEn = sent[0].content.split('\n').map((line) => replies2.translate(line));
    assert.ok(!/[\u0600-\u06FF]/.test(reminderEn[0]), 'سطر التذكير ما انترجم: ' + reminderEn[0]);
    assert.ok(/Reminder/i.test(reminderEn.join(' ')), 'الترجمة الإنجليزية للتذكير ناقصة: ' + reminderEn.join(' '));
    assert.ok(reminderEn.some((l) => l.startsWith('Message:')), 'سطر الرسالة ما انترجم: ' + reminderEn.join(' | '));
    ok('رسالة التذكير تنترجم للإنجليزية تلقائيًا (نص عادي بلا إمبد)');

    const ticketsSrc = fs.readFileSync(path.join(__dirname, 'src', 'commands', 'config', 'tickets.js'), 'utf8');
    assert.ok(/sub === 'remind'/.test(ticketsSrc), 'أمر تذكير ناقص من أمر التذاكر');
    const tcSrc = fs.readFileSync(path.join(__dirname, 'src', 'systems', 'textCommands.js'), 'utf8');
    assert.ok(/تذكير/.test(tcSrc), 'كلمة «تذكير» بالشات ناقصة');
    ok('«تذكير» متاح كأمر /tickets remind وكلمة بالشات داخل الروم');
  }

  console.log('\n═══ ٨) إضافة أعضاء للتذكرة: قائمة الأعضاء صارت تشتغل ═══');
  {
    const icSrc = fs.readFileSync(path.join(__dirname, 'src', 'events', 'interactionCreate.js'), 'utf8');
    assert.ok(/isAnySelectMenu/.test(icSrc), 'الفحص isAnySelectMenu ناقص — قائمة الأعضاء بتضل معطّلة');
    assert.ok(/action === 'adduser'/.test(icSrc), 'معالج إضافة العضو ناقص');
    assert.ok(/for \(const id of selected\)/.test(icSrc), 'لازم يضيف أكثر من عضو مرة وحدة');
    ok('قائمة الأعضاء (UserSelect) صارت تُلتقط + إضافة أكثر من عضو (حتى ٥)');

    /* محاكاة كاملة لتفاعل القائمة عبر معالج الأحداث الحقيقي */
    const interactionCreate = require('./src/events/interactionCreate');
    const ticket = db.createTicket({ guildId: GUILD, userId: '200000000000000010', channelId: '502000000000000502', type: 'support' });
    const edits = [];
    const roomMsgs = [];
    const overwrites = [];
    const interaction = {
      customId: `ticket:adduser:${ticket.id}`,
      channelId: '502000000000000502',
      guildId: GUILD,
      values: ['300000000000000011', '300000000000000012'],
      user: { id: '910000000000000010', tag: 'Mod#0001', username: 'Mod', send: async () => ({}) },
      member: { permissions: { has: () => true } },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => false,
      // ⚠️ هذا اللي كان يكسر الأمر قبل: القائمة من نوع UserSelect فما تُعدّ StringSelect
      isAnySelectMenu: () => true,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => true,
      isModalSubmit: () => false,
      guild: { id: GUILD, members: { cache: new Map() } },
      channel: {
        id: '502000000000000502',
        permissionOverwrites: { edit: async (id) => { overwrites.push(id); return {}; } },
        send: async (p) => { roomMsgs.push(p); return p; },
      },
      deferred: false,
      replied: false,
      reply: async (p) => { edits.push(p); return p; },
      followUp: async (p) => { edits.push(p); return p; },
      editReply: async (p) => { edits.push(p); return p; },
      fetchReply: async () => ({ id: '1' }),
    };
    const client = { user: { id: '100000000000000002' }, commands: new Map() };
    await interactionCreate.execute(client, interaction);
    assert.deepStrictEqual(overwrites, ['300000000000000011', '300000000000000012'], 'ما عطى صلاحيات العضوين: ' + overwrites);
    assert.ok(edits.length && /تمت إضافة/.test(JSON.stringify(edits)), 'ما رجّع تأكيد الإضافة: ' + JSON.stringify(edits).slice(0, 200));
    assert.ok(roomMsgs.length, 'ما انبعت سطر الإضافة داخل غرفة التذكرة');
    ok('محاكاة اضغط «إضافة عضو»: العضوين انضافوا للتذكرة (صلاحيات + سطر بالروم + تأكيد)');
  }

  console.log('\n═══ ٩) رسالة فتح التذكرة كلها قابلة للتعديل من الموقع ═══');
  {
    resetSettings({
      tickets: {
        enabled: true,
        categoryId: '700000000000000007',
        types: [{ id: 'support', label: 'دعم', emoji: '🎫' }],
        /* نفحص مسار النص أولًا (لو المدير طفّى الصورة) */
        openImageOnly: false,
        openTitle: '🎫 تذكرة {id} — {type}',
        openDescription: 'هلا {user} — اشرح مشكلتك بالتفصيل.',
        openIntro: 'اكتب كل التفاصيل مرة وحدة حتى نساعدك بسرعة.',
        openFields: true,
        openFooter: 'فريق {server}',
      },
    });

    const sentRooms = [];
    let roomSeq = 503;
    const guild = {
      id: GUILD,
      name: 'Test Server',
      roles: { everyone: { id: GUILD } },
      channels: {
        cache: new Map([['700000000000000007', { id: '700000000000000007', type: 4 }]]),
        create: async () => ({
          id: `5030000000000005${roomSeq++}`,
          send: async (p) => { sentRooms.push(p); return p; },
          permissionOverwrites: { edit: async () => ({}) },
        }),
      },
    };
    const user = { id: '200000000000000010', username: 'Ahmed', tag: 'Ahmed#0001' };
    const created = await tickets.createTicket({ user: { id: '100000000000000002' } }, guild, user, 'support');
    assert.strictEqual(created.ok, true, 'فتح التذكرة فشل: ' + created.reason);
    const payload = sentRooms[0];
    assert.ok(payload, 'ما انبعتت رسالة فتح في الروم');
    const data = payload.embeds?.[0]?.data || payload.embeds?.[0] || {};
    assert.strictEqual(data.title, `🎫 تذكرة ${created.ticket.id} — دعم`, 'العنوان المخصّص ما انطبق: ' + data.title);
    assert.ok(String(data.description).includes('هلا <@200000000000000010>'), 'الوصف المخصّص ما انطبق');
    assert.ok(String(data.description).includes('اكتب كل التفاصيل'), 'السطر الإضافي ناقص');
    assert.strictEqual(data.footer?.text, 'فريق Test Server', 'التذييل المخصّص ما انطبق');
    assert.strictEqual((data.fields || []).length, 3, 'الحقول لازم تكون ٣');
    ok('نص فتح التذكرة كامل من الإعدادات: عنوان «تذكرة 1 — دعم» + وصف + سطر + ٣ حقول + تذييل');

    /* لو المدير طفى الحقول */
    resetSettings({ tickets: { ...db.getGuildSettings(GUILD).tickets, openFields: false } });
    sentRooms.length = 0;
    const second = await tickets.createTicket({ user: { id: '100000000000000002' } }, guild, { id: '200000000000000099', username: 'Sara', tag: 'Sara#0001' }, 'support');
    assert.strictEqual(second.ok, true, 'فتح تذكرة ثانية فشل');
    const data2 = sentRooms[0].embeds?.[0]?.data || {};
    assert.strictEqual((data2.fields || []).length, 0, 'إطفاء الحقول ما اشتغل');
    ok('مفتاح «إظهار الحقول» يطفي حقول رسالة الفتح');

    /* الوضع الافتراضي الجديد: رسالة الفتح **صورة بلا نص** */
    resetSettings({
      tickets: {
        ...db.getGuildSettings(GUILD).tickets,
        openImageOnly: true,
        openImage: 'src/web/public/assets/tickets-panel.webp',
      },
    });
    sentRooms.length = 0;
    const third = await tickets.createTicket({ user: { id: '100000000000000002' } }, guild, { id: '200000000000000077', username: 'Nora', tag: 'Nora#0001' }, 'support');
    assert.strictEqual(third.ok, true, 'فتح تذكرة ثالثة فشل');
    const payload3 = sentRooms[0];
    const data3 = payload3.embeds?.[0]?.data || {};
    assert.ok(String(data3.image?.url || '').startsWith('attachment://'), 'رسالة الفتح لازم تكون صورة: ' + data3.image?.url);
    assert.ok(!data3.title && !data3.description && !data3.footer, 'رسالة الفتح صورة فقط — بلا نص');
    assert.strictEqual((payload3.files || []).length, 1, 'ملف الصورة ما انرفق برسالة الفتح');
    assert.ok(String(payload3.content).includes('<@200000000000000077>'), 'منشن صاحب التذكرة انشال');
    const openButtons = payload3.components?.[0]?.components || [];
    assert.strictEqual(openButtons.length, 4, 'أزرار التحكّم ناقصة من رسالة الفتح');
    ok('رسالة فتح التذكرة صورة بلا نص + المنشن وأزرار التحكّم (استلام · إغلاق · أرشيف · إضافة عضو)');

    const ticketsSrc = fs.readFileSync(path.join(__dirname, 'src', 'systems', 'tickets.js'), 'utf8');
    assert.ok(/openTitle/.test(ticketsSrc) && /openDescription/.test(ticketsSrc), 'رسالة الفتح ما صارت تُبنى من الإعدادات');
    assert.ok(/openFooter/.test(ticketsSrc) && /openFields/.test(ticketsSrc), 'التذييل/الحقول ما صارت قابلة للتعديل');
    const appSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const key of ['tickets.openTitle', 'tickets.openDescription', 'tickets.openIntro', 'tickets.openFields', 'tickets.openFooter']) {
      assert.ok(appSrc.includes(key), `حقل ${key} ناقص من اللوحة`);
    }
    for (const key of ['tickets.openImage', 'tickets.openImageOnly', 'tickets.panelImage', 'tickets.panelFooterImage', 'tickets.panelPlaceholder']) {
      assert.ok(appSrc.includes(key), `حقل الصور الجديد ${key} ناقص من اللوحة`);
    }
    ok('اللوحة فيها: صورة اللوحة + الصورة الزخرفية + صورة رسالة الفتح — وكذلك العنوان والوصف والسطر والحقول والتذييل');
  }

  console.log('\n═══ ١٠) صفحة «ردود أوامر» في الموقع + مسار الـ API ═══');
  {
    const appSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'public', 'app.js'), 'utf8');
    assert.ok(/commandReplies: \{/.test(appSrc), 'قسم «ردود أوامر» ناقص من اللوحة');
    assert.ok(/label: 'ردود أوامر'/.test(appSrc), 'اسم الصفحة لازم يكون «ردود أوامر»');
    assert.ok(/commandReplies: 'messageEdit'/.test(appSrc), 'أيقونة الصفحة ناقصة');
    assert.ok(/command-replies/.test(appSrc), 'اللوحة ما تتصل بمسار ردود الأوامر');
    assert.ok(/نص الرد/.test(appSrc) && /شكل الرد/.test(appSrc), 'حقول تعديل الرد ناقصة');

    const apiSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(/command-replies/.test(apiSrc), 'مسار /command-replies ناقص من الـ API');
    assert.ok(/replyFormat\.preview/.test(apiSrc), 'المعاينة الحيّة ناقصة من الـ API');
    assert.ok(/canAccess/.test(apiSrc.slice(apiSrc.indexOf('command-replies'), apiSrc.indexOf('command-replies') + 2000)), 'المسار بلا حماية صلاحيات');
    ok('صفحة «ردود أوامر» + مسار API للمعاينة (محمي بصلاحيات السيرفر)');
  }

  console.log(`\n🎉 f42 كامل: التوب (داي/ويك/منث) · ٣ حالات خاص · تذكير · تذاكر · ردود قابلة للتعديل (${checks} فحوص)\n`);
}

main().catch((err) => {
  console.error('\n❌', err.message);
  console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
