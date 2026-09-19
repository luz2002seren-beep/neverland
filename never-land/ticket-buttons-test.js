'use strict';

/**
 * ticket-buttons-test.js
 * -------------------------------------------------------------
 * اختبار التحكم الكامل بأزرار التذاكر (نص + إيموجي + لون)، بلا ديسكورد حقيقي:
 *
 *   ١) الافتراضيات: خمسة أزرار (استلام · مستلَمة · إغلاق · أرشيف · إضافة عضو)
 *   ٢) تخصيص كل زر: النص والإيموجي (عادي أو خارجي) واللون — يُطبَّق على الزر الحقيقي
 *   ٣) حماية: نص فارغ ⇒ الافتراضي · نص طويل ⇒ ٨٠ حرفًا · لون غلط ⇒ الافتراضي
 *   ٤) إيموجي فارغ ⇒ زر بلا إيموجي (بدون أي خطأ)
 *   ٥) زر «مستلَمة» بعد الاستلام + تعطيل زر الاستلام
 *   ٦) الحفظ في قاعدة البيانات: دمج جزئي (زر واحد يتغيّر والباقي يبقى)
 *   ٧) لوحة التذاكر: نص وإيموجي ولون زر كل نوع + القائمة المنسدلة
 *
 * التشغيل:  node ticket-buttons-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-tkb-'));
process.env.DATABASE_PATH = path.join(tmp, 'buttons.db');
process.env.DEMO_MODE = 'true';

const config = require('./src/config');
const db = require('./src/database');
const tickets = require('./src/systems/tickets');

const GUILD = 'guild-btn-test';
let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

/** أزرار الصف كـ JSON (بدون الاعتماد على أي اتصال بديسكورد) */
const rowJson = (row) => row.toJSON().components;
const custom = (id, animated = false) => `<${animated ? 'a' : ''}:myemoji:${id}>`;

function main() {
  console.log('\n═══ ١) الافتراضيات ═══');
  const defaults = config.defaults.tickets.buttons;
  assert.deepStrictEqual(Object.keys(defaults), ['claim', 'claimDone', 'close', 'transcript', 'addMember']);
  assert.deepStrictEqual(tickets.BUTTON_KEYS, Object.keys(defaults));
  defaults.claim.emoji && defaults.close.label && defaults.transcript.style;
  ok('خمسة أزرار افتراضية مع نص وإيموجي ولون');
  assert.strictEqual(tickets.buttonConfig(null, 'claim').label, 'استلام');
  assert.strictEqual(tickets.buttonConfig(null, 'close').emoji.name, '🔒');
  assert.strictEqual(tickets.buttonConfig(null, 'claimDone').styleName, 'Secondary');
  ok('بلا إعدادات محفوظة ⇒ الأزرار الافتراضية');

  console.log('\n═══ ٢) تخصيص كامل لكل زر ═══');
  const cfg = {
    buttons: {
      claim: { label: 'خذ التذكرة', emoji: '🤝', style: 'Primary' },
      claimDone: { label: 'معك', emoji: '', style: 'Success' },
      close: { label: 'سكّرها', emoji: custom('123456789012345678'), style: 'Danger' },
      transcript: { label: 'الملف', emoji: custom('223456789012345678', true), style: 'Secondary' },
      addMember: { label: 'ضيف عضو', emoji: '➕', style: 'Success' },
    },
  };

  const fresh = rowJson(tickets.ticketControls('55', false, cfg));
  assert.strictEqual(fresh.length, 4);
  assert.strictEqual(fresh[0].label, 'خذ التذكرة');
  assert.strictEqual(fresh[0].emoji.name, '🤝');
  assert.strictEqual(fresh[0].style, 1); // Primary
  ok('زر الاستلام: نص + إيموجي + لون مخصّص');

  assert.strictEqual(fresh[1].label, 'سكّرها');
  assert.strictEqual(fresh[1].emoji.id, '123456789012345678');
  assert.strictEqual(fresh[1].emoji.animated, false);
  assert.strictEqual(fresh[1].style, 4); // Danger
  ok('زر الإغلاق بإيموجي خارجي ثابت');

  assert.strictEqual(fresh[2].emoji.id, '223456789012345678');
  assert.strictEqual(fresh[2].emoji.animated, true);
  ok('زر الأرشيف بإيموجي خارجي متحرك (a:)');

  assert.strictEqual(fresh[0].custom_id, 'ticket:claim:55');
  assert.strictEqual(fresh[3].custom_id, 'ticket:addmember:55');
  ok('الوظائف محفوظة كما هي (استلام · إغلاق · أرشيف · إضافة عضو)');

  console.log('\n═══ ٣) الحمايات ═══');
  const weird = tickets.buttonConfig({ buttons: { close: { label: '   ', emoji: '🔥', style: 'Rainbow' } } }, 'close');
  assert.strictEqual(weird.label, 'إغلاق');
  assert.strictEqual(weird.styleName, 'Danger');
  ok('نص فراغ + لون غلط ⇒ يرجع للافتراضي بلا خطأ');

  const longLabel = 'ا'.repeat(120);
  assert.strictEqual(tickets.buttonConfig({ buttons: { close: { label: longLabel } } }, 'close').label.length, 80);
  ok('نص أطول من ٨٠ حرفًا يُقتطع عند حد ديسكورد');

  const noEmoji = rowJson(tickets.ticketControls('9', false, { buttons: { claim: { emoji: '' } } }));
  assert.strictEqual(noEmoji[0].emoji, undefined);
  assert.strictEqual(noEmoji[0].label, 'استلام');
  ok('إيموجي فارغ ⇒ زر بلا إيموجي');

  const broken = tickets.buttonConfig({ buttons: { claim: 'نص عادي بدل كائن' } }, 'claim');
  assert.strictEqual(broken.label, 'استلام');
  ok('قيمة تالفة في قاعدة البيانات ما تطيح البوت');

  console.log('\n═══ ٤) بعد الاستلام ═══');
  const claimed = rowJson(tickets.ticketControls('77', true, cfg));
  assert.strictEqual(claimed[0].label, 'معك');
  assert.strictEqual(claimed[0].disabled, true);
  assert.strictEqual(claimed[0].emoji, undefined);
  ok('الزر يصير «معك» معطّلًا (نفس التخصيص)');

  console.log('\n═══ ٥) الحفظ والدمج الجزئي ═══');
  db.updateGuildSettings(GUILD, { tickets: { enabled: true, categoryId: 'cat-1', buttons: { close: { label: 'سكّر', emoji: custom('323456789012345678'), style: 'Danger' } } } });
  const saved = db.getGuildSettings(GUILD);
  assert.strictEqual(saved.tickets.buttons.close.label, 'سكّر');
  assert.strictEqual(saved.tickets.buttons.close.emoji, custom('323456789012345678'));
  assert.strictEqual(saved.tickets.buttons.claim.label, 'استلام', 'باقي الأزرار ما تتأثر');
  assert.strictEqual(saved.tickets.categoryId, 'cat-1', 'باقي إعدادات التذاكر ما تتأثر');
  assert.deepStrictEqual(saved.tickets.types.map((t) => t.id), ['support', 'verify', 'gift', 'staff']);
  ok('زر واحد يتغيّر والباقي يبقى (دمج جزئي داخل التذاكر)');

  const raw = tickets.buttonRaw(saved.tickets, 'close');
  assert.strictEqual(raw.label, 'سكّر');
  assert.strictEqual(raw.emoji, custom('323456789012345678'));
  ok('buttonRaw يرجّع النص الخام (لعرضه في الرد)');

  /*
   * استرجاع الافتراضي (نفس اللي يصير بالأمر /tickets button الافتراضي:true):
   * كتابة القيم الافتراضية صراحةً — لأن الدمج الجزئي ما يحذف مفاتيح.
   */
  db.updateGuildSettings(GUILD, { tickets: { buttons: { close: { ...tickets.DEFAULT_BUTTONS.close } } } });
  const afterReset = db.getGuildSettings(GUILD);
  assert.strictEqual(afterReset.tickets.buttons.close.label, 'إغلاق');
  assert.strictEqual(afterReset.tickets.buttons.close.emoji, '🔒');
  assert.strictEqual(tickets.buttonRaw(afterReset.tickets, 'close').style, 'Danger');
  ok('الاسترجاع يرجّع الزر الافتراضي (نص + إيموجي + لون)')

  console.log('\n═══ ٦) لوحة التذاكر (أزرار الأنواع والقائمة) ═══');
  const settings = db.getGuildSettings(GUILD);
  settings.tickets.types = [
    { id: 'vip', label: 'دعم VIP', emoji: custom('423456789012345678'), description: 'دعم مميز', buttonStyle: 'Success' },
    { id: 'plain', label: 'استفسار', emoji: '', description: '', buttonStyle: 'Secondary' },
  ];
  settings.tickets.panelMode = 'buttons';
  const guild = { id: GUILD, iconURL: () => null };
  const payloads = tickets.buildPanelPayloads(settings, guild);
  const panel = payloads[payloads.length - 1];
  const panelButtons = rowJson(panel.components[0]);
  assert.strictEqual(panelButtons[0].label, 'دعم VIP');
  assert.strictEqual(panelButtons[0].emoji.id, '423456789012345678');
  assert.strictEqual(panelButtons[0].style, 3); // Success
  assert.strictEqual(panelButtons[1].emoji, undefined);
  ok('زر فتح التذكرة: تخصيص النوع (نص + إيموجي خارجي + لون)');

  const selectPayload = tickets.buildTypeSelect(settings.tickets.types).toJSON();
  assert.strictEqual(selectPayload.components[0].options[0].emoji.id, '423456789012345678');
  assert.strictEqual(selectPayload.components[0].options[1].emoji, undefined);
  ok('القائمة المنسدلة: نفس الإيموجي والتخصيص');

  console.log(`\n🎉 كل الفحوص نجحت (${checks} فحصًا)\n`);
}

try {
  main();
} catch (error) {
  console.error('\n❌ فشل الاختبار:', error.message);
  process.exitCode = 1;
}
