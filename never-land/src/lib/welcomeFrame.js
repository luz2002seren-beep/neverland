'use strict';

/**
 * lib/welcomeFrame.js
 * -------------------------------------------------------------
 * 🖼️ بطاقة الترحيب بإطار Never Land:
 *     الصورة اللي فيها الدائرة الفارغة (assets/welcome-frame.png)
 *     ويُرسم **أفتار العضو الجديد داخل الدائرة** — فتبان الصورة كاملة (إطار + أفتار).
 *
 * • كل شي في الصورة الأصلية يبقى كما هو (بلا قص ولا تغيير ألوان).
 * • الأفتار يُقص دائريًا وينرسم داخل الدائرة (نسبة من مقاس الصورة — فيشتغل مع أي مقاس).
 * • الخلفية تبقى شفافة (نفس شفافية الإطار) — الصورة تُرسل WebP شفاف (خفيف) أو PNG.
 * • لو الملف مفقود أو المكتبة غير متوفّرة ⇒ يرجّع null والبوت يكمّل بالصورة البديلة.
 *
 * -------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');

let CanvasLib = null;
try {
  CanvasLib = require('@napi-rs/canvas');
} catch {
  console.warn('[تنبيه] @napi-rs/canvas غير متوفّر — بطاقة إطار الترحيب ما تشتغل (نستخدم البديل).');
}

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_FRAME = 'assets/welcome-frame.png';

/** مكان دائرة الأفتار داخل الإطار (نسب من عرض/ارتفاع الصورة — مقيسة من الصورة نفسها) */
/* ملاحظة: cx نسبة من العرض · cy و r نسب من الارتفاع — نفس ما يستعمله الرسم أدناه */
const DEFAULT_ROI = { cx: 0.36322, cy: 0.55215, r: 0.20469 };

/** تخزين مؤقت للصورة الأساسية (نقرأها من القرص مرة واحدة) */
const cache = { path: null, image: null, width: 0, height: 0 };

/** حل مسار الإطار (محلي أو رابط) */
function resolvePath(value) {
  const raw = String(value || DEFAULT_FRAME).trim() || DEFAULT_FRAME;
  if (/^https?:\/\//i.test(raw)) return { url: raw };
  const full = path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return fs.existsSync(full) ? { file: full } : null;
}

/** هل بطاقة الإطار جاهزة للاستخدام؟ */
function available(value = DEFAULT_FRAME) {
  return Boolean(CanvasLib) && Boolean(resolvePath(value));
}

/** يقرأ صورة الإطار (مع تخزين مؤقت) */
async function loadFrame(value) {
  const resolved = resolvePath(value);
  if (!resolved || !CanvasLib) return null;
  const key = resolved.file || resolved.url;
  if (cache.path === key && cache.image) return cache;

  const image = await CanvasLib.loadImage(resolved.file || resolved.url).catch(() => null);
  if (!image) {
    if (cache.path === key) Object.assign(cache, { path: null, image: null });
    return null;
  }
  Object.assign(cache, { path: key, image, width: image.width, height: image.height });
  return cache;
}

/**
 * يقرأ الأفتار من الشبكة (ديسكورد) — يرجّع صورة canvas أو null.
 * @param {string|null} url
 */
async function loadAvatar(url) {
  if (!url || !CanvasLib) return null;
  return CanvasLib.loadImage(url).catch(() => null);
}

/**
 * 🖼️ يبني بطاقة الترحيب: الإطار + أفتار العضو داخل الدائرة.
 * @param {object} opts
 * @param {string} opts.avatarUrl رابط أفتار العضو (512)
 * @param {string} [opts.frame] مسار الإطار (افتراضي: assets/welcome-frame.png)
 * @param {{cx:number,cy:number,r:number}} [opts.roi] مكان الدائرة (نسب)
 * @param {'webp'|'png'} [opts.format] صيغة الإخراج (افتراضي webp شفاف وخفيف)
 * @param {number} [opts.scale] تكبير/تصغير الإخراج والإطار معه (افتراضي 1 = نفس مقاس الإطار)
 *   ملاحظة: التكبير يكبّر الإطار والأفتار والدائرة بنفس النسبة — بلا أي قص للحواف.
 * @returns {Promise<{buffer:Buffer, name:string}|null>}
 */
async function generate({ avatarUrl = null, frame = DEFAULT_FRAME, roi = null, format = 'webp', scale = 1 } = {}) {
  if (!CanvasLib) return null;

  const base = await loadFrame(frame);
  if (!base || !base.image) return null;

  const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const W = Math.max(320, Math.round(base.width * ratio));
  const H = Math.max(200, Math.round(base.height * ratio));
  const area = { ...DEFAULT_ROI, ...(roi || {}) };

  const canvas = CanvasLib.createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  /* ١) الإطار كامل (بشفافيته) — بجودة عالية عند التكبير/التصغير */
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(base.image, 0, 0, W, H);

  /* ٢) أفتار العضو داخل الدائرة */
  const avatar = await loadAvatar(avatarUrl);
  if (avatar) {
    const cx = area.cx * W;
    const cy = area.cy * H;
    const radius = area.r * H;

    ctx.save();
    /* قص دائري + رسم الأفتار (يغطّي الدائرة كاملة بلا تشويه) */
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const side = Math.max(avatar.width || 1, avatar.height || 1);
    const scaleAvatar = (radius * 2) / side;
    const dw = (avatar.width || side) * scaleAvatar;
    const dh = (avatar.height || side) * scaleAvatar;
    ctx.drawImage(avatar, cx - dw / 2, cy - dh / 2, dw, dh);

    /* تدرّج خفيف من الأسفل (يخلي الأفتار متناسق مع جو الصورة) */
    const shade = ctx.createLinearGradient(0, cy + radius * 0.1, 0, cy + radius);
    shade.addColorStop(0, 'rgba(20,10,50,0)');
    shade.addColorStop(1, 'rgba(20,10,50,0.45)');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();

    /* حلقة بنفسجية رفيعة على حدود الدائرة (تدمج الأفتار مع الإطار) */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.995, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, radius * 0.02);
    ctx.strokeStyle = 'rgba(170,140,255,0.55)';
    ctx.stroke();
    ctx.restore();
  }

  /* ٣) الإخراج (وبشفافية محفوظة) */
  if (format === 'png') {
    return { buffer: canvas.toBuffer('image/png'), name: 'welcome.png' };
  }
  try {
    return { buffer: canvas.toBuffer('image/webp', 92), name: 'welcome.webp' };
  } catch {
    return { buffer: canvas.toBuffer('image/png'), name: 'welcome.png' };
  }
}

module.exports = { generate, available, DEFAULT_FRAME, DEFAULT_ROI, resolvePath };
