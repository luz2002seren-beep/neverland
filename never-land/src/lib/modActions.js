'use strict';

/**
 * lib/modActions.js
 * -------------------------------------------------------------
 * تنفيذ العقوبات في مكان واحد: فحص الهرمية → تطبيق العقوبة →
 * تسجيل الحالة (Case) → تنبيه العضو في الخاص → لوق إداري.
 * كل أوامر المودريشن تستخدم هذه الطبقة لتفادي تكرار الكود.
 * -------------------------------------------------------------
 */

const { PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const logging = require('../systems/logging');
const { canModerate, modPermissions } = require('./permissions');
const dmPolicy = require('./dmPolicy');
const { formatDuration } = require('./utils');
const { t } = require('./i18n');

/** رسائل الفشل الموحّدة */
function failure(lang, reason) {
  const map = {
    userNotFound: t(lang, 'common.userNotFound'),
    selfAction: t(lang, 'mod.selfAction'),
    hierarchy: t(lang, 'mod.hierarchy'),
    targetIsStaff: t(lang, 'mod.targetIsStaff'),
    botHierarchy: t(lang, 'common.botNoPermission'),
    botPermission: t(lang, 'common.botNoPermission'),
    failed: '❌ فشل تنفيذ العقوبة. تأكد من صلاحيات البوت ورتبته.',
  };
  return map[reason] || map.failed;
}

/** فحص الصلاحية + الهرمية + صلاحيات البوت */
function preflight({ guild, executor, target, client, permission }) {
  if (permission && !guild.members.me?.permissions.has(permission)) {
    return { ok: false, reason: 'botPermission' };
  }
  const check = canModerate({ guild, executor, target, client });
  if (!check.ok) return check;
  return { ok: true };
}

/** هل الهدف عضو موجود بالسيرفر (عنده دوال العضو) ولا مجرد مستخدم بالآيدي؟ */
function isGuildMember(target) {
  return typeof target?.ban === 'function' || typeof target?.kick === 'function';
}

/** نسخة «واقفة» من المستخدم حتى تمر فحوص الهرمية لما يكون خارج السيرفر */
function standInUser(user) {
  return { id: user.id, user, roles: { highest: { position: -1 } } };
}

/** إرسال رسالة خاصة للعضو (بدون كسر التدفق عند الفشل) */
async function dm(target, content) {
  if (!target?.send) return;
  await target.send({ content }).catch(() => {});
}

/**
 * حظر عضو.
 * @returns {{ok:boolean, reason?:string, caseId?:number, durationMs?:number}}
 */
async function ban(client, { guild, executor, target, reason, lang = 'ar', deleteMessageSeconds = 3600, durationMs = null, silent = false }) {
  const user = target?.user ?? target;
  const isMember = isGuildMember(target);
  const pre = preflight({ guild, executor, target: isMember ? target : standInUser(user), client, permission: modPermissions().ban[0] });
  if (!pre.ok) return pre;

  try {
    if (isMember) {
      await target.ban({
        reason: `${executor.tag}${reason ? ` | ${reason}` : ''}`,
        deleteMessageSeconds,
      });
    } else {
      /* حظر بالآيدي: يشتغل حتى لو العضو مو موجود بالسيرفر */
      await guild.bans.create(user.id, {
        reason: `${executor.tag}${reason ? ` | ${reason}` : ''}`,
        deleteMessageSeconds,
      });
    }
  } catch (err) {
    console.error('فشل الحظر:', err.message);
    return { ok: false, reason: 'failed' };
  }

  const record = db.addCase({
    guildId: guild.id,
    type: 'ban',
    userId: user.id,
    userTag: user.tag ?? user.username ?? String(user.id),
    moderatorId: executor.id,
    moderatorTag: executor.tag,
    reason: reason || t(lang, 'common.reasonNone'),
    duration: durationMs,
    active: 1,
  });

  /* بلا رسالة خاصة للحظر — السياسة: الخاص للتحذير والقبول/الرفض فقط */
  await logging.logModAction(client, guild, {
    action: 'حظر',
    moderator: executor,
    target: user,
    reason: reason || t(lang, 'common.reasonNone'),
    caseId: record.id,
  });

  return { ok: true, caseId: record.id, outside: !isMember };
}

/** فك الحظر */
async function unban(client, { guild, executor, userId, reason, caseId = null }) {
  const pre = preflight({ guild, executor, target: { id: userId, roles: { highest: { position: -1 } } }, client, permission: PermissionFlagsBits.BanMembers });
  // فحص مبسّط: صاحب السيرفر والمطوّرون محصّنون
  const config = require('../config');
  if (config.bot.developerIds.includes(userId)) return { ok: false, reason: 'targetIsStaff' };

  try {
    const bans = await guild.bans.fetch(userId).catch(() => null);
    if (!bans) return { ok: false, reason: 'userNotFound' };
    await guild.bans.remove(userId, `${executor.tag}${reason ? ` | ${reason}` : ''}`);
  } catch (err) {
    console.error('فشل فك الحظر:', err.message);
    return { ok: false, reason: 'failed' };
  }

  const record = db.addCase({
    guildId: guild.id,
    type: 'unban',
    userId,
    moderatorId: executor.id,
    moderatorTag: executor.tag,
    reason: reason || 'بدون سبب',
  });

  await logging.logModAction(client, guild, { action: 'فك حظر', moderator: executor, target: { id: userId, toString: () => `<@${userId}>` }, reason, caseId: record.id });
  return { ok: true, caseId: record.id };
}

/** طرد عضو */
async function kick(client, { guild, executor, target, reason, lang = 'ar', silent = false }) {
  const pre = preflight({ guild, executor, target, client, permission: modPermissions().kick[0] });
  if (!pre.ok) return pre;

  try {
    await target.kick(`${executor.tag}${reason ? ` | ${reason}` : ''}`);
  } catch (err) {
    console.error('فشل الطرد:', err.message);
    return { ok: false, reason: 'failed' };
  }

  const record = db.addCase({
    guildId: guild.id,
    type: 'kick',
    userId: target.id,
    userTag: target.user.tag,
    moderatorId: executor.id,
    moderatorTag: executor.tag,
    reason: reason || t(lang, 'common.reasonNone'),
  });

  /* بلا رسالة خاصة للطرد */
  await logging.logModAction(client, guild, { action: 'طرد', moderator: executor, target: target.user, reason, caseId: record.id });
  return { ok: true, caseId: record.id };
}

/** إسكات مؤقت (Timeout) */
async function timeout(client, { guild, executor, target, reason, durationMs, lang = 'ar', silent = false }) {
  const pre = preflight({ guild, executor, target, client, permission: modPermissions().timeout[0] });
  if (!pre.ok) return pre;

  if (durationMs > 28 * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: 'tooLong' };
  }

  try {
    await target.timeout(durationMs, `${executor.tag}${reason ? ` | ${reason}` : ''}`);
  } catch (err) {
    console.error('فشل الإسكات:', err.message);
    return { ok: false, reason: 'failed' };
  }

  const record = db.addCase({
    guildId: guild.id,
    type: 'timeout',
    userId: target.id,
    userTag: target.user.tag,
    moderatorId: executor.id,
    moderatorTag: executor.tag,
    reason: reason || t(lang, 'common.reasonNone'),
    duration: durationMs,
  });

  /* بلا رسالة خاصة للإسكات — السياسة: تحذير · قبول · رفض فقط */
  await logging.logModAction(client, guild, {
    action: 'إسكات',
    moderator: executor,
    target: target.user,
    reason,
    caseId: record.id,
    duration: formatDuration(durationMs, lang),
  });
  return { ok: true, caseId: record.id, durationMs };
}

/** فك الإسكات */
async function untimeout(client, { guild, executor, target, reason }) {
  const pre = preflight({ guild, executor, target, client, permission: PermissionFlagsBits.ModerateMembers });
  if (!pre.ok) return pre;
  if (!target.isCommunicationDisabled?.()) return { ok: false, reason: 'notTimedOut' };

  try {
    await target.timeout(null, `${executor.tag} | فك إسكات`);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  db.addCase({
    guildId: guild.id,
    type: 'untimeout',
    userId: target.id,
    userTag: target.user.tag,
    moderatorId: executor.id,
    moderatorTag: executor.tag,
    reason: reason || 'بدون سبب',
  });
  await logging.logModAction(client, guild, { action: 'فك إسكات', moderator: executor, target: target.user, reason });
  return { ok: true };
}

/** تحذير عضو (إن وصل للحد الأقصى يمكن تطبيق عقوبة تلقائية) */
async function warn(client, { guild, executor, target, reason, lang = 'ar', silent = false }) {
  const pre = preflight({ guild, executor, target, client });
  if (!pre.ok) return pre;

  const record = db.addCase({
    guildId: guild.id,
    type: 'warn',
    userId: target.id,
    userTag: target.user.tag,
    moderatorId: executor.id,
    moderatorTag: executor.tag,
    reason: reason || t(lang, 'common.reasonNone'),
    active: 1,
  });

  const settings = db.getGuildSettings(guild.id);
  const count = db.countCases(guild.id, { type: 'warn', userId: target.id, active: true });

  // العقوبة التلقائية عند تجاوز الحد
  const threshold = settings.moderation?.warnThreshold;
  let autoAction = null;
  if (threshold && count >= threshold && settings.moderation?.warnAction && settings.moderation.warnAction !== 'none') {
    const action = settings.moderation.warnAction;
    if (action === 'timeout' && target.moderatable) {
      await target.timeout(10 * 60 * 1000, `تجاوز حد التحذيرات (${count})`).catch(() => {});
      autoAction = 'timeout';
    } else if (action === 'kick' && target.kickable) {
      await target.kick(`تجاوز حد التحذيرات (${count})`).catch(() => {});
      autoAction = 'kick';
    } else if (action === 'ban' && target.bannable) {
      await target.ban({ reason: `تجاوز حد التحذيرات (${count})` }).catch(() => {});
      autoAction = 'ban';
    }
  }

  /* ✅ التحذير: من الحالات الثلاث المسموح بها للخاص — نص عادي بلا إمبد */
  if (!silent) {
    const settings = db.getGuildSettings(guild.id);
    await dmPolicy.send(
      target.user,
      t(lang, 'mod.warnedDm', { server: guild.name, reason: reason || t(lang, 'common.reasonNone') }),
      { kind: 'warn', settings },
    );
  }

  await logging.logModAction(client, guild, {
    action: 'تحذير',
    moderator: executor,
    target: target.user,
    reason,
    caseId: record.id,
  });

  return { ok: true, caseId: record.id, count, autoAction };
}

module.exports = { ban, unban, kick, timeout, untimeout, warn, failure, preflight, isGuildMember, standInUser };
