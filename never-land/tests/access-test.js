'use strict';
/**
 * اختبار منطق الوصول: فحص الرول عبر عميل وهمي + البوابة.
 * يُشغَّل من جذر المشروع:  node access-test.js
 */
const path = require('path');
const assert = require('node:assert');

const ROLE = '1549364852433354792';
process.env.REQUIRED_ROLE_ID = ROLE;

const config = require('../src/config');
const access = require('../src/web/access');

const CLIENT_PATH = require.resolve('../src/client.js');

/** عميل وهمي */
function fakeMember(m) {
  const perms = new Set(m.perms || []);
  return {
    id: m.id,
    roles: { cache: new Map((m.roles || []).map((r) => [r, {}])) },
    permissions: { has: (flag) => perms.has(String(flag)) },
  };
}

function fakeClient({ ready = true, guilds = [] } = {}) {
  return {
    isReady: () => ready,
    guilds: {
      cache: new Map(
        guilds.map((g) => [
          g.id,
          {
            id: g.id,
            name: g.name,
            ownerId: g.ownerId || null,
            roles: { cache: new Map((g.roles || []).map((r) => [r, {}])) },
            members: {
              cache: new Map((g.members || []).map((m) => [m.id, fakeMember(m)])),
              fetch: async (id) => {
                const m = (g.members || []).find((x) => x.id === id);
                if (!m) throw new Error('unknown member');
                return fakeMember(m);
              },
            },
          },
        ]),
      ),
    },
  };
}

function installClient(client) {
  require.cache[CLIENT_PATH] = { id: CLIENT_PATH, filename: CLIENT_PATH, loaded: true, exports: client };
}

(async () => {
  console.log('١) الرول المطلوب في الإعدادات:', config.web.requiredRoleId);
  assert.strictEqual(config.web.requiredRoleId, ROLE, 'معرّف الرول غير مطابق');
  assert.strictEqual(config.web.loginRequired, true, 'تأكيد الدخول غير مفعّل');
  console.log('   ✅ تأكيد الدخول مفعّل + الرول مطابق');

  // 2) البوت غير متصل
  installClient(fakeClient({ ready: false }));
  let r = await access.hasRequiredRole('111');
  console.log('٢) البوت غير متصل →', r.reason);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bot_offline');

  // 3) الرول غير موجود بأي سيرفر
  installClient(fakeClient({ guilds: [{ id: 'g1', name: 'سيرفر ١', roles: ['999'], members: [] }] }));
  r = await access.hasRequiredRole('111');
  console.log('٣) الرول مو موجود بالسيرفرات →', r.reason);
  assert.strictEqual(r.reason, 'role_missing_in_guilds');

  // 4) العضو يملك الرول
  installClient(
    fakeClient({
      guilds: [{ id: 'g1', name: 'سيرفر Never Land', roles: ['888', ROLE], members: [{ id: '111', roles: ['888', ROLE] }] }],
    }),
  );
  r = await access.hasRequiredRole('111');
  console.log('٤) عضو يملك الرول →', r.ok, '|', r.reason, '| السيرفر:', r.guild);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'ok');

  // 5) عضو بدون الرول
  installClient(fakeClient({ guilds: [{ id: 'g1', name: 'سيرفر Never Land', roles: [ROLE], members: [{ id: '222', roles: ['999'] }] }] }));
  r = await access.hasRequiredRole('222');
  console.log('٥) عضو بدون الرول →', r.ok, '|', r.reason);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_role');
  console.log('   رسالة الشرح:', access.explain(r));

  // 6) ليس عضوًا في السيرفر
  installClient(fakeClient({ guilds: [{ id: 'g1', name: 'سيرفر Never Land', roles: [ROLE], members: [] }] }));
  r = await access.hasRequiredRole('333');
  console.log('٦) غير عضو بالسيرفر →', r.reason);
  assert.strictEqual(r.reason, 'not_member');

  // 7) الكاش في الجلسة
  installClient(fakeClient({ guilds: [{ id: 'g1', name: 'سيرفر', roles: [ROLE], members: [{ id: '111', roles: [ROLE] }] }] }));
  const session = {};
  const a1 = await access.checkAccess(session, '111');
  const a2 = await access.checkAccess(session, '111');
  console.log('٧) الكاش: أول مرة', a1.cached, '| ثاني مرة', a2.cached);
  assert.strictEqual(a2.cached, true);

  // 8) مالك السيرفر يدخل دائمًا (حتى بلا الرول)
  installClient(fakeClient({ guilds: [{ id: 'g1', name: 'سيرفر Never Land', ownerId: '444', roles: [ROLE], members: [{ id: '444', roles: [] }] }] }));
  r = await access.hasRequiredRole('444');
  console.log('٨) مالك السيرفر بلا الرول →', r.ok, '|', r.reason);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'owner');

  // 9) صاحب صلاحية «إدارة السيرفر» يدخل دائمًا
  installClient(fakeClient({ guilds: [{ id: 'g1', name: 'سيرفر Never Land', ownerId: '999', roles: [ROLE], members: [{ id: '555', roles: [], perms: ['ManageGuild'] }] }] }));
  r = await access.hasRequiredRole('555');
  console.log('٩) صلاحية إدارة السيرفر →', r.ok, '|', r.reason);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'manage_guild');

  // 10) عضو عادي بلا رول ولا صلاحية → ممنوع كما هو مطلوب
  installClient(fakeClient({ guilds: [{ id: 'g1', name: 'سيرفر Never Land', ownerId: '999', roles: [ROLE], members: [{ id: '666', roles: [] }] }] }));
  r = await access.hasRequiredRole('666');
  console.log('١٠) عضو عادي بلا رول →', r.ok, '|', r.reason);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_role');

  // تنظيف
  delete require.cache[CLIENT_PATH];
  console.log('\n🎉 كل فحوص الوصول نجحت');
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
