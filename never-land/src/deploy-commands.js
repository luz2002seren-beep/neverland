'use strict';

/**
 * deploy-commands.js
 * -------------------------------------------------------------
 * تسجيل أوامر السلاش في ديسكورد.
 *  • عند التشغيل العادي: تسجيل فوري في كل سيرفر (Instant) — التحديث فوري.
 *  • عند استخدام `node src/deploy-commands.js --global`: تسجيل عالمي
 *    (يظهر في كل السيرفرات لكن قد يستغرق حتى ساعة أول مرة).
 * -------------------------------------------------------------
 */

const { REST, Routes } = require('discord.js');
const config = require('./config');

/**
 * تسجيل الأوامر.
 * @param {import('discord.js').Client} client عميل جاهز (اختياري)
 * @param {{global?: boolean}} options
 */
async function deployCommands(client, { global = false } = {}) {
  const commands = [...client.commands.values()].map((cmd) => cmd.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.bot.token);
  const isGlobal = global || process.argv.includes('--global');

  if (isGlobal) {
    const data = await rest.put(Routes.applicationCommands(config.bot.clientId), { body: commands });
  console.log(`[الويب] تم تسجيل ${data.length} أمر عالمي (قد يستغرق حتى ساعة للظهور).`);
    return data;
  }

  // تسجيل محلي في كل سيرفر (ظهور فوري)
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const data = await rest.put(Routes.applicationGuildCommands(config.bot.clientId, guild.id), { body: commands });
      total += data.length;
    } catch (err) {
   console.warn(`  [تنبيه] فشل التسجيل في ${guild.name}: ${err.message}`);
    }
  }
  /* النسخة العالمية بنفس الأسماء كانت تظهر مع نسخة السيرفر وتعارض السلاش. نبقي نسخة السيرفر فقط. */
  try {
    await rest.put(Routes.applicationCommands(config.bot.clientId), { body: [] });
    console.log('[أوامر] تم حذف النسخة العالمية المكررة. السلاش يبقى من السيرفر فقط.');
  } catch (err) {
    console.warn('[تنبيه] تعذّر حذف الأوامر العالمية:', err.message);
  }
 console.log(`[تم] تم تسجيل ${commands.length} أمر في ${client.guilds.cache.size} سيرفر (ظهور فوري).`);
  return total;
}

/** تشغيل مباشر: node src/deploy-commands.js [--global] */
if (require.main === module) {
  (async () => {
    const problems = config.validate();
    if (problems.length) {
   console.error('[خطأ] إعدادات ناقصة:');
      problems.forEach((p) => console.error(`   • ${p}`));
      process.exit(1);
    }

    const { loadCommands } = require('./handlers/commands');
    const fakeClient = { commands: new Map(), guilds: { cache: new Map() } };
    loadCommands(fakeClient);

    // للتسجيل العالمي لا نحتاج سيرفرات
    const rest = new REST({ version: '10' }).setToken(config.bot.token);
    const commands = [...fakeClient.commands.values()].map((cmd) => cmd.data.toJSON());

    if (process.argv.includes('--global')) {
      const data = await rest.put(Routes.applicationCommands(config.bot.clientId), { body: commands });
   console.log(`[الويب] تم تسجيل ${data.length} أمر عالمي.`);
      process.exit(0);
    }

    // تسجيل محلي: نحتاج قائمة السيرفرات من الـ API
    try {
      const guilds = await rest.get(Routes.userGuilds());
      for (const guild of guilds) {
        await rest.put(Routes.applicationGuildCommands(config.bot.clientId, guild.id), { body: commands });
      }
   console.log(`[تم] تم تسجيل ${commands.length} أمر في ${guilds.length} سيرفر.`);
    } catch (err) {
   console.error('[خطأ] فشل التسجيل:', err.message);
      process.exit(1);
    }
    process.exit(0);
  })();
}

module.exports = { deployCommands };
