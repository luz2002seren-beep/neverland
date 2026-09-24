'use strict';

/**
 * guilds-test.js
 * -------------------------------------------------------------
 * اختبار مصدر «سيرفرات المستخدم» في الموقع:
 * المشكلة الأصلية: مستخدم داخل السيرفر (وعنده الرول المطلوب) كان يشوف «0 سيرفر».
 * الآن لازم يشوف سيرفره في كل الحالات الصحيحة، وما يشوف سيرفر ما إله علاقة فيه.
 *
 * التشغيل:  node guilds-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROLE = '1549364852433354792';
process.env.REQUIRED_ROLE_ID = ROLE;
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nl-guilds-')), 'guilds.db');

const config = require('../src/config');
const CLIENT_PATH = require.resolve('../src/client.js');

/** عضو وهمي (مع صلاحيات) */
function fakeMember({ id, roles = [], perms = [] }) {
  const set = new Set(perms);
  return {
    id,
    roles: { cache: new Map(roles.map((r) => [r, {}])) },
    permissions: { has: (flag) => set.has(String(flag)) },
  };
}

/** عميل وهمي فيه سيرفرات */
function fakeClient(guilds) {
  return {
    isReady: () => true,
    guilds: {
      cache: new Map(
        guilds.map((g) => [
          String(g.id),
          {
            id: String(g.id),
            name: g.name,
            ownerId: String(g.ownerId || '000'),
            memberCount: g.memberCount ?? 10,
            iconURL: () => null,
            members: {
              cache: new Map((g.members || []).map((m) => [String(m.id), fakeMember(m)])),
              fetch: async (id) => {
                const m = (g.members || []).find((x) => String(x.id) === String(id));
                if (!m) throw new Error('unknown member');
                return fakeMember(m);
              },
            },
          },
        ]),
      ),
      has: (id) => guilds.some((g) => String(g.id) === String(id)),
      get: (id) => {
        const g = guilds.find((x) => String(x.id) === String(id));
        return g ? { id: String(g.id), name: g.name, ownerId: String(g.ownerId || '000') } : undefined;
      },
    },
  };
}

function install(client) {
  require.cache[CLIENT_PATH] = { id: CLIENT_PATH, filename: CLIENT_PATH, loaded: true, exports: client };
}

const reqFor = ({ user = null, guilds = [] } = {}) => ({ session: { user, guilds }, method: 'GET' });

(async () => {
  const webGuilds = require('../src/web/guilds');
  const GUILD = '1542345715949506630';

  console.log('\n[اختبار] مصدر سيرفرات المستخدم في الموقع\n');

  // 0) وضع العرض
  config.web.demoMode = true;
  let list = await webGuilds.listUserGuilds(reqFor());
  assert.ok(list.length >= 1, 'وضع العرض يجب أن يعرض سيرفر العرض');
  console.log('٠) وضع العرض → عدد السيرفرات:', list.length, '✅');

  // من الآن: وضع حقيقي
  config.web.demoMode = false;
  config.web.demoData !== undefined;

  // 1) الرتبة وحدها ما تفتح السيرفر. الإضافة من المالك هي اللي تفتحه حتى بلا إدارة.
  const siteUsers = require('../src/web/siteUsers');
  install(fakeClient([{ id: GUILD, name: 'Never Land', ownerId: '999', members: [{ id: '777', roles: [ROLE] }] }]));
  list = await webGuilds.listUserGuilds(reqFor({ user: { id: '777', username: 'loki' }, guilds: [] }));
  console.log('١) عضو عنده الرول فقط (بلا إضافة) → عدد السيرفرات:', list.length);
  assert.strictEqual(list.length, 0, 'الرتبة وحدها ما تفتح لوحة السيرفر');
  install(fakeClient([{ id: GUILD, name: 'Never Land', ownerId: '999', members: [{ id: '777777777777777777', roles: [] }] }]));
  list = await webGuilds.listUserGuilds(reqFor({ user: { id: '777777777777777777' }, guilds: [] }));
  assert.strictEqual(list.length, 0, 'عضو بلا إضافة ما يشوف السيرفر');
  assert.strictEqual(siteUsers.grant('777777777777777777', { by: '1' }).ok, true);
  list = await webGuilds.listUserGuilds(reqFor({ user: { id: '777777777777777777' }, guilds: [] }));
  console.log('١ب) عضو أضافه المالك (بلا إدارة) → عدد السيرفرات:', list.length, list[0] ? `«${list[0].name}»` : '');
  assert.strictEqual(list.length, 1, 'لازم يشوف سيرفره بعد ما يضيفه المالك حتى لو ما عنده صلاحية إدارة');
  assert.strictEqual(list[0].botPresent, true);

  // 2) مالك السيرفر
  install(fakeClient([{ id: GUILD, name: 'Never Land', ownerId: '777', members: [{ id: '777', roles: [] }] }]));
  list = await webGuilds.listUserGuilds(reqFor({ user: { id: '777' }, guilds: [] }));
  console.log('٢) مالك السيرفر → عدد السيرفرات:', list.length);
  assert.strictEqual(list.length, 1, 'المالك لازم يشوف سيرفره');

  // 3) صاحب صلاحية إدارة السيرفر
  install(fakeClient([{ id: GUILD, name: 'Never Land', ownerId: '999', members: [{ id: '888', roles: [], perms: ['ManageGuild'] }] }]));
  list = await webGuilds.listUserGuilds(reqFor({ user: { id: '888' }, guilds: [] }));
  console.log('٣) صلاحية إدارة السيرفر → عدد السيرفرات:', list.length);
  assert.strictEqual(list.length, 1);

  // 4) عضو عادي بلا رول ولا صلاحية → ما يشوف شيء (وما يشوف سيرفر غيره)
  list = await webGuilds.listUserGuilds(reqFor({ user: { id: '555' }, guilds: [] }));
  console.log('٤) عضو عادي بلا صلاحية → عدد السيرفرات:', list.length, '(المتوقع 0)');
  assert.strictEqual(list.length, 0, 'ما لازم يشوف سيرفر ما إله صلاحية فيه');

  // 5) جلسة OAuth فيها سيرفر + سيرفر آخر من البوت → الاثنان بلا تكرار
  install(
    fakeClient([
      { id: GUILD, name: 'Never Land', ownerId: '999', members: [{ id: '777', roles: [ROLE] }] },
      { id: '222', name: 'سيرفر آخر', ownerId: '777', members: [{ id: '777', roles: [] }] },
    ]),
  );
  list = await webGuilds.listUserGuilds(reqFor({ user: { id: '777' }, guilds: [{ id: GUILD, name: 'قديم', icon: null, owner: false }] }));
  console.log('٥) دمّج الجلسة + البوت → عدد السيرفرات:', list.length, '| بلا تكرار:', new Set(list.map((g) => g.id)).size === list.length);
  assert.strictEqual(list.length, 2, 'لازم يظهر السيرفران بلا تكرار');
  assert.strictEqual(list.find((g) => g.id === GUILD).name, 'Never Land', 'اسم ديسكورد يُستخدم بدل الاسم القديم');

  // 6) canAccessGuild: عضو بلا إضافة ممنوع، وبعد الإضافة مسموح
  install(fakeClient([{ id: GUILD, name: 'Never Land', ownerId: '999', members: [{ id: '777777777777777777', roles: [] }] }]));
  assert.strictEqual(await webGuilds.canAccessGuild(reqFor({ user: { id: '555' }, guilds: [] }), GUILD), false);
  assert.strictEqual(await webGuilds.canAccessGuild(reqFor({ user: { id: '777777777777777777' }, guilds: [] }), GUILD), true);
  console.log('٦) فحص الوصول لسيرفر معيّن → عضو عادي: ممنوع | مضاف لقائمة الدخول: مسموح ✅');

  // 6ب) زائر مع الوصول العام: قائمة عامة من آخر مزامنة
  config.web.publicAccess = true;
  const guestList = await webGuilds.listUserGuilds(reqFor());
  console.log('٦ب) قائمة الزائر العامة → عدد السيرفرات:', guestList.length, guestList[0] ? `«${guestList[0].name}»` : '');
  assert.ok(Array.isArray(guestList), 'قائمة الزائر يجب أن تكون مصفوفة');

  // 7) زائر + الوصول العام: يقرأ سيرفر فيه البوت فقط
  config.web.publicAccess = true;
  assert.strictEqual(await webGuilds.canAccessGuild(reqFor(), GUILD), true, 'الزائر يقرأ سيرفر فيه البوت');
  assert.strictEqual(await webGuilds.canAccessGuild(reqFor(), '999999999999999999'), false, 'الزائر لا يقرأ سيرفر مجهول');
  console.log('٧) الزائر مع الوصول العام → يقرأ سيرفر البوت فقط ✅');

  delete require.cache[CLIENT_PATH];
  console.log('\n🎉 قائمة سيرفرات الموقع تعمل كما هو مطلوب\n');
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
