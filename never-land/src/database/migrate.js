'use strict';

/**
 * database/migrate.js
 * -------------------------------------------------------------
 * ترقية إعدادات السيرفرات المحفوظة عند تغيّر نموذج الإعدادات.
 *
 * المستخدم في كلا المشغّلين (SQLite و JSON) بعد دمج الإعدادات،
 * فالسيرفرات القديمة تنتقل للنموذج الجديد بلا أي تدخّل يدوي.
 *
 * الترقيات:
 *   • النسخة ٢ (نظام التفاعل بالأحرف):
 *       - الكولداون القديم (٦٠ ثانية = القيمة الافتراضية للسابق) → صفر،
 *         لأن النموذج الجديد يحسب الخبرة بالأحرف والحماية الذكية تكفي.
 *       - إضافة حقول النموذج الجديد من الإعدادات الافتراضية تلقائيًا.
 * -------------------------------------------------------------
 */

const LEVELING_SETTINGS_VERSION = 2;

/** مفاتيح نموذج الخبرة القديم (قبل نظام الأحرف) — وجودها يعني إعدادات قديمة محفوظة */
const LEGACY_KEYS = ['minXp', 'maxXp', 'voiceMinXp', 'voiceMaxXp'];

/** الكولداون الافتراضي في النموذج القديم (يُعتبر قيمة افتراضية لا اختيارًا) */
const LEGACY_DEFAULT_COOLDOWN = 60;

/** كولداون الأوامر القديم (3 ثواني) — صار مشيل، فالقيمة الافتراضية القديمة ترجع صفر */
const LEGACY_TEXT_COOLDOWN = 3;

/**
 * ترقية إعدادات سيرفر واحد (تعديل في المكان).
 * الفحص يعتمد على وجود مفاتيح النموذج القديم نفسها — لا على رقم إصدار محفوظ،
 * لأن الإصدار قد يُكتب في الإعدادات قبل أن تُنفَّذ الترقية (القراءة تدمج الافتراضيات ثم الكتابة تحفظها).
 * @param {object} settings الإعدادات بعد الدمج مع الافتراضيات
 * @returns {object} نفس الكائن بعد الترقية
 */
function migrateSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;

  migrateTextCommands(settings);

  const leveling = settings.leveling;
  if (!leveling || typeof leveling !== 'object') return settings;

  const hasLegacyModel = LEGACY_KEYS.some((key) => key in leveling);

  if (hasLegacyModel) {
    /* النموذج الجديد: بلا كولداون — الحماية الذكية من السبام هي التي تنظّم */
    if (Number(leveling.cooldownSeconds) === LEGACY_DEFAULT_COOLDOWN) leveling.cooldownSeconds = 0;
    /* نشيل حقول النموذج القديم حتى ما تبقى مخزّنة */
    for (const key of LEGACY_KEYS) delete leveling[key];
    leveling.settingsVersion = LEVELING_SETTINGS_VERSION;
  }

  return settings;
}

/**
 * الكولداون مشيل من الأوامر (سلاش + بلا بريفيكست):
 * أي قيمة محفوظة تساوي الافتراضي القديم (3) ترجع صفر حتى ما ينتظر أحد.
 * @param {object} settings إعدادات السيرفر
 */
function migrateTextCommands(settings) {
  const tc = settings?.textCommands;
  if (!tc || typeof tc !== 'object') return settings;

  if (Number(tc.cooldownSeconds) === LEGACY_TEXT_COOLDOWN) tc.cooldownSeconds = 0;
  if (tc.perCommand && typeof tc.perCommand === 'object') {
    for (const [name, value] of Object.entries(tc.perCommand)) {
      if (Number(value) === LEGACY_TEXT_COOLDOWN) tc.perCommand[name] = 0;
    }
  }
  return settings;
}

module.exports = { migrateSettings, migrateTextCommands, LEVELING_SETTINGS_VERSION, LEGACY_TEXT_COOLDOWN };
