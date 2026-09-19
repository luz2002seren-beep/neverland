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
    language: process.env.DEFAULT_LANGUAGE || 'ar',
    prefix: '!',
    welcome: {
      enabled: false,
      channelId: null,
      message: 'أهلاً بك {user} في **{server}**، عدد الأعضاء الآن **{memberCount}**.',
      /** إرسال الرسالة داخل إطار Embed؟ false = صورة الترحيب + رسالة عادية (الطريقة الاحترافية) */
      embed: false,
      /** النص الذي يُرسم على صورة الترحيب نفسها */
      cardMessage: 'أهلاً بك {displayName} في {server}',
      dm: false,
      dmMessage: 'أهلاً بك في **{server}**. يُرجى الاطلاع على قوانين السيرفر قبل المشاركة.',
      autoDeleteAfter: 0,
      /** صورة الترحيب: none | avatar | card | custom */
      imageMode: 'card',
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
    tickets: {
      enabled: false,
      categoryId: null,
      supportRoleIds: [],
      logChannelId: null,
      panelTitle: 'مركز الدعم',
      panelDescription: 'اختر نوع التذكرة من القائمة بالأسفل وسيتم فتح غرفة خاصة لك.',
      panelFooter: 'Never Land — فريق الدعم',
      responseTime: '24 ساعة',
      /** select = قائمة منسدلة • buttons = أزرار (حتى 5 أنواع) */
      panelMode: 'buttons',
      /** إرسال رسالة البنل كـ embed منفصل + رسالة تعليمات */
      panelSeparateInfo: true,
      panelInfoMessage: '**كيف أحصل على الدعم؟**\nاختر نوع الطلب من الأزرار أدناه، وسيُفتح لك روم خاص مع فريق الدعم.',
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

/** فحص الإعدادات الأساسية وإرجاع قائمة بالمشاكل */
config.validate = () => {
  const problems = [];
  if (!config.bot.token) problems.push('DISCORD_TOKEN غير موجود في ملف .env');
  if (!config.bot.clientId) problems.push('CLIENT_ID غير موجود في ملف .env');
  if (config.web.enabled && !config.web.demoMode && config.web.sessionSecret.includes('change-me')) {
    problems.push('SESSION_SECRET افتراضي — غيّره قبل النشر على الإنترنت');
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
