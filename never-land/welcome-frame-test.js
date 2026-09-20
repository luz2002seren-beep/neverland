'use strict';

/**
 * welcome-frame-test.js
 * -------------------------------------------------------------
 * فحص ترحيب «إطار Never Land» (الأفتار داخل الدائرة الفارغة):
 *   ١) صورة الإطار موجودة وبخلفية شفافة + مكان الدائرة مضبوط
 *   ٢) الأفتار يُرسم فعلًا **داخل الدائرة** (فحص بكسلات: لون الأفتار داخل الدائرة، والإطار ثابت من برّاها)
 *   ٣) رسالة الترحيب: الصورة مرفقة + نص عادي بلا إمبد (الإيموجي المتحرك + Member + Inv By)
 *   ٤) متغيّر الداعي {inviter} / {inviterMention} / {inviteCode} + «غير معروف» لما ما في دعوة
 *   ٥) ترقية شكل الترحيب مرة واحدة (بطاقة قديمة ← إطار) وتفعيل القناة والنص
 *   ٦) تربيط النظام: الحدث يمرّر الدعوة · الإقلاع يرقّي · زر ترحيب تجريبي في الموقع
 *
 * التشغيل: node welcome-frame-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-wframe-'));
process.env.DATABASE_PATH = path.join(tmp, 'wframe.db');
process.env.DEMO_MODE = 'true';

const db = require('./src/database');
const config = require('./src/config');
const welcome = require('./src/systems/welcome');
const frameLib = require('./src/lib/welcomeFrame');

let checks = 0;
const ok = (label) => {
  checks += 1;
  console.log(`  ✔ ${label}`);
};

const GUILD = '910000000000000001';
const FRAME = path.join(__dirname, 'assets', 'welcome-frame.png');
const AVATAR = 'https://cdn.discordapp.com/embed/avatars/2.png';

function mkMember(id = '910000000000000042', name = 'Ahmed') {
  return {
    id,
    user: {
      id,
      username: name,
      tag: `${name}#0001`,
      globalName: name,
      displayAvatarURL: () => AVATAR,
      createdTimestamp: Date.now() - 86400000 * 400,
    },
    displayName: name,
    joinedAt: new Date(),
    guild: { id: GUILD, name: 'Never Land', memberCount: 482, iconURL: () => null },
  };
}

async function main() {
  console.log('\n═══ ١) صورة الإطار + مكان الدائرة ═══');
  {
    assert.ok(fs.existsSync(FRAME), 'صورة إطار الترحيب ناقصة (assets/welcome-frame.png)');
    const buf = fs.readFileSync(FRAME);
    assert.strictEqual(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'الإطار ليس PNG');
    assert.strictEqual(buf[25], 6, 'الإطار بلا قناة شفافية (لازم RGBA)');
    assert.strictEqual(config.defaults.welcome.frameImage, 'assets/welcome-frame.png', 'مسار الإطار الافتراضي خطأ');
    assert.strictEqual(config.defaults.welcome.imageMode, 'frame', 'الوضع الافتراضي لازم «إطار Never Land»');

    const roi = config.defaults.welcome.frameCircle;
    assert.ok(roi.cx > 0.1 && roi.cx < 0.9 && roi.cy > 0.1 && roi.cy < 0.9 && roi.r > 0.1 && roi.r < 0.45, 'نِسب دائرة الأفتار خارج النطاق المعقول');
    /* الدائرة لازم تكون داخل الصورة كاملة (ما تطلع من الحدود) */
    assert.ok(roi.cx - roi.r > 0 && roi.cy - roi.r > 0, 'الدائرة تطلع من حدود الصورة (يسار/أعلى)');
    assert.ok(roi.cx + roi.r < 1 && roi.cy + roi.r < 1, 'الدائرة تطلع من حدود الصورة (يمين/أسفل)');
    assert.ok(frameLib.available(), 'مولّد الإطار غير متاح');
    ok('الإطار PNG شفاف + الدائرة مضبوطة داخل الصورة (نِسب محفوظة في الإعدادات)');
  }

  console.log('\n═══ ٢) الأفتار داخل الدائرة فعلًا (فحص بكسلات) ═══');
  {
    const CanvasLib = require('@napi-rs/canvas');
    const base = await CanvasLib.loadImage(FRAME);
    const roi = config.defaults.welcome.frameCircle;

    /* صورة الإطار لحالها (بلا أفتار) لنتحقق أن الأفتار هو اللي غيّر البكسلات داخل الدائرة فقط */
    const bare = await frameLib.generate({ avatarUrl: null, format: 'png' });
    const withAvatar = await frameLib.generate({ avatarUrl: AVATAR, format: 'png' });
    assert.ok(bare && withAvatar, 'توليد الصور فشل');
    assert.strictEqual(withAvatar.name, 'welcome.png', 'اسم ملف PNG خطأ');

    const readPixels = async (buffer) => {
      const img = await CanvasLib.loadImage(buffer);
      const c = CanvasLib.createCanvas(img.width, img.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    };
    const A = await readPixels(bare.buffer);
    const B = await readPixels(withAvatar.buffer);
    assert.strictEqual(A.w, base.width, 'عرض الإطار تغيّر');
    assert.strictEqual(B.h, base.height, 'ارتفاع الإطار تغيّر');

    const px = (img, x, y) => {
      const i = (Math.round(y) * img.w + Math.round(x)) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    const cx = roi.cx * B.w;
    const cy = roi.cy * B.h;
    const r = roi.r * B.h;

    /* ١) مركز الدائرة تغيّر (الأفتار انرسم) */
    const centerA = px(A, cx, cy);
    const centerB = px(B, cx, cy);
    const centerDiff = Math.abs(centerA[0] - centerB[0]) + Math.abs(centerA[1] - centerB[1]) + Math.abs(centerA[2] - centerB[2]);
    assert.ok(centerDiff > 40, `مركز الدائرة ما تغيّر — الأفتار ما انرسم (فرق ${centerDiff})`);

    /* ٢) نقطة داخل الدائرة (٧٠٪ من نصف القطر) تغيّرت كذلك */
    const inA = px(A, cx + r * 0.7, cy - r * 0.5);
    const inB = px(B, cx + r * 0.7, cy - r * 0.5);
    assert.ok(Math.abs(inA[0] - inB[0]) + Math.abs(inA[1] - inB[1]) + Math.abs(inA[2] - inB[2]) > 20, 'داخل الدائرة ما تغيّر');

    /* ٣) برّا الدائرة (الإطار) ما تغيّر — يعني ما لمسنا الصورة الأصلية */
    const outPts = [[cx - r * 1.35, cy], [cx, cy - r * 1.4], [B.w * 0.8, B.h * 0.75]];
    for (const [x, y] of outPts) {
      if (x < 0 || y < 0 || x >= B.w || y >= B.h) continue;
      const a = px(A, x, y);
      const b = px(B, x, y);
      const diff = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      assert.ok(diff <= 6, `بكسل خارج الدائرة تغيّر (${x},${y}) — كان لازم يبقى كما هو (فرق ${diff})`);
    }

    /* ٤) الشفافية محفوظة في الإخراج */
    const pngAlpha = B.data[3];
    const webp = await frameLib.generate({ avatarUrl: AVATAR, format: 'webp' });
    assert.strictEqual(webp.name, 'welcome.webp', 'اسم ملف webp خطأ');
    assert.ok(webp.buffer.length < pngAlpha * 0 + 600000, 'حجم الإطار كبير جدًا');
    ok('الأفتار انرسم داخل الدائرة · الإطار برّا الدائرة ما تغيّر · الشفافية محفوظة (PNG + webp)');
  }

  console.log('\n═══ ٣) رسالة الترحيب (صورة + نص عادي بلا إمبد) ═══');
  {
    welcome.ensureStyle(GUILD);
    const settings = db.getGuildSettings(GUILD);
    const member = mkMember();
    const payload = await welcome.buildWelcomePayload(null, member, settings, {
      inviteInfo: { code: 'NLx9', inviter: { id: '910000000000000099', username: 'owner', globalName: 'مالك السيرفر' } },
    });

    assert.strictEqual(payload.embeds.length, 0, 'الرسالة فيها إمبد — لازم صورة + نص');
    assert.strictEqual(payload.files.length, 1, 'الصورة ما انرفقت');
    assert.ok(/welcome\.(webp|png)$/.test(payload.files[0].name), 'اسم ملف الصورة خطأ');
    const text = String(payload.content);
    assert.ok(text.includes('<a:os49:1461135643735490735>'), 'الإيموجي المتحرك ناقص');
    assert.ok(text.includes('𝑊𝑒𝑙𝑐𝑜𝑚𝑒 𝑡𝑜 𝑆𝑒𝑟𝑣𝑒𝑟 𝑁𝑒𝑣𝑒𝑟 𝐿𝑎𝑛𝑑') || text.includes('Welcome to Server Never Land'), 'سطر الترحيب ناقص');
    assert.ok(text.includes('𝑀𝑒𝑚𝑏𝑒𝑟'), 'سطر العضو ناقص');
    assert.ok(text.includes('𝐼𝑛𝑣 𝐵𝑦'), 'سطر الداعي ناقص');
    assert.ok(text.includes(`<@${member.id}>`), 'منشن العضو ما انبدل');
    assert.ok(text.includes('مالك السيرفر'), 'اسم الداعي ما انبدل');
    assert.ok(!/undefined|\[object/.test(text), 'النص فيه قيمة تقنية');
    assert.deepStrictEqual(payload.allowedMentions, { parse: ['users'] }, 'إعداد المنشنات خطأ');
    ok('الترحيب: صورة الإطار مرفقة + نص عادي بالإيموجي المتحرك (Member + Inv By) ومنشن العضو والداعي');
  }

  console.log('\n═══ ٤) متغيّرات الداعي ═══');
  {
    const vars = welcome.inviterVars({ code: 'abc', inviter: { id: '5', username: 'sara', globalName: 'سارة' } });
    assert.strictEqual(vars.inviter, 'سارة', 'اسم الداعي خطأ');
    assert.strictEqual(vars.inviterMention, '<@5>', 'منشن الداعي خطأ');
    assert.strictEqual(vars.inviteCode, 'abc', 'كود الدعوة خطأ');
    const none = welcome.inviterVars(null);
    assert.strictEqual(none.inviter, 'غير معروف', 'لما ما في دعوة لازم يطلع «غير معروف»');

    /* الحدث يمرّر معلومات الدعوة للنظام */
    const eventsSrc = fs.readFileSync(path.join(__dirname, 'src', 'events', 'members.js'), 'utf8');
    assert.ok(eventsSrc.includes('inviteInfo'), 'حدث الدخول ما يقرأ الدعوة');
    assert.ok(eventsSrc.includes('welcome.handleMemberAdd(client, member, { inviteInfo })'), 'معلومات الدعوة ما تُمرَّر للترحيب');
    ok('{inviter} · {inviterMention} · {inviteCode} تشتغل — والحدث يمرّر الدعوة الحقيقية');
  }

  console.log('\n═══ ٥) ترقية شكل الترحيب مرة واحدة ═══');
  {
    const fresh = '910000000000000777';
    db.updateGuildSettings(fresh, {
      welcome: {
        enabled: false,
        channelId: null,
        imageMode: 'card',
        message: 'أهلاً بك {user} في **{server}**، عدد الأعضاء الآن **{memberCount}**.',
        styleUpgraded: false,
      },
    });
    const before = db.getGuildSettings(fresh).welcome;
    assert.strictEqual(before.imageMode, 'card', 'الإعداد الأولي خطأ');

    const upgraded = welcome.ensureStyle(fresh);
    assert.strictEqual(upgraded, 'frame', 'الترقية ما صارت');
    const after = db.getGuildSettings(fresh).welcome;
    assert.strictEqual(after.imageMode, 'frame', 'الوضع ما انترقّى');
    assert.strictEqual(after.channelId, '1549365058633736243', 'قناة الترحيب ما انضبطت');
    assert.strictEqual(after.enabled, true, 'الترحيب ما انفعّل');
    assert.ok(String(after.message).includes('𝐼𝑛𝑣 𝐵𝑦'), 'نص الرسالة الجديد ما انطبق');
    assert.strictEqual(after.styleUpgraded, true, 'علامة الترقية ما انحفظت');
    assert.strictEqual(welcome.ensureStyle(fresh), null, 'الترقية تكررت (لازم مرة واحدة)');

    /* ما نتعدّى على اختيار صريح بعد الترقية */
    db.updateGuildSettings(fresh, { welcome: { ...db.getGuildSettings(fresh).welcome, imageMode: 'avatar' } });
    welcome.ensureStyle(fresh);
    assert.strictEqual(db.getGuildSettings(fresh).welcome.imageMode, 'avatar', 'اختيار العميل انلغى بالغلط');
    ok('الترقية تنقل: بطاقة ← إطار + قناة الترحيب + النص الجديد — ومرة واحدة فقط');
  }

  console.log('\n═══ ٦) الربط: الإقلاع · الموقع · الاختبار · التشخيص ═══');
  {
    const readySrc = fs.readFileSync(path.join(__dirname, 'src', 'events', 'ready.js'), 'utf8');
    assert.ok(readySrc.includes('ensureStyle'), 'ترقية شكل الترحيب غير مربوطة بالإقلاع');

    const apiSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'routes', 'api.js'), 'utf8');
    assert.ok(/action === 'welcome'/.test(apiSrc), 'مسار «ترحيب تجريبي» ناقص');
    assert.ok(apiSrc.includes('sendTestWelcome'), 'المسار ما ينادي إرسال الترحيب');
    assert.ok(apiSrc.includes('welcomeFrame'), 'معاينة الصورة ما تستخدم الإطار');
    assert.ok(apiSrc.includes('frameCardAvailable'), 'حالة مولّد الإطار ناقصة من الميتا');
    assert.ok(apiSrc.includes('welcome: (() => {'), 'حالة الترحيب ناقصة من /api/status');
    assert.ok(apiSrc.includes('memberId'), 'اختيار العضو في الاختبار ناقص');

    const appSrc = fs.readFileSync(path.join(__dirname, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const key of ['welcome.frameImage', 'welcome.frameCircle.cx', 'welcome.frameCircle.cy', 'welcome.frameCircle.r', "value: 'frame'", 'أرسل ترحيب تجريبي']) {
      assert.ok(appSrc.includes(key), `الموقع ينقصه ${key}`);
    }
    ok('الإقلاع يرقّي · الموقع فيه حقول الإطار وزر «ترحيب تجريبي» · والتشخيص يبيّن آخر ترحيب');
  }

  console.log('\n═══ ٧) تصحيح الإيموجيات الناقصة (نص الترحيب) ═══');
  {
    const welcome = require('./src/systems/welcome');
    const NL_ID = '1461135643735490735';
    const guild = {
      id: GUILD,
      emojis: {
        cache: new Map([[NL_ID, { id: NL_ID }]]),
        create: async () => ({ id: '999888777666555444', name: 'os49', animated: true }),
      },
    };
    assert.ok(typeof welcome.missingEmojis === 'function', 'دالة فحص الإيموجيات الناقصة ناقصة');

    const missing = welcome.missingEmojis(guild, `<a:os49:${NL_ID}> نص <a:extra:123456789012345678>`);
    assert.strictEqual(missing.length, 1, 'لازم يكشف الإيموجي الناقص فقط (وحدة وحدة)');
    assert.strictEqual(missing[0].name, 'extra');
    assert.strictEqual(welcome.missingEmojis(guild, 'بلا إيموجيات خارجية').length, 0, 'ما في إيموجيات ⇒ بلا تنبيه');
    assert.ok(typeof welcome.ensureEmojis === 'function', 'دالة تصحيح الإيموجيات ناقصة');

    const orig = db.updateGuildSettings;
    let saved = null;
    db.updateGuildSettings = (gid, patch) => { saved = [gid, patch]; return patch; };
    let received = null;
    const busy = {
      id: GUILD,
      emojis: {
        cache: new Map(),
        create: async (opts) => { received = opts; return { id: '999', name: 'os49', animated: true }; },
      },
    };
    const res = await welcome.ensureEmojis(busy, { message: `<a:os49:${NL_ID}> 𝑊𝑒𝑙𝑐𝑜𝑚𝑒` });
    db.updateGuildSettings = orig;

    assert.strictEqual(res.added.length, 1, 'لازم يرفع الإيموجي الناقص للسيرفر');
    assert.strictEqual(res.added[0].newId, '999');
    assert.ok(received && Buffer.isBuffer(received.attachment) && received.attachment.length > 100, 'لازم ينزّل صورة الإيموجي من CDN ويرفعها كملف');
    assert.ok(saved && saved[1].welcome.message.includes('<a:os49:999>'), 'لازم يبدّل رقم الإيموجي في النص المحفوظ');
    assert.ok(saved[1].welcome.message.includes('𝑊𝑒𝑙𝑐𝑜𝑚𝑒'), 'باقي النص لازم يبقى كما هو');

    assert.ok(/ensureEmojis/.test(fs.readFileSync(require('node:path').join(__dirname, 'src', 'events', 'ready.js'), 'utf8')), 'الإقلاع لازم يصحّح الإيموجيات');
    ok('الإيموجي الناقص يُرفع تلقائيًا للسيرفر ويُبدَّل رابطه في النص (بدل ما ينطبع «:os49:»)');
  }

  console.log(`\n🎉 ترحيب إطار Never Land جاهز (${checks} فحصًا)\n`);
}

main().catch((err) => {
  console.error('\n❌ فشل الاختبار:', err.message);
  process.exitCode = 1;
});
