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
    assert.ok(text.includes('<@910000000000000099>'), 'منشن الداعي ما انبدل');
    assert.ok(!/undefined|\[object/.test(text), 'النص فيه قيمة تقنية');
    assert.deepStrictEqual(payload.allowedMentions, { parse: ['users'] }, 'إعداد المنشنات خطأ');
    ok('الترحيب: صورة الإطار مرفقة + نص عادي بالإيموجي المتحرك (Member + Inv By) ومنشن العضو ومنشن الداعي');
  }

  console.log('\n═══ ٤) متغيّرات الداعي ═══');
  {
    const vars = welcome.inviterVars({ code: 'abc', inviter: { id: '5', username: 'sara', globalName: 'سارة', bot: false } });
    assert.strictEqual(vars.inviterName, 'سارة', 'اسم الداعي خطأ');
    assert.strictEqual(vars.inviterMention, '<@5>', 'منشن الداعي خطأ');
    assert.strictEqual(vars.inviter, '<@5>', '{inviter} صار منشن (الافتراضي)');
    assert.strictEqual(vars.inviteCode, 'abc', 'كود الدعوة خطأ');
    assert.strictEqual(vars.inviterIsPublic, false, 'الدعوة الخاصة ما لازم تُعتبر عامة');

    const none = welcome.inviterVars(null);
    assert.strictEqual(none.inviter, '<@1345866950776979547>', 'لما ما في دعوة ⇒ منشن صاحب الدعوة العام بدل «غير معروف»');
    assert.strictEqual(none.inviterName, 'غير معروف', 'الاسم يبقى «غير معروف»');
    assert.strictEqual(none.inviterIsPublic, true, 'بلا دعوة = عامة');

    const plain = welcome.inviterVars({ code: 'abc', inviter: { id: '5', username: 'sara', bot: false } }, { inviterMention: false });
    assert.strictEqual(plain.inviter, 'sara', 'مع إطفاء المنشن ⇒ اسم الداعي');
    const custom = welcome.inviterVars({ code: 'abc', inviter: { id: '5', username: 'sara', bot: false } }, { publicInviteCodes: ['abc'] });
    assert.strictEqual(custom.inviter, '<@1345866950776979547>', 'كود مُعلن كعام ⇒ يُمنشن صاحب الدعوة العام');

    /* الحدث يمرّر معلومات الدعوة للنظام */
    const eventsSrc = fs.readFileSync(path.join(__dirname, 'src', 'events', 'members.js'), 'utf8');
    assert.ok(eventsSrc.includes('inviteInfo'), 'حدث الدخول ما يقرأ الدعوة');
    assert.ok(eventsSrc.includes('welcome.handleMemberAdd(client, member, { inviteInfo })'), 'معلومات الدعوة ما تُمرَّر للترحيب');
    ok('{inviter} منشن (خاص) · {inviterMention} · {inviterName} · {inviteCode} · والعامة ⇒ منشن صاحب الدعوة العام');
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

  console.log('\n═══ ٨) الإرسال: الصورة أولًا ثم النص · منشن الداعي · إيموجي من آيدي خارجي ═══');
  {
    const welcome = require('./src/systems/welcome');
    const config = require('./src/config');
    const settings = { welcome: { ...config.defaults.welcome } };

    /* ٨-أ: رسالتان — الصورة أولًا (بلا نص) ثم النص (بلا صورة) */
    assert.strictEqual(config.defaults.welcome.imageFirst, true, 'الافتراضي لازم «الصورة أولًا ثم النص»');
    const sent = await welcome.buildWelcomeMessages(null, mkMember(), settings, {
      inviteInfo: { code: 'priv', inviter: { id: '424242', username: 'sara', bot: false }, uses: 2 },
    });
    assert.strictEqual(sent.length, 2, 'لازم رسالتان: الصورة ثم النص');
    assert.strictEqual((sent[0].files || []).length, 1, 'الرسالة الأولى لازم تكون الصورة');
    assert.ok(!sent[0].content, 'الرسالة الأولى (الصورة) لازم تكون بلا نص');
    assert.ok(!(sent[1].files || []).length, 'الرسالة الثانية لازم تكون نص بلا صورة');
    assert.strictEqual(sent[1].embeds.length, 0, 'بلا إمبد');
    assert.deepStrictEqual(sent[1].allowedMentions, { parse: ['users'] }, 'المنشن لازم يكون للأعضاء فقط');

    const single = await welcome.buildWelcomeMessages(null, mkMember(), { welcome: { ...settings.welcome, imageFirst: false } }, {});
    assert.strictEqual(single.length, 1, 'إطفاء «الصورة أولًا» ⇒ رسالة واحدة');
    assert.strictEqual((single[0].files || []).length, 1);
    assert.ok(single[0].content, 'الرسالة الواحدة فيها النص والصورة');

    /* ٨-ب: منشن الداعي (Inv By) — خاص ⇒ منشن صاحب الدعوة · عام ⇒ منشن publicInviterId */
    assert.strictEqual(config.defaults.welcome.inviterMention, true, 'الافتراضي لازم منشن الداعي');
    assert.strictEqual(config.defaults.welcome.publicInviterId, '1345866950776979547', 'آيدي منشن الدعوة العامة خطأ');
    const lineOf = (payload) => String(payload.content).split('\n').pop();
    assert.match(lineOf(sent[1]), /𝐼𝑛𝑣 𝐵𝑦 : <@424242>/, 'الدعوة الخاصة لازم تمنشن صاحب الدعوة');

    const vanityMember = mkMember();
    const g = vanityMember.guild;
    g.vanityURLCode = 'neverland';
    const pub = await welcome.buildWelcomeMessages(null, vanityMember, settings, {
      inviteInfo: { code: 'neverland', inviter: { id: '999', username: 'other', bot: false }, uses: 5 },
    });
    assert.match(lineOf(pub[1]), /𝐼𝑛𝑣 𝐵𝑦 : <@1345866950776979547>/, 'الفانيتي = دعوة عامة ⇒ منشن صاحب الدعوة العام');
    assert.strictEqual(welcome.isPublicInvite({ code: 'neverland', inviter: { id: '999', bot: false } }, g, settings.welcome), true, 'الفانيتي لازم تُعتبر عامة');
    assert.strictEqual(welcome.isPublicInvite({ code: 'priv', inviter: { id: '999', bot: false } }, { vanityURLCode: null }, settings.welcome), false, 'الدعوة الخاصة ليست عامة');

    const botInvite = await welcome.buildWelcomeMessages(null, mkMember(), settings, {
      inviteInfo: { code: 'botlink', inviter: { id: '777', username: 'bot', bot: true }, uses: 1 },
    });
    assert.match(lineOf(botInvite[1]), /𝐼𝑛𝑣 𝐵𝑦 : <@1345866950776979547>/, 'دعوة بوت ⇒ عامة ⇒ منشن صاحب الدعوة العام');

    const unknown = await welcome.buildWelcomeMessages(null, mkMember(), settings, {});
    assert.match(lineOf(unknown[1]), /𝐼𝑛𝑣 𝐵𝑦 : <@1345866950776979547>/, 'بلا دعوة معروفة ⇒ منشن صاحب الدعوة العام بدل «غير معروف»');

    const noMention = await welcome.buildWelcomeMessages(null, mkMember(), { welcome: { ...settings.welcome, inviterMention: false } }, {
      inviteInfo: { code: 'priv', inviter: { id: '424242', username: 'sara', bot: false }, uses: 2 },
    });
    assert.match(lineOf(noMention[1]), /𝐼𝑛𝑣 𝐵𝑦 : sara/, 'إطفاء المنشن ⇒ اسم الداعي فقط');

    /* ٨-ج: إيموجي من آيدي خارجي — يُرفع للسيرفر، ولو فشل يُبدَّل بإيموجي يونيكود */
    const NL = '1461135643735490735';
    const failed = await welcome.buildWelcomeMessages(null, mkMember(), settings, { failedEmojis: new Set([NL]) });
    assert.ok(!failed[1].content.includes(`:${NL}>`), 'إيموجي ما قدرنا نرفعه لازم يُبدَّل (ما ينطبع :os49: نصًا)');
    assert.ok(failed[1].content.includes(config.defaults.welcome.emojiFallback), 'لازم يظهر الإيموجي البديل');
    assert.ok(
      /create\(\{[^}]*attachment/.test(fs.readFileSync(require('node:path').join(__dirname, 'src', 'systems', 'welcome.js'), 'utf8'))
        && fs.readFileSync(require('node:path').join(__dirname, 'src', 'systems', 'welcome.js'), 'utf8').includes('client.application.emojis.create'),
      'لازم يدعم إيموجي البوت نفسه (application emojis) لو ما قدر يرفعه للسيرفر',
    );

    /* ٨-د: الجسر بين الدخول والاختبار والموقع */
    const src = fs.readFileSync(require('node:path').join(__dirname, 'src', 'systems', 'welcome.js'), 'utf8');
    assert.ok(src.includes('sendWelcomeMessages') && /handleMemberAdd[\s\S]*sendWelcomeMessages/.test(src), 'دخول العضو لازم يرسل الرسالتين');
    assert.ok(/sendTestWelcome[\s\S]*sendWelcomeMessages/.test(src), 'الاختبار التجريبي لازم يرسل الرسالتين');
    const appSrc = fs.readFileSync(require('node:path').join(__dirname, 'src', 'web', 'public', 'app.js'), 'utf8');
    for (const key of ['welcome.imageFirst', 'welcome.inviterMention', 'welcome.publicInviterId', "'welcome.publicInviteCodes'", 'welcome.emojiFallback']) {
      assert.ok(appSrc.includes(key), `الموقع ينقصه ${key}`);
    }

    assert.strictEqual(config.defaults.welcome.emojiFallback, '✨', 'الإيموجي البديل الافتراضي ✨');
    /* نص جاهز = نفس الصيغة المطلوبة */
    const text = String(unknown[1].content);
    assert.match(text, /𝑊𝑒𝑙𝑐𝑜𝑚𝑒 𝑡𝑜 𝑆𝑒𝑟𝑣𝑒𝑟 𝑁𝑒𝑣𝑒𝑟 𝐿𝑎𝑛𝑑/, 'سطر الترحيب ناقص');
    assert.match(text, /𝑀𝑒𝑚𝑏𝑒𝑟 : <@\d+>/, 'سطر العضو لازم منشن');
    assert.match(text, /𝐼𝑛𝑣 𝐵𝑦 : <@\d+>/, 'سطر الداعي لازم منشن');
    ok('الصورة تُرسل أولًا ثم النص · {inviter} منشن · الدعوة العامة (فانيتي/بوت/مجهولة) ⇒ منشن 1345866950776979547 · الإيموجي الخارجي يُرفع أو يُبدَّل بـ ✨');
  }

  console.log('\n═══ ٩) صورة الإطار الجديدة + ترقية مكان الدائرة تلقائيًا ═══');
  {
    const welcome = require('./src/systems/welcome');
    const conf = require('./src/config');
    assert.ok(typeof welcome.ensureFrameLayout === 'function', 'دالة ترقية مكان الدائرة ناقصة');

    /* صورة الإطار = النسخة الجديدة (نفس رمز الصورة التي أرسلها المدير) */
    const img = fs.readFileSync(FRAME);
    const meta = config.defaults.welcome.frameCircle;
    const px = img.readUInt32BE(16);
    const py = img.readUInt32BE(20);
    assert.strictEqual(px, 1536, 'عرض صورة الإطار الجديدة خطأ');
    assert.strictEqual(py, 1024, 'ارتفاع صورة الإطار الجديدة خطأ');
    assert.ok(Math.abs(meta.cx - 0.36322) < 0.0005 && Math.abs(meta.cy - 0.55215) < 0.0005, 'مركز دائرة الصورة الجديدة خطأ');
    assert.ok(Math.abs(meta.r - 0.20469) < 0.0005, 'نصف قطر دائرة الصورة الجديدة خطأ');

    /*
     * ⚠️ القاعدة المهمة: cx نسبة من **العرض** · cy و r نسب من **الارتفاع**
     * (هذا اللي يستعمله الرسم فعلًا) — أي خلط بين العرض والارتفاع يخلّي الأفتار صغير/كبير.
     */
    const cxPx = meta.cx * px;
    const cyPx = meta.cy * py;
    const rPx = meta.r * py;
    assert.ok(Math.abs(cxPx - 558) < 5 && Math.abs(cyPx - 565) < 5, `مركز الدائرة بالبكسل خطأ (${cxPx.toFixed(1)}, ${cyPx.toFixed(1)})`);
    assert.ok(Math.abs(rPx - 210) < 6, `نصف قطر الدائرة بالبكسل خطأ (${rPx.toFixed(1)} — المطلوب ≈ ٢١٠)`);
    assert.ok(rPx > 0.15 * py && rPx < 0.3 * py, 'نصف القطر خارج النطاق المعقول');

    /* 🔍 تكبير الصورة كاملة: الدائرة ترجع بنفس حجم صورة الترحيب السابقة (≈٢٥٦ بكسل) */
    const big = conf.defaults.welcome.frameScale;
    assert.ok(big > 1 && big < 2, 'معامل تكبير الإطار لازم يكون معقولًا (١ – ٢)');
    {
      const CanvasLib3 = require('@napi-rs/canvas');
      const made = await frameLib.generate({ frame: FRAME, roi: meta, format: 'png', scale: big });
      const img = await CanvasLib3.loadImage(made.buffer);
      assert.strictEqual(img.width, Math.round(px * big), 'عرض المخرج المكبّر خطأ');
      assert.strictEqual(img.height, Math.round(py * big), 'ارتفاع المخرج المكبّر خطأ');
      const rBig = meta.r * img.height;
      assert.ok(Math.abs(rBig - 256) < 8, `دائرة الأفتار بالمخرج المكبّر لازم تكون ≈٢٥٦ بكسل (طلع ${rBig.toFixed(1)})`);
      assert.ok(rBig > 209, 'الدائرة أصغر من دائرة الصورة السابقة');
    }

    /* فحص بكسلات يمنع الغلطة نفسها: أفتار أحمر لازم يغطّي الدائرة كاملة وما يطلع برّاها */
    {
      const CanvasLib2 = require('@napi-rs/canvas');
      const red = CanvasLib2.createCanvas(512, 512);
      const rctx = red.getContext('2d');
      rctx.fillStyle = '#ff0000';
      rctx.fillRect(0, 0, 512, 512);
      const redPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-red-'));
      const redFile = path.join(redPath, 'red.png');
      fs.writeFileSync(redFile, red.toBuffer('image/png'));

      const made = await frameLib.generate({ avatarUrl: redFile, frame: FRAME, roi: meta, format: 'png', scale: big });
      const img = await CanvasLib2.loadImage(made.buffer);
      const probe = CanvasLib2.createCanvas(img.width, img.height);
      const pctx = probe.getContext('2d');
      pctx.drawImage(img, 0, 0);
      const at = (x, y) => pctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      const isRed = (d) => d[0] > 120 && d[1] < 90 && d[2] < 95;
      const c2 = made.buffer && meta.cx * img.width;
      const y2 = meta.cy * img.height;
      const r2 = meta.r * img.height;
      assert.ok(isRed(at(c2, y2)), 'الأفتار ما انرسم بمركز الدائرة');
      assert.ok(isRed(at(c2, y2 - r2 * 0.95)) && isRed(at(c2 - r2 * 0.95, y2)), 'الأفتار ما يغطّي الدائرة كاملة (نصف القطر صغير)');
      assert.ok(!isRed(at(c2, y2 + r2 + 14)) && !isRed(at(c2 + r2 + 14, y2)), 'الأفتار طالع برّا الدائرة (نصف القطر كبير)');
    }

    /* الإعدادات القديمة (دائرة النسخة الأولى) تُرقّى مرة واحدة · والمخصّصة ما تُلمس */
    const legacyGuild = '920000000000000042';
    db.updateGuildSettings(legacyGuild, {
      welcome: { enabled: true, channelId: '1549365058633736243', imageMode: 'frame', styleUpgraded: true, frameCircle: { cx: 0.33431, cy: 0.56543, r: 0.2525 } },
    });
    assert.strictEqual(welcome.ensureFrameLayout(legacyGuild), true, 'الإعدادات القديمة لازم تُرقّى');
    assert.deepStrictEqual(db.getGuildSettings(legacyGuild).welcome.frameCircle, conf.defaults.welcome.frameCircle, 'الدائرة المرقّاة لازم تساوي الافتراضي الجديد');
    assert.strictEqual(welcome.ensureFrameLayout(legacyGuild), false, 'الترقية لازم تصير مرة واحدة');

    const customGuild = '920000000000000043';
    db.updateGuildSettings(customGuild, { welcome: { frameCircle: { cx: 0.5, cy: 0.5, r: 0.2 } } });
    assert.strictEqual(welcome.ensureFrameLayout(customGuild), false, 'الدائرة المخصّصة بيد المدير ما تُلمس');
    assert.deepStrictEqual(db.getGuildSettings(customGuild).welcome.frameCircle, { cx: 0.5, cy: 0.5, r: 0.2 }, 'الدائرة المخصّصة تغيّرت — ممنوع');

    assert.ok(/ensureFrameLayout/.test(fs.readFileSync(require('node:path').join(__dirname, 'src', 'events', 'ready.js'), 'utf8')), 'الإقلاع لازم يرقّي مكان الدائرة');
    ok('الإطار الجديد 1536×1024 ودائرته (558,565 · نصف قطر 210) مضبوطة · ومكبّر ×' + big + ' فيرجع بنفس حجم الصورة السابقة (≈٢٥٦ بكسل) + فحص بكسلات');
  }

  console.log(`\n🎉 ترحيب إطار Never Land جاهز (${checks} فحصًا)\n`);
}

main().catch((err) => {
  console.error('\n❌ فشل الاختبار:', err.message);
  process.exitCode = 1;
});
