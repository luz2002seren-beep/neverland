'use strict';

/**
 * systems/textCommands.js
 * -------------------------------------------------------------
 * أوامر شات بلا بريفيكست + اختصارات بأي لغة + قواعد لكل أمر.
 *
 * اللغات: كل أمر عنده اختصاراته الإنجليزية والعربية افتراضيًا،
 * وصاحب السيرفر يضيف اختصارًا بأي لغة (عربي · تركي · إسباني · روسي…) من اللوحة.
 *
 * كيف تشتغل:
 *   ١) صاحب السيرفر يحدّد من اللوحة: تشغيل/إيقاف + اختصار لكل أمر
 *   ٢) أول الكلمة في الرسالة يُطابق الاختصار → يُنفَّذ الأمر نفسه
 *      بنفس الصلاحيات والتحقق تمامًا مثل السلاش (نفس command.run)
 *   ٣) الوسائط: ترتيبها نفسه مثل السلاش لكن ما فيه أسماء للوسائط
 *      مثال:  ban @العضو سبب 7d   ← نفس  /ban العضو السبب المدة
 *
 * الخصوصية: ما يرد أبدًا على البوتات ولا على رسائل الخاص.
 * الأمان: نفس فحص الصلاحيات + حد الاستخدام + سجل النشاط.
 * -------------------------------------------------------------
 */

const { MessageFlags } = require('discord.js');
const db = require('../database');
const catalog = require('../data/commandCatalog');
const { t } = require('../lib/i18n');

/** الأمر: شغّال بلا بريفيكست؟ وما هي اختصاراته؟ */
const PREFIX_KEY = 'textCommands';

/**
 * اختصارات عربية افتراضية لكل أمر — تُعرض في اللوحة وتُعدَّل منها (تزيد/تشيل).
 * أوامر الإدارة: الكلمات الشائعة المعروفة فقط حتى ما يصير إزعاج بالشات،
 * وأي كلمة ثانية بأي لغة تُضاف من قسم «اختصارات الأوامر».
 */
const AR_TRIGGERS = {
  help: ['مساعدة'],
  ping: ['بينغ'],
  botinfo: ['البوت'],
  serverinfo: ['السيرفر'],
  userinfo: ['معلوماتي'],
  avatar: ['افتار', 'صورتي'],
  top: ['توب', 'المتصدرين', 't'],
  leveling: ['لفل'],
  poll: ['تصويت'],
  remind: ['تذكير'],
  ban: ['حظر', 'باند'],
  unban: ['فك الحظر'],
  kick: ['طرد', 'كيك'],
  timeout: ['اسكت', 'كتم'],
  warn: ['تحذير', 'انذار'],
  purge: ['مسح', 'نظف'],
  lock: ['قفل', 'اقفل', 'سكر', 'قفلو', 'فتح', 'افتح', 'اخفاء', 'اخفي', 'اظهار', 'اظهر'],
  slowmode: ['بطيء'],
  /* أوامر الإدارة والضبط — كلمات عربية جاهزة كذلك */
  member: ['عضو'],
  role: ['رول', 'رتبة', 'رتب', 'اعطي', 'اعطاء'],
  settings: ['اعدادات', 'ضبط'],
  welcome: ['ترحيب'],
  autorole: ['رتبتلقائي'],
  autoreply: ['ردود'],
  autoline: ['فاصل'],
  autoreact: ['تفاعلات'],
  automod: ['حماية'],
  logs: ['سجلات', 'لوق'],
  tickets: ['تذاكر', 'تكت'],
  setup: ['اعداد', 'تهيئة'],
};

/**
 * اختصار ← الأمر الفرعي المقصود.
 *   «قفل» / «اقفل» / «سكر»  → lock channel  (يقفل الروم اللي تكتب فيه)
 *   «فتح» / «افتح»          → lock unlock   (يفتح الروم)
 * فالعضو يكتب كلمة وحدة بلا أي رمز وبلا خيارات، والأمر يتصرّف صح.
 */
const SUB_TRIGGERS = {
  lock: {
    قفل: 'channel',
    اقفل: 'channel',
    سكر: 'channel',
    قفلو: 'channel',
    فتح: 'unlock',
    افتح: 'unlock',
    اخفاء: 'hide',
    اخفي: 'hide',
    خفي: 'hide',
    اخفيه: 'hide',
    اظهار: 'show',
    اظهر: 'show',
    اظهرو: 'show',
  },
  /* التوب: يقبل القيم المختصرة — t day · t week · t month · t text week 2 */
  top: {
    'توب داي': { sub: null, defaults: { الفترة: 'day' } },
    'توب ويك': { sub: null, defaults: { الفترة: 'week' } },
    'توب منث': { sub: null, defaults: { الفترة: 'month' } },
    داي: { sub: null, defaults: { الفترة: 'day' } },
    ويك: { sub: null, defaults: { الفترة: 'week' } },
    منث: { sub: null, defaults: { الفترة: 'month' } },
  },
  /* التذاكر: «تذكير» داخل الغرفة = remind */
  tickets: {
    تذكير: { sub: 'remind' },
    ذكر: { sub: 'remind' },
    اضف: { sub: 'add' },
    أضف: { sub: 'add' },
  },
  /* «مسح» لحالها تنظّف ١٠٠ رسالة — زي أمر التنظيف في البوتات المعروفة */
  /* التحذيرات: «تحذير @عضو سبب» = إضافة تحذير (بدل ما يصير الأمر ساكت بلا رد) */
  warn: {
    'تحذير': { sub: 'add' },
    'انذار': { sub: 'add' },
    'حذر': { sub: 'add' },
    'تحذيرات': { sub: 'list', defaults: { 'العضو': null } },
  },
  /* إسكات/فك الإسكات بكلمة واحدة */
  timeout: { 'اسكات': { sub: 'add' }, 'اسكت': { sub: 'add' }, 'صامت': { sub: 'add' }, 'فك الاسكات': { sub: 'remove' }, 'شيل الاسكات': { sub: 'remove' } },
  purge: {
    مسح: { sub: 'messages', defaults: { العدد: 100 } },
    نظف: { sub: 'messages', defaults: { العدد: 100 } },
    نظفلي: { sub: 'messages', defaults: { العدد: 100 } },
    كلير: { sub: 'messages', defaults: { العدد: 100 } },
  },
};

/** الأمر الفرعي + القيم الافتراضية لاختصار معيّن (يدعم الشكل القديم: نص مباشر) */
function subTriggerFor(name, alias) {
  const mapped = SUB_TRIGGERS[name]?.[alias];
  if (!mapped) return null;
  return typeof mapped === 'string' ? { sub: mapped, defaults: {} } : mapped;
}

/** قواعد الأمر (خيارات تعديل الأمر): رومات · رتب · أنواع الردود */
/** سقف الاختصارات لكل أمر — رقم واحد يستعمله الحفظ والدمج واللوحة (كان ٥ بالحفظ و١٢ بالدمج) */
const MAX_ALIASES = 12;

const RULE_LISTS = ['enabledRoles', 'disabledRoles', 'enabledChannels', 'disabledChannels'];
const RULE_FLAGS = ['autoDeleteInvocation', 'autoDeleteWithMessage', 'autoDeleteReplyAfter5s'];

function emptyRules() {
  return {
    enabledRoles: [],
    disabledRoles: [],
    enabledChannels: [],
    disabledChannels: [],
    autoDeleteInvocation: false,
    autoDeleteWithMessage: false,
    autoDeleteReplyAfter5s: false,
  };
}

/** الإعدادات الافتراضية: تشغيل + الاختصارات المقترحة من الكتالوج */
function defaultsFor() {
  const aliases = {};
  for (const [name, meta] of Object.entries(catalog.COMMANDS)) {
    const list = Array.isArray(meta.aliases) ? [...meta.aliases] : [];
    for (const word of AR_TRIGGERS[name] || []) if (!list.includes(word)) list.push(word);
    aliases[name] = list;
  }
  return { enabled: true, aliases, cooldownSeconds: 0, disabled: [], suggest: true, perCommand: {} };
}

/**
 * اقتراح اختصار قصير لاسم أمر طويل (بلا تعارض مع أي أمر أو اختصار آخر):
 *   serverinfo → sinfo · userinfo → uinfo · timeout → tmout · autoReply → areply
 * @param {string} name اسم الأمر
 * @param {Set<string>} used الاختصارات المستعملة حاليًا
 */
function suggestAlias(name, used) {
  const lower = name.toLowerCase();
  const taken = new Set((used ? [...used] : []).map((x) => String(x).toLowerCase()));

  const patterns = [
    lower,
    lower.replace(/^(server|user|time|warn|lock|kick|ban|poll|help|ping|auto|member|slow)/, (m) => m[0]),
    lower.replace(/(info|reply|line|react|mod|role|levels|level|time|mode)/g, ''),
    lower.replace(/[aeiou]/g, ''),
  ];

  for (const candidate of patterns) {
    if (candidate && candidate.length >= 2 && !taken.has(candidate)) return candidate;
  }

  /* أخيرًا: أول ٣ حروف ثم رقم تسلسلي */
  const base = (lower.replace(/[^a-z]/g, '') || 'cmd').slice(0, 3);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

/** إعدادات هذا السيرفر بعد الدمج مع الافتراضي (بلا كتابة) */
function configFor(guildId) {
  const base = defaultsFor();
  const raw = db.getGuild(guildId).settings;
  const saved = raw?.[PREFIX_KEY] || {};

  /* المحذوف بنفسه من اللوحة: ما نرجّعه */
  const removedKeys = new Set(
    (Array.isArray(saved.removed) ? saved.removed : []).map((a) => aliasKey(a)).filter(Boolean),
  );

  const aliases = {};
  for (const [name, baseList] of Object.entries(base.aliases)) {
    const savedList = saved.aliases?.[name];
    const list = Array.isArray(savedList) ? savedList.map((a) => String(a).trim()).filter(Boolean) : [...baseList];
    const merged = [...list];
    for (const word of baseList) {
      const key = aliasKey(word);
      if (!key || removedKeys.has(key)) continue;
      if (!merged.some((a) => aliasKey(a) === key)) merged.push(word);
    }
    aliases[name] = merged.slice(0, MAX_ALIASES);
  }

  return {
    enabled: saved.enabled === undefined ? base.enabled : Boolean(saved.enabled),
    /* الكولداون مشيل من الأوامر — أي قيمة محفوظة قديمة تُتجاهل (صفر = بلا انتظار) */
    cooldownSeconds: 0,
    aliases,
    /* أوامر مطفية: ما تشتغل بلا بريفيكست (مفيدة للأوامر اللي اسمها كلمة إنجليزية شائعة) */
    disabled: Array.isArray(saved.disabled) ? saved.disabled.filter((n) => catalog.COMMANDS[n]) : base.disabled,
    /* اقتراح الأوامر المشابهة: لو كتب عضو كلمة تشبه أمرًا (طير · اسكت · bann) يردّ عليه بالبدائل */
    suggest: saved.suggest === undefined ? base.suggest : Boolean(saved.suggest),
    /* قواعد كل أمر: رومات ممنوعة/مسموحة · رتب · أنواع الردود */
    perCommand: saved.perCommand && typeof saved.perCommand === 'object' ? saved.perCommand : {},
  };
}

/** قواعد أمر واحد بعد الدمج مع الافتراضي (بلا كتابة) */
function rulesFor(guildId, commandName) {
  const saved = configFor(guildId).perCommand?.[commandName] || {};
  const rules = emptyRules();
  for (const key of RULE_LISTS) {
    rules[key] = Array.isArray(saved[key])
      ? saved[key].map((x) => String(x)).filter((x) => /^[0-9]{5,25}$/.test(x)).slice(0, 25)
      : [];
  }
  for (const key of RULE_FLAGS) rules[key] = Boolean(saved[key]);
  return rules;
}

/** هل الروم يسمح؟ (قنوات مفعّلة = قائمة بيضاء · معطّلة = قائمة سوداء) */
function channelAllowed(rules, channelId) {
  const id = String(channelId || '');
  if (!id) return true;
  if (rules.enabledChannels.length && !rules.enabledChannels.includes(id)) return false;
  if (rules.disabledChannels.includes(id)) return false;
  return true;
}

/** هل الرتب تسمح؟ (رتب معطّلة ← منع · رتب مفعّلة ← بس أصحابها) */
function roleAllowed(rules, member = {}) {
  if (!rules.enabledRoles.length && !rules.disabledRoles.length) return true;
  let ids = [];
  try { ids = [...(member.roles?.cache?.keys?.() || [])].map(String); } catch { ids = []; }
  if (rules.disabledRoles.some((r) => ids.includes(r))) return false;
  if (rules.enabledRoles.length && !rules.enabledRoles.some((r) => ids.includes(r))) return false;
  return true;
}

/** تعديل قواعد أمر (من اللوحة): رتب · رومات · أنواع الردود */
function setRules(guildId, commandName, patch = {}) {
  if (!catalog.COMMANDS[commandName]) return { ok: false, error: 'unknown_command' };

  const current = rulesFor(guildId, commandName);
  const next = emptyRules();
  for (const key of RULE_LISTS) {
    const list = patch[key] === undefined ? current[key] : [].concat(patch[key] || []);
    const ids = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
    const invalid = ids.filter((id) => !/^[0-9]{5,25}$/.test(id));
    if (invalid.length) return { ok: false, error: 'invalid_id', invalid };
    next[key] = ids.slice(0, 25);
  }
  for (const key of RULE_FLAGS) {
    next[key] = patch[key] === undefined ? current[key] : Boolean(patch[key]);
  }

  const saved = db.getGuild(guildId).settings?.[PREFIX_KEY]?.perCommand || {};
  db.updateGuildSettings(guildId, { [PREFIX_KEY]: { perCommand: { ...saved, [commandName]: next } } });
  return { ok: true, command: commandName, rules: rulesFor(guildId, commandName) };
}

/**
 * تنظيف الاختصار: أي لغة (عربي · إنجليزي · تركي · روسي…)، بلا مسافات، بحد أقصى ٢٠ حرفًا.
 *   • المسافات تُشال: «فك الحظر» تُخزَّن «فكالحظر» وتُكتب في الشات ككلمتين.
 *   • الرموز في الأول (# / !) تُشال.
 */
function normalizeAlias(value) {
  const clean = String(value || '')
    .trim()
    .replace(/^[#/!.,]+/, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .slice(0, 20);
  if (!clean) return '';
  return /^[\p{L}][\p{L}\p{N}_-]*$/u.test(clean) ? clean : '';
}

/** مفتاح المطابقة: شكل الاختصار منظّفًا (بلا مسافات وبرموز موحّدة) */
function aliasKey(value) {
  return normalizeAlias(value) || String(value || '').trim().toLowerCase();
}

/** شكل العرض: «فك الحظر» بدل «فكالحظر» — من الكلمات الافتراضية المعروفة */
function prettyAlias(alias) {
  const key = aliasKey(alias);
  for (const words of Object.values(AR_TRIGGERS)) {
    for (const word of words) if (aliasKey(word) === key) return word;
  }
  return String(alias || '');
}

/** كل الاختصارات مع أسماء الأوامر ومستخدِميها */
function aliasIndex(guildId) {
  const config = configFor(guildId);
  const map = new Map();
  for (const [name, list] of Object.entries(config.aliases)) {
    for (const alias of list) {
      const key = aliasKey(alias);
      if (key && !map.has(key)) map.set(key, name);
    }
  }
  return { config, map };
}

/** يحدّد اسم الأمر المطلوب من أول كلمة في الرسالة (أو null) */
function resolveCommand(guildId, word) {
  const word2 = normalizeAlias(word);
  if (!word2) return null;
  const { config, map } = aliasIndex(guildId);
  if (!config.enabled) return null;

  const found = map.get(word2) || Object.keys(catalog.COMMANDS).find((n) => n.toLowerCase() === word2) || null;
  if (!found) return null;
  if (config.disabled.includes(found)) return null;
  return found;
}

/* ------------------------------ سجل الحدود ------------------------------ */

const buckets = new Map(); // m:userId → آخر وقت

function onCooldown(message, seconds) {
  if (!seconds) return 0;
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const last = buckets.get(key) || 0;
  const remaining = seconds * 1000 - (now - last);
  if (remaining > 0) return Math.ceil(remaining / 1000);
  buckets.set(key, now);
  if (buckets.size > 5000) buckets.clear();
  return 0;
}

/** بحث موحّد داخل كاش ديسكورد (Collection) أو Map عادية */
function findIn(collection, predicate) {
  if (!collection) return null;
  if (typeof collection.find === 'function') return collection.find(predicate) || null;
  for (const value of collection.values()) if (predicate(value)) return value;
  return null;
}

/** أعضاء السيرفر للبحث بالاسم */
function findMember(guild, query) {
  const q = String(query || '').replace(/[<@!>]/g, '').toLowerCase();
  if (!q) return null;
  const cache = guild?.members?.cache;
  if (/^\d{15,25}$/.test(q)) {
    return (typeof cache?.get === 'function' ? cache.get(q) : null) || null;
  }
  return (
    findIn(cache, (m) => (m.user?.username || '').toLowerCase() === q)
    || findIn(cache, (m) => (m.user?.username || '').toLowerCase().startsWith(q))
    || findIn(cache, (m) => (m.displayName || '').toLowerCase() === q)
    || findIn(cache, (m) => (m.displayName || '').toLowerCase().startsWith(q))
    || null
  );
}

/** رتبة بالاسم أو الآيدي */
function findRole(guild, query) {
  const q = String(query || '').replace(/[<@&>]/g, '').toLowerCase();
  if (!q) return null;
  const cache = guild?.roles?.cache;
  if (/^\d{15,25}$/.test(q)) {
    return (typeof cache?.get === 'function' ? cache.get(q) : null) || null;
  }
  return (
    findIn(cache, (r) => (r.name || '').toLowerCase() === q)
    || findIn(cache, (r) => (r.name || '').toLowerCase().startsWith(q))
    || null
  );
}

/** روم بالاسم أو الآيدي */
function findChannel(guild, query) {
  const q = String(query || '').replace(/[<#>]/g, '').toLowerCase();
  if (!q) return null;
  const cache = guild?.channels?.cache;
  if (/^\d{15,25}$/.test(q)) {
    return (typeof cache?.get === 'function' ? cache.get(q) : null) || null;
  }
  return (
    findIn(cache, (c) => (c.name || '').toLowerCase() === q)
    || findIn(cache, (c) => (c.name || '').toLowerCase().startsWith(q))
    || null
  );
}

/** أسماء الوسائط ودلالتها (الأوامر عندنا بالعربي — نعتمد على الأسماء) */
const USER_NAMES = ['العضو', 'عضو', 'المستخدم', 'الشخص'];
const CHANNEL_NAMES = ['القناة', 'قناة', 'الروم'];
const ROLE_NAMES = ['الرتبة', 'رتبة'];
const REASON_NAMES = ['السبب', 'سبب', 'النص', 'الرسالة', 'الصيغة'];
const DURATION_NAMES = ['المدة', 'مدة', 'الوقت'];
const NUMBER_NAMES = ['العدد', 'الرقم', 'حذف_الرسائل', 'الصفحة', 'المستوى', 'الكولداون', 'حد_التكرار', 'عدد_الرسائل', 'خلال_ثواني', 'مدة_الإسكات', 'الفاصل_الصوتي', 'خبرة_كتابية_لكل_أحرف', 'سقف_الرسالة', 'خبرة_كل_فاصل_صوتي', 'حذف_بعد', 'حذف_بعد_ثواني', 'سقف_التفاعل_اليومي', 'مدة_منع_السبام'];

const BOOL_TRUE = ['نعم', 'yes', 'true', 'on', '1', 'تشغيل', 'فعل'];
const BOOL_FALSE = ['لا', 'no', 'false', 'off', '0', 'إيقاف', 'اطفاء', 'إطفاء'];

const isDurationToken = (t) => /^\d+\s*(s|m|h|d|w|mo|يوم|دقيقة|دقائق|ساعة|ساعات|ثانية|ثواني)?$/i.test(t) && /\d/.test(t);

const kindOf = (def) => {
  const name = def.name;
  if (def.type === 6 || USER_NAMES.includes(name)) return 'user';
  if (def.type === 7 || CHANNEL_NAMES.includes(name)) return 'channel';
  if (def.type === 8 || ROLE_NAMES.includes(name)) return 'role';
  if (def.type === 5) return 'bool';
  if (def.type === 4 || def.type === 10 || NUMBER_NAMES.includes(name)) return 'int';
  if (DURATION_NAMES.includes(name)) return 'duration';
  if (def.type === 3 || REASON_NAMES.includes(name)) return 'text';
  return 'text';
};

/**
 * ربط كلمات الرسالة بوسائط الأمر — بنفس تعريفات السلاش (مصدر الحقيقة).
 * القاعدة: الوسائط المكتوبة (عضو · روم · رتبة · مدة · رقم · نعم/لا) تُلتقط أولًا،
 * والباقي يروح للنصوص (مثل السبب) — حتى الفراغات داخل السبب ما تتقطّع.
 * @param {object} interaction الواجهة الوهمية (store داخلها)
 * @param {object[]} defs تعريفات الوسائط بالترتيب
 * @param {string[]} tokens كلمات المستخدم بعد اسم الأمر
 */
function bindArguments(interaction, guild, message, tokens, defs) {
  const store = interaction.__textArgs;
  const claimed = new Array(tokens.length).fill(false);
  const mentionMember = () => message.mentions?.members?.first?.() || null;
  const mentionChannel = () => message.mentions?.channels?.first?.() || null;

  /* ١) الوسائط المكتوبة */
  for (const def of defs) {
    const kind = kindOf(def);

    if (kind === 'user') {
      /*
       * العضو المطلوب يُحدَّد بمنشن صريح (@العضو) أو بآيديه الرقمي (123456789012345678).
       * الآيدي يشتغل حتى لو العضو برّا السيرفر (مثلًا حظر بالآيدي) — يُحلّ لاحقًا بشكل غير متزامن.
       */
      const isMention = (t) => /^<@!?\d+>$/.test(t);
      const isId = (t) => /^\d{17,20}$/.test(t);
      let idx = tokens.findIndex((t, i) => !claimed[i] && isMention(t));
      if (idx >= 0) {
        const id = tokens[idx].replace(/[^0-9]/g, '');
        const mentioned = mentionMember();
        const member = (mentioned && mentioned.id === id ? mentioned : null) || findMember(guild, tokens[idx]);
        claimed[idx] = true;
        if (member) store.set(def.name, { user: member.user, member });
        continue;
      }
      idx = tokens.findIndex((t, i) => !claimed[i] && isId(t));
      if (idx >= 0) {
        claimed[idx] = true;
        store.set(def.name, { userId: tokens[idx], raw: tokens[idx] });
      }
      continue;
    }

    if (kind === 'channel') {
      let idx = tokens.findIndex((t, i) => !claimed[i] && /^<#\d+>$/.test(t));
      if (idx < 0) idx = tokens.findIndex((t, i) => !claimed[i] && !!findChannel(guild, t));
      if (idx >= 0) {
        const channel = /^<#\d+>$/.test(tokens[idx]) ? mentionChannel() || findChannel(guild, tokens[idx]) : findChannel(guild, tokens[idx]);
        claimed[idx] = true;
        if (channel) store.set(def.name, { channel });
      }
      continue;
    }

    if (kind === 'role') {
      let idx = tokens.findIndex((t, i) => !claimed[i] && /^<@&\d+>$/.test(t));
      if (idx < 0) idx = tokens.findIndex((t, i) => !claimed[i] && !!findRole(guild, t));
      if (idx >= 0) {
        const role = findRole(guild, tokens[idx]);
        claimed[idx] = true;
        if (role) store.set(def.name, { role });
      }
      continue;
    }

    if (kind === 'bool') {
      const idx = tokens.findIndex((t, i) => !claimed[i] && (BOOL_TRUE.includes(t.toLowerCase()) || BOOL_FALSE.includes(t.toLowerCase())));
      if (idx >= 0) {
        claimed[idx] = true;
        store.set(def.name, { bool: BOOL_TRUE.includes(tokens[idx].toLowerCase()) });
      }
      continue;
    }

    if (kind === 'duration') {
      const idx = tokens.findIndex((t, i) => !claimed[i] && isDurationToken(t));
      if (idx >= 0) {
        claimed[idx] = true;
        store.set(def.name, { raw: tokens[idx], string: tokens[idx], duration: true });
      }
      continue;
    }

    if (kind === 'int') {
      /* من الآخر: الأرقام عادة في نهاية الأمر */
      let idx = -1;
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        if (!claimed[i] && /^-?\d+$/.test(tokens[i])) { idx = i; break; }
      }
      if (idx >= 0) {
        claimed[idx] = true;
        store.set(def.name, { int: Number(tokens[idx]), raw: tokens[idx], string: tokens[idx] });
      }
      continue;
    }
    /* النصوص: نتركها للمرحلة الثانية */
  }

  /* ١ب) النصوص اللي عندها خيارات محدّدة: نطابق القيمة بخياراتها (t day · t text week 2) */
  for (const def of defs) {
    if (kindOf(def) !== 'text' || !def.choices?.length) continue;
    const idx = tokens.findIndex((t, i) => !claimed[i] && def.choices.includes(String(t).toLowerCase()));
    if (idx >= 0) {
      claimed[idx] = true;
      store.set(def.name, { raw: tokens[idx], string: String(tokens[idx]).toLowerCase() });
    }
  }

  /* ٢) النصوص: الباقي غير المطالب به */
  const textDefs = defs.filter((d) => kindOf(d) === 'text');
  if (textDefs.length) {
    const leftovers = tokens.filter((_, i) => !claimed[i]);

    /* تصويت أو قوائم مفصولة بـ | : كل مقطع يروح لخيار */
    if (textDefs.length > 1 && leftovers.includes('|')) {
      const segments = tokens.join(' ').split('|').map((x) => x.trim()).filter(Boolean);
      textDefs.forEach((def, i) => {
        if (segments[i] !== undefined) store.set(def.name, { raw: segments[i], string: segments[i] });
      });
    } else if (textDefs.length === 1) {
      const value = leftovers.join(' ').trim();
      if (value) store.set(textDefs[0].name, { raw: value, string: value });
    } else {
      leftoverAssign(textDefs, leftovers, store);
    }
  }

  /* المتغيّر الشائع «العملية» (add/remove/enable…) إن جاء كأول كلمة ولم يُلتقط */
  const opName = defs.find((d) => ['العملية', 'عملية', 'الحماية', 'النوع', 'النمط', 'الوضع', 'اللغة', 'الفترة', 'الحالة'].includes(d.name) && !store.has(d.name));
  if (opName && !store.has(opName.name) && tokens.length && !claimed[0]) {
    claimed[0] = true;
    store.set(opName.name, { raw: tokens[0], string: tokens[0] });
  }
}

/**
 * توزيع النصوص الباقية على وسائط النص بالترتيب:
 *   - إذا آخر وسيط «سبب/نص» ← يأخذ باقي الجملة كاملة (ما تتقطّع)
 *   - غير هيك ← كلمة لكل وسيط (مثل: الفترة ثم النوع)، وأي زيادة تلحق بالأخير
 */
function leftoverAssign(defs, leftovers, store) {
  if (!leftovers.length) return;
  if (defs.length === 1) {
    store.set(defs[0].name, { raw: leftovers.join(' '), string: leftovers.join(' ') });
    return;
  }

  const lastDef = defs[defs.length - 1];
  const lastIsReason = REASON_NAMES.includes(lastDef.name);

  if (lastIsReason) {
    defs.slice(0, -1).forEach((def, i) => {
      if (leftovers[i] !== undefined) store.set(def.name, { raw: leftovers[i], string: leftovers[i] });
    });
    const tail = leftovers.slice(defs.length - 1).join(' ') || leftovers[leftovers.length - 1];
    if (tail) store.set(lastDef.name, { raw: tail, string: tail });
    return;
  }

  defs.forEach((def, i) => {
    const value = i === defs.length - 1 ? leftovers.slice(i).join(' ') : leftovers[i];
    if (value) store.set(def.name, { raw: value, string: value });
  });
}

/** تعريفات وسائط السلاش الفعلية لهذا الأمر (أو للأمر الفرعي المختار) */
function optionDefs(command, sub) {
  const json = command.data.toJSON();
  const map = new Map(); // name → { type, required }
  const collect = (options) => {
    for (const option of options || []) {
      if (option.type === 1 || option.type === 2) continue;
      map.set(option.name, {
        type: option.type,
        required: Boolean(option.required),
        /* الخيارات المسموحة (choices) — تُستخدم لمطابقة القيم المختصرة: t day · t text week 2 */
        choices: Array.isArray(option.choices) ? option.choices.map((c) => String(c.value).toLowerCase()) : null,
      });
    }
  };
  if (sub) {
    for (const option of json.options || []) {
      if ((option.type === 1 || option.type === 2) && option.name.toLowerCase() === sub) collect(option.options);
    }
  } else {
    /* بلا أمر فرعي: لو الأمر نفسه فيه أوامر فرعية نأخذ أول مجموعة وسائط عامة */
    collect(json.options);
  }
  return [...map.entries()].map(([name, meta]) => ({ name, type: meta.type, required: meta.required }));
}

/**
 * ينفّذ أمرًا مكتوبًا في الشات بلا بريفيكست.
 * @returns {Promise<boolean>} هل تعاملنا مع الرسالة؟
 */
const claimedMessages = new Set();

function claimMessage(id) {
  if (!id) return false;
  if (claimedMessages.has(id)) return true;
  claimedMessages.add(id);
  setTimeout(() => claimedMessages.delete(id), 20000).unref?.();
  return false;
}

async function handleMessage(client, message) {
  /* حماية: ما ننفّذ أوامر من البوتات ولا من رسائل الخاص */
  if (message.author?.bot || !message.guild) return false;

  const guildId = message.guild.id;
  const { config, map } = aliasIndex(guildId);
  if (!config.enabled) return false;

  const content = (message.content || '').trim();
  if (!content) return false;

  const parts = content.split(/\s+/);
  /* الاختصار إما كلمة وحدة أو كلمتين (مثل: «فك الحظر») — نجرّب الاثنين */
  let name = resolveCommand(guildId, parts[0]);
  let usedWords = 1;
  if (!name && parts.length > 1) {
    const two = resolveCommand(guildId, `${parts[0]}${parts[1]}`);
    if (two) { name = two; usedWords = 2; }
  }
  /* «تذكير» داخل غرفة تذكرة ⇒ تذكير صاحب التذكرة (وإلا = تذكيرك الشخصي العادي) */
  const firstKey = aliasKey(parts[0]);
  if (['تذكير', 'ذكر', 'ذكرني'].includes(firstKey) && db.getTicketByChannel(message.channel?.id)) {
    name = 'tickets';
    usedWords = 1;
  }
  if (!name) return false;
  if (claimMessage(message.id)) return true;

  const command = client.commands.get(name) || client.commands.get(Object.keys(client.commands).find((k) => k.toLowerCase() === name.toLowerCase()));
  if (!command) return false;

  /* الأمر الفرعي: الكلمة الثانية إن كان الأمر يقبل أوامر فرعية */
  const subNames = Object.keys(command.data.toJSON().options?.length ? subMap(command) : {});
  let sub = null;
  let args = parts.slice(usedWords);
  if (subNames.length && args.length && subNames.includes(args[0].toLowerCase())) {
    sub = args[0].toLowerCase();
    args = args.slice(1);
  }
  /* ولا كتب أمرًا فرعيًا؟ نستنتجه من نفس الاختصار: «قفل» ← channel · «مسح» ← messages */
  let subDefaults = {};
  if (!sub && subNames.length) {
    const used = aliasKey(parts.slice(0, usedWords).join(' '));
    const mapped = subTriggerFor(name, used);
    if (mapped && subNames.includes(mapped.sub)) {
      sub = mapped.sub;
      subDefaults = mapped.defaults || {};
    }
  }
  /* لو كتب الأمر الفرعي صريحًا وله قيم افتراضية، نطبّقها كذلك */
  if (sub && subNames.length) {
    const used = aliasKey(parts.slice(0, usedWords).join(' '));
    subDefaults = subTriggerFor(name, used)?.defaults || {};
  }
  args._subName = sub;

  /*
   * قواعد الأمر (نفس خيارات تعديل الأمر في البوتات المعروفة):
   *   • قنوات مفعّلة/معطّلة: الأمر يشتغل (أو ما يشتغل) إلا في رومات محددة.
   *   • رتب مفعّلة/معطّلة: مين يقدر يستعمل الأمر.
   *   • أنواع الردود: حذف رسالة الأمر · حذف الرد مع حذف رسالة العضو · حذف الرد بعد ٥ ثوانٍ.
   */
  const rules = rulesFor(guildId, name);
  const isGuildOwner = Boolean(message.guild?.ownerId) && String(message.guild.ownerId) === String(message.author.id);
  const bypassRules = isGuildOwner || require('../config').bot.developerIds.includes(message.author.id);
  const staffAnywhere = Boolean(
    message.member?.permissions?.has?.('Administrator')
    || message.member?.permissions?.has?.('ManageGuild'),
  );
  if (!channelAllowed(rules, message.channel?.id) && !bypassRules && !staffAnywhere) {
    await message.reply({
      content: 'هذا الأمر ما يشتغل في هذا الروم.',
      allowedMentions: { repliedUser: false },
    }).catch((err) => console.error('[أوامر] رد القيد فشل:', err?.message || err));
    return true;
  }
  if (!bypassRules && !roleAllowed(rules, message.member)) {
    await message.reply({
      content: 'هذا الأمر مو متاح لك — فيه قيود رتب من إعدادات السيرفر.',
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
    return true;
  }

  /* نحفظ القواعد للرد حتى تُطبَّق أنواع الحذف المختارة */
  pendingRules.set(message, rules);
  if (rules.autoDeleteInvocation) message.delete?.().catch?.(() => {});

  /* الصلاحيات: نفس شرط السلاش */
  const isDev = require('../config').bot.developerIds.includes(message.author.id);
  if (command.permissions?.length) {
    if (!message.member?.permissions?.has?.(command.permissions) && !isDev) {
      /*
       * أوامر الإدارة مو للأعضاء: نرفض بهدوء بلا ما نكشف كيف تُستعمل،
       * ونسجّلها في سجل النشاط حتى تعرف الإدارة مين حاول يستعملها.
       */
      const isAdminCommand = catalog.audienceOf(command.data.name) === 'staff';
      await message.reply({
        content: isAdminCommand
          ? 'هذا الأمر للإدارة فقط.'
          : (t('ar', 'common.noPermission') || 'ما عندك صلاحية لهذا الأمر.'),
        allowedMentions: { repliedUser: false },
      }).catch(() => {});

      try {
        require('../lib/audit').guild(null, guildId, {
          action: 'command.denied',
          target: command.data.name,
          detail: `${message.author.tag} حاول يستعمل أمر إدارة «${command.data.name}» بدون صلاحية`,
          actor: { id: message.author.id, name: message.author.tag },
          severity: 'warn',
        });
      } catch { /* السجل ما يوقف شي */ }

      return true;
    }
  }
  if (command.botPermissions?.length) {
    const me = message.guild.members.me;
    if (me && !me.permissions.has(command.botPermissions)) {
      await message.reply({ content: 'عندي نقص صلاحيات لأعمل هذا الأمر.', allowedMentions: { repliedUser: false } }).catch(() => {});
      return true;
    }
  }

  /* الكولداون مشيل نهائيًا من الأوامر: ما في أي انتظار بين أمر وأمر */
  const cooldownSeconds = 0;
  const wait = onCooldown(message, cooldownSeconds);
  if (wait > 0) {
    await message.reply({ content: `⏳ استنى ${wait} ثانية قبل ما تستعمل الأمر مرة ثانية.`, allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  /* واجهة وهمية بنفس شكل interaction حتى نعيد استخدام نفس الكود */
  const defs = optionDefs(command, sub);
  const mention = checkMention(message, args, defs);
  if (!mention.ok) {
    /* ناقص منشن: نرد ببطاقة الأمر نفسها + تنبيه بسيط (بدل رسالة نصية قصيرة) */
    const card = require('./suggestions').card(name, {
      guildId,
      note: `> اكتب الأمر مع **منشن العضو أو آيديه** — مثال: \`${asSlash(exampleFor(command, mention.option))}\` · أو \`${command.data.name} 123456789012345678\``,
    });
    await message.reply({ embeds: [card], allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  const fake = makeFakeInteraction(client, message, command, args, sub, subDefaults);
  await resolveIdArguments(fake, client);

  /*
   * ⚠️ مهم: التفاعل الوهمي لازم يمر بنفس محرّك ردود البوت (شكل الرد + الترجمة + الخط)
   * حتى تطلع ردود أوامر الشات زي «قفل» · «احذر» · «امسح» · «بان» **نصًا عاديًا بلا إمبد**
   * نفس ما تطلع من السلاش — وإلا كان الرد يوصل بإطاره (إمبد) لأن هذا المسار ما كان ملفوفًا.
   */
  try {
    require('../lib/replies').wrapInteraction(fake);
  } catch (err) {
    console.error('[تنبيه] تعذّر تجهيز شكل ردود أمر الشات:', err.message);
  }

  try {
    console.log(`[أوامر] نص ${message.author?.username || message.author?.id} «${parts.slice(0, usedWords).join(' ')}» → ${name}${sub ? ' ' + sub : ''} في ${message.channel?.id}`);
    await Promise.race([
      command.run(client, fake, 'ar'),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('الأمر تعدّى ٨ ثوانٍ بلا رد')), 8000);
        timer.unref?.();
      }),
    ]);

    /* سجل النشاط: من استعمل أي أمر */
    try {
      require('../lib/audit').guild(null, guildId, {
        action: 'command.text',
        target: name + (sub ? ` ${sub}` : ''),
        detail: `${message.author.tag} استعمل ${name}${sub ? ` ${sub}` : ''} بدون بريفيكست`,
        actor: { id: message.author.id, name: message.author.tag },
      });
    } catch { /* السجل ما يوقف الأمر أبدًا */ }
  } catch (err) {
    console.error('[خطأ] تنفيذ أمر نصي:', err.message);
    await fake.reply({ content: 'صار خطأ أثناء تنفيذ الأمر.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return true;
}

/**
 * فحص شرط العضو: الأوامر اللي تحتاج عضو (ban · kick · timeout …)
 * ما تنفّذ إلا لما يكون فيه **منشن صريح @العضو** لنفس الشخص المذكور.
 *   • الرد على رسالة شخص ← ما ينفع
 *   • كتابة الاسم بلا منشن ← ما ينفع
 *   • منشن لعضو مو موجود بالسيرفر ← ما ينفع
 * @returns {{ok: boolean, option?: string}}
 */
function checkMention(message, args, defs) {
  const need = defs.find((def) => kindOf(def) === 'user' && def.required);
  if (!need) return { ok: true };

  /* منشن صريح أو آيدي رقمي — الآيدي مسموح حتى لو العضو برّا السيرفر */
  const token = args.find((t) => /^<@!?\d+>$/.test(String(t)) || /^\d{17,20}$/.test(String(t)));
  if (!token) return { ok: false, option: need.name };
  if (/^\d{17,20}$/.test(String(token))) return { ok: true };

  const id = String(token).replace(/[^0-9]/g, '');
  const mentioned = message.mentions?.members?.first?.() || null;
  const resolved = (mentioned && String(mentioned.id) === id ? mentioned : null)
    || findMember(message.guild, token);
  if (!resolved) return { ok: false, option: need.name };

  return { ok: true };
}

/** أي سطر مثال يبدأ بـ «/» */
function asSlash(line) {
  const value = String(line || '').trim();
  if (!value) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

/** مثال كتابة جاهز من كتالوج الأوامر (أو من الخيارات نفسها) */
function exampleFor(command, optionName) {
  const meta = catalog.COMMANDS[command.data.name];
  const fromCatalog = meta?.examples?.[0] || meta?.usage?.[0];
  if (fromCatalog && fromCatalog.includes('@')) return fromCatalog;
  const opts = optionDefs(command, null)
    .map((def) => (kindOf(def) === 'user' ? '@العضو' : def.required ? `<${def.name}>` : `[${def.name}]`));
  return [command.data.name, ...opts].join(' ');
}

/** خريطة الأوامر الفرعية لاسم الأمر */
function subMap(command) {
  const json = command.data.toJSON();
  const map = {};
  for (const option of json.options || []) {
    if (option.type === 1 || option.type === 2) map[option.name.toLowerCase()] = option;
  }
  return map;
}

/**
 * واجهة تفاعل وهمية: نفس الدوال التي تستعملها الأوامر (reply / editReply / deferReply / options)
 * لكن مبنية على رسالة الشات.
 */
function makeFakeInteraction(client, message, command, args, sub, subDefaults = {}) {
  const json = command.data.toJSON();
  const optionTypes = {};
  const walk = (options, prefix = '') => {
    for (const option of options || []) {
      if (option.type === 1 || option.type === 2) walk(option.options, option.name);
      else optionTypes[option.name] = TYPE_NAME[option.type] || 'string';
    }
  };
  walk(json.options);

  const store = new Map();
  const defs = optionDefs(command, sub);
  const interaction = {
    __textArgs: store,
    __textOptionTypes: optionTypes,
    __fromText: true,
    commandName: json.name,
    guild: message.guild,
    guildId: message.guild.id,
    channel: message.channel,
    channelId: message.channel.id,
    user: message.author,
    member: message.member,
    client,
    locale: 'ar',
    createdAt: message.createdAt,
    createdTimestamp: message.createdTimestamp,
    replied: false,
    deferred: false,
    responded: false,
    isChatInputCommand: () => true,
    inGuild: () => true,

    options: {
      getSubcommand: () => sub,
      getSubcommandGroup: () => null,
      getUser: (n) => store.get(n)?.user ?? null,
      getMember: (n) => store.get(n)?.member ?? null,
      getChannel: (n) => store.get(n)?.channel ?? null,
      getRole: (n) => store.get(n)?.role ?? null,
      getString: (n) => (store.get(n)?.string ?? store.get(n)?.raw ?? null),
      getInteger: (n) => (store.get(n)?.int ?? (Number.isFinite(Number(store.get(n)?.raw)) ? Number(store.get(n).raw) : null)),
      getNumber: (n) => (store.get(n)?.int ?? null),
      getBoolean: (n) => {
        if (store.get(n)?.bool !== undefined) return store.get(n).bool;
        const value = String(store.get(n)?.raw ?? store.get(n)?.string ?? '').toLowerCase();
        if (!value) return null;
        if (BOOL_TRUE.includes(value)) return true;
        if (BOOL_FALSE.includes(value)) return false;
        return null;
      },
      getFocused: () => '',
      getAttachment: () => null,
    },

    /* الردود: كلها تروح لنفس رسالة الشات */
    async reply(payload) { interaction.replied = true; return replyToMessage(message, payload); },
    async editReply(payload) { return replyToMessage(message, payload); },
    async followUp(payload) { return replyToMessage(message, payload); },
    async deferReply() { interaction.deferred = true; return undefined; },
    async update(payload) { return replyToMessage(message, payload); },
    async deleteReply() { return undefined; },
    async fetchReply() { return message; },
  };

  bindArguments(interaction, message.guild, message, args, defs);

  /* قيم افتراضية للاختصارات المختصرة: «مسح» ← ١٠٠ رسالة (بدل ما يطلب رقمًا) */
  for (const [optionName, value] of Object.entries(subDefaults || {})) {
    if (!store.has(optionName)) store.set(optionName, { int: Number(value), raw: String(value), string: String(value) });
  }
  return interaction;
}

/**
 * يحوّل الآيديهات الرقمية المكتوبة في الشات إلى مستخدم/عضو حقيقي.
 * العضو ممكن يكون برّا السيرفر — نجيب المستخدم من ديسكورد مباشرة.
 * @param {object} interaction التفاعل الوهمي (فيه __textArgs)
 * @param {import('discord.js').Client} client
 */
async function resolveIdArguments(interaction, client) {
  const store = interaction?.__textArgs;
  if (!store) return;
  for (const [name, entry] of store) {
    if (!entry || !entry.userId) continue;
    const guild = interaction.guild;

    let member = null;
    if (guild?.members) {
      member = guild.members.cache?.get?.(entry.userId) || null;
      if (!member) member = await guild.members.fetch(entry.userId).catch(() => null);
    }

    let user = member?.user || client?.users?.cache?.get?.(entry.userId) || null;
    if (!user && client?.users?.fetch) user = await client.users.fetch(entry.userId).catch(() => null);
    if (!user) continue;

    store.set(name, { user, member, raw: entry.raw, string: entry.raw });
  }
}

/** قواعد الأمر الجارية لكل رسالة (تستخدمها replyToMessage) */
const pendingRules = new WeakMap();

/**
 * «حذف الرد لما يحذف العضو رسالته» — بمستمع **واحد** لكل البوت (messageId ← ردّه).
 * قبل: مستمع لكل استعمال أمر، ومع كثرة الاستعمال يقترب من سقف Node.
 */
const deleteWithMessage = new Map();
const DELETE_LINK_MAX = 5000;
let deleteWatcherReady = false;

function watchDeletes(client) {
  if (deleteWatcherReady || !client?.on) return;
  deleteWatcherReady = true;
  client.on('messageDelete', (deleted) => {
    const link = deleteWithMessage.get(deleted?.id);
    if (!link) return;
    deleteWithMessage.delete(deleted.id);
    const channel = client.channels?.cache?.get?.(link.channelId);
    channel?.messages?.delete?.(link.replyId)?.catch?.(() => {});
  });
}

function rememberReply(message, sent) {
  if (deleteWithMessage.size > DELETE_LINK_MAX) {
    const first = deleteWithMessage.keys().next().value;
    if (first) deleteWithMessage.delete(first);
  }
  deleteWithMessage.set(message.id, { replyId: sent.id, channelId: message.channel?.id });
}

function payloadBody(payload) {
  const safe = { ...(payload || {}) };
  delete safe.flags;
  delete safe.ephemeral;
  delete safe.ephemeral;
  const body = { allowed_mentions: { parse: [] } };
  if (typeof safe.content === 'string' && safe.content.trim()) body.content = safe.content.slice(0, 2000);
  if (safe.embeds) {
    const embeds = (Array.isArray(safe.embeds) ? safe.embeds : [safe.embeds])
      .map((embed) => (embed && typeof embed.toJSON === 'function' ? embed.toJSON() : embed))
      .filter(Boolean)
      .slice(0, 10);
    if (embeds.length) body.embeds = embeds;
  }
  if (!body.content && !body.embeds) body.content = 'تم.';
  return body;
}

function replyToMessage(message, payload) {
  const rules = pendingRules.get(message) || {};
  const lifetime = rules.autoDeleteReplyAfter5s ? 5000 : 0;
  const channelId = message.channel?.id || message.channelId;
  const client = message.client || message.guild?.client;
  const body = payloadBody(payload);
  if (message.id) body.message_reference = { message_id: message.id };
  console.log(`[أوامر] إرسال ${channelId}`);

  const remember = (sent) => {
    if (!sent?.id) return sent;
    console.log(`[أوامر] وصل ${sent.id} في ${channelId}`);
    if (lifetime > 0) {
      const timer = setTimeout(() => {
        client?.rest?.delete(`/channels/${channelId}/messages/${sent.id}`).catch(() => {});
      }, lifetime);
      timer.unref?.();
    }
    if (rules.autoDeleteWithMessage) {
      try {
        watchDeletes(client);
        rememberReply(message, sent);
      } catch { /* ما نوقف الأمر */ }
    }
    return sent;
  };

  const restSend = () => client.rest.post(`/channels/${channelId}/messages`, { body }).then(remember);
  if (client?.rest && channelId) {
    return restSend().catch((err) => {
      console.error('[أوامر] REST فشل:', err?.message || err);
      if (!message.channel?.send) return null;
      return message.channel.send({
        content: body.content || 'تم.',
        embeds: body.embeds,
        allowedMentions: { repliedUser: false },
      }).then(remember).catch((err2) => {
        console.error('[أوامر] الإرسال فشل:', err2?.message || err2);
        return null;
      });
    });
  }
  return message.reply({ allowedMentions: { repliedUser: false }, content: body.content || 'تم.' })
    .then(remember)
    .catch((err) => {
      console.error('[أوامر] الرد فشل:', err?.message || err);
      return null;
    });
}

const TYPE_NAME = { 3: 'string', 4: 'int', 5: 'bool', 6: 'user', 7: 'channel', 8: 'role', 9: 'mention', 10: 'number', 11: 'attachment' };

/** أدوات اللوحة: عرض/تعديل الاختصارات + كشف التعارض */
function adminSnapshot(guildId, commandNames = [], { staffViewer = true } = {}) {
  const config = configFor(guildId);
  const used = new Map();
  for (const [name, list] of Object.entries(config.aliases)) {
    for (const alias of list) {
      const key = aliasKey(alias);
      if (key && !used.has(key)) used.set(key, name);
    }
  }

  /* كل الأسماء والاختصارات المستعملة — نبني عليها الاقتراحات خطوة بخطوة حتى لا تتعارض */
  const reserved = new Set(Object.keys(catalog.COMMANDS).map((n) => n.toLowerCase()));
  for (const alias of used.keys()) reserved.add(alias);
  for (const alias of used.keys()) reserved.add(aliasKey(alias));

  /*
   * غير الإداري ما يشوف أوامر الإدارة إطلاقًا في اللوحة — لا في الاختصارات ولا في المكتبة،
   * حتى ما يخبّ شي في السيرفر. الإدارة تشوف كل الأوامر مع جمهور كل أمر.
   */
  const entries = Object.entries(catalog.COMMANDS)
    .filter(([name, meta]) => staffViewer || catalog.audienceOf(name, meta) === 'member');

  const items = entries.map(([name, meta]) => {
    const aliases = config.aliases[name] || [];
    const conflict = aliases.filter((a) => used.get(aliasKey(a)) && used.get(aliasKey(a)) !== name);
    const suggested = suggestAlias(name, reserved);
    reserved.add(suggested);
    const audience = catalog.audienceOf(name, meta);
    return {
      name,
      label: meta.label,
      what: meta.what,
      audience,
      audienceLabel: catalog.AUDIENCES[audience]?.label || audience,
      audienceBadge: catalog.AUDIENCES[audience]?.badge || audience,
      audienceDesc: catalog.AUDIENCES[audience]?.desc || '',
      category: meta.category || null,
      real: commandNames.includes(name),
      text: meta.text !== false,
      enabled: !config.disabled.includes(name),
      perm: meta.perm,
      usage: meta.usage,
      examples: meta.examples,
      subs: meta.subs || null,
      aliases,
      aliasLabels: aliases.map(prettyAlias),
      suggested,
      conflict,
      rules: rulesFor(guildId, name),
    };
  });

  const allNames = Object.keys(catalog.COMMANDS);
  const memberNames = catalog.namesOf('member');
  const staffNames = catalog.namesOf('staff');

  return {
    enabled: config.enabled,
    cooldownSeconds: config.cooldownSeconds,
    disabled: config.disabled,
    suggest: config.suggest,
    items,
    audiences: catalog.AUDIENCES,
    counts: {
      total: items.length,
      member: items.filter((i) => i.audience === 'member').length,
      staff: items.filter((i) => i.audience === 'staff').length,
      /* الموجود في البوت كله — حتى لو ما ظهر لغير الإداري */
      allTotal: allNames.length,
      allMember: memberNames.length,
      allStaff: staffNames.length,
      hiddenFromViewer: staffViewer ? 0 : staffNames.length,
    },
  };
}

/** تعديل اختصار (أو قائمة اختصارات) لأمر — يعيد الرسالة المناسبة */
function setAliases(guildId, commandName, aliases) {
  if (!catalog.COMMANDS[commandName]) return { ok: false, error: 'unknown_command' };

  const raw = [].concat(aliases || []).map((a) => String(a || '').trim()).filter(Boolean);
  const invalid = raw.filter((a) => !normalizeAlias(a));
  if (invalid.length) return { ok: false, error: 'invalid_alias', invalid };
  if (raw.length > MAX_ALIASES) return { ok: false, error: 'too_many', max: MAX_ALIASES };
  const seen = new Set();
  const clean = raw.filter((a) => {
    const key = aliasKey(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const current = configFor(guildId);
  /* منع التعارض مع أوامر ثانية */
  const takenBy = {};
  const newKeys = new Set(clean.map(aliasKey));
  for (const [name, list] of Object.entries(current.aliases)) {
    if (name === commandName) continue;
    for (const alias of list) if (newKeys.has(aliasKey(alias))) takenBy[alias] = name;
  }
  if (Object.keys(takenBy).length) return { ok: false, error: 'alias_taken', takenBy };

  const next = { ...current.aliases, [commandName]: clean };
  const saved = db.getGuild(guildId).settings?.[PREFIX_KEY] || {};
  const prevRemoved = Array.isArray(saved.removed) ? saved.removed : [];
  const baseWords = defaultsFor().aliases[commandName] || [];
  const cleanKeys = new Set(clean.map(aliasKey));
  const removed = [...new Set([...prevRemoved, ...baseWords.filter((w) => !cleanKeys.has(aliasKey(w)))])]
    .filter((w) => !cleanKeys.has(aliasKey(w)));
  db.updateGuildSettings(guildId, { [PREFIX_KEY]: { aliases: next, removed } });
  return { ok: true, aliases: clean, removed };
}

/** تشغيل/إيقاف النظام أو تغيير حد الاستخدام */
function setOptions(guildId, patch = {}) {
  const clean = {};
  if (patch.enabled !== undefined) clean.enabled = Boolean(patch.enabled);
  if (patch.cooldownSeconds !== undefined) clean.cooldownSeconds = Math.min(60, Math.max(0, Number(patch.cooldownSeconds) || 0));
  if (patch.disabled !== undefined) {
    clean.disabled = [...new Set([].concat(patch.disabled).filter((n) => catalog.COMMANDS[n]))];
  }
  if (patch.suggest !== undefined) clean.suggest = Boolean(patch.suggest);
  if (!Object.keys(clean).length) return { ok: false, error: 'empty' };
  db.updateGuildSettings(guildId, { [PREFIX_KEY]: clean });
  return { ok: true, config: configFor(guildId) };
}

/** تشغيل/إطفاء أمر واحد بلا بريفيكست */
function setCommandEnabled(guildId, commandName, enabled) {
  if (!catalog.COMMANDS[commandName]) return { ok: false, error: 'unknown_command' };
  const config = configFor(guildId);
  const disabled = new Set(config.disabled);
  if (enabled) disabled.delete(commandName);
  else disabled.add(commandName);
  const result = setOptions(guildId, { disabled: [...disabled] });
  if (!result.ok) return result;
  return { ok: true, command: commandName, enabled: Boolean(enabled), disabled: [...disabled] };
}

module.exports = {
  PREFIX_KEY,
  MAX_ALIASES,
  aliasKey,
  SUB_TRIGGERS,
  prettyAlias,
  AR_TRIGGERS,
  RULE_LISTS,
  RULE_FLAGS,
  emptyRules,
  rulesFor,
  setRules,
  channelAllowed,
  roleAllowed,
  setCommandEnabled,
  setOptions,
  defaultsFor,
  configFor,
  normalizeAlias,
  suggestAlias,
  resolveCommand,
  aliasIndex,
  handleMessage,
  adminSnapshot,
  setAliases,
  setOptions,
  makeFakeInteraction,
  bindArguments,
  resolveIdArguments,
  optionDefs,
  findMember,
  findRole,
  findChannel,
  findIn,
};
