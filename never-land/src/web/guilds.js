'use strict';

/**
 * web/guilds.js
 * -------------------------------------------------------------
 * مصدر واحد لقائمة «سيرفرات المستخدم» في الموقع.
 *
 * المشكلة التي يحلّها: قائمة OAuth وحدها لا تكفي — فهي تُفلتر بصلاحية
 * «إدارة السيرفر»، فيظهر للمستخدم صفر سيرفرات رغم أن البوت موجود في سيرفره.
 *
 * الحل: نجمع من ثلاثة مصادر ونتحقّق من الصلاحية الحقيقية لكل سيرفر:
 *   1) سيرفرات جلسة الدخول (OAuth)         ← أسماء وأيقونات المستخدم
 *   2) سيرفرات البوت الحيّة (discord.js)   ← نفحص صلاحية المستخدم فيها فعليًا
 *   3) آخر مزامنة محفوظة                   ← عند توقّف البوت: بيانات معروفة
 *
 * شرط ظهور السيرفر: المستخدم فيه و(مالك • إدارة السيرفر • أضافه مالك الموقع لقائمة الدخول)
 * -------------------------------------------------------------
 */

const config = require('../config');
const sync = require('../sync');
const { guildIconUrl } = require('../lib/discordIcon');

/** عميل البوت (قد لا يكون محمّلًا في وضع الموقع فقط) */
function botClient() {
  try {
    return require('../client');
  } catch {
    return null;
  }
}

/** هل هذا العضو يقدر يستخدم لوحة السيرفر؟ (مالك / إدارة / مضاف لقائمة الدخول) */
async function memberCanUse(guild, userId) {
  if (!guild || !userId) return false;

  // مالك السيرفر
  if (String(guild.ownerId) === String(userId)) return true;

  // عضو السيرفر + صلاحياته أو روله
  let member = guild.members?.cache?.get?.(userId);
  if (!member) member = await guild.members?.fetch?.(userId).catch(() => null);
  if (!member) return false;

  const perms = member.permissions;
  if (perms?.has?.('ManageGuild') || perms?.has?.('Administrator')) return true;

  try {
    if (require('./siteUsers').isAllowed(userId)) return true;
  } catch {
    return false;
  }
  return false;
}

/** هل السيرفر مُدرَج في جلسة الدخول؟ */
function inSession(req, guildId) {
  return (req.session.guilds || []).some((g) => String(g.id) === String(guildId));
}

/**
 * قائمة سيرفرات المستخدم للعرض في اللوحة.
 * @param {import('express').Request} req
 * @returns {Promise<Array<{id:string,name:string,icon:?string,owner:boolean,memberCount:?number,botPresent:boolean,syncedAt:?number}>>}
 */
async function listUserGuilds(req) {
  // وضع العرض (بلا توكن حقيقي)
  if (config.web.demoData) {
    return require('./demo').DEMO_META.guilds.map((g) => ({ ...g, owner: true, public: false }));
  }

  const user = req.session.user;

  // زائر (بلا تسجيل دخول) مع الوصول العام → قائمة السيرفرات العامة للقراءة
  if (!user && config.web.publicAccess) {
    return sync.listGuildMeta().map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      memberCount: g.memberCount,
      botPresent: true,
      owner: false,
      public: true,
    }));
  }

  const client = botClient();
  const snapshots = new Map(sync.listGuildMeta().map((g) => [String(g.id), g]));
  const live = new Map();

  if (client?.isReady?.()) {
    for (const guild of client.guilds.cache.values()) live.set(String(guild.id), guild);
  }

  const out = new Map();

  // 1) سيرفرات جلسة الدخول
  for (const g of req.session.guilds || []) {
    const id = String(g.id);
    const lg = live.get(id);
    const snap = snapshots.get(id);
    out.set(id, {
      id,
      name: lg?.name || snap?.name || g.name,
      icon: guildIconUrl(id, lg?.iconURL?.({ size: 128, extension: 'png' }) || g.icon) || snap?.icon || null,
      owner: Boolean(g.owner) || (lg && String(lg.ownerId) === String(user?.id)),
      memberCount: lg?.memberCount ?? snap?.memberCount ?? null,
      botPresent: Boolean(lg) || Boolean(snap),
      syncedAt: snap?.syncedAt ?? null,
      source: 'oauth',
    });
  }

  // 2) سيرفرات البوت الحيّة — بإذن حقيقي (مالك/إدارة/قائمة الدخول)
  if (user && live.size) {
    for (const guild of live.values()) {
      const id = String(guild.id);
      if (out.has(id)) {
        // موجودة أصلًا من الجلسة → نحدّث الاسم والأيقونة من ديسكورد
        const row = out.get(id);
        row.name = guild.name || row.name;
        row.icon = guild.iconURL?.({ size: 128, extension: 'png' }) || row.icon;
        row.memberCount = guild.memberCount ?? row.memberCount;
        row.botPresent = true;
        row.syncedAt = snapshots.get(id)?.syncedAt ?? row.syncedAt;
        continue;
      }

      const allowed = await memberCanUse(guild, user.id);
      if (!allowed) continue;

      const snap = snapshots.get(id);
      out.set(id, {
        id,
        name: guild.name,
        icon: guildIconUrl(id, guild.iconURL?.({ size: 128, extension: 'png' }) || guild.icon),
        owner: String(guild.ownerId) === String(user.id),
        memberCount: guild.memberCount ?? snap?.memberCount ?? null,
        botPresent: true,
        syncedAt: snap?.syncedAt ?? null,
        source: 'bot',
      });
    }
  }

  // 3) بقية السيرفرات المزامَنة (البوت متوقّف): تُعرض لمن يملك صلاحية موثوقة سابقًا
  if (user && !live.size) {
    for (const snap of snapshots.values()) {
      const id = String(snap.id);
      if (out.has(id)) continue;
      if (!inSession(req, id)) continue;
      out.set(id, {
        id,
        name: snap.name,
        icon: guildIconUrl(id, snap.icon),
        owner: false,
        memberCount: snap.memberCount,
        botPresent: true,
        syncedAt: snap.syncedAt,
        source: 'snapshot',
      });
    }
  }

  return [...out.values()].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
}

/**
 * هل يملك المستخدم صلاحية الوصول لسيرفر معيّن (قراءة/تعديل)؟
 * @returns {Promise<boolean>}
 */
async function canAccessGuild(req, guildId) {
  if (config.web.demoData) return true;

  const user = req.session.user;
  if (!user) {
    // زائر (عرض عام): قراءة فقط لسيرفر مُدرَج فيه البوت
    if (config.web.publicAccess && ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const client = botClient();
      if (client?.guilds?.cache?.has?.(guildId)) return true;
      return Boolean(sync.getSnapshot(guildId));
    }
    return false;
  }

  if (config.bot.developerIds.includes(user.id)) return true;
  if (inSession(req, guildId)) return true;

  const guild = botClient()?.guilds?.cache?.get?.(guildId);
  if (guild) return memberCanUse(guild, user.id);

  return false;
}

/** نفس الفكرة لكن للصفحات: يعيد كائن السيرفر أو null */
async function findUserGuild(req, guildId) {
  const list = await listUserGuilds(req);
  return list.find((g) => String(g.id) === String(guildId)) || null;
}

module.exports = { listUserGuilds, canAccessGuild, findUserGuild, memberCanUse, inSession };
