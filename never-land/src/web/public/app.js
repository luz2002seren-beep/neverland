/* ==========================================================
   Never Land  |  لوحة التحكم — واجهة عربية
   ----------------------------------------------------------
   • شريط جانبي مرتّب (عام • الأعضاء • الحماية • التذاكر • السجلات • البيانات)
   • كل قسم صفحة واضحة فيها بطاقات وحقول، وكل مفتاح بجانب وظيفته
   • شريط حفظ واحد أسفل الشاشة يظهر فقط عند وجود تغييرات
   • بدون أي مكتبات خارجية — JavaScript خالص
   ========================================================== */

/* ===== أيقونات SVG =====
   المصدر الواحد: public/icons.js (يُحمَّل قبل هذا الملف) — بلا نسخة مكرّرة هنا
   حتى أي حزمة أيقونات جديدة تظهر فورًا في اللوحة والموقع معًا. */
const ICONS = (typeof window !== 'undefined' && window.ICONS) || { circle: '<circle cx="12" cy="12" r="9"/>' };
const LOG_ICONS =
  (typeof window !== 'undefined' && window.LOG_ICONS) || { system: 'cpu', message: 'message', delete: 'trash' };
const icon = (typeof window !== 'undefined' && window.icon) || ((name, opts = {}) => {
  const { size = 20, cls = 'ico', stroke = 1.7 } = opts;
  const body = ICONS[name] || ICONS.circle;
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
});
const logoMark = (typeof window !== 'undefined' && window.logoMark) || ((size = 34) => ICONS.circle ? `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7">${ICONS.circle}</svg>` : '');
const iconForEvent =
  (typeof window !== 'undefined' && window.iconForEvent) || ((key = '') => {
    const k = String(key);
    const rules = [
      [/join|memberadd/i, 'userPlus'],
      [/leave|memberremove/i, 'userMinus'],
      [/ban/i, 'ban'],
      [/kick/i, 'hammer'],
      [/message|chat/i, 'message'],
      [/voice/i, 'speaker'],
      [/role/i, 'userCog'],
      [/channel/i, 'hash'],
      [/ticket/i, 'ticket'],
      [/automod|modaction|moderation/i, 'shield'],
    ];
    for (const [re, name] of rules) if (re.test(k)) return ICONS[name] ? name : 'message';
    return 'message';
  });


/* ============================ الحالة ============================ */
const state = {
  /** هل الزائر يقدر يعدّل؟ (الوصول العام = مشاهدة فقط) */
  canEdit: true,
  guildId: null,
  settings: null,
  meta: { channels: [], roles: [], logGroups: {}, logEvents: {}, emojis: [], cardAvailable: false, autolineStyles: [] },
  guild: null,
  stats: null,
  daily: [],
  section: 'overview',
  dirty: false,
  /** هل هذا الحساب مالك الموقع؟ (يرى قسم «أعضاء الموقع») */
  isOwner: false,
  viewOnly: false,
};

/* ============================ أدوات عامة ============================ */
function numLoc() {
  const lang = document.documentElement.lang;
  return lang === 'fr' ? 'fr-FR' : lang === 'en' ? 'en-US' : 'ar-EG';
}
function ui(s) {
  return window.NL && typeof window.NL.t === 'function' ? window.NL.t(s) : s;
}

const el = (tag, attrs = {}, html = '') => {
  const node = document.createElement(tag);
  const tr = (v) => (typeof v === 'string' ? ui(v) : v);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = tr(v);
    else if (k === 'text') node.textContent = tr(v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'placeholder' || k === 'title' || k === 'aria-label') node.setAttribute(k, tr(v));
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  if (html) node.innerHTML = tr(html);
  return node;
};

/** أيقونة SVG جاهزة للاستخدام داخل html */
const ic = (name, size = 17) => icon(name, { size });

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* معرّف هذه الصفحة: نرسله مع كل طلب حتى نعرف التغييرات اللي صارت من مكان تاني */
const PAGE_CLIENT_ID = (() => {
  try {
    const existing = sessionStorage.getItem('nl-client-id');
    if (existing) return existing;
    const made = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('nl-client-id', made);
    return made;
  } catch {
    return 'p-anonymous';
  }
})();

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      /* رأس الموقع: طبقة ثانية لمنع الطلبات من مواقع خارجية (CSRF) */
      'X-Requested-With': 'neverland-dashboard',
      'X-Client-Id': PAGE_CLIENT_ID,
      ...(options.headers || {}),
    },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message || `خطأ ${res.status}`);
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return res.json();
}

function toast(message, isError = false) {
  let box = document.querySelector('.toast');
  if (!box) {
    box = el('div', { class: 'toast' });
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(box._timer);
  box._timer = setTimeout(() => { box.className = 'toast'; }, 3200);
}

/* مسارات الإعدادات: getPath('welcome.message') */
function getPath(path) {
  return path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), state.settings);
}

function setPath(path, value) {
  const keys = path.split('.');
  let target = state.settings;
  for (const key of keys.slice(0, -1)) {
    if (target[key] === null || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = value;
  markDirty();
}

function markDirty() {
  state.dirty = true;
  const bar = document.querySelector('.d-savebar');
  if (!state.canEdit) return;
  if (bar) {
    bar.classList.add('show');
    const msg = bar.querySelector('.msg');
    msg.className = 'msg';
    msg.textContent = 'تغييرات غير محفوظة';
  }
}

/* ============================ عناصر الواجهة ============================ */
function dField(label, hint, controls, { wide = false } = {}) {
  const box = el('div', { class: `d-field${wide ? ' wide' : ''}` });
  const left = el('div', { class: 'd-field-label' });
  left.appendChild(el('b', { text: label }));
  if (hint) left.appendChild(el('span', { html: hint }));
  box.appendChild(left);
  const right = el('div', { class: 'd-field-control' });
  (Array.isArray(controls) ? controls : [controls]).filter(Boolean).forEach((c) => right.appendChild(c));
  box.appendChild(right);
  return box;
}

function dSwitch(path, onChangeExtra = null) {
  const wrap = el('label', { class: 'd-switch' });
  const input = el('input', { type: 'checkbox' });
  input.checked = Boolean(getPath(path));
  input.addEventListener('change', () => {
    setPath(path, input.checked);
    if (onChangeExtra) onChangeExtra(input.checked);
  });
  wrap.appendChild(input);
  wrap.appendChild(el('span'));
  return wrap;
}

function dInput(path, { placeholder = '', narrow = false, type = 'text', full = false, onChange = null } = {}) {
  const input = el('input', {
    class: `d-input${narrow ? ' narrow' : ''}${full ? ' full' : ''}`,
    type,
    placeholder,
  });
  const value = getPath(path);
  input.value = value === null || value === undefined ? '' : value;
  input.addEventListener('input', () => {
    const next = type === 'number' ? Number(input.value) : input.value;
    setPath(path, next === '' ? null : next);
    if (onChange) onChange(next);
  });
  return input;
}

/* قائمة أكواد/روابط مفصولة بفواصل ⇒ مصفوفة في الإعدادات */
function dList(path, { placeholder = '', full = false } = {}) {
  const input = el('input', { class: `d-input${full ? ' full' : ''}`, placeholder });
  const value = getPath(path);
  input.value = Array.isArray(value) ? value.join(' · ') : (value || '');
  input.addEventListener('input', () => {
    const list = input.value.split(/[\s,·]+/).map((v) => v.trim()).filter(Boolean);
    setPath(path, list);
  });
  return input;
}

function dNumber(path, { min = 0, max = 100000 } = {}) {
  const input = el('input', { class: 'd-input narrow', type: 'number', min, max });
  input.value = getPath(path) ?? 0;
  input.addEventListener('input', () => setPath(path, Math.max(min, Math.min(max, Number(input.value) || 0))));
  return input;
}

/* ==================== إيموجي الأزرار (اختيار + معاينة) ==================== */
/*
 * ملاحظة مهمة: الإيموجي هنا «بيانات» تُرسل إلى ديسكورد (نص الزر/الإيموجي)،
 * وليست عنصرًا في واجهة الموقع — واجهة الموقع تبقى بأيقونات SVG دائمًا.
 */
/* EMOJI-DATA: START — بيانات منتقي الإيموجي: رموز يختارها المدير وتُرسل إلى ديسكورد (نص الزر/إيموجيه)،
   وليست أيقونات واجهة. واجهة الموقع نفسها تبقى بأيقونات SVG فقط (اختبار 19 يتجاهل هذه الكتلة تحديدًا). */
const EMOJI_PALETTE = [
  '🙋', '🔒', '🔓', '📄', '➕', '🎫', '🎟️', '🛠️', '✅', '🎁', '📋', '💬', '❓', '🆘', '⭐', '🔥',
  '🛡️', '🚀', '📌', '🕒', '👑', '💎', '🤝', '📢', '🔔', '🧾', '🗂️', '✉️', '⚙️', '🧩', '💡', '📊',
];
/* EMOJI-DATA: END */

/** يفكّ الإيموجي الخارجي <:name:id> / <a:name:id> */
function parseCustomEmoji(value) {
  const match = String(value ?? '').trim().match(/^<(a?):([\w~]+):(\d{15,25})>$/);
  if (!match) return null;
  return { animated: match[1] === 'a', name: match[2], id: match[3], url: `https://cdn.discordapp.com/emojis/${match[3]}.${match[1] === 'a' ? 'gif' : 'png'}?size=64` };
}

/** عنصر معاينة الإيموجي: صورة للإيموجي الخارجي، أو الحرف للإيموجي العادي */
function emojiPreviewNode(value, size = 18) {
  const custom = parseCustomEmoji(value);
  if (custom) {
    const img = el('img', { class: 'd-emoji-img', src: custom.url, alt: custom.name, width: size, height: size });
    return img;
  }
  const txt = String(value ?? '').trim();
  if (!txt) return el('span', { class: 'd-emoji-none', text: '—' });
  return el('span', { class: 'd-emoji-txt', text: txt, style: `font-size:${size - 4}px` });
}

/**
 * حقل إيموجي كامل: كتابة يدوية + لوحة اختيار سريعة + معاينة حقيقية.
 * @returns {HTMLDivElement}
 */
function dEmojiField(path, { placeholder = 'إيموجي عادي أو خارجي <:name:id>', onChange = null } = {}) {
  const wrap = el('div', { class: 'd-emoji' });
  const input = el('input', { class: 'd-input narrow', maxlength: '80', placeholder });
  const value = getPath(path);
  input.value = value === null || value === undefined ? '' : String(value);

  const previewBox = el('span', { class: 'd-emoji-preview' });

  /*
   * المعاينة: إيموجي يونيكود ⇒ الحرف · إيموجي ديسكورد (عادي أو متحرّك) ⇒ صورته الحقيقية.
   * أي نص طويل مش إيموجي ⇒ تنبيه أحمر (لأن ديسكورد ما يعرضه كإيموجي).
   */
  const paint = (raw) => {
    const text = String(raw ?? '').trim();
    previewBox.innerHTML = '';
    previewBox.classList.remove('bad');
    previewBox.appendChild(emojiPreviewNode(text, 18));
    const custom = parseCustomEmoji(text);
    if (text && !custom && [...text].length > 8) {
      previewBox.classList.add('bad');
      previewBox.title = 'هذا نص طويل — ديسكورد ما يعرضه كإيموجي. استخدم إيموجي عادي أو <a:name:id>';
    } else {
      previewBox.title = custom ? `${custom.name}${custom.animated ? ' (متحرّك)' : ''}` : text || 'بلا إيموجي';
    }
  };
  paint(input.value);

  /** يطبّق قيمة الإيموجي (من اللوحة أو من إيموجيات السيرفر أو يدويًا) */
  const apply = (next, { close = true } = {}) => {
    input.value = next;
    setPath(path, next);
    paint(next);
    if (close) {
      pop.style.display = 'none';
      document.querySelectorAll('.d-emoji-pop').forEach((n) => { n.style.display = 'none'; });
    }
    if (onChange) onChange(next);
  };

  const pop = el('div', { class: 'd-emoji-pop' });
  pop.style.display = 'none';
  pop.appendChild(el('div', { class: 'd-emoji-title', text: 'إيموجيات جاهزة' }));

  EMOJI_PALETTE.forEach((emoji) => {
    const opt = el('button', { class: 'd-emoji-opt', type: 'button', text: emoji, title: emoji });
    opt.addEventListener('click', () => apply(emoji));
    pop.appendChild(opt);
  });

  /* إيموجيات سيرفرك — تشمل الإيموجيات المتحرّكة (تُحفظ بصيغة <a:name:id>) */
  const serverEmojis = state.meta.emojis || [];
  if (serverEmojis.length) {
    pop.appendChild(el('div', { class: 'd-emoji-title', text: `إيموجيات سيرفرك (${serverEmojis.length}) — المتحرّكة مدعومة` }));
    serverEmojis.slice(0, 150).forEach((e) => {
      const code = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
      const opt = el('button', { class: 'd-emoji-opt server', type: 'button', title: `${e.name}${e.animated ? ' (متحرّك)' : ''}` });
      if (e.url) opt.appendChild(el('img', { src: e.url, width: 22, height: 22, alt: e.name }));
      else opt.appendChild(el('span', { class: 'd-emoji-code', text: `:${e.name}:` }));
      opt.addEventListener('click', () => apply(code));
      pop.appendChild(opt);
    });
  }

  const clear = el('button', { class: 'd-emoji-opt clear', type: 'button', html: ic('close', 13), title: 'بلا إيموجي' });
  clear.addEventListener('click', () => apply(''));

  const toggle = el('button', { class: 'd-btn sm ghost icon', type: 'button', html: ic('emoticon', 15), title: 'اختيار إيموجي' });
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = pop.style.display !== 'none';
    document.querySelectorAll('.d-emoji-pop').forEach((n) => { n.style.display = 'none'; });
    pop.style.display = open ? 'none' : 'flex';
  });
  pop.addEventListener('click', (event) => event.stopPropagation());

  input.addEventListener('input', () => {
    setPath(path, input.value);
    paint(input.value);
    if (onChange) onChange(input.value);
  });

  wrap.appendChild(input);
  wrap.appendChild(previewBox);
  wrap.appendChild(toggle);
  wrap.appendChild(pop);
  return wrap;
}

/* يُغلق لوحة الإيموجي عند الضغط في أي مكان آخر */
document.addEventListener('click', () => {
  document.querySelectorAll('.d-emoji-pop').forEach((n) => { n.style.display = 'none'; });
});

/** لون الزر كما يظهر في ديسكورد */
const BUTTON_STYLE_CLASS = { Primary: 'primary', Secondary: 'secondary', Success: 'success', Danger: 'danger' };
const BUTTON_STYLE_AR = { Primary: 'أزرق', Secondary: 'رمادي', Success: 'أخضر', Danger: 'أحمر' };

/**
 * معاينة حقيقية لشكل الزر كما سيظهر في ديسكورد.
 * @param {() => {label:string, emoji:string, style:string}} getValues
 * @returns {{node:HTMLDivElement, refresh:Function}}
 */
function dButtonPreview(getValues) {
  const node = el('div', { class: 'd-btnview' });
  const refresh = () => {
    const { label, emoji, style } = getValues();
    node.innerHTML = '';
    node.className = `d-btnview ${BUTTON_STYLE_CLASS[style] || 'secondary'}`;
    if (emoji) node.appendChild(emojiPreviewNode(emoji, 18));
    node.appendChild(el('span', { text: label || '—' }));
  };
  refresh();
  return { node, refresh };
}

function dArea(path, { placeholder = '', onChange = null } = {}) {
  const area = el('textarea', { class: 'd-textarea', placeholder });
  area.value = getPath(path) ?? '';
  area.addEventListener('input', () => {
    setPath(path, area.value);
    if (onChange) onChange(area.value);
  });
  return area;
}

function dSelect(path, options, { noneLabel = '— بدون —', onAfter = null } = {}) {
  const select = el('select', { class: 'd-select' });
  const current = getPath(path);
  if (noneLabel !== null) select.appendChild(el('option', { value: '', text: noneLabel }));
  options.forEach((opt) => {
    select.appendChild(el('option', { value: opt.value, text: opt.label }));
  });

  /*
   * مهم: نضبط القيمة بعد بناء الخيارات.
   * استخدام خاصية selected في HTML يجعل كل الخيارات «مختارة» فيلتقط المتصفح آخرها،
   * فكانت كل القوائم تعرض آخر خيار بدل القيمة المحفوظة.
   */
  if (current !== null && current !== undefined && current !== '') {
    select.value = String(current);
    if (select.value !== String(current)) {
      /* القيمة المحفوظة غير موجودة في الخيارات → نضيفها حتى ما تضيع */
      select.appendChild(el('option', { value: String(current), text: `${String(current)} (محفوظ)` }));
      select.value = String(current);
    }
  } else {
    select.value = '';
  }

  select.addEventListener('change', () => {
    setPath(path, select.value || null);
    if (onAfter) onAfter(select.value);
  });
  return select;
}

/** يضبط القيمة المختارة في قائمة بعد بناء الخيارات (بدل خاصية selected الخاطئة) */
function pickOption(select, value) {
  if (value === null || value === undefined || value === '') {
    select.value = '';
    return select;
  }
  select.value = String(value);
  if (select.value !== String(value)) {
    /* القيمة المحفوظة غير موجودة بين الخيارات → نضيفها حتى ما تضيع */
    select.appendChild(el('option', { value: String(value), text: `${String(value)} (محفوظ)` }));
    select.value = String(value);
  }
  return select;
}

/** أزرار اختيار بديلة عن القائمة (للقيم المنطقية نعم/لا مثل شكل الرسالة) */
function dChips(path, options) {
  const wrap = el('div', { class: 'd-chips' });
  const current = getPath(path);
  options.forEach((opt) => {
    const chip = el('button', {
      class: `chip${String(current) === String(opt.value) ? ' active' : ''}`,
      type: 'button',
      text: opt.label,
    });
    chip.addEventListener('click', () => {
      setPath(path, opt.value);
      wrap.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      if (opt.onAfter) opt.onAfter(opt.value);
    });
    wrap.appendChild(chip);
  });
  return wrap;
}

const channelOptions = (extra = []) =>
  [...state.meta.channels]
    .filter((c) => [0, 2, 4, 15].includes(c.type))
    .sort((a, b) => a.type - b.type || String(a.name).localeCompare(String(b.name), document.documentElement.lang || 'ar'))
    .map((c) => ({ value: c.id, label: `${c.type === 0 || c.type === 15 ? '#' : c.type === 4 ? `[${ui('قسم')}] ` : `[${ui('صوتي')}] `}${c.name}`, type: c.type }))
    .concat(extra);

const roleOptions = (filterOut = []) =>
  state.meta.roles.filter((r) => !filterOut.includes(r.id)).map((r) => ({ value: r.id, label: r.name }));

const categoryOptions = () => state.meta.channels.filter((c) => c.type === 4).map((c) => ({ value: c.id, label: c.name }));

const nameOfChannel = (id) => state.meta.channels.find((c) => c.id === id)?.name || id;
const nameOfRole = (id) => state.meta.roles.find((r) => r.id === id)?.name || id;

function dCard(title, desc, iconName, children, { tail = null, noPad = false, id = '' } = {}) {
  const card = el('div', { class: 'd-card', id });
  const head = el('div', { class: 'd-card-head' });
  head.appendChild(el('div', { class: 'ico', html: ic(iconName, 18) }));
  const txt = el('div');
  txt.appendChild(el('h3', { html: title }));
  if (desc) txt.appendChild(el('p', { html: desc }));
  head.appendChild(txt);
  if (tail) {
    const t = el('div', { class: 'tail' });
    (Array.isArray(tail) ? tail : [tail]).forEach((n) => t.appendChild(n));
    head.appendChild(t);
  }
  card.appendChild(head);
  const body = el('div', { class: `d-card-body${noPad ? ' no-pad' : ''}` });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((c) => body.appendChild(c));
  card.appendChild(body);
  return card;
}

/* محرّر قوائم (قنوات/رتب): شرائح + إضافة من قائمة منسدلة */
function dListEditor(path, { type = 'channel', placeholder = 'اختر...' } = {}) {
  const wrap = el('div');
  const current = getPath(path) || [];
  const chips = el('div', { class: 'd-chips', style: 'margin-bottom:8px' });

  if (!current.length) chips.appendChild(el('span', { class: 'd-field-label', html: '<span>لا يوجد شيء مضاف بعد.</span>' }));

  current.forEach((id, index) => {
    const found = state.meta.channels.find((c) => c.id === id);
    const label = type === 'channel' ? (found ? (found.type === 4 ? `[قسم] ${found.name}` : `#${found.name}`) : id) : type === 'role' ? nameOfRole(id) : id;
    const chip = el('span', { class: 'd-chip', text: label });
    const remove = el('button', { html: ic('close', 13), title: 'إزالة' });
    remove.addEventListener('click', () => {
      const list = [...(getPath(path) || [])];
      list.splice(index, 1);
      setPath(path, list);
      renderSection(state.section);
    });
    chip.appendChild(remove);
    chips.appendChild(chip);
  });

  const select = el('select', { class: 'd-select' });
  select.appendChild(el('option', { value: '', text: placeholder }));
  const options = type === 'channel' ? channelOptions() : roleOptions();
  options.forEach((o) => select.appendChild(el('option', { value: o.value, text: o.label })));

  const add = el('button', { class: 'd-btn sm', html: `${ic('plus', 15)} إضافة` });
  add.addEventListener('click', () => {
    if (!select.value) return toast('اختر عنصرًا أولًا.', true);
    const list = getPath(path) || [];
    if (list.includes(select.value)) return toast('موجود مسبقًا.', true);
    setPath(path, [...list, select.value]);
    renderSection(state.section);
  });

  wrap.appendChild(chips);
  const controls = el('div', { class: 'd-field-control' });
  controls.appendChild(select);
  controls.appendChild(add);
  wrap.appendChild(controls);
  return wrap;
}

/* محرّر كلمات/إيموجيات (نص حر) */
function dWordEditor(path, { placeholder = 'أضف عنصرًا...', labeler = null } = {}) {
  const wrap = el('div');
  const current = getPath(path) || [];
  const chips = el('div', { class: 'd-chips', style: 'margin-bottom:8px' });
  if (!current.length) chips.appendChild(el('span', { class: 'd-field-label', html: '<span>لا يوجد شيء مضاف بعد.</span>' }));
  current.forEach((value, index) => {
    // القيمة قد تكون إيموجيًا يحدّده المستخدم — تُعرض كبيانات داخل شريحة محاذية
    const chip = el('span', { class: 'd-chip d-chip-value', text: labeler ? labeler(value) : value });
    const remove = el('button', { html: ic('close', 13), title: 'إزالة' });
    remove.addEventListener('click', () => {
      const list = [...(getPath(path) || [])];
      list.splice(index, 1);
      setPath(path, list);
      renderSection(state.section);
    });
    chip.appendChild(remove);
    chips.appendChild(chip);
  });

  const input = el('input', { class: 'd-input', placeholder });
  const add = el('button', { class: 'd-btn sm', html: `${ic('plus', 15)} إضافة` });
  const submit = () => {
    const value = input.value.trim();
    if (!value) return;
    const list = getPath(path) || [];
    if (list.includes(value)) return toast('موجود مسبقًا', true);
    setPath(path, [...list, value]);
    renderSection(state.section);
  };
  add.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  wrap.appendChild(chips);
  const controls = el('div', { class: 'd-field-control' });
  controls.appendChild(input);
  controls.appendChild(add);
  wrap.appendChild(controls);
  return wrap;
}

/* ============================ الأقسام ============================ */
const SECTION_ICONS = {
  overview: 'dashboard',
  general: 'settings',
  welcome: 'userPlus',
  autorole: 'userCog',
  leveling: 'chart',
  automod: 'shield',
  moderation: 'hammer',
  autoline: 'lines',
  autoreact: 'emoticon',
  tickets: 'ticket',
  staffapp: 'clipboard',
  logs: 'scroll',
  data: 'folder',
  top: 'trophy',
  autoReply: 'bubbles',
  commandAliases: 'terminal',
  commandReplies: 'messageEdit',
  commandRoom: 'refresh',
  commandGuide: 'book',
  audit: 'scroll',
  security: 'shield',
  siteMembers: 'key',
};

/** أنماط خط الفاصل (احتياطي — يأتي الكامل من الـAPI) */
const DEFAULT_LINE_STYLES = [
  { key: 'glow', file: 'glow.gif', label: 'توهّج', desc: 'توهّج يمرّ على الخط من اليمين لليسار' },
  { key: 'flow', file: 'flow.gif', label: 'تدفّق', desc: 'تدرّج لوني متدفّق بلا توقّف' },
  { key: 'pulse', file: 'pulse.gif', label: 'نبض', desc: 'إضاءة تنبض بهدوء في المنتصف' },
  { key: 'dash', file: 'dash.gif', label: 'شرطات', desc: 'شرطات تتحرّك على طول الخط' },
];

/* أقسام اللوحة (SECTIONS) انتقلت إلى app-sections.js — يُحمَّل بعد هذا الملف. */


/* الوضع الحالي (ليلي/نهاري) */
function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/* ============================ أدوات داخل الأقسام ============================ */
function testButton(label, action = 'test') {
  const btn = el('button', { class: 'd-btn sm ghost', html: label });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const body = {
        type: state.section,
        /* قناة لوحة التذاكر: المختارة في الحقل المحفوظ (أو الاختيار المؤقّت) */
        channelId: state.section === 'tickets'
          ? (getPath('tickets.panelChannelId') || state.panelChannelId || null)
          : (state.panelChannelId || null),
      };
      const result = await api(`/guilds/${state.guildId}/actions/${action}`, { method: 'POST', body });
      toast(result.message || 'تم الإرسال — راجعه في ديسكورد.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

function setAllLogs(value) {
  const keys = Object.keys(state.meta.logEvents || {});
  keys.forEach((k) => setPath(`logs.events.${k}`, value));
  renderSection('logs');
}

function setGroupLogs(keys, value) {
  keys.forEach((k) => setPath(`logs.events.${k}`, value));
  renderSection('logs');
}

function buildChart() {
  const wrap = el('div', { class: 'd-chart', style: 'padding:6px 2px' });
  const daily = state.daily || [];
  if (!daily.length) return el('div', { class: 'd-empty', html: `<span class="big">${ic('activity', 28)}</span>لا توجد بيانات نشاط بعد.` });
  const max = Math.max(1, ...daily.map((d) => Math.max(d.messages || 0, d.joins || 0)));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${daily.length * 34} 120`);
  /* ارتفاع تلقائي حسب نسبة العرض حتى ما يبقى فراغ letterbox بالجوال */
  svg.setAttribute('style', 'width:100%;height:auto;display:block');
  daily.forEach((d, i) => {
    const hm = Math.max(2, Math.round(((d.messages || 0) / max) * 100));
    const hj = Math.max(2, Math.round(((d.joins || 0) / max) * 100));
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${d.day}: ${d.messages || 0} رسالة • ${d.joins || 0} انضمام`;
    const rm = document.createElementNS(NS, 'rect');
    rm.setAttribute('x', String(i * 34 + 4));
    rm.setAttribute('y', String(110 - hm));
    rm.setAttribute('width', '13');
    rm.setAttribute('height', String(hm));
    rm.setAttribute('rx', '4');
    rm.setAttribute('fill', '#5865f2');
    rm.setAttribute('class', 'bar-msg');
    rm.appendChild(title.cloneNode(true));
    const rj = document.createElementNS(NS, 'rect');
    rj.setAttribute('x', String(i * 34 + 19));
    rj.setAttribute('y', String(110 - hj));
    rj.setAttribute('width', '13');
    rj.setAttribute('height', String(hj));
    rj.setAttribute('rx', '4');
    rj.setAttribute('fill', '#23a55a');
    rj.setAttribute('class', 'bar-join');
    rj.appendChild(title);
    svg.appendChild(rm);
    svg.appendChild(rj);
  });
  wrap.appendChild(svg);
  wrap.appendChild(
    el('div', {
      class: 'muted',
      style: 'font-size:.8rem;margin-top:6px;display:flex;gap:16px;align-items:center',
      html: `<span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:#5865f2"></i> الرسائل</span><span style="display:inline-flex;align-items:center;gap:5px"><i style="width:10px;height:10px;border-radius:3px;background:#23a55a"></i> الأعضاء الجدد</span>`,
    }),
  );
  return wrap;
}

/* تحويل آيديات إلى أسماء أعضاء */
async function resolveMembers(ids) {
  const unique = [...new Set((ids || []).filter((id) => id && /^\d{15,25}$/.test(String(id))))].slice(0, 80);
  if (!unique.length) return new Map();
  try {
    const data = await api(`/guilds/${state.guildId}/members?ids=${unique.join(',')}`);
    return new Map(data.members.map((m) => [m.id, m]));
  } catch {
    return new Map();
  }
}

function memberCell(map, id) {
  const member = map.get(String(id));
  const cell = el('div', { class: 'd-member' });
  if (member?.avatar) cell.appendChild(el('img', { src: member.avatar, alt: '' }));
  const txt = el('div');
  txt.appendChild(el('div', { class: 'nm', text: member?.displayName || member?.username || String(id) }));
  txt.appendChild(el('div', { class: 'tg', text: member?.username ? `@${member.username}` : String(id) }));
  cell.appendChild(txt);
  return cell;
}

async function loadDataView(box, view) {
  box.innerHTML = '<div class="d-empty">جارٍ التحميل…</div>';
  try {
    if (view === 'cases') {
      const data = await api(`/guilds/${state.guildId}/cases?perPage=25`);
      if (!data.items.length) return (box.innerHTML = '<div class="d-empty"><span class="big">لا توجد حالات مسجّلة بعد.</span></div>');
      const members = await resolveMembers(data.items.flatMap((c) => [c.user_id, c.moderator_id]));
      const TYPES = { warn: 'تحذير', ban: 'حظر', unban: 'فك حظر', kick: 'طرد', timeout: 'إسكات', untimeout: 'فك إسكات', ticket: 'تذكرة', automod: 'حماية تلقائية' };
      const table = el('table', { class: 'd-table' });
      table.appendChild(
        el('thead', {}, '<tr><th>#</th><th>النوع</th><th>العضو</th><th>السبب</th><th>بواسطة</th><th>التاريخ</th></tr>'),
      );
      const body = el('tbody');
      data.items.forEach((c) => {
        const tr = el('tr');
        tr.appendChild(el('td', { html: `<code>#${c.id}</code>` }));
        tr.appendChild(el('td', { text: TYPES[c.type] || c.type }));
        const u = el('td'); u.appendChild(memberCell(members, c.user_id)); tr.appendChild(u);
        tr.appendChild(el('td', { text: c.reason || '—' }));
        const m = el('td'); m.appendChild(memberCell(members, c.moderator_id)); tr.appendChild(m);
        tr.appendChild(el('td', { text: new Date(c.created_at).toLocaleString('ar-EG') }));
        body.appendChild(tr);
      });
      table.appendChild(body);
      box.innerHTML = '';
      const card1 = el('div', { class: 'd-card' });
      const wrap1 = el('div', { class: 'd-table-wrap' });
      wrap1.appendChild(table);
      card1.appendChild(wrap1);
      box.appendChild(card1);
      box.appendChild(el('div', { class: 'muted', style: 'margin-top:8px;font-size:.82rem', text: `الإجمالي: ${data.total} حالة — تُعرض ${data.items.length}` }));
      return;
    }

    if (view === 'tickets') {
      const data = await api(`/guilds/${state.guildId}/tickets?limit=50`);
      if (!data.items.length) return (box.innerHTML = '<div class="d-empty">لا توجد تذاكر بعد.</div>');
      const typeLabels = new Map((state.settings.tickets.types || []).map((t) => [t.id, t.label]));
      const members = await resolveMembers(data.items.map((t) => t.user_id));
      const table = el('table', { class: 'd-table' });
      table.appendChild(el('thead', {}, '<tr><th>#</th><th>النوع</th><th>صاحب التذكرة</th><th>الحالة</th><th>التاريخ</th><th></th></tr>'));
      const body = el('tbody');
      data.items.forEach((t) => {
        const tr = el('tr');
        tr.appendChild(el('td', { html: `<code>#${t.id}</code>` }));
        tr.appendChild(el('td', { text: typeLabels.get(t.type) || t.type }));
        const u = el('td'); u.appendChild(memberCell(members, t.user_id)); tr.appendChild(u);
        tr.appendChild(el('td', { html: t.status === 'open' ? '<span class="state-on">مفتوحة</span>' : '<span class="state-off">مغلقة</span>' }));
        tr.appendChild(el('td', { text: new Date(t.created_at).toLocaleString('ar-EG') }));
        const acts = el('td');
        if (t.status === 'open') {
          const btn = el('button', { class: 'd-btn sm danger', html: 'إغلاق' });
          btn.addEventListener('click', async () => {
            try {
              await api(`/guilds/${state.guildId}/tickets/${t.id}/close`, { method: 'POST', body: {} });
              toast(`أُغلقت التذكرة #${t.id}.`);
              loadDataView(box, 'tickets');
            } catch (err) {
              toast(err.message, true);
            }
          });
          acts.appendChild(btn);
        }
        tr.appendChild(acts);
        body.appendChild(tr);
      });
      table.appendChild(body);
      box.innerHTML = '';
      const card = el('div', { class: 'd-card' });
      const wrap = el('div', { class: 'd-table-wrap' });
      wrap.appendChild(table);
      card.appendChild(wrap);
      box.appendChild(card);
      return;
    }

    const data = await api(`/guilds/${state.guildId}/levels?perPage=25`);
    if (!data.items.length) return (box.innerHTML = '<div class="d-empty">لا يوجد أعضاء بمستويات بعد.</div>');
    const members = await resolveMembers(data.items.map((l) => l.user_id));
    const table = el('table', { class: 'd-table' });
    table.appendChild(el('thead', {}, '<tr><th>الترتيب</th><th>العضو</th><th>المستوى</th><th>الخبرة</th><th>الرسائل</th></tr>'));
    const body = el('tbody');
    data.items.forEach((l, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', { html: i < 3 ? `<b class="rank rank-${i + 1}">${i + 1}</b>` : `<code>${i + 1}</code>` }));
      const u = el('td'); u.appendChild(memberCell(members, l.user_id)); tr.appendChild(u);
      tr.appendChild(el('td', { html: `<b>${l.level}</b>` }));
      tr.appendChild(el('td', { text: Number(l.xp).toLocaleString('ar-EG') }));
      tr.appendChild(el('td', { text: Number(l.messages || 0).toLocaleString('ar-EG') }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    box.innerHTML = '';
    const card = el('div', { class: 'd-card' });
    const wrap = el('div', { class: 'd-table-wrap' });
    wrap.appendChild(table);
    card.appendChild(wrap);
    box.appendChild(card);
  } catch (err) {
    box.innerHTML = `<div class="d-empty">تعذّر التحميل: ${esc(err.message)}</div>`;
  }
}

/* ============================ لوحة المتصدّرين ============================ */
async function loadTopBoard(note, box) {
  try {
    const period = state.topPeriod || 'day';
    const source = state.topSource || 'all';
    const data = await api(`/guilds/${state.guildId}/levels?period=${period}&source=${source}&perPage=25`);

    const labels = { day: 'اليوم', week: 'هذا الأسبوع', all: 'كل الأوقات' };
    const sourceLabels = { all: 'كل المصادر', text: 'كتابي فقط', voice: 'صوتي فقط', interact: 'تفاعل فقط' };
    const totals = data.totals || {};
    const stats = el('div', { class: 'd-stats' });
    [
      ['chart', (totals.xp || 0).toLocaleString('ar-EG'), `خبرة ${labels[period] || ''}`],
      ['message', (totals.text_xp || 0).toLocaleString('ar-EG'), 'كتابي'],
      ['speaker', (totals.voice_xp || 0).toLocaleString('ar-EG'), 'صوتي'],
      ['activity', (totals.interact_xp || 0).toLocaleString('ar-EG'), 'تفاعل'],
      ['users', (data.total || 0).toLocaleString('ar-EG'), `مشارك — ${sourceLabels[source]}`],
    ].forEach(([iconName, value, label]) => {
      const card = el('div', { class: 'd-stat' });
      card.appendChild(el('b', { text: value }));
      card.appendChild(el('span', { html: `${ic(iconName, 15)} ${label}` }));
      stats.appendChild(card);
    });

    note.innerHTML = '';
    note.appendChild(stats);
    note.appendChild(
      el('div', {
        class: 'd-top-meta',
        html: `${ic('clock', 14)} <span>${esc(data.reset || '')}</span> <span class="dot">·</span> <span>مفتاح الفترة: <code>${esc(data.periodKey || 'عام')}</code></span>`,
      }),
    );

    if (!data.items.length) {
      box.innerHTML = '';
      box.appendChild(el('div', { class: 'd-empty', text: 'ما في بيانات لهذه الفترة بعد.' }));
      return;
    }

    const members = await resolveMembers(data.items.map((l) => l.user_id));
    const table = el('table', { class: 'd-table' });
    table.appendChild(
      el('thead', {}, '<tr><th>الترتيب</th><th>العضو</th><th>خبرة الفترة</th><th>كتابي</th><th>صوتي</th><th>تفاعل</th><th>المستوى</th></tr>'),
    );
    const body = el('tbody');
    data.items.forEach((l, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', { html: i < 3 ? `<b class="rank rank-${i + 1}">${i + 1}</b>` : `<code>${i + 1}</code>` }));
      const u = el('td');
      u.appendChild(memberCell(members, l.user_id));
      tr.appendChild(u);
      tr.appendChild(el('td', { html: `<b>${Number(l.xp).toLocaleString('ar-EG')}</b>` }));
      tr.appendChild(el('td', { text: Number(l.text_xp || 0).toLocaleString('ar-EG') }));
      tr.appendChild(el('td', { text: Number(l.voice_xp || 0).toLocaleString('ar-EG') }));
      tr.appendChild(el('td', { text: Number(l.interact_xp || 0).toLocaleString('ar-EG') }));
      tr.appendChild(el('td', { html: `<code>${l.level}</code>` }));
      body.appendChild(tr);
    });
    table.appendChild(body);

    box.innerHTML = '';
    const card = el('div', { class: 'd-card' });
    const wrapEl = el('div', { class: 'd-table-wrap' });
    wrapEl.appendChild(table);
    card.appendChild(wrapEl);
    box.appendChild(card);
  } catch (err) {
    box.innerHTML = `<div class="d-empty">تعذّر التحميل: ${esc(err.message)}</div>`;
  }
}

/* ============================ مكتبة الأوامر ============================ */

/** بطاقة شرح أمر واحد: شو يعمل · كيف تكتبه · أمثلة تنسخها · أوامره الفرعية */
function guideCard(item) {
  const card = el('div', { class: 'guide-card' });

  const head = el('div', { class: 'guide-head' });
  head.appendChild(el('code', { class: 'guide-name', text: item.name }));
  head.appendChild(el('b', { text: item.label || '' }));
  if (item.audienceBadge) {
    head.appendChild(el('span', {
      class: `cmd-tag ${item.audience === 'member' ? 'ok' : 'lock'}`,
      text: item.audienceBadge,
    }));
  }
  if (!item.text) head.appendChild(el('span', { class: 'cmd-tag warn', text: 'سلاش فقط' }));
  card.appendChild(head);
  card.appendChild(el('p', { class: 'guide-what', text: item.what }));

  /* كيف تكتبه */
  const how = el('div', { class: 'guide-block' });
  how.appendChild(el('span', { class: 'guide-label', text: 'كيف تكتبه' }));
  const code = el('code', { class: 'guide-usage', dir: 'ltr', text: (item.usage || []).join('\n') });
  how.appendChild(code);
  const copy = el('button', { class: 'guide-copy', html: `${ic('save', 13)} نسخ` });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText((item.usage || []).join('\n'));
      copy.innerHTML = `${ic('check', 13)} تم النسخ`;
      setTimeout(() => { copy.innerHTML = `${ic('save', 13)} نسخ`; }, 1600);
    } catch {
      copy.innerHTML = `${ic('close', 13)} تعذّر النسخ`;
    }
  });
  how.appendChild(copy);
  card.appendChild(how);

  /* أمثلة */
  if (item.examples?.length) {
    const ex = el('div', { class: 'guide-block' });
    ex.appendChild(el('span', { class: 'guide-label', text: 'أمثلة جاهزة' }));
    const list = el('div', { class: 'guide-examples' });
    item.examples.forEach((example) => {
      const row = el('div', { class: 'guide-ex' });
      row.appendChild(el('code', { dir: 'ltr', text: example }));
      const btn = el('button', { class: 'guide-copy', html: `${ic('save', 12)}` , title: 'نسخ المثال' });
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(example);
          btn.innerHTML = ic('check', 12);
          setTimeout(() => { btn.innerHTML = ic('save', 12); }, 1500);
        } catch { toast('تعذّر النسخ من المتصفح', true); }
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
    ex.appendChild(list);
    card.appendChild(ex);
  }

  /* الأوامر الفرعية */
  if (item.subs && Object.keys(item.subs).length) {
    const subs = el('div', { class: 'guide-block' });
    subs.appendChild(el('span', { class: 'guide-label', text: `أوامره الفرعية (${Object.keys(item.subs).length})` }));
    const list = el('div', { class: 'guide-subs' });
    Object.entries(item.subs).forEach(([name, desc]) => {
      const row = el('div', { class: 'guide-sub' });
      row.appendChild(el('code', { dir: 'ltr', text: name }));
      row.appendChild(el('span', { text: desc }));
      list.appendChild(row);
    });
    subs.appendChild(list);
    card.appendChild(subs);
  }

  card.appendChild(el('div', {
    class: 'guide-foot',
    html: `<span>${ic('lock', 12)} ${esc(item.perm || 'للجميع')}</span><span>${ic('bolt', 12)} ${item.text ? 'بلا بريفيكست' : 'سلاش فقط'}</span>`,
  }));

  return card;
}

/* ============================ حماية الموقع (للمالك) ============================ */

async function loadSecurity(note, box) {
  note.innerHTML = '';
  note.appendChild(el('div', {
    class: 'd-readonly-note',
    html: `${ic('shield', 15)} <span>الزائر ما يشوف بيانات السيرفر ولا الحسابات. مسارات الفحص المعروفة تنحجب، وما في أي ملف خبيث ينرسل له.</span>`,
  }));
  try {
    const data = await api('/admin/security');

    const cards = el('div', { class: 'd-stats' });
    [
      ['shield', (data.counts?.audit || 0).toLocaleString('ar-EG'), 'حدث في السجل'],
      ['ban', data.banned || 0, 'حساب محظور'],
      ['eye', data.viewOnly || 0, 'مشاهدة فقط'],
      ['warning', (data.auditBySeverity?.danger || 0) + (data.auditBySeverity?.warn || 0), 'تنبيهات وخطير'],
    ].forEach(([icon, value, label]) => {
      const card = el('div', { class: 'd-stat' });
      card.appendChild(el('b', { text: String(value) }));
      card.appendChild(el('span', { html: `${ic(icon, 15)} ${label}` }));
      cards.appendChild(card);
    });
    note.appendChild(cards);

    box.innerHTML = '';
    const list = el('div', { class: 'sec-list' });
    (data.checks || []).forEach((check) => {
      const row = el('div', { class: `sec-row${check.ok ? '' : ' off'}` });
      row.appendChild(el('span', { class: 'sec-ico', html: ic(check.ok ? 'badgeCheck' : 'close', 17) }));
      const txt = el('div');
      txt.appendChild(el('b', { text: check.label }));
      txt.appendChild(el('span', { text: check.detail }));
      row.appendChild(txt);
      list.appendChild(row);
    });
    box.appendChild(el('h3', { class: 'sec-title', html: `${ic('shield', 17)} الحمايات المفعّلة (${(data.checks || []).length})` }));
    box.appendChild(list);

    /* نسخة احتياطية */
    const backup = el('div', { class: 'sec-backup' });
    backup.appendChild(el('div', { class: 'sec-backup-txt', html: `${ic('save', 17)} <div><b>نسخة احتياطية كاملة</b><span>كل السيرفرات وإعداداتها · المستويات والخبرة · العقوبات · التذاكر · سجل الأعضاء · سجل النشاط — ملف JSON واحد.</span></div>` }));
    const dl = el('a', { class: 'd-btn primary', href: '/api/admin/backup', html: `${ic('upload', 15)} تنزيل النسخة` });
    backup.appendChild(dl);
    box.appendChild(backup);

    /* سجل الموقع (آخر الأحداث الحسّاسة) */
    const site = await api('/admin/audit?limit=12&scope=site');
    if (site.items?.length) {
      const table = el('table', { class: 'd-table' });
      table.appendChild(el('thead', {}, '<tr><th>الحدث</th><th>ماذا صار</th><th>الوقت</th></tr>'));
      const body = el('tbody');
      site.items.forEach((row) => {
        const tr = el('tr', { class: row.severity === 'danger' ? 'au-danger' : row.severity === 'warn' ? 'au-warn' : '' });
        tr.appendChild(el('td', { html: `<span class="au-badge ${row.severity}">${esc(row.label)}</span>` }));
        tr.appendChild(el('td', { html: `<span class="au-detail">${esc(row.detail || '—')}</span>` }));
        tr.appendChild(el('td', { html: `<span class="au-time">${esc(sinceArabic(row.at))}</span>` }));
        body.appendChild(tr);
      });
      table.appendChild(body);
      box.appendChild(el('h3', { class: 'sec-title', html: `${ic('scroll', 17)} آخر أحداث الموقع` }));
      const wrapTable = el('div', { class: 'd-table-wrap' });
      wrapTable.appendChild(table);
      box.appendChild(wrapTable);
    }
  } catch (err) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'd-empty', text: err.message }));
  }
}

/* ============================ أعضاء الموقع (للمالك) ============================ */
const SITE_STATUS_LABEL = { active: 'نشِط', viewonly: 'مشاهدة فقط', banned: 'محظور' };

function sinceArabic(ts) {
  if (!ts) return '—';
  const diff = Date.now() - Number(ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return new Date(Number(ts)).toLocaleDateString('ar-EG');
}

async function loadSiteMembers(note, box) {
  try {
    const data = await api('/admin/members');
    const stats = data.stats || {};

    const cards = el('div', { class: 'd-stats' });
    [
      ['users', (stats.total || 0).toLocaleString('ar-EG'), 'إجمالي الحسابات'],
      ['userPlus', (stats.waiting || 0).toLocaleString('ar-EG'), 'بانتظار السماح'],
      ['activity', (stats.onlineToday || 0).toLocaleString('ar-EG'), 'نشِط آخر ٢٤ ساعة'],
      ['eye', (stats.byStatus?.viewonly || 0).toLocaleString('ar-EG'), 'مشاهدة فقط'],
      ['ban', (stats.byStatus?.banned || 0).toLocaleString('ar-EG'), 'محظور'],
      ['refresh', (stats.totalVisits || 0).toLocaleString('ar-EG'), 'إجمالي الزيارات'],
    ].forEach(([iconName, value, label]) => {
      const card = el('div', { class: 'd-stat' });
      card.appendChild(el('b', { text: String(value) }));
      card.appendChild(el('span', { html: `${ic(iconName, 15)} ${label}` }));
      cards.appendChild(card);
    });
    note.innerHTML = '';
    note.appendChild(
      el('div', {
        class: 'd-readonly-note',
        html: `${ic('shield', 15)} <span>هالقائمة تظهر لك فقط. اللي يحاول يدخل يتسجل هنا، وما يفتح الموقع إلا بعد ما تضيفه.</span>`,
      }),
    );
    note.appendChild(cards);

    const form = el('form', { class: 'sm-add' });
    const input = el('input', {
      class: 'd-input',
      type: 'text',
      placeholder: 'آيدي ديسكورد',
      inputmode: 'numeric',
      autocomplete: 'off',
    });
    const addBtn = el('button', { class: 'd-btn', type: 'submit', html: `${ic('userPlus', 14)} إضافة للدخول` });
    form.appendChild(input);
    form.appendChild(addBtn);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      addBtn.disabled = true;
      try {
        await api('/admin/members', { method: 'POST', body: { id: input.value.trim() } });
        toast('تمت الإضافة — يقدر يدخل الموقع');
        renderSection('siteMembers');
      } catch (err) {
        toast(err.message, true);
      } finally {
        addBtn.disabled = false;
      }
    });
    note.appendChild(form);

    if (!data.members.length) {
      box.innerHTML = '';
      box.appendChild(el('div', { class: 'd-empty', text: 'ما في طلبات بعد. أضف آيدي من فوق، أو خلّ الشخص يحاول يدخل ويظهر هنا.' }));
      return;
    }

    const table = el('table', { class: 'd-table' });
    table.appendChild(el('thead', {}, '<tr><th>العضو</th><th>الحالة</th><th>آخر ظهور</th><th>الزيارات</th><th>سيرفراته</th><th>التحكم</th></tr>'));
    const body = el('tbody');

    data.members.forEach((m) => {
      const tr = el('tr', { class: m.status === 'banned' ? 'sm-banned' : '' });

      /* العضو */
      const who = el('td');
      const line = el('div', { class: 'sm-who' });
      line.appendChild(el('span', { class: 'sm-av', text: (m.globalName || m.username || '؟').trim().charAt(0).toUpperCase() }));
      const names = el('div');
      names.appendChild(el('b', { text: m.globalName || m.username || m.id }));
      names.appendChild(el('span', { class: 'sm-id', text: `${m.isOwner ? 'مالك الموقع · ' : ''}${m.id}` }));
      line.appendChild(names);
      who.appendChild(line);
      tr.appendChild(who);

      /* الحالة */
      const wait = !m.isOwner && !m.allowed && m.status !== 'banned';
      const badge = wait
        ? '<span class="sm-badge sm-wait">بانتظار السماح</span>'
        : `<span class="sm-badge sm-${esc(m.status)}">${esc(SITE_STATUS_LABEL[m.status] || m.status)}</span>`;
      tr.appendChild(el('td', { html: badge }));

      /* آخر ظهور */
      tr.appendChild(el('td', { text: sinceArabic(m.lastSeen) }));

      /* الزيارات */
      tr.appendChild(el('td', { html: `<code>${Number(m.visits || 0).toLocaleString('ar-EG')}</code>` }));

      /* سيرفراته */
      tr.appendChild(el('td', { html: `<code>${Number(m.guilds || 0)}</code>` }));

      /* التحكم */
      const actions = el('td');
      const group = el('div', { class: 'sm-actions' });
      if (m.isOwner) {
        group.appendChild(el('span', { class: 'sm-locked', html: `${ic('lock', 14)} حسابك` }));
      } else if (!data.canManage) {
        group.appendChild(el('span', { class: 'sm-locked', html: `${ic('info', 14)} وضع العرض` }));
      } else {
        const setStatus = async (status, btn) => {
          btn.disabled = true;
          try {
            const reason = status === 'banned' ? (window.prompt('سبب الحظر (اختياري):', '') || '') : '';
            const res = await api(`/admin/members/${m.id}/status`, { method: 'POST', body: { status, reason } });
            toast(res.message || 'تم التحديث');
            renderSection('siteMembers');
          } catch (err) {
            toast(err.message, true);
          } finally {
            btn.disabled = false;
          }
        };

        if (!m.allowed) {
          const allow = el('button', { class: 'd-btn sm', html: `${ic('check', 14)} السماح بالدخول` });
          allow.addEventListener('click', async () => {
            allow.disabled = true;
            try {
              await api('/admin/members', { method: 'POST', body: { id: m.id } });
              toast('صار يقدر يدخل');
              renderSection('siteMembers');
            } catch (err) {
              toast(err.message, true);
            } finally {
              allow.disabled = false;
            }
          });
          group.appendChild(allow);
        }
        if (m.status !== 'active') {
          const b = el('button', { class: 'd-btn sm', html: `${ic('check', 14)} نشِط` });
          b.addEventListener('click', () => setStatus('active', b));
          group.appendChild(b);
        }
        if (m.status !== 'viewonly') {
          const b = el('button', { class: 'd-btn sm', html: `${ic('eye', 14)} مشاهدة فقط` });
          b.addEventListener('click', () => setStatus('viewonly', b));
          group.appendChild(b);
        }
        if (m.status !== 'banned') {
          const b = el('button', { class: 'd-btn sm danger', html: `${ic('ban', 14)} حظر` });
          b.addEventListener('click', () => setStatus('banned', b));
          group.appendChild(b);
        }
        const kick = el('button', { class: 'd-btn sm ghost', html: `${ic('logout', 14)} قطع الجلسة` });
        kick.addEventListener('click', async () => {
          kick.disabled = true;
          try {
            const res = await api(`/admin/members/${m.id}/kick`, { method: 'POST' });
            toast(res.message || 'تم');
          } catch (err) {
            toast(err.message, true);
          } finally {
            kick.disabled = false;
          }
        });
        group.appendChild(kick);
      }
      actions.appendChild(group);
      tr.appendChild(actions);

      body.appendChild(tr);
    });

    table.appendChild(body);
    box.innerHTML = '';
    const card = el('div', { class: 'd-card' });
    const wrapEl = el('div', { class: 'd-table-wrap' });
    wrapEl.appendChild(table);
    card.appendChild(wrapEl);
    box.appendChild(card);
  } catch (err) {
    note.innerHTML = '';
    box.innerHTML = '';
    box.appendChild(
      el('div', { class: 'd-empty', html: `${ic('ban', 15)} تعذّر التحميل: ${esc(err.message)}` }),
    );
  }
}

/* ============================ الهيكل العام (هيكل بروبوت) ============================ */
/* عام ثم إعدادات الوحدات — نفس ترتيب لوحة ProBot، بأسماء أقسامنا */
const NAV_GROUPS = [
  { title: 'عام', ids: ['overview', 'general', 'commandGuide'] },
  {
    title: 'إعدادات الوحدات',
    ids: [
      'moderation', 'automod', 'welcome', 'autoReply', 'leveling', 'logs',
      'autorole', 'autoreact', 'autoline', 'tickets', 'staffapp', 'top',
      'commandRoom', 'commandAliases', 'commandReplies',
    ],
  },
  { title: 'البيانات', ids: ['audit', 'data'] },
  { title: 'إدارة الموقع', ids: ['security', 'siteMembers'], ownerOnly: true },
];

/** مفتاح التفعيل لكل وحدة — النقطة الخضراء ومفتاح أعلى الصفحة */
const MODULE_TOGGLE = {
  welcome: 'welcome.enabled',
  autorole: 'autorole.enabled',
  leveling: 'leveling.enabled',
  automod: 'automod.enabled',
  autoline: 'autoline.enabled',
  autoreact: 'autoreact.enabled',
  tickets: 'tickets.enabled',
  staffapp: 'staffApplication.enabled',
  logs: 'logs.enabled',
  autoReply: 'autoReply.enabled',
  commandRoom: 'commandRoom.enabled',
};

function drawerMode() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function closeSide() {
  document.body.classList.remove('side-open');
}

function toggleSide() {
  document.body.classList.toggle('side-open');
}

function buildSidebar() {
  const side = el('aside', { class: 'd-side' });

  const closeBtn = el('button', { class: 'd-side-close', type: 'button', title: 'إغلاق', html: ic('close', 16) });
  closeBtn.addEventListener('click', closeSide);
  side.appendChild(closeBtn);

  const server = el('a', { class: 'd-server', href: '/dashboard', title: 'كل السيرفرات' });
  const headIcon = guildIconUrl(state.guild.id, state.guild.icon, 64);
  if (headIcon) {
    const img = el('img', { src: headIcon, alt: '' });
    img.addEventListener('error', () => img.replaceWith(iconFallback(state.guild?.name)));
    server.appendChild(img);
  } else {
    server.appendChild(iconFallback(state.guild?.name));
  }
  const serverInfo = el('div', { class: 'd-server-info' });
  serverInfo.appendChild(el('b', { text: state.guild?.name || 'السيرفر' }));
  serverInfo.appendChild(el('span', { text: `${(state.guild?.memberCount || 0).toLocaleString('ar-EG')} عضو` }));
  server.appendChild(serverInfo);
  server.appendChild(el('span', { class: 'chev', html: ic('chevronRight', 14) }));
  side.appendChild(server);

  const search = el('div', { class: 'd-search' });
  search.appendChild(el('span', { class: 'ico', html: ic('search', 16) }));
  const searchInput = el('input', { type: 'text', placeholder: 'ابحث عن وحدة...' });
  search.appendChild(searchInput);
  side.appendChild(search);

  const nav = el('nav', { class: 'd-nav' });
  const items = [];
  const used = new Set();

  const paintGroup = (title, entries) => {
    if (!entries.length) return;
    const groupWrap = el('div', { class: 'd-group' });
    const titleBtn = el('button', { class: 'd-group-title', type: 'button' });
    titleBtn.appendChild(el('span', { class: 'chev', html: ic('chevronRight', 12) }));
    titleBtn.appendChild(el('span', { text: title }));
    titleBtn.addEventListener('click', () => groupWrap.classList.toggle('collapsed'));
    groupWrap.appendChild(titleBtn);
    entries.forEach(([id, section]) => {
      const item = el('div', { class: 'd-nav-item', 'data-id': id, title: section.label });
      item.appendChild(el('span', { class: 'ico', html: ic(SECTION_ICONS[id] || 'circle', 18) }));
      item.appendChild(el('span', { class: 'd-nav-label', text: section.label }));
      item.appendChild(el('span', { class: 'dot', html: ic('check', 11) }));
      item.addEventListener('click', () => {
        state.section = id;
        renderSection(id);
        if (window.history?.replaceState) window.history.replaceState(null, '', `#${id}`);
        if (drawerMode()) closeSide();
      });
      groupWrap.appendChild(item);
      items.push({ item, id, label: section.label, group: title });
    });
    nav.appendChild(groupWrap);
  };

  NAV_GROUPS.forEach((group) => {
    if (group.ownerOnly && !state.isOwner) return;
    const entries = group.ids
      .filter((id) => {
        const s = SECTIONS[id];
        if (!s) return false;
        if (s.ownerOnly && !state.isOwner) return false;
        return true;
      })
      .map((id) => {
        used.add(id);
        return [id, SECTIONS[id]];
      });
    paintGroup(group.title, entries);
  });
  const rest = Object.entries(SECTIONS).filter(([id, section]) => !used.has(id) && !(section.ownerOnly && !state.isOwner));
  paintGroup('أخرى', rest);

  side.appendChild(nav);

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    items.forEach(({ item, label, group }) => {
      const match = !q || label.toLowerCase().includes(q) || group.toLowerCase().includes(q);
      item.style.display = match ? '' : 'none';
    });
    nav.querySelectorAll('.d-group').forEach((g) => {
      const visible = [...g.querySelectorAll('.d-nav-item')].some((i) => i.style.display !== 'none');
      g.style.display = visible ? '' : 'none';
    });
  });

  return { side, items };
}

function buildHeader() {
  const head = el('div', { class: 'd-head d-topbar' });
  const menuBtn = el('button', { class: 'd-btn ghost sm d-side-toggle', type: 'button', title: 'الأقسام', html: `${ic('lines', 16)} الأقسام` });
  menuBtn.addEventListener('click', toggleSide);
  head.appendChild(menuBtn);
  const brand = el('a', { class: 'd-top-brand', href: '/', html: `${logoMark(22)} <span>Never<span class="accent">Land</span></span>` });
  head.appendChild(brand);
  const status = el('span', {
    class: `d-top-status ${state.guild.botOnline ? 'state-on' : 'state-off'}`,
    text: state.guild.botOnline ? 'البوت متصل' : 'البوت غير متصل',
  });
  head.appendChild(status);

  const actions = el('div', { class: 'd-head-actions' });
  const themeBtn = el('button', { class: 'd-btn ghost sm' });
  const themeMode = () => {
    try {
      const saved = localStorage.getItem('neverland-theme');
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    } catch { return 'auto'; }
  };
  const paintTheme = () => {
    const mode = themeMode();
    const shown = mode === 'auto' ? currentTheme() : mode;
    const label = mode === 'auto' ? 'حسب الجهاز' : shown === 'light' ? 'الوضع النهاري' : 'الوضع الليلي';
    themeBtn.innerHTML = `${ic(mode === 'auto' ? 'refresh' : shown === 'light' ? 'sun' : 'moon', 16)} ${label}`;
    themeBtn.title = 'السمة: ' + label + ' — اضغط للتبديل';
  };
  paintTheme();
  themeBtn.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    const next = order[themeMode()];
    try {
      if (next === 'auto') localStorage.removeItem('neverland-theme');
      else localStorage.setItem('neverland-theme', next);
    } catch { /* تجاهل */ }
    document.documentElement.dataset.theme = next === 'auto' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : next;
    paintTheme();
  });
  actions.appendChild(themeBtn);

  const refresh = el('button', { class: 'd-btn ghost sm', html: `${ic('refresh', 16)} تحديث` });
  refresh.addEventListener('click', () => boot());
  actions.appendChild(refresh);
  head.appendChild(actions);
  return head;
}

/* معاينة محلية لنص الرد (نفس منطق البوت مبسّط للعرض فقط) */
function pickLocalReply(reply) {
  const variants = String(reply || '').split('|').map((p) => p.trim()).filter(Boolean);
  return variants.length ? variants[0] : '';
}

function applyLocalVars(text, guild) {
  return String(text || '')
    .split('{user}').join('@العضو')
    .split('{name}').join('اسم العضو')
    .split('{server}').join(guild?.name || 'السيرفر')
    .split('{channel}').join('#الروم');
}

function renderSection(id) {
  const section = SECTIONS[id];
  if (!section) return;

  document.querySelectorAll('.d-nav-item').forEach((i) => i.classList.toggle('active', i.dataset.id === id));
  const content = document.getElementById('d-content');
  content.innerHTML = '';
  const iconName = SECTION_ICONS[id] || 'circle';
  const moduleHead = el('div', { class: 'd-module-head' });
  moduleHead.appendChild(el('h2', { class: 'd-page-title', html: `${ic(iconName, 22)} <span>${esc(section.title)}</span>` }));
  const toggleKey = MODULE_TOGGLE[id];
  if (toggleKey && state.canEdit) {
    const toggleBox = el('div', { class: 'd-module-switch' });
    const toggleLabel = el('span', { text: getPath(toggleKey) ? 'مفعّل' : 'متوقف' });
    toggleBox.appendChild(toggleLabel);
    toggleBox.appendChild(dSwitch(toggleKey, (on) => {
      toggleLabel.textContent = on ? 'مفعّل' : 'متوقف';
      updateDots(window.__dashItems || []);
    }));
    moduleHead.appendChild(toggleBox);
  }
  content.classList.remove('is-entering');
  void content.offsetWidth;
  content.classList.add('is-entering');
  content.appendChild(moduleHead);
  /* الوصف يقدر يكون نصًا ثابتًا أو دالة (لعدّادات تتغيّر مثل عدد الأحداث) */
  content.appendChild(el('p', { class: 'd-page-desc', html: typeof section.desc === 'function' ? section.desc() : section.desc }));

  // كل قسم يقدر يرجّع عنصرًا واحدًا أو مصفوفة عناصر أو Fragment
  const output = section.render();
  (Array.isArray(output) ? output : [output]).filter(Boolean).forEach((node) => content.appendChild(node));
  if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  if (window.NL && window.NL.refresh) window.NL.refresh();
}

function updateDots(items) {
  items.forEach(({ item, id }) => {
    const dot = item.querySelector('.dot');
    if (!dot) return;
    const key = MODULE_TOGGLE[id];
    if (!key) {
      dot.style.display = 'none';
      return;
    }
    const on = Boolean(getPath(key));
    dot.style.display = on ? '' : 'none';
    dot.classList.toggle('off', !on);
  });
}

/* ============================ أيقونات ديسكورد ============================ */

/**
 * رابط أيقونة سيرفر آمن: يقبل هاشًا أو رابطًا كاملًا (ويتعامل مع المتحرك a_).
 * يمنع تكرار البادئة الذي كان يُنتج صورة مكسورة.
 */
function guildIconUrl(guildId, icon, size = 128) {
  if (!icon || !guildId) return null;
  const v = String(icon).trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const ext = v.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${v}.${ext}?size=${size}`;
}

/** بديل مصوّر عند فشل تحميل الصورة (أحرف أولى) */
function iconFallback(name) {
  return el('div', { class: 'guild-icon placeholder', text: initialsOf(name) });
}

/** الأحرف الأولى من الاسم */
function initialsOf(name) {
  const clean = String(name || '?').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]);
  return clean.slice(0, 2);
}

/* ============================ المزامنة الحيّة ============================ */

/** صياغة «قبل كم» بالعربية */
function sinceText(ts) {
  if (!ts) return 'لم تتم المزامنة بعد';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'قبل لحظات';
  const m = Math.round(s / 60);
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  return `قبل ${Math.round(h / 24)} يوم`;
}

/** شريط يعرض آخر مزامنة مع ديسكورد + زر مزامنة فورية */
function buildSyncBar() {
  const bar = el('div', { class: 'd-syncbar' });
  const info = el('span', { class: 'd-sync-info' });

  const paint = (st) => {
    const s = st || state.sync || {};
    info.innerHTML = `${ic('refresh', 15)} <b>آخر مزامنة مع ديسكورد:</b> <span class="sync-when">${esc(sinceText(s.at))}</span>`;
  };
  paint();
  bar.appendChild(info);

  if (state.canEdit) {
    const btn = el('button', { class: 'd-btn ghost sm', html: `${ic('refresh', 15)} مزامنة الآن` });
    btn.addEventListener('click', async () => {
      const old = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'جارٍ المزامنة...';
      try {
        const r = await api(`/guilds/${state.guildId}/sync`, { method: 'POST' });
        paint(r.status);
        toast('تمت المزامنة — القنوات والرتب محدّثة.');
        await boot();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.innerHTML = old;
      }
    });
    bar.appendChild(btn);
  }

  /* وميض خفيف على شارة الربط الحيّ كل ما يوصل تغيير من مكان تاني */
  window.__livePaint = () => {
    bar.classList.add('flash');
    setTimeout(() => bar.classList.remove('flash'), 1400);
  };

  window.__syncPaint = paint;
  return bar;
}

/**
 * البثّ الحيّ: أي تغيير في الإعدادات يوصل للصفحة المفتوحة لحظيًا.
 *   - تغيير من ديسكورد (أوامر البوت) ← نعيد تحميل القسم المفتوح تلقائيًا
 *   - تغيير من جلسة ثانية على الموقع ← نفس الشي
 *   - تغيير أنت سوّيته من هذه الصفحة ← نتجاهله (شغلك محفوظ ومحدّث عندك)
 */
let liveConnected = false;

/** يعيد تحميل بيانات السيرفر ويُرسم القسم المفتوح من جديد بعد تغيير خارجي */
let reloadingAfterChange = false;
async function refreshAfterExternalChange(payload) {
  if (reloadingAfterChange) return;
  reloadingAfterChange = true;
  try {
    const data = await api(`/guilds/${state.guildId}`);
    state.settings = data.settings;
    state.guild = data.guild;
    state.stats = data.stats;
    state.meta = data.meta;
    state.dirty = false;
    if (state.section && SECTIONS[state.section]) renderSection(state.section);
    toast(payload?.source === 'bot'
      ? 'تغيّر الإعدادات من ديسكورد — حُدّثت اللوحة تلقائيًا'
      : 'تغيّر الإعدادات من جلسة ثانية — حُدّثت اللوحة تلقائيًا');
  } catch { /* نتجاهل: يحاول مع الدفعة الجاية */ } finally {
    reloadingAfterChange = false;
  }
}

function connectLive() {
  if (liveConnected || typeof EventSource === 'undefined') return;
  liveConnected = true;
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('sync', (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        state.sync = payload;
        if (window.__syncPaint) window.__syncPaint(payload);
      } catch { /* تجاهل */ }
    });
    es.addEventListener('settings', (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (state.live !== false) state.live = true;
        if (window.__livePaint) window.__livePaint(payload);
        /* التغيير من هذي الصفحة نفسها؟ ما نعمل شي */
        if (payload?.clientId && payload.clientId === PAGE_CLIENT_ID) return;
        if (payload?.guildId && String(payload.guildId) !== String(state.guildId)) return;
        refreshAfterExternalChange(payload);
      } catch { /* تجاهل */ }
    });
    es.addEventListener('sync-error', (ev) => {
      try {
        toast(JSON.parse(ev.data).message || 'تعذّرت المزامنة', true);
      } catch { /* تجاهل */ }
    });
    es.addEventListener('error', () => { liveConnected = false; });
  } catch { /* المتصفح لا يدعم البث الحيّ */ }
}

/* ============================ الإقلاع ============================ */
async function boot() {
  const root = document.getElementById('app');
  state.guildId = root.dataset.guild;
  root.innerHTML = '<div class="d-loading"><div class="d-spinner"></div><div>جارٍ تحميل إعدادات السيرفر…</div></div>';

  try {
    const data = await api(`/guilds/${state.guildId}`);
    if (data.viewer?.locked) {
      root.innerHTML = `<div class="d-loading"><div class="d-empty-ico">${ic('lock', 34)}</div><div>بيانات السيرفر والأعضاء ما تنعرض إلا بعد تسجيل الدخول.</div><a class="d-btn primary" href="/auth/login">تسجيل الدخول</a></div>`;
      return;
    }
    state.viewer = data.viewer || null;
    state.canEdit = data.viewer ? Boolean(data.viewer.canEdit) : root.dataset.edit !== '0';
    /* حالة المالك/المشاهدة فقط: تأتي مع بيانات السيرفر، وإن غابت نقرأها من الصفحة */
    state.isOwner = Boolean(data.viewer?.isOwner) || root.dataset.owner === '1';
    state.viewOnly = Boolean(data.viewer?.viewOnly) || root.dataset.viewonly === '1';
    if (data.viewer?.roleReason && data.viewer.roleReason !== 'ok') {
      state.viewer.reason = data.viewer.message || '';
    }
    state.settings = data.settings;
    state.guild = data.guild;
    state.stats = data.stats;
    state.daily = data.daily || [];
    state.meta = data.meta;
    state.sync = data.sync || null;
    state.dirty = false;

    root.innerHTML = '';
    const shell = el('div', { class: `d-shell${state.canEdit ? '' : ' readonly'}` });
    if (!state.canEdit && state.viewOnly) {
      shell.appendChild(
        el('div', {
          class: 'd-readonly-note viewonly',
          html: `${ic('eye', 17)} <b>مشاهدة فقط</b> — حسابك مسموح له يفتح الموقع ويتصفّح كل الإعدادات، لكن التعديل والحفظ معطّلان من إدارة الموقع.`,
        }),
      );
    } else if (!state.canEdit) {
      shell.appendChild(
        el('div', {
          class: 'd-readonly-note',
          html:
            state.viewer && state.viewer.loginRequired
              ? `${ic('shield', 17)} <b>الوصول مقيّد</b> — ${esc(state.viewer.reason || 'تحتاج تسجيل دخول بحساب Discord، وموافقة مالك الموقع.')}
                 <a class="d-btn primary sm" href="/auth/login">${ic('login', 15)} تسجيل الدخول</a>`
              : `${ic('shield', 17)} <b>عرض عام</b> — تقدر تتصفّح الإعدادات بحرية، أما التعديل فيحتاج تسجيل دخول بحساب Discord.
                 <a class="d-btn primary sm" href="/auth/login">${ic('login', 15)} تسجيل الدخول</a>`,
        }),
      );
    }
    const { side, items } = buildSidebar();
    window.__dashItems = items;
    shell.appendChild(buildHeader());
    shell.appendChild(side);

    const main = el('div', { class: 'd-main' });
    main.appendChild(buildSyncBar());
    const content = el('div', { class: 'd-content', id: 'd-content' });
    main.appendChild(content);
    shell.appendChild(main);
    root.appendChild(shell);
    const backdrop = el('div', { class: 'd-side-backdrop' });
    backdrop.addEventListener('click', closeSide);
    root.appendChild(backdrop);

    /* شريط الحفظ (للمسجّلين فقط) */
    if (state.canEdit) {
    const bar = el('div', { class: 'd-savebar' });
    const msg = el('span', { class: 'msg', text: 'تغييرات غير محفوظة' });
    const grow = el('span', { class: 'grow' });
    const reset = el('button', { class: 'd-btn ghost', html: `${ic('undo', 16)} تراجع` });
    reset.addEventListener('click', () => boot());
    const save = el('button', { class: 'd-btn primary', html: `${ic('save', 16)} حفظ التغييرات` });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await api(`/guilds/${state.guildId}/settings`, { method: 'POST', body: state.settings });
        state.dirty = false;
        bar.classList.remove('show');
        toast('تم حفظ الإعدادات.');
      } catch (err) {
        msg.className = 'msg';
        msg.textContent = err.message;
        toast(err.message, true);
      } finally {
        save.disabled = false;
      }
    });
    [msg, grow, reset, save].forEach((n) => bar.appendChild(n));
    main.appendChild(bar);
    }

    /* لو الرابط فيه #قسم (مثل ما يرسله البوت) نفتحه مباشرة */
    const wanted = (window.location.hash || '').replace('#', '');
    if (wanted && SECTIONS[wanted]) state.section = wanted;

    items.forEach(({ item }) => item.classList.toggle('active', item.dataset.id === state.section));
    if (drawerMode()) closeSide();
    renderSection(state.section);
    updateDots(items);
    connectLive();
  } catch (err) {
    root.innerHTML = `<div class="d-loading"><div class="d-empty-ico">${ic('warning', 34)}</div><div>تعذّر تحميل الإعدادات: ${esc(err.message)}</div><a class="d-btn primary" href="/dashboard">الرجوع إلى السيرفرات</a></div>`;
  }
}

document.addEventListener('DOMContentLoaded', boot);
