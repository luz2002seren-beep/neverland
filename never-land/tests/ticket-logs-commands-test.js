'use strict';

/**
 * ticket-logs-commands-test.js
 * -------------------------------------------------------------
 * تشغيل حقيقي لأوامر التذاكر والسجلات الجديدة (بلا ديسكورد — تفاعل وهمي):
 *
 *   /tickets button  : تغيير النص + الإيموجي (عادي/ديسكورد متحرّك) + اللون + الاسترجاع
 *   /tickets buttons : عرض شكل الأزرار الحالية
 *   /logs eventchannel : ربط «حظر عضو» بروم لحاله و«طرد عضو» بروم ثاني
 *   /logs groupchannel : ربط مجموعة الأعضاء بروم واحد
 *   /logs channels     : خريطة القنوات (أي حدث ← أي روم)
 *   + الحمايات: حدث غير معروف · قناة بلا صلاحيات
 *
 * التشغيل:  node ticket-logs-commands-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-cmdsim-'));
process.env.DATABASE_PATH = path.join(tmp, 'sim.db');
process.env.DEMO_MODE = 'true';

const db = require('../src/database');
const ticketsCommand = require('../src/commands/config/tickets');
const logsCommand = require('../src/commands/config/logs');

const GUILD = 'guild-cmd-sim';
let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

/** قناة وهمية (للاستخدام كخيار «القناة» في الأوامر) */
function fakeRoom(id, name, perms = true) {
  return {
    id,
    name,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => perms }),
    toString: () => `#${name}`,
  };
}

/** تفاعل وهمي يعرض الخيارات ويعتقل الرد */
function fakeInteraction(sub, options = {}) {
  const replyPayload = { value: null };
  const membersMe = { id: 'bot-1', permissions: { has: () => true } };
  const guild = {
    id: GUILD,
    members: { me: membersMe },
    channels: { cache: new Map() },
  };
  const channel = fakeRoom('chan-x', 'لوق-تجريبي');
  guild.channels.cache.set(channel.id, channel);

  const interaction = {
    guildId: GUILD,
    guild,
    channel,
    user: { id: 'admin-1', tag: 'admin#1', toString: () => '@admin' },
    options: {
      getSubcommand: () => sub,
      getString: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getChannel: (name) => options[name] ?? null,
      getRole: (name) => options[name] ?? null,
    },
    reply: async (payload) => {
      replyPayload.value = payload;
      return payload;
    },
    editReply: async (payload) => {
      replyPayload.value = payload;
      return payload;
    },
    deferReply: async () => {},
  };
  return { interaction, replyPayload, channel };
}

/** نص الخطأ/التأكيد المرسل في الرد (يقبل الغلاف أو الرد نفسه) */
const replyText = (raw) => {
  const payload = raw && Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : raw;
  const embed = payload?.embeds?.[0];
  const data = embed?.data ?? embed ?? {};
  return `${data.title || ''} ${data.description || ''} ${(data.fields || []).map((f) => `${f.name}: ${f.value}`).join(' ')}`;
};

async function main() {
  console.log('\n═══ /tickets button ═══');
  const t1 = fakeInteraction('button', { الزر: 'close', نص: 'سكّر التذكرة', إيموجي: '<a:fire:123456789012345678>', لون: 'Danger' });
  await ticketsCommand.run(null, t1.interaction, 'ar');
  const saved1 = db.getGuildSettings(GUILD).tickets.buttons.close;
  assert.strictEqual(saved1.label, 'سكّر التذكرة');
  assert.strictEqual(saved1.emoji, '<a:fire:123456789012345678>');
  assert.strictEqual(saved1.style, 'Danger');
  assert.ok(replyText(t1.replyPayload).includes('سكّر التذكرة'), 'الرد يوضّح النص الجديد');
  assert.ok(replyText(t1.replyPayload).includes('خارجي'), 'الرد يوضّح أن الإيموجي لديسكورد');
  ok('نص + إيموجي متحرّك من ديسكورد + لون — ويتحفظون صح');

  const built = require('../src/systems/tickets').ticketControls('1', false, db.getGuildSettings(GUILD).tickets).toJSON().components;
  assert.strictEqual(built[1].label, 'سكّر التذكرة');
  assert.strictEqual(built[1].emoji.id, '123456789012345678');
  assert.strictEqual(built[1].emoji.animated, true);
  assert.strictEqual(built[1].style, 4);
  ok('الزر الحقيقي في ديسكورد استلم النص والإيموجي المتحرّك واللون');

  const t2 = fakeInteraction('button', { الزر: 'claim', إيموجي: 'حذف' });
  await ticketsCommand.run(null, t2.interaction, 'ar');
  assert.strictEqual(db.getGuildSettings(GUILD).tickets.buttons.claim.emoji, '');
  const built2 = require('../src/systems/tickets').ticketControls('1', false, db.getGuildSettings(GUILD).tickets).toJSON().components;
  assert.strictEqual(built2[0].emoji, undefined);
  assert.strictEqual(built2[0].label, 'استلام');
  ok('«حذف» يشيل الإيموجي ويرجّع النص الافتراضي');

  const t3 = fakeInteraction('button', { الزر: 'close', الافتراضي: true });
  await ticketsCommand.run(null, t3.interaction, 'ar');
  const back = db.getGuildSettings(GUILD).tickets.buttons.close;
  assert.strictEqual(back.label, 'إغلاق');
  assert.strictEqual(back.emoji, '🔒');
  assert.strictEqual(back.style, 'Danger');
  ok('الاسترجاع يرجّع الزر الافتراضي كاملًا');

  const t4 = fakeInteraction('button', { الزر: 'ghost', نص: 'x' });
  await ticketsCommand.run(null, t4.interaction, 'ar');
  assert.ok(replyText(t4.replyPayload).includes('غير معروف'));
  ok('حماية: زر غير معروف ⇒ رسالة واضحة بلا خطأ');

  const t5 = fakeInteraction('buttons');
  await ticketsCommand.run(null, t5.interaction, 'ar');
  assert.ok(replyText(t5.replyPayload).includes('زر الاستلام'));
  assert.ok(replyText(t5.replyPayload).includes('زر الإغلاق'));
  ok('/tickets buttons يعرض الخمسة أزرار بحالتها');

  console.log('\n═══ /logs eventchannel ═══');
  const banRoom = fakeRoom('chan-ban', 'لوق-الحظر');
  const kickRoom = fakeRoom('chan-kick', 'لوق-الطرد');
  const noPermsRoom = fakeRoom('chan-locked', 'لوق-مقفول', false);

  const l1 = fakeInteraction('eventchannel', { الحدث: 'memberBan', القناة: banRoom });
  await logsCommand.run(null, l1.interaction, 'ar');
  const l2 = fakeInteraction('eventchannel', { الحدث: 'memberKick', القناة: kickRoom });
  await logsCommand.run(null, l2.interaction, 'ar');
  const logsCfg = db.getGuildSettings(GUILD).logs;
  assert.strictEqual(logsCfg.channels.memberBan, banRoom.id);
  assert.strictEqual(logsCfg.channels.memberKick, kickRoom.id);
  assert.strictEqual(logsCfg.enabled, true);
  ok('«حظر عضو» في روم · «طرد عضو» في روم ثاني — بانفصال تام');

  const l3 = fakeInteraction('eventchannel', { الحدث: 'nope' });
  await logsCommand.run(null, l3.interaction, 'ar');
  assert.ok(replyText(l3.replyPayload).includes('غير معروف'));
  ok('حماية: حدث غير معروف ⇒ رسالة واضحة');

  const l4 = fakeInteraction('eventchannel', { الحدث: 'messageDelete', القناة: noPermsRoom });
  await logsCommand.run(null, l4.interaction, 'ar');
  assert.ok(replyText(l4.replyPayload).includes('صلاحيات'), 'رسالة الصلاحيات ما ظهرت');
  assert.notStrictEqual(db.getGuildSettings(GUILD).logs.channels.messageDelete, noPermsRoom.id);
  ok('حماية: قناة بلا صلاحيات ⇒ ما تُربط');

  const l5 = fakeInteraction('eventchannel', { الحدث: 'memberKick' });
  await logsCommand.run(null, l5.interaction, 'ar');
  assert.ok(!db.getGuildSettings(GUILD).logs.channels.memberKick);
  assert.ok(replyText(l5.replyPayload).includes('إلغاء'));
  ok('بدون قناة ⇒ إلغاء ربط الحدث');

  console.log('\n═══ /logs groupchannel و /logs channels ═══');
  const membersRoom = fakeRoom('chan-members', 'لوق-الأعضاء');
  const l6 = fakeInteraction('groupchannel', { المجموعة: 'members', القناة: membersRoom });
  await logsCommand.run(null, l6.interaction, 'ar');
  assert.strictEqual(db.getGuildSettings(GUILD).logs.channelsByGroup.members, membersRoom.id);
  assert.ok(replyText(l6.replyPayload).includes('11'), 'الرد يذكر عدد أحداث المجموعة');
  ok('روم واحد لمجموعة الأعضاء (11 حدثًا)');

  const l7 = fakeInteraction('channels');
  await logsCommand.run(null, l7.interaction, 'ar');
  const mapText = replyText(l7.replyPayload);
  assert.ok(mapText.includes('أحداث لها روم خاص'), 'الخريطة فيها ملخّص');
  assert.ok(mapText.includes('حظر عضو') && mapText.includes('طرد عضو'), 'الخريطة تعرض الأحداث');
  ok('/logs channels يعرض خريطة (حدث ← روم)');

  console.log('\n═══ الكتالوج والأوامر ═══');
  const catalogModule = require('../src/data/commandCatalog');
  const catalog = catalogModule.COMMANDS;
  assert.ok(catalog.tickets.usage.some((u) => u.includes('tickets button')), 'شرح /tickets button ناقص');
  assert.ok(catalog.logs.usage.some((u) => u.includes('logs eventchannel')), 'شرح /logs eventchannel ناقص');
  const ticketSubs = ticketsCommand.data.toJSON().options.map((o) => o.name);
  assert.ok(ticketSubs.includes('button') && ticketSubs.includes('buttons'), 'الأوامر الفرعية للتذاكر ناقصة');
  const logSubs = logsCommand.data.toJSON().options.map((o) => o.name);
  for (const name of ['eventchannel', 'groupchannel', 'channels']) {
    assert.ok(logSubs.includes(name), `الأمر الفرعي /logs ${name} ناقص`);
  }
  ok('الأوامر مسجّلة في السجل + موجودة في مكتبة الشرح');

  console.log(`\n🎉 كل الفحوص نجحت (${checks} فحصًا)\n`);
}

main().catch((error) => {
  console.error('\n❌ فشل الاختبار:', error.message);
  process.exitCode = 1;
});
