'use strict';

/**
 * logging-channels-test.js
 * -------------------------------------------------------------
 * اختبار «كل حدث لرومه الخاص» في السجلات (بلا ديسكورد حقيقي):
 *
 *   ١) روم الحدث الخاص يتقدّم على كل شي (حظر لحاله · طرد لحاله)
 *   ٢) روم المجموعة يُستخدم للأحداث اللي ما لها روم خاص
 *   ٣) القناة العامة اختيارية — وأخيرة دائمًا
 *   ٤) بلا أي روم ⇒ ما يُرسل شي (ولا يطيح البوت)
 *   ٥) حدث مُطفأ ⇒ ما يُرسل · قناة مستثناة ⇒ ما يُرسل
 *   ٦) روم بلا صلاحيات أو مش قناة نصية ⇒ يروح للبديل الصالح
 *   ٧) كل حدث يروح لرومه الصحيح دفعة واحدة (حظر · طرد · رسائل · دخول)
 *   ٨) الفواصل: العنوان يحمل رمز الحدث واسمه
 *
 * التشغيل:  node logging-channels-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-logch-'));
process.env.DATABASE_PATH = path.join(tmp, 'logs.db');
process.env.DEMO_MODE = 'true';

const db = require('./src/database');
const logging = require('./src/systems/logging');

const GUILD = 'guild-logs-test';
let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

/** قناة وهمية تُسجّل ما يُرسل إليها */
function makeChannel(id, { text = true, perms = true } = {}) {
  const box = { sent: [] };
  return {
    id,
    box,
    isTextBased: () => text,
    permissionsFor: () => ({ has: () => perms }),
    send: async (payload) => {
      box.sent.push(payload);
      return { id: `m-${box.sent.length}` };
    },
  };
}

const bot = { id: 'bot-1' };
const guild = { id: GUILD, channels: { cache: new Map() }, members: { me: bot } };
const client = { guilds: { cache: new Map([[GUILD, guild]]) } };

const addChannel = (channel) => {
  guild.channels.cache.set(channel.id, channel);
  return channel;
};

const room = (id, opts) => addChannel(makeChannel(id, opts));

const counts = (channel) => channel.box.sent.length;

const sentTitles = (channel) => channel.box.sent.map((p) => p.embeds[0].data?.title ?? p.embeds[0].title);

async function main() {
  const banRoom = room('room-ban');
  const kickRoom = room('room-kick');
  const messagesRoom = room('room-messages');
  const membersRoom = room('room-members');
  const generalRoom = room('room-general');
  const lockedRoom = room('room-locked', { perms: false });
  const voiceLikeRoom = room('room-voice', { text: false });

  console.log('\n═══ ١) روم خاص لكل حدث ═══');
  db.updateGuildSettings(GUILD, {
    logs: {
      enabled: true,
      channelId: generalRoom.id,
      channels: { memberBan: banRoom.id, memberKick: kickRoom.id, messageDelete: messagesRoom.id },
      events: { memberBan: true, memberKick: true, messageDelete: true, memberJoin: true },
    },
  });

  await logging.send(client, guild, 'memberBan', { description: 'حظر تجريبي' });
  assert.strictEqual(counts(banRoom), 1);
  assert.strictEqual(counts(kickRoom), 0);
  assert.strictEqual(counts(generalRoom), 0);
  ok('«حظر عضو» يروح لرومه الخاص — ولا للعام ولا لغيره');

  await logging.send(client, guild, 'memberKick', { description: 'طرد تجريبي' });
  assert.strictEqual(counts(kickRoom), 1);
  assert.strictEqual(counts(banRoom), 1);
  ok('«طرد عضو» لحاله في روم ثاني (ما اختلط بالحظر)');

  await logging.send(client, guild, 'messageDelete', { description: 'حذف رسالة' });
  assert.strictEqual(counts(messagesRoom), 1);
  ok('«حذف رسالة» في روم الرسائل لحاله');

  console.log('\n═══ ٢) روم المجموعة + القناة العامة ═══');
  db.updateGuildSettings(GUILD, { logs: { channelsByGroup: { members: membersRoom.id } } });
  await logging.send(client, guild, 'memberJoin', { description: 'عضو جديد' });
  assert.strictEqual(counts(membersRoom), 1, 'روم المجموعة يُستخدم للأحداث بلا روم خاص');
  assert.strictEqual(counts(generalRoom), 0, 'القناة العامة ما تُستخدم والأفضل موجود');

  const candidates = logging.channelCandidates(db.getGuildSettings(GUILD), 'memberBan');
  assert.deepStrictEqual(candidates, [banRoom.id, membersRoom.id, generalRoom.id]);
  ok('أولوية التوجيه: روم الحدث ← روم المجموعة ← القناة العامة');

  // حدث بلا روم خاص ولا روم مجموعة ⇒ القناة العامة (اختيارية)
  await logging.send(client, guild, 'roleCreate', { description: 'رتبة جديدة' });
  assert.strictEqual(counts(generalRoom), 1);
  ok('القناة العامة تشتغل كبديل أخير (لما ما في روم خاص)');

  console.log('\n═══ ٣) بلا أرومات: ما يُرسل شي ═══');
  db.updateGuildSettings(GUILD, { logs: { channelId: null, channels: { memberBan: null }, channelsByGroup: { members: null } } });
  const result = await logging.send(client, guild, 'memberBan', { description: 'بلا روم' });
  assert.strictEqual(result, null);
  assert.deepStrictEqual(logging.channelCandidates(db.getGuildSettings(GUILD), 'memberBan'), []);
  ok('بلا أي روم مرتبط ⇒ لا إرسال ولا خطأ');

  console.log('\n═══ ٤) الحمايات ═══');
  db.updateGuildSettings(GUILD, { logs: { events: { memberBan: false }, channels: { memberBan: banRoom.id } } });
  const before = counts(banRoom);
  await logging.send(client, guild, 'memberBan', { description: 'حدث مُطفأ' });
  assert.strictEqual(counts(banRoom), before);
  ok('حدث مُطفأ ⇒ ما يُرسل حتى لو له روم');

  db.updateGuildSettings(GUILD, { logs: { events: { memberBan: true }, ignoredChannels: [messagesRoom.id] } });
  const beforeMessages = counts(messagesRoom);
  await logging.send(client, guild, 'messageDelete', { description: 'قناة مستثناة', channelId: messagesRoom.id });
  assert.strictEqual(counts(messagesRoom), beforeMessages);
  ok('قناة مستثناة ⇒ ما يُسجَّل حدثها');

  console.log('\n═══ ٥) روم غير صالح ⇒ البديل الصالح ═══');
  db.updateGuildSettings(GUILD, {
    logs: { channelId: generalRoom.id, ignoredChannels: [], channels: { memberBan: lockedRoom.id }, channelsByGroup: { members: voiceLikeRoom.id } },
  });
  const beforeGeneral = counts(generalRoom);
  await logging.send(client, guild, 'memberBan', { description: 'روم بلا صلاحيات' });
  assert.strictEqual(counts(lockedRoom), 0);
  assert.strictEqual(counts(generalRoom), beforeGeneral + 1);
  ok('روم بلا صلاحيات ⇒ يتخطاه ويروح للبديل');

  const channel = logging.getLogChannel(client, GUILD, 'memberBan');
  assert.strictEqual(channel?.id, generalRoom.id);
  ok('getLogChannel يرجّع أول روم صالح فعليًا');

  console.log('\n═══ ٦) المحتوى ═══');
  db.updateGuildSettings(GUILD, { logs: { channels: { memberBan: banRoom.id, memberKick: kickRoom.id } } });
  counts(banRoom) && (banRoom.box.sent.length = 0);
  await logging.send(client, guild, 'memberBan', { fields: [{ name: 'السبب', value: 'اختبار', inline: true }] });
  const embed = banRoom.box.sent[0].embeds[0];
  assert.ok(String(embed.data.title).includes('حظر عضو'), 'العنوان يحمل اسم الحدث');
  assert.strictEqual(embed.data.footer.text, 'حظر عضو');
  assert.strictEqual(embed.data.fields[0].name, 'السبب');
  ok('الإطار يحمل رمز الحدث واسمه + الحقول والفوتر');

  console.log(`\n🎉 كل الفحوص نجحت (${checks} فحصًا)\n`);
}

main().catch((error) => {
  console.error('\n❌ فشل الاختبار:', error.message);
  process.exitCode = 1;
});
