'use strict';

/**
 * lib/i18n.js
 * -------------------------------------------------------------
 * نظام ترجمة (عربي / إنجليزي) لكل ردود البوت.
 * العربية هي الافتراضية — وهذا جوهر تميّز المشروع.
 * الاستخدام:  const { t } = require('../lib/i18n');  t(lang, 'mod.banned', {...})
 * -------------------------------------------------------------
 */

const strings = {
  ar: {
    common: {
      error: '❌ حدث خطأ',
      success: '✅ تم بنجاح',
      noPermission: '❌ ما عندك صلاحية لاستخدام هذا الأمر.',
      botNoPermission: '❌ ما عندي صلاحية كافية لتنفيذ هذا. تأكد من رفع رتبتي فوق الرتبة المطلوبة.',
      userNotFound: '❌ ما قدرت ألاقي هذا العضو في السيرفر.',
      invalidUsage: '❌ استخدام خاطئ للأمر.',
      disabled: '⚙️ هذه الميزة معطّلة حالياً. شغّلها من لوحة التحكم أو بأمر `/{module}`.',
      reasonNone: 'بدون سبب مذكور',
      by: 'بواسطة',
      case: 'الحالة',
      yes: 'نعم',
      no: 'لا',
      enabled: 'مُفعّل',
      disabledWord: 'مُعطّل',
      unknown: 'غير معروف',
      never: 'أبداً',
      none: 'لا يوجد',
      confirm: 'تأكيد',
      cancel: 'إلغاء',
      page: 'صفحة',
      of: 'من',
    },
    mod: {
      banned: '🔨 تم حظر **{user}**\n**السبب:** {reason}\n**رقم الحالة:** #{caseId}',
      unbanned: '✅ تم فك الحظر عن **{user}**',
      kicked: '👢 تم طرد **{user}**\n**السبب:** {reason}\n**رقم الحالة:** #{caseId}',
      timedOut: '🔇 تم إسكات **{user}** لمدة {duration}\n**السبب:** {reason}',
      untimedOut: '🔊 تم فك الإسكات عن **{user}**',
      warned: '⚠️ تم تحذير **{user}**\n**السبب:** {reason}\n**عدد تحذيراته:** {count}',
      warnedDm: '⚠️ تم تحذيرك في **{server}**\n**السبب:** {reason}',
      banDm: '🔨 تم حظرك من **{server}**\n**السبب:** {reason}',
      kickDm: '👢 تم طردك من **{server}**\n**السبب:** {reason}',
      timeoutDm: '🔇 تم إسكاتك في **{server}** لمدة {duration}\n**السبب:** {reason}',
      cleared: '🧹 تم حذف **{count}** رسالة.',
      slowmodeSet: '🐌 تم ضبط الوضع البطيء على {seconds} ثانية.',
      channelLocked: '🔒 تم قفل القناة {channel}',
      channelUnlocked: '🔓 تم فتح القناة {channel}',
      warnNotFound: '❌ ما لقيت تحذير بهذا الرقم.',
      warnRemoved: '✅ تم حذف التحذير #{id}',
      warnsCleared: '✅ تم حذف كل تحذيرات **{user}** ({count})',
      historyEmpty: '📭 ما في أي تحذيرات مسجّلة لهذا العضو.',
      historyTitle: '📋 سجل تحذيرات {user}',
      caseNotFound: '❌ ما لقيت حالة بهذا الرقم.',
      caseTitle: '📁 تفاصيل الحالة #{id}',
      nicknameSet: '✅ تم تغيير الاسم المستعار إلى **{name}**',
      roleAdded: '✅ تم إعطاء رتبة {role} لـ **{user}**',
      roleRemoved: '✅ تم سحب رتبة {role} من **{user}**',
      hierarchy: '❌ ما أقدر أتحكم بهذا العضو، رتبته أعلى مني أو مساوي لي.',
      targetIsStaff: '❌ هذا العضو إداري، ما يمكن تطبيق العقوبة عليه.',
      selfAction: '❌ ما تقدر تطبّق هذا على نفسك.',
    },
    automod: {
      spam: '🚫 **{user}** الرجاء التوقف عن الإرسال السريع.',
      link: '🚫 الروابط غير مسموحة في هذا السيرفر يا **{user}**.',
      invite: '🚫 دعوات السيرفرات الأخرى غير مسموحة يا **{user}**.',
      caps: '🚫 الرجاء عدم الكتابة بحروف كبيرة يا **{user}**.',
      mentionSpam: '🚫 ممنوع عمل منشن جماعي يا **{user}**.',
      everyone: '🚫 ممنوع عمل منشن للجميع يا **{user}**.',
      bannedWord: '🚫 كلمة ممنوعة تم رصدها يا **{user}**.',
      punished: 'تم تطبيق العقوبة: **{punishment}**',
      logTitle: '🛡️ الحماية التلقائية',
    },
    welcome: {
      dmText: 'أهلاً بك في **{server}**! لا تنسَ قراءة قوانين السيرفر 😊',
    },
    tickets: {
      created: '✅ تم إنشاء تذكرة {type}: {channel}',
      alreadyOpen: '❌ عندك تذكرة مفتوحة بالفعل: {channel}',
      maxOpen: '❌ وصلت للحد الأقصى من التذاكر المفتوحة ({max}).',
      closed: '🔒 تم إغلاق التذكرة بواسطة {user}.',
      claimed: '🙋 تم استلام التذكرة بواسطة {user}.',
      added: '✅ تمت إضافة {user} إلى التذكرة.',
      removed: '✅ تمت إزالة {user} من التذكرة.',
      intro: 'مرحباً {user}، شكراً لتواصلك!\n**النوع:** {type}\nسيقوم فريق الدعم بالرد عليك في أقرب وقت.',
      noCategory: '❌ لم يتم ضبط قسم التذاكر بعد. استخدم `/tickets setup`.',
      notATicket: '❌ هذه القناة ليست تذكرة.',
    },
    leveling: {
      rankTitle: '📊 ترتيب {user}',
      level: 'المستوى',
      xp: 'نقاط الخبرة',
      rank: 'الترتيب',
      leaderboard: '🏆 لوحة المتصدرين',
      noData: '📭 ما في بيانات خبرة بعد. ابدأوا بالدردشة!',
    },
    help: {
      title: '🤖 Never Land — قائمة الأوامر',
      footer: 'استخدم الأزرار للتنقل بين الأقسام',
    },
    premium: {
      title: 'اشتراك البوت',
      guildOnly: 'هذا الأمر يشتغل داخل السيرفر فقط.',
      active: 'الخطة: **{plan}**\nينتهي: **{until}**\nالوحدات الحالية تبقى شغّالة.',
      free: 'هذا السيرفر على الخطة المجانية.\nاطلب البريميوم من لوحة التحكم، قسم الاشتراك. التفعيل من مالك الموقع، بلا خصم بطاقة.',
      plan: 'بريميوم',
      month: 'شهر',
      quarter: '٣ أشهر',
      year: 'سنة',
      lifetime: 'دائم',
    },
  },

  en: {
    common: {
      error: '❌ An error occurred',
      success: '✅ Success',
      noPermission: '❌ You do not have permission to use this command.',
      botNoPermission: '❌ I am missing permissions. Make sure my role is above the target role.',
      userNotFound: '❌ I could not find that member.',
      invalidUsage: '❌ Invalid usage.',
      disabled: '⚙️ This feature is disabled. Enable it from the dashboard or `/config`.',
      reasonNone: 'No reason provided',
      by: 'by',
      case: 'Case',
      yes: 'Yes',
      no: 'No',
      enabled: 'Enabled',
      disabledWord: 'Disabled',
      unknown: 'Unknown',
      never: 'Never',
      none: 'None',
      confirm: 'Confirm',
      cancel: 'Cancel',
      page: 'Page',
      of: 'of',
    },
    mod: {
      banned: '🔨 **{user}** has been banned\n**Reason:** {reason}\n**Case:** #{caseId}',
      unbanned: '✅ **{user}** has been unbanned',
      kicked: '👢 **{user}** has been kicked\n**Reason:** {reason}\n**Case:** #{caseId}',
      timedOut: '🔇 **{user}** has been timed out for {duration}\n**Reason:** {reason}',
      untimedOut: '🔊 **{user}** timeout removed',
      warned: '⚠️ **{user}** has been warned\n**Reason:** {reason}\n**Total warnings:** {count}',
      warnedDm: '⚠️ You were warned in **{server}**\n**Reason:** {reason}',
      banDm: '🔨 You were banned from **{server}**\n**Reason:** {reason}',
      kickDm: '👢 You were kicked from **{server}**\n**Reason:** {reason}',
      timeoutDm: '🔇 You were timed out in **{server}** for {duration}\n**Reason:** {reason}',
      cleared: '🧹 Deleted **{count}** messages.',
      slowmodeSet: '🐌 Slowmode set to {seconds}s.',
      channelLocked: '🔒 Locked {channel}',
      channelUnlocked: '🔓 Unlocked {channel}',
      warnNotFound: '❌ No warning with that ID.',
      warnRemoved: '✅ Warning #{id} removed',
      warnsCleared: '✅ Cleared **{user}** warnings ({count})',
      historyEmpty: '📭 No warnings recorded for this member.',
      historyTitle: '📋 Warnings for {user}',
      caseNotFound: '❌ No case with that number.',
      caseTitle: '📁 Case #{id} details',
      nicknameSet: '✅ Nickname changed to **{name}**',
      roleAdded: '✅ Gave {role} to **{user}**',
      roleRemoved: '✅ Removed {role} from **{user}**',
      hierarchy: '❌ I cannot manage this member (role hierarchy).',
      targetIsStaff: '❌ That member is staff and cannot be punished.',
      selfAction: '❌ You cannot do that to yourself.',
    },
    automod: {
      spam: '🚫 **{user}** please stop spamming.',
      link: '🚫 Links are not allowed here, **{user}**.',
      invite: '🚫 Server invites are not allowed, **{user}**.',
      caps: '🚫 Please avoid excessive caps, **{user}**.',
      mentionSpam: '🚫 Mass mentions are not allowed, **{user}**.',
      everyone: '🚫 Mentioning everyone is not allowed, **{user}**.',
      bannedWord: '🚫 A banned word was detected, **{user}**.',
      punished: 'Punishment applied: **{punishment}**',
      logTitle: '🛡️ AutoMod',
    },
    welcome: {
      dmText: 'Welcome to **{server}**! Please read the rules 😊',
    },
    tickets: {
      created: '✅ Ticket created {type}: {channel}',
      alreadyOpen: '❌ You already have an open ticket: {channel}',
      maxOpen: '❌ You reached the maximum open tickets ({max}).',
      closed: '🔒 Ticket closed by {user}.',
      claimed: '🙋 Ticket claimed by {user}.',
      added: '✅ {user} added to the ticket.',
      removed: '✅ {user} removed from the ticket.',
      intro: 'Hello {user}, thanks for reaching out!\n**Type:** {type}\nOur support team will reply shortly.',
      noCategory: '❌ Ticket category is not configured. Use `/tickets setup`.',
      notATicket: '❌ This is not a ticket channel.',
    },
    leveling: {
      rankTitle: '📊 Rank of {user}',
      level: 'Level',
      xp: 'XP',
      rank: 'Rank',
      leaderboard: '🏆 Leaderboard',
      noData: '📭 No XP data yet. Start chatting!',
    },
    help: {
      title: '🤖 Never Land — Commands',
      footer: 'Use the buttons to browse categories',
    },
    premium: {
      title: 'Bot subscription',
      guildOnly: 'This command only works inside a server.',
      active: 'Plan: **{plan}**\nEnds: **{until}**\nYour current modules stay on.',
      free: 'This server is on the free plan.\nRequest premium from the dashboard, Subscription section. The site owner activates it. No card charge.',
      plan: 'Premium',
      month: 'Month',
      quarter: '3 months',
      year: 'Year',
      lifetime: 'Lifetime',
    },
  },
};

/** استبدال المتغيرات {key} داخل النص */
const interpolate = (text, vars = {}) =>
  String(text).replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));

/**
 * جلب نص مترجم.
 * @param {string} lang 'ar' أو 'en'
 * @param {string} key مفتاح مثل 'mod.banned'
 * @param {object} vars متغيرات الاستبدال
 */
function t(lang, key, vars = {}) {
  const tree = key.split('.');
  let node = strings[lang] || strings.ar;
  for (const part of tree) {
    node = node?.[part];
    if (node === undefined) break;
  }
  if (node === undefined) {
    // احتياطي: ابحث في العربية ثم أرجع المفتاح نفسه
    let fallback = strings.ar;
    for (const part of tree) {
      fallback = fallback?.[part];
      if (fallback === undefined) break;
    }
    node = fallback ?? key;
  }
  return typeof node === 'string' ? interpolate(node, vars) : key;
}

module.exports = { t, strings, languages: Object.keys(strings) };
