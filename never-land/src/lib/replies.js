'use strict';

/**
 * lib/replies.js
 * -------------------------------------------------------------
 * طبقة موحّدة لكل ردود البوت:
 *
 *   ١) الترجمة للإنجليزية — قاموس نصّي + قواعد للجُمل المتغيّرة (بدون لمس منطق الأوامر)
 *   ٢) الخط المزخرف (𝑪𝒉𝒂𝒕 = Mathematical Bold Italic) مع حماية المنشنات والروابط
 *      والأكواد والإيموجيات الخارجية حتى ما تتكسر أبدًا
 *   ٣) تطبيق تلقائي على كل رد: embeds + محتوى الرسالة + أزرار/قوائم (ترجمة فقط)
 *
 * كل شي قابل للإطفاء من لوحة التحكم: settings.replies.english / settings.replies.fancyFont
 * -------------------------------------------------------------
 */

const config = require('../config');
const db = require('../database');
const DICT = require('./en');

/* عدّادات تشخيصية (تظهر في /api/status) — تبين أي خطأ إرسال مباشرة */
const STATS = {
  decorated: 0,
  plainFallback: 0,
  plainFallbackFailed: 0,
  sendErrors: 0,
  lastError: null,
  lastErrorAt: 0,
  lastErrorPayload: null,
  lastErrorStack: null,
  lastInteractionAt: 0,
  lastSendAt: 0,
};
function describePayload(payload) {
  if (typeof payload === 'string') return `نص(${payload.length}): ${payload.slice(0, 60)}`;
  if (!payload || typeof payload !== 'object') return String(payload);
  const keys = Object.keys(payload);
  const shape = {
    keys,
    content: typeof payload.content === 'string' ? payload.content.length : payload.content ?? null,
    embeds: Array.isArray(payload.embeds) ? payload.embeds.length : payload.embeds ?? null,
    components: Array.isArray(payload.components) ? payload.components.length : payload.components ?? null,
    files: Array.isArray(payload.files) ? payload.files.length : payload.files ?? null,
    builder: typeof payload.toJSON === 'function' ? payload.constructor?.name : null,
  };
  return JSON.stringify(shape).slice(0, 300);
}

function noteError(err, payload, stage = 'decorated') {
  STATS.sendErrors += 1;
  STATS.lastError = `[${stage}] ${String(err?.message || err)}`.slice(0, 300);
  STATS.lastErrorAt = Date.now();
  STATS.lastErrorPayload = payload === undefined ? null : describePayload(payload);
  STATS.lastErrorStack = String(new Error('trace').stack || '')
    .split('\n')
    .slice(2, 7)
    .map((l) => l.trim().replace(/^\(|\)$/g, ''))
    .join(' | ')
    .slice(0, 400);
  console.error('[ردود] فشل إرسال:', STATS.lastError, '·', STATS.lastErrorPayload, '·', STATS.lastErrorStack);
}
function decorateStats() {
  return { ...STATS, cfgDefaults: config.defaults.replies || null };
}

/* جسر نظام الترجمة الداخلي (i18n): أي نص عربي ثابت عنده ترجمة إنجليزية جاهزة يدخل القاموس تلقائيًا */
const I18N_EXACT = (() => {
  try {
    const { strings } = require('./i18n');
    const flat = (node, prefix = '') =>
      Object.entries(node || {}).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
      );
    const arMap = new Map(flat(strings.ar));
    const out = {};
    for (const [key, en] of flat(strings.en)) {
      const source = arMap.get(key);
      if (typeof source === 'string' && typeof en === 'string' && source !== en) {
        if (!source.includes('{') && !en.includes('{')) out[source] = en;
      }
    }
    return out;
  } catch {
    return {};
  }
})();

/* ────────────────────────── ١) الخط المزخرف ────────────────────────── */

const MATH_BOLD_ITALIC_A = 0x1d468; // 𝑨
const MATH_BOLD_ITALIC_a = 0x1d482; // 𝒂

/** الأجزاء الممنوع لمسها: منشنات · روابط · أكواد · إيموجيات خارجية · تواريخ */
const PROTECTED = /(<@[!&]?\d+>|<#[!&]?\d+>|<a?:\w+:\d+>|<t:-?\d+(?::[tTdDfFR])?>|<id:[a-z]+>|https?:\/\/[^\s<>]+|```[\s\S]*?```|`[^`\n]*`|\b\d+(?:[smhdw])\b|\/[a-z][a-z0-9-]{1,30})/g;

/** تحويل حرف ASCII إلى نظيره المزخرف (𝑪𝒉𝒂𝒕) */
function fancyChar(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCodePoint(MATH_BOLD_ITALIC_A + (code - 65));
  if (code >= 97 && code <= 122) return String.fromCodePoint(MATH_BOLD_ITALIC_a + (code - 97));
  return ch;
}

/**
 * يحوّل نصًا إنجليزيًا إلى الخط المزخرف مع حماية كل ما يجب ألا يتغيّر.
 * @param {string} text
 * @returns {string}
 */
function fancy(text) {
  if (!text || typeof text !== 'string') return text;
  let out = '';
  let last = 0;
  const re = new RegExp(PROTECTED.source, 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    out += [...text.slice(last, match.index)].map(fancyChar).join('');
    out += match[0];
    last = match.index + match[0].length;
  }
  out += [...text.slice(last)].map(fancyChar).join('');
  return out;
}

/* ────────────────────────── ٢) الترجمة للإنجليزية ────────────────────────── */

const ARABIC = /[\u0600-\u06FF]/;

/** يترجم نصًا مفردًا باستخدام القاموس ثم القواعد ثم الكلمات المفردة */
function translate(value, depth = 0) {
  if (!value || typeof value !== 'string' || !ARABIC.test(value)) return value;
  const key = value.trim();

  /* ١) تطابق تام (الأسرع والأدق) */
  const exact = DICT.exact[key] ?? I18N_EXACT[key];
  if (exact) return value.replace(key, exact);

  /* ٢) قواعد للجُمل المتغيّرة (أسماء · أرقام · قنوات) */
  for (const [re, en] of DICT.rules) {
    if (re.test(key)) {
      const mapped = key.replace(re, en);
      /* لو بقيت كلمات عربية داخل النص الناتج (متغيّرات) نكمل ترجمتها — بحد أقصى مرّتين */
      return value.replace(key, depth < 2 && ARABIC.test(mapped) ? translate(mapped, depth + 1) : mapped);
    }
  }

  /* ٣) النصوص القصيرة (تسميات الحقول) — ترجمة كلمة بكلمة إن عُرفت كل الكلمات */
  if (key.length <= 34) {
    const words = key.split(/\s+/);
    const cleaned = words.map((w) => w.replace(/[\u00AB\u00BB:"'.,!\u061F?\u2026*_`()\[\]#@<>]/g, ''));
    const mapped = cleaned.map((w) => DICT.words[w] ?? null);
    const needMap = cleaned.map((w) => /[\u0600-\u06FF]/.test(w));
    if (mapped.every((m, k) => !needMap[k] || m)) {
      return value.replace(key, words.map((w, i) => (mapped[i] == null || mapped[i] === w ? w : w.replace(/[A-Za-z\u0600-\u06FF]+/u, () => mapped[i]))).join(' '));
    }
  }

  /* ٤) بادئة غير عربية/إنجليزية (إيموجي أو ⚠️ أو **) ⇒ نترجم الباقي ونرجّع البادئة كما هي */
  const prefix = key.match(/^([^A-Za-z\u0600-\u06FF0-9]+)([\s\S]*)$/);
  if (prefix && prefix[2] && /[\u0600-\u06FF]/.test(prefix[2])) {
    const inner = translate(prefix[2]);
    if (inner !== prefix[2]) return value.replace(key, prefix[1] + inner);
  }

  /* ٥) «تم + فعل + باقي عربي» ⇒ فعل إنجليزي + ترجمة الباقي */
  const parts = key.match(/^(?:تم|تمت)\s+(\S+)\s+(.+)$/);
  if (parts && DICT.verbs?.[parts[1]]) {
    const head = DICT.verbs[parts[1]];
    const rest = translate(parts[2], depth + 1);
    if (rest !== parts[2]) {
      const out = `${head} ${rest}`;
      return value.replace(key, depth < 2 && ARABIC.test(out) ? translate(out, depth + 1) : out);
    }
  }

  /* ٦) نص متعدّد الأسطر: نترجم كل سطر لحاله (ردود الحظر/التحذير مثلًا) */
  if (key.includes('\n')) {
    const lines = value.split('\n');
    const outLines = lines.map((line) => translate(line, depth + 1));
    if (outLines.some((line, i) => line !== lines[i])) return outLines.join('\n');
  }

  /* ٧) غير مترجم بعد → يبقى كما هو (بلا كسر) */
  return value;
}

/* ────────────────────────── ٣) التطبيق على الردود ────────────────────────── */

/** الإعدادات الفعّالة للردود (مع الافتراضيات) */
function replyConfig(settings) {
  const defaults = config.defaults.replies || { english: true, fancyFont: true };
  const raw = settings?.replies || {};
  return {
    english: raw.english === undefined ? defaults.english !== false : raw.english !== false,
    fancyFont: raw.fancyFont === undefined ? defaults.fancyFont !== false : raw.fancyFont !== false,
  };
}

/** يطبّق الترجمة + الخط على نص واحد (رسائل البوت فقط) */
function decorateText(text, cfg, { translateText = true } = {}) {
  if (typeof text !== 'string' || !text) return text;
  let out = translateText && cfg.english ? translate(text) : text;
  if (cfg.fancyFont) out = fancy(out);
  return out;
}

/**
 * يحوّل embed (EmbedBuilder أو كائن عادي) مع الاحتفاظ بنوعه تمامًا.
 * مهم: بِلدرات ديسكورد (EmbedBuilder) تُعدَّل من داخلها ونرجّعها مثل ما هي —
 * لأن تحويلها لكائن عادي يفقد toJSON ويصير الإرسال فاضي (خطأ 50006 عند ديسكورد).
 */
function decorateEmbed(embed, cfg) {
  if (!embed) return embed;
  const isBuilder = typeof embed.toJSON === 'function' && embed.data && typeof embed.data === 'object';
  if (!isBuilder) {
    if (typeof embed !== 'object') return embed;
    const next = { ...embed };
    next.title = decorateText(next.title, cfg);
    next.description = decorateText(next.description, cfg);
    if (next.footer?.text) next.footer = { ...next.footer, text: decorateText(next.footer.text, cfg) };
    if (next.author?.name) next.author = { ...next.author, name: decorateText(next.author.name, cfg) };
    if (Array.isArray(next.fields)) {
      next.fields = next.fields.map((f) => ({
        ...f,
        name: decorateText(f.name, cfg),
        value: decorateText(f.value, cfg),
      }));
    }
    return next;
  }

  const d = embed.data;
  if (typeof d.title === 'string') d.title = decorateText(d.title, cfg);
  if (typeof d.description === 'string') d.description = decorateText(d.description, cfg);
  if (d.footer && typeof d.footer.text === 'string') d.footer.text = decorateText(d.footer.text, cfg);
  if (d.author && typeof d.author.name === 'string') d.author.name = decorateText(d.author.name, cfg);
  if (Array.isArray(d.fields)) {
    d.fields = d.fields.map((f) => ({
      ...f,
      name: decorateText(f.name, cfg),
      value: decorateText(f.value, cfg),
    }));
  }
  return embed;
}

/**
 * يترجم نصوص الأزرار والقوائم (بلا خط مزخرف — تبقى واضحة).
 * نفس المبدأ: بِلدرات ديسكورد تبقى بِلدرات (نعدّل data من الداخل).
 */
function decorateComponent(comp, cfg) {
  if (!comp) return comp;
  const isBuilder = typeof comp.toJSON === 'function' && comp.data && typeof comp.data === 'object';
  const d = isBuilder ? comp.data : comp;
  if (!d || typeof d !== 'object') return comp;
  if (typeof d.label === 'string') d.label = translate(d.label);
  if (typeof d.placeholder === 'string') d.placeholder = translate(d.placeholder);

  /* خيارات القوائم: عند البِلدر تكون في comp.options (كائنات بِلدر) وعند الكائن العادي في d.options */
  const options = Array.isArray(comp.options) && comp.options.length ? comp.options : Array.isArray(d.options) ? d.options : [];
  for (const option of options) {
    const od = option && option.data && typeof option.data === 'object' ? option.data : option;
    if (!od || typeof od !== 'object') continue;
    if (typeof od.label === 'string') od.label = translate(od.label);
    if (typeof od.description === 'string') od.description = translate(od.description);
  }
  return comp;
}

function decorateComponents(rows, cfg) {
  if (!Array.isArray(rows) || !cfg.english) return rows;
  return rows.map((row) => {
    const parts = row?.components;
    if (!Array.isArray(parts)) return row;
    for (const comp of parts) decorateComponent(comp, cfg);
    return row;
  });
}

/**
 * يزيّن أي حمولة إرسال (نص أو كائن) — يُستدعى من كل مسارات الردود.
 * @param {string|object} payload
 * @param {object} settings إعدادات السيرفر
 */
function decorate(payload, settings) {
  const cfg = replyConfig(settings);
  if (!cfg.english && !cfg.fancyFont) return payload;

  if (typeof payload === 'string') return decorateText(payload, cfg);
  if (!payload || typeof payload !== 'object') return payload;

  const out = { ...payload };
  /* حمولة بلا محتوى ولا إمبدات ولا مكوّنات = خطأ 50006 — نرجّع الأصل كما هو */
  const looksEmpty =
    (out.content === undefined || out.content === '' || out.content === null) &&
    !(Array.isArray(out.embeds) ? out.embeds.length : out.embeds) &&
    !(Array.isArray(out.components) ? out.components.length : out.components) &&
    !(Array.isArray(out.files) ? out.files.length : out.files) &&
    !out.sticker &&
    !out.poll;
  if (looksEmpty && Object.keys(out).length <= 3) return payload;
  if (typeof out.content === 'string') out.content = decorateText(out.content, cfg);
  if (Array.isArray(out.embeds)) out.embeds = out.embeds.map((e) => decorateEmbed(e, cfg));
  if (out.embeds && !Array.isArray(out.embeds)) out.embeds = decorateEmbed(out.embeds, cfg);
  if (Array.isArray(out.components)) out.components = decorateComponents(out.components, cfg);
  return out;
}

/* ────────────────────────── ٤) التركيب على البوت ────────────────────────── */

const INTERACTION_METHODS = ['reply', 'editReply', 'followUp', 'update', 'sendMessage', 'deferReply'];

/**
 * يلفّ ردود التفاعل (سلاش/أزرار/قوائم) بالترجمة والخط.
 * @param {import('discord.js').Interaction} interaction
 */
function wrapInteraction(interaction) {
  if (!interaction || interaction.__styledReplies) return interaction;
  const settings = interaction.guildId ? db.getGuildSettings(interaction.guildId) : null;

  for (const method of INTERACTION_METHODS) {
    const original = interaction[method];
    if (typeof original !== 'function') continue;
    interaction[method] = function styled(options, ...rest) {
      const current = interaction.guildId ? db.getGuildSettings(interaction.guildId) : settings;
      STATS.lastInteractionAt = Date.now();
      let decorated = options;
      try {
        if (typeof options === 'string') decorated = decorate(options, current);
        else if (options && typeof options === 'object' && !(options instanceof Promise)) decorated = decorate(options, current);
      } catch (err) {
        noteError(err);
        decorated = options;
      }
      const attempt = (payload) => {
        STATS.lastSendAt = Date.now();
        if (payload !== options) STATS.decorated += 1;
        const result = original.call(interaction, payload, ...rest);
        /* أخطاء ديسكورد تجي كرفض للـ promise: لو فشل المزيّن نرسل الأصل بدل ما يضيع الرد */
        if (result && typeof result.catch === 'function' && payload !== options) {
          return result.catch((err) => {
            noteError(err, payload, 'interaction-decorated');
            STATS.plainFallback += 1;
            return Promise.resolve(original.call(interaction, options, ...rest)).catch((err2) => {
              noteError(err2, options, 'interaction-plain');
              STATS.plainFallbackFailed += 1;
              throw err2;
            });
          });
        }
        return result;
      };
      try {
        return attempt(decorated);
      } catch (err) {
        noteError(err);
        if (decorated === options) throw err;
        STATS.plainFallback += 1;
        return original.call(this, options, ...rest);
      }
    };
  }
  interaction.__styledReplies = true;
  return interaction;
}

/**
 * يلفّ كل إرسال من البوت (رسائل الترحيب · اللوقات · التذاكر · اللوحات...).
 * يُستدعى مرة واحدة عند تشغيل البوت.
 */
function installSendDecorators() {
  let discord;
  try {
    discord = require('discord.js');
  } catch {
    return;
  }

  const classes = ['TextChannel', 'DMChannel', 'ThreadChannel', 'VoiceChannel', 'PartialGroupDMChannel', 'Message', 'Webhook']
    .map((name) => discord[name])
    .filter(Boolean);

  for (const Klass of classes) {
    for (const method of ['send', 'reply', 'edit']) {
      const original = Klass.prototype?.[method];
      if (typeof original !== 'function' || original.__styledReplies) continue;
      const wrapped = function styledSend(options, ...rest) {
        let settings = null;
        try {
          const guildId = this.guildId || this.guild?.id || this.channel?.guildId || null;
          settings = guildId ? db.getGuildSettings(guildId) : null;
        } catch {
          settings = null;
        }
        let decorated = options;
        try {
          if (typeof options === 'string') decorated = decorate(options, settings);
          else if (options && typeof options === 'object') decorated = decorate(options, settings);
        } catch (err) {
          noteError(err);
          decorated = options;
        }
        STATS.lastSendAt = Date.now();
        if (decorated !== options) STATS.decorated += 1;
        let result;
        try {
          result = original.call(this, decorated, ...rest);
        } catch (err) {
          noteError(err);
          if (decorated === options) throw err;
          STATS.plainFallback += 1;
          return original.call(this, options, ...rest);
        }
        if (result && typeof result.catch === 'function' && decorated !== options) {
          return result.catch((err) => {
            noteError(err, decorated, 'send-decorated');
            STATS.plainFallback += 1;
            return Promise.resolve(original.call(this, options, ...rest)).catch((err2) => {
              noteError(err2, options, 'send-plain');
              STATS.plainFallbackFailed += 1;
              throw err2;
            });
          });
        }
        return result;
      };
      wrapped.__styledReplies = true;
      Klass.prototype[method] = wrapped;
    }
  }
}

module.exports = {
  fancy,
  fancyChar,
  translate,
  decorate,
  decorateText,
  replyConfig,
  wrapInteraction,
  installSendDecorators,
  DICTIONARY: DICT,
  decorateStats,
};
