'use strict';

/**
 * lib/replyFormat.js
 * -------------------------------------------------------------
 * شكل ردود الأوامر — قابل للتحكم بالكامل من الموقع (صفحة «ردود أوامر»):
 *
 *   • الوضع: **رسالة نصية** أو **إمبد** لكل أمر على حدة.
 *   • النص: تقدر تكتب نص الرد بنفسك (قالب) مع متغيّرات جاهزة.
 *
 * المتغيّرات المتاحة في القوالب:
 *   {user} العضو المستهدف · {target} مثله · {moderator} الإداري · {reason} السبب
 *   {case} رقم الحالة · {count} العدد · {channel} الروم · {duration} المدة · {server} السيرفر
 *
 * والإعدادات تُحفظ في settings.commandReplies على شكل:
 *   { ban: { mode: 'text', text: '🔨 تم حظر {user} — السبب: {reason}' }, top: { mode: 'embed' } }
 * -------------------------------------------------------------
 */

/** الأوامر الافتراضية على «رسالة نصية»: العقوبات مختصرة بلا إمبد */
const TEXT_BY_DEFAULT = ['ban', 'kick', 'unban', 'warn', 'purge', 'lock', 'slowmode', 'timeout', 'untimeout', 'member', 'role'];

/** أسماء الحقول التي تحمل العضو/السبب داخل الخيارات */
const USER_OPTIONS = ['العضو', 'المستخدم', 'user', 'العضو_الجديد'];
const REASON_OPTIONS = ['السبب', 'reason'];

/** الوضع الافتراضي لأي أمر */
function defaultMode(commandName) {
  return TEXT_BY_DEFAULT.includes(String(commandName)) ? 'text' : 'embed';
}

/** إعدادات شكل الرد لأمر معيّن */
function configFor(settings, commandName) {
  const raw = settings?.commandReplies?.[commandName] || {};
  const mode = raw.mode === 'text' || raw.mode === 'embed' ? raw.mode : defaultMode(commandName);
  return {
    mode,
    text: typeof raw.text === 'string' ? raw.text : '',
    title: typeof raw.title === 'string' ? raw.title : '',
  };
}

/** استبدال المتغيّرات داخل القالب */
function fill(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined || vars[key] === null ? match : String(vars[key])));
}

/** تحويل إمبد إلى نص عادي منظّم (عنوان · وصف · حقول · تذييل) */
function embedToText(embed) {
  const data = embed?.data && typeof embed.data === 'object' ? embed.data : embed;
  if (!data || typeof data !== 'object') return '';

  const clean = (value) => String(value || '').replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim();
  const title = clean(data.title);
  const description = String(data.description || '').trim();

  const lines = [];

  /* العنوان يُكتب بس لو ما كان مكرّرًا داخل الوصف (مثال: «🔨 حظر» + «تم حظر @عضو») */
  const titleCore = title.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const titleWords = titleCore.split(' ').filter((w) => w.length > 2);
  const duplicated = Boolean(title) && Boolean(description) && (
    (titleCore && clean(description).includes(titleCore))
    || (titleWords.length && titleWords.every((w) => clean(description).includes(w)))
  );
  if (title && !duplicated) lines.push(title);
  if (description) lines.push(description);

  /* الحقول: بلا فراغات وبلا تكرار (نفس القيمة بنفس الاسم = سطر واحد) */
  const seen = new Set(lines.map((l) => clean(l)));
  for (const field of data.fields || []) {
    const name = clean(field?.name);
    const value = String(field?.value ?? '').trim();
    if (!name || !value || value === '—') continue;
    const line = `**${name}:** ${value}`;
    if (seen.has(clean(line))) continue; // السطر نفسه موجود
    const previous = clean(lines.join(' \n '));
    const bare = clean(value).replace(/^[#@]/, '');
    /* لو القيمة والاسم مذكورين فوق (مثال: «رقم الحالة: #1» ثم «الحالة: #1») → نكتفي بالأول */
    if (bare && previous.includes(bare) && previous.includes(name)) continue;
    /* أو نفس القيمة مكرّرة باسم قريب («عدد تحذيراته: 1» ثم «عدد التحذيرات: 1») */
    if (bare) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u');
      const words = name.split(/\s+/).filter((w) => w.length > 2);
      const nameKnown = words.length ? words.some((w) => previous.includes(w)) : previous.includes(name);
      if (re.test(previous) && nameKnown) continue;
    }
    seen.add(clean(line));
    lines.push(line);
  }
  if (data.footer?.text) lines.push(`— ${data.footer.text}`);
  return lines.filter(Boolean).join('\n').trim();
}

/** القيم الجاهزة من تفاعل (عضو · سبب · رقم حالة · روم ...) */
function varsFromInteraction(interaction) {
  const out = {
    server: interaction?.guild?.name || '',
    moderator: interaction?.user ? `${interaction.user}` : '',
    moderatorName: interaction?.user?.username || '',
  };
  const options = interaction?.options;
  if (!options) return out;

  const safe = (fn, name) => {
    try {
      return fn.call(options, name);
    } catch {
      return null;
    }
  };

  for (const name of USER_OPTIONS) {
    const user = safe(options.getUser, name) || null;
    if (user) {
      out.user = `${user}`;
      out.target = `${user}`;
      out.username = user.username;
      out.userId = user.id;
      break;
    }
  }
  const idInput = USER_OPTIONS.map((name) => safe(options.getString, name)).find((v) => v && /^\d{17,20}$/.test(String(v).trim()));
  if (idInput && !out.userId) {
    out.user = `<@${String(idInput).trim()}>`;
    out.target = out.user;
    out.userId = String(idInput).trim();
  }

  for (const name of REASON_OPTIONS) {
    const reason = safe(options.getString, name);
    if (reason) {
      out.reason = reason;
      break;
    }
  }

  const count = safe(options.getInteger, 'العدد') ?? safe(options.getInteger, 'عدد');
  if (count !== null && count !== undefined) out.count = String(count);

  const channel = safe(options.getChannel, 'القناة') || safe(options.getChannel, 'الروم');
  if (channel) out.channel = `${channel}`;

  const duration = safe(options.getString, 'المدة');
  if (duration) out.duration = duration;

  /* قيم يضيفها الأمر نفسه (رقم الحالة · العدد الفعلي · الروم...) */
  if (interaction.__replyVars && typeof interaction.__replyVars === 'object') {
    Object.assign(out, interaction.__replyVars);
  }

  return out;
}

/**
 * يطبّق شكل الرد المطلوب على حمولة الإرسال.
 * @param {object} payload حمولة الرد (نص أو كائن)
 * @param {{commandName?:string, settings?:object, vars?:object}} options
 */
function apply(payload, { commandName, settings, vars } = {}) {
  if (!payload || typeof payload !== 'object' || !commandName) return payload;
  const cfg = configFor(settings, commandName);
  const values = vars || {};
  const out = { ...payload };

  if (cfg.mode === 'text') {
    /* رسالة نصية: نستخدم القالب المكتوب، أو نحوّل الإمبد لنص منظّم */
    let text = cfg.text ? fill(cfg.text, values) : '';
    if (!text && Array.isArray(out.embeds) && out.embeds.length) {
      text = embedToText(out.embeds[0]);
    }
    if (!text && typeof out.content === 'string') text = out.content;
    if (!text) return payload;

    if (Array.isArray(out.embeds) && out.embeds.length) delete out.embeds;
    if (out.embed) delete out.embed;
    out.content = text.slice(0, 2000);
    return out;
  }

  /* إمبد: لو فيه قالب نص مخصّص ندخله وصفًا للإمبد، ولو الأمر بلا إمبد نلفّ النص بإطار */
  const hasEmbeds = Array.isArray(out.embeds) && out.embeds.length;
  if (cfg.text || cfg.title) {
    const text = cfg.text ? fill(cfg.text, values) : '';
    const title = cfg.title ? fill(cfg.title, values) : '';
    if (hasEmbeds) {
      const first = out.embeds[0];
      const data = first?.data && typeof first.data === 'object' ? first.data : first;
      if (data && typeof data === 'object') {
        if (text) data.description = text.slice(0, 4000);
        if (title) data.title = title.slice(0, 256);
      }
    } else if (text || title) {
      out.embeds = [{ title: title || undefined, description: text || undefined }];
      if (out.content && !text) delete out.content;
    }
  }
  return out;
}

/** نماذج لعرض المعاينة في صفحة «ردود أوامر» (نفس محرّك الردود الحقيقي) */
const SAMPLES = {
  ban: { color: '#ed4245', title: '🔨 حظر', description: 'تم حظر **@عضو**\n**السبب:** سبام\n**رقم الحالة:** #12', fields: [['الإداري', '@Admin'], ['النوع', 'مؤقت (1h)']] },
  kick: { color: '#e67e22', title: '👢 طرد', description: 'تم طرد **@عضو**\n**السبب:** إزعاج', fields: [['رقم الحالة', '#13']] },
  unban: { color: '#57f287', title: '✅ فك الحظر', description: 'تم فك الحظر عن **عضو#0001**', fields: [['السبب', 'اعتذار']] },
  warn: { color: '#fee75c', title: '⚠️ تحذير', description: 'تم تحذير **@عضو**\n**السبب:** سبام', fields: [['عدد تحذيراته', '2']] },
  purge: { color: '#57f287', title: '🧹 تنظيف القناة', description: 'تم حذف **25** رسالة.' },
  lock: { color: '#57f287', title: '🔒 قفل القناة', description: 'تم قفل القناة #عام' },
  timeout: { color: '#e67e22', title: '🔇 إسكات', description: 'تم إسكات **@عضو** لمدة 1h', fields: [['السبب', 'سبام']] },
  top: { color: '#5865f2', title: '🏆 توب — توب داي', description: '🥇 @عضو — **954** XP · مستوى **20**\n🥈 @عضو٢ — **469** XP · مستوى **15**' },
  help: { color: '#5865f2', title: 'المساعدة', description: 'عندي **29** أمر موزّعة على **6** أقسام.' },
  tickets: { color: '#5865f2', title: 'مركز الدعم', description: 'اختر نوع التذكرة بالأسفل وسيُفتح لك روم خاص مع فريق الدعم.' },
};

/** النموذج المناسب لأمر (أو نموذج عام) */
function sampleFor(commandName, label) {
  return SAMPLES[commandName] || { color: '#5865f2', title: label || commandName, description: 'نص الرد الافتراضي لهذا الأمر.' };
}

/** يبني معاينة: شكل الرد الافتراضي مقابل الشكل الحالي (بعد التحكم من الموقع) */
function preview(commandName, settings, { label, vars } = {}) {
  const sample = sampleFor(commandName, label);
  const basePayload = {
    embeds: [
      {
        data: {
          title: sample.title,
          description: sample.description,
          fields: (sample.fields || []).map(([name, value]) => ({ name, value })),
        },
      },
    ],
  };
  const values = vars || { user: '@عضو', target: '@عضو', reason: 'سبام', case: '12', count: '25', channel: '#عام', duration: '1h', moderator: '@Admin', server: 'Never Land' };
  const before = embedToText(basePayload.embeds[0]);
  const after = apply(basePayload, { commandName, settings, vars: values });
  return {
    mode: configFor(settings, commandName).mode,
    before,
    after: typeof after.content === 'string' && after.content ? after.content : (after.embeds ? embedToText(after.embeds[0]) : before),
  };
}

module.exports = { apply, configFor, defaultMode, embedToText, fill, varsFromInteraction, TEXT_BY_DEFAULT, SAMPLES, sampleFor, preview };
