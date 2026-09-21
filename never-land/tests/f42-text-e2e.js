'use strict';
/**
 * f42-text-e2e.js — أوامر الشات (بلا بريفيكست) لازم تطلع **نص عادي** للعقوبات:
 *   قفل · فتح · احذر · امسح · بان (وبالسلاش كذلك) — بلا إمبد.
 * يلتقط الرسالة اللي **تنرسل فعليًا** عبر message.reply في مسار أوامر الشات الحقيقي.
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-txt-'));
process.env.DATABASE_PATH = path.join(tmp, 'text.db');
process.env.DEMO_MODE = 'true';

const db = require('../src/database');
const textCommands = require('../src/systems/textCommands');

const G = '950000000000000009';
const BOT = '100000000000000002';
const OWNER = '900000000000000001';
const MOD = '910000000000000010';
const TARGET = '200000000000000010';

db.updateGuildSettings(G, {
  replies: { english: false, fancyFont: false }, // عربي واضح للمقارنة
  tickets: { enabled: true, categoryId: '700000000000000007', types: [{ id: 'support', label: 'دعم', emoji: '🎫' }] },
});

const user = (id, name, bot = false) => ({
  id, username: name, tag: `${name}#0001`, bot,
  toString: () => `<@${id}>`, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png',
  send: async () => ({}),
});

function makeChannel(name = 'عام') {
  const sent = [];
  const channel = {
    id: '500000000000000005',
    name,
    sent,
    isTextBased: () => true,
    toString: () => `<#500000000000000005>`,
    permissionOverwrites: {
      edit: async () => ({}),
      create: async () => ({}),
      cache: new Map(),
    },
    send: async (p) => { sent.push(p); return { id: '1' }; },
    bulkDelete: async (n) => new Map(Array.from({ length: Math.max(0, Math.min(n, 3)) }, (_, i) => [String(i), { id: String(i) }])),
    messages: { fetch: async () => new Map([['1', { id: '1' }], ['2', { id: '2' }]]) },
    reply: async (p) => { sent.push(p); return { id: '2', delete: async () => {} }; },
    createMessageCollector: () => ({ on: () => {}, stop: () => {} }),
  };
  return channel;
}

function makeGuild(channel) {
  const me = {
    id: BOT,
    permissions: { has: () => true, missing: () => [] },
    roles: { highest: { position: 100 }, cache: [] },
  };
  return {
    id: G,
    name: 'سيرفر الاختبار',
    ownerId: OWNER,
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel, create: async () => channel },
    members: { me, cache: new Map(), fetch: async (id) => makeMember(id) },
    roles: { everyone: { id: G }, cache: new Map() },
    bans: { create: async () => ({}), remove: async () => {}, fetch: async () => { throw new Error('no'); } },
    iconURL: () => null,
  };
}

function makeMember(id, name = 'Ahmed') {
  return {
    id,
    user: user(id, name),
    guild: null,
    roles: { cache: [], highest: { position: 1 } },
    permissions: { has: () => false },
    displayName: name,
    ban: async () => {},
    kick: async () => {},
    timeout: async () => {},
  };
}

/** رسالة شات حقيقية الشكل → تمر بمسار أوامر الشات الحقيقي */
function makeMessage(content, { channel, guild }) {
  const replies = [];
  const msg = {
    id: '400000000000000001',
    content,
    channel,
    guild,
    client: { user: { id: BOT, tag: 'Never Land#5095' }, users: { fetch: async (id) => user(id, 'outside'), cache: new Map() } },
    author: user(OWNER, 'Owner'),
    member: (() => {
      const m = makeMember(OWNER, 'Owner');
      m.permissions = { has: () => true, missing: () => [] };
      m.roles = { cache: [], highest: { position: 90 } };
      return m;
    })(),
    mentions: { users: { first: () => user(TARGET, 'Ahmed') }, members: { first: () => makeMember(TARGET) }, roles: { first: () => null }, channels: { first: () => null } },
    createdAt: new Date(),
    createdTimestamp: Date.now(),
    inGuild: () => true,
    reply: async (p) => { replies.push(p); return { id: '2', delete: async () => {} }; },
    __replies: replies,
  };
  msg.member.guild = guild;
  return msg;
}

const commands = new Map();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) {
      const cmd = require(full);
      if (cmd?.data?.name) commands.set(cmd.data.name, cmd);
    }
  }
};
walk(path.join(__dirname, '..', 'src', 'commands'));

const client = { user: { id: BOT, tag: 'Never Land#5095' }, commands, users: { fetch: async (id) => user(id, 'outside'), cache: new Map() }, channels: { cache: new Map() } };

let checks = 0;
const ok = (label) => { checks += 1; console.log(`  ✔ ${label}`); };

const shapeOf = (replies) => {
  const last = replies[replies.length - 1];
  if (!last) return { kind: 'none' };
  return { kind: last.embeds?.length ? 'إمبد' : 'نص', payload: last };
};

async function run(content, { channel, guild }) {
  const msg = makeMessage(content, { channel, guild });
  await textCommands.handleMessage(client, msg, 'ar');
  return shapeOf(msg.__replies);
}

(async () => {
  console.log('\n════ أوامر الشات (بلا بريفيكست) — نص مو إمبد ════');
  const channel = makeChannel('عام');
  const guild = makeGuild(channel);
  channel.guild = guild;

  const cases = ['قفل', 'فتح', 'تحذير <@200000000000000010> سبام', 'مسح', 'حظر <@200000000000000010> سبام', 'طرد <@200000000000000010> إزعاج'];
  for (const line of cases) {
    const shape = await run(`${line}`, { channel, guild });
    const preview = String(shape.payload?.content || JSON.stringify(shape.payload?.embeds?.[0]?.data || shape.payload?.embeds?.[0] || {}).slice(0, 90)).replace(/\n/g, ' ⏎ ');
    console.log(`  ${shape.kind === 'نص' ? '✔' : '✘'} «${line}» → ${shape.kind}` + (shape.kind === 'نص' ? `: ${preview.slice(0, 110)}` : ''));
    assert.strictEqual(shape.kind, 'نص', `أمر «${line}» طلع ${shape.kind} — لازم نص عادي`);
    checks += 1;
  }

  /* أوامر مو عقوبات تبقى إمبد (التوب/المساعدة) */
  const top = await run('t day', { channel, guild });
  assert.strictEqual(top.kind, 'إمبد', 'التوب لازم يبقى إمبد');
  checks += 1;
  console.log('  ✔ «t day» لسا إمبد (زي ما هو)');

  /* لو المدير اختار «إمبد» للحظر من صفحة ردود اوامر → يرجع إمبد */
  db.updateGuildSettings(G, { commandReplies: { ban: { mode: 'embed', title: 'حظر' } } });
  const banned = await run('حظر <@200000000000000010> سبب', { channel, guild });
  assert.strictEqual(banned.kind, 'إمبد', 'خيار «إمبد» من اللوحة ما اشتغل');
  checks += 1;
  console.log('  ✔ خيار «إمبد» من صفحة ردود اوامر يشتغل على أوامر الشات كذلك');

  /* ونرجّعه نص */
  db.updateGuildSettings(G, { commandReplies: { ban: { mode: 'text', text: '🔨 تم حظر {user} — {reason} · حالة #{case}' } } });
  const textAgain = await run('حظر <@200000000000000010> سبام', { channel, guild });
  assert.strictEqual(textAgain.kind, 'نص');
  console.log(`  ✔ النص المخصّص من اللوحة يوصل بالشات: ${String(textAgain.payload.content).split('\n')[0].slice(0, 90)}`);
  checks += 1;

  console.log(`\n🎉 أوامر الشات كلها نص عادي للعقوبات (${checks} فحص)\n`);
})().catch((err) => {
  console.error('\n❌', err.message);
  console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
