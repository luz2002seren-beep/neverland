'use strict';

/**
 * ui-site-members-test.js
 * -------------------------------------------------------------
 * فحص واجهة «أعضاء الموقع» بالمتصفح الوهمي:
 *   • تظهر للمالك في القائمة الجانبية، وتُخفي عن غيره
 *   • تعرض الأعضاء بحالاتهم وأزرار التحكم (نشِط · مشاهدة فقط · حظر · قطع الجلسة)
 *   • المالك يحصل على شارة «حسابك» بلا أزرار (حماية حسابه)
 * -------------------------------------------------------------
 */

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const publicDir = path.join(ROOT, 'src', 'web', 'public');

const GUILD = {
  settings: {},
  guild: { id: 'g1', name: 'Never Land', memberCount: 61, botPresent: true },
  stats: { cases: 0, warnings: 0, openTickets: 0, messages: 0, trackedMembers: 0 },
  daily: [],
  sync: { ok: true },
  meta: { channels: [], roles: [], logGroups: {}, logEvents: {}, emojis: [], cardAvailable: false, autolineStyles: [] },
  viewer: { canEdit: true, loggedIn: true, publicAccess: true, loginRequired: false, demo: false },
};

const MEMBERS = {
  stats: { total: 2, byStatus: { active: 1, viewonly: 0, banned: 1 }, onlineToday: 2, totalVisits: 7 },
  canManage: true,
  statuses: [],
  ownerId: '1345866950776979547',
  members: [
    {
      id: '1345866950776979547', username: 'owner', globalName: 'المالك', avatar: null, status: 'active',
      isOwner: true, isMe: true, visits: 4, guilds: 1, lastSeen: Date.now(), firstSeen: Date.now() - 864e5,
    },
    {
      id: '222222222222222222', username: 'other', globalName: 'مستخدم تجريبي', avatar: null, status: 'banned',
      isOwner: false, isMe: false, visits: 3, guilds: 1, lastSeen: Date.now() - 36e5, firstSeen: Date.now() - 2 * 864e5,
      note: 'تخريب',
    },
  ],
};

async function render({ isOwner }) {
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head>
  <body><div id="app" data-guild="g1" data-edit="1" data-owner="${isOwner ? '1' : '0'}" data-viewonly="0"></div></body></html>`;

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String(e?.message || e);
    if (!/scrollTo|Not implemented/i.test(m)) errors.push(m);
  });

  const dom = new JSDOM(html, {
    url: 'http://localhost/dashboard/g1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      win.fetch = async (input) => {
        const url = String(input);
        let payload = {};
        if (url.includes('/api/admin/members')) payload = MEMBERS;
        else if (url.includes('/api/guilds/')) payload = GUILD;
        else if (url.includes('/api/admin/me')) payload = { isOwner, loggedIn: true };
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
      };
    },
  });

  // نحمّل نفس ملفات الموقع بالترتيب نفسه
  for (const file of ['icons.js', 'app.js']) {
    const code = fs.readFileSync(path.join(publicDir, file), 'utf8');
    dom.window.eval(code);
  }
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 900));
  return { dom, errors };
}

(async () => {
  /* ── المالك ── */
  const owner = await render({ isOwner: true });
  const d1 = owner.dom.window.document;
  const labels1 = [...d1.querySelectorAll('.d-nav-label')].map((n) => n.textContent.trim());
  const hasSection = labels1.includes('أعضاء الموقع');
  console.log('المالك — أقسام القائمة:', labels1.length);
  console.log('المالك — قسم «أعضاء الموقع» ظاهر؟', hasSection ? 'نعم ✔' : 'لا ✗');

  if (hasSection) {
    const item = [...d1.querySelectorAll('.d-nav-item')].find((n) => n.querySelector('.d-nav-label')?.textContent.trim() === 'أعضاء الموقع');
    item.dispatchEvent(new owner.dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const content = d1.getElementById('d-content');
    const text = content.textContent.replace(/\s+/g, ' ').trim();
    const rows = content.querySelectorAll('tbody tr').length;
    const badges = [...content.querySelectorAll('.sm-badge')].map((b) => b.textContent.trim());
    const buttons = [...content.querySelectorAll('.sm-actions button')].map((b) => b.textContent.trim());
    const locked = content.querySelectorAll('.sm-locked').length;
    console.log('صفوف الأعضاء:', rows, '| الحالات:', badges.join(' · '));
    console.log('أزرار التحكم:', buttons.join(' | '));
    console.log('حساب المالك محمي بلا أزرار؟', locked >= 1 ? 'نعم ✔' : 'لا ✗');
    console.log('إحصاءات:', text.slice(0, 90));
  }
  console.log('أخطاء JS (المالك):', owner.errors.length ? owner.errors.join(' | ') : 'لا شيء ✔');

  /* ── عضو عادي ── */
  const other = await render({ isOwner: false });
  const d2 = other.dom.window.document;
  const labels2 = [...d2.querySelectorAll('.d-nav-label')].map((n) => n.textContent.trim());
  console.log('عضو عادي — قسم «أعضاء الموقع» ظاهر؟', labels2.includes('أعضاء الموقع') ? 'نعم ✗' : 'لا ✔');
  console.log('عضو عادي — عدد الأقسام:', labels2.length, '(المالك:', labels1.length + ')');
  console.log('أخطاء JS (عضو عادي):', other.errors.length ? other.errors.join(' | ') : 'لا شيء ✔');
  process.exit(0);
})().catch((e) => {
  console.error('فشل الفحص:', e.message);
  process.exit(1);
});
