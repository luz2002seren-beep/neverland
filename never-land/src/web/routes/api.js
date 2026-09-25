'use strict';

/**
 * web/routes/api.js
 * -------------------------------------------------------------
 * الواجهة البرمجية للوحة التحكم (JSON):
 *   GET    /api/me
 *   GET    /api/guilds
 *   GET    /api/guilds/:id            (الإعدادات + الميتاداتا + الإحصائيات)
 *   POST   /api/guilds/:id/settings   (حفظ الإعدادات — تدعم الدمج الجزئي)
 *   GET    /api/guilds/:id/cases
 *   GET    /api/guilds/:id/tickets
 *   GET    /api/guilds/:id/tickets/panel   (تشخيص لوحة التذاكر الحيّة)
 *   GET    /api/guilds/:id/levels
 *   POST   /api/guilds/:id/tickets/:ticketId/close
 * -------------------------------------------------------------
 */

const express = require('express');
const demoData = require('../demo');
const access = require('../access');
const config = require('../../config');
const db = require('../../database');
const leveling = require('../../systems/leveling');
const securityLib = require('../../lib/security');
const audit = require('../../lib/audit');
const textCommands = require('../../systems/textCommands');
const catalog = require('../../data/commandCatalog');
const siteUsers = require('../siteUsers');
const periods = require('../../lib/periods');
const { mergeSettings } = require('../../database/defaults');
const sync = require('../../sync');
const webGuilds = require('../guilds');
const { guildIconUrl, initials } = require('../../lib/discordIcon');
const premiumLib = require('../../lib/premium');

const router = express.Router();

/** العضو المسجّل حاليًا (أو مستخدم المعاينة) */
function currentUser(req) {
  if (config.web.demoData) {
    return { id: '0', username: 'المسؤول', globalName: 'مسؤول السيرفر' };
  }
  return req.session.user || null;
}

/** سيرفرات المستخدم المتاحة في اللوحة (مصدر موثوق موحّد) */
async function availableGuilds(req) {
  return webGuilds.listUserGuilds(req);
}

function safeClient() {
  try {
    const client = require('../../client');
    return client;
  } catch {
    return null;
  }
}

/** هل المستخدم يملك صلاحية الوصول لهذا السيرفر؟ (مالك/إدارة/قائمة الدخول) */
async function canAccess(req, guildId) {
  return webGuilds.canAccessGuild(req, guildId);
}

/** هل يملك المشاهد صلاحية التعديل؟ (الحظر/المشاهدة فقط يمنعان) */
function canEdit(req) {
  if (config.web.demoData) return true;
  const userId = req.session?.user?.id;
  if (userId && !siteUsers.isOwner(userId) && !siteUsers.mayEdit(userId)) return false;
  return Boolean(req.roleOk);
}

/**
 * حماية مسارات /api:
 *  - القراءة (GET) متاحة للجميع عند تفعيل الوصول العام
 *  - الكتابة (POST/PATCH/DELETE) تحتاج تسجيل دخول Discord
 */
/*
 * أي حفظ من الموقع يتوسّم قبل تنفيذ المسار، حتى نعرف أن هذا التغيير «من موقع»
 * لا «من ديسكورد» — فنحدّث الصفحات الثانية فقط، والصفحة اللي كتبت ما تتحدّث.
 */
router.use((req, res, next) => {
  if (req.method !== 'GET') {
    /* نوسم فقط الكتابات اللي تغيّر إعدادات السيرفر (حفظ/اختصارات/أوامر/إجراءات) */
    const match = /^\/guilds\/([^/]+)\/(settings|commands|actions)/.exec(req.path || '');
    if (match) {
      try {
        const live = require('../../lib/live');
        const guildId = decodeURIComponent(match[1]);
        live.noteSiteWrite(guildId, req.get('X-Client-Id') || null);
        res.on('close', () => live.endSiteWrite(guildId));
      } catch { /* الوسم اختياري */ }
    }
  }
  next();
});

router.use(async (req, res, next) => {
  if (config.web.demoData) {
    req.roleOk = true;
    return next();
  }

  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  if (req.session.user) {
    // المحظور: ممنوع من كل الواجهة البرمجية
    if (!siteUsers.isOwner(req.session.user.id) && siteUsers.isBanned(req.session.user.id)) {
      return res.status(403).json({ error: 'banned', message: 'حسابك محظور من الموقع.' });
    }
    if (!siteUsers.isAllowed(req.session.user.id)) {
      return res.status(403).json({
        error: 'not_allowed',
        message: 'حسابك مسجّل وبانتظار ما يسمح لك مالك الموقع بالدخول.',
      });
    }
    if (siteUsers.isViewOnly(req.session.user.id)) {
      req.roleOk = !isWrite;
      req.viewOnly = true;
      req.roleResult = { ok: !isWrite, reason: 'view_only', checked: true };
      return next();
    }
    req.roleOk = true;
    req.roleResult = { ok: true, reason: 'allowed', checked: true };
    return next();
  }

  if (!isWrite && config.web.publicAccess && !config.web.loginRequired) return next();

  return res.status(401).json({
    error: 'unauthorized',
    message: isWrite ? 'التعديل يحتاج تأكيد الدخول بحساب Discord.' : 'يجب تأكيد الدخول أولًا.',
  });
});

/* ------------------------------------ بيانات المستخدم ------------------------------------ */
function canSeePrivate(req) {
  if (config.web.demoData) return true;
  const id = req.session?.user?.id;
  if (!id) return false;
  return siteUsers.isAllowed(id) || Boolean(req.roleOk);
}

function publicSync(status) {
  return {
    ok: Boolean(status?.ok),
    botOnline: Boolean(status?.botOnline),
    at: status?.at || null,
  };
}

router.get('/me', async (req, res) => {
  const trusted = canSeePrivate(req);
  const status = sync.getStatus();
  res.json({
    user: currentUser(req),
    guilds: await availableGuilds(req),
    loginRequired: config.web.loginRequired,
    requiredRoleId: trusted ? (config.web.requiredRoleId || null) : null,
    roleOk: config.web.demoData ? true : Boolean(req.roleOk),
    isOwner: Boolean(req.session?.user && siteUsers.isOwner(req.session.user.id)),
    viewOnly: Boolean(req.session?.user && siteUsers.isViewOnly(req.session.user.id)),
    sync: trusted ? status : publicSync(status),
  });
});

router.get('/guilds', async (req, res) => {
  res.json({ guilds: await availableGuilds(req) });
});

/** السيرفر المفتوح في الجلسة — الرقم ما ينحط في ملف الصفحة */
router.get('/active-guild', async (req, res) => {
  const guildId = String(req.session?.activeGuildId || '');
  if (!/^\d{15,25}$/.test(guildId)) return res.status(404).json({ error: 'none' });
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });
  return res.json({ id: guildId });
});

/** صورة السيرفر المفتوح بلا رقم في رابط الصفحة */
router.get('/guild-icon', async (req, res) => {
  const guildId = String(req.session?.activeGuildId || '');
  if (!/^\d{15,25}$/.test(guildId)) return res.status(404).end();
  if (!(await canAccess(req, guildId))) return res.status(403).end();
  const client = safeClient();
  const discordGuild = client?.guilds?.cache?.get(guildId);
  const snapshot = sync.getSnapshot(guildId);
  const icon = discordGuild?.icon || snapshot?.icon || null;
  const size = Math.min(4096, Math.max(16, Number(req.query.size) || 128));
  const url = guildIconUrl(guildId, icon, size);
  if (!url) return res.status(404).end();
  return res.redirect(url);
});

/* ------------------------------------ بيانات سيرفر ------------------------------------ */
router.get('/guilds/:guildId', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const guild = db.getGuild(guildId);
  const stats = db.getStats(guildId);
  const client = safeClient();
  const discordGuild = client?.guilds?.cache?.get(guildId);
  const snapshot = sync.getSnapshot(guildId);

  // الميتاداتا (قنوات/رتب): من البوت المتّصل، وإلا من آخر مزامنة محفوظة
  const channels = discordGuild
    ? [...discordGuild.channels.cache.values()]
        .filter((c) => c.type === 0 || c.type === 2 || c.type === 4 || c.type === 15)
        .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null }))
        .sort((a, b) => a.type - b.type || String(a.name).localeCompare(String(b.name), 'ar'))
    : (snapshot?.channels || []).filter((c) => [0, 2, 4, 15].includes(c.type));

  const roles = discordGuild
    ? [...discordGuild.roles.cache.values()]
        .filter((r) => r.id !== discordGuild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
    : (snapshot?.roles || []).filter((r) => !r.managed);

  const loggingSystem = require('../../systems/logging');

  const trusted = canSeePrivate(req);
  const payload = {
    guild: {
      id: guildId,
      name: discordGuild?.name ?? snapshot?.name ?? guildId,
      icon: (discordGuild?.icon || snapshot?.icon) ? '/api/guild-icon?size=128' : null,
      memberCount: discordGuild?.memberCount ?? snapshot?.memberCount ?? null,
      ownerId: trusted ? (discordGuild?.ownerId ?? snapshot?.ownerId ?? null) : null,
      botPresent: Boolean(discordGuild) || Boolean(snapshot),
      botOnline: Boolean(client?.isReady?.()),
      createdAt: trusted ? (discordGuild?.createdTimestamp ?? snapshot?.createdAt ?? null) : null,
      syncedAt: trusted ? (snapshot?.syncedAt ?? null) : null,
      syncSource: trusted ? (snapshot?.source ?? null) : null,
    },
    sync: sync.getStatus(),
    settings: guild.settings,
    stats: { ...stats, discordMembers: discordGuild?.memberCount ?? snapshot?.memberCount ?? null, botReady: Boolean(client?.isReady?.()) },
    // سلسلة ١٤ يومًا كاملة (تعبئة الأصفار للأيام بلا نشاط) حتى يرسم المخطط
    // ١٤ عمودًا حقيقيًا بدل عمودين أو أربعة لأيام النشاط فقط.
    daily: (() => {
      const rows = new Map((db.getDailyStats(guildId, 14) || []).map((r) => [String(r.day), r]));
      const out = [];
      for (let i = 13; i >= 0; i--) {
        const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const r = rows.get(key) || {};
        out.push({ day: key, messages: r.messages || 0, joins: r.joins || 0, leaves: r.leaves || 0 });
      }
      return out;
    })(),
    meta: {
      channels,
      roles,
      members: discordGuild ? discordGuild.members.cache.size : 0,
      emojis: discordGuild
        ? [...discordGuild.emojis.cache.values()].slice(0, 100).map((e) => ({ id: e.id, name: e.name, animated: e.animated, url: e.imageURL?.() ?? null }))
        : (snapshot?.emojis || []),
      logGroups: loggingSystem.EVENT_GROUPS,
      logEvents: Object.fromEntries(Object.entries(loggingSystem.EVENT_META).map(([key, meta]) => [key, { label: meta.label, emoji: meta.emoji, group: meta.group }])),
      cardAvailable: require('../../lib/welcomeCard').available(),
      frameCardAvailable: (() => {
        try {
          return require('../../lib/welcomeFrame').available();
        } catch {
          return false;
        }
      })(),
      autolineStyles: Object.entries(require('../../systems/autoline').GIF_STYLES).map(([key, meta]) => ({ key, ...meta })),
    },
    premium: premiumLib.publicView(guildId),
    viewer: {
      canEdit: canEdit(req),
      isOwner: Boolean(req.session?.user && siteUsers.isOwner(req.session.user.id)),
      viewOnly: Boolean(req.session?.user && siteUsers.isViewOnly(req.session.user.id)),
      loggedIn: Boolean(req.session.user) || config.web.demoData,
      demo: config.web.demoData,
      publicAccess: config.web.publicAccess,
      loginRequired: config.web.loginRequired,
      requiredRoleId: trusted ? (config.web.requiredRoleId || null) : null,
      roleReason: trusted ? (req.roleResult?.reason || null) : null,
      roleMessage: trusted && req.roleResult && !req.roleResult.ok ? access.explain(req.roleResult) : null,
      locked: !trusted,
    },
  };
  if (!trusted) {
    payload.settings = {};
    payload.stats = {};
    payload.daily = [];
    payload.meta = {
      channels: [],
      roles: [],
      members: 0,
      emojis: [],
      logGroups: payload.meta.logGroups,
      logEvents: payload.meta.logEvents,
      cardAvailable: false,
      frameCardAvailable: false,
      autolineStyles: [],
    };
    payload.sync = publicSync(payload.sync);
  }
  return res.json(payload);
});

/* بيانات السيرفر الداخلية (قنوات، رتب، سجل، أعضاء) ما تنعرض لزائر */
router.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  if (!/^\/guilds\/[^/]+\/.+/.test(req.path || '')) return next();
  if (canSeePrivate(req)) return next();
  return res.status(403).json({ error: 'login_required', message: 'سجّل الدخول لعرض بيانات السيرفر.' });
});

/* ---------------------------------- شكل الردود ---------------------------------- */
router.get('/guilds/:guildId/replies/preview', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const db2 = require('../../database');
  const replies = require('../../lib/replies');
  const saved = db2.getGuildSettings(guildId);
  /* نفس الإعدادات مع أي تعديل غير محفوظ من اللوحة (?english=0&font=1) */
  const settings = {
    ...saved,
    replies: {
      english: req.query.english === undefined ? saved.replies?.english : req.query.english === '1',
      fancyFont: req.query.font === undefined ? saved.replies?.fancyFont : req.query.font === '1',
    },
  };

  const samples = [
    'تم حظر العضو',
    '⚠️ تحذير',
    '📭 لا توجد أي عقوبات مسجّلة لهذا العضو.',
    'تم نشر اللوحة في #الدعم',
  ];

  return res.json({
    cfg: replies.replyConfig(settings),
    samples: samples.map((text) => ({
      before: text,
      after: replies.decorate(text, settings),
    })),
  });
});

/* ------------------------- 🧹 روم الأوامر (نشر + تنظيف) ------------------------- */
const guildId0 = (req) => req.params.guildId;
/**
 * POST /api/guilds/:guildId/command-room/publish  → ينشر/يعدّل رسالة الترحيب بالصورة
 * POST /api/guilds/:guildId/command-room/clean    → يمسح كل رسائل الروم (ما عدا رسالة الترحيب)
 * POST /api/guilds/:guildId/command-room/run      → الاثنين معًا
 */
/* تشخيص مباشر لروم الأوامر: آخر الرسائل + هل رسالة الترحيب موجودة ومثبّتة */
router.get('/guilds/:guildId/command-room', async (req, res) => {
  if (!(await canAccess(req, guildId0(req)))) return res.status(403).json({ error: 'forbidden' });
  const guildId = guildId0(req);
  const client = safeClient();
  const guild = client?.guilds?.cache?.get(guildId);
  const commandRoom = require('../../systems/commandRoom');
  const cfg = commandRoom.configFor(guildId);
  const out = { config: cfg, status: commandRoom.status().guilds[guildId] || null, live: null };

  const channel = guild && cfg.channelId
    ? guild.channels.cache.get(cfg.channelId) || (await guild.channels.fetch(cfg.channelId).catch(() => null))
    : null;

  if (channel?.isTextBased?.()) {
    const fetched = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (fetched) {
      const banner = cfg.bannerId ? fetched.get(cfg.bannerId) || (await channel.messages.fetch(cfg.bannerId).catch(() => null)) : null;
      out.live = {
        channelName: channel.name,
        count: fetched.size,
        bannerExists: Boolean(banner),
        bannerPinned: banner ? Boolean(banner.pinned) : null,
        bannerHasImage: banner ? Boolean((banner.attachments?.size ?? 0) > 0) : null,
        messages: [...fetched.values()].slice(0, 20).map((m) => ({
          id: m.id,
          bot: Boolean(m.author?.bot),
          pinned: Boolean(m.pinned),
          attachments: m.attachments?.size ?? 0,
          attachmentUrls: [...(m.attachments?.values?.() ?? [])].map((a) => a.url),
          ageSeconds: Math.round((Date.now() - m.createdTimestamp) / 1000),
          preview: String(m.content || '').slice(0, 70),
        })),
      };
    }
  }

  return res.json(out);
});

router.post('/guilds/:guildId/command-room/:action', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId, action } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });
  if (!['publish', 'clean', 'run'].includes(action)) return res.status(400).json({ error: 'bad_action' });

  const client = safeClient();
  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) return res.status(503).json({ error: 'bot_offline', message: 'البوت غير متّصل حاليًا — جرّب بعد لحظات.' });

  /* لو اللوحة أرسلت رومًا معيّنًا نحفظه أولًا */
  const channelId = typeof req.body?.channelId === 'string' && req.body.channelId ? req.body.channelId : null;
  if (channelId) {
    const saved = db.getGuildSettings(guildId)?.commandRoom || {};
    db.updateGuildSettings(guildId, { commandRoom: { ...saved, channelId } });
  }

  const commandRoom = require('../../systems/commandRoom');
  try {
    const published = action === 'clean' ? null : await commandRoom.publish(client, guild, { force: action !== 'publish' });
    const cleaned = action === 'publish' ? null : await commandRoom.clean(client, guild);
    return res.json({
      ok: Boolean((published ? published.ok : true) && (cleaned ? cleaned.ok : true)),
      published,
      cleaned,
      config: commandRoom.configFor(guildId),
    });
  } catch (err) {
    return res.status(500).json({ error: 'failed', message: err.message });
  }
});

router.post('/guilds/:guildId/settings', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'bad_request', message: 'لا توجد بيانات للحفظ' });
  }

  /* حماية: شيل أي مفتاح خطير (__proto__/constructor) وقصر المفاتيح على المعروف فقط */
  const { patch, rejected } = securityLib.sanitizeSettingsPatch(body, config.defaults);
  if (rejected.length) {
    audit.guild(req, guildId, {
      action: 'settings.rejected',
      target: 'settings',
      detail: `مفاتيح غير معروفة انرفضت: ${rejected.slice(0, 5).join(' · ')}`,
      severity: 'warn',
    });
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'bad_request', message: 'لا توجد إعدادات صالحة للحفظ', rejected });

  const guild = db.getGuild(guildId);
  const merged = mergeSettings(guild.settings, patch);
  db.updateGuildSettings(guildId, merged);

  /* 🖼️ لوحة التذاكر: أي تعديل على إعدادات التذاكر (صورة/أنواع/وضع) يعيد نشرها تلقائيًا */
  if (patch.tickets) {
    const liveClient = safeClient();
    if (liveClient?.isReady?.()) {
      try {
        require('../../systems/tickets').scheduleEnsure(liveClient, guildId);
      } catch { /* نتجاهل — اللوحة تنحدّث عند إعادة التشغيل */ }
    }
  }

  /* سجل النشاط: من غيّر شو */
  audit.guild(req, guildId, {
    action: 'settings.save',
    target: Object.keys(patch).join('، ').slice(0, 120),
    detail: audit.describeChange(patch),
  });

  return res.json({ ok: true, settings: db.getGuild(guildId).settings, savedAt: Date.now() });
});

/* ------------------------------- اشتراك البوت ------------------------------- */

router.post('/guilds/:guildId/premium/request', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });
  const result = premiumLib.request(guildId, premiumLib.hideIds(req.body?.note || ''));
  if (!result.ok) return res.status(400).json({ error: result.error, message: result.message, premium: result.view });
  audit.guild(req, guildId, {
    action: 'premium.request',
    target: 'premium',
    detail: 'طلب اشتراك بريميوم',
  });
  return res.json({ ok: true, message: result.message, premium: result.view });
});

/* ------------------------------- معاينة صورة الترحيب ------------------------------- */

/**
 * يرجّع صورة الترحيب (PNG) حسب إعدادات السيرفر الحالية — تُعرض مباشرة في اللوحة.
 * الصورة تُبنى بنفس كود البوت تمامًا (src/lib/welcomeCard.js).
 */
async function sendWelcomeCard(req, res, next) {
  try {
  const guildId = String(req.params.guildId || req.session?.activeGuildId || '');
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  require('../../systems/welcome').ensureStyle(guildId);
  const guild = db.getGuild(guildId);
  const settings = guild.settings || {};
  const welcomeCfg = settings.welcome || {};

  /* نستخدم حساب المشاهد نفسه (أفتاره الحقيقي) — وفي وضع العرض حساب تجريبي */
  const viewerId = req.session?.user?.id || null;
  const viewerName = req.session?.user?.username || 'Never Land';
  const viewerGlobal = req.session?.user?.globalName || viewerName;
  const avatarSeed = req.session?.user?.avatar
    ? `https://cdn.discordapp.com/avatars/${viewerId}/${req.session.user.avatar}.png?size=512`
    : `https://cdn.discordapp.com/embed/avatars/${Number(viewerId || 0) % 5}.png`;

  const card = require('../../lib/welcomeCard');
  let welcomeFrame = null;
  try {
    welcomeFrame = require('../../lib/welcomeFrame');
  } catch {
    welcomeFrame = null;
  }
  const applyPlaceholders = require('../../lib/utils').applyPlaceholders;
  const fakeUser = {
    username: viewerName,
    globalName: viewerGlobal,
    displayName: viewerGlobal,
    displayAvatarURL: () => avatarSeed,
  };

  /* 🖼️ إطار Never Land: نفس الصورة اللي تنزل للأعضاء (أفتار المشاهد داخل الدائرة) */
  if (welcomeFrame && (welcomeCfg.imageMode || 'frame') === 'frame' && welcomeFrame.available(welcomeCfg.frameImage)) {
    const made = await welcomeFrame
      .generate({
        avatarUrl: avatarSeed,
        frame: welcomeCfg.frameImage,
        roi: welcomeCfg.frameCircle || null,
        scale: Number(welcomeCfg.frameScale) > 0 ? Number(welcomeCfg.frameScale) : 1,
        format: 'png',
      })
      .catch(() => null);
    if (made) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(made.buffer);
    }
  }

  const cardText = applyPlaceholders(welcomeCfg.cardMessage || 'أهلاً بك {displayName} في {server}', {
    user: viewerName,
    username: viewerName,
    displayName: viewerGlobal,
    server: db.getGuild(guildId)?.name || 'Never Land',
    memberCount: 0,
  }).replace(/[*_`~|]/g, '');

  const buffer = await card
    .generateWelcomeCard({
      user: fakeUser,
      memberCount: db.getGuild(guildId)?.memberCount || 0,
      guildName: db.getGuild(guildId)?.name || 'Never Land',
      guildIcon: null,
      background: welcomeCfg.cardBackground || null,
      theme: welcomeCfg.cardTheme || null,
      message: cardText,
    })
    .catch(() => null);

  if (!buffer) return res.status(503).json({ error: 'card_unavailable', message: 'توليد الصور غير متاح على الخادم.' });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(buffer);
  } catch (err) {
    return next(err);
  }
}
router.get('/welcome-card', sendWelcomeCard);
router.get('/guilds/:guildId/welcome/card', sendWelcomeCard);

/* ------------------------------- مكتبة الأوامر ------------------------------- */

/**
 * كل الأوامر مع شرحها وأمثلتها (تقرأها لوحة «مكتبة الأوامر»).
 * مصدرها ملف واحد يقرأه البوت والموقع معًا (src/data/commandCatalog.js).
 */
router.get('/commands', (req, res) => {
  let loaded = [];
  try {
    loaded = [...(require('../../client').commands?.keys?.() || [])];
  } catch {
    loaded = [];
  }
  /* أوامر الإدارة ما تُرسل لغير الإداريين — تنحجب من المصدر نفسه */
  const staffViewer = canEdit(req);
  const entries = Object.entries(catalog.COMMANDS)
    .filter(([name, meta]) => staffViewer || catalog.audienceOf(name, meta) === 'member');

  const items = entries.map(([name, meta]) => {
    const audience = catalog.audienceOf(name, meta);
    return {
      name,
      label: meta.label,
      what: meta.what,
      usage: meta.usage,
      examples: meta.examples,
      subs: meta.subs || null,
      perm: meta.perm,
      audience,
      audienceLabel: catalog.AUDIENCES[audience]?.label || audience,
      audienceBadge: catalog.AUDIENCES[audience]?.badge || audience,
      audienceDesc: catalog.AUDIENCES[audience]?.desc || '',
      category: meta.category,
      categoryLabel: catalog.CATEGORIES[meta.category] || meta.category,
      text: meta.text !== false,
      installed: loaded.includes(name),
    };
  });

  return res.json({
    categories: Object.entries(catalog.CATEGORIES).map(([key, label]) => ({ key, label })),
    audiences: catalog.AUDIENCES,
    prefix: { enabled: true, note: 'الأوامر الإنجليزية تشتغل مباشرة بلا أي رمز قبلها' },
    items,
    counts: {
      total: items.length,
      text: items.filter((i) => i.text).length,
      installed: items.filter((i) => i.installed).length,
      member: items.filter((i) => i.audience === 'member').length,
      staff: items.filter((i) => i.audience === 'staff').length,
      allTotal: Object.keys(catalog.COMMANDS).length,
      hiddenFromViewer: staffViewer ? 0 : catalog.namesOf('staff').length,
    },
    viewer: { canEdit: staffViewer },
  });
});

/* ------------------------------- اختصارات الأوامر ------------------------------- */

router.get('/guilds/:guildId/commands', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  let loaded = [];
  try {
    loaded = [...require('../../client').commands?.keys?.() || []];
  } catch {
    loaded = [];
  }

  /*
   * أوامر الإدارة تُحجب عن أي مشاهد ما عنده صلاحية تعديل في هذا السيرفر،
   * فما يشوفها ولا يقدر يخبّها — ولو حاول يعدّل، الـPOST يردّ برفض.
   */
  const snapshot = textCommands.adminSnapshot(guildId, loaded, { staffViewer: canEdit(req) });
  return res.json({
    ...snapshot,
    note: canEdit(req)
      ? 'الأوامر الإنجليزية تشتغل بلا بريفيكست · عدّل الاختصارات كما تحب وتُطبَّق فورًا.'
      : 'تشوف أوامر الأعضاء فقط — أوامر الإدارة تحتاج صلاحية إدارية.',
  });
});

router.post('/guilds/:guildId/commands/aliases', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const { command, aliases } = req.body || {};
  if (!command) return res.status(400).json({ error: 'bad_request', message: 'اسم الأمر مطلوب.' });

  const result = textCommands.setAliases(guildId, String(command), aliases);
  if (!result.ok) {
    const messages = {
      unknown_command: 'هذا الأمر غير موجود.',
      invalid_alias: 'الاختصار لازم يكون كلمة وحدة بأي لغة (عربي أو إنجليزي…) بلا مسافات أو رموز.',
      alias_taken: 'الاختصار محجوز لأمر ثاني.',
      too_many: `الحد الأقصى ${textCommands.MAX_ALIASES} اختصارًا للأمر.`,
    };
    return res.status(400).json({
      error: result.error,
      message: messages[result.error] || 'تعذّر الحفظ.',
      takenBy: result.takenBy || null,
      invalid: result.invalid || null,
    });
  }

  audit.guild(req, guildId, {
    action: 'commands.aliases',
    target: String(command),
    detail: result.aliases.length ? `الاختصارات الجديدة: ${result.aliases.join(' · ')}` : 'شيل الاختصارات',
  });

  return res.json({ ok: true, command: String(command), aliases: result.aliases, savedAt: Date.now() });
});

/** تشغيل/إطفاء أمر واحد بلا بريفيكست (مفيد لو اسم الأمر كلمة إنجليزية شائعة) */
router.post('/guilds/:guildId/commands/toggle', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const { command, enabled } = req.body || {};
  const result = textCommands.setCommandEnabled(guildId, String(command || ''), Boolean(enabled));
  if (!result.ok) return res.status(400).json({ error: result.error, message: 'هذا الأمر غير معروف.' });

  audit.guild(req, guildId, {
    action: 'commands.toggle',
    target: result.command,
    detail: enabled ? `تشغيل الأمر «${command}» بلا بريفيكست` : `إطفاء الأمر «${command}» بلا بريفيكست`,
  });

  return res.json({ ok: true, command: result.command, enabled: result.enabled, disabled: result.disabled });
});

/**
 * قواعد أمر واحد — نفس خيارات تعديل الأمر في البوتات المعروفة:
 *   رتب مفعّلة/معطّلة · قنوات مفعّلة/معطّلة · أنواع الردود (حذف رسالة الأمر ·
 *   حذف الرد مع حذف رسالة العضو · حذف الرد بعد ٥ ثوانٍ).
 */
router.post('/guilds/:guildId/commands/rules', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const { command, rules } = req.body || {};
  if (!command) return res.status(400).json({ error: 'bad_request', message: 'اسم الأمر مطلوب.' });

  const result = textCommands.setRules(guildId, String(command), rules || {});
  if (!result.ok) {
    const messages = {
      unknown_command: 'هذا الأمر غير موجود.',
      invalid_id: 'في معرّف غير صالح (لازم يكون معرّف رتبة أو روم حقيقي).',
    };
    return res.status(400).json({ error: result.error, message: messages[result.error] || 'تعذّر الحفظ.', invalid: result.invalid || null });
  }

  const on = (list) => (list.length ? list.join(' · ') : 'الكل');
  audit.guild(req, guildId, {
    action: 'commands.rules',
    target: String(command),
    detail: [
      `رتب مفعّلة: ${on(result.rules.enabledRoles)}`,
      `رتب معطّلة: ${on(result.rules.disabledRoles)}`,
      `رومات مفعّلة: ${on(result.rules.enabledChannels)}`,
      `رومات معطّلة: ${on(result.rules.disabledChannels)}`,
      result.rules.autoDeleteInvocation ? 'حذف رسالة الأمر' : 'إبقاء رسالة الأمر',
      result.rules.autoDeleteWithMessage ? 'حذف الرد مع رسالة العضو' : '',
      result.rules.autoDeleteReplyAfter5s ? 'حذف الرد بعد ٥ ثوانٍ' : '',
    ].filter(Boolean).join(' · '),
  });

  return res.json({ ok: true, command: result.command, rules: result.rules, savedAt: Date.now() });
});

router.post('/guilds/:guildId/commands/options', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const { enabled, cooldownSeconds, suggest } = req.body || {};
  const result = textCommands.setOptions(guildId, { enabled, cooldownSeconds, suggest });
  if (!result.ok) return res.status(400).json({ error: result.error, message: 'ما في تغيير للحفظ.' });

  audit.guild(req, guildId, {
    action: 'commands.options',
    target: 'textCommands',
    detail: `الأوامر بلا بريفيكست: ${result.config.enabled ? 'مشتغلة' : 'موقوفة'} · الحد: ${result.config.cooldownSeconds} ثانية`,
    severity: 'warn',
  });

  return res.json({ ok: true, config: { enabled: result.config.enabled, cooldownSeconds: result.config.cooldownSeconds } });
});

/* ------------------------------- سجل النشاط (للقراءة) ------------------------------- */
router.get('/guilds/:guildId/audit', async (req, res) => {
  const { guildId } = req.params;

  /* الخصوصية: سجل النشاط (من عمل شو) للمسجّلين فقط — ما يُعرض للزوار */
  if (!config.web.demoData && !req.session?.user) {
    return res.status(403).json({ error: 'login_required', message: 'سجّل الدخول بحساب ديسكورد لعرض سجل النشاط.' });
  }

  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const limit = Math.min(200, Math.max(5, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const action = req.query.action ? String(req.query.action).slice(0, 40) : null;
  const severity = ['info', 'warn', 'danger'].includes(String(req.query.severity)) ? String(req.query.severity) : null;

  const result = audit.list({ guildId, action, severity, limit, offset });
  return res.json({
    ...result,
    stats: audit.stats({ guildId }),
    limit,
    offset,
  });
});

/* ------------------------------------ السجلات والتذاكر والمستويات ------------------------------------ */
router.get('/guilds/:guildId/cases', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Math.max(5, Number(req.query.perPage) || 20));
  const { items, total } = db.listCases({
    guildId,
    userId: req.query.userId || null,
    type: req.query.type || null,
    active: req.query.active === 'true' ? true : req.query.active === 'false' ? false : null,
    limit: perPage,
    offset: (page - 1) * perPage,
  });

  return res.json({ items, total, page, perPage, pages: Math.ceil(total / perPage) });
});

router.get('/guilds/:guildId/tickets', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const { items, total } = db.listTickets({
    guildId,
    status: req.query.status || null,
    limit: Math.min(200, Number(req.query.limit) || 50),
    offset: Number(req.query.offset) || 0,
  });
  return res.json({ items, total });
});

router.post('/guilds/:guildId/tickets/:ticketId/close', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId, ticketId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const ticket = db.getTicketById(Number(ticketId));
  if (!ticket || ticket.guild_id !== guildId) return res.status(404).json({ error: 'not_found' });

  db.updateTicket(ticket.id, { status: 'closed', closed_at: Date.now() });

  // إن كان البوت شغّالًا، أضف رسالة إغلاق في القناة
  const client = safeClient();
  const channel = client?.channels?.cache?.get(ticket.channel_id);
  if (channel?.isTextBased?.()) {
    await channel
      .send({
        embeds: [
          require('../../lib/embeds').info(
            'أُغلقت التذكرة من لوحة التحكم',
            `تم الإغلاق بواسطة **${req.session.user?.username ?? 'لوحة التحكم'}**.`,
          ),
        ],
      })
      .catch(() => {});
  }

  return res.json({ ok: true, ticket: db.getTicketById(ticket.id) });
});

/**
 * لوحة المتصدّرين — تدعم الفترات (توب داي / توب ويك / كل الأوقات)
 * والمصادر (كتابي · صوتي · تفاعل).
 *   /api/guilds/:id/levels?period=day|week|all&source=all|text|voice|interact
 */
router.get('/guilds/:guildId/levels', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Number(req.query.perPage) || 20);
  const period = periods.isPeriod(req.query.period) ? String(req.query.period) : 'all';
  const source = periods.isSource(req.query.source) ? String(req.query.source) : 'all';

  const client = safeClient();
  const guild = client?.guilds?.cache?.get(guildId);

  const board = leveling.getBoard(guildId, { period, source, page, perPage });

  const items = board.rows.map((row) => {
    const member = guild?.members?.cache?.get(row.user_id);
    const levelRow = db.getLevelRow(guildId, row.user_id) || {};
    return {
      user_id: row.user_id,
      xp: row.board_xp ?? row.xp ?? 0,
      total_xp: levelRow.xp ?? row.xp ?? 0,
      level: row.level ?? levelRow.level ?? 0,
      text_xp: row.text_xp ?? 0,
      voice_xp: row.voice_xp ?? 0,
      interact_xp: row.interact_xp ?? 0,
      messages: row.messages ?? levelRow.messages ?? 0,
      voice_minutes: row.voice_minutes ?? levelRow.voice_minutes ?? 0,
      interactions: row.interactions ?? levelRow.interactions ?? 0,
      username: member?.user?.username ?? demoMemberInfo(row.user_id).username,
      displayName: member?.displayName ?? demoMemberInfo(row.user_id).displayName,
      avatar: member?.user?.displayAvatarURL?.({ size: 64 }) ?? null,
    };
  });

  return res.json({
    items,
    total: board.total,
    period: board.period,
    source: board.source,
    periodKey: board.key,
    reset: board.reset,
    totals: board.totals,
    periods: Object.values(periods.PERIODS),
    sources: Object.values(periods.SOURCES),
  });
});

/** بيانات عضو: من كاش ديسكورد، وإذا البوت مو شغّال نرجع لأسماء العرض */
function demoMemberInfo(id) {
  const demo = config.web.demoData ? demoData.demoMember?.(id) : null;
  if (demo) return { id: demo.id, username: demo.username, displayName: demo.displayName, avatar: null, bot: false };
  return { id, username: null, displayName: null, avatar: null };
}

/** تحويل قائمة آيديات إلى بيانات أعضاء (لجداول اللوحة) */
router.get('/guilds/:guildId/members', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const client = safeClient();
  const guild = client?.guilds?.cache?.get(guildId);
  const ids = String(req.query.ids || '').split(',').map((s2) => s2.trim()).filter(Boolean).slice(0, 100);
  const query = String(req.query.q || '').trim().toLowerCase();

  // البحث بالاسم داخل الكاش
  if (query && guild) {
    const results = [...guild.members.cache.values()]
      .filter((m) => m.user.username.toLowerCase().includes(query) || (m.displayName || '').toLowerCase().includes(query) || m.id.includes(query))
      .slice(0, 25)
      .map((m) => ({ id: m.id, username: m.user.username, displayName: m.displayName, avatar: m.user.displayAvatarURL({ size: 64 }), bot: m.user.bot }));
    return res.json({ members: results });
  }

  if (!guild || !ids.length) {
    return res.json({ members: ids.map((id) => demoMemberInfo(id)) });
  }

  const members = [];
  for (const id of ids) {
    const cached = guild.members.cache.get(id);
    if (cached) {
      members.push({ id, username: cached.user.username, displayName: cached.displayName, avatar: cached.user.displayAvatarURL({ size: 64 }), bot: cached.user.bot });
      continue;
    }
    const fetched = await guild.members.fetch(id).catch(() => null);
    members.push(
      fetched
        ? { id, username: fetched.user.username, displayName: fetched.displayName, avatar: fetched.user.displayAvatarURL({ size: 64 }), bot: fetched.user.bot }
        : demoMemberInfo(id),
    );
  }
  return res.json({ members });
});

/* ------------------------- ردود الأوامر (صفحة «ردود أوامر») ------------------------- */
/**
 * GET /api/guilds/:guildId/command-replies
 * يرجّع كل أوامر البوت + شكل ردها الحالي (رسالة نصية / إمبد) + معاينة قبل/بعد.
 * مع ?command=ban&mode=text&text=... يرجّع معاينة حيّة بدون حفظ (للمعاينة الفورية في اللوحة).
 */
router.get('/guilds/:guildId/command-replies', async (req, res) => {
  const { guildId } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const replyFormat = require('../../lib/replyFormat');
  const catalog = require('../../data/commandCatalog');
  const settings = db.getGuildSettings(guildId);

  /* معاينة مباشرة لأمر واحد بقيم غير محفوظة (المعاينة الفورية في اللوحة) */
  if (req.query.command) {
    const command = String(req.query.command);
    const meta = catalog.COMMANDS[command] || { label: command };
    const override = JSON.parse(JSON.stringify(settings));
    override.commandReplies = {
      ...(settings.commandReplies || {}),
      [command]: {
        mode: req.query.mode === 'text' || req.query.mode === 'embed' ? req.query.mode : undefined,
        text: typeof req.query.text === 'string' ? req.query.text : '',
      },
    };
    const config = replyFormat.configFor(override, command);
    return res.json({
      command,
      label: meta.label,
      defaultMode: replyFormat.defaultMode(command),
      mode: config.mode,
      text: config.text,
      preview: replyFormat.preview(command, override, { label: meta.label }),
    });
  }

  const items = Object.entries(catalog.COMMANDS).map(([name, meta]) => {
    const config = replyFormat.configFor(settings, name);
    const preview = replyFormat.preview(name, settings, { label: meta.label });
    return {
      name,
      label: meta.label,
      category: meta.category || 'general',
      audience: meta.audience || 'member',
      defaultMode: replyFormat.defaultMode(name),
      mode: config.mode,
      text: config.text,
      before: preview.before,
      after: preview.after,
    };
  });

  return res.json({ items, textByDefault: replyFormat.TEXT_BY_DEFAULT });
});

/* 🖼️ تشخيص مباشر للوحة التذاكر: هل الصورة منشورة + القائمة + الصورة الزخرفية */
router.get('/guilds/:guildId/tickets/panel', async (req, res) => {
  const guildId = guildId0(req);
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const client = safeClient();
  const guild = client?.guilds?.cache?.get(guildId);
  const tickets = require('../../systems/tickets');
  const cfg = db.getGuildSettings(guildId)?.tickets || {};
  const out = {
    config: {
      enabled: Boolean(cfg.enabled),
      panelMode: cfg.panelMode,
      panelImage: tickets.effectiveImages(cfg).panelImage,
      panelImageOnly: cfg.panelImageOnly,
      panelFooterImage: tickets.effectiveImages(cfg).panelFooterImage,
      storedPanelImage: cfg.panelImage ?? null,
      panelPlaceholder: cfg.panelPlaceholder,
      panelChannelId: cfg.panelChannelId || null,
      panelAutoPost: cfg.panelAutoPost,
      openImage: cfg.openImage,
      openImageOnly: cfg.openImageOnly,
      signature: cfg.panelSignature || null,
      wantedSignature: tickets.panelSignature(cfg),
      types: (cfg.types || []).map((type) => ({ id: type.id, label: type.label, description: type.description || '' })),
    },
    status: tickets.status(guildId),
    live: null,
  };

  const channel = guild && cfg.panelChannelId
    ? guild.channels.cache.get(cfg.panelChannelId) || (await guild.channels.fetch(cfg.panelChannelId).catch(() => null))
    : null;

  if (channel?.isTextBased?.()) {
    const fetched = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (fetched) {
      const isPanel = (m) => (m.components || []).some((row) =>
        (row.components || []).some((c) => String(c.customId || '').startsWith('ticket:open')));
      /* الصور الحين مرفقات عادية (بلا إمبد)، والنسخ القديمة كانت إمبد — نغطّي الحالتين */
      const imageOf = (m) => m.embeds?.find((embed) => embed?.image?.url)?.image?.url
        || [...(m.attachments?.values?.() ?? [])].find((a) => /^image\//.test(String(a.contentType || '')) || /\.(png|jpe?g|webp|gif)$/i.test(String(a.name || '')))?.url
        || null;
      out.live = {
        channelName: channel.name,
        count: fetched.size,
        panel: [...fetched.values()].filter(isPanel).map((m) => ({
          id: m.id,
          image: imageOf(m),
          attachments: m.attachments?.size ?? 0,
          embeds: m.embeds?.length ?? 0,
          hasText: Boolean(String(m.embeds?.[0]?.title || m.embeds?.[0]?.description || m.content || '').trim()),
          kind: (m.components || []).some((row) => (row.components || []).some((c) => c.type === 3)) ? 'select' : 'buttons',
          ageSeconds: Math.round((Date.now() - m.createdTimestamp) / 1000),
        })),
        images: [...fetched.values()]
          .filter((m) => imageOf(m))
          .slice(0, 6)
          .map((m) => ({
            id: m.id,
            image: imageOf(m),
            kind: m.embeds?.length ? 'embed' : 'attachment',
            ageSeconds: Math.round((Date.now() - m.createdTimestamp) / 1000),
          })),
      };
    }
  }

  return res.json(out);
});

/* ------------------------- إجراءات تجريبية من اللوحة ------------------------- */
/**
 * POST /api/guilds/:guildId/actions/:action
 * action: test   → يرسل رسالة اختبار للقناة المحدّدة (الترحيب • السجلات • الخط الفاصل)
 *         panel  → ينشر لوحة التذاكر في القناة المرسلة في body.channelId
 * يعمل فقط عندما يكون البوت متصلًا بديسكورد (وإلا يرجع رسالة واضحة).
 */
router.post('/guilds/:guildId/actions/:action', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly', message: 'هذا الإجراء يحتاج تسجيل دخول Discord.' });

  const { guildId, action } = req.params;
  if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });

  const client = safeClient();
  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) {
    return res.status(409).json({ ok: false, message: 'الإرسال التجريبي يحتاج تشغيل البوت بديسكورد (ضع DISCORD_TOKEN في .env ثم أعد التشغيل).' });
  }

  const settings = db.getGuildSettings(guildId);
  const type = String(req.body?.type || 'welcome');
  const channelId = req.body?.channelId || null;

  try {
    /* 👋 ترحيب تجريبي: نرسل رسالة ترحيب حقيقية (الصورة + النص) في قناة الترحيب */
    if (action === 'welcome') {
      const welcome = require('../../systems/welcome');
      const target = channelId || settings.welcome?.channelId;
      if (!target) return res.status(400).json({ ok: false, message: 'حدّد قناة الترحيب أولًا.' });

      const wanted = String(req.body?.memberId || '').trim();
      let subject = wanted ? await guild.members.fetch(wanted).catch(() => null) : null;
      if (!subject) subject = await guild.members.fetch(req.user?.id).catch(() => null);
      if (!subject) {
        /* نختار عضوًا حقيقيًا له أفتار: المالك أولًا ثم أول عضو بشري */
        const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
        subject = owner || guild.members.cache.find((m) => !m.user.bot && m.user.displayAvatarURL) || guild.members.me;
      }

      const result = await welcome.sendTestWelcome(client, guild, subject, { channelId: target });
      if (!result.ok) return res.status(500).json({ ok: false, message: `تعذّر إرسال الترحيب (${result.reason}).` });
      const parts = result.separateMessages ? 'صورة أولًا ثم النص (رسالتان)' : 'رسالة واحدة';
      return res.json({
        ok: true,
        message: `👋 انبعت ترحيب تجريبي في <#${result.channelId}> باسم ${result.member} — ${parts} · Inv By: ${result.inviter}`,
        result,
      });
    }

    if (action === 'panel') {
      const tickets = require('../../systems/tickets');
      const target = channelId || settings.tickets.panelChannelId || settings.tickets.logChannelId;
      if (!target) return res.status(400).json({ ok: false, message: 'حدّد قناة إرسال اللوحة أولًا.' });
      const channel = await guild.channels.fetch(target).catch(() => null);
      if (!channel?.isTextBased?.()) return res.status(400).json({ ok: false, message: 'القناة غير صالحة لإرسال اللوحة.' });
      /* نحفظ القناة ثم ننشر اللوحة الجديدة ونحفظ بصمتها (تحديث تلقائي بعدها لأي تعديل) */
      db.updateGuildSettings(guildId, { tickets: { panelChannelId: channel.id } });
      const result = await tickets.ensurePanel(client, guild, { force: true });
      if (!result.ok) return res.status(500).json({ ok: false, message: 'تعذّر نشر اللوحة في هذه القناة.' });
      return res.json({
        ok: true,
        message: `✅ تم نشر اللوحة في #${channel.name} (${result.sent} رسالة)${result.cleaned ? ` — ونظّفت ${result.cleaned} رسالة قديمة` : ''}`,
        panel: result,
      });
    }

    if (type === 'logs') {
      const logging = require('../../systems/logging');
      const sent = await logging.send(client, guild, 'messageDelete', {
        title: 'اختبار السجلات من لوحة التحكم',
        description: 'هذه رسالة تجريبية للتأكد من وصول السجلات لهذه القناة.',
        fields: [{ name: 'بواسطة', value: req.user?.username ? `@${req.user.username}` : 'لوحة التحكم' }],
      });
      if (!sent) return res.status(400).json({ ok: false, message: 'تأكد من تفعيل السجلات واختيار قناة السجلات.' });
      return res.json({ ok: true, message: '✅ أُرسلت رسالة سجل تجريبية.' });
    }

    if (type === 'autoline') {
      const autoline = require('../../systems/autoline');
      const target = (settings.autoline.channels || [])[0] || channelId;
      if (!target) return res.status(400).json({ ok: false, message: 'حدّد قناة للخط الفاصل أولًا.' });
      const channel = await guild.channels.fetch(target).catch(() => null);
      if (!channel?.isTextBased?.()) return res.status(400).json({ ok: false, message: 'القناة غير صالحة.' });
      await autoline.sendTestLine(channel);
      return res.json({ ok: true, message: `✅ أُرسل الخط في #${channel.name}` });
    }

    // الافتراضي: اختبار الترحيب (بالأفتار/البطاقة)
    const welcome = require('../../systems/welcome');
    const targetId = settings.welcome.channelId || channelId;
    if (!targetId) return res.status(400).json({ ok: false, message: 'حدّد قناة الترحيب أولًا.' });
    const channel = await guild.channels.fetch(targetId).catch(() => null);
    if (!channel?.isTextBased?.()) return res.status(400).json({ ok: false, message: 'القناة غير صالحة.' });

    const member = await guild.members.fetch(req.user?.id).catch(() => null);
    const subject = member || guild.members.me;
    if (!subject) return res.status(400).json({ ok: false, message: 'تعذّر جلب بيانات العضو.' });

    /* نفس بناء الرسالة الحقيقية: صورة الترحيب + النص (بلا Embed افتراضيًا) */
    const payload = await welcome.buildWelcomePayload(client, subject, settings);

    await channel.send(payload);
    return res.json({ ok: true, message: `✅ أُرسلت رسالة ترحيب تجريبية في #${channel.name}` });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * 🟣 حالة البوت (Presence) — تُطبَّق فورًا على البوت الشغّال:
 *   POST /api/guilds/:guildId/presence  { name, type, url, status }
 */
router.post('/guilds/:guildId/presence', async (req, res) => {
  try {
    const { guildId } = req.params;
    if (!(await canAccess(req, guildId))) return res.status(403).json({ error: 'forbidden' });
    if (!canEdit(req)) return res.status(403).json({ ok: false, message: 'هذا التعديل يحتاج صلاحية مدير.' });

    const presence = require('../../systems/presence');
    const client = safeClient();
    if (!client) return res.status(400).json({ ok: false, message: 'البوت مو متصل حاليًا.' });

    const saved = presence.save(client, guildId, {
      name: req.body?.name,
      type: req.body?.type,
      url: req.body?.url,
      status: req.body?.status,
    });
    if (!saved.ok && saved.reason !== 'noClient') {
      return res.status(400).json({ ok: false, message: `تعذّر ضبط الحالة (${saved.reason})`, presence: saved.presence });
    }

    const info = presence.describe(saved.presence);
    return res.json({
      ok: true,
      message: `🟣 حالة البوت الآن: «${info.text}» — ${info.typeLabel} · ${info.statusLabel}`,
      presence: info,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

/* ------------------------------------ فحص البوت ------------------------------------ */
/* ---------------------------- المزامنة الحقيقية ---------------------------- */

/** حالة المزامنة: آخر مزامنة، عدد السيرفرات، مصدرها، حالة البوت */
router.get('/sync/status', (req, res) => {
  const status = sync.getStatus();
  res.json(canSeePrivate(req) ? status : publicSync(status));
});

/** مزامنة فورية لكل السيرفرات (يحتاج صلاحية تعديل) */
router.post('/sync', async (req, res) => {
  if (!canEdit(req)) {
    return res.status(403).json({ error: 'readonly', message: 'المزامنة اليدوية تحتاج تسجيل دخول Discord.' });
  }
  const result = await sync.syncNow({});
  res.json({ ok: Boolean(result.ok), status: result });
});

/** مزامنة سيرفر واحد */
router.post('/guilds/:guildId/sync', async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'readonly' });
  const { guildId } = req.params;
  const client = safeClient();
  const guild = client?.guilds?.cache?.get(guildId);
  if (guild) {
    sync.saveSnapshot(sync.serializeGuild(guild, sync.getSnapshot(guildId)));
  } else {
    await sync.syncNow({});
  }
  const snapshot = sync.getSnapshot(guildId);
  res.json({ ok: true, syncedAt: snapshot?.syncedAt ?? null, status: sync.getStatus() });
});

/**
 * البث الحيّ (Server-Sent Events): يحدّث الصفحة المفتوحة فورًا عند أي مزامنة.
 * يُستخدم في اللوحة ليعرض «آخر مزامنة» والقوائم الحقيقية بدون تحديث الصفحة.
 */
router.get('/events', (req, res) => {
  const trusted = canSeePrivate(req);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const hello = trusted ? sync.getStatus() : publicSync(sync.getStatus());
  res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);

  const off = sync.onEvent((event, payload) => {
    try {
      const body = trusted ? payload : publicSync(payload);
      res.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`);
    } catch { /* انقطع الاتصال */ }
  });

  /* تغييرات الإعدادات: من اللوحة أو من أوامر البوت داخل ديسكورد */
  const live = require('../../lib/live');
  const offSettings = live.onSettings((payload) => {
    try {
      const body = trusted
        ? payload
        : { guildId: payload?.guildId || null, source: payload?.source || null, at: payload?.at || null };
      res.write(`event: settings\ndata: ${JSON.stringify(body)}\n\n`);
    } catch { /* انقطع الاتصال */ }
  });

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch { /* تجاهل */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    off();
    offSettings();
  });
});

router.get('/status', (req, res) => {
  const client = safeClient();
  if (!canSeePrivate(req)) {
    return res.json({ ok: true, botReady: Boolean(client?.isReady?.()) });
  }
  res.json({
    botReady: Boolean(client?.isReady?.()),
    botsTag: client?.user?.tag ?? null,
    guilds: client?.guilds?.cache?.size ?? 0,
    commands: client?.commands?.size ?? 0,
    database: db.driverName,
    demo: config.web.demoMode,
    uptime: client ? Date.now() - client.startedAt : 0,
    sync: sync.getStatus(),
    /* تشخيص حيّ لردود البوت: كم رد زيّناه · كم مرة رجّعنا النص الأصلي · آخر خطأ إرسال */
    replies: (() => {
      try {
        return require('../../lib/replies').decorateStats();
      } catch {
        return null;
      }
    })(),
    /*
     * بصمة الإصدار المنشور: تتأكّد بنفسك إن السيرفر شغّال على آخر كود ولا لأ.
     * قارن القيم مع الملفات عندك — أو شوف topBoardFooter = false يعني «التوب بلا فوتر».
     */
    /* 🟣 حالة البوت (Presence): المطلوب + اللي شافه ديسكورد فعلًا */
    presence: (() => {
      try {
        const presence = require('../../systems/presence');
        const client = safeClient();
        return {
          wanted: presence.describe(),
          applied: client ? presence.applied(client) : null,
          last: presence.state(),
        };
      } catch {
        return null;
      }
    })(),
    /* 👋 الترحيب: آخر ترحيب انبعت + العضو + الداعي + إيموجيات ناقصة (تشخيص حيّ) */
    welcome: (() => {
      try {
        const welcome = require('../../systems/welcome');
        const client = safeClient();
        const out = { ...welcome.status() };
        const missing = {};
        for (const guild of client?.guilds?.cache?.values() || []) {
          const found = welcome.missingEmojis(guild, db.getGuildSettings(guild.id)?.welcome?.message);
          if (found.length) missing[guild.id] = found;
        }
        out.missingEmojis = missing;
        return out;
      } catch {
        return null;
      }
    })(),
    /* 🖼️ لوحة التذاكر: آخر تحديث تلقائي + القناة (تشخيص حيّ) */
    ticketsPanel: (() => {
      try {
        return require('../../systems/tickets').status();
      } catch {
        return null;
      }
    })(),
    /* 🧹 روم الأوامر: آخر نشر/تنظيف + كم رسالة انمسحت (تشخيص حيّ) */
    commandRoom: (() => {
      try {
        return require('../../systems/commandRoom').status();
      } catch {
        return null;
      }
    })(),
    build: (() => {
      try {
        const fs = require('node:fs');
        const crypto = require('node:crypto');
        const path = require('node:path');
        const root = path.join(__dirname, '..', '..', '..'); // جذر المشروع
        const read = (rel) => {
          try {
            return fs.readFileSync(path.join(root, rel), 'utf8');
          } catch {
            return '';
          }
        };
        const fingerprint = (rel) => (read(rel) ? crypto.createHash('sha1').update(read(rel)).digest('hex').slice(0, 12) : null);
        const levelingSrc = read('src/systems/leveling.js');
        return {
          files: {
            'src/systems/leveling.js': fingerprint('src/systems/leveling.js'),
            'src/web/public/app.js': fingerprint('src/web/public/app.js'),
            'src/web/routes/api.js': fingerprint('src/web/routes/api.js'),
          },
          /* false = التوب بلا فوتر (الشكل الأخير) */
          topBoardFooter: !levelingSrc.includes('بلا تذييل — رقم الصفحة'),
        };
      } catch {
        return null;
      }
    })(),
  });
});

module.exports = router;
