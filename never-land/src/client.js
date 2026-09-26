'use strict';

/**
 * client.js
 * -------------------------------------------------------------
 * إنشاء عميل ديسكورد مع كل الـ Intents المطلوبة + حقول مساعدة
 * (أوامر، كولداون، تتبّع السبام، الكاش).
 * -------------------------------------------------------------
 */

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,          // ترحيب + رولات تلقائية (Intent مميّز)
    GatewayIntentBits.GuildMessages,         // الحماية التلقائية + اللوقات
    GatewayIntentBits.MessageContent,        // قراءة محتوى الرسائل (Intent مميّز)
    GatewayIntentBits.GuildModeration,       // لوقات الحظر
    GatewayIntentBits.GuildVoiceStates,      // XP الصوت + لوقات الصوت
    GatewayIntentBits.GuildInvites,          // تتبّع الدعوات (مين دعا مين)
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User, Partials.Reaction],
  allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
  shards: [0],
  rest: { timeout: 10000 },
  waitGuildTimeout: 8000,
});

/** كل أوامر السلاش: name -> command module */
client.commands = new Collection();
/** أزرار السلاش (help, tickets, selfroles...) */
client.buttons = new Collection();
/** كولداون لكل مستخدم/أمر */
client.cooldowns = new Collection();
/** تتبّع السبام: `${guildId}:${userId}` -> [timestamps] */
client.spamTracker = new Map();
/** تتبّع الدعوات: guildId -> Map(code, uses) */
client.invites = new Map();
/** تتبّع الدخول الجماعي (Anti-Raid): guildId -> [timestamps] */
client.joinTracker = new Map();
/** كاش بسيط للقنوات/الأعضاء لتقليل طلبات API */
client.cache = new Map();

client.errorCount = 0;
client.startedAt = Date.now();

module.exports = client;
