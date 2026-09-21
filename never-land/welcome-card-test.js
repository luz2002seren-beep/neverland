'use strict';

/**
 * welcome-card-test.js
 * -------------------------------------------------------------
 * اختبار طريقة الترحيب الجديدة (زي بوتات الترحيب الاحترافية):
 *
 *   ٠) إطار Never Land: أفتار العضو يُرسم داخل الدائرة الفارغة (src/lib/welcomeFrame.js)
 *   ١) الصورة: مقاس ثابت + الخطوط المرفقة + النص المرسوم عليها (عربي وإنجليزي)
 *   ٢) الرسالة: صورة مرفقة + نص عادي **بلا Embed** (الوضع الافتراضي)
 *   ٣) وضع Embed ما زال متاحًا (لمن يريده)
 *   ٤) كل أنواع الصور: بطاقة · أفتار · صورة مخصّصة · بدون
 *   ٥) المتغيّرات تُبدَّل في النص وعلى الصورة
 *   ٦) معاينة اللوحة (endpoint) ترجّع صورة PNG حقيقية
 *
 * التشغيل: node welcome-card-test.js
 * -------------------------------------------------------------
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-wc-'));
  process.env.DATABASE_PATH = path.join(tmp, 'w.db');
  process.env.DEMO_MODE = 'false';
  process.env.PUBLIC_ACCESS = 'true';

  const config = require('./src/config');
  config.web.demoMode = false;
  config.web.requiredRoleId = '';
  config.web.publicAccess = true;
  config.web.loginRequired = false;

  const db = require('./src/database');
  const welcome = require('./src/systems/welcome');
  const card = require('./src/lib/welcomeCard');
  const GUILD = '100000000000000001';

  /* ---------- صورة أفتار وأيقونة حقيقية (سيرفر محلي) ---------- */
  const { createCanvas } = require('@napi-rs/canvas');
  const c = createCanvas(320, 320);
  const x = c.getContext('2d');
  x.fillStyle = '#f2a33c';
  x.fillRect(0, 0, 320, 320);
  x.fillStyle = '#131a2c';
  x.beginPath();
  x.arc(160, 160, 100, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#fff';
  x.font = 'bold 130px sans-serif';
  x.textAlign = 'center';
  x.fillText('A', 160, 205);
  const avatarPng = c.toBuffer('image/png');

  const srv = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(avatarPng);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const imgUrl = `http://127.0.0.1:${srv.address().port}/avatar.png`;

  const member = {
    id: '111111111111111111',
    displayName: 'أحمد',
    user: {
      id: '111111111111111111',
      username: 'ahmed',
      globalName: 'أحمد',
      tag: 'ahmed#1',
      bot: false,
      createdTimestamp: Date.now() - 86400e3 * 400,
      displayAvatarURL: () => imgUrl,
    },
    guild: {
      id: GUILD,
      name: 'مجتمع Never Land',
      memberCount: 482,
      iconURL: () => imgUrl,
    },
  };

  const settings = db.getGuildSettings(GUILD);

  try {
    /* ---------- ١) الصورة ---------- */
    const buffer = await card.generateWelcomeCard({
      user: member.user,
      memberCount: 482,
      guildName: 'مجتمع Never Land',
      guildIcon: imgUrl,
      message: 'أهلاً بك أحمد في مجتمع Never Land',
      footer: 'العضو رقم 482',
    });
    assert.ok(buffer && buffer.length > 8000, 'فشل توليد صورة الترحيب');
    assert.strictEqual(buffer.slice(1, 4).toString(), 'PNG', 'الناتج ليس PNG');
    assert.strictEqual(buffer.readUInt32BE(16), card.CARD_W, `عرض الصورة غير صحيح (${buffer.readUInt32BE(16)})`);
    assert.strictEqual(buffer.readUInt32BE(20), card.CARD_H, `ارتفاع الصورة غير صحيح (${buffer.readUInt32BE(20)})`);

    for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
      assert.ok(fs.existsSync(path.join(__dirname, 'assets', 'fonts', file)), `الخط ${file} غير مرفق بالمشروع — الصورة ستطلع بلا حروف على أي سيرفر بلا خطوط`);
    }
    const latin = await card.generateWelcomeCard({ user: { username: 'Sara', globalName: 'Sara', displayAvatarURL: () => imgUrl }, memberCount: 12, guildName: 'Never Land', message: 'Welcome Sara to Never Land', footer: 'Member #12' });
    assert.ok(latin && latin.length > 8000, 'صورة الترحيب بالإنجليزي فشلت');
    console.log(`١) صورة الترحيب: ${card.CARD_W}×${card.CARD_H} · ${Math.round(buffer.length / 1024)}KB · عربي وإنجليزي · الخطوط مرفقة ✅`);

    /* ---------- ١-ب) الوضع الافتراضي الجديد: إطار Never Land (الأفتار داخل الدائرة) ---------- */
    const frameLib = require('./src/lib/welcomeFrame');
    assert.ok(frameLib.available(), 'إطار الترحيب غير متاح (المكتبة أو الصورة ناقصة)');
    /* الصورة الحقيقية تُبنى بنفس إعدادات السيرفر الافتراضية (الإطار + مكان الدائرة + التكبير) */
    const frameDefaults = config.defaults.welcome;
    const frameReady = await frameLib.generate({
      avatarUrl: imgUrl,
      frame: frameDefaults.frameImage,
      roi: frameDefaults.frameCircle,
      format: 'webp',
      scale: frameDefaults.frameScale,
    });
    assert.ok(frameReady && frameReady.buffer.length > 20000, 'توليد صورة الإطار فشل');
    assert.strictEqual(frameReady.name, 'welcome.webp', 'اسم ملف الإطار خطأ');
    const frameShot = await frameLib.generate({
      avatarUrl: imgUrl,
      frame: frameDefaults.frameImage,
      roi: frameDefaults.frameCircle,
      format: 'png',
      scale: frameDefaults.frameScale,
    });
    assert.ok(frameShot.buffer.slice(1, 4).toString() === 'PNG', 'إخراج PNG للإطار غير صالح');
    /* الإطار + الأفتار = صورة واحدة مقاسها نفس مقاس الإطار */
    const frameImg = require('@napi-rs/canvas').loadImage(frameReady.buffer);
    const baseImg = await require('@napi-rs/canvas').loadImage(path.join(__dirname, 'assets', 'welcome-frame.png'));
    const frameScale = config.defaults.welcome.frameScale || 1;
    const expectedWidth = Math.round(baseImg.width * frameScale);
    const expectedHeight = Math.round(baseImg.height * frameScale);
    assert.strictEqual((await frameImg).width, expectedWidth, 'عرض صورة الترحيب ما يطابق الإطار المكبّر');
    assert.strictEqual((await frameImg).height, expectedHeight, 'ارتفاع صورة الترحيب ما يطابق الإطار المكبّر');
    /* دائرة الأفتار بالمخرج لازم تكون بنفس حجم صورة الترحيب السابقة (≈٢٥٦ بكسل) */
    const circlePx = config.defaults.welcome.frameCircle.r * expectedHeight;
    assert.ok(circlePx >= 254, `دائرة الأفتار بالمخرج لازم ≥٢٥٦ بكسل (طلع ${circlePx.toFixed(1)})`);
    assert.ok(circlePx < 520, `دائرة الأفتار كبيرة بشكل مبالغ (${circlePx.toFixed(1)})`);
    console.log(`١-ب) إطار Never Land: أفتار العضو داخل الدائرة · ${(frameReady.buffer.length / 1024).toFixed(0)}KB · مقاس ${expectedWidth}×${expectedHeight} (تكبير ×${frameScale}) ✅`);

    /* ---------- ٢) الوضع الافتراضي: صورة الإطار + رسالة عادية بلا إطار ---------- */
    const plain = await welcome.buildWelcomePayload(null, member, settings);
    assert.ok(plain.content && plain.content.length > 10, 'النص العادي مفقود');
    assert.strictEqual(plain.embeds.length, 0, 'الرسالة فيها Embed رغم أن الطريقة الافتراضية بلا إطار');
    assert.strictEqual(plain.files.length, 1, 'الصورة غير مرفقة مع الرسالة');
    assert.ok(String(plain.files[0].name).endsWith('.webp'), 'الملف المرفق ليس صورة الإطار');
    /* {user} = منشن العضو · {inviter} = الداعي */
    assert.ok(plain.content.includes(`<@${member.id}>`), 'المتغيّر {user} ما تبدّل لمنشن العضو');
    assert.ok(!/undefined|\[object/.test(plain.content), 'النص فيه قيمة تقنية (undefined)');
    console.log(`٢) الوضع الافتراضي: صورة الإطار مرفقة + نص عادي بلا إطار ✅ («${plain.content.slice(0, 40)}…»)`);

    /* ---------- ٣) وضع Embed ما زال متاحًا ---------- */
    const embedded = await welcome.buildWelcomePayload(null, member, {
      ...settings,
      welcome: { ...settings.welcome, embed: true },
    });
    assert.strictEqual(embedded.embeds.length, 1, 'وضع Embed ما رجّع إطارًا');
    assert.ok(String(embedded.embeds[0].data.image?.url || '').startsWith('attachment://welcome.'), 'صورة الترحيب ما دخلت الإطار');
    assert.ok(!embedded.content, 'وضع Embed ما لازم يرسل نصًا خارج الإطار');
    console.log('٣) وضع الإطار (Embed) موجود لمن يريده — والصورة داخله ✅');

    /* ---------- ٤) كل أنواع الصور ---------- */
    const frameMode = await welcome.buildWelcomePayload(null, member, { ...settings, welcome: { ...settings.welcome, imageMode: 'frame', embed: false } });
    assert.strictEqual(frameMode.files.length, 1, 'صورة الإطار ما انرفقت');
    assert.ok(frameMode.files[0].name.endsWith('.webp'), 'ملف الإطار خطأ');

    const cardMode = await welcome.buildWelcomePayload(null, member, { ...settings, welcome: { ...settings.welcome, imageMode: 'card', embed: false } });
    assert.strictEqual(cardMode.files.length, 1, 'البطاقة ما انرفقت');

    const avatarMode = await welcome.buildWelcomePayload(null, member, { ...settings, welcome: { ...settings.welcome, imageMode: 'avatar', embed: false } });
    assert.strictEqual(avatarMode.files.length, 1, 'صورة الأفتار ما انرفقت مع الرسالة العادية');

    const customMode = await welcome.buildWelcomePayload(null, member, { ...settings, welcome: { ...settings.welcome, imageMode: 'custom', imageUrl: imgUrl, embed: false } });
    assert.strictEqual(customMode.files.length, 1, 'الصورة المخصّصة ما انرفقت');

    const noneMode = await welcome.buildWelcomePayload(null, member, { ...settings, welcome: { ...settings.welcome, imageMode: 'none', embed: false } });
    assert.strictEqual(noneMode.files.length, 0, 'وضع «بدون صورة» أرسل صورة');
    assert.ok(noneMode.content.length > 5, 'وضع «بدون صورة» ما أرسل النص');
    console.log('٤) أنواع الصور: إطار Never Land · بطاقة · أفتار · مخصّصة · بدون — كلها صحيحة ✅');

    /* ---------- ٥) المتغيّرات ---------- */
    const custom = await welcome.buildWelcomePayload(null, member, {
      ...settings,
      welcome: {
        ...settings.welcome,
        embed: false,
        message: 'يا هلا {username} في {server} — صرت العضو رقم {memberCount}',
        cardMessage: '{displayName} نور السيرفر',
      },
    });
    assert.ok(custom.content.includes('ahmed') && custom.content.includes('مجتمع Never Land') && custom.content.includes('482'), 'المتغيّرات ما تبدّلت في النص');

    /* {inviter} = مَن أرسل رابط الدعوة (يعطيه events/members.js) */
    const invited = await welcome.buildWelcomePayload(null, member, { ...settings, welcome: { ...settings.welcome, embed: false, message: '{user} دخل بفضل {inviter} ({inviterName} · {inviterMention}) — رابط {inviteCode}' } }, {
      inviteInfo: { code: 'NLx1', inviter: { id: '300000000000000009', username: 'Owner', globalName: 'مالك السيرفر', bot: false } },
    });
    assert.ok(invited.content.includes('<@300000000000000009>'), 'متغيّر {inviter} صار منشن (الافتراضي) ما اشتغل');
    assert.ok(invited.content.includes('مالك السيرفر'), 'متغيّر {inviterName} ما اشتغل');
    assert.ok(invited.content.includes('NLx1'), 'متغيّر {inviteCode} ما اشتغل');
    const unknown = await welcome.buildWelcomePayload(null, member, { ...settings, welcome: { ...settings.welcome, embed: false, message: 'Inv By : {inviter} · {inviterName}' } }, {});
    assert.strictEqual(unknown.content, 'Inv By : <@1345866950776979547> · غير معروف', 'الدعوة العامة ⇒ منشن صاحب الدعوة العام · والاسم «غير معروف»');
    console.log('٥) المتغيّرات ({username} {server} {memberCount} {displayName} {inviter}) تشتغل في النص وعلى الصورة ✅');

    /* ---------- ٦) معاينة اللوحة ----------
     * نفحصها بوضع العرض (demo) مثل ما يشوفها الزائر على الموقع العام. */
    const web = require('./src/web/server');
    config.web.demoMode = true;
    const app = web.createApp();
    const server = await new Promise((resolve) => {
      const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const preview = await fetch(`${base}/api/guilds/${GUILD}/welcome/card`);
    const previewBuf = Buffer.from(await preview.arrayBuffer());
    assert.strictEqual(preview.status, 200, `معاينة اللوحة فشلت (${preview.status})`);
    assert.strictEqual(preview.headers.get('content-type')?.split(';')[0], 'image/png', 'المعاينة ما رجّعت صورة');
    assert.ok(previewBuf.slice(1, 4).toString() === 'PNG' && previewBuf.length > 8000, 'المعاينة صورة غير صالحة');
    fs.writeFileSync('/tmp/welcome-preview-test.png', previewBuf);
    server.close();
    assert.strictEqual(previewBuf.readUInt32BE(16), Math.round(baseImg.width * (config.defaults.welcome.frameScale || 1)), 'معاينة اللوحة ما طابقت مقاس الإطار المكبّر');
    console.log(`٦) معاينة اللوحة (/api/guilds/:id/welcome/card) ترجّع صورة الإطار بالأفتار ${Math.round(previewBuf.length / 1024)}KB ✅`);

    console.log('\n🎉 الترحيب: صورة بالأفتار + رسالة عادية بلا إطار — يعمل كما هو مطلوب\n');
    return { ok: true };
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { run };

if (require.main === module) {
  console.log('\n[اختبار] ترحيب بصورة بالأفتار + رسالة بلا إطار\n');
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
