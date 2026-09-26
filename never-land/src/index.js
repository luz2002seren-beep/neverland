'use strict';

/**
 * index.js — نقطة تشغيل المشروع
 * -------------------------------------------------------------
 * يقلع: قاعدة البيانات → البوت (الأوامر + الأحداث) → لوحة الويب.
 * خيارات التشغيل:
 *   node src/index.js            (البوت + اللوحة)
 *   node src/index.js --no-web   (البوت فقط)
 *   node src/index.js --no-bot   (اللوحة فقط)
 *   RUN_BOT=false / RUN_WEB=false عبر متغيّرات البيئة (نفس التأثير — للنشر)
 * -------------------------------------------------------------
 */

const { Events } = require('discord.js');
const config = require('./config');
const db = require('./database');
const { loadCommands } = require('./handlers/commands');
const { loadEvents } = require('./handlers/events');
const { deployCommands } = require('./deploy-commands');

const args = process.argv.slice(2);
const off = (v) => String(v ?? '').trim().toLowerCase() === 'false';
/* يمكن التحكم من متغيّرات البيئة أيضًا (مفيد على Railway/Render):
   RUN_BOT=false لتشغيل الموقع فقط • RUN_WEB=false لتشغيل البوت فقط */
const runBot = !args.includes('--no-bot') && !off(process.env.RUN_BOT);
const runWeb = !args.includes('--no-web') && config.web.enabled && !off(process.env.RUN_WEB);

/* ------------------------- حماية من الأخطاء غير المتوقّعة ------------------------- */
process.on('unhandledRejection', (err) => {
 console.error('[تنبيه] Promise مرفوض بدون معالجة:', err?.message || err);
});
process.on('uncaughtException', (err) => {
 console.error('[خطأ عام] خطأ غير متوقّع:', err);
});

async function startBot() {
  // لا يوجد توكن حقيقي بعد → الموقع يكفي، والبوت يُشغَّل لاحقًا
  if (!config.bot.hasToken) {
    console.log('');
    console.log('[ملاحظة] ما في توكن Discord صالح بعد — البوت لن يعمل، والموقع يعمل طبيعي.');
    console.log('         أضف DISCORD_TOKEN في ملف .env لتشغيل البوت وربط معلومات سيرفرك بالموقع.');
    console.log('');
    return null;
  }

  const problems = config.validate();

  if (!config.bot.token || !config.bot.clientId) {
    console.error('');
  console.error('[خطأ] لا يمكن تشغيل البوت: معلومات ناقصة في ملف .env');
    problems.forEach((p) => console.error(`   • ${p}`));
    console.error('');
    console.error('انسخ ملف .env.example إلى .env واملأ: DISCORD_TOKEN و CLIENT_ID');
    console.error('');
    return null;
  }

  const client = require('./client');

  /* شكل موحّد لكل ردود البوت: إنجليزي + خط مزخرف (يُطفأ من لوحة التحكم) */
  try {
    require('./lib/replies').installSendDecorators();
  } catch (err) {
    console.error('[تنبيه] تعذّر تفعيل مزيّن الردود:', err.message);
  }

 console.log('[تشغيل] جارٍ تشغيل Never Land ...');
  db.init();

  // تحميل الأوامر والأحداث
  loadCommands(client);
  loadEvents(client);

  // زرع الردود التلقائية الافتراضية مرة واحدة (ترحيب جاهز يتعدّل من الموقع)
  try {
    const seeded = require('./systems/autoreply').seedStarterRules();
    if (seeded) console.log(`[تهيئة] تم تجهيز ردود تلقائية افتراضية في ${seeded} سيرفر.`);
  } catch (err) {
  console.error('[تنبيه] تعذّر تجهيز الردود التلقائية:', err.message);
  }

  // تسجيل أوامر السلاش (بعد ربط الحساب)
  client.once(Events.ClientReady, async () => {
    try {
      await deployCommands(client);
    } catch (err) {
   console.error('[تنبيه] فشل تسجيل أوامر السلاش:', err.message);
    }
  });

  client.on('error', (err) => console.error('[ديسكورد] خطأ:', err?.message || err));
  client.on('shardError', (err) => console.error('[ديسكورد] خطأ اتصال:', err?.message || err));
  client.on('shardDisconnect', (event, id) => console.error('[ديسكورد] انقطع الاتصال', id, event?.code || ''));
  client.on('debug', (msg) => {
    const line = String(msg || '');
    if (/token|authorization/i.test(line)) return;
    console.log('[ديسكورد]', line.slice(0, 220));
  });

  const token = String(config.bot.token || '').trim();
  let connected = false;
  for (let attempt = 1; attempt <= 4 && !connected; attempt += 1) {
    console.log(`[دخول] محاولة الاتصال ${attempt}`);
    try {
      await Promise.race([
        client.login(token),
        new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة الدخول')), 20000)),
      ]);
      connected = Boolean(client.isReady());
    } catch (err) {
      console.error(`[دخول] فشلت المحاولة ${attempt}:`, err?.message || err);
      try { client.destroy(); } catch { /* إعادة المحاولة */ }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  if (!connected) {
    console.error('[دخول] البوت ما اتصل. الموقع يبقى شغال، والمحاولة تتكرر كل دقيقة.');
    setInterval(() => {
      if (client.isReady()) return;
      client.login(token).catch((err) => console.error('[دخول] إعادة:', err?.message || err));
    }, 60000);
  } else {
    console.log('[دخول] البوت اتصل');
  }

  if (problems.length) {
  console.warn('[تنبيه] ملاحظات على الإعدادات:');
    problems.forEach((p) => console.warn(`   • ${p}`));
  }

  return client;
}

function startWeb() {
  try {
    const { startServer } = require('./web/server');
    return startServer();
  } catch (err) {
    /* رفض أمني صريح: لا نكمل بواجهة غير محمية — الخروج أفضل من انتحال حسابات */
    if (err.code === 'INSECURE_SESSION_SECRET') {
      console.error(err.message);
      process.exit(1);
    }
    console.error('[تنبيه] فشل تشغيل لوحة التحكم:', err.message);
    return null;
  }
}

(async () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║            N E V E R   L A N D                ║');
  console.log('║        بوت إدارة سيرفرات ديسكورد + لوحة       ║');
  console.log('║     مودريشن • حماية • تذاكر • مستويات • لوحة  ║');
  console.log('╚═══════════════════════════════════════════════╝');

  // الموقع يفتح قبل انتظار ديسكورد، حتى لا يبقى الزائر على صفحة فارغة لو تأخر الدخول.
  if (runWeb) startWeb();

  const botClient = runBot ? await startBot() : null;
  if (!runBot) console.log('[ملاحظة] تم تجاوز تشغيل البوت (--no-bot)');

  /* فحص الإعدادات لازم يخدم دائمًا — حتى لو اشتغل الموقع وحده.
     سابقًا كان validate() يُنادى داخل startBot() فقط، وبعد شرط
     «ما في توكن ⇒ ارجع»، فأي نشر للموقع وحده (RUN_BOT=false أو بلا توكن)
     كان يمرّ بدون أي تحذير على SESSION_SECRET الافتراضي. */
  if (!botClient) {
    for (const p of config.validate()) console.warn(`[تنبيه] ${p}`);
  }

  // المزامنة الحقيقية: من البوت إن كان متّصلًا، وإلا عبر واجهة ديسكورد بالتوكن
  const sync = require('./sync');
  if (config.sync.enabled) {
    if (botClient) sync.start(botClient);
    else {
      await sync.syncNow({ client: null, silent: true }).catch(() => {});
      const st = sync.getStatus();
      console.log(
        st.ok
          ? `[مزامنة] زامنّا ${st.guilds} سيرفر من ديسكورد (المصدر: ${st.source}).`
          : '[مزامنة] لا توكن بعد — البيانات الحالية من آخر مزامنة محفوظة.',
      );
    }
  }

  if (!runWeb) {
    console.log('[تنبيه] الموقع غير شغّال في هذه الجلسة (--no-web أو web.enabled=false).');
    console.log('        لذلك زر «افتح الموقع» في ديسكورد لن يفتح شيئًا حتى تشغّله.');
  }

  console.log('');
  console.log('[تم] كل شيء جاهز. اضغط Ctrl+C للإيقاف.');
  if (runWeb) {
    const port = config.web.port;
    const isLocalUrl = /localhost|127\.0\.0\.1/.test(config.web.url);
    if (isLocalUrl) {
      console.log(`[الموقع] افتح في المتصفح: http://localhost:${port}`);
      console.log('[ملاحظة] هذا الرابط يعمل على جهازك فقط. لنشر الموقع على الإنترنت: railway.com أو أي سيرفر.');
    } else {
      console.log(`[الموقع] الرابط العام: ${config.web.url}`);
      console.log(`[الموقع] من داخل السيرفر نفسه: http://localhost:${port}`);
    }
  }
  console.log('');
})();

/* إغلاق نظيف */
const shutdown = (signal) => {
 console.log(`\n[إيقاف] استلام ${signal} — إغلاق نظيف...`);
  try {
    db.close();
  } catch {
    /* تجاهل */
  }
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
