'use strict';

/**
 * data/commandCatalog.js
 * -------------------------------------------------------------
 * كتالوج الأوامر: مصدر واحد يقرأه البوت (الأوامر بلا بريفيكست)
 * والموقع (لوحة الاختصارات + لوحة الشرح).
 *
 * لكل أمر:
 *   label    الاسم العربي المختصر
 *   what     شرح بسطر واحد — شو يعمل بالضبط
 *   usage    كيف يُكتب (اسم الأمر إنجليزي + الوسائط بالعربي)
 *   examples أمثلة جاهزة تنسخ وتلصق
 *   aliases  اختصارات جاهزة (يقدر صاحب السيرفر يعدّلها من الموقع)
 *   perm     الصلاحية المطلوبة (null = للجميع)
 *   audience 'member' = أمر عضو عادي (ظاهر ومتاح للجميع) · 'staff' = أمر إدارة (مخفي عن الأعضاء)
 *   text     true = يشتغل مباشرة في الشات بلا بريفيكست
 *   subs     الأوامر الفرعية وشرحها
 *
 * ملاحظة: هذا الملف ما يستورد discord.js — يشتغل حتى والموقع شغّال لحاله.
 * -------------------------------------------------------------
 */

/** تصنيفات الأوامر */
const CATEGORIES = {
  general: 'عام',
  moderation: 'الإدارة',
  config: 'الإعدادات',
  utility: 'أدوات',
};

const COMMANDS = {
  /* ============================== عام ============================== */
  help: {
    category: 'general',
    label: 'المساعدة',
    what: 'يعرض كل الأوامر أو شرح أمر واحد بالتفصيل.',
    usage: ['help', 'help <الأمر>'],
    examples: ['help', 'help ban', 'help timeout'],
    aliases: ['h'],
    perm: null,
    audience: 'member',
    text: true,
  },
  ping: {
    category: 'general',
    label: 'سرعة البوت',
    what: 'قياس سرعة استجابة البوت وحالة الاتصال والذاكرة.',
    usage: ['ping'],
    examples: ['ping'],
    aliases: [],
    perm: null,
    audience: 'member',
    text: true,
  },
  botinfo: {
    category: 'general',
    label: 'معلومات البوت',
    what: 'عدد السيرفرات والأعضاء وعدد الأوامر ومدة التشغيل.',
    usage: ['botinfo'],
    examples: ['botinfo'],
    aliases: ['bi'],
    perm: null,
    audience: 'member',
    text: true,
  },
  serverinfo: {
    category: 'general',
    label: 'معلومات السيرفر',
    what: 'تفاصيل السيرفر: الأعضاء والقنوات والرتب وتاريخ الإنشاء.',
    usage: ['serverinfo'],
    examples: ['serverinfo'],
    aliases: ['si'],
    perm: null,
    audience: 'member',
    text: true,
  },
  userinfo: {
    category: 'general',
    label: 'معلومات عضو',
    what: 'حساب العضو وتاريخ دخوله والرتب والعقوبات المسجّلة عليه.',
    usage: ['userinfo [@العضو]'],
    examples: ['userinfo', 'userinfo @العضو'],
    aliases: ['ui', 'whois'],
    perm: null,
    audience: 'member',
    text: true,
  },
  avatar: {
    category: 'general',
    label: 'صورة العضو',
    what: 'يعرض صورة العضو أو صورة السيرفر بحجم كبير.',
    usage: ['avatar [@العضو] [النوع]'],
    examples: ['avatar', 'avatar @العضو', 'avatar @العضو server'],
    aliases: ['av'],
    perm: null,
    audience: 'member',
    text: true,
  },
  top: {
    category: 'general',
    label: 'المتصدّرون',
    what: 'لوحة المتصدّرين: توب داي · توب ويك · توب منث — كتابي أو صوتي أو تفاعل، مع صفحات.',
    usage: ['top [النوع] [الفترة] [الصفحة]', 't day · t week · t month'],
    examples: ['top', 'top day', 'top week', 'top month', 'top text day', 'top voice week 2', 't day', 't text week 2'],
    aliases: ['leaderboard', 'lb', 't'],
    perm: null,
    audience: 'member',
    text: true,
  },

  /* ============================== الإدارة ============================== */
  ban: {
    category: 'moderation',
    label: 'حظر عضو',
    what: 'حظر عضو من السيرفر — دائم أو مؤقت (يُفك تلقائيًا بعد المدة). يشتغل بالمنشن أو بالآيدي، وسواء العضو داخل السيرفر أو برّا (حظر بالآيدي).',
    usage: ['ban <@العضو|آيدي> [السبب] [المدة] [حذف_الرسائل]'],
    examples: ['ban @العضو سبام', 'ban 123456789012345678 سبام', 'ban 123456789012345678 إزعاج 7d', 'ban @العضو روابط 2h 1'],
    aliases: ['b'],
    perm: 'حظر الأعضاء',
    audience: 'staff',
    text: true,
  },
  unban: {
    category: 'moderation',
    label: 'فك الحظر',
    what: 'رفع الحظر عن عضو بالآيدي أو المنشن أو الاسم — يشتغل للعضو داخل السيرفر أو برّا.',
    usage: ['unban <آيدي أو منشن أو اسم> [السبب]'],
    examples: ['unban 123456789012345678', 'unban @العضو اعتذر', 'unban 123456789012345678 اعتذر'],
    aliases: ['ub'],
    perm: 'حظر الأعضاء',
    audience: 'staff',
    text: true,
  },
  kick: {
    category: 'moderation',
    label: 'طرد عضو',
    what: 'طرد العضو من السيرفر بالمنشن أو الآيدي. لو العضو برّا السيرفر يوضّح إن ديسكورد ما يسمح، ويرشدك لـ ban بالآيدي.',
    usage: ['kick <@العضو|آيدي> [السبب]'],
    examples: ['kick @العضو مخالفة القوانين', 'kick 123456789012345678 مخالفة'],
    aliases: ['k'],
    perm: 'طرد الأعضاء',
    audience: 'staff',
    text: true,
  },
  timeout: {
    category: 'moderation',
    label: 'إسكات عضو',
    what: 'إسكات العضو مدة محدّدة (ما يقدر يكتب ولا يتكلم)، مع إضافة/إزالة وعرض القائمة.',
    usage: ['timeout add <@العضو> <المدة> [السبب]', 'timeout remove <@العضو> [السبب]', 'timeout list'],
    examples: ['timeout add @العضو 10m إزعاج', 'timeout remove @العضو', 'timeout list'],
    aliases: ['mute', 'to'],
    perm: 'إسكات الأعضاء',
    audience: 'staff',
    text: true,
    subs: {
      add: 'إسكات عضو مدة محدّدة مثل 10m أو 2h أو 7d.',
      remove: 'إلغاء الإسكات عن العضو فورًا.',
      list: 'عرض كل الأعضاء المُسكتين حاليًا.',
    },
  },
  warn: {
    category: 'moderation',
    label: 'التحذيرات',
    what: 'تسجيل تحذير لعضو أو عرض تحذيراته أو حذفها — وتُطبَّق العقوبة التلقائية عند الوصول للحد.',
    usage: ['warn add <@العضو> [السبب] [خاص]', 'warn list <@العضو>', 'warn remove <الرقم>', 'warn clear <@العضو>'],
    examples: ['warn add @العضو مخالفة', 'warn add @العضو إزعاج نعم', 'warn list @العضو', 'warn remove 12', 'warn clear @العضو'],
    aliases: ['w'],
    perm: 'إدارة الرسائل',
    audience: 'staff',
    text: true,
    subs: {
      add: 'إضافة تحذير جديد (اكتب «نعم» في الآخر ليرسل تنبيه بالخاص).',
      list: 'عرض كل تحذيرات العضو وأرقامها.',
      remove: 'حذف تحذير برقمه.',
      clear: 'حذف كل تحذيرات العضو.',
    },
  },
  purge: {
    category: 'moderation',
    label: 'حذف رسائل',
    what: 'حذف مجموعة رسائل من الروم — بالعدد أو من عضو أو تحتوي نص أو روابط أو رسائل البوتات.',
    usage: ['purge messages <العدد> [@العضو]', 'purge contains <النص> <العدد>', 'purge links <العدد>', 'purge bot <العدد>', 'purge user <@العضو> <العدد>'],
    examples: ['purge messages 50', 'purge user @العضو 30', 'purge contains سبام 100', 'purge links 25'],
    aliases: ['clear', 'c'],
    perm: 'إدارة الرسائل',
    audience: 'staff',
    text: true,
    subs: {
      messages: 'حذف عدد محدّد من الرسائل، أو من عضو معيّن.',
      contains: 'حذف الرسائل التي تحتوي على نص معيّن.',
      links: 'حذف الرسائل التي تحتوي روابط.',
      bot: 'حذف رسائل البوتات فقط.',
      user: 'حذف رسائل عضو معيّن.',
    },
  },
  lock: {
    category: 'moderation',
    label: 'قفل الروم',
    what: 'قفل روم أو كل الرومات (يمنع الكتابة) أو فتحها من جديد.',
    usage: ['lock channel [القناة] [السبب]', 'lock unlock [القناة]', 'lock all [السبب]', 'lock unlockall'],
    examples: ['lock channel سبب: تخريب', 'lock unlock', 'lock all هدوء مؤقت', 'lock unlockall'],
    aliases: ['قفل'],
    perm: 'إدارة القنوات',
    audience: 'staff',
    text: true,
    subs: {
      channel: 'قفل الروم الحالي أو روم محدّد.',
      unlock: 'فتح الروم من جديد.',
      all: 'قفل كل رومات السيرفر دفعة واحدة.',
      unlockall: 'فتح كل الرومات.',
    },
  },
  slowmode: {
    category: 'moderation',
    label: 'الوضع البطيء',
    what: 'تحديد فاصل زمني بين رسائل الأعضاء في الروم (0 = إيقاف).',
    usage: ['slowmode <المدة> [القناة]'],
    examples: ['slowmode 10s', 'slowmode 1m', 'slowmode 0'],
    aliases: ['sm'],
    perm: 'إدارة القنوات',
    audience: 'staff',
    text: true,
  },
  member: {
    category: 'moderation',
    label: 'إدارة عضو',
    what: 'تغيير اسم العضو في السيرفر أو إضافة/إزالة رتبة أو عرض سجل عقوباته.',
    usage: ['member nickname <@العضو> [الاسم]', 'member role <@العضو> <الرتبة>', 'member history <@العضو>', 'member reset <@العضو>'],
    examples: ['member nickname @العضو نجم السيرفر', 'member role @العضو @رتبة', 'member history @العضو', 'member reset @العضو'],
    aliases: [],
    perm: 'إدارة الأعضاء',
    audience: 'staff',
    text: true,
    subs: {
      nickname: 'تغيير الاسم داخل السيرفر (اتركه فارغًا لإرجاع الاسم الأصلي).',
      role: 'إضافة أو إزالة رتبة حسب وجودها عند العضو.',
      history: 'عرض سجل العضو: التحذيرات والإسكاتات والحالات.',
      reset: 'تصفير سجل العقوبات وعدد التحذيرات.',
    },
  },

  /* ============================== الإعدادات ============================== */
  settings: {
    category: 'config',
    label: 'إعدادات السيرفر',
    what: 'حالة السيرفر ولغته ورابط لوحة التحكم، وإعادة ضبط الإعدادات.',
    usage: ['settings status', 'settings language <ar أو en>', 'settings dashboard', 'settings reset <نعم>'],
    examples: ['settings status', 'settings language ar', 'settings dashboard'],
    aliases: ['config'],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      status: 'عرض حالة كل الأنظمة بسرعة.',
      language: 'تغيير لغة ردود البوت (ar أو en).',
      dashboard: 'رابط لوحة التحكم لهذا السيرفر.',
      reset: 'إعادة كل الإعدادات للوضع الافتراضي (يحتاج تأكيد «نعم»).',
    },
  },
  welcome: {
    category: 'config',
    label: 'الترحيب والوداع',
    what: 'ترحيب بصورة بالأفتار + رسالة عادية (بلا إطار) والوداع والبوست، مع تجربة فورية.',
    usage: ['welcome channel <#القناة>', 'welcome message <النص> [embed]', 'welcome cardtext <النص>', 'welcome plain <نعم/لا>', 'welcome image <النوع> [الرابط]', 'welcome enable / disable', 'welcome dm <نعم/لا>', 'welcome test [@العضو]', 'welcome leave <#القناة> <النص>', 'welcome boost <#القناة> <النص>', 'welcome status'],
    examples: ['welcome channel #الترحيب', 'welcome cardtext أهلاً بك {displayName} في {server}', 'welcome plain نعم', 'welcome image card', 'welcome test @العضو'],
    aliases: ['greet'],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      channel: 'تحديد روم الترحيب.',
      message: 'كتابة نص الترحيب (المتغيّرات: {user} {server} {memberCount}).',
      cardtext: 'النص الذي يُرسم فوق صورة الترحيب نفسها.',
      plain: 'اختيار الشكل: صورة + رسالة عادية (نعم) أو داخل إطار Embed (لا).',
      image: 'نوع صورة الترحيب: card أو avatar أو custom أو none.',
      enable: 'تشغيل نظام الترحيب.',
      disable: 'إيقاف نظام الترحيب.',
      dm: 'إرسال رسالة ترحيب بالخاص أيضًا.',
      test: 'إرسال ترحيب تجريبي حالًا.',
      leave: 'رسالة الوداع عند خروج عضو.',
      boost: 'رسالة الشكر عند عمل بوست للسيرفر.',
      status: 'عرض حالة نظام الترحيب.',
    },
  },
  autorole: {
    category: 'config',
    label: 'الرتب التلقائية',
    what: 'رتب تُعطى تلقائيًا لكل من يدخل السيرفر (ورتبة منفصلة للبوتات).',
    usage: ['autorole add <@الرتبة> [للبوتات]', 'autorole remove <@الرتبة>', 'autorole list', 'autorole enable', 'autorole disable'],
    examples: ['autorole add @عضو', 'autorole add @بوت نعم', 'autorole list', 'autorole enable'],
    aliases: ['ar'],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      add: 'إضافة رتبة للداخلين الجدد.',
      remove: 'إزالة رتبة من القائمة.',
      list: 'عرض الرتب التلقائية الحالية.',
      enable: 'تشغيل النظام.',
      disable: 'إيقاف النظام.',
    },
  },
  leveling: {
    category: 'config',
    label: 'المستويات والخبرة',
    what: 'إعدادات الخبرة: الخبرة الكتابية (٥ أحرف = ١) والصوتية (٦٠ ثانية = ١) والحماية من السبام والمكافآت.',
    usage: ['leveling rank [@العضو]', 'leveling leaderboard [الفترة] [النوع]', 'leveling enable [قناة_الإعلان]', 'leveling disable', 'leveling config', 'leveling reward <عملية> <المستوى> [@الرتبة]', 'leveling rewards', 'leveling reset <@العضو>', 'leveling sources'],
    examples: ['leveling rank', 'leveling leaderboard week', 'leveling enable #المستويات', 'leveling reward add 5 @نشيط', 'leveling rewards'],
    aliases: ['levels', 'rank'],
    perm: null,
    audience: 'member',
    text: true,
    subs: {
      rank: 'عرض مستوى وخبرة عضو (أو نفسك).',
      leaderboard: 'ترتيب الأعضاء حسب الخبرة.',
      enable: 'تشغيل نظام المستويات.',
      disable: 'إيقاف نظام المستويات.',
      config: 'تعديل أرقام الخبرة (من الموقع أسهل).',
      reward: 'ربط رتبة بمستوى معيّن.',
      rewards: 'عرض كل مكافآت المستويات.',
      reset: 'تصفير خبرة عضو.',
      sources: 'شرح مصادر الخبرة الحالية.',
    },
  },
  autoreply: {
    category: 'config',
    label: 'الردود التلقائية',
    what: 'كلمة مفتاحية ← رد جاهز، في أي روم بالسيرفر، مع كولداون وحذف تلقائي.',
    usage: ['autoreply add <الكلمات> <الرد> [النوع] [تنبيه_العضو] [الكولداون]', 'autoreply remove <الرقم>', 'autoreply list', 'autoreply enable / disable', 'autoreply config', 'autoreply test <النص>'],
    examples: ['autoreply add سلام|هلا أهلًا وسهلًا', 'autoreply add تعليمات اكتب «مساعدة»', 'autoreply list', 'autoreply test سلام'],
    aliases: ['ar-reply'],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      add: 'إضافة قاعدة رد جديدة (افصل الكلمات بـ |).',
      remove: 'حذف قاعدة برقمها.',
      list: 'عرض كل القواعد.',
      enable: 'تشغيل النظام.',
      disable: 'إيقاف النظام.',
      config: 'ضبط الكولداون والحذف وتجاهل البوتات.',
      test: 'تجربة النص لتشوف أي قاعدة رح ترد.',
    },
  },
  autoline: {
    category: 'config',
    label: 'الخط الفاصل',
    what: 'خط فاصل متحرك يُرسل تلقائيًا بين الرسائل في روم معيّن (GIF جاهز أو رابط صورة).',
    usage: ['autoline add <#القناة>', 'autoline remove <#القناة>', 'autoline style <النمط>', 'autoline type <النوع>', 'autoline url <الرابط>', 'autoline enable / disable', 'autoline options', 'autoline test', 'autoline status'],
    examples: ['autoline add #التقديمات', 'autoline style glow', 'autoline type gif', 'autoline status'],
    aliases: [],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      add: 'إضافة روم يشتغل فيه الخط الفاصل.',
      remove: 'إزالة روم من القائمة.',
      style: 'اختيار شكل الحركة (توهّج، تدفّق، نبض…).',
      type: 'نوع الخط: GIF أو رابط صورة أو نص.',
      url: 'رابط صورة مخصّصة للخط.',
      enable: 'تشغيل الخط الفاصل.',
      disable: 'إيقافه.',
      options: 'خيارات إضافية (حذف الخط السابق، الحذف بعد ثوانٍ).',
      test: 'إرسال خط فاصل تجريبي.',
      status: 'عرض حالة النظام.',
    },
  },
  autoreact: {
    category: 'config',
    label: 'التفاعلات التلقائية',
    what: 'تفاعل تلقائي بالإيموجي على الرسائل، أو عند احتواء الرسالة على كلمة معيّنة.',
    usage: ['autoreact enable / disable', 'autoreact channel <#القناة>', 'autoreact emoji <العملية> <الإيموجي>', 'autoreact word <العملية> <الكلمة> [الإيموجي]', 'autoreact test', 'autoreact status'],
    examples: ['autoreact enable', 'autoreact channel #عام', 'autoreact emoji add 🔥', 'autoreact word add ترحيب 👋'],
    aliases: [],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      enable: 'تشغيل النظام.',
      disable: 'إيقافه.',
      channel: 'تحديد الروم الذي يُتفاعل فيه.',
      emoji: 'إضافة أو إزالة إيموجي يُوضع على كل رسالة.',
      word: 'تفاعل عند احتواء الرسالة على كلمة معيّنة.',
      test: 'تجربة فورية.',
      status: 'عرض الحالة.',
    },
  },
  automod: {
    category: 'config',
    label: 'الحماية التلقائية',
    what: 'حماية السيرفر تلقائيًا: سبام، روابط، كلمات ممنوعة، منشن جماعي — مع عقوبة تحددها.',
    usage: ['automod enable / disable', 'automod toggle <الحماية>', 'automod punishment <العقوبة>', 'automod limits <عدد_الرسائل> <خلال_ثواني>', 'automod word <العملية> <الكلمة>', 'automod words', 'automod whitelist [#قناة] [@رتبة]', 'automod status'],
    examples: ['automod enable', 'automod toggle سبام', 'automod punishment إسكات', 'automod word add كلمة_ممنوعة', 'automod status'],
    aliases: [],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      enable: 'تشغيل الحماية التلقائية.',
      disable: 'إيقافها.',
      toggle: 'تشغيل/إيقاف حماية معيّنة (سبام، روابط، منشن…).',
      punishment: 'العقوبة: تنبيه أو إسكات أو طرد أو حظر.',
      limits: 'حدود السبام (عدد الرسائل في كم ثانية).',
      word: 'إضافة أو حذف كلمة ممنوعة.',
      words: 'عرض الكلمات الممنوعة.',
      whitelist: 'استثناء قناة أو رتبة من الحماية.',
      status: 'عرض الحالة.',
    },
  },
  logs: {
    category: 'config',
    label: 'السجلات',
    what: 'سجل لكل حدث بالسيرفر: رسائل، أعضاء، رتب، قنوات، أصوات — وكل حدث تقدر تحطه في روم خاص فيه (الحظر لحاله · الطرد لحاله).',
    usage: ['logs channel <#القناة>', 'logs eventchannel <الحدث> [#القناة]', 'logs groupchannel <المجموعة> [#القناة]', 'logs channels', 'logs enable / disable', 'logs events', 'logs all', 'logs none', 'logs ignore [#قناة] [@رتبة]', 'logs status', 'logs test'],
    examples: ['logs eventchannel memberBan #لوق-الحظر', 'logs eventchannel memberKick #لوق-الطرد', 'logs groupchannel members #لوق-الأعضاء', 'logs channel #سجلات', 'logs channels'],
    aliases: [],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      channel: 'تحديد روم عام اختياري لكل الأحداث.',
      eventchannel: 'ربط حدث واحد بروم خاص فيه (مثال: الحظر لحاله).',
      groupchannel: 'ربط مجموعة أحداث كاملة بروم واحد.',
      channels: 'عرض خريطة القنوات: أي حدث يروح لأي روم.',
      enable: 'تشغيل السجلات.',
      disable: 'إيقافها.',
      events: 'اختيار الأحداث المسجّلة.',
      all: 'تشغيل كل الأحداث.',
      none: 'إيقاف كل الأحداث.',
      ignore: 'استثناء قناة أو رتبة.',
      status: 'عرض الحالة.',
      test: 'إرسال سجل تجريبي.',
    },
  },
  tickets: {
    category: 'config',
    label: 'نظام التذاكر',
    what: 'تذاكر دعم ومراسلة الإدارة + تقديمات الإدارة (طلبات) مع لوحة أزرار.',
    usage: ['tickets setup <#القسم> [@رتبة_الدعم] [قناة_السجلات]', 'tickets panel [#القناة]', 'tickets panelmode <الوضع>', 'tickets panelinfo', 'tickets remind <@العضو> [الرسالة]', 'tickets add <@العضو|آيدي>', 'tickets button <الزر> [نص] [إيموجي] [لون]', 'tickets buttons', 'tickets applychannel <#القناة>', 'tickets applyrole <@الرتبة>', 'tickets enable / disable', 'tickets list', 'tickets stats'],
    examples: ['tickets setup #تذاكر @الدعم', 'tickets panel #الدعم', 'tickets remind @العضو', 'تذكير @العضو (داخل التذكرة)', 'tickets enable', 'tickets stats'],
    aliases: ['ticket', 'تذاكر'],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: true,
    subs: {
      remind: '🔔 تذكير العضو بتذكرته — رسالة خاصة نصية بلا إمبد (داخل غرفة التذكرة فقط).',
      add: '➕ إضافة عضو للتذكرة بالمنشن أو الآيدي.',
      setup: 'تجهيز نظام التذاكر (قسم التذاكر ورتب الدعم).',
      panel: 'نشر لوحة التذاكر في روم (رسالة واحدة بلا فوتر، وتنظّف اللوحة القديمة).',
      panelmode: 'شكل اللوحة: أزرار أو قائمة.',
      panelinfo: 'تعديل عنوان ووصف اللوحة.',
      button: 'تعديل نص وإيموجي ولون أي زر داخل التذكرة (استلام · إغلاق · أرشيف · إضافة عضو).',
      buttons: 'عرض شكل أزرار التذكرة الحالية.',
      applychannel: 'روم تقديمات الإدارة.',
      applyrole: 'رتبة تُمنح لمن يُقبل طلبه.',
      enable: 'تشغيل النظام.',
      disable: 'إيقافه.',
      list: 'عرض التذاكر.',
      stats: 'إحصاءات التذاكر والطلبات.',
    },
  },
  setup: {
    category: 'config',
    label: 'المعالج السريع',
    what: 'معالج يجهّز السيرفر خطوة بخطوة (ترحيب، سجلات، رتب، تذاكر) من أمر واحد.',
    usage: ['setup'],
    examples: ['setup'],
    aliases: [],
    perm: 'إدارة السيرفر',
    audience: 'staff',
    text: false, // يحتاج نوافذ وأزرار داخل ديسكورد
  },

  /* ============================== أدوات ============================== */
  poll: {
    category: 'utility',
    label: 'تصويت',
    what: 'إنشاء تصويت بخيارات جاهزة — يفصل بين الخيارات بعلامة |',
    usage: ['poll <السؤال> <خيار1> <خيار2> [خيار3] [خيار4] [خيار5]'],
    examples: ['poll أفضل وقت للفعالية | المغرب | العشاء | بعد العشاء'],
    aliases: ['vote'],
    perm: null,
    audience: 'member',
    text: true,
  },
  remind: {
    category: 'utility',
    label: 'تذكير',
    what: 'تذكيرك برسالة بعد مدة محدّدة.',
    usage: ['remind <المدة> <النص>'],
    examples: ['remind 10m شرب ماء', 'remind 2h اجتماع الإدارة'],
    aliases: ['reminder'],
    perm: null,
    audience: 'member',
    text: true,
  },
};

/**
 * جمهور كل أمر:
 *   member = أمر عضو عادي — يستعمله أي عضو في السيرفر، ويظهر له في المساعدة والموقع.
 *   staff  = أمر إدارة بصلاحيات — مخفي عن الأعضاء تمامًا (في ديسكورد وفي الموقع)
 *            حتى ما يخبّوا شي في السيرفر.
 */
const AUDIENCES = {
  member: {
    key: 'member',
    label: 'أوامر الأعضاء',
    badge: 'للأعضاء',
    desc: 'يستعملها أي عضو في السيرفر بلا أي صلاحية — ظاهرة له في كل مكان.',
  },
  staff: {
    key: 'staff',
    label: 'أوامر الإدارة',
    badge: 'للإدارة',
    desc: 'تحتاج صلاحية إدارية — مخفية عن الأعضاء العاديين في ديسكورد وفي الموقع.',
  },
};

/** جمهور أمر واحد (من الحقل نفسه أو من الصلاحية المطلوبة) */
function audienceOf(name, meta) {
  const entry = meta || COMMANDS[name] || {};
  if (entry.audience === 'member' || entry.audience === 'staff') return entry.audience;
  return entry.perm ? 'staff' : 'member';
}

/** هل هذا أمر عضو عادي؟ */
function isMemberCommand(name) {
  return audienceOf(name) === 'member';
}

/** كل أسماء أوامر جمهور معيّن */
function namesOf(audience) {
  return Object.entries(COMMANDS)
    .filter(([name, meta]) => audienceOf(name, meta) === audience)
    .map(([name]) => name);
}

/** الأوامر التي تشتغل بلا بريفيكست */
function textCommands() {
  return Object.entries(COMMANDS)
    .filter(([, meta]) => meta.text !== false)
    .map(([name]) => name);
}

module.exports = { CATEGORIES, AUDIENCES, COMMANDS, textCommands, audienceOf, isMemberCommand, namesOf };
