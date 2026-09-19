'use strict';

/**
 * moderation-test.js
 * -------------------------------------------------------------
 * ١) ban يشغل بالآيدي والعضو داخل السيرفر أو برّا (حظر بالآيدي)
 * ٢) kick: عضو برّا السيرفر ⇒ رسالة واضحة توجّه للحظر (ديسكورد ما يسمح بالطرد)
 * ٣) unban: يستقبل آيدي · منشن · اسم كامل · اسم مستخدم (بلا حساسية لحالة الأحرف)
 * ٤) الكولداون مشيل من كل الأوامر (سلاش) + أوامر الشات بلا بريفيكست
 * ٥) أوامر الشات: خيار العضو يقبل آيدي رقمي حتى لو العضو برّا السيرفر
 * ٦) ترقية الإعدادات: كولداون الأوامر القديم (3) ⇒ صفر
 *
 * التشغيل:  node moderation-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-mod-'));
process.env.DATABASE_PATH = path.join(tmp, 'moderation.db');
process.env.DEMO_MODE = 'true';

const db = require('./src/database');
const actions = require('./src/lib/modActions');
const textCommands = require('./src/systems/textCommands');
const interactionCreate = require('./src/events/interactionCreate');
const { migrateSettings } = require('./src/database/migrate');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

const GUILD_ID = '700000000000000007';
const BOT_ID = '800000000000000008';
const OWNER_ID = '900000000000000009';
const EXEC_ID = '910000000000000010';
const TARGET_ID = '920000000000000011';

const fakeUser = (id, name = 'someone') => ({
  id,
  tag: `${name}#0001`,
  username: name,
  globalName: name,
  toString: () => `<@${id}>`,
  displayAvatarURL: () => 'https://cdn.example/avatar.png',
  send: async () => ({}),
});

const fakeMember = (user, position = 1) => ({
  id: user.id,
  user,
  roles: { highest: { position } },
  ban: async () => {},
  kick: async () => {},
  timeout: async () => {},
});

function fakeGuild({ bannedIds = [] } = {}) {
  const calls = { ban: [], kick: [], create: [], remove: [], fetchList: 0 };
  const banEntries = new Map(
    bannedIds.map((id) => [id, { user: fakeUser(id, 'banned'), reason: 'test' }]),
  );
  banEntries.find = (fn) => [...banEntries.values()].find(fn);

  const guild = {
    id: GUILD_ID,
    name: 'Test Server',
    ownerId: OWNER_ID,
    calls,
    members: {
      me: { id: BOT_ID, permissions: { has: () => true }, roles: { highest: { position: 100 } } },
      cache: new Map(),
      fetch: async (id) => {
        const member = guild.members.cache.get(id);
        if (!member) throw new Error('Unknown Member');
        return member;
      },
    },
    bans: {
      create: async (id, options) => {
        calls.create.push({ id, options });
        return {};
      },
      fetch: async (id) => {
        if (id === undefined) {
          calls.fetchList += 1;
          return banEntries;
        }
        if (!banEntries.has(id)) throw new Error('Unknown Ban');
        return banEntries.get(id);
      },
      remove: async (id, reason) => {
        calls.remove.push({ id, reason });
        banEntries.delete(id);
      },
    },
  };
  return guild;
}

const fakeClient = () => ({
  user: { id: BOT_ID, tag: 'Never Land#5095' },
  users: { cache: new Map(), fetch: async (id) => fakeUser(id, 'outside') },
  channels: { cache: new Map() },
});

/** تفاعل سلاش وهمي للأمر المطلوب */
function fakeInteraction({ user, member = null, strings = {}, integers = {} }) {
  const replies = [];
  return {
    replies,
    guildId: GUILD_ID,
    guild: null,
    user: fakeUser(EXEC_ID, 'moderator'),
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.replies.push(payload);
      return payload;
    },
    options: {
      getUser: () => user,
      getMember: () => member,
      getString: (name) => strings[name] ?? null,
      getInteger: (name) => integers[name] ?? null,
      getSubcommand: () => null,
      getFocused: () => '',
    },
  };
}

async function main() {
  const executor = fakeUser(EXEC_ID, 'moderator');

  console.log('\n═══ ١) الحظر: عضو داخل السيرفر أو برّا (بالآيدي) ═══');
  {
    const guild = fakeGuild();
    const inside = fakeMember(fakeUser(TARGET_ID, 'inside'));
    const res1 = await actions.ban(fakeClient(), { guild, executor, target: inside, reason: 'سبام' });
    assert.strictEqual(res1.ok, true, 'الحظر داخل السيرفر فشل');
    assert.strictEqual(res1.outside, false);

    const outsider = fakeUser('930000000000000012', 'outsider');
    const res2 = await actions.ban(fakeClient(), { guild, executor, target: outsider, reason: 'سبام' });
    assert.strictEqual(res2.ok, true, 'الحظر بالآيدي (برّا السيرفر) فشل');
    assert.strictEqual(res2.outside, true, 'لازم يعلّم إنه برّا السيرفر');
    assert.strictEqual(guild.calls.create.length, 1, 'guild.bans.create ما انستدعت');
    assert.strictEqual(guild.calls.create[0].id, outsider.id);
    ok('حظر داخل السيرفر + حظر بالآيدي لشخص برّا السيرفر (نفس الأمر)');

    assert.ok(res2.caseId > 0, 'ما تسجّلت حالة الحظر');
    ok('كل حظر يسجّل حالة (Case) بالسجل');
  }

  console.log('\n═══ ٢) الطرد: عضو برّا السيرفر ⇒ رسالة واضحة ═══');
  {
    const kick = require('./src/commands/moderation/kick');
    const guild = fakeGuild();
    const outsider = fakeUser('940000000000000013', 'outsider');
    const interaction = fakeInteraction({ user: outsider });
    interaction.guild = guild;
    interaction.client = fakeClient();

    await kick.run(fakeClient(), interaction, 'ar');
    const payload = interaction.replies[0];
    const text = JSON.stringify(payload?.embeds?.[0]?.data ?? payload?.embeds?.[0] ?? payload);
    assert.ok(/مو موجود بالسيرفر|ما يمكن طرد/.test(text), 'ما طلعت رسالة توضيحية للطرد');
    assert.ok(/\/ban/.test(text), 'الرسالة لازم توجّه لأمر الحظر');
    assert.strictEqual(guild.calls.kick.length, 0);
    ok('الطرد يشرح إن العضو برّا السيرفر ويوجّه للحظر بالآيدي');
  }

  console.log('\n═══ ٣) فك الحظر: آيدي · منشن · اسم ═══');
  {
    const unban = require('./src/commands/moderation/unban');
    const bannedId = '950000000000000014';

    for (const [label, input] of [
      ['آيدي', bannedId],
      ['منشن', `<@${bannedId}>`],
      ['منشن بعلامة تعجب', `<@!${bannedId}>`],
      ['اسم كامل', 'banned#0001'],
      ['اسم مستخدم', 'banned'],
    ]) {
      const guild = fakeGuild({ bannedIds: [bannedId] });
      const interaction = fakeInteraction({ user: fakeUser(TARGET_ID), strings: { العضو: input, السبب: 'تم' } });
      interaction.guild = guild;
      interaction.client = fakeClient();
      await unban.run(fakeClient(), interaction, 'ar');
      assert.strictEqual(guild.calls.remove.length, 1, `فك الحظر فشل بالـ${label}`);
      assert.strictEqual(guild.calls.remove[0].id, bannedId, `معرّف غلط بالـ${label}`);
    }
    ok('فك الحظر يشتغل بـ آيدي · منشن · <@!id> · الاسم الكامل · اسم المستخدم');

    const guild2 = fakeGuild({ bannedIds: [] });
    const notBanned = fakeInteraction({ user: fakeUser(TARGET_ID), strings: { العضو: '999000000000000099' } });
    notBanned.guild = guild2;
    notBanned.client = fakeClient();
    await unban.run(fakeClient(), notBanned, 'ar');
    const text = JSON.stringify(notBanned.replies[0]?.embeds?.[0]?.data ?? notBanned.replies[0]);
    assert.ok(/قائمة المحظورين/.test(text), 'لازم يوضّح إنه مو محظور');
    assert.strictEqual(guild2.calls.remove.length, 0);
    ok('لو العضو مو محظور: رسالة واضحة بلا أي تعديل');
  }

  console.log('\n═══ ٤) الكولداون مشيل من الأوامر ═══');
  {
    const fsx = require('node:fs');
    const files = [];
    const walkDir = (dir) => {
      for (const entry of fsx.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkDir(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walkDir(path.join(__dirname, 'src/commands'));

    const withCooldown = files.filter((f) => /^\s{2}cooldown:\s*\d+/m.test(fsx.readFileSync(f, 'utf8')));
    assert.strictEqual(withCooldown.length, 0, `أوامر بعدها فيها كولداون: ${withCooldown.join(', ')}`);

    const client = { cooldowns: new Map() };
    for (const file of files) {
      const command = require(file);
      if (!command?.data?.name) continue;
      const interaction = { guildId: GUILD_ID, user: { id: EXEC_ID } };
      command.cooldowns = undefined;
      assert.strictEqual(interactionCreate.checkCooldown(client, interaction, command), 0, `${command.data.name} لسا فيه انتظار`);
    }
    ok(`كل أوامر السلاش (${files.length} ملف) بلا كولداون`);

    const tconf = textCommands.defaultsFor();
    assert.strictEqual(tconf.cooldownSeconds, 0, 'حد أوامر الشات لازم يكون صفر');

    /* حتى لو في قيمة محفوظة قديمة بالسيرفر — القراءة ترجّع صفر */
    textCommands.setOptions(GUILD_ID, { cooldownSeconds: 3 });
    assert.strictEqual(textCommands.configFor(GUILD_ID).cooldownSeconds, 0, 'قيمة محفوظة قديمة ما انشالت');
    ok('أوامر الشات بلا كولداون — حتى لو محفوظ رقم قديم بالسيرفر');
  }

  console.log('\n═══ ٥) أوامر الشات: خيار العضو يقبل آيدي ═══');
  {
    const command = {
      data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('test')
        .addUserOption((o) => o.setName('العضو').setDescription('t').setRequired(true)),
    };
    const defs = textCommands.optionDefs(command, null);
    const guild = fakeGuild();
    const client = fakeClient();
    const outsiderId = '960000000000000015';

    const argsStore = new Map();
    const interaction = { __textArgs: argsStore, guild, guildId: GUILD_ID };
    const message = { guild, mentions: { members: { first: () => null } }, author: { id: EXEC_ID } };

    textCommands.bindArguments(interaction, guild, message, [outsiderId], defs);
    await textCommands.resolveIdArguments(interaction, client);

    const entry = argsStore.get('العضو');
    assert.ok(entry?.user, 'ما انحلّ الآيدي لمستخدم');
    assert.strictEqual(entry.user.id, outsiderId);
    assert.strictEqual(entry.member, null, 'العضو برّا السيرفر ⇒ member لازم يكون null');
    ok('كتابة الآيدي في الشات تنحل لمستخدم حتى لو برّا السيرفر');

    /* المنشن العادي لسا يشتغل */
    const insideId = '970000000000000016';
    const insideUser = fakeUser(insideId, 'inside');
    guild.members.cache.set(insideId, fakeMember(insideUser));
    const store2 = new Map();
    const interaction2 = { __textArgs: store2, guild, guildId: GUILD_ID };
    const message2 = { guild, mentions: { members: { first: () => guild.members.cache.get(insideId) } }, author: { id: EXEC_ID } };
    textCommands.bindArguments(interaction2, guild, message2, [`<@${insideId}>`], defs);
    await textCommands.resolveIdArguments(interaction2, client);
    assert.strictEqual(store2.get('العضو')?.member?.id, insideId);
    ok('المنشن العادي لسا يشتغل مثل قبل');
  }

  console.log('\n═══ ٦) ترقية الإعدادات القديمة ═══');
  {
    const settings = { textCommands: { enabled: true, cooldownSeconds: 3, perCommand: { ban: 3, kick: 0 } } };
    migrateSettings(settings);
    assert.strictEqual(settings.textCommands.cooldownSeconds, 0, 'كولداون الأوامر القديم ما انشال');
    assert.strictEqual(settings.textCommands.perCommand.ban, 0, 'كولداون الأمر القديم ما انشال');
    assert.strictEqual(settings.textCommands.perCommand.kick, 0);
    ok('السيرفرات القديمة: 3 ثواني ⇒ صفر تلقائيًا');
  }

  console.log(`\n🎉 كل الفحوص نجحت (${checks} فحصًا)\n`);
}

main().catch((error) => {
  console.error('\n❌ فشل الاختبار:', error.message);
  process.exitCode = 1;
});
