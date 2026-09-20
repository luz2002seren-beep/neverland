'use strict';

/**
 * events/ready.js
 * -------------------------------------------------------------
 * عند جاهزية البوت:
 * - تعيين حالة البوت
 * - تسجيل السيرفرات في قاعدة البيانات
 * - تحميل كاش الدعوات
 * - تشغيل المؤقتات
 * -------------------------------------------------------------
 */

const { ActivityType } = require('discord.js');
const db = require('../database');
const leveling = require('../systems/leveling');
const config = require('../config');

module.exports = {
  name: 'ready',
  once: true,

  async execute(client) {
    console.log('');
    console.log('=================================================');
    console.log(`البوت شغّال: ${client.user.tag}`);
    console.log(
      `السيرفرات: ${client.guilds.cache.size} | الأعضاء: ${client.guilds.cache.reduce(
        (a, g) => a + g.memberCount,
        0
      )}`
    );
    console.log(`الأوامر المحمّلة: ${client.commands.size}`);
    console.log(`قاعدة البيانات: ${db.driverName}`);
    console.log(`لوحة التحكم: ${config.web.url}`);
    console.log('=================================================');
    console.log('');

    /* ---------------------------------------------------------
     * Presence
     * Playing: NEVER LAND
     * --------------------------------------------------------- */

    client.user.setPresence({
      activities: [
        {
          name: 'NEVER LAND',
          type: ActivityType.Playing,
        },
      ],
      status: 'online',
    });

    /* ---------------------------------------------------------
     * تسجيل كل السيرفرات في قاعدة البيانات
     * --------------------------------------------------------- */

    for (const guild of client.guilds.cache.values()) {
      db.init();
      db.getGuild(guild.id);
    }

    /* ---------------------------------------------------------
     * تحميل كاش الدعوات
     * --------------------------------------------------------- */

    for (const guild of client.guilds.cache.values()) {
      if (!guild.members.me?.permissions.has('ManageGuild')) {
        continue;
      }

      const invites = await guild.invites.fetch().catch(() => null);

      if (invites) {
        client.invites.set(
          guild.id,
          new Map(
            invites.map((inv) => [
              inv.code,
              inv.uses ?? 0,
            ])
          )
        );
      }
    }

    /* ---------------------------------------------------------
     * المؤقتات
     * --------------------------------------------------------- */

    // XP الصوتي: كل دقيقة
    setInterval(() => {
      leveling.tickVoiceXp(client);
    }, 60000).unref?.();

    /* 🧹 روم الأوامر: نشر رسالة الترحيب بالصورة + تنظيف الرسائل كل مدة (٦٠ ثانية افتراضيًا) */
    try {
      require('../systems/commandRoom').start(client);
      console.log('[روم الأوامر] المؤقّت شغّال (تنظيف تلقائي للرسائل).');
    } catch (err) {
      console.error('[تنبيه] تعذّر تشغيل روم الأوامر:', err.message);
    }

    /* 👋 شكل الترحيب الجديد (إطار Never Land + الأفتار داخل الدائرة) — ترقية مرة واحدة لكل سيرفر */
    try {
      const welcomeSystem = require('../systems/welcome');
      let upgraded = 0;
      for (const guild of client.guilds.cache.values()) {
        if (welcomeSystem.ensureStyle(guild.id)) upgraded += 1;
        /* صورة إطار جديدة ⇒ نحدّث مكان دائرة الأفتار المحفوظ */
        if (welcomeSystem.ensureFrameLayout(guild.id)) upgraded += 1;
        /* إيموجيات نص الترحيب: أي إيموجي مو موجود بالسيرفر نرفعه لحاله (حتى يظهر صح) */
        const welcomeCfg = db.getGuildSettings(guild.id)?.welcome;
        if (welcomeSystem.missingEmojis(guild, welcomeCfg?.message).length) {
          const fix = await welcomeSystem.ensureEmojis(guild, welcomeCfg, { client }).catch(() => null);
          if (fix?.added?.length) console.log(`[الترحيب] إيموجيات مضافة في ${guild.id}: ${fix.added.map((a) => a.name).join(' · ')}`);
        }
      }
      console.log(`[الترحيب] الفحص التلقائي — ${client.guilds.cache.size} سيرفر · ترقية ${upgraded}`);
    } catch (err) {
      console.error('[تنبيه] تعذّر فحص شكل الترحيب:', err.message);
    }

    /* 🖼️ لوحة التذاكر: نشر/تحديث تلقائي (صورة اللوحة + القائمة) لما تتغيّر */
    setTimeout(() => {
      try {
        require('../systems/tickets')
          .ensureAll(client)
          .then((results) => {
            const posted = results.filter((r) => r.reason === 'posted').length;
            console.log(`[لوحة التذاكر] فحص تلقائي — ${results.length} سيرفر · تحديث ${posted}`);
          })
          .catch(() => {});
      } catch (err) {
        console.error('[تنبيه] تعذّر فحص لوحة التذاكر:', err.message);
      }
    }, 6000).unref?.();

    // التذكيرات: كل 15 ثانية
    setInterval(async () => {
      const due = db.dueReminders();

      for (const reminder of due) {
        const guild = client.guilds.cache.get(reminder.guild_id);
        const channel = guild?.channels.cache.get(reminder.channel_id);

        if (channel?.isTextBased?.()) {
          await channel
            .send({
              content: `<@${reminder.user_id}> تذكير: **${reminder.content}**`,
            })
            .catch(() => {});
        } else if (guild) {
          const member = await guild.members
            .fetch(reminder.user_id)
            .catch(() => null);

          await member?.send({
            content: `تذكير: **${reminder.content}**`,
          }).catch(() => {});
        }

        db.deleteReminder(reminder.id);
      }
    }, 15000).unref?.();

    // تنظيف ذاكرة السبام كل 5 دقائق
    setInterval(() => {
      const now = Date.now();

      for (const [key, stamps] of client.spamTracker) {
        const fresh = stamps.filter(
          (ts) => now - ts < 120000
        );

        if (fresh.length) {
          client.spamTracker.set(key, fresh);
        } else {
          client.spamTracker.delete(key);
        }
      }
    }, 300000).unref?.();
  },
};
