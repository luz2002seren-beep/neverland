'use strict';

/**
 * V2 bot control center. This page is deliberately independent from the old
 * per-guild dashboard route, preserving the existing website and data model.
 */
const express = require('express');
const config = require('../../config');
const db = require('../../database');
const audit = require('../../lib/audit');
const siteUsers = require('../siteUsers');
const { layout, escapeHtml } = require('./pages');
const settings = require('../../bot/settings');
const botRuntime = require('../../bot/runtime');
const { publicConfig } = require('../../bot/env');

const page = express.Router();
const api = express.Router();

function apiError(res, status, error, message) {
  return res.status(status).json({ error, message });
}

function accessible(req, res, next, isApi = false) {
  if (config.web.demoMode) {
    req.botControlDemo = true;
    return next();
  }
  const user = req.session?.user;
  if (!user?.id) {
    if (isApi) return apiError(res, 401, 'login_required', 'Sign in is required.');
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  if (siteUsers.isBanned(user.id) || !siteUsers.isAllowed(user.id)) {
    if (isApi) return apiError(res, 403, 'access_denied', 'You do not have access to this control center.');
    return res.status(403).send(layout({
      title: 'الوصول مقيّد',
      req,
      user,
      body: '<section class="site-hero"><span class="pill">وصول مقيّد</span><h1>هذه الصفحة متاحة للمشرفين المسموح لهم فقط.</h1><a class="btn btn-primary" href="/dashboard">العودة للوحة التحكم</a></section>',
    }));
  }
  return next();
}

function canEdit(req) {
  if (req.botControlDemo) return true;
  const userId = String(req.session?.user?.id || '');
  return siteUsers.isOwner(userId) || (config.web.siteAdmins || []).map(String).includes(userId);
}

function requireEditor(req, res, next) {
  if (!canEdit(req)) return apiError(res, 403, 'read_only', 'Only the site owner or a configured site administrator may change bot settings.');
  return next();
}

function overview() {
  const environment = publicConfig();
  const runtime = botRuntime.status();
  const guildId = environment.primaryGuildId;
  let ticketsOpen = 0;
  let casesRecent = 0;
  if (guildId) {
    try {
      ticketsOpen = db.countTickets(guildId, 'open');
      casesRecent = db.listCases({ guildId, limit: 30, offset: 0 }).total;
    } catch { /* Database may be initializing during an early request. */ }
  }
  return { environment, runtime, ticketsOpen, casesRecent, canEdit: false };
}

function statusPayload(req) {
  return { settings: settings.get(), ...overview(), canEdit: canEdit(req) };
}

page.get('/', (req, res, next) => accessible(req, res, next, false), (req, res) => {
  const user = req.session?.user || (req.botControlDemo ? { username: 'Preview', globalName: 'Preview mode' } : null);
  const readonly = !canEdit(req);
  const body = `
  <section class="bot-control-hero">
    <div>
      <span class="pill">BOT V2 · PREVIEW</span>
      <h1>مركز إدارة Never Land</h1>
      <p class="muted">إعدادات البوت الجديد مستقلة وآمنة، ولا تغيّر بيانات الموقع أو الإعدادات القديمة.</p>
    </div>
    <div class="bot-control-actions">
      <a class="btn btn-ghost" href="/dashboard">← لوحة السيرفرات</a>
      <button class="btn btn-ghost" type="button" id="refreshBotStatus">تحديث الحالة</button>
      ${readonly ? '<span class="bot-readonly">وضع المشاهدة فقط</span>' : '<button class="btn btn-primary" type="submit" form="botSettingsForm">حفظ التغييرات</button>'}
    </div>
  </section>

  <section class="bot-status-grid" aria-label="حالة البوت">
    <article class="bot-status-card"><span>حالة البوت</span><strong id="runtimeState">—</strong><small id="runtimeError">جارٍ التحميل…</small></article>
    <article class="bot-status-card"><span>ربط Discord</span><strong id="discordReadiness">—</strong><small id="discordReadinessHint">—</small></article>
    <article class="bot-status-card"><span>التذاكر المفتوحة</span><strong id="openTickets">0</strong><small>من قاعدة البيانات الحالية</small></article>
    <article class="bot-status-card"><span>حالات الإشراف</span><strong id="casesRecent">0</strong><small>السجل المحفوظ للسيرفر الرئيسي</small></article>
  </section>

  <div class="bot-notice" id="botNotice" hidden role="status"></div>
  <form id="botSettingsForm" class="bot-settings" ${readonly ? 'data-readonly="true"' : ''}>
    <section class="bot-section">
      <div class="bot-section-heading"><span class="bot-section-number">01</span><div><h2>الوحدات والأوامر</h2><p>شغّل فقط ما تريد أن يتعامل معه البوت الجديد.</p></div></div>
      <div class="toggle-grid">
        <label class="toggle"><input type="checkbox" data-path="modules.moderation"><span>الإشراف</span></label>
        <label class="toggle"><input type="checkbox" data-path="modules.automod"><span>الحماية التلقائية</span></label>
        <label class="toggle"><input type="checkbox" data-path="modules.tickets"><span>التذاكر</span></label>
        <label class="toggle"><input type="checkbox" data-path="modules.welcome"><span>الترحيب</span></label>
        <label class="toggle"><input type="checkbox" data-path="modules.logging"><span>السجلات</span></label>
        <label class="toggle"><input type="checkbox" data-path="modules.utility"><span>الأدوات</span></label>
      </div>
      <div class="toggle-grid compact">
        <label class="toggle"><input type="checkbox" data-path="commands.moderation"><span>أوامر الإشراف</span></label>
        <label class="toggle"><input type="checkbox" data-path="commands.tickets"><span>أوامر التذاكر</span></label>
        <label class="toggle"><input type="checkbox" data-path="commands.utility"><span>أوامر الأدوات</span></label>
      </div>
    </section>

    <section class="bot-section">
      <div class="bot-section-heading"><span class="bot-section-number">02</span><div><h2>فريق الإشراف</h2><p>ضع Discord IDs فقط. افصل أكثر من رتبة بفاصلة.</p></div></div>
      <div class="bot-field-grid">
        <label>رتب فريق الإشراف<textarea data-path="moderation.staffRoleIds" data-list rows="3" placeholder="123456789012345678, 234567890123456789"></textarea></label>
        <label>رتب مسموح لها بقفل الرومات<textarea data-path="moderation.lockAllowedRoleIds" data-list rows="3" placeholder="اختياري"></textarea></label>
        <label>مدة الـ timeout الافتراضية (دقيقة)<input type="number" min="1" max="40320" data-path="moderation.defaultTimeoutMinutes"></label>
        <label>حد التحذيرات المرجعي<input type="number" min="1" max="20" data-path="moderation.warnThreshold"></label>
      </div>
    </section>

    <section class="bot-section">
      <div class="bot-section-heading"><span class="bot-section-number">03</span><div><h2>الحماية التلقائية</h2><p>تحذف الرسائل المخالفة وتسجل الإجراء؛ جرّبها في قناة آمنة أولًا.</p></div></div>
      <div class="toggle-grid compact"><label class="toggle"><input type="checkbox" data-path="automod.enabled"><span>تفعيل AutoMod</span></label></div>
      <div class="bot-field-grid">
        <label>أقصى عدد منشنات<input type="number" min="1" max="50" data-path="automod.mentionLimit"></label>
        <label>نافذة تكرار الرسائل (ثانية)<input type="number" min="3" max="120" data-path="automod.duplicateWindowSeconds"></label>
        <label>عدد الرسائل المتطابقة<input type="number" min="2" max="20" data-path="automod.duplicateThreshold"></label>
        <label>الإجراء<select data-path="automod.action"><option value="delete">حذف فقط</option><option value="warn">حذف + تحذير</option><option value="timeout">حذف + Timeout</option></select></label>
        <label>مدة Timeout (دقيقة)<input type="number" min="1" max="40320" data-path="automod.timeoutMinutes"></label>
        <label>قناة سجل AutoMod (ID)<input inputmode="numeric" data-path="automod.logChannelId" placeholder="اختياري"></label>
        <label class="wide">الكلمات المحظورة<textarea data-path="automod.blockedWords" data-list rows="3" placeholder="كل كلمة في سطر، أو مفصولة بفاصلة"></textarea></label>
        <label class="wide">رتب مستثناة<textarea data-path="automod.exemptRoleIds" data-list rows="2" placeholder="Discord role IDs"></textarea></label>
      </div>
    </section>

    <section class="bot-section">
      <div class="bot-section-heading"><span class="bot-section-number">04</span><div><h2>قنوات السجلات</h2><p>يمكن تعيين قناة مختلفة لكل نوع من الأحداث.</p></div></div>
      <div class="toggle-grid compact"><label class="toggle"><input type="checkbox" data-path="logs.enabled"><span>تفعيل إرسال السجلات</span></label></div>
      <div class="bot-field-grid">
        <label>سجل الإشراف<input inputmode="numeric" data-path="logs.moderationChannelId"></label>
        <label>سجل الرسائل<input inputmode="numeric" data-path="logs.messageChannelId"></label>
        <label>سجل الأعضاء<input inputmode="numeric" data-path="logs.memberChannelId"></label>
        <label>سجل التذاكر<input inputmode="numeric" data-path="logs.ticketChannelId"></label>
        <label>سجل النظام الاحتياطي<input inputmode="numeric" data-path="logs.systemChannelId"></label>
      </div>
    </section>

    <section class="bot-section">
      <div class="bot-section-heading"><span class="bot-section-number">05</span><div><h2>نظام التذاكر</h2><p>لا تُحذف التذاكر المقفلة تلقائيًا؛ تُؤرشف للحفاظ على السجل.</p></div></div>
      <div class="toggle-grid compact"><label class="toggle"><input type="checkbox" data-path="tickets.enabled"><span>تفعيل التذاكر</span></label></div>
      <div class="bot-field-grid">
        <label>Category ID<input inputmode="numeric" data-path="tickets.categoryId"></label>
        <label>قناة لوحة التذاكر ID<input inputmode="numeric" data-path="tickets.panelChannelId"></label>
        <label>رتب الدعم<textarea data-path="tickets.supportRoleIds" data-list rows="2" placeholder="Discord role IDs"></textarea></label>
        <label>عنوان اللوحة<input maxlength="80" data-path="tickets.title"></label>
        <label class="wide">رسالة بداية التذكرة<textarea data-path="tickets.greeting" rows="3" maxlength="1000"></textarea></label>
        <label>حذف تلقائي بعد الإغلاق (ساعات)<input type="number" min="0" max="720" data-path="tickets.closeAfterHours"><small>0 = أرشفة فقط، وهو الوضع الآمن الحالي.</small></label>
      </div>
    </section>

    <section class="bot-section">
      <div class="bot-section-heading"><span class="bot-section-number">06</span><div><h2>الترحيب</h2><p>المتغيرات المدعومة: {user}، {server}، {memberCount}.</p></div></div>
      <div class="toggle-grid compact"><label class="toggle"><input type="checkbox" data-path="welcome.enabled"><span>تفعيل رسالة الترحيب</span></label></div>
      <div class="bot-field-grid">
        <label>قناة الترحيب ID<input inputmode="numeric" data-path="welcome.channelId"></label>
        <label class="wide">رسالة الترحيب<textarea data-path="welcome.message" rows="3" maxlength="1500"></textarea></label>
      </div>
    </section>

    ${readonly ? '' : '<div class="bot-save-row"><button class="btn btn-primary" type="submit">حفظ إعدادات Bot V2</button><span>لن يبدأ البوت أو يتصل بـ Discord عند الحفظ وحده.</span></div>'}
  </form>
  <script src="/bot-control.js" defer></script>`;

  return res.send(layout({
    title: 'مركز إدارة البوت',
    body,
    user,
    req,
    bodyClass: 'dashboard bot-control-page',
    extraHead: '<link rel="stylesheet" href="/bot-control.css">',
  }));
});

api.get('/', (req, res, next) => accessible(req, res, next, true), (req, res) => res.json(statusPayload(req)));

api.put('/config', (req, res, next) => accessible(req, res, next, true), requireEditor, (req, res) => {
  const nextSettings = settings.update(req.body?.settings || req.body || {});
  audit.record(req, {
    action: 'bot_v2.settings.updated',
    target: publicConfig().primaryGuildId || 'not-configured',
    detail: 'Bot V2 configuration was updated from the control center.',
    actor: req.session?.user,
  });
  return res.json({ ok: true, settings: nextSettings, ...overview(), canEdit: true });
});

module.exports = { page, api };
