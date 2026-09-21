'use strict';
/**
 * f42-e2e.js — يبني **الحمولة النهائية** اللي تنرسل لديسكورد فعليًا
 * (بعد محرّك الشكل + الترجمة + الخط) للأوامر: التوب · الحظر · الطرد · التحذير · التنظيف · القفل · فك الحظر.
 * الهدف: نشوف بعيننا إن التوب بلا فوتر، والعقوبات نص عادي بلا إمبد.
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-e2e-'));
process.env.DATABASE_PATH = path.join(tmp, 'e2e.db');
process.env.DEMO_MODE = 'true';

const db = require('../src/database');
const periods = require('../src/lib/periods');
const replies = require('../src/lib/replies');

const G = '900000000000000009';
const BOT = '100000000000000002';
const MOD = '910000000000000010';
const TARGET = '200000000000000010';

db.updateGuildSettings(G, {
  replies: { english: false, fancyFont: false }, // نعرض النص كما هو بالعربي (وضوح)
  leveling: { enabled: true, cooldownSeconds: 0 },
  tickets: { enabled: true, categoryId: '700000000000000007', types: [{ id: 'support', label: 'دعم', emoji: '🎫' }] },
});

/* خبرة لمدة يوم واحد لثلاثة أعضاء */
const key = periods.dayKey(new Date());
[3, 2, 1].forEach((mult, i) => {
  db.addPeriodXp(G, `2000000000000000${20 + i}`, 'day', key, { xp: 500 * mult, source: 'text', messages: 50 * mult });
});
db.addPeriodXp(G, TARGET, 'day', key, { xp: 120, source: 'voice', voiceMinutes: 12 });
db.updateGuildSettings(G, {});

const user = (id, name) => ({
  id, username: name, tag: `${name}#0001`, bot: false,
  toString: () => `<@${id}>`, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png',
  send: async () => ({}),
});
const member = (id, name) => ({
  id, user: user(id, name), roles: { cache: [], highest: { position: 1 } },
  guild: { id: G, name: 'سيرفر الاختبار', ownerId: '1', members: { me: { id: BOT, permissions: { has: () => true }, roles: { highest: { position: 100 } } } } },
  ban: async () => {}, kick: async () => {}, timeout: async () => {},
  permissions: { has: () => true },
});

const guild = {
  id: G,
  name: 'سيرفر الاختبار',
  ownerId: '1',
  members: { me: { id: BOT, permissions: { has: () => true }, roles: { highest: { position: 100 } } }, fetch: async (id) => member(id, 'Ahmed'), cache: new Map() },
  bans: { create: async () => ({}), fetch: async () => { throw new Error('no'); }, remove: async () => {} },
  channels: { cache: new Map(), fetch: async () => null, create: async () => ({ id: '555000000000000555', send: async () => ({}) }) },
  roles: { everyone: { id: G }, cache: new Map() },
};

/** تفاعل حقيقي محاط بمحرّك الردود — يلتقط الحمولة النهائية قبل الإرسال */
function makeInteraction(commandName, { strings = {}, user: targetUser = null, channel = null } = {}) {
  const captured = [];
  const interaction = {
    commandName,
    guildId: G,
    guild,
    channelId: '500000000000000005',
    client: { user: { id: BOT, tag: 'Never Land#5095' }, users: { fetch: async (id) => user(id, 'outside'), cache: new Map() } },
    user: user(MOD, 'Mod'),
    member: member(MOD, 'Mod'),
    channel: channel || { id: '500000000000000005', name: 'عام', toString: () => '<#500000000000000005>', send: async (p) => { captured.push(p); return p; }, permissionOverwrites: { edit: async () => ({}) }, messages: { fetch: async () => new Map() }, bulkDelete: async (n) => new Map(Array.from({ length: Math.max(0, n - 0) }, (_, i) => [String(i), { id: String(i) }])), isTextBased: () => true },
    deferred: false,
    replied: false,
    __captured: captured,
    async deferReply() { this.deferred = true; },
    async reply(payload) { captured.push(payload); return payload; },
    async editReply(payload) { captured.push(payload); return payload; },
    async followUp(payload) { captured.push(payload); return payload; },
    options: {
      getUser: (n) => (n === 'العضو' || n === 'المستخدم' ? targetUser : null),
      getMember: (n) => (n === 'العضو' ? targetUser : null),
      getString: (n) => strings[n] ?? null,
      getInteger: (n) => (n === 'الصفحة' ? 1 : null),
      getChannel: (n) => (n === 'القناة' || n === 'الروم' ? channel : null),
      getSubcommand: () => null,
      getSubcommandGroup: () => null,
      getBoolean: () => false,
      getFocused: () => '',
    },
  };
  /* نفس اللي يسويه البوت: ردود التفاعل تمر بمحرّك الشكل + الترجمة */
  replies.wrapInteraction(interaction);
  return interaction;
}

function show(label, captured) {
  const payload = captured[captured.length - 1] || {};
  const embeds = payload.embeds || [];
  const first = embeds[0];
  const data = first?.data || first || {};
  console.log(`\n━━ ${label} ━━`);
  console.log(`  نوع الرد        : ${embeds.length ? 'إمبد' : 'رسالة نصية'}`);
  if (payload.content) console.log(`  النص            : ${String(payload.content).replace(/\n/g, ' ⏎ ').slice(0, 150)}`);
  if (embeds.length) {
    if (data.title) console.log(`  عنوان الإمبد    : ${data.title}`);
    if (data.description) console.log(`  الوصف           : ${String(data.description).replace(/\n/g, ' ⏎ ').slice(0, 130)}`);
    if (data.footer) console.log(`  التذييل ⚠️      : ${data.footer.text}`);
    console.log(`  التذييل         : ${data.footer ? '⚠️ موجود' : 'محذوف ✔'}`);
    console.log(`  الحقول          : ${(data.fields || []).map((f) => `${f.name}=${String(f.value).slice(0, 24)}`).join(' | ') || '—'}`);
  }
}

(async () => {
  console.log('\n════ حمولة الإرسال الحقيقية (بعد الشكل + الترجمة) ════');

  /* التوب */
  const top = require('../src/commands/general/top');
  const i1 = makeInteraction('top', { strings: { الفترة: 'day', النوع: 'all' } });
  await top.run(i1.client, i1, 'ar');
  show('/top day', i1.__captured);

  /* العقوبات */
  const group = require('../src/commands/moderation/ban');
  const i2 = makeInteraction('ban', { strings: { السبب: 'سبام' }, user: user(TARGET, 'Ahmed') });
  i2.options.getUser = (n) => (n === 'العضو' ? user(TARGET, 'Ahmed') : null);
  i2.options.getMember = () => member(TARGET, 'Ahmed');
  await group.run(i2.client, i2, 'ar');
  show('/ban', i2.__captured);

  const kick = require('../src/commands/moderation/kick');
  const i3 = makeInteraction('kick', { strings: { السبب: 'إزعاج' }, user: user(TARGET, 'Ahmed') });
  i3.options.getMember = () => member(TARGET, 'Ahmed');
  await kick.run(i3.client, i3, 'ar');
  show('/kick', i3.__captured);

  const warn = require('../src/commands/moderation/warn');
  const i4 = makeInteraction('warn', { strings: { السبب: 'تجاوز', 'الأمر': 'add' } });
  i4.options.getSubcommand = () => 'add';
  i4.options.getMember = () => member(TARGET, 'Ahmed');
  i4.options.getUser = () => user(TARGET, 'Ahmed');
  await warn.run(i4.client, i4, 'ar');
  show('/warn', i4.__captured);

  const purge = require('../src/commands/moderation/purge');
  const i5 = makeInteraction('purge', { strings: { العدد: '25' } });
  i5.options.getSubcommand = () => 'messages';
  i5.options.getInteger = (n) => (n === 'العدد' ? 25 : null);
  await purge.run(i5.client, i5, 'ar');
  show('/purge', i5.__captured);

  const lock = require('../src/commands/moderation/lock');
  const i6 = makeInteraction('lock');
  i6.options.getSubcommand = () => 'channel';
  await lock.run(i6.client, i6, 'ar');
  show('/lock', i6.__captured);

  console.log('\n════ الخلاصة ════');
  const all = [i1, i2, i3, i4, i5, i6].map((i) => i.__captured[i.__captured.length - 1] || {});
  const withFooter = all.filter((p) => (p.embeds || []).some((e) => (e?.data || e)?.footer));
  console.log(`  ردود فيها فوتر : ${withFooter.length}`);
  console.log(`  التوب فيها فوتر: ${(i1.__captured.at(-1).embeds || []).some((e) => (e?.data || e)?.footer) ? '⚠️ نعم' : 'لا ✔'}`);
  const asEmbeds = all.filter((p, idx) => idx > 0 && (p.embeds || []).length).length;
  console.log(`  عقوبات طلعت إمبد: ${asEmbeds} (المطلوب 0)`);
  console.log('');
})();
