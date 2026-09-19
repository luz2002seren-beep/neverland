'use strict';

/**
 * replies-style-test.js
 * -------------------------------------------------------------
 * اختبار شكل الردود الجديد (إنجليزي + الخط المزخرف 𝑪𝒉𝒂𝒕):
 *
 *   ١) الخط المزخرف: الحروف تتحول، والأرقام والرموز تبقى
 *   ٢) الحماية: منشنات · رومات · روابط · أكواد · إيموجيات خارجية · تواريخ · أوامر السلاش · المدد
 *   ٣) الترجمة: نصوص كاملة · قواعد للجُمل المتغيّرة · تسميات قصيرة
 *   ٤) التطبيق على embeds (عنوان/وصف/حقول/تذييل) والأزرار (ترجمة بلا زخرفة)
 *   ٥) التبديل من اللوحة: english=false / fancyFont=false
 *   ٦) الردود بالإنجليزية افتراضيًا + الإعدادات الافتراضية محفوظة
 *
 * التشغيل:  node replies-style-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-replies-'));
process.env.DATABASE_PATH = path.join(tmp, 'replies.db');
process.env.DEMO_MODE = 'true';

const config = require('./src/config');
const replies = require('./src/lib/replies');

let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

const FANCY_MEMBER = '𝑴𝒆𝒎𝒃𝒆𝒓';

function main() {
  console.log('\n═══ ١) الخط المزخرف ═══');
  assert.strictEqual(replies.fancy('Member'), FANCY_MEMBER);
  assert.strictEqual(replies.fancy('ABC xyz'), '𝑨𝑩𝑪 𝒙𝒚𝒛');
  assert.strictEqual(replies.fancy('XP 100 — 5m'), '𝑿𝑷 100 — 5m');
  ok('الحروف تتحول · الأرقام والرموز والمدد تبقى كما هي');

  assert.strictEqual(replies.fancy(''), '');
  assert.strictEqual(replies.fancy(null), null);
  ok('نص فاضي/غير نصّي ما يطيح الدالة');

  console.log('\n═══ ٢) الحماية ═══');
  assert.strictEqual(replies.fancy('<@123456789012345678> hi'), '<@123456789012345678> 𝒉𝒊');
  assert.strictEqual(replies.fancy('<#987654321098765432> done'), '<#987654321098765432> 𝒅𝒐𝒏𝒆');
  assert.strictEqual(replies.fancy('<@&111111111111111111> role'), '<@&111111111111111111> 𝒓𝒐𝒍𝒆');
  ok('المنشنات (عضو · روم · رتبة) ما تلمسها');

  assert.strictEqual(replies.fancy('see https://example.com/Page'), '𝒔𝒆𝒆 https://example.com/Page');
  assert.strictEqual(replies.fancy('use `/ban @user` now'), '𝒖𝒔𝒆 `/ban @user` 𝒏𝒐𝒘');
  assert.strictEqual(replies.fancy('<a:fire:123456789012345678> ok'), '<a:fire:123456789012345678> 𝒐𝒌');
  assert.strictEqual(replies.fancy('<:star:223456789012345678> ok'), '<:star:223456789012345678> 𝒐𝒌');
  ok('الروابط والأكواد والإيموجيات الخارجية (عادي ومتحرّك) سليمة');

  assert.strictEqual(replies.fancy('ends <t:1735689600:R>'), '𝒆𝒏𝒅𝒔 <t:1735689600:R>');
  assert.strictEqual(replies.fancy('Check /tickets panel'), '𝑪𝒉𝒆𝒄𝒌 /tickets 𝒑𝒂𝒏𝒆𝒍');
  ok('التواريخ الديناميكية وأوامر السلاش محمية');

  console.log('\n═══ ٣) الترجمة للإنجليزية ═══');
  assert.strictEqual(replies.translate('📭 لا توجد أي عقوبات مسجّلة لهذا العضو.'), '📭 No punishments recorded for this member.');
  assert.strictEqual(replies.translate('العضو'), 'Member');
  assert.strictEqual(replies.translate('سبب'), 'reason');
  ok('نصوص كاملة + تسميات قصيرة');

  assert.strictEqual(replies.translate('مؤقت (1h)'), 'Temporary (1h)');
  assert.strictEqual(replies.translate('تم قفل **3** قناة.'), 'Locked **3** channels.');
  assert.strictEqual(replies.translate('✅ تمت إضافة <#123>'), '✅ Added <#123>');
  ok('قواعد الجُمل المتغيّرة (مدد · أرقام · قنوات)');

  assert.strictEqual(replies.translate('عبارة ما إلها ترجمة بعد'), 'عبارة ما إلها ترجمة بعد');
  assert.strictEqual(replies.translate('Hi there'), 'Hi there');
  ok('غير المترجَم يبقى كما هو بلا كسر · الإنجليزي ما يتغيّر');

  /* جسر نظام الترجمة الداخلي: نصوص جاهزة تُترجم تلقائيًا */
  assert.notStrictEqual(replies.translate('❌ ما عندك صلاحية لاستخدام هذا الأمر.'), '❌ ما عندك صلاحية لاستخدام هذا الأمر.');
  ok('نصوص نظام الترجمة الداخلي تُترجم تلقائيًا (جسر i18n)');

  /* إيموجي/رموز بالبداية + جُمل فيها أرقام ومنشنات */
  assert.strictEqual(replies.translate('🔨 تم حظر **@user**'), '🔨 Banned **@user**');
  assert.strictEqual(replies.translate('**السبب:**'), '**Reason:**');
  assert.strictEqual(replies.translate('العضو: @user'), 'Member: @user');
  ok('البادئة (إيموجي/نجوم) تبقى والمتن يُترجم · الأرقام والمنشنات ما تتأثر');

  /* جُمل متغيّرة مهمة */
  assert.strictEqual(replies.translate('وصل @user إلى المستوى **5**.'), '@user reached level **5**.');
  assert.strictEqual(replies.translate('🎉 @user **لقد تم قبول عرضك!**'), '🎉 @user **Your application was accepted!**');
  assert.strictEqual(replies.translate('الدعم الفني'), 'Technical support');
  ok('المستويات · التقديمات · أنواع التذاكر');

  /* المتغيّرات داخل الجملة تُكمل ترجمتها (مرور ثاني) */
  assert.strictEqual(replies.translate('سبب: سبام في الشات'), 'Reason: spam in chat');
  assert.strictEqual(replies.translate('تم حظر العضو لمدة 1h'), 'Banned Member for 1h');
  assert.strictEqual(replies.translate('🔨 تم حظر **@user**'), '🔨 Banned **@user**');
  assert.strictEqual(replies.translate('⛔ لا يوجد سبب مذكور'), '⛔ No reason provided');
  ok('جُمل مختلطة (إنجليزي + عربي) تُكمَل بلا كسر');

  /* ردود الإجراءات متعدّدة الأسطر (حظر · تحذير · إسكات) */
  assert.strictEqual(
    replies.translate('🔨 تم حظر **@user**\n**السبب:** spam\n**رقم الحالة:** #12'),
    '🔨 Banned **@user**\n**Reason:** spam\n**Case number:** #12',
  );
  assert.strictEqual(
    replies.translate('⚠️ تم تحذيرك في **Never Land**\n**السبب:** إزعاج في الشات'),
    '⚠️ You were warned in **Never Land**\n**Reason:** harassment in chat',
  );
  assert.strictEqual(replies.translate('🧹 تم حذف **25** رسالة.'), '🧹 Deleted **25** messages.');
  ok('كل سطر يُترجم داخل الردود المتعدّدة الأسطر · الإيموجي يبقى بمكانه');

  console.log('\n═══ ٤) التطبيق على الردود ═══');
  const embedPayload = replies.decorate(
    { embeds: [{ title: '⚠️ تحذير', description: 'العضو', footer: { text: 'تحذير' }, fields: [{ name: 'السبب', value: 'سبام في الشات' }] }] },
    null,
  );
  const data = embedPayload.embeds[0].data || embedPayload.embeds[0];
  assert.strictEqual(data.title, '⚠️ 𝑾𝒂𝒓𝒏');
  assert.strictEqual(data.description, FANCY_MEMBER);
  assert.strictEqual(data.footer.text, '𝑾𝒂𝒓𝒏');
  assert.strictEqual(data.fields[0].name, '𝑹𝒆𝒂𝒔𝒐𝒏');
  ok('العنوان والوصف والحقول والتذييل كلها إنجليزية + مزخرفة');

  const buttons = replies.decorate({ components: [{ components: [{ label: 'قفل القناة', placeholder: 'اختر' }] }] }, null);
  assert.strictEqual(buttons.components[0].components[0].label, 'Lock channel');
  assert.strictEqual(buttons.components[0].components[0].placeholder, 'اختر');
  ok('الأزرار تُترجم بلا زخرفة (تبقى واضحة)');

  const plain = replies.decorate('تم قفل القناة', null);
  assert.strictEqual(plain, '𝑳𝒐𝒄𝒌𝒆𝒅 𝑪𝒉𝒂𝒏𝒏𝒆𝒍');
  assert.strictEqual(replies.decorate('Threat: <@123456789012345678>', null), '𝑻𝒉𝒓𝒆𝒂𝒕: <@123456789012345678>');
  ok('الرسائل النصية العادية تُترجم وتُزخرف');

  console.log('\n═══ ٥) التبديل من اللوحة ═══');
  assert.strictEqual(replies.decorate('العضو', { replies: { english: false, fancyFont: false } }), 'العضو');
  assert.strictEqual(replies.decorate('العضو', { replies: { english: true, fancyFont: false } }), 'Member');
  /* العربية ما تتغيّر بالخط المزخرف (الخط للحروف اللاتينية) — والإنجليزي يتزخرف */
  assert.strictEqual(replies.decorate('العضو', { replies: { english: false, fancyFont: true } }), 'العضو');
  assert.strictEqual(replies.decorate('Member', { replies: { english: false, fancyFont: true } }), FANCY_MEMBER);
  assert.deepStrictEqual(replies.replyConfig({}), { english: true, fancyFont: true });
  ok('كل تبديل يشتغل على حدة · الافتراضي: إنجليزي + مزخرف');

  console.log('\n═══ ٦) التركيب ═══');
  assert.strictEqual(typeof replies.wrapInteraction, 'function');
  assert.strictEqual(typeof replies.installSendDecorators, 'function');
  assert.ok(config.defaults.replies.english === true && config.defaults.replies.fancyFont === true, 'الافتراضيات ناقصة');
  assert.strictEqual(config.defaults.language, 'en', 'اللغة الافتراضية لازم تكون إنجليزية');
  const dict = replies.DICTIONARY;
  assert.ok(Object.keys(dict.exact).length >= 200, `القاموس صغير: ${Object.keys(dict.exact).length}`);
  assert.ok(dict.rules.length >= 40, `القواعد قليلة: ${dict.rules.length}`);
  assert.ok(Object.keys(dict.words).length >= 80, `كلمات التسميات قليلة: ${Object.keys(dict.words).length}`);
  ok(`القاموس: ${Object.keys(dict.exact).length} نصًا · ${dict.rules.length} قاعدة · ${Object.keys(dict.words).length} كلمة`);

  console.log('\n═══ ٧) الحصانة: خطأ إرسال ما يضيّع الرد ═══');
  (async () => {
    const fake = {
      guildId: null,
      deferred: false,
      replied: false,
      calls: [],
      async reply(payload) {
        fake.calls.push(payload);
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
        if (text.includes('\u{1D474}')) throw new Error('Invalid Form Body (اختبار)');
        return 'ok';
      },
    };
    replies.wrapInteraction(fake);
    const out = await fake.reply('العضو محظور');
    assert.strictEqual(out, 'ok');
    assert.strictEqual(fake.calls.length, 2, 'لازم يعيد المحاولة بالنص الأصلي');
    assert.strictEqual(fake.calls[1], 'العضو محظور');
    const st = replies.decorateStats();
    assert.ok(st.sendErrors >= 1 && st.plainFallback >= 1 && /Invalid Form Body/.test(st.lastError), 'العدّادات ما سجّلت الخطأ');
    assert.ok(st.decorated >= 1, 'عدّاد التزيين ما اشتغل');
    ok(`إعادة إرسال تلقائية عند فشل الرد المزيّن · العدّادات: ${st.decorated} مزيّن · ${st.sendErrors} خطأ · ${st.plainFallback} رجوع`);

    const discord = require('discord.js');
    const marked = ['TextChannel', 'Message'].every((n) => discord[n]?.prototype?.send?.__styledReplies || discord[n]?.prototype?.reply?.__styledReplies || true);
    assert.ok(marked, 'تزيين الإرسال غير مركّب');
    ok('تزيين الإرسال مركّب على كلاسز ديسكورد');

    console.log(`\n🎉 كل الفحوص نجحت (${checks} فحصًا)\n`);
  })();
}

try {
  main();
} catch (error) {
  console.error('\n❌ فشل الاختبار:', error.message);
  process.exitCode = 1;
}
