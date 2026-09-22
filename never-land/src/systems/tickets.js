'use strict';

/**
 * systems/tickets.js
 * -------------------------------------------------------------
 * نظام التذاكر:
 *   • 4 أنواع افتراضية: الدعم الفني • التوثيق • الهدايا • تقديم إدارة
 *   • 🖼️ اللوحة **صورة PNG شفافة** بلا نص وبلا إمبد (مرفق مباشر) وتحتها قائمة الأنواع المنسدلة
 *     + صورة زخرفية اختيارية أسفل القائمة — زي اللوحات الاحترافية.
 *   • لوحة بوضعين: أزرار (Buttons) أو قائمة منسدلة (Select)
 *   • رسالة فتح التذكرة **صورة عادية بلا إمبد** + أزرار تحكّم (استلام/إغلاق/أرشيف/إضافة عضو)
 *   • نشر/تحديث اللوحة تلقائيًا لما تتغيّر (بصمة اللوحة) — بلا ما ترسل شي بيدك
 *   • دعم الإيموجيات الخارجية في اللوحة والأزرار والرسائل
 * -------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const db = require('../database');
const config = require('../config');
const { base } = require('../lib/embeds');
const { t } = require('../lib/i18n');
const { parseEmoji, customEmojiUrl } = require('../lib/emojis');

const BUTTON_STYLES = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger,
};

const ROOT = path.join(__dirname, '..', '..');

/** صورة اللوحة الافتراضية — نفس بانر روم الأوامر (commands-room.webp) */
const DEFAULT_PANEL_IMAGE = 'src/web/public/assets/commands-room.webp';

/**
 * أسماء صور قديمة تُنظَّف تلقائيًا من الروم.
 *
 * ⚠️ أي اسم في هذه القائمة يُعامل كنسخة منقرضة: resolveImageValue() يرفضه
 *    ويعيد البديل، و cleanupOldPanels() يحذف رسائله. لذلك لا تسمِّ ملفًا
 *    جديدًا باسم موجود هنا.
 *
 * - tickets-panel.webp / tickets-panel-footer.webp: نسختان بخلفية سوداء وخط زخرفي
 * - tickets-panel.png: النسخة التي سبقت التحويل إلى WebP (نفس الرسم، 2.5 م.ب)
 * - tickets-panel-v5.webp: صورة اللوحة القديمة — صارت منقرضة بعدما صارت اللوحة
 *   تستخدم بانر روم الأوامر (commands-room.webp). أي قيمة محفوظة منها ترجع
 *   تلقائيًا للصورة الجديدة.
 */
const LEGACY_IMAGE_NAMES = [
  'tickets-panel.webp',
  'tickets-panel-footer.webp',
  'tickets-panel.png',
  'tickets-panel-v5.webp',
];

/** الحالة الحيّة (تظهر في /api/status وللتشخيص) */
const STATE = { guilds: {} };

/** نسخة اللوحة — تغييرها يعيد نشر كل اللوحات تلقائيًا (5 = WebP بدل PNG، نفس الرسم بحجم أقل 74%) */
const PANEL_VERSION = 5;

/**
 * يرجّع مسار الصورة (محلي داخل المشروع أو رابط https) — أو null إذا غير موجودة.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function imagePath(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const full = path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return fs.existsSync(full) ? full : null;
}

/** اسم ملف آمن للإرفاق */
function imageName(value, fallback = 'panel.png') {
  const raw = String(value || '').split('?')[0].split('#')[0];
  const base = path.basename(raw);
  return /^[\w.\-]{3,64}$/.test(base) ? base : fallback;
}

/**
 * 🩹 تصحيح قيمة صورة محفوظة: لو الملف غير موجود أو كانت نسخة قديمة (بخلفية سوداء/خط)
 * نرجع للبديل — حتى الإعدادات المحفوظة القديمة تتصلّح لحالها بلا ما تلمس شي بيدك.
 * @param {string|null|undefined} value القيمة المحفوظة
 * @param {string} fallback البديل (مسار الصورة الافتراضية أو '' لبلا صورة)
 * @returns {string} القيمة الصالحة
 */
function resolveImageValue(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  /* نسخة قديمة منقرضة (كانت بخلفية سوداء أو خط زخرفي) ⇒ البديل */
  if (LEGACY_IMAGE_NAMES.includes(path.basename(raw))) return fallback;
  const full = path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return fs.existsSync(full) ? raw : fallback;
}

/** القيم الفعّالة للصور (بعد التصحيح) — تُستخدم في البناء والبصمة والتشخيص */
function effectiveImages(cfg = {}) {
  return {
    panelImage: resolveImageValue(cfg.panelImage === undefined ? DEFAULT_PANEL_IMAGE : cfg.panelImage, DEFAULT_PANEL_IMAGE),
    panelFooterImage: resolveImageValue(cfg.panelFooterImage, ''),
    openImage: resolveImageValue(cfg.openImage === undefined ? DEFAULT_PANEL_IMAGE : cfg.openImage, DEFAULT_PANEL_IMAGE),
  };
}

/**
 * يبني مرفق صورة للإرسال في ديسكورد.
 * @returns {AttachmentBuilder|null}
 */
function imageAttachment(value, nameHint = null) {
  const source = imagePath(value);
  if (!source) return null;
  try {
    return new AttachmentBuilder(source, { name: nameHint || imageName(source) });
  } catch {
    return null;
  }
}

/** يبسّط اسم القناة (يطير الحروف المزخرفة ོ・𝑻𝒊𝒄𝒌𝒆𝒕𝒔 ⇒ tickets) */
function plainName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** هل اسم القناة يدل على قناة تذاكر؟ */
function looksLikeTickets(channel) {
  return /ticket|تذكر|دعم|support|help/.test(plainName(channel?.name));
}

/** إيموجي النوع جاهزًا للأزرار/القوائم (يدعم الخارجي) */
const typeEmoji = (type) => parseEmoji(type?.emoji) ?? undefined;

/** أزرار فتح التذاكر حسب الأنواع */
function buildTypeButtons(types) {
  const rows = [];
  let row = new ActionRowBuilder();
  types.slice(0, 25).forEach((type, index) => {
    if (index > 0 && index % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    const button = new ButtonBuilder()
      .setCustomId(`ticket:open:${type.id}`)
      .setLabel(String(type.label).slice(0, 80))
      .setStyle(BUTTON_STYLES[type.buttonStyle] ?? ButtonStyle.Primary);
    const emoji = typeEmoji(type);
    if (emoji) button.setEmoji(emoji);
    row.addComponents(button);
  });
  if (row.components.length) rows.push(row);
  return rows;
}

/** قائمة منسدلة لفتح التذاكر */
function buildTypeSelect(types, cfg = null) {
  const options = types.slice(0, 25).map((type) => ({
    label: String(type.label).slice(0, 100),
    value: String(type.id).slice(0, 100),
    description: type.description ? String(type.description).slice(0, 100) : undefined,
    emoji: typeEmoji(type),
  }));
  const placeholder = String(cfg?.panelPlaceholder || 'الرجاء الضغط هنا واختيار التذكرة المناسبة').slice(0, 150);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket:open')
      .setPlaceholder(placeholder || 'الرجاء الضغط هنا واختيار التذكرة المناسبة')
      .addOptions(options.length ? options : [{ label: 'الدعم الفني', value: 'support' }]),
  );
}

/**
 * 🖼️ بناء لوحة التذاكر:
 *   ١) رسالة الصورة (بدل النص) + قائمة/أزرار الأنواع تحتها
 *   ٢) صورة زخرفية اختيارية أسفل القائمة
 * وإذا كانت الصورة مطفّية (panelImage = '') يرجع للوحة النصية القديمة.
 * @returns {Array<object>} مصفوفة payloads جاهزة للإرسال (1 أو 2 رسالة)
 */
function buildPanelPayloads(settings, guild, client = null) {
  const cfg = settings.tickets;
  const types = cfg.types || [];

  const components = cfg.panelMode === 'select' ? [buildTypeSelect(types, cfg)] : buildTypeButtons(types);
  const payloads = [];

  /* ١) الصورة الأساسية (hero) — هي اللوحة نفسها */
  const images = effectiveImages(cfg);
  const hero = imageAttachment(images.panelImage);
  if (hero && cfg.panelImageOnly !== false) {
    /* 🖼️ سطر العنوان فوق + صورة عادية بلا إمبد + القائمة تحتها */
    const title = String(cfg.panelTitle || '').trim();
    payloads.push({ ...(title ? { content: title } : {}), files: [hero], components });
  } else {
    /* اللوحة النصية (الوضع القديم — تُستخدم إذا ما في صورة) */
    const embed = base({
      color: 0x5865f2,
      title: cfg.panelTitle || 'مركز الدعم',
      description: cfg.panelDescription || 'اختر نوع التذكرة بالأسفل وسيُفتح لك روم خاص مع فريق الدعم.',
      thumbnail: customEmojiUrl(types[0]?.emoji) ?? (guild?.iconURL?.({ size: 256 }) ?? null),
      fields: types.slice(0, 4).map((type) => ({
        name: `${type.emoji || ''} ${type.label}`.trim(),
        value: type.description || '—',
        inline: true,
      })),
      /* بلا فوتر إطلاقًا */
    });
    payloads.push({ embeds: [embed], components });
  }

  /* ٢) الصورة الزخرفية أسفل القائمة (اختيارية — فاضية = بلا خط) */
  if (images.panelFooterImage) {
    const name = imageName(images.panelFooterImage, 'panel-footer.png');
    const footerFile = imageAttachment(images.panelFooterImage, hero && hero.name === name ? `footer-${name}` : name);
    /* الصورة الزخرفية كذلك صورة عادية بلا إمبد */
    if (footerFile) payloads.push({ files: [footerFile] });
  }

  return payloads;
}

/** لوحة بسيطة (توافق مع الاستخدام القديم) — يرجّع الرسالة الأساسية */
function buildPanel(settings, guild) {
  return buildPanelPayloads(settings, guild)[0];
}

/** أسماء ملفات الصور المستخدمة في اللوحة + القديمة (لكشف النسخ القديمة عند التنظيف) */
function panelImageNames(cfg = {}) {
  const names = new Set();
  const add = (value) => {
    if (!value) return;
    const source = imagePath(value);
    if (!source) return;
    names.add(imageName(source));
    if (/^https?:\/\//i.test(source)) {
      try { names.add(imageName(new URL(source).pathname)); } catch { /* رابط غريب — نتجاهل */ }
    }
  };
  add(cfg.panelImage === undefined ? DEFAULT_PANEL_IMAGE : cfg.panelImage);
  add(cfg.panelFooterImage);
  /* نضيف أسماء النسخ القديمة (بخلفية سوداء/خط) حتى تتنظّف أول ما تنزل النسخة الشفافة */
  LEGACY_IMAGE_NAMES.forEach((name) => names.add(name));
  return [...names].filter(Boolean);
}

/** بصمة اللوحة: أي تغيير بالصورة/الأنواع/الوضع ⇒ البوت يحدّث اللوحة لحاله */
function panelSignature(cfg = {}) {
  const images = effectiveImages(cfg);
  const payload = {
    v: PANEL_VERSION,
    mode: cfg.panelMode || 'select',
    placeholder: cfg.panelPlaceholder || '',
    imageOnly: cfg.panelImageOnly !== false,
    image: imageName(images.panelImage),
    footer: images.panelFooterImage ? imageName(images.panelFooterImage) : '',
    title: cfg.panelTitle || '',
    description: cfg.panelDescription || '',
    types: (cfg.types || []).map((type) => [type.id, type.label, type.description || '', type.emoji || '']),
  };
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

/** نصوص رسائل التعليمات القديمة (لتنظيف النسخ اللي انزلت قبل إزالة الميزة) */
const LEGACY_INFO_TEXTS = [
  '**كيف أحصل على الدعم؟**\nاضغط الزر المناسب لنوع طلبك 👇',
  '**كيف أحصل على الدعم؟**\nاختر نوع الطلب من الأزرار أدناه، وسيُفتح لك روم خاص مع فريق الدعم.',
];

/**
 * تنظيف اللوحات القديمة في القناة قبل نشر لوحة جديدة:
 * حذف رسائل البوت اللي فيها أزرار تذاكر (customId يبدأ بـ ticket:open)
 * ورسائل التعليمات المنفصلة القديمة (نصها مطابق للقديم).
 * @returns {Promise<number>} عدد الرسائل المحذوفة
 */
async function cleanupOldPanels(channel, client, extraTexts = [], opts = {}) {
  if (!channel?.messages?.fetch || !client?.user) return 0;
  const texts = [...extraTexts, ...LEGACY_INFO_TEXTS].filter(Boolean).map((x) => String(x).trim());
  /* أسماء صور اللوحة (الأساسية + الزخرفية) — أي رسالة صور قديمة للبوت تنحذف مع اللوحة */
  const imageNames = opts.imageNames?.length ? opts.imageNames : panelImageNames(opts.config || {});
  let removed = 0;
  try {
    const batch = await channel.messages.fetch({ limit: 50 });
    for (const message of batch.values()) {
      if (message.author?.id !== client.user.id) continue;
      const isPanel = (message.components || []).some((row) =>
        (row.components || []).some((c) => String(c.customId || '').startsWith('ticket:open')));
      /* رسائل صور اللوحة: إمبد صورة (النسخ القديمة) أو مرفق مباشر (النسخة الجديدة) — بلا أي نص */
      const embedUrls = (message.embeds || [])
        .map((embed) => embed?.image?.url || embed?.data?.image?.url || '')
        .filter(Boolean)
        .join(' ');
      const attachmentNames = [...(message.attachments?.values?.() ?? [])]
        .map((a) => String(a.name || a.url || ''))
        .join(' ');
      const source = `${embedUrls} ${attachmentNames}`.trim();
      const isPanelImage = Boolean(source) && !String(message.content || '').trim()
        && imageNames.some((name) => source.includes(name));
      const content = String(message.content || '').trim();
      /* مطابقة دقيقة للنص المحفوظ، أو أي نسخة تبدأ بـ«كيف أحصل على الدعم» (كل صيغ رسالة التعليمات القديمة) */
      const isIntro = Boolean(content) && (texts.some((txt) => content === txt) || /^[*_\s]*كيف أحصل على الدعم/.test(content));
      if (!isPanel && !isPanelImage && !isIntro) continue;
      await message.delete().catch(() => {});
      removed += 1;
    }
  } catch {
    /* صلاحيات ناقصة أو رسائل قديمة — نتجاهل بهدوء */
  }
  return removed;
}

/** القيم الافتراضية لأزرار التذكرة (نفس ترتيب config.defaults.tickets.buttons) */
const DEFAULT_BUTTONS = {
  claim: { label: 'استلام', emoji: '🙋', style: 'Success' },
  claimDone: { label: 'مستلَمة', emoji: '🙋', style: 'Secondary' },
  close: { label: 'إغلاق', emoji: '🔒', style: 'Danger' },
  transcript: { label: 'أرشيف', emoji: '📄', style: 'Secondary' },
  addMember: { label: 'إضافة عضو', emoji: '➕', style: 'Secondary' },
};

/** مفاتيح الأزرار القابلة للتعديل + تسمياتها العربية */
const BUTTON_KEYS = Object.keys(DEFAULT_BUTTONS);
const BUTTON_LABELS = {
  claim: 'زر الاستلام',
  claimDone: 'زر «مستلَمة» (بعد الاستلام)',
  close: 'زر الإغلاق',
  transcript: 'زر الأرشيف',
  addMember: 'زر إضافة عضو',
};
const STYLE_NAMES = ['Primary', 'Secondary', 'Success', 'Danger'];

/**
 * يرجّع القيم الخام المحفوظة للزر (بعد الدمج مع الافتراضي) — للعرض في الردود واللوحة.
 * @returns {{label:string, emoji:string, style:string}}
 */
function buttonRaw(cfg, key) {
  const fallback = DEFAULT_BUTTONS[key] || { label: key, emoji: '', style: 'Secondary' };
  const raw = (cfg && cfg.buttons && typeof cfg.buttons[key] === 'object' && cfg.buttons[key]) || {};
  const emoji = raw.emoji === undefined || raw.emoji === null ? fallback.emoji : String(raw.emoji);
  return {
    label: (raw.label === undefined || raw.label === null ? fallback.label : String(raw.label)).trim().slice(0, 80) || fallback.label,
    emoji: emoji.trim(),
    style: STYLE_NAMES.includes(raw.style) ? raw.style : fallback.style,
  };
}

/**
 * يقرأ إعدادات زر واحد من إعدادات السيرفر ويرجّع { label, emoji, style } جاهزة للبناء.
 * أي قيمة ناقصة/خاطئة ترجع للافتراضي، وما يطيح البوت أبدًا.
 * @param {object|null} cfg إعدادات التذاكر (settings.tickets)
 * @param {string} key مفتاح الزر (claim · claimDone · close · transcript · addMember)
 * @returns {{label:string, emoji:object|undefined, styleName:string, style:number}}
 */
function buttonConfig(cfg, key) {
  const fallback = DEFAULT_BUTTONS[key] || { label: key, emoji: '', style: 'Secondary' };
  const raw = (cfg && cfg.buttons && typeof cfg.buttons[key] === 'object' && cfg.buttons[key]) || {};

  const rawLabel = raw.label === undefined || raw.label === null ? fallback.label : String(raw.label);
  const label = rawLabel.trim().slice(0, 80) || fallback.label;

  const rawEmoji = raw.emoji === undefined ? fallback.emoji : raw.emoji;
  const emoji = parseEmoji(rawEmoji) || undefined; // null/'' ⇒ بلا إيموجي

  const styleName = STYLE_NAMES.includes(raw.style) ? raw.style : fallback.style;
  return { label, emoji, styleName, style: BUTTON_STYLES[styleName] ?? ButtonStyle.Secondary };
}

/** أزرار التحكم داخل غرفة التذكرة — النص والإيموجي واللون من إعدادات السيرفر */
function ticketControls(ticketId, claimed = false, cfg = null) {
  const claim = buttonConfig(cfg, claimed ? 'claimDone' : 'claim');
  const close = buttonConfig(cfg, 'close');
  const transcript = buttonConfig(cfg, 'transcript');
  const addMember = buttonConfig(cfg, 'addMember');

  /** يبني زرًا ويضيف الإيموجي فقط لو موجود (الإيموجي الفارغ = زر بلا إيموجي) */
  const button = (customId, conf, build) => {
    const btn = new ButtonBuilder().setCustomId(customId).setLabel(conf.label).setStyle(conf.style);
    if (conf.emoji) btn.setEmoji(conf.emoji);
    return typeof build === 'function' ? build(btn) : btn;
  };

  return new ActionRowBuilder().addComponents(
    button(`ticket:claim:${ticketId}`, claim, (b) => (claimed ? b.setDisabled(true) : b)),
    button(`ticket:close:${ticketId}`, close),
    button(`ticket:transcript:${ticketId}`, transcript),
    button(`ticket:addmember:${ticketId}`, addMember),
  );
}

/**
 * إنشاء تذكرة جديدة.
 * @returns {Promise<{ok:boolean, reason?:string, ticket?:object, channel?:object}>}
 */
async function createTicket(client, guild, user, typeId) {
  const settings = db.getGuildSettings(guild.id);
  const cfg = settings.tickets;
  const lang = settings.language || 'ar';

  if (!cfg?.enabled) return { ok: false, reason: 'disabled' };
  if (!cfg.categoryId) return { ok: false, reason: 'noCategory' };

  const type = (cfg.types || []).find((ty) => ty.id === typeId) || { id: typeId, label: typeId, emoji: '🎫' };

  const { items: open } = db.listTickets({ guildId: guild.id, userId: user.id, status: 'open', limit: 10 });
  const maxOpen = Math.max(1, cfg.maxOpenPerUser || 3);
  if (open.length >= maxOpen) {
    return { ok: false, reason: 'maxOpen', max: maxOpen, channelId: open[0]?.channel_id };
  }
  const sameType = open.find((tk) => tk.type === typeId);

  const category = guild.channels.cache.get(cfg.categoryId);
  const supportRoles = [...new Set([...(cfg.supportRoleIds || []), ...(type.supportRoleIds || [])])];

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.MentionEveryone,
      ],
    },
    ...supportRoles.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];

  const channel = await guild.channels
    .create({
      name: `${type.emoji?.match(/^\p{Emoji}/u) ? '' : ''}${type.id}-${user.username}`.slice(0, 100).toLowerCase(),
      type: ChannelType.GuildText,
      parent: category || undefined,
      topic: `تذكرة ${type.label} — ${user.tag} (${user.id})`,
      permissionOverwrites: overwrites,
      reason: `تذكرة ${type.label} بواسطة ${user.tag}`,
    })
    .catch((err) => {
   console.error('[تنبيه] فشل إنشاء قناة التذكرة:', err.message);
      return null;
    });

  if (!channel) return { ok: false, reason: 'createFailed' };

  const ticket = db.createTicket({ guildId: guild.id, channelId: channel.id, userId: user.id, type: typeId });

  const mentions = [...supportRoles.map((r) => `<@&${r}>`), `<@${user.id}>`].join(' ');

  /* رسالة فتح التذكرة — كل شي فيها قابل للكتابة من الموقع (config → لوحة التحكم → التذاكر) */
  const openVars = {
    id: ticket.id,
    type: type.label,
    emoji: type.emoji || '🎫',
    user: `<@${user.id}>`,
    username: user.username,
    server: guild.name,
    panel: cfg.panelTitle || 'مركز الدعم',
  };
  const fill = (template) => String(template || '').replace(/\{(\w+)\}/g, (m, key) => (openVars[key] !== undefined ? String(openVars[key]) : m));
  const openTitle = fill(cfg.openTitle) || `${type.emoji || '🎫'} تذكرة رقم #${ticket.id} — ${type.label}`;
  const introBase = cfg.openDescription
    ? fill(cfg.openDescription)
    : `${t(lang, 'tickets.intro', { user: `<@${user.id}>`, type: type.label })}`;
  const introExtra = cfg.openIntro ? fill(cfg.openIntro) : (type.intro || '');
  const openFields = cfg.openFields === false
    ? []
    : [
      { name: 'صاحب التذكرة', value: `<@${user.id}>`, inline: true },
      { name: 'النوع', value: type.label, inline: true },
      { name: 'الحالة', value: '🟢 مفتوحة', inline: true },
    ];
  const openFooter = cfg.openFooter ? fill(cfg.openFooter) : undefined;

  /* 🖼️ رسالة فتح التذكرة: صورة بلا نص (إذا الصورة مفعّلة) — وإلا ترجع الرسالة النصية */
  const openFile = cfg.openImageOnly === false ? null : imageAttachment(effectiveImages(cfg).openImage);

  await channel
    .send({
      /* 🖼️ صورة عادية بلا إمبد: المرفق لحاله + المنشن + أزرار التحكّم */
      content: mentions,
      components: [ticketControls(ticket.id, false, cfg)],
      ...(openFile
        ? { files: [openFile] }
        : {
          embeds: [
            base({
              color: 0x5865f2,
              title: openTitle.slice(0, 256),
              description: [introBase, introExtra].filter(Boolean).join('\n\n').slice(0, 4000) || undefined,
              fields: openFields,
              footer: openFooter,
            }),
          ],
        }),
    })
    .catch(() => {});

  // 📝 تذاكر تقديم الإدارة: يُرسل البوت رسالة فيها زر يفتح النموذج (5 خانات)
  const applications = require('./applications');
  let applicationSent = false;
  if (applications.isApplicationType(settings, type)) {
    applicationSent = Boolean(await applications.sendFormMessage(client, channel, ticket));
  }

  db.updateGuildSettings(guild.id, {});

  return { ok: true, ticket, channel, duplicateType: Boolean(sameType), applicationSent, type };
}

/**
 * 🔔 تذكير عضو بخصوص تذكرة مفتوحة — رسالة خاصة **نصية بلا إمبد**.
 * تُستدعى من أمر «تذكير» (يعمل داخل غرفة التذكرة فقط) ومن الأزرار إن لزم.
 * @returns {Promise<{ok:boolean, reason?:string, ticket?:object}>}
 */
async function remind(client, { channel, guild, ticket, target, note = '', by = null }) {
  const open = ticket || db.getTicketByChannel(channel?.id);
  if (!open) return { ok: false, reason: 'notATicket' };

  const settings = db.getGuildSettings(guild.id);
  const user = target?.user || target;

  const lines = [
    `🔔 تذكير بخصوص تذكرة **#${open.id}** في سيرفر **${guild.name}**`,
    `الروم: <#${open.channel_id}>`,
    note ? `الرسالة: ${note}` : 'فريق الدعم ينتظر ردّك هناك.',
    by ? `من: ${by.tag || by.username || by.id}` : '',
  ].filter(Boolean);

  let sent = false;
  if (user?.send) sent = await user.send({ content: lines.join('\n') }).then(() => true).catch(() => false);
  return { ok: true, sent, ticket: open };
}

/** إغلاق تذكرة مع حفظ أرشيف نصي */
async function closeTicket(client, channel, closedBy, { reason = null, deleteChannel = true } = {}) {
  const ticket = db.getTicketByChannel(channel.id);
  if (!ticket) return { ok: false, reason: 'notATicket' };

  const guild = channel.guild;
  const settings = db.getGuildSettings(guild.id);
  const lang = settings.language || 'ar';

  let transcriptFile = null;
  try {
    const messages = [];
    let lastId = null;
    for (let i = 0; i < 5; i += 1) {
      const batch = await channel.messages.fetch({ limit: 100, before: lastId });
      if (!batch.size) break;
      messages.push(...batch.values());
      lastId = batch.last().id;
      if (batch.size < 100) break;
    }
    messages.reverse();
    const logging = require('./logging');
    const text = logging.buildTranscript(messages, ticket);
    transcriptFile = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${ticket.id}.txt` });
  } catch (err) {
  console.error('[تنبيه] فشل بناء الأرشيف:', err.message);
  }

  const embed = base({
    color: 0xed4245,
    title: `🔒 إغلاق التذكرة #${ticket.id}`,
    description: t(lang, 'tickets.closed', { user: `${closedBy}` }),
    fields: [
      { name: 'صاحب التذكرة', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'أُغلقت بواسطة', value: `${closedBy}`, inline: true },
      ...(reason ? [{ name: 'السبب', value: reason, inline: false }] : []),
    ],
  });

  if (settings.tickets?.logChannelId) {
    const logChannel = guild.channels.cache.get(settings.tickets.logChannelId);
    if (logChannel?.isTextBased?.()) {
      await logChannel.send({ embeds: [embed], files: transcriptFile ? [transcriptFile] : [] }).catch(() => {});
    }
  }

  await channel.send({ embeds: [embed] }).catch(() => {});

  /* بلا رسالة خاصة عند إغلاق التذكرة — الملخص يُرسل في الروم وقناة اللوق فقط */

  db.updateTicket(ticket.id, { status: 'closed', closed_at: Date.now() });

  if (deleteChannel) {
    setTimeout(() => channel.delete(`إغلاق التذكرة #${ticket.id}`).catch(() => {}), 5000);
  }
  return { ok: true, ticket };
}

/**
 * 🔎 يبحث عن قناة اللوحة: القناة المحفوظة، وإلا القناة اللي فيها لوحة منشورة قبل.
 * @returns {Promise<object|null>}
 */
async function findPanelChannel(guild, cfg = {}) {
  const saved = cfg.panelChannelId
    ? guild.channels.cache.get(cfg.panelChannelId) || (await guild.channels.fetch(cfg.panelChannelId).catch(() => null))
    : null;
  if (saved?.isTextBased?.()) return saved;

  const isPanelMessage = (message, botId) => {
    if (!botId || message.author?.id !== botId) return false;
    return (message.components || []).some((row) =>
      (row.components || []).some((c) => String(c.customId || '').startsWith('ticket:open')));
  };

  const channels = [...guild.channels.cache.values()].filter((c) => c?.isTextBased?.() && !c.isThread?.());
  /* نبدأ بالقنوات اللي اسمها يوحي إنها قناة تذاكر، وبعدها نكمل على الباقي (بحد أقصى 25 قناة) */
  const ordered = [...channels.filter(looksLikeTickets), ...channels.filter((c) => !looksLikeTickets(c))].slice(0, 25);

  for (const channel of ordered) {
    const batch = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (!batch) continue;
    for (const message of batch.values()) {
      if (isPanelMessage(message, guild.client?.user?.id)) return channel;
    }
  }

  /*
   * ما في لوحة منشورة قبل؟ نستخدم قناة التذاكر نفسها (داخل قسم التذاكر واسمها يدل عليها)
   * حتى اللوحة الجديدة تنزل لحالها بلا ما تختار قناة بيدك.
   */
  if (cfg.categoryId) {
    const inCategory = channels.filter((c) => String(c.parentId || '') === String(cfg.categoryId));
    const candidate = inCategory.find(looksLikeTickets) || (inCategory.length === 1 ? inCategory[0] : null);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * ترقية شكل اللوحة (مرة واحدة لكل سيرفر): السيرفرات اللي كانت على «أزرار» بالافتراضي القديم
 * تتحوّل للقائمة المنسدلة زي اللوحة الجديدة (نفس شكل الصورة اللي طُلبت).
 * الترقية تنحفظ بعلامة panelLookUpgraded حتى ما تتعارض مع أي اختيار بعدها من الموقع.
 * @returns {string|null} الوضع الجديد إذا صارت الترقية
 */
function upgradePanelLook(guildId) {
  try {
    const raw = db.getGuildSettings(guildId)?.tickets || {};
    if (raw.panelLookUpgraded === true) return null;
    const toSelect = raw.panelMode === 'buttons';
    db.updateGuildSettings(guildId, { tickets: { panelLookUpgraded: true, ...(toSelect ? { panelMode: 'select' } : {}) } });
    return toSelect ? 'select' : null;
  } catch {
    return null;
  }
}

/**
 * توحيد لوحة التذاكر (مرة واحدة لكل سيرفر): قائمة منسدلة + الأنواع الأربعة
 * بالعربي + سطر العنوان فوق الصورة — حتى لو كانت الإعدادات المحفوظة قديمة
 * (أزرار و/أو أنواع بالإنجليزي). تُحفظ بعلامة arabicSelectUpgraded حتى لا
 * تتعارض مع أي تخصيص يختاره المدير بعدها من الموقع أو الأوامر.
 */
function enforceArabicSelectPanel(guildId) {
  try {
    const raw = db.getGuildSettings(guildId)?.tickets || {};
    if (raw.arabicSelectUpgraded === true) return;
    const defaults = config.defaults.tickets;
    db.updateGuildSettings(guildId, {
      tickets: {
        arabicSelectUpgraded: true,
        panelMode: 'select',
        types: defaults.types,
        panelTitle: defaults.panelTitle,
        panelPlaceholder: defaults.panelPlaceholder,
      },
    });
  } catch {
    /* نتجاهل بهدوء */
  }
}

/**
 * 🖼️ يتأكد إن لوحة التذاكر منشورة وحديثة (نفس الصور والأنواع والوضع).
 * إذا تغيّر أي شي أو ما كانت منشورة ⇒ ينظّف النسخة القديمة وينشر الجديدة.
 * @returns {Promise<{ok:boolean, reason:string, channelId?:string, sent?:number, cleaned?:number}>}
 */
async function ensurePanel(client, guild, { force = false } = {}) {
  if (!guild?.channels) return { ok: false, reason: 'noGuild' };

  const upgraded = upgradePanelLook(guild.id);
  enforceArabicSelectPanel(guild.id);
  const settings = upgraded ? db.getGuildSettings(guild.id) : db.getGuildSettings(guild.id);
  const cfg = settings.tickets || {};

  if (!cfg.enabled) return { ok: false, reason: 'disabled' };
  if (cfg.panelAutoPost === false && !force) return { ok: false, reason: 'autoOff' };

  const channel = await findPanelChannel(guild, cfg);
  if (!channel) return { ok: false, reason: 'noChannel' };

  /*
   * 🩹 تصليح الإعدادات المحفوظة القديمة (صورة منقرضة أو خط زخرفي مشيل):
   * نكتب القيم الفعّالة في الإعدادات حتى اللوحة والموقع يعرضون الصح.
   */
  const wanted = effectiveImages(cfg);
  if (
    String(cfg.panelImage ?? '') !== wanted.panelImage
    || String(cfg.panelFooterImage ?? '') !== wanted.panelFooterImage
    || String(cfg.openImage ?? '') !== wanted.openImage
  ) {
    db.updateGuildSettings(guild.id, {
      tickets: { panelImage: wanted.panelImage, panelFooterImage: wanted.panelFooterImage, openImage: wanted.openImage },
    });
    cfg.panelImage = wanted.panelImage;
    cfg.panelFooterImage = wanted.panelFooterImage;
    cfg.openImage = wanted.openImage;
  }

  const signature = panelSignature(cfg);
  if (!force && cfg.panelSignature === signature && cfg.panelChannelId === channel.id) {
    STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), channelId: channel.id, upToDate: true, lastEnsureAt: Date.now(), lastError: null };
    return { ok: true, reason: 'upToDate', channelId: channel.id, sent: 0, cleaned: 0 };
  }

  const cleaned = await cleanupOldPanels(channel, client, [cfg.panelInfoMessage], { config: cfg });
  const payloads = buildPanelPayloads(settings, guild, client);
  let sent = 0;
  for (const payload of payloads) {
    const message = await channel.send(payload).catch((err) => {
      STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), lastError: `panel: ${err.message}` };
      return null;
    });
    if (message) sent += 1;
  }

  if (!sent) {
    STATE.guilds[guild.id] = { ...(STATE.guilds[guild.id] || {}), channelId: channel.id, lastEnsureAt: Date.now(), lastError: 'sendFailed' };
    return { ok: false, reason: 'sendFailed', channelId: channel.id, sent: 0, cleaned };
  }

  db.updateGuildSettings(guild.id, { tickets: { panelChannelId: channel.id, panelSignature: signature } });
  STATE.guilds[guild.id] = {
    ...(STATE.guilds[guild.id] || {}),
    channelId: channel.id,
    upToDate: true,
    sent,
    lastCleaned: cleaned,
    lastEnsureAt: Date.now(),
    lastError: null,
  };
  return { ok: true, reason: 'posted', channelId: channel.id, sent, cleaned };
}

/** المؤقّتات المؤجّلة لكل سيرفر (تجميع الحفظ السريع من الموقع) */
const PENDING = new Map();

/** ينشر/يحدّث لوحة التذاكر لسيرفر واحد بهدوء */
async function runEnsure(client, guildId) {
  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) return null;
  try {
    const result = await ensurePanel(client, guild);
    if (result.ok && result.reason === 'posted') {
      console.log(`[لوحة التذاكر] تحديث تلقائي في السيرفر ${guildId} — ${result.sent} رسالة · تنظيف ${result.cleaned || 0}`);
    }
    return result;
  } catch (err) {
    STATE.guilds[guildId] = { ...(STATE.guilds[guildId] || {}), lastError: err.message, lastEnsureAt: Date.now() };
    console.error('[تنبيه] تعذّر تحديث لوحة التذاكر:', err.message);
    return null;
  }
}

/** يجدول تحديث اللوحة بعد لحظات (لما تُحفظ الإعدادات من الموقع) */
function scheduleEnsure(client, guildId, delay = 2500) {
  if (!client || !guildId) return;
  clearTimeout(PENDING.get(guildId));
  const timer = setTimeout(() => {
    PENDING.delete(guildId);
    runEnsure(client, guildId);
  }, Math.max(300, delay));
  timer.unref?.();
  PENDING.set(guildId, timer);
}

/** يتأكد من لوحات كل السيرفرات (يُستدعى عند تشغيل البوت) */
async function ensureAll(client) {
  const results = [];
  for (const guild of client?.guilds?.cache?.values() || []) {
    /* تأخير بسيط بين السيرفرات حتى ما نضرب الحدود */
    // eslint-disable-next-line no-await-in-loop
    results.push(await runEnsure(client, guild.id));
  }
  return results.filter(Boolean);
}

/** حالة اللوحة (للتشخيص من /api/status) */
function status(guildId = null) {
  if (guildId) return STATE.guilds[guildId] || null;
  return STATE.guilds;
}

/** بناء الأرشيف عند الطلب */
async function buildArchive(channel) {
  const ticket = db.getTicketByChannel(channel.id);
  if (!ticket) return null;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return null;
  const logging = require('./logging');
  const text = logging.buildTranscript([...messages.values()].reverse(), ticket);
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${ticket.id}.txt` });
}

module.exports = {
  buildPanel,
  buildPanelPayloads,
  ensurePanel,
  ensureAll,
  effectiveImages,
  resolveImageValue,
  scheduleEnsure,
  panelSignature,
  panelImageNames,
  imagePath,
  status,
  DEFAULT_PANEL_IMAGE,
  buildTypeButtons,
  buildTypeSelect,
  ticketControls,
  cleanupOldPanels,
  remind,
  buttonConfig,
  buttonRaw,
  DEFAULT_BUTTONS,
  BUTTON_KEYS,
  BUTTON_LABELS,
  STYLE_NAMES,
  createTicket,
  closeTicket,
  buildArchive,
  typeEmoji,
};
