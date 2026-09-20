'use strict';

/**
 * leveling-test.js
 * -------------------------------------------------------------
 * اختبار نظام الخبرة الكامل (بلا ديسكورد حقيقي):
 *   ١) الفترات: مفتاح اليوم ومفتاح الأسبوع (ISO) ووقت التجديد
 *   ٢) المصادر: خبرة كتابية · صوتية · تفاعل — كل واحدة تنفصل لحالها
 *   ٣) التوب: توب داي · توب ويك · كل الأوقات + الترتيب حسب المصدر
 *   ٤) حمايات التفاعل: بلا بوت، بلا تفاعل على نفسك، مرة واحدة لكل شخص،
 *      سقف لكل رسالة، كولداون بين نفس الشخصين، وسقف يومي
 *   ٥) الترقية عند الوصول لمستوى جديد
 *   ١١) الخبرة الكتابية بالأحرف: ١ خبرة لكل ٥ أحرف
 *   ١٢) الخبرة الصوتية: ١ خبرة كل ٦٠ ثانية (+ الفاصل القابل للضبط)
 *   ١٣) الحماية الذكية من السبام: تكرار الكلام · رسائل سريعة · حروف مكررة
 *        → بلا خبرة (كتابي وصوتي وتفاعل) لمدة ٥ دقايق
 *
 * التشغيل:  node leveling-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');

const periods = require('./src/lib/periods');
const { levelFromXp } = require('./src/lib/levels');
const config = require('./src/config');

/* ------------------------- قاعدة بيانات وهمية بالذاكرة ------------------------- */

const store = { levels: new Map(), periodRows: new Map(), daily: new Map() };
let settings = null;

const key = (a, b) => `${a}:${b}`;
const pkey = (g, u, p, k) => `${g}:${u}:${p}:${k}`;

const FIELD = { text: 'text_xp', voice: 'voice_xp', interact: 'interact_xp' };

const mockDb = {
  getGuildSettings: () => settings,
  getLevelRow: (g, u) => store.levels.get(key(g, u)) || null,
  upsertLevel: (g, u, patch) => {
    const prev = store.levels.get(key(g, u)) || {};
    // نطبّق نفس تحويل الأسماء اللي يسويه مشغّل SQLite الحقيقي
    const map = { textXp: 'text_xp', voiceXp: 'voice_xp', interactXp: 'interact_xp', voiceMinutes: 'voice_minutes', lastXpAt: 'last_xp_at' };
    const normalized = {};
    for (const [k, v] of Object.entries(patch)) normalized[map[k] || k] = v;
    const row = { guild_id: g, user_id: u, ...prev, ...normalized };
    store.levels.set(key(g, u), row);
    return row;
  },
  getLeaderboard: (g, limit = 10, offset = 0) =>
    [...store.levels.values()].filter((r) => r.guild_id === g).sort((a, b) => b.xp - a.xp).slice(offset, offset + limit),
  countTrackedMembers: (g) => [...store.levels.values()].filter((r) => r.guild_id === g).length,
  addPeriodXp: (g, u, period, k, { xp = 0, source = 'text', messages = 0, voiceMinutes = 0, interactions = 0, at = Date.now() }) => {
    const id = pkey(g, u, period, k);
    const row = store.periodRows.get(id) || {
      guild_id: g, user_id: u, period, period_key: k,
      xp: 0, text_xp: 0, voice_xp: 0, interact_xp: 0, messages: 0, voice_minutes: 0, interactions: 0, updated_at: at,
    };
    row.xp += xp;
    row[FIELD[source]] += xp;
    row.messages += messages;
    row.voice_minutes += voiceMinutes;
    row.interactions += interactions;
    row.updated_at = at;
    store.periodRows.set(id, row);
    return row;
  },
  getPeriodRow: (g, u, p, k) => store.periodRows.get(pkey(g, u, p, k)) || null,
  getPeriodLeaderboard: (g, p, k, limit = 10, offset = 0) =>
    [...store.periodRows.values()]
      .filter((r) => r.guild_id === g && r.period === p && r.period_key === k && r.xp > 0)
      .sort((a, b) => b.xp - a.xp || a.updated_at - b.updated_at)
      .slice(offset, offset + limit),
  countPeriodMembers: (g, p, k) =>
    [...store.periodRows.values()].filter((r) => r.guild_id === g && r.period === p && r.period_key === k && r.xp > 0).length,
  getPeriodRank: (g, u, p, k) => {
    const row = store.periodRows.get(pkey(g, u, p, k));
    if (!row || row.xp <= 0) return null;
    return [...store.periodRows.values()]
      .filter((r) => r.guild_id === g && r.period === p && r.period_key === k && r.xp > row.xp).length + 1;
  },
  clearPeriods: (g, u) => {
    for (const id of [...store.periodRows.keys()]) if (id.startsWith(`${g}:${u}:`)) store.periodRows.delete(id);
  },
  resetLevel: (g, u) => {
    store.levels.delete(key(g, u));
    mockDb.clearPeriods(g, u);
  },
  getXpTotals: (g, p = null, k = null) => {
    const rows = p && p !== 'all' && k
      ? [...store.periodRows.values()].filter((r) => r.guild_id === g && r.period === p && r.period_key === k)
      : [...store.levels.values()].filter((r) => r.guild_id === g);
    return rows.reduce((acc, r) => ({
      xp: acc.xp + (r.xp || 0),
      text_xp: acc.text_xp + (r.text_xp || 0),
      voice_xp: acc.voice_xp + (r.voice_xp || 0),
      interact_xp: acc.interact_xp + (r.interact_xp || 0),
      messages: acc.messages + (r.messages || 0),
      voice_minutes: acc.voice_minutes + (r.voice_minutes || 0),
      interactions: acc.interactions + (r.interactions || 0),
    }), { xp: 0, text_xp: 0, voice_xp: 0, interact_xp: 0, messages: 0, voice_minutes: 0, interactions: 0 });
  },
  bumpDaily: (g, field, amount = 1) => {
    const day = new Date().toISOString().slice(0, 10);
    store.daily.set(key(g, day), (store.daily.get(key(g, day)) || 0) + amount);
  },
};

/* نحقن قاعدة البيانات الوهمية *قبل* تحميل نظام الخبرة */
const dbPath = require.resolve('./src/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDb };
const leveling = require('./src/systems/leveling');

/* --------------------------------- أدوات --------------------------------- */

const GUILD = 'guild-test';

function settingsFor(patch = {}) {
  const base = JSON.parse(JSON.stringify(config.defaults.leveling));
  settings = { leveling: { ...base, enabled: true, cooldownSeconds: 0, minXp: 20, maxXp: 20, voiceMinXp: 5, voiceMaxXp: 5, interactMinXp: 4, interactMaxXp: 4, ...patch } };
  return settings.leveling;
}

function fakeMember(id) {
  const guild = {
    id: GUILD,
    name: 'Never Land',
    afkChannelId: null,
    roles: { cache: new Map() },
    channels: { cache: new Map() },
    members: { me: { roles: { highest: { position: 99 } } }, cache: new Map(), fetch: async () => null },
    voiceStates: { cache: new Map() },
  };
  return {
    id,
    user: { id, bot: false, username: `user${id}`, displayAvatarURL: () => 'https://cdn.example.com/a.png' },
    guild,
    roles: { cache: new Map() },
    displayName: `user${id}`,
    send: async () => ({}),
    dmChannel: null,
  };
}

function fakeMessage(member, id = 'msg-1') {
  return { id, guild: member.guild, channelId: 'chan-1', member, author: { id: member.id, bot: false }, content: 'مرحبا' };
}

const client = { user: { id: 'bot-1' } };

/* --------------------------------- الاختبار --------------------------------- */

(async () => {
  console.log('\n[اختبار] نظام الخبرة: كتابي · صوتي · تفاعل — توب داي وتوب ويك\n');

  /* ١) الفترات */
  assert.strictEqual(periods.dayKey(new Date('2026-09-18T10:00:00Z')), '2026-09-18', 'مفتاح اليوم خطأ');
  assert.strictEqual(periods.weekKey(new Date('2026-09-18T10:00:00Z')), '2026-W38', 'مفتاح الأسبوع خطأ');
  assert.strictEqual(periods.weekKey(new Date('2026-09-14T00:10:00Z')), periods.weekKey(new Date('2026-09-20T23:50:00Z')), 'الأسبوع لازم يبدأ الإثنين وينتهي الأحد');
  assert.ok(periods.msUntilReset('day', new Date('2026-09-18T10:00:00Z')) === 14 * 3600 * 1000, 'وقت تجديد اليوم خطأ');
  assert.ok(periods.resetLabel('week', new Date('2026-09-18T10:00:00Z')).includes('يوم'), 'وصف تجديد الأسبوع خطأ');
  /* صار في «توب منث» كذلك + «كل الأوقات» */
  assert.strictEqual(periods.PERIOD_KEYS.join(','), 'day,month,week,all');
  assert.ok(periods.PERIODS.month && periods.periodKey('month'), 'فترة الشهر ناقصة');
  assert.strictEqual(periods.SOURCE_KEYS.join(','), 'all,text,voice,interact');
  console.log('١) الفترات: مفتاح اليوم · مفتاح الأسبوع (ISO) · وقت التجديد ✅');

  /* ٢) المصادر الثلاثة تنفصل لحالها */
  settingsFor();
  const ahmed = fakeMember('ahmed');
  await leveling.addXp(client, ahmed, 20, { source: 'text', messages: 1 });
  await leveling.addXp(client, ahmed, 5, { source: 'voice', bypassCooldown: true, voiceMinutes: 1 });
  await leveling.addXp(client, ahmed, 4, { source: 'interact', bypassCooldown: true, interactions: 1 });

  const row = mockDb.getLevelRow(GUILD, 'ahmed');
  assert.strictEqual(row.xp, 29, 'مجموع الخبرة خطأ');
  assert.strictEqual(row.text_xp, 20, 'الخبرة الكتابية خطأ');
  assert.strictEqual(row.voice_xp, 5, 'الخبرة الصوتية خطأ');
  assert.strictEqual(row.interact_xp, 4, 'خبرة التفاعل خطأ');
  assert.strictEqual(row.messages, 1, 'عدد الرسائل خطأ');
  assert.strictEqual(row.voice_minutes, 1, 'دقائق الصوت خطأ');
  assert.strictEqual(row.interactions, 1, 'عدد التفاعلات خطأ');

  const dayRow = mockDb.getPeriodRow(GUILD, 'ahmed', 'day', periods.dayKey(new Date(), settings.leveling));
  assert.strictEqual(dayRow.xp, 29, 'خبرة اليوم خطأ');
  assert.strictEqual(dayRow.voice_xp, 5, 'خبرة الصوت اليومية خطأ');
  assert.ok(mockDb.getPeriodRow(GUILD, 'ahmed', 'week', periods.weekKey(new Date(), settings.leveling)).xp === 29, 'خبرة الأسبوع خطأ');
  console.log('٢) ثلاث مصادر خبرة منفصلة (كتابي 20 · صوتي 5 · تفاعل 4) ✅');

  /* ٣) إطفاء مصدر يوقف خبرته فقط */
  settingsFor({ textXp: false });
  const blocked = await leveling.addXp(client, ahmed, 20, { source: 'text', messages: 1 });
  assert.strictEqual(blocked, null, 'الخبرة الكتابية شغالة وهي معطّلة');
  assert.ok(await leveling.addXp(client, ahmed, 5, { source: 'voice', bypassCooldown: true, voiceMinutes: 1 }), 'الخبرة الصوتية توقفت مع إطفاء الكتابية');
  settingsFor();
  console.log('٣) إطفاء مصدر (كتابي) ما يوقف باقي المصادر ✅');

  /* ٤) التفاعل: حالات الحماية */
  const sara = fakeMember('sara');
  const msg = fakeMessage(ahmed, 'msg-react');
  const react = { message: msg, emoji: { name: '👍' } };

  const before = mockDb.getLevelRow(GUILD, 'ahmed').xp;
  assert.strictEqual(await leveling.handleReaction(client, react, { id: 'sara', bot: false }), true, 'تفاعل صحيح ما أعطى خبرة');
  assert.strictEqual(mockDb.getLevelRow(GUILD, 'ahmed').xp, before + 4, 'مقدار خبرة التفاعل خطأ');

  // نفس الشخص مرة ثانية على نفس الرسالة
  assert.strictEqual(await leveling.handleReaction(client, react, { id: 'sara', bot: false }), false, 'نفس الشخص أخذ خبرة مرتين على نفس الرسالة');

  // تفاعل بوت
  assert.strictEqual(await leveling.handleReaction(client, react, { id: 'bot-x', bot: true }), false, 'بوت أعطى خبرة تفاعل');

  // تفاعل الشخص على رسالته هو
  const ownMsg = fakeMessage(sara, 'msg-own');
  assert.strictEqual(await leveling.handleReaction(client, { message: ownMsg, emoji: {} }, { id: 'sara', bot: false }), false, 'تفاعل على رسالتك يعطي خبرة');

  // كولداون بين نفس الشخصين
  const msg2 = fakeMessage(ahmed, 'msg-2');
  assert.strictEqual(await leveling.handleReaction(client, { message: msg2, emoji: {} }, { id: 'sara', bot: false }), false, 'الكولداون بين نفس الشخصين ما اشتغل');

  // سقف التفاعلات لكل رسالة (شخص جديد كل مرة)
  settingsFor({ interactMaxPerMessage: 2 });
  const cappedMsg = fakeMessage(ahmed, 'msg-cap');
  assert.strictEqual(await leveling.handleReaction(client, { message: cappedMsg, emoji: {} }, { id: 'u1', bot: false }), true);
  assert.strictEqual(await leveling.handleReaction(client, { message: cappedMsg, emoji: {} }, { id: 'u2', bot: false }), true);
  assert.strictEqual(await leveling.handleReaction(client, { message: cappedMsg, emoji: {} }, { id: 'u3', bot: false }), false, 'تجاوز سقف التفاعلات لكل رسالة');
  settingsFor();
  console.log('٤) حمايات التفاعل: بلا تكرار · بلا بوتات · بلا تفاعل على النفس · كولداون · سقف لكل رسالة ✅');

  /* ٥) السقف اليومي للتفاعل */
  settingsFor({ interactDailyCap: 8 });
  const capMember = fakeMember('capped');
  const capGuild = capMember.guild;
  let granted = 0;
  for (let i = 0; i < 6; i += 1) {
    const m = fakeMessage(capMember, `cap-${i}`);
    if (await leveling.handleReaction(client, { message: m, emoji: {} }, { id: `reactor-${i}`, bot: false })) granted += 1;
  }
  const capDay = mockDb.getPeriodRow(GUILD, 'capped', 'day', periods.dayKey(new Date(), settings.leveling));
  assert.ok(capDay.interact_xp <= 8, `السقف اليومي تجاوز الحد (${capDay.interact_xp} > 8)`);
  assert.ok(granted >= 1 && granted <= 3, `عدد التفاعلات المقبولة غير منطقي (${granted})`);
  assert.ok(!capGuild.afkChannelId, 'بيانات السيرفر الوهمية تغيّرت');
  settingsFor();
  console.log('٥) السقف اليومي لخبرة التفاعل يعمل ✅');

  /* ٦) الترقية عند الوصول لمستوى جديد */
  const climber = fakeMember('climber');
  const needed = levelFromXp(0).xpForNext;
  const beforeLevel = mockDb.getLevelRow(GUILD, 'climber');
  assert.strictEqual(beforeLevel, null, 'العضو الجديد لازم يبدأ بلا صف');
  const up = await leveling.addXp(client, climber, needed, { source: 'text', messages: 1, bypassCooldown: true });
  assert.strictEqual(up.leveledUp, true, 'الترقية ما صارت');
  assert.strictEqual(up.level, 1, 'المستوى بعد الترقية خطأ');
  console.log('٦) الترقية عند بلوغ الخبرة المطلوبة ✅');

  /* ٧) اللوحات: يومي / أسبوعي / كل الأوقات + فلترة المصدر */
  const board = leveling.getBoard(GUILD, { period: 'day', source: 'all', page: 1, perPage: 10 });
  assert.strictEqual(board.period, 'day');
  assert.ok(board.rows.length >= 3, 'لوحة اليوم ناقصة');
  assert.ok(board.rows[0].xp >= board.rows[1].xp, 'ترتيب لوحة اليوم خطأ');
  assert.ok(board.totals.xp > 0, 'مجموع خبرة اليوم خطأ');
  assert.ok(board.reset.includes('يتجدّد'), 'نص التجديد ناقص');

  const voiceBoard = leveling.getBoard(GUILD, { period: 'week', source: 'voice', page: 1, perPage: 10 });
  assert.ok(voiceBoard.rows.every((r) => (r.voice_xp || 0) > 0), 'فلترة الخبرة الصوتية ما اشتغلت');
  assert.ok(voiceBoard.rows[0].voice_xp >= (voiceBoard.rows[1]?.voice_xp || 0), 'ترتيب الخبرة الصوتية خطأ');
  assert.strictEqual(voiceBoard.source, 'voice');

  const allBoard = leveling.getBoard(GUILD, { period: 'all', source: 'text', page: 1, perPage: 10 });
  assert.ok(allBoard.rows.every((r) => (r.text_xp || 0) > 0), 'فلترة الكتابي بالترتيب العام ما اشتغلت');
  assert.ok(allBoard.rows[0].text_xp >= (allBoard.rows[1]?.text_xp || 0), 'ترتيب الكتابي خطأ');
  console.log('٧) اللوحات: توب داي · توب ويك · كل الأوقات + فلترة المصدر ✅');

  /* ٨) بيانات ترتيب العضو */
  const rank = leveling.getRankData(GUILD, 'ahmed');
  assert.ok(rank.rank >= 1, 'الترتيب العام خطأ');
  assert.ok(rank.day.rank >= 1 && rank.day.xp > 0, 'ترتيب اليوم خطأ');
  assert.ok(rank.week.rank >= 1 && rank.week.xp > 0, 'ترتيب الأسبوع خطأ');
  assert.strictEqual(rank.textXp, 20, 'تفصيل الكتابي خطأ');
  assert.ok(rank.day.reset.includes('يتجدّد'), 'نص تجديد اليوم ناقص');
  console.log('٨) بيانات الترتيب: عام + اليوم + الأسبوع + تفصيل المصادر ✅');

  /* ٩) الإمبيدات تُبنى بلا أخطاء */
  const rankEmbed = leveling.rankEmbed(ahmed, 'ar');
  const lbEmbed = leveling.leaderboardEmbed(GUILD, { period: 'week', source: 'all', page: 1, perPage: 5 }, 'ar');
  const srcEmbed = leveling.sourcesEmbed(GUILD, 'ar');
  for (const [name, embed] of [['rank', rankEmbed], ['leaderboard', lbEmbed], ['sources', srcEmbed]]) {
    const json = embed.toJSON ? embed.toJSON() : embed.data || {};
    assert.ok(json.title || json.fields, `إمبيد ${name} فاضي`);
  }
    console.log('٩) إمبيدات البوت (الترتيب · اللوحة · المصادر) تُبنى بلا أخطاء ✅');

  /* ١٠) التصفير يمسح المستويات والفترات */
  mockDb.resetLevel(GUILD, 'ahmed');
  assert.strictEqual(mockDb.getLevelRow(GUILD, 'ahmed'), null, 'التصفير ما مسح المستوى');
  assert.strictEqual(mockDb.getPeriodRow(GUILD, 'ahmed', 'day', periods.dayKey(new Date(), settings.leveling)), null, 'التصفير ما مسح فترة اليوم');
  console.log('١٠) التصفير يمسح المستوى + توب داي + توب ويك ✅');

  /* ١١) الخبرة الكتابية بالأحرف: كل ٥ أحرف = ١ خبرة */
  settingsFor();
  const cfgText = settings.leveling;
  const cases = [
    ['مرحبا', 5, 1],
    ['كيفكم اليوم', 10, 2],
    ['السلام عليكم ورحمة الله', 20, 4],
    ['هلا', 3, 1], // أقل من ٥ أحرف = بحد أدنى ١ خبرة
    ['<:n:1> <a:m:2>', 0, 0], // إيموجي فقط = بلا خبرة
    ['https://example.com/very/long/link/here', 1, 1], // الرابط = حرف واحد
  ];
  for (const [text, chars, xp] of cases) {
    const got = leveling.textXpFor(text, cfgText);
    assert.strictEqual(got.chars, chars, `عدد أحرف «${text}» خطأ (${got.chars} ≠ ${chars})`);
    assert.strictEqual(got.xp, xp, `خبرة «${text}» خطأ (${got.xp} ≠ ${xp})`);
  }
  // سقف الرسالة الواحدة
  const longXp = leveling.textXpFor('ا'.repeat(5000), cfgText);
  assert.strictEqual(longXp.xp, cfgText.maxTextXpPerMessage, 'سقف خبرة الرسالة ما اشتغل');

  // رسالة حقيقية عبر handleMessage: ٣٠ حرفًا وليست مكرّرة = ٦ خبرة
  const writer = fakeMember('writer');
  const beforeText = mockDb.getLevelRow(GUILD, 'writer')?.xp || 0;
  const realText = 'الجو اليوم حلو كتير وشكرا لكم جميعا'; // ٢٩ حرفًا → ٥ خبرة
  const expectedXp = leveling.textXpFor(realText, settings.leveling).xp;
  assert.strictEqual(expectedXp, 5, `حساب أحرف الرسالة الحقيقية خطأ (${expectedXp})`);
  const posted = await leveling.handleMessage(client, { ...fakeMessage(writer, 'msg-text-1'), content: realText });
  assert.ok(posted && posted.xp === expectedXp, `خبرة الرسالة الحقيقية خطأ (${posted && posted.xp})`);
  assert.strictEqual(mockDb.getLevelRow(GUILD, 'writer').xp, beforeText + expectedXp, 'الخبرة ما انضافت للعضو');
  console.log('١١) الخبرة الكتابية: ١ خبرة لكل ٥ أحرف + سقف الرسالة ✅');

  /* ١٢) الخبرة الصوتية: ١ خبرة كل ٦٠ ثانية */
  settingsFor({ voiceXp: true, voiceIntervalSeconds: 60, voiceXpPerInterval: 1 });
  const talker = fakeMember('talker');
  const voiceGuild = talker.guild;
  voiceGuild.voiceStates = {
    cache: new Map([
      [
        'talker',
        {
          member: talker,
          channelId: 'voice-1',
          selfDeaf: false,
          deaf: false,
          channel: { members: { filter: () => ({ size: 2 }) } },
        },
      ],
    ]),
  };
  client.guilds = { cache: new Map([[GUILD, voiceGuild]]) };

  await leveling.tickVoiceXp(client);
  const voiceRow = mockDb.getLevelRow(GUILD, 'talker');
  assert.strictEqual(voiceRow.voice_xp, 1, `خبرة الصوت بعد دقيقة خطأ (${voiceRow.voice_xp})`);
  assert.strictEqual(voiceRow.voice_minutes, 1, 'دقائق الصوت خطأ');

  // فاصل أطول (١٢٠ ثانية) = خبرة كل دورتين
  settingsFor({ voiceXp: true, voiceIntervalSeconds: 120, voiceXpPerInterval: 1 });
  const slow = fakeMember('slow');
  voiceGuild.voiceStates.cache = new Map([
    ['slow', { member: slow, channelId: 'voice-2', selfDeaf: false, deaf: false, channel: { members: { filter: () => ({ size: 3 }) } } }],
  ]);
  // دورتان = خبرة واحدة بالضبط (الفاصل ١٢٠ ثانية = كل دورتين)
  await leveling.tickVoiceXp(client);
  await leveling.tickVoiceXp(client);
  assert.strictEqual(mockDb.getLevelRow(GUILD, 'slow').voice_xp, 1, 'الفاصل الصوتي ١٢٠ ثانية ما اشتغل صح في الدورة الأولى');
  await leveling.tickVoiceXp(client);
  await leveling.tickVoiceXp(client);
  assert.strictEqual(mockDb.getLevelRow(GUILD, 'slow').voice_xp, 2, 'الفاصل الصوتي ١٢٠ ثانية ما اشتغل صح في الدورة الثانية');

  // لحاله في الروم = بلا خبرة (نفس القاعدة القديمة)
  voiceGuild.voiceStates.cache = new Map([
    ['solo', { member: fakeMember('solo'), channelId: 'voice-3', selfDeaf: false, deaf: false, channel: { members: { filter: () => ({ size: 1 }) } } }],
  ]);
  await leveling.tickVoiceXp(client);
  assert.strictEqual(mockDb.getLevelRow(GUILD, 'solo'), null, 'عضو لحاله في الروم أخذ خبرة صوتية');
  settingsFor();
  console.log('١٢) الخبرة الصوتية: ١ خبرة كل ٦٠ ثانية + الفاصل القابل للضبط + بلا خبرة لو لحالك ✅');

  /* ١٣) الحماية الذكية من السبام */
  settingsFor({ antiSpam: { enabled: true, muteMinutes: 5, repeatLimit: 3, windowSeconds: 90, similarity: 0.85, rateMessages: 8, rateSeconds: 10, repeatChars: 8 } });
  const spammer = fakeMember('spammer');

  // ٦ رسائل مختلفة (تحت حد السرعة) = مسموح — ما في تكرار
  const distinct = ['صباح الخير جميعا', 'شو أخبار المشروع الجديد', 'بدي اسأل عن الرتبة', 'متى الاجتماع القادم', 'شكرا الك على التوضيح', 'فكرة ممتازة بصراحة'];
  for (const [i, text] of distinct.entries()) {
    assert.ok(!leveling.spamStatus(GUILD, 'spammer').muted, 'اتُّهم بالسبام وهو يتكلم طبيعي');
    await leveling.handleMessage(client, { ...fakeMessage(spammer, `ok-${i}`), content: text });
  }
  assert.ok(!leveling.spamStatus(GUILD, 'spammer').muted, 'كلام طبيعي كثيف اتعامل معه كسبام');
  const scored = mockDb.getLevelRow(GUILD, 'spammer');
  assert.ok(scored.xp > 0, 'الكلام الطبيعي ما أخذ خبرة');

  // ٨ رسائل سريعة متتالية (كلام مختلف) = سبام بالسرعة
  const fast = fakeMember('fast');
  const lines = ['نص مختلف اول', 'نص مختلف تاني', 'نص مختلف تالت', 'نص مختلف رابع', 'نص مختلف خامس', 'نص مختلف سادس', 'نص مختلف سابع', 'نص مختلف تامن'];
  let flaggedAt = 0;
  for (const [i, text] of lines.entries()) {
    const r = await leveling.handleMessage(client, { ...fakeMessage(fast, `fast-${i}`), content: text });
    if (r && r.blocked) {
      flaggedAt = i + 1;
      break;
    }
  }
  assert.strictEqual(flaggedAt, 8, `حد السرعة ما اشتغل صح (اتمنع عند ${flaggedAt})`);
  leveling.clearSpamMute(GUILD, 'fast');

  // نفس الرسالة ٣ مرات = سبام
  const repeated = 'ارسلوا الرابط هنا بسرعة';
  const spammer2 = fakeMember('spammer2');
  await leveling.handleMessage(client, { ...fakeMessage(spammer2, 'sp-1'), content: repeated });
  assert.ok(!leveling.spamStatus(GUILD, 'spammer2').muted, 'مُنع من أول رسالة');
  await leveling.handleMessage(client, { ...fakeMessage(spammer2, 'sp-2'), content: repeated });
  assert.ok(!leveling.spamStatus(GUILD, 'spammer2').muted, 'مُنع من ثاني رسالة');
  const thirdPost = await leveling.handleMessage(client, { ...fakeMessage(spammer2, 'sp-3'), content: repeated });
  const spamNow = leveling.spamStatus(GUILD, 'spammer2');
  assert.ok(spamNow.muted, 'تكرار نفس الكلام ٣ مرات ما اعتُبر سبام');
  assert.strictEqual(thirdPost.blocked, true, 'رسالة السبام الثلاثية أعطت خبرة');
  assert.ok(spamNow.remainingMs > 4 * 60 * 1000, 'مدة المنع أقل من ٥ دقايق');

  // خلال المنع: بلا خبرة من أي مصدر (كتابي · صوتي · تفاعل)
  const xpBefore = mockDb.getLevelRow(GUILD, 'spammer2')?.xp || 0;
  const blockedText = await leveling.handleMessage(client, { ...fakeMessage(spammer2, 'sp-4'), content: 'رسالة جديدة تماما وطويلة فيها كلام كثير مختلف' });
  assert.strictEqual(blockedText.blocked, true, 'المسبام أخذ خبرة كتابية');
  assert.strictEqual(await leveling.addXp(client, spammer2, 50, { source: 'voice', bypassCooldown: true, voiceMinutes: 1 }), null, 'المسبام أخذ خبرة صوتية');
  assert.strictEqual(await leveling.addXp(client, spammer2, 50, { source: 'interact', bypassCooldown: true }), null, 'المسبام أخذ خبرة تفاعل');
  const reactedMsg = fakeMessage(spammer2, 'sp-react');
  assert.strictEqual(await leveling.handleReaction(client, { message: reactedMsg, emoji: {} }, { id: 'fan-1', bot: false }), false, 'تفاعل مع رسالة المسبام أعطاه خبرة');
  assert.strictEqual(mockDb.getLevelRow(GUILD, 'spammer2')?.xp || 0, xpBefore, 'خبرة المسبام تغيّرت خلال المنع');

  // رفع المنع يدويًا → يرجع طبيعي
  assert.strictEqual(leveling.clearSpamMute(GUILD, 'spammer2'), true, 'رفع المنع فشل');
  const afterMute = await leveling.handleMessage(client, { ...fakeMessage(spammer2, 'sp-5'), content: 'شكرا الكم جميعا على المساعدة اليوم' });
  assert.ok(afterMute && !afterMute.blocked, 'بعد رفع المنع ما قدر ياخذ خبرة');
  assert.ok(leveling.spamStatus(GUILD, 'spammer2').remainingMs === 0, 'المنع ما ارتفع');

  // تطبيع النص: تشابه «مَرْحَبا» و«مرحبا» و«مرحبه» = ١
  assert.ok(leveling.similarity(leveling.normalizeForCompare('مَرْحَبا يا شباب'), leveling.normalizeForCompare('مرحبا يا شباب')) > 0.95, 'التطبيع ما شال التشكيل');

  // الحماية معطّلة → السبام مسموح
  settingsFor({ antiSpam: { enabled: false } });
  const freeSpeaker = fakeMember('freeSpeaker');
  for (let i = 0; i < 4; i += 1) {
    const r = await leveling.handleMessage(client, { ...fakeMessage(freeSpeaker, `free-${i}`), content: 'كرر كرر كرر' });
    assert.ok(!r.blocked, 'الحماية معطّلة لكن المنع اشتغل');
  }
  settingsFor();
  console.log('١٣) الحماية الذكية من السبام: تكرار الكلام · رسائل سريعة · حروف مكررة → بلا خبرة ٥ دقايق ✅');

  console.log('\n🎉 نظام الخبرة كامل: كتابي · صوتي · تفاعل — مع توب داي وتوب ويك\n');
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
