'use strict';
/**
 * help-test.js — يتأكد أن ردود البوت بلا أي رابط موقع:
 *   • /help وتفاصيل الأوامر: بلا أزرار روابط وبلا رابط في النص
 *   • الطريقة الوحيدة للرابط: كلمة «نيفر» — وبشرطين (رول دخول الموقع + تسجيل)
 *   node help-test.js
 */
process.env.DATABASE_PATH = require('node:path').join(
  require('node:os').tmpdir(),
  `nl-help-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
const assert = require('node:assert');
const { Collection } = require('discord.js');
const config = require('../src/config');
const help = require('../src/commands/general/help');

const catalog = require('../src/data/commandCatalog');

/** عميل وهمي فيه أوامر بأقسام مختلفة (الجمهور يُقرأ من الكتالوج الحقيقي) */
function fakeClient() {
  const commands = new Collection();
  const add = (name, category, description = 'وصف تجريبي') => {
    commands.set(name, {
      data: { name, description, options: [] },
      category,
      cooldown: 3,
      audience: catalog.audienceOf(name),
    });
  };
  add('ban', 'moderation');
  add('kick', 'moderation');
  add('help', 'general');
  add('ping', 'general');
  add('tickets', 'config');
  add('remind', 'utility');
  return { commands };
}

/** عضو من الإدارة (يملك إدارة السيرفر) */
const staffMember = () => ({
  id: '1',
  guild: { ownerId: '9' },
  permissions: { has: (p) => p === 'ManageGuild' || p === 32n },
});

/** عضو عادي بلا أي صلاحية */
const plainMember = () => ({ id: '2', guild: { ownerId: '9' }, permissions: { has: () => false } });

/** تفاعل وهمي يلتقط ما تم إرساله */
function fakeInteraction() {
  const captured = { replies: [] };
  return {
    captured,
    member: staffMember(),
    options: { getString: () => null, getFocused: () => '' },
    reply: async (payload) => {
      captured.replies.push(payload);
      return payload;
    },
  };
}

function linkButtons(rows) {
  return rows
    .flatMap((r) => (r.components || []).map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c)))
    .filter((c) => c.style === 5)
    .map((c) => ({ label: c.label, url: c.url }));
}

(async () => {
  console.log('١) رابط الموقع في الإعدادات:', config.web.url);
  assert.ok(/^https?:\/\//i.test(config.web.url), 'رابط الموقع غير صالح');

  const client = fakeClient();
  const interaction = fakeInteraction();
  await help.run(client, interaction, 'ar');
  const payload = interaction.captured.replies[0];
  assert.ok(payload?.embeds?.length, 'لم يُرسل embed');

  const links = linkButtons(payload.components || []);
  console.log('٢) أزرار روابط في /help:', links.length, '(المطلوب 0 — ما في أي رابط موقع في الردود)');
  assert.strictEqual(links.length, 0, 'لسا في أزرار روابط في /help');

  const desc = payload.embeds[0].data?.description || payload.embeds[0].description || '';
  console.log('٣) النص فيه رابط الموقع؟', desc.includes(config.web.url) ? 'إي (غلط)' : 'لا ✔');
  assert.ok(!desc.includes(config.web.url), 'النص لسا فيه رابط الموقع');
  assert.ok(desc.includes('نيفر'), 'ما في إشارة لكلمة «نيفر» كطريقة طلب الرابط');

  // ٤) تفاصيل أمر معيّن: بلا أي زر رابط كذلك
  const interaction2 = fakeInteraction();
  interaction2.options.getString = () => 'ban';
  await help.run(client, interaction2, 'ar');
  const links2 = linkButtons(interaction2.captured.replies[0].components || []);
  console.log('٤) تفاصيل /ban → أزرار روابط:', links2.length, '(المطلوب 0)');
  assert.strictEqual(links2.length, 0, 'زر رابط باقي في تفاصيل الأمر');

  // ٥) الطريقة الوحيدة لرابط الموقع: كلمة «نيفر» — وبشرط قائمة السماح
  const siteLink = require('../src/systems/siteLink');
  const siteUsers = require('../src/web/siteUsers');
  const out = [];
  const fakeMsg = (content, member) => ({
    guild: { id: '100000000000000001' },
    content,
    author: { id: member.id, tag: 'x#1' },
    member,
    reply: async (payload2) => { out.push(payload2); return { delete: async () => {} }; },
  });
  const visitor = { id: '501501501501501501', roles: { cache: new Map() } };
  await siteLink.handleMessage({}, fakeMsg('نيفر', visitor));
  assert.ok(!/https?:/.test(JSON.stringify(out.at(-1))), 'طلع رابط لمين ما أضافه المالك');
  assert.ok(/قائمة الدخول/.test(out.at(-1).content || ''), 'ما شرحنا شرط الرابط');
  const fullMember2 = { id: '502502502502502502', roles: { cache: new Map() } };
  siteUsers.recordLogin({ id: '502502502502502502', username: 'x' });
  assert.ok(!siteUsers.isAllowed('502502502502502502'), 'التسجيل وحده ما يفتح الدخول');
  const granted = siteUsers.grant('502502502502502502', { by: '1' });
  assert.strictEqual(granted.ok, true, granted.error || 'الإضافة فشلت');
  await siteLink.handleMessage({}, fakeMsg('نيفر', fullMember2));
  assert.ok(JSON.stringify(out.at(-1)).includes(config.web.url), 'الرابط ما ظهر لمن أضافه المالك');
  console.log('٥) رابط الموقع: بلا سماح → بلا رابط ✔ · بعد الإضافة → الرابط ظهر ✔');

  // ٦) العضو العادي: أوامر الإدارة مخفية عنه تمامًا
  const plain = fakeInteraction();
  plain.member = plainMember();
  await help.run(client, plain, 'ar');
  const visible = help.visibleCommands(client, plain.member).map((c) => c.data.name).sort();
  console.log('٦) العضو العادي يشوف:', visible.join(' · '));
  assert.deepStrictEqual(visible, ['help', 'ping', 'remind'], 'قائمة أوامر العضو غير صحيحة (لازم بلا ban/kick/tickets)');

  const plainBan = fakeInteraction();
  plainBan.member = plainMember();
  plainBan.options.getString = () => 'ban';
  await help.run(client, plainBan, 'ar');
  const plainReply = plainBan.captured.replies[0];
  console.log('٧) العضو العادي يطلب /help ban →', plainReply.content?.slice(0, 40));
  assert.ok(!plainReply.embeds?.length, 'العضو العادي شاف تفاصيل أمر إدارة!');
  assert.ok(/ما لقيت/.test(plainReply.content || ''), 'ما ظهر رد الرفض');

  // ٨) الإدارة تشوف كل شي: عدد الأوامر كامل + تفاصيل أمر الإدارة
  const staffList = help.visibleCommands(client, staffMember()).map((c) => c.data.name);
  console.log('٨) الإدارة تشوف:', staffList.length, 'أمر (ban موجود؟', staffList.includes('ban'), ')');
  assert.strictEqual(staffList.length, client.commands.size, 'الإدارة لازم تشوف كل الأوامر');

  // ٩) الكتالوج الحقيقي: ١٠ أوامر أعضاء + ١٩ أمر إدارة
  const memberNames = catalog.namesOf('member');
  const staffNames = catalog.namesOf('staff');
  console.log('٩) الكتالوج: أوامر الأعضاء', memberNames.length, '· أوامر الإدارة', staffNames.length);
  assert.strictEqual(memberNames.length, 10, 'عدد أوامر الأعضاء تغيّر');
  assert.strictEqual(staffNames.length, 20, 'عدد أوامر الإدارة تغيّر');
  assert.strictEqual(memberNames.length + staffNames.length, Object.keys(catalog.COMMANDS).length, 'أمر بلا تصنيف');

  console.log('\n🎉 ردود البوت بلا أي رابط موقع · والرابط يطلع بكلمة «نيفر» للمسجّلين اللي عندهم الرول · وأوامر الإدارة مخفية عن الأعضاء');
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
