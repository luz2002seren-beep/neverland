'use strict';

/**
 * systems/logging.js
 * -------------------------------------------------------------
 * نظام اللوقات الشامل:
 *   • 39 حدثًا موزّعة على 9 مجموعات
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

/** بيانات كل حدث: الرمز، اللون، الاسم العربي، المجموعة */
const EVENT_META = {
  // ---------------- الرسائل ----------------
  messageDelete: { emoji: '🗑️', color: 0xed4245, label: 'حذف رسالة', group: 'messages' },
  messageEdit: { emoji: '✏️', color: 0xfee75c, label: 'تعديل رسالة', group: 'messages' },
  messageBulkDelete: { emoji: '🧹', color: 0xed4245, label: 'حذف جماعي للرسائل', group: 'messages' },

  // ---------------- الأعضاء ----------------
  memberJoin: { emoji: '📥', color: 0x57f287, label: 'دخول عضو', group: 'members' },
  memberLeave: { emoji: '📤', color: 0xfee75c, label: 'خروج عضو', group: 'members' },
  memberKick: { emoji: '👢', color: 0xed4245, label: 'طرد عضو', group: 'members' },
  memberBan: { emoji: '🔨', color: 0xed4245, label: 'حظر عضو', group: 'members' },
  memberUnban: { emoji: '♻️', color: 0x57f287, label: 'فك حظر', group: 'members' },
  memberTimeout: { emoji: '🔇', color: 0xfee75c, label: 'إسكات عضو (Timeout)', group: 'members' },
  memberBoost: { emoji: '🚀', color: 0xff73fa, label: 'دعم السيرفر (Boost)', group: 'members' },
  memberRoleUpdate: { emoji: '🎭', color: 0x5865f2, label: 'تغيير رتب عضو', group: 'members' },
  memberNickname: { emoji: '📝', color: 0x5865f2, label: 'تغيير اسم عضو', group: 'members' },
  memberAvatar: { emoji: '🖼️', color: 0x5865f2, label: 'تغيير صورة عضو', group: 'members' },
  memberUsername: { emoji: '🏷️', color: 0x5865f2, label: 'تغيير اسم المستخدم', group: 'members' },

  // ---------------- الرتب ----------------
  roleCreate: { emoji: '🎭', color: 0x57f287, label: 'إنشاء رتبة', group: 'roles' },
  roleDelete: { emoji: '🎭', color: 0xed4245, label: 'حذف رتبة', group: 'roles' },
  roleUpdate: { emoji: '🎭', color: 0x5865f2, label: 'تعديل رتبة', group: 'roles' },

  // ---------------- القنوات ----------------
  channelCreate: { emoji: '📁', color: 0x57f287, label: 'إنشاء قناة', group: 'channels' },
  channelDelete: { emoji: '📁', color: 0xed4245, label: 'حذف قناة', group: 'channels' },
  channelUpdate: { emoji: '✏️', color: 0x5865f2, label: 'تعديل قناة', group: 'channels' },
  channelPermissions: { emoji: '🔐', color: 0xfee75c, label: 'تغيير صلاحيات قناة', group: 'channels' },

  // ---------------- السيرفر ----------------
  serverUpdate: { emoji: '⚙️', color: 0x5865f2, label: 'تحديث السيرفر', group: 'server' },
  emojiCreate: { emoji: '😀', color: 0x57f287, label: 'إضافة إيموجي', group: 'server' },
  emojiDelete: { emoji: '😶', color: 0xed4245, label: 'حذف إيموجي', group: 'server' },
  stickerCreate: { emoji: '🏷️', color: 0x57f287, label: 'إضافة ملصق', group: 'server' },
  stickerDelete: { emoji: '🏷️', color: 0xed4245, label: 'حذف ملصق', group: 'server' },

  // ---------------- الدعوات ----------------
  inviteCreate: { emoji: '🔗', color: 0x57f287, label: 'إنشاء دعوة', group: 'invites' },
  inviteDelete: { emoji: '🔗', color: 0xed4245, label: 'حذف دعوة', group: 'invites' },

  // ---------------- المواضيع ----------------
  threadCreate: { emoji: '🧵', color: 0x57f287, label: 'إنشاء موضوع (Thread)', group: 'threads' },
  threadDelete: { emoji: '🧵', color: 0xed4245, label: 'حذف موضوع (Thread)', group: 'threads' },

  // ---------------- الصوت ----------------
  voiceJoin: { emoji: '🔊', color: 0x57f287, label: 'دخول قناة صوتية', group: 'voice' },
  voiceLeave: { emoji: '🔇', color: 0xfee75c, label: 'خروج من قناة صوتية', group: 'voice' },
  voiceMove: { emoji: '↔️', color: 0x5865f2, label: 'تنقّل بين قنوات صوتية', group: 'voice' },
  voiceMute: { emoji: '🎙️', color: 0xfee75c, label: 'كتم صوتي', group: 'voice' },
  voiceDeafen: { emoji: '🎧', color: 0xfee75c, label: 'إصمام صوتي', group: 'voice' },

  // ---------------- الأنظمة ----------------
  modActions: { emoji: '🛡️', color: 0xeb459e, label: 'إجراء إداري', group: 'system' },
  automod: { emoji: '🚨', color: 0xed4245, label: 'الحماية التلقائية', group: 'system' },
  ticket: { emoji: '🎫', color: 0x5865f2, label: 'التذاكر', group: 'system' },
  botStatus: { emoji: '🤖', color: 0xeb459e, label: 'حالة البوتات', group: 'system' },
};

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

    const meta = EVENT_META[eventKey] || { emoji: '📌', color: config.bot.colors.primary, label: eventKey };
    const embed = base({
      color: data.color ?? meta.color,
      title: data.title ? `${meta.emoji} ${data.title}` : `${meta.emoji} ${meta.label}`,
      description: data.description || undefined,
      fields: data.fields,
      thumbnail: data.thumbnail,
      image: data.image,
      footer: data.footer || meta.label,
    });

    return await channel.send({ embeds: [embed], files: data.files, components: data.components });
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
