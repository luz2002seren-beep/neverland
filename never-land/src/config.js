'use strict';

/**
 * config.js
 * -------------------------------------------------------------
 * تحميل الإعدادات من ملف .env + قيم افتراضية آمنة.
 * كل باقي المشروع يقرأ الإعدادات من هنا فقط.
 * -------------------------------------------------------------
 */

require('dotenv').config();

const path = require('node:path');

/** تحويل نص إلى قيمة منطقية */
const bool = (v, fallback = false) => {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'نعم'].includes(String(v).trim().toLowerCase());
};

/** تحويل نص إلى رقم صحيح */
const int = (v, fallback) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

/** تحويل نص مفصول بفواصل إلى مصفوفة */
const list = (v) => String(v ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const root = path.resolve(__dirname, '..');

/**
 * هل التوكن حقيقي (لا نصًا بديلًا من .env.example)؟
 * توكنات ديسكورد طويلة (أكثر من 50 محرفًا) وبالإنجليزية/أرقام فقط.
 */
const hasRealToken = (() => {
  const t = String(process.env.DISCORD_TOKEN || '').trim();
  if (t.length < 50) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(t)) return false;
  return true;
})();

const config = {
  root,

  bot: {
    token: process.env.DISCORD_TOKEN || '',
    /** true عندما يكون التوكن حقيقيًا (وقتها تُستخدم بيانات ديسكورد الفعلية) */
    hasToken: hasRealToken,
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    defaultLanguage: (process.env.DEFAULT_LANGUAGE || 'ar').trim().toLowerCase().startsWith('en') ? 'en' : 'ar',
    developerIds: list(process.env.DEVELOPER_IDS),
    /**
     * 🟣 حالة البوت (Presence) — تحت اسمه في كل السيرفرات.
     *   name   الاسم الظاهر (الافتراضي: 𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅)
     *   type   streaming = بث مباشر (اللون البنفسجي + شارة «مباشر») · playing · watching · listening · competing · custom
     *   url    رابط البث (لازم لنوع streaming)
     *   status online · idle · dnd · invisible
     * تُعدَّل من الموقع (قسم الإعدادات العامة) وتُطبَّق فورًا بلا إعادة تشغيل.
     */
    presence: {
      /* القيمة القديمة 'NEVER LAND' ما تنعتمد — نستعمل الاسم المطلوب */
      name: (!process.env.PRESENCE_NAME || process.env.PRESENCE_NAME.trim() === 'NEVER LAND'
        ? '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅'
        : process.env.PRESENCE_NAME.trim()),
      type: (process.env.PRESENCE_TYPE || 'streaming').trim().toLowerCase(),
      url: (process.env.PRESENCE_URL || '').trim() || 'https://www.twitch.tv/never_land',
      status: (process.env.PRESENCE_STATUS || 'online').trim().toLowerCase(),
    },
    resetCommands: bool(process.env.RESET_COMMANDS, false),
    /** ألوان embeddings */
    colors: {
      primary: 0x5865f2,
      success: 0x57f287,
      warning: 0xfee75c,
      danger: 0xed4245,
      neutral: 0x2b2d31,
      info: 0x00b0f4,
    },
  },

  web: {
    enabled: true,
    /** الاسم الذي يظهر في الموقع وكل الصفحات */
    siteName: process.env.SITE_NAME || 'Never Land',
    demoMode: bool(process.env.DEMO_MODE, false),
    /**
     * الوصول العام: أي زائر يفتح الموقع ويشاهد الصفحات والسيرفرات (بلا تعديل).
     * التعديل يحتاج تسجيل دخول Discord. اجعلها false لمنع الزوار بالكامل.
     */
    publicAccess: bool(process.env.PUBLIC_ACCESS, true),
    /**
     * تأكيد الدخول: true = الموقع لا يُفتح إلا بعد تسجيل الدخول بحساب Discord.
     * (الصفحة الرئيسية واللوحة كلها)
     */
    loginRequired: bool(process.env.LOGIN_REQUIRED, true),
    /**
     * الرول المطلوب لاستخدام الموقع — معرّف الرول.
     * من لا يملكه: يسجّل دخوله لكنه يرى صفحة «الوصول مقيّد».
     * اتركه فارغًا لقبول أي عضو.
     */
    requiredRoleId: (process.env.REQUIRED_ROLE_ID || '1549364852433354792').trim(),
    /** مدة كاش فحص الرول بالثواني */
    roleCacheSeconds: int(process.env.ROLE_CACHE_SECONDS, 300),
    /**
     * مالك الموقع: معرّف حساب ديسكورد الوحيد الذي يرى لوحة «أعضاء الموقع»
     * (قائمة الداخلين + الحظر + المشاهدة فقط). لا يراه ولا يستخدمه غيره.
     */
    ownerUserId: (process.env.OWNER_USER_ID || '1345866950776979547').trim(),
    /** حسابات إضافية مسموح لها بإدارة الموقع (اختياري، مفصولة بفواصل) */
    siteAdmins: (process.env.SITE_ADMINS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    /** المنفذ: DASHBOARD_PORT أو PORT (تُضبط تلقائيًا في Railway/Render/Heroku) */
    port: int(process.env.DASHBOARD_PORT || process.env.PORT, 3000),
    /**
     * الرابط العام: DASHBOARD_URL، أو نطاق Railway التلقائي، وإلا localhost.
     * يُستخدم في روابط OAuth والـ sitemap ووسوم og.
     */
    url: resolveWebUrl(),
    sessionSecret: process.env.SESSION_SECRET || 'never-land-change-me',
  },

  /** المزامنة الحقيقية مع ديسكورد (لقطات القنوات/الرتب/الأعضاء للوحة) */
  sync: {
    enabled: bool(process.env.SYNC_ENABLED, true),
    /** كل كم ثانية تُعاد المزامنة تلقائيًا (الحد الأدنى 60) */
    intervalSeconds: Math.max(60, int(process.env.SYNC_INTERVAL_SECONDS, 300)),
  },

  database: {
    /** sqlite (افتراضي) أو json (بدون أي إعتماد خارجي) */
    driver: (process.env.DATABASE_DRIVER || 'sqlite').toLowerCase(),
    path: path.isAbsolute(process.env.DATABASE_PATH || '')
      ? process.env.DATABASE_PATH
      : path.join(root, process.env.DATABASE_PATH || 'data/neverland.db'),
  },

  /** قيم افتراضية لإعدادات كل سيرفر */
  defaults: {
    language: process.env.DEFAULT_LANGUAGE || 'en',
    /**
     * شكل ردود البوت في ديسكورد:
     *   english   : كل الردود بالإنجليزية (القاموس في src/lib/en.js)
     *   fancyFont : الخط المزخرف 𝑪𝒉𝒂𝒕 (Mathematical Bold Italic) مع حماية المنشنات والروابط والأكواد
     */
    replies: {
      english: true,
      fancyFont: true,
    },
    prefix: '!',
    welcome: {
      enabled: true,
      /* قناة الترحيب في سيرفر Never Land */
      channelId: '1549365058633736243',
      /**
       * نص رسالة الترحيب — المتغيّرات:
       * {user} المنشن • {displayName} اسم العضو • {username} • {server} • {memberCount}
       * {inviter} اسم مَن أرسل رابط الدعوة • {inviterMention} منشنه • {inviteCode} كود الرابط
       */
      message:
        '<a:os49:1461135643735490735> 𝑊𝑒𝑙𝑐𝑜𝑚𝑒 𝑡𝑜 𝑆𝑒𝑟𝑣𝑒𝑟 𝑁𝑒𝑣𝑒𝑟 𝐿𝑎𝑛𝑑.\n'
        + '<a:os49:1461135643735490735> 𝑀𝑒𝑚𝑏𝑒𝑟 : {user}\n'
        + '<a:os49:1461135643735490735> 𝐼𝑛𝑣 𝐵𝑦 : {inviter}',
      /** إرسال الرسالة داخل إطار Embed؟ false = صورة الترحيب + رسالة عادية (الطريقة الاحترافية) */
      embed: false,
      /** النص الذي يُرسم على صورة الترحيب نفسها */
      cardMessage: 'أهلاً بك {displayName} في {server}',
      /**
       * 🖼️ صورة الترحيب بإطار Never Land: تُرسم صورة العضو داخل الدائرة الفارغة.
       *   frameImage  : مسار صورة الإطار (بدل بطاقة البوت العادية)
       *   frameCircle : مكان الدائرة داخل الإطار بنسب من العرض/الارتفاع {cx,cy,r}
       */
      frameImage: 'assets/welcome-frame.png',
      frameCircle: { cx: 0.33430, cy: 0.54491, r: 0.24950 },
      /**
       * 🔍 تكبير صورة الترحيب كاملة (الإطار + دائرة الأفتار معه) — بلا قص للحواف.
       * الصورة الحالية (banner_bigger): دائرتها كبيرة أصلًا (نصف قطر ٢٥٥ بكسل)
       * ⇒ 1.0 = نفس المقاس الأصلي · 1.002 = بالضبط حجم الصور السابقة (٢٥٦ بكسل)
       *   والقيمة الحالية 1.3 تكبّرها ٣٠٪ أكثر (نصف قطر ≈٣٣٢ بكسل) بلا أي قص.
       */
      frameScale: 1.3,
      /**
       * 📤 طريقة الإرسال: الصورة برسالة أولى ثم النص برسالة ثانية (الطريقة المطلوبة).
       * false = رسالة واحدة فيها الصورة والنص معًا.
       */
      imageFirst: true,
      /** 🏷️ {inviter} يكون منشن (وإلا اسم الداعي بلا منشن) */
      inviterMention: true,
      /**
       * 🧩 الدعوة العامة (رابط عام/فانيتي/دعوة بوت أو ما عرفنا صاحب الدعوة):
       * يُمنشن هذا الآيدي بدل «غير معروف».
       */
      publicInviterId: '1345866950776979547',
      /** أكواد روابط الدعوة العامة — تتبدّل بصاحب الدعوة الخاص (يدعم أكواد أو روابط كاملة) */
      publicInviteCodes: [],
      /** 🔁 إيموجي بديل (يونيكود) إذا ما قدرنا نرفع الإيموجي الخارجي للسيرفر */
      emojiFallback: '✨',
      /** ترقية الشكل مرة واحدة (بطاقة قديمة ← إطار Never Land) */
      styleUpgraded: false,
      /** ترحيب الخاص: مطفّي افتراضيًا — سياسة الخاص بالبوت = تحذير · قبول تقديم · رفض تقديم فقط */
      dm: false,
      dmMessage: 'أهلاً بك في **{server}**. يُرجى الاطلاع على قوانين السيرفر قبل المشاركة.',
      autoDeleteAfter: 0,
      /** صورة الترحيب: frame (إطار Never Land بالأفتار) | card | avatar | custom | none */
      imageMode: 'frame',
      /** رابط صورة مخصّصة (عند imageMode = custom) أو خلفية للبطاقة */
      imageUrl: null,
      cardBackground: null,
      cardTheme: { from: '#5865f2', to: '#2b2f6b', accent: '#ffffff' },
      /** إرسال صورة الأفتار أيضًا كـ thumbnail في الـ embed */
      avatarThumbnail: true,
      /** إرسال الصورة كصورة مرفقة (attachment) بدل الرابط */
      attachImage: true,
    },
    leave: {
      enabled: false,
      channelId: null,
      message: 'غادر {user} السيرفر.',
    },
    boost: {
      enabled: false,
      channelId: null,
      message: 'شكرًا {user} على دعم السيرفر. المستوى الحالي {level}.',
    },
    logs: {
      enabled: false,
      /**
       * قناة عامة اختيارية — تُستخدم فقط للأحداث اللي ما لها روم خاص.
       * الافتراضي: بلا قناة عامة، وكل حدث يروح لرومه الخاص (channels / channelsByGroup).
       */
      channelId: null,
      /**
       * روم خاص لكل حدث على حدة: { messageDelete: 'ID', memberBan: 'ID', memberKick: 'ID', ... }
       * مثال: «حظر» لحاله · «طرد» لحاله · «حذف رسائل» لحاله.
       */
      channels: {},
      /** روم لكل مجموعة أحداث (اختصار سريع): { members: 'ID', messages: 'ID', ... } */
      channelsByGroup: {},
      /** كل الأحداث — كل حدث يُشغَّل/يُطفأ على حدة */
      events: {
        // --- الرسائل ---
        messageDelete: true,
        messageEdit: true,
        messageBulkDelete: true,
        // --- الأعضاء ---
        memberJoin: true,
        memberLeave: true,
        memberKick: true,
        memberBan: true,
        memberUnban: true,
        memberTimeout: true,
        memberBoost: true,
        memberRoleUpdate: true,
        memberNickname: true,
        memberAvatar: true,
        memberUsername: true,
        // --- الرتب ---
        roleCreate: true,
        roleDelete: true,
        roleUpdate: true,
        // --- القنوات ---
        channelCreate: true,
        channelDelete: true,
        channelUpdate: true,
        channelPermissions: true,
        // --- السيرفر ---
        serverUpdate: true,
        emojiCreate: true,
        emojiDelete: true,
        stickerCreate: true,
        stickerDelete: true,
        // --- الدعوات ---
        inviteCreate: true,
        inviteDelete: false,
        // --- المواضيع (Threads) ---
        threadCreate: false,
        threadDelete: false,
        // --- الصوت ---
        voiceJoin: false,
        voiceLeave: false,
        voiceMove: false,
        voiceMute: false,
        voiceDeafen: false,
        // --- الأنظمة ---
        modActions: true,
        automod: true,
        ticket: true,
      },
      /** تجاهل القنوات/الرتب في اللوقات */
      ignoredChannels: [],
      ignoredRoles: [],
    },
    /** خط فاصل تلقائي بعد كل رسالة (AutoLine) */
    autoline: {
      enabled: false,
      channels: [],
      /** نوع الخط: gif (صورة متحركة) أو custom (رابط صورتك) أو text (خط نصّي) */
      lineType: 'gif',
      /** نمط GIF الجاهز: glow | flow | pulse | dash */
      gifStyle: 'glow',
      /** رابط صورة/GIF خاص (يُستخدم عند lineType=custom) */
      customUrl: null,
      line: '─'.repeat(24),
      color: null,        // null = بدون لون، أو hex مثل '#5865f2'
      deletePrevious: true, // حذف الخط السابق عند وصول رسالة جديدة
      deleteAfter: 0,      // حذف الخط بعد X ثانية (0 = بدون)
      deleteLineWithMessage: true, // حذف الخط عند حذف الرسالة التي بعده
    },
    /** تفاعلات تلقائية (AutoReaction) — إيموجيات تُضاف تلقائيًا لرسائل القنوات */
    /**
     * الردود التلقائية (AutoReply)
     * العضو يكتب كلمة مفتاحية → البوت يرد عليه بالرسالة المحدّدة.
     * تعمل في كل قنوات السيرفر افتراضيًا.
     */
    autoReply: {
      enabled: true,
      anywhereInServer: true, // الرد شغّال في كل الرومات (إلا لو القاعدة حدّدت قنوات)
      ignoreBots: true, // ما يرد على البوتات
      cooldownSeconds: 15, // بين رد ورد لنفس العضو على نفس القاعدة (0 = بلا)
      deleteAfterSeconds: 0, // حذف رد البوت بعد كذا ثانية (0 = يبقى)
      /** القواعد: [{ id, triggers: [], match, reply, channels: [], cooldownSeconds, pingUser, enabled }] */
      rules: [],
    },
    autoreact: {
      enabled: false,
      channels: [],        // قنوات يتم التفاعل على كل رسالة فيها
      emojis: ['👍'],      // يدعم الإيموجيات الخارجية <:name:id>
      /** تفاعل عند احتواء الرسالة على كلمة معيّنة: [{ word: 'ترحيب', emoji: '👋' }] */
      words: [],
      ignoreBots: true,
    },
    /** الرتب التلقائية (Autorole) — تُعطى تلقائيًا لكل عضو جديد */
    autorole: {
      enabled: false,
      roleIds: [],      // رتب تُعطى للأعضاء
      botRoleIds: [],   // رتب تُعطى للبوتات
    },
    automod: {
      enabled: true,
      antiSpam: true,
      spamMessages: 6,
      spamIntervalSeconds: 5,
      antiLink: false,
      antiInvite: true,
      antiEveryone: true,
      antiCaps: false,
      capsPercent: 70,
      antiMentionSpam: true,
      mentionLimit: 5,
      bannedWords: [],
      whitelistChannels: [],
      whitelistRoles: [],
      whitelistDomains: ['tenor.com', 'giphy.com'],
      punishment: 'delete', // delete | warn | timeout | kick | ban
      timeoutMinutes: 10,
      // مكافحة الهجمات (Anti-Raid)
      antiRaid: true,
      raidThreshold: 10,
      raidWindowSeconds: 60,
      raidAction: 'alert', // alert | kick
      raidMinAccountAgeDays: 7,
    },
    moderation: {
      /** عند تجاوز عدد التحذيرات المحدّد تُطبق عقوبة تلقائية */
      warnThreshold: 0, // 0 = معطّل
      warnAction: 'none', // none | timeout | kick | ban
    },
    reports: {
      channelId: null,
    },
    leveling: {
      /* إصدار نموذج الإعدادات — يرفعه الكود عند تغيير النموذج (انظر src/database/migrate.js) */
      settingsVersion: 2,
      /* النظام مفعّل افتراضيًا حتى يشتغل من أول لحظة — يُطفأ من اللوحة أو /leveling disable */
      enabled: true,
      /* خبرة كتابية: ١ خبرة لكل ٥ أحرف (تُحسب الأحرف بلا مسافات ولا رموز إيموجي) */
      textXp: true,
      textXpPerChars: 5,
      textXpPerCharsAmount: 1,
      maxTextXpPerMessage: 100, // سقف أمان للرسالة الواحدة (يمنع رسالة طويلة واحدة تعطي مئات)
      cooldownSeconds: 0, // بلا كولداون — الحماية الذكية من السبام هي اللي تنظّم
      /* خبرة صوتية: ١ خبرة كل ٦٠ ثانية بقاء في الروم (لازم معك حد ثاني) */
      voiceXp: true,
      voiceIntervalSeconds: 60,
      voiceXpPerInterval: 1,
      /* خبرة تفاعل (التفاعلات على رسائلك) */
      interactXp: true,
      interactMinXp: 2,
      interactMaxXp: 5,
      interactGivenXp: false,
      interactMaxPerMessage: 5,
      interactDailyCap: 60,
      /* -------------------- الحماية الذكية من السبام --------------------
         السبام = تكرار نفس الكلام · رسائل سريعة متتالية · حروف مكررة (اااااا)
         العقوبة: ما تُحسب له أي خبرة (كتابي · صوتي · تفاعل) لمدة ٥ دقايق. */
      antiSpam: {
        enabled: true,
        muteMinutes: 5,
        repeatLimit: 3, // نفس الرسالة كم مرة قبل ما نعتبرها سبام
        windowSeconds: 90, // نافذة المراقبة
        similarity: 0.85, // نسبة التشابه اللي تعتبر الرسالة مكرّرة
        rateMessages: 8, // عدد الرسائل السريعة
        rateSeconds: 10, // خلال كم ثانية
        repeatChars: 8, // حروف متتالية متشابهة تعتبر سبام
      },
      /* تجديد توب داي / توب ويك (إزاحة عن UTC بالساعات) */
      resetOffsetHours: 0,
      announceChannelId: null,
      levelUpMessage: 'وصل {user} إلى المستوى **{level}**.',
      rewards: [], // [{level: 5, roleId: '...'}]
      ignoredChannels: [],
      ignoredRoles: [],
      silent: false,
    },
    /**
     * سياسة الرسائل الخاصة (DM):
     * البوت ما يراسل الخاص إلا في ٣ حالات: تحذير عضو · قبول تقديم الإدارة · رفض تقديم الإدارة.
     * أي إشعار ثاني (لفل · تذكرة · حظر · ترحيب…) مكانه الروم أو اللوق.
     * extraKinds للطوارئ فقط: أضف نوعًا مثل 'welcome' أو 'levelUp' لو أردت السماح به صراحة.
     */
    dm: {
      extraKinds: [],
      /** إجراءات يطلبها إداري صريح (مثل «تذكير بتذكرة») — مسموحة افتراضيًا */
      manual: true,
    },
    /**
     * 🧹 روم الأوامر: روم مخصّص للأوامر — البوت ينشر فيه رسالة ترحيب بصور السيرفر،
     * وبعدها ينظّف كل الرسائل كل المدة المحدّدة (٦٠ ثانية افتراضيًا) وما يمسح رسالته.
     * كل شي يُعدَّل من لوحة التحكم ← قسم «روم الأوامر».
     */
    commandRoom: {
      enabled: true,
      channelId: '1549365063708573817',
      text: 'مرحبا بكم بسيرفر Never Land — هذا روم مخصص لاستخدام الأوامر وسيتم تنظيفه كل 60 ثانية.',
      /** مدة التنظيف بالثواني (الحد الأدنى ١٥ ثانية) */
      intervalSeconds: 60,
      /** صورة الرسالة (مسار داخل المشروع أو رابط خارجي) */
      image: 'src/web/public/assets/commands-room.webp',
      /** تثبيت رسالة الترحيب في الروم (افتراضيًا: بلا تثبيت) */
      pin: false,
      /** يحذف الرسالة ويعيد نشرها كل دورة (تظهر كرسالة جديدة بلا «تم التعديل») */
      repost: true,
    },
    tickets: {
      enabled: false,
      categoryId: null,
      supportRoleIds: [],
      logChannelId: null,
      panelTitle: 'الرجاء الضغط هنا واختيار التذكرة المناسبة',
      panelDescription: 'اختر نوع التذكرة من القائمة بالأسفل وسيتم فتح غرفة خاصة لك.',
      responseTime: '24 ساعة',
      /** select = قائمة منسدلة • buttons = أزرار (حتى 5 أنواع) */
      panelMode: 'select',
      /* ملاحظة: اللوحة صورة + قائمة — بلا رسالة تعليمات منفصلة وبلا أي فوتر */
      /**
       * 🖼️ شكل اللوحة الجديد:
       *   panelImage       : صورة اللوحة (هي اللوحة نفسها) — مسار داخل المشروع أو رابط خارجي
       *                      (حطّها فاضية '' إذا تبي ترجع للوحة النصية القديمة)
       *   panelImageOnly   : true = صورة فقط بلا عنوان ولا وصف ولا حقول
       *   panelFooterImage : خط/صورة زخرفية أسفل القائمة (فاضية = بلا شي)
       *   panelPlaceholder : نص القائمة المنسدلة قبل ما يختار العضو
       *   panelChannelId   : قناة نشر اللوحة (تُحفظ تلقائيًا أول ما تنشر)
       *   panelAutoPost    : نشر/تحديث اللوحة تلقائيًا لما تتغيّر الصورة أو الأنواع
       */
      /* صورة اللوحة = نفس بانر روم الأوامر (commands-room.webp) — تنزل كما هي */
      panelImage: 'src/web/public/assets/commands-room.webp',
      panelImageOnly: true,
      /* بلا خط زخرفي — فاضية = ما ينزل أي شي تحت القائمة */
      panelFooterImage: '',
      /* سطر التعليمات بيظهر فوق خيارات القائمة لما تنفتح (زي المرجع) — عربي واضح */
      panelPlaceholder: 'الرجاء الضغط هنا واختيار التذكرة المناسبة',
      panelChannelId: null,
      panelAutoPost: true,
      /** بصمة آخر لوحة منشورة (داخلية — تتحدّث لحالها) */
      panelSignature: null,
      /** ترقية شكل اللوحة مرة واحدة لكل سيرفر (داخلية — تنحفظ لحالها) */
      panelLookUpgraded: false,
      /** الأنواع الأربعة الأساسية (دعم فني • توثيق • هدايا • تقديم إدارة) */
      types: [
        {
          id: 'support',
          label: 'الدعم الفني',
          emoji: '🛠️',
          description: 'مشكلة تقنية أو استفسار عن البوت والسيرفر',
          intro: 'اكتب مشكلتك بالتفصيل (وصف المشكلة • متى حدثت • أي صور إن وُجدت) وسيساعدك فريق الدعم الفني.',
          buttonStyle: 'Primary',
        },
        {
          id: 'verify',
          label: 'التوثيق',
          emoji: '✅',
          description: 'طلب توثيق حساب أو رتبة موثّق',
          intro: 'لطلب التوثيق أرسل: من أنت • لماذا تطلب التوثيق • روابط حساباتك الرسمية.',
          buttonStyle: 'Success',
        },
        {
          id: 'gift',
          label: 'الهدايا',
          emoji: '🎁',
          description: 'استلام جائزة أو مشكلة في هدية/سحب',
          intro: 'اذكر اسم السحب/الهدية ورقم الرسالة وصورة من الفوز إن وُجدت.',
          buttonStyle: 'Secondary',
        },
        {
          id: 'staff',
          label: 'تقديم إدارة',
          emoji: '📋',
          description: 'تقديم طلب للانضمام لفريق الإدارة',
          intro: 'اضغط زر «تعبئة النموذج» أدناه، ثم املأ الخانات، وسيصل طلبك إلى الإدارة تلقائيًا.',
          buttonStyle: 'Danger',
        },
      ],
      maxOpenPerUser: 3,
      transcriptOnClose: true,
      /**
       * رسالة فتح التذكرة داخل الغرفة — كل شي قابل للكتابة من الموقع:
       *   openTitle       : عنوان الرسالة   ({id} · {type} · {emoji} · {user} · {server})
       *   openDescription : الوصف           (بلا نص = النص الافتراضي)
       *   openIntro       : سطر إضافي يُلحق بالوصف (شرح كل نوع له حقل intro مستقل)
       *   openFields      : إظهار حقول (صاحب التذكرة · النوع · الحالة)
       *   openFooter      : التذييل (فارغ = بلا تذييل)
       */
      openTitle: '{emoji} تذكرة رقم #{id} — {type}',
      openDescription: 'أهلاً {user}! فتحت تذكرة **{type}** في **{server}**.\nاكتب طلبك بالتفصيل وسيساعدك فريق الدعم بأسرع وقت.',
      openIntro: '',
      openFields: true,
      openFooter: 'تذكرة #{id}',
      /**
       * 🖼️ رسالة فتح التذكرة: صورة بلا نص (زي اللوحة).
       *   openImage     : الصورة اللي تنزل داخل غرفة التذكرة (فاضية '' = ترجع الرسالة النصية)
       *   openImageOnly : true = صورة فقط · false = الصورة تُتجاهل ويطلع النص
       */
      openImage: 'src/web/public/assets/commands-room.webp',
      openImageOnly: true,
      /**
       * أزرار التذكرة داخل الروم — تحكّم كامل: النص (label) + الإيموجي + اللون (style).
       * تُعدّل من الموقع (قسم التذاكر) أو بالأمر /tickets button.
       * الإيموجي: يونيكود مثل 🙋 أو خارجي مثل <:name:123456789012345678> — وسلسلة فارغة تحذف الإيموجي.
       */
      buttons: {
        claim: { label: 'استلام', emoji: '🙋', style: 'Success' },
        claimDone: { label: 'مستلَمة', emoji: '🙋', style: 'Secondary' },
        close: { label: 'إغلاق', emoji: '🔒', style: 'Danger' },
        transcript: { label: 'أرشيف', emoji: '📄', style: 'Secondary' },
        addMember: { label: 'إضافة عضو', emoji: '➕', style: 'Secondary' },
      },
    },
    /**
     * نظام تقديم الإدارة (Application) — مرتبط بنوع تذكرة "تقديم إدارة"
     * عند فتح تذكرة تقديم إدارة: يُرسل البوت رسالة فيها زر يفتح **نموذج (Modal)** من 5 خانات،
     * وبعد تعبئته تُرسَل الإجابات لقناة مراجعة الإدارة مع زرّي ✅ قبول / ❌ رفض.
     */
    staffApplication: {
      enabled: true,
      /** أنواع التذاكر التي تُفعّل فيها الاستمارة (أو ضع application:true داخل النوع) */
      onlyForTypes: ['staff'],
      /** قناة مراجعة الطلبات (إن كانت null تُستخدم قناة سجلات التذاكر) */
      reviewChannelId: null,
      /** رتب تُنَبَّه عند وصول طلب جديد */
      pingRoleIds: [],
      formTitle: 'نموذج تقديم الإدارة',
      formIntro:
        'عبّئ الخانات أدناه بدقة، وسيصل رد الإدارة إلى بريدك الخاص.' + '\n\n' + '> التقديم الناقص أو غير الدقيق يُرفض.',
      formButtonLabel: 'تعبئة النموذج',
      resendButtonLabel: 'إعادة إرسال النموذج',
      /** الحقول الخمسة (أقصى حد مسموح في Discord = 5) */
      fields: [
        {
          id: 'name_age',
          label: 'الاسم والعمر',
          placeholder: 'مثال: أحمد — 18',
          style: 'short',
          required: true,
          maxLength: 100,
        },
        {
          id: 'country',
          label: 'من أي بلد أنت؟',
          placeholder: 'مثال: المغرب',
          style: 'short',
          required: true,
          maxLength: 60,
        },
        {
          id: 'prev_servers',
          label: 'سيرفرات كنت فيها إدارياً؟',
          placeholder: 'اذكر أسماء السيرفرات وعدد الأعضاء ورتبتك فيها',
          style: 'paragraph',
          required: true,
          maxLength: 700,
        },
        {
          id: 'mic',
          label: 'هل تقدر تفتح مايك؟',
          placeholder: 'نعم / لا — مع ذكر الوقت المتاح يوميًا',
          style: 'short',
          required: true,
          maxLength: 200,
        },
        {
          id: 'logo_link',
          label: 'هل تقدر تحط شعار ورابط؟',
          placeholder: 'مثال: نعم — الشعار جاهز والرابط: https://...',
          style: 'short',
          required: true,
          maxLength: 300,
        },
      ],
      /** حقل يُستخرج منه الاسم لإعادة تسمية التذكرة عند القبول */
      nameFieldId: 'name_age',
      /** رسائل النتيجة */
      acceptMessage:
        'تم قبول طلبك للانضمام إلى فريق الإدارة.' + '\n' + 'سيتواصل معك أحد المسؤولين لبدء التدريب.',
      rejectMessage:
        'نُشكر لك اهتمامك بالتقديم، ولم يتم قبول طلبك في هذه المرة.' + '\n' + 'يمكنك إعادة التقديم لاحقًا.',
      /** سؤال سبب الرفض قبل الإرسال */
      askRejectReason: true,
      /** إعدادات القبول */
      onAccept: {
        postInTicket: '{user} تم قبول عرضك، وسُجّلت تذكرتك في ملف الإدارة برقم **#{number}**.',
        dmApplicant: true,
        renameChannel: true,
        /** {name} = اسم المتقدّم • {number} = رقم الطلب • {ticket} = رقم التذكرة */
        channelNameFormat: 'إدارة-{number}-{name}',
        /** نقل التذكرة إلى قسم "تكتات الإدارة" */
        moveToCategoryId: null,
        addRoleIds: [],
        pingApplicant: true,
      },
      /** إعدادات الرفض */
      onReject: {
        postInTicket: '{user} تم رفض تقديمك، ويمكنك إعادة المحاولة لاحقًا.',
        dmApplicant: true,
        closeTicket: false,
      },
    },
    selfRoles: {
      enabled: false,
      panels: [], // [{channelId, messageId, title, options:[{roleId,label,emoji}]}]
    },
    referral: {
      enabled: false,
      channelId: null,
    },
  },
};

/* ============================================================================
 *  سر الجلسات (SESSION_SECRET)
 * ==========================================================================
 * express-session يوقّع معرّف الجلسة (cookie `neverland.sid`) بهذا السر عبر
 * HMAC. من يعرف السر يستطيع توقيع أي معرّف يريده، فيصنع كوكي صالحًا لحساب
 * أي شخص — بما فيه المالك — دون أي كلمة سر. تحقّق عملي:
 *
 *   signature.unsign(sign('forged-victim-session', 'never-land-change-me'),
 *                    'never-land-change-me')  →  'forged-victim-session'
 *
 * والسرّان أدناه معلومان: الأول قيمة config.js الاحتياطية والثاني قيمة
 * .env.example، والاثنان في مستودع عام. لذلك نرفضهما صراحةً بدل الاعتماد
 * على فحص «يحتوي على change-me» الذي كان يفوّت القيمة العربية.
 * ========================================================================== */
const KNOWN_SESSION_SECRETS = new Set([
  'never-land-change-me',
  'غيّر_هذا_النص_الطويل_لحماية_الجلسات',
]);

/** الحد الأدنى لطول السر (بايتات عشوائية ≥ 32 محرفًا سداسيًا = 128 بت إنتروبيا) */
const MIN_SESSION_SECRET_LENGTH = 32;

/** رسالة موحّدة تُطبع في كل موضع يُرفض فيه السر */
config.SESSION_SECRET_HELP =
  'SESSION_SECRET ضعيف أو افتراضي — ولّد سرًا عشوائيًا بـ: ' +
  'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))" ' +
  'ثم ضعه في متغيّرات بيئة منصة النشر (Railway/Render) أو في ملف .env';

/** هل سر الجلسات الحالي غير صالح للاستعمال؟ */
config.sessionSecretIsWeak = () =>
  KNOWN_SESSION_SECRETS.has(config.web.sessionSecret) ||
  String(config.web.sessionSecret).length < MIN_SESSION_SECRET_LENGTH;

/**
 * بوابة أمان صارمة قبل إقلاع خادم الويب.
 *
 * في الإنتاج (NODE_ENV=production) نرفض الإقلاع بسر معلوم أو قصير: تعثّر
 * النشر مع رسالة واضحة أهون بكثير من انتحال حسابات صامت. وضع المعاينة
 * (DEMO_MODE) مستثنى لأنّه محلي ولا يمسّ بيانات حقيقية.
 *
 * ملاحظة: تغيير السر يُبطل كل الجلسات القديمة تلقائيًا، لأن express-session
 * يفشل في فك توقيعها — لا حاجة لأي كود إضافي لقطع الجلسات.
 *
 * @throws {Error} عندما يكون السر غير صالح في بيئة إنتاج
 */
config.assertSessionSecretSafe = () => {
  if (!config.web.enabled || config.web.demoMode) return;
  if (process.env.NODE_ENV !== 'production') return;
  if (!config.sessionSecretIsWeak()) return;
  const known = KNOWN_SESSION_SECRETS.has(config.web.sessionSecret);
  const err = new Error(
    '\n\n' +
      /* علامة ASCII ثابتة: تُستعمل في تأكيد CI وفي التنبيهات. الاعتماد على
         نص عربي في grep هشّ (اختلاف تطبيع الهمزة يكسر المطابقة بصمت). */
      '[FATAL] INSECURE_SESSION_SECRET\n' +
      '╔══════════════════════════════════════════════════════════════╗\n' +
      '║  إيقاف الإقلاع: SESSION_SECRET غير آمن لبيئة الإنتاج        ║\n' +
      '╚══════════════════════════════════════════════════════════════╝\n\n' +
      '  السر الحالي ' +
      (known ? 'قيمة افتراضية معلنة في المستودع' : 'أقصر من 32 محرفًا') +
      '.\n' +
      '  من يعرفه يستطيع تزوير كوكي neverland.sid وانتحال أي حساب.\n\n' +
      '  الحل:\n' +
      '    1) ولّد سرًا:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n' +
      '    2) أضفه كمتغيّر بيئة:  SESSION_SECRET=<السر>\n' +
      '       • Railway:  railway variables --set "SESSION_SECRET=…"\n' +
      '       • Render:   Environment → Add\n' +
      '       • محليًا:   ضعه في ملف .env\n\n' +
      '  تغيير السر يُبطل الجلسات القائمة تلقائيًا (سيلزم الأعضاء إعادة الدخول).\n\n',
  );
  /* وسم يميّزه عن أخطاء الإقلاع العادية حتى لا يبتلعه معالج try/catch */
  err.code = 'INSECURE_SESSION_SECRET';
  throw err;
};

/** فحص الإعدادات الأساسية وإرجاع قائمة بالمشاكل */
config.validate = () => {
  const problems = [];
  if (!config.bot.token) problems.push('DISCORD_TOKEN غير موجود في ملف .env');
  if (!config.bot.clientId) problems.push('CLIENT_ID غير موجود في ملف .env');
  if (config.web.enabled && !config.web.demoMode && config.sessionSecretIsWeak()) {
    problems.push(config.SESSION_SECRET_HELP);
  }
  return problems;
};

/**
 * تحديد الرابط العام للموقع تلقائيًا:
 *  1) DASHBOARD_URL إن كان مضبوطًا (اختيار صاحب المشروع)
 *  2) نطاق منصات النشر: Railway / Render / Fly / Vercel / متغير PUBLIC_URL
 *  3) بيئة المعاينة (e2b): https://<المنفذ>-<معرّف البيئة>.e2b.app — يتغيّر كل جلسة
 *  4) localhost (يعمل على الجهاز الذي يشغّل المشروع فقط)
 * إذا كان DASHBOARD_URL من نوع e2b.app وصار قديمًا (بيئة أخرى)، نستخدم الرابط الحيّ تلقائيًا.
 */
function resolveWebUrl() {
  const port = int(process.env.DASHBOARD_PORT || process.env.PORT, 3000);
  const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

  let auto = '';
  if (process.env.RAILWAY_PUBLIC_DOMAIN) auto = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  else if (process.env.RENDER_EXTERNAL_URL) auto = process.env.RENDER_EXTERNAL_URL;
  else if (process.env.FLY_APP_NAME) auto = `https://${process.env.FLY_APP_NAME}.fly.dev`;
  else if (process.env.VERCEL_URL) auto = `https://${process.env.VERCEL_URL}`;
  else if (process.env.E2B_SANDBOX && process.env.E2B_SANDBOX_ID) {
    auto = `https://${port}-${process.env.E2B_SANDBOX_ID}.e2b.app`;
  } else if (process.env.PUBLIC_URL) auto = process.env.PUBLIC_URL;

  const configured = clean(process.env.DASHBOARD_URL);
  const isStalePreview = /\.e2b\.app$/i.test(configured) && auto && clean(auto) !== configured;

  if (configured && !isStalePreview) return configured;
  if (auto) return clean(auto);
  if (configured) return configured;
  return `http://localhost:${port}`;
}

/**
 * بيانات العرض (DEMO) تُستخدم فقط عندما لا يوجد توكن حقيقي.
 * بمجرد وضع DISCORD_TOKEN في .env تتوقف كل بيانات العرض تلقائيًا
 * وتصير الصفحات تقرأ بياناتك الحقيقية من ديسكورد.
 */
Object.defineProperty(config.web, 'demoData', {
  get() {
    return Boolean(this.demoMode) && !config.bot.hasToken;
  },
  enumerable: true,
});

config.isDev = () => config.bot.developerIds.length > 0;

module.exports = config;
