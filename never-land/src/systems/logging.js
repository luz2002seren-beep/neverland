'use strict';

/**
 * systems/logging.js
 * -------------------------------------------------------------
 * نظام اللوقات الشامل:
 *   • 40 حدثًا موزّعة على 9 مجموعات
 *   • كل حدث يمكن تشغيله/إطفاؤه على حدة من اللوحة أو بأمر /logs
 *   • استثناء قنوات ورتب من اللوقات
 *   • كشف المنفّذ من سجل التدقيق (Audit Log)
 * -------------------------------------------------------------
 */

const { PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { base } = require('../lib/embeds');
const config = require('../config');

/** مجموعات الأحداث (تُستخدم في لوحة التحكم وأمر /logs) */
const EVENT_GROUPS = {
  messages: { emoji: '💬', label: 'الرسائل' },
  members: { emoji: '👥', label: 'الأعضاء' },
  roles: { emoji: '🎭', label: 'الرتب' },
  channels: { emoji: '📁', label: 'القنوات' },
  server: { emoji: '⚙️', label: 'السيرفر والإيموجيات' },
  invites: { emoji: '🔗', label: 'الدعوات' },
  threads: { emoji: '🧵', label: 'المواضيع' },
  voice: { emoji: '🔊', label: 'الصوت' },
  system: { emoji: '🛡️', label: 'الأنظمة' },
};

/** أيقونة PNG خاصة بكل نوع — تظهر في رأس الرسالة */
const ICON = (code) => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`;

/** بيانات كل حدث: الرمز، اللون، الاسم، الأيقونة، المجموعة */
const EVENT_META = {
  messageDelete: { emoji: '🗑️', color: 0xed4245, label: 'حذف رسالة', en: 'Message Deleted', icon: ICON('1f5d1'), group: 'messages' },
  messageEdit: { emoji: '✏️', color: 0xfee75c, label: 'تعديل رسالة', en: 'Message Edited', icon: ICON('270f'), group: 'messages' },
  messageBulkDelete: { emoji: '🧹', color: 0xed4245, label: 'حذف جماعي للرسائل', en: 'Messages Purged', icon: ICON('1f9f9'), group: 'messages' },

  memberJoin: { emoji: '📥', color: 0x57f287, label: 'دخول عضو', en: 'Member Joined', icon: ICON('1f4e5'), group: 'members' },
  memberLeave: { emoji: '📤', color: 0xfee75c, label: 'خروج عضو', en: 'Member Left', icon: ICON('1f4e4'), group: 'members' },
  memberKick: { emoji: '👢', color: 0xed4245, label: 'طرد عضو', en: 'Member Kicked', icon: ICON('1f462'), group: 'members' },
  memberBan: { emoji: '🔨', color: 0xed4245, label: 'حظر عضو', en: 'Member Banned', icon: ICON('1f528'), group: 'members' },
  memberUnban: { emoji: '♻️', color: 0x57f287, label: 'فك حظر', en: 'Ban Removed', icon: ICON('267b'), group: 'members' },
  memberTimeout: { emoji: '🔇', color: 0xfee75c, label: 'إسكات عضو (Timeout)', en: 'Member Timed Out', icon: ICON('23f1'), group: 'members' },
  memberBoost: { emoji: '🚀', color: 0xff73fa, label: 'دعم السيرفر (Boost)', en: 'Server Boost', icon: ICON('1f680'), group: 'members' },
  memberRoleUpdate: { emoji: '🎭', color: 0x5865f2, label: 'تغيير رتب عضو', en: 'Roles Updated', icon: ICON('1f3ad'), group: 'members' },
  memberNickname: { emoji: '📝', color: 0x5865f2, label: 'تغيير اسم عضو', en: 'Nickname Changed', icon: ICON('1f4dd'), group: 'members' },
  memberAvatar: { emoji: '🖼️', color: 0x5865f2, label: 'تغيير صورة عضو', en: 'Avatar Changed', icon: ICON('1f4f7'), group: 'members' },
  memberUsername: { emoji: '🏷️', color: 0x5865f2, label: 'تغيير اسم المستخدم', en: 'Username Changed', icon: ICON('1f3f7'), group: 'members' },

  roleCreate: { emoji: '🎭', color: 0x57f287, label: 'إنشاء رتبة', en: 'Role Created', icon: ICON('2795'), group: 'roles' },
  roleDelete: { emoji: '🎭', color: 0xed4245, label: 'حذف رتبة', en: 'Role Deleted', icon: ICON('274c'), group: 'roles' },
  roleUpdate: { emoji: '🎭', color: 0x5865f2, label: 'تعديل رتبة', en: 'Role Updated', icon: ICON('1f3a8'), group: 'roles' },

  channelCreate: { emoji: '📁', color: 0x57f287, label: 'إنشاء قناة', en: 'Channel Created', icon: ICON('1f4c1'), group: 'channels' },
  channelDelete: { emoji: '📁', color: 0xed4245, label: 'حذف قناة', en: 'Channel Deleted', icon: ICON('274c'), group: 'channels' },
  channelUpdate: { emoji: '✏️', color: 0x5865f2, label: 'تعديل قناة', en: 'Channel Edited', icon: ICON('1f4dd'), group: 'channels' },
  channelPermissions: { emoji: '🔐', color: 0xfee75c, label: 'تغيير صلاحيات قناة', en: 'Permissions Changed', icon: ICON('1f512'), group: 'channels' },

  serverUpdate: { emoji: '⚙️', color: 0x5865f2, label: 'تحديث السيرفر', en: 'Server Updated', icon: ICON('2699'), group: 'server' },
  emojiCreate: { emoji: '😀', color: 0x57f287, label: 'إضافة إيموجي', en: 'Emoji Added', icon: ICON('1f600'), group: 'server' },
  emojiDelete: { emoji: '😶', color: 0xed4245, label: 'حذف إيموجي', en: 'Emoji Removed', icon: ICON('1f636'), group: 'server' },
  stickerCreate: { emoji: '🏷️', color: 0x57f287, label: 'إضافة ملصق', en: 'Sticker Added', icon: ICON('1f3f7'), group: 'server' },
  stickerDelete: { emoji: '🏷️', color: 0xed4245, label: 'حذف ملصق', en: 'Sticker Removed', icon: ICON('1f5d1'), group: 'server' },

  inviteCreate: { emoji: '🔗', color: 0x57f287, label: 'إنشاء دعوة', en: 'Invite Created', icon: ICON('1f517'), group: 'invites' },
  inviteDelete: { emoji: '🔗', color: 0xed4245, label: 'حذف دعوة', en: 'Invite Deleted', icon: ICON('1f6ab'), group: 'invites' },
  inviteUsed: { emoji: '✉️', color: 0x5865f2, label: 'استخدام دعوة', en: 'Invite Used', icon: ICON('1f4e9'), group: 'invites' },

  threadCreate: { emoji: '🧵', color: 0x57f287, label: 'إنشاء موضوع (Thread)', en: 'Thread Created', icon: ICON('1f9f5'), group: 'threads' },
  threadDelete: { emoji: '🧵', color: 0xed4245, label: 'حذف موضوع (Thread)', en: 'Thread Deleted', icon: ICON('2702'), group: 'threads' },

  voiceJoin: { emoji: '🔊', color: 0x57f287, label: 'دخول قناة صوتية', en: 'Voice Join', icon: ICON('1f50a'), group: 'voice' },
  voiceLeave: { emoji: '🔇', color: 0xfee75c, label: 'خروج من قناة صوتية', en: 'Voice Leave', icon: ICON('1f507'), group: 'voice' },
  voiceMove: { emoji: '↔️', color: 0x5865f2, label: 'تنقّل بين قنوات صوتية', en: 'Voice Move', icon: ICON('2194'), group: 'voice' },
  voiceMute: { emoji: '🎙️', color: 0xfee75c, label: 'كتم صوتي', en: 'Voice Mute', icon: ICON('1f399'), group: 'voice' },
  voiceDeafen: { emoji: '🎧', color: 0xfee75c, label: 'إصمام صوتي', en: 'Voice Deafen', icon: ICON('1f3a7'), group: 'voice' },

  modActions: { emoji: '🛡️', color: 0xeb459e, label: 'إجراء إداري', en: 'Mod Action', icon: ICON('1f6e1'), group: 'system' },
  automod: { emoji: '🚨', color: 0xed4245, label: 'الحماية التلقائية', en: 'Automod', icon: ICON('1f6a8'), group: 'system' },
  ticket: { emoji: '🎫', color: 0x5865f2, label: 'التذاكر', en: 'Ticket', icon: ICON('1f3ab'), group: 'system' },
  botStatus: { emoji: '🤖', color: 0xeb459e, label: 'حالة البوتات', en: 'Bot Status', icon: ICON('1f916'), group: 'system' },
};

const TITLE_EN = {
  'حذف رسالة': 'Message Deleted',
  'تعديل رسالة': 'Message Edited',
  'حذف جماعي للرسائل': 'Messages Purged',
  'عضو جديد': 'Member Joined',
  'مغادرة عضو': 'Member Left',
  'طرد عضو': 'Member Kicked',
  'حظر عضو': 'Member Banned',
  'فك حظر': 'Ban Removed',
  'إسكات عضو (Timeout)': 'Member Timed Out',
  'فك الإسكات': 'Timeout Removed',
  'دعم جديد للسيرفر 🚀': 'New Boost',
  'دعم جديد للسيرفر': 'New Boost',
  'انتهاء الدعم': 'Boost Ended',
  'تحديث رتب عضو': 'Roles Updated',
  'تغيير الاسم المستعار': 'Nickname Changed',
  'تغيير صورة الحساب': 'Avatar Changed',
  'تغيّر بوت': 'Bot Changed',
  'تغيير اسم المستخدم': 'Username Changed',
  'إضافة إيموجي جديد': 'Emoji Added',
  'حذف إيموجي': 'Emoji Removed',
  'تعديل إيموجي': 'Emoji Edited',
  'إضافة ملصق جديد': 'Sticker Added',
  'حذف ملصق': 'Sticker Removed',
  'إنشاء دعوة': 'Invite Created',
  'حذف/انتهاء دعوة': 'Invite Deleted',
  'حذف دعوة': 'Invite Deleted',
  'إنشاء موضوع (Thread)': 'Thread Created',
  'حذف موضوع (Thread)': 'Thread Deleted',
  'تحديث إعدادات السيرفر': 'Server Updated',
  'إنشاء روم صوتي': 'Voice Channel Created',
  'حذف روم صوتي': 'Voice Channel Deleted',
  'تعديل روم صوتي': 'Voice Channel Edited',
  'إنشاء قناة': 'Channel Created',
  'حذف قناة': 'Channel Deleted',
  'تعديل قناة': 'Channel Edited',
  'تغيير صلاحيات قناة': 'Permissions Changed',
  'إنشاء رتبة': 'Role Created',
  'حذف رتبة': 'Role Deleted',
  'تعديل رتبة': 'Role Updated',
  'دخول قناة صوتية': 'Voice Join',
  'خروج من قناة صوتية': 'Voice Leave',
  'طرد من روم صوتي': 'Voice Kick',
  'تنقّل بين قنوات صوتية': 'Voice Move',
  'كتم صوتي (Mute)': 'Voice Mute',
  'إلغاء الكتم': 'Mute Removed',
  'إصمام صوتي (Deafen)': 'Voice Deafen',
  'إلغاء الإصمام': 'Deafen Removed',
  'بوت دخل السيرفر': 'Bot Joined',
  'بوت خرج من السيرفر': 'Bot Left',
  'بوت انطرد من السيرفر': 'Bot Kicked',
  'مشكلة: بوت انطرد من الصوت': 'Bot Kicked From Voice',
  'مشكلة في البوت': 'Bot Problem',
  'انقطع اتصال البوت': 'Bot Disconnected',
  'رجع اتصال البوت': 'Bot Reconnected',
  'تم رصد مخالفة': 'Automod Hit',
  'غادر السيرفر': 'Member Left',
};

const FIELD_EN = {
  'العضو': 'Member',
  'القناة': 'Channel',
  'الروم': 'Channel',
  'الكاتب': 'Author',
  'بواسطة': 'By',
  'حُذفت بواسطة': 'Deleted By',
  'السبب': 'Reason',
  'قبل': 'Before',
  'بعد': 'After',
  'الرابط': 'Link',
  'الدعوة': 'Invite',
  'الكود': 'Code',
  'الاستخدامات': 'Uses',
  'تنتهي': 'Ends',
  'الاسم': 'Name',
  'النوع': 'Type',
  'اللون': 'Color',
  'الصلاحيات': 'Permissions',
  'الوصف': 'Topic',
  'الوضع البطيء': 'Slowmode',
  'عدد التغييرات': 'Changes',
  'الرتبة': 'Role',
  'الرتب': 'Roles',
  'رتب أُضيفت': 'Roles Added',
  'رتب أُزيلت': 'Roles Removed',
  'من': 'From',
  'إلى': 'To',
  'ينتهي': 'Ends',
  'الأعضاء الآن': 'Members',
  'الحساب أُنشئ': 'Account Created',
  'انضم في': 'Joined',
  'بوت؟': 'Bot',
  'متحرّك؟': 'Animated',
  'القناة الأم': 'Parent',
  'أنشأه': 'Created By',
  'الأيقونة': 'Icon',
  'البانر': 'Banner',
  'المالك': 'Owner',
  'مستوى التحقق': 'Verification',
  'الرابط المخصّص': 'Vanity URL',
  'الصورة الجديدة': 'New Avatar',
  'الداعي': 'Invited By',
};

const VALUE_EN = {
  'بدون سبب': 'No reason',
  'غير معروف': 'Unknown',
  'نعم': 'Yes',
  'لا': 'No',
  'نعم 🤖': 'Yes',
  'لا 👤': 'No',
  'نعم 🎞️': 'Yes',
  'أبدًا': 'Never',
  '(رسالة تحتوي مرفقات/embed فقط)': 'Attachment or embed only',
  'تم تغيير أيقونة السيرفر': 'Server icon changed',
  'تم تغيير بانر السيرفر': 'Server banner changed',
  'تم تغيير صلاحيات الرتبة': 'Role permissions changed',
};

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(String(text || ''));
}

function englishHeading(title, meta) {
  const raw = String(title || '').trim();
  if (TITLE_EN[raw]) return TITLE_EN[raw];
  const bare = raw.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (TITLE_EN[bare]) return TITLE_EN[bare];
  if (raw && !hasArabic(raw)) return raw.slice(0, 80);
  return meta.en || 'Log';
}

function englishFieldName(name) {
  const key = String(name || '').trim();
  if (FIELD_EN[key]) return FIELD_EN[key];
  if (!key || hasArabic(key)) return 'Detail';
  return key.slice(0, 80);
}

function englishSnippet(text) {
  if (text == null) return text;
  const raw = String(text);
  const key = raw.trim();
  if (VALUE_EN[key]) return VALUE_EN[key];
  const bulk = key.match(/^تم حذف \*\*(\d+)\*\* رسالة في (.+)\.?$/);
  if (bulk) return `**${bulk[1]}** messages were deleted in ${bulk[2]}`;
  return raw;
}

/** هل الحدث مُفعّل في هذا السيرفر؟ (مع مراعاة قناة اللوقات فقط) */
function isEventEnabled(guildId, eventKey) {
  const settings = db.getGuildSettings(guildId);
  if (!settings.logs?.enabled) return false;
  const events = settings.logs.events || {};
  return events[eventKey] !== false && events[eventKey] !== undefined;
}

/**
 * قنوات الحدث بالترتيب: روم الحدث الخاص ← روم المجموعة ← القناة العامة (اختيارية).
 * @param {object} settings إعدادات السيرفر
 * @param {string|null} eventKey مفتاح الحدث
 * @returns {string[]} معرّفات قنوات بالترتيب
 */
function channelCandidates(settings, eventKey = null) {
  const logs = settings?.logs || {};
  const group = EVENT_META[eventKey]?.group;
  const out = [];
  const specific = eventKey ? logs.channels?.[eventKey] : null;
  const byGroup = group ? logs.channelsByGroup?.[group] : null;
  if (specific) out.push(specific);
  if (byGroup && byGroup !== specific) out.push(byGroup);
  if (logs.channelId && !out.includes(logs.channelId)) out.push(logs.channelId);
  return out;
}

/** أول قناة صالحة (موجودة + نصية + عندي فيها صلاحيات) من قنوات الحدث */
function getLogChannel(client, guildId, eventKey = null) {
  const settings = db.getGuildSettings(guildId);
  const guild = client.guilds?.cache?.get(guildId);
  const me = guild?.members?.me;
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

  for (const channelId of channelCandidates(settings, eventKey)) {
    const channel = guild?.channels?.cache?.get(channelId);
    if (!channel || !channel.isTextBased?.()) continue;
    if (me) {
      const perms = channel.permissionsFor(me);
      if (!needed.every((p) => perms?.has(p))) continue;
    }
    return channel;
  }
  return null;
}

/** هل يجب تجاهل هذه القناة/العضو في اللوقات؟ */
function shouldIgnore(guildId, { channelId = null, member = null } = {}) {
  const settings = db.getGuildSettings(guildId);
  const ignoredChannels = settings.logs?.ignoredChannels || [];
  const ignoredRoles = settings.logs?.ignoredRoles || [];

  if (channelId && ignoredChannels.includes(channelId)) return true;
  if (member) {
    const roles = member.roles?.cache?.keys?.() ?? [];
    for (const roleId of roles) if (ignoredRoles.includes(roleId)) return true;
    if (settings.logs?.ignoreBots && member.user?.bot) return true;
  }
  return false;
}

/**
 * إرسال لوق.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {string} eventKey مفتاح الحدث
 * @param {object} data { title, description, fields, thumbnail, image, footer, color, files, channelId, member }
 */
async function send(client, guild, eventKey, data = {}) {
  try {
    if (!guild) return null;
    if (!isEventEnabled(guild.id, eventKey)) return null;
    if (shouldIgnore(guild.id, { channelId: data.channelId, member: data.member })) return null;

    /* كل حدث لرومه: روم الحدث ← روم المجموعة ← القناة العامة */
    const channel = getLogChannel(client, guild.id, eventKey);
    if (!channel) return null;

    const meta = EVENT_META[eventKey] || { emoji: '📌', color: config.bot.colors.primary, label: eventKey, en: eventKey, icon: ICON('1f4cc') };
    const heading = englishHeading(data.title, meta);
    const fields = (data.fields || [])
      .filter((field) => field && field.value != null && String(field.value).length)
      .slice(0, 25)
      .map((field) => ({
        name: englishFieldName(field.name),
        value: String(englishSnippet(field.value)).slice(0, 1024),
        inline: field.inline !== false && String(field.value).length <= 80,
      }));
    const thumb = data.thumbnail
      || data.member?.user?.displayAvatarURL?.({ size: 256 })
      || data.member?.displayAvatarURL?.({ size: 256 });
    const footer = data.footer && !hasArabic(data.footer) ? String(data.footer).slice(0, 200) : `One Piece · ${heading}`;
    const embed = base({
      color: data.color ?? meta.color,
      author: { name: `${meta.emoji} ${heading}`.slice(0, 256), iconURL: meta.icon },
      description: data.description ? String(englishSnippet(data.description)).slice(0, 4096) : undefined,
      fields,
      thumbnail: thumb || undefined,
      image: data.image,
      footer,
    });

    const started = Date.now();
    const sent = await channel.send({ embeds: [embed], files: data.files, components: data.components });
    console.log(`[لوق] ${eventKey} ${Date.now() - started}ms`);
    return sent;
  } catch (err) {
    console.error('[تنبيه] فشل إرسال اللوق:', err.message);
    return null;
  }
}

/** لوق إجراء إداري */
async function logModAction(client, guild, { action, moderator, target, reason, caseId, duration }) {
  return send(client, guild, 'modActions', {
    title: `إجراء إداري: ${action}`,
    fields: [
      { name: 'العضو', value: target ? `${target} \`${target.id ?? ''}\`` : '—', inline: true },
      { name: 'الإداري', value: moderator ? `${moderator} \`${moderator.id}\`` : '—', inline: true },
      { name: 'السبب', value: reason || 'بدون سبب', inline: false },
      ...(duration ? [{ name: 'المدة', value: duration, inline: true }] : []),
      ...(caseId ? [{ name: 'رقم الحالة', value: `#${caseId}`, inline: true }] : []),
    ],
  });
}

/** أرشفة نصية لمحادثة */
function buildTranscript(messages = [], ticket = {}) {
  const header = [
    '=====================================',
    '  Never Land — أرشيف تذكرة',
    `  رقم التذكرة: #${ticket.id}`,
    `  صاحب التذكرة: ${ticket.user_id}`,
    `  النوع: ${ticket.type}`,
    `  تاريخ الفتح: ${new Date(ticket.created_at).toISOString()}`,
    `  تاريخ الإغلاق: ${new Date().toISOString()}`,
    '=====================================',
    '',
  ].join('\n');

  const body = messages
    .map((m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag ?? m.author?.id}: ${m.content || '(مرفق/embed)'}`)
    .join('\n');

  return header + body;
}

/** تنظيم الأحداث حسب المجموعات (لواجهة اللوحة والأوامر) */
function groupedEvents() {
  const out = {};
  for (const [key, meta] of Object.entries(EVENT_META)) {
    out[meta.group] = out[meta.group] || [];
    out[meta.group].push({ key, ...meta });
  }
  return out;
}

module.exports = {
  send,
  logModAction,
  getLogChannel,
  channelCandidates,
  isEventEnabled,
  shouldIgnore,
  buildTranscript,
  EVENT_META,
  EVENT_GROUPS,
  groupedEvents,
};
