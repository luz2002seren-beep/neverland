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
const el = (tag, attrs = {}, html = '') => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  if (html) node.innerHTML = html;
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

function dArea(path, { placeholder = '' } = {}) {
  const area = el('textarea', { class: 'd-textarea', placeholder });
  area.value = getPath(path) ?? '';
  area.addEventListener('input', () => setPath(path, area.value));
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
    .sort((a, b) => a.type - b.type || String(a.name).localeCompare(String(b.name), 'ar'))
    .map((c) => ({ value: c.id, label: `${c.type === 0 || c.type === 15 ? '#' : c.type === 4 ? '[قسم] ' : '[صوتي] '}${c.name}`, type: c.type }))
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

const SECTIONS = {
  /* ------------------------------ نظرة عامة ------------------------------ */
  overview: {
    group: 'عام',
    label: 'مركز التحكم',
    title: 'مركز التحكم',
    desc: 'نظرة عامة على حالة السيرفر، وتشغيل الأنظمة أو إيقافها.',
    render() {
      const frag = document.createDocumentFragment();
      const st = state.stats || {};

      const stats = el('div', { class: 'd-stats' });
      [
        ['hammer', st.cases ?? 0, 'إجمالي العقوبات'],
        ['warning', st.warnings ?? 0, 'تحذيرات'],
        ['ticket', st.openTickets ?? 0, 'تذاكر مفتوحة'],
        ['chart', (st.messages ?? 0).toLocaleString('ar-EG'), 'رسائل محسوبة'],
        ['users', (state.guild.memberCount || st.trackedMembers || 0).toLocaleString('ar-EG'), 'عضو'],
      ].forEach(([iconName, value, label]) => {
        const card = el('div', { class: 'd-stat' });
        card.appendChild(el('b', { text: String(value) }));
        card.appendChild(el('span', { html: `${ic(iconName, 15)} ${label}` }));
        stats.appendChild(card);
      });
      frag.appendChild(stats);

      /* تشغيل/إطفاء الأنظمة بسرعة */
      const toggles = [
        ['welcome.enabled', 'userPlus', 'الترحيب', 'رسالة ترحيب بالبطاقة لكل عضو جديد'],
        ['leave.enabled', 'userMinus', 'الوداع', 'رسالة عند مغادرة عضو'],
        ['boost.enabled', 'star', 'شكر الدعم', 'رسالة عند دعم السيرفر'],
        ['logs.enabled', 'scroll', 'السجلات', 'تسجيل أحداث السيرفر'],
        ['automod.enabled', 'shield', 'الحماية التلقائية', 'منع السبام والروابط'],
        ['autoline.enabled', 'lines', 'الخط الفاصل', 'خط تلقائي في القنوات'],
        ['autoreact.enabled', 'emoticon', 'التفاعلات', 'تفاعل تلقائي على الرسائل'],
        ['tickets.enabled', 'ticket', 'التذاكر', 'نظام التذاكر بأربعة أنواع'],
        ['staffApplication.enabled', 'clipboard', 'تقديم الإدارة', 'نموذج من خمس خانات مع القبول والرفض'],
        ['leveling.enabled', 'chart', 'المستويات', 'نقاط الخبرة ومكافآت الرتب'],
        ['autorole.enabled', 'userCog', 'الرتب التلقائية', 'رتب تُمنح عند الانضمام'],
      ];
      const quick = el('div', { class: 'd-quick' });
      toggles.forEach(([path, iconName, label, desc]) => {
        const card = el('div', { class: 'd-quick-card' });
        card.appendChild(el('div', { class: 'ico', html: ic(iconName, 20) }));
        const txt = el('div', { class: 'txt' });
        txt.appendChild(el('b', { text: label }));
        txt.appendChild(el('span', { text: desc }));
        card.appendChild(txt);
        card.appendChild(
          dSwitch(path, () => {
            const items = window.__dashItems || [];
            updateDots(items);
          }),
        );
        quick.appendChild(card);
      });
      frag.appendChild(dCard('تشغيل الأنظمة وإيقافها', 'يُحفظ أي تغيير من شريط الحفظ السفلي', 'bolt', [quick], { noPad: true }));

      /* رسم النشاط */
      if (state.daily?.length) {
        frag.appendChild(dCard('نشاط آخر 14 يومًا', 'الرسائل • الأعضاء الجدد • التذاكر', 'chart', [buildChart()], { noPad: true }));
      }

      /* حالة البوت */
      const statusRows = [
        dField('حالة البوت', '', [el('span', { class: 'd-chip', html: state.guild.botOnline ? `<span class="state-on">متصل</span>` : `<span class="state-off">غير متصل</span>` })]),
        dField('عدد الأعضاء', '', [el('b', { class: 'accent', text: (state.guild.memberCount || 0).toLocaleString('ar-EG') })]),
        dField('معرّف السيرفر', '', [el('code', { class: 'd-kbd', text: state.guild.id })]),
        dField('أولوية الدعم', 'مدة الرد المتوقّعة في التذاكر', [dInput('tickets.responseTime', { narrow: true })]),
      ];
      frag.appendChild(dCard('معلومات السيرفر', '', 'info', statusRows));

      return frag;
    },
  },

  /* ------------------------------ الإعدادات العامة ------------------------------ */
  general: {
    group: 'عام',
    label: 'الإعدادات العامة',
    title: 'الإعدادات العامة',
    desc: 'اللغة والبادئة وقناة الاستفسارات.',
    render() {
      return dCard('الأساسيات', 'تنطبق على كل الأنظمة', 'settings', [
        dField('لغة البوت', 'اللغة الافتراضية للرسائل والأوامر', [
          dSelect('language', [{ value: 'ar', label: '🇸🇦 العربية' }, { value: 'en', label: '🇬🇧 English' }], { noneLabel: null }),
        ]),
        dField('البادئة النصية', 'للأوامر التقليدية بالرسائل (اختياري)', [dInput('prefix', { narrow: true, placeholder: '!' })]),
        dField('قناة الاستفسارات', 'قناة عامة للأسئلة (اختياري)', [dSelect('reports.channelId', channelOptions())]),
        dField('نظام الدعوات (Referral)', 'تتبّع من دعا من', [dSwitch('referral.enabled')]),
        dField('قناة الدعوات', '', [dSelect('referral.channelId', channelOptions())]),
      ]);
    },
  },

  /* ------------------------------ الترحيب ------------------------------ */
  welcome: {
    group: 'الأعضاء',
    label: 'الترحيب والوداع',
    title: 'الترحيب والوداع',
    desc: 'ترحيب بصورة بالأفتار + رسالة عادية بلا إطار، ورسائل الوداع والدعم.',
    render() {
      const frag = document.createDocumentFragment();

      /* --------- ١) صورة الترحيب (بطاقة بالأفتار) — الأهم --------- */
      const previewPath = `/api/guilds/${state.guildId}/welcome/card`;
      const previewBox = el('div', { class: 'wc-preview' });
      const previewImg = el('img', { alt: 'معاينة صورة الترحيب', src: `${previewPath}?t=${Date.now()}` });
      const refreshBtn = el('button', { class: 'd-btn sm', html: `${ic('refresh', 14)} تحديث المعاينة` });
      refreshBtn.addEventListener('click', () => {
        previewImg.src = `${previewPath}?t=${Date.now()}`;
        toast('تم تحديث المعاينة');
      });
      const previewNote = el('span', { class: 'wc-note', text: 'المعاينة بالأفتار واسم حسابك المسجّل — وهي نفس الصورة التي تُرسل للأعضاء.' });
      previewBox.appendChild(previewImg);
      previewBox.appendChild(el('div', { class: 'wc-side' }, ''));
      const side = previewBox.querySelector('.wc-side');
      side.appendChild(previewNote);
      side.appendChild(refreshBtn);

      const cardFields = [
        dField('نوع الصورة', `مولّد البطاقات: ${state.meta.cardAvailable ? '<span class="state-on">متاح</span>' : '<span class="state-off">غير متاح — سيُستخدم الأفتار</span>'}`, [
          dSelect(
            'welcome.imageMode',
            [
              { value: 'card', label: 'بطاقة ترحيب بالأفتار (الطريقة الاحترافية)' },
              { value: 'avatar', label: 'صورة الأفتار فقط' },
              { value: 'custom', label: 'رابط صورة مخصّص' },
              { value: 'none', label: 'بدون صورة' },
            ],
            { noneLabel: null, onAfter: () => { previewImg.src = `${previewPath}?t=${Date.now()}`; } },
          ),
        ]),
        dField('النص المرسوم على الصورة', 'المتغيّرات: {displayName} · {username} · {server} · {memberCount}', [dInput('welcome.cardMessage', { full: true, placeholder: 'مثال: أهلاً بك {displayName} في {server}' })], { wide: true }),
        dField('خلفية البطاقة', 'رابط صورة (اختياري) — بدونها تُستخدم ألوان التدرّج', [dInput('welcome.cardBackground', { full: true, placeholder: 'https://...' })], { wide: true }),
        dField('تدرّج لون البطاقة', 'من لون إلى لون', [dInput('welcome.cardTheme.from', { narrow: true }), dInput('welcome.cardTheme.to', { narrow: true })]),
        dField('رابط الصورة المخصّصة', 'يُستخدم عند اختيار «رابط صورة مخصّص» — يدعم {avatar}', [dInput('welcome.imageUrl', { full: true, placeholder: 'https://...' })], { wide: true }),
        dField('إرفاق الصورة كملف', 'جودة أفضل من الرابط', [dSwitch('welcome.attachImage')]),
        dField('اختبار البطاقة', 'يرسل بطاقة نموذجية في قناة الترحيب', [testButton('إرسال بطاقة تجريبية', 'card')]),
      ];

      const cardNode = dCard(
        'صورة الترحيب (بطاقة بالأفتار)',
        'صورة واحدة تجمع: أفتار العضو + اسمه + اسم السيرفر + رقم العضو — تُرسل مع رسالة عادية بدون إطار Embed.',
        'image',
        cardFields,
      );
      cardNode.insertBefore(previewBox, cardNode.querySelector('.d-card-body') || cardNode.firstChild);
      frag.appendChild(cardNode);

      /* --------- ٢) رسالة الترحيب --------- */
      frag.appendChild(
        dCard(
          'رسالة الترحيب',
          'المتغيّرات: {user} {username} {displayName} {server} {memberCount} {createdAt}',
          'userPlus',
          [
            dField('تفعيل الترحيب', '', [dSwitch('welcome.enabled')]),
            dField('قناة الترحيب', '', [dSelect('welcome.channelId', channelOptions())]),
            dField('نص الرسالة', 'يظهر مع صورة الترحيب (يدعم الإيموجيات الخارجية <:name:id>)', [dArea('welcome.message')], { wide: true }),
            dField(
              'شكل الرسالة',
              'الطريقة الاحترافية: صورة بالأفتار + رسالة عادية بلا إطار · أو داخل إطار Embed أنيق',
              [
                dChips('welcome.embed', [
                  { value: false, label: 'صورة + رسالة عادية (بلا إطار)' },
                  { value: true, label: 'داخل إطار Embed' },
                ]),
              ],
            ),
            dField('حذف تلقائي بعد (ثانية)', '0 = لا يُحذف', [dNumber('welcome.autoDeleteAfter')]),
            dField('رسالة خاصة للعضو', 'يوصل الترحيب بالخاص', [dSwitch('welcome.dm')]),
            dField('نص الخاص', '', [dArea('welcome.dmMessage')], { wide: true }),
          ],
          { tail: testButton('إرسال رسالة تجريبية') },
        ),
      );

      frag.appendChild(
        dCard('رسالة الوداع', '', 'userMinus', [
          dField('تفعيل الوداع', '', [dSwitch('leave.enabled')]),
          dField('القناة', '', [dSelect('leave.channelId', channelOptions())]),
          dField('نص الرسالة', 'المتغيّرات: {user} {server} {memberCount}', [dArea('leave.message')], { wide: true }),
        ]),
      );

      frag.appendChild(
        dCard('رسالة شكر الدعم', '', 'star', [
          dField('تفعيل', '', [dSwitch('boost.enabled')]),
          dField('القناة', '', [dSelect('boost.channelId', channelOptions())]),
          dField('نص الرسالة', 'المتغيّرات: {user} {server} {level}', [dArea('boost.message')], { wide: true }),
        ]),
      );

      return frag;
    },
  },

  /* ------------------------------ الرتب التلقائية ------------------------------ */
  autorole: {
    group: 'الأعضاء',
    label: 'الرتب التلقائية',
    title: 'الرتب التلقائية',
    desc: 'رتب تُمنح تلقائيًا للأعضاء الجدد، ورتبة منفصلة للبوتات.',
    render() {
      return dCard('الرتب التلقائية', 'أضف الرتب التي تُعطى فور دخول العضو', 'userCog', [
        dField('تفعيل النظام', '', [dSwitch('autorole.enabled')]),
        dField('رتب الأعضاء', 'تُعطى لكل عضو جديد', [dListEditor('autorole.roleIds', { type: 'role', placeholder: 'اختر رتبة...' })], { wide: true }),
        dField('رتب البوتات', 'تُعطى للبوتات التي تُضاف', [dListEditor('autorole.botRoleIds', { type: 'role', placeholder: 'اختر رتبة...' })], { wide: true }),
      ]);
    },
  },

  /* ------------------------------ المستويات ------------------------------ */
  leveling: {
    group: 'الأعضاء',
    label: 'المستويات',
    title: 'المستويات والخبرة',
    desc: 'خبرة كتابية (كل ٥ أحرف = ١) · صوتية (كل ٦٠ ثانية = ١) · تفاعل، مع حماية ذكية من السبام ومكافآت رتب.',
    render() {
      const rewards = state.settings.leveling.rewards || [];
      const rows = el('div');
      rewards.forEach((reward, index) => {
        rows.appendChild(
          dField(
            `المستوى ${reward.level}`,
            `الرتبة: ${nameOfRole(reward.roleId)}`,
            [
              (() => {
                const select = el('select', { class: 'd-select' });
                select.appendChild(el('option', { value: '', text: 'اختر رتبة...' }));
                roleOptions().forEach((o) => select.appendChild(el('option', { value: o.value, text: o.label })));
                pickOption(select, reward.roleId);
                select.addEventListener('change', () => {
                  const list = [...rewards];
                  list[index] = { ...reward, roleId: select.value };
                  setPath('leveling.rewards', list);
                });
                return select;
              })(),
              (() => {
                const btn = el('button', { class: 'd-btn sm danger', html: `${ic('close', 14)} حذف` });
                btn.addEventListener('click', () => {
                  const list = [...rewards];
                  list.splice(index, 1);
                  setPath('leveling.rewards', list);
                  renderSection('leveling');
                });
                return btn;
              })(),
            ],
          ),
        );
      });

      const levelInput = el('input', { class: 'd-input narrow', type: 'number', min: 1, placeholder: 'المستوى' });
      const roleSelect = el('select', { class: 'd-select' });
      roleSelect.appendChild(el('option', { value: '', text: 'اختر رتبة...' }));
      roleOptions().forEach((o) => roleSelect.appendChild(el('option', { value: o.value, text: o.label })));
      const addReward = el('button', { class: 'd-btn sm primary', html: `${ic('plus', 15)} إضافة مكافأة` });
      addReward.addEventListener('click', () => {
        const level = Number(levelInput.value);
        if (!level || !roleSelect.value) return toast('حدّد المستوى والرتبة أولًا.', true);
        const list = (state.settings.leveling.rewards || []).filter((r) => Number(r.level) !== level);
        list.push({ level, roleId: roleSelect.value });
        list.sort((a, b) => a.level - b.level);
        setPath('leveling.rewards', list);
        renderSection('leveling');
      });
      const adder = el('div', { class: 'd-field-control' });
      [levelInput, roleSelect, addReward].forEach((n) => adder.appendChild(n));

      return [
        dCard('الخبرة الكتابية', 'خبرة على الرسائل — تُحسب بالأحرف: كل ٥ أحرف = ١ خبرة', 'message', [
          dField('تفعيل النظام', 'المفتاح الرئيسي لكل مصادر الخبرة', [dSwitch('leveling.enabled')]),
          dField('خبرة كتابية', 'منح خبرة على كل رسالة', [dSwitch('leveling.textXp')]),
          dField('خبرة لكل عدد أحرف', 'الافتراضي ٥ — يعني كل ٥ أحرف = ١ خبرة', [dNumber('leveling.textXpPerChars', { min: 1, max: 200 })]),
          dField('خبرة كل مجموعة أحرف', 'كم خبرة تُعطى لكل مجموعة (الافتراضي ١)', [dNumber('leveling.textXpPerCharsAmount', { min: 1, max: 100 })]),
          dField('سقف خبرة الرسالة', 'أقصى خبرة من الرسالة الواحدة', [dNumber('leveling.maxTextXpPerMessage', { min: 1, max: 1000 })]),
        ]),
        dCard('الخبرة الصوتية', 'خبرة مقابل البقاء في الرومات الصوتية — كل ٦٠ ثانية = ١ خبرة', 'speaker', [
          dField('خبرة صوتية', 'لازم يكون معك حد ثاني في الروم', [dSwitch('leveling.voiceXp')]),
          dField('الفاصل الصوتي (ثانية)', 'كل كم ثانية يأخذ خبرة (الافتراضي ٦٠)', [dNumber('leveling.voiceIntervalSeconds', { min: 30, max: 3600 })]),
          dField('خبرة كل فاصل', 'كم خبرة في كل فاصل صوتي (الافتراضي ١)', [dNumber('leveling.voiceXpPerInterval', { min: 1, max: 100 })]),
        ]),
        dCard('الحماية الذكية من السبام', 'من يكرّر الكلام أو يسبام: ما تُحسب خبرته ٥ دقايق', 'shield', [
          dField('مكافحة السبام', 'الفحص الذكي لكل رسالة قبل منح الخبرة', [dSwitch('leveling.antiSpam.enabled')]),
          dField('مدة المنع (دقائق)', 'كم دقيقة يبقى بلا خبرة (الافتراضي ٥)', [dNumber('leveling.antiSpam.muteMinutes', { min: 1, max: 120 })]),
          dField('حد تكرار الكلام', 'نفس الرسالة كم مرة قبل ما تُعتبر سبام', [dNumber('leveling.antiSpam.repeatLimit', { min: 2, max: 20 })]),
          dField('نافذة المراقبة (ثانية)', 'المدة اللي نراقب فيها التكرار', [dNumber('leveling.antiSpam.windowSeconds', { min: 15, max: 600 })]),
          dField('رسائل سريعة متتالية', 'عدد الرسائل في المدة القصيرة', [dNumber('leveling.antiSpam.rateMessages', { min: 3, max: 50 })]),
          dField('خلال كم ثانية', 'مدة العدّ للرسائل السريعة', [dNumber('leveling.antiSpam.rateSeconds', { min: 3, max: 120 })]),
        ]),
        dCard('خبرة التفاعل', 'خبرة لما يتفاعل الأعضاء مع رسائل بعضهم', 'activity', [
          dField('خبرة تفاعل', 'صاحب الرسالة ياخذ خبرة على التفاعلات', [dSwitch('leveling.interactXp')]),
          dField('نقاط لكل تفاعل', 'أقل وأكثر خبرة', [dNumber('leveling.interactMinXp'), dNumber('leveling.interactMaxXp')]),
          dField('سقف يومي للعضو', 'أقصى خبرة تفاعل في اليوم (0 = بلا سقف)', [dNumber('leveling.interactDailyCap', { max: 5000 })]),
          dField('سقف التفاعلات لكل رسالة', 'منع التجميع على رسالة واحدة', [dNumber('leveling.interactMaxPerMessage')]),
          dField('مكافأة من تفاعل', 'خبرة صغيرة لمن يضغط التفاعل', [dSwitch('leveling.interactGivenXp')]),
        ]),
        dCard('الترقية والفترات', 'رسالة الترقية وتوقيت تجديد توب داي وتوب ويك', 'crown', [
          dField('قناة إعلان الترقية', 'بدون = رسالة خاصة', [dSelect('leveling.announceChannelId', channelOptions())]),
          dField('نص رسالة الترقية', 'المتغيّرات: {user} {level}', [dArea('leveling.levelUpMessage')], { wide: true }),
          dField('بدون رسائل ترقية', 'صمت تام', [dSwitch('leveling.silent')]),
          dField('إزاحة التوقيت (ساعات)', 'عن UTC — تُحدّد وقت تجديد اليوم/الأسبوع', [dNumber('leveling.resetOffsetHours', { min: -12, max: 14 })]),
        ]),
        dCard('مكافآت الرتب', 'رتبة تُعطى تلقائيًا عند مستوى معيّن', 'gift', [rows, dField('إضافة مكافأة', '', [adder], { wide: true })]),
        dCard('استثناءات', 'قنوات أو رتب لا تأخذ خبرة', 'close', [
          dField('قنوات مستثناة', '', [dListEditor('leveling.ignoredChannels', { type: 'channel' })], { wide: true }),
          dField('رتب مستثناة', '', [dListEditor('leveling.ignoredRoles', { type: 'role' })], { wide: true }),
        ]),
      ];
    },
  },

  /* ------------------------------ المتصدّرون ------------------------------ */
  top: {
    group: 'الأعضاء',
    label: 'تفاعل',
    title: 'تفاعل',
    desc: 'تفاعل الأعضاء وخبرتهم: توب داي · توب ويك · كل الأوقات — كتابي وصوتي وتفاعل.',
    render() {
      const wrap = el('div');
      if (!state.topPeriod) state.topPeriod = 'day';
      if (!state.topSource) state.topSource = 'all';

      const seg = el('div', { class: 'seg d-top-seg' });
      [
        ['day', 'اليوم (توب داي)', 'clock'],
        ['week', 'هذا الأسبوع (توب ويك)', 'activity'],
        ['all', 'كل الأوقات', 'crown'],
      ].forEach(([key, label, iconName]) => {
        const btn = el('button', { class: state.topPeriod === key ? 'active' : '', html: `${ic(iconName, 15)} ${label}` });
        btn.addEventListener('click', () => {
          state.topPeriod = key;
          renderSection('top');
        });
        seg.appendChild(btn);
      });

      const chips = el('div', { class: 'd-top-chips' });
      [
        ['all', 'الكل'],
        ['text', 'كتابي'],
        ['voice', 'صوتي'],
        ['interact', 'تفاعل'],
      ].forEach(([key, label]) => {
        const btn = el('button', { class: `chip${state.topSource === key ? ' active' : ''}`, text: label });
        btn.addEventListener('click', () => {
          state.topSource = key;
          renderSection('top');
        });
        chips.appendChild(btn);
      });

      const note = el('div', { class: 'd-top-note', html: '<span class="d-empty">جارٍ التحميل…</span>' });
      const box = el('div');

      wrap.appendChild(seg);
      wrap.appendChild(chips);
      wrap.appendChild(note);
      wrap.appendChild(box);
      loadTopBoard(note, box);
      return wrap;
    },
  },

  /* ------------------------------ حماية الموقع (للمالك فقط) ------------------------------ */
  security: {
    group: 'إدارة الموقع',
    ownerOnly: true,
    label: 'حماية الموقع',
    title: 'حماية الموقع',
    desc: 'كل الدفاعات المفعّلة على الموقع + نسخة احتياطية من كل البيانات بضغطة.',
    render() {
      const wrap = el('div');
      const note = el('div');
      const box = el('div');
      wrap.appendChild(note);
      wrap.appendChild(box);
      loadSecurity(note, box);
      return wrap;
    },
  },

  /* ------------------------------ أعضاء الموقع (للمالك فقط) ------------------------------ */
  siteMembers: {
    group: 'إدارة الموقع',
    ownerOnly: true,
    label: 'أعضاء الموقع',
    title: 'أعضاء الموقع',
    desc: 'كل من سجّل دخول بحساب Discord: تتحكم به — تعطيه مشاهدة فقط أو تحظره من الموقع كامل.',
    render() {
      const wrap = el('div');
      const note = el('div', { class: 'd-top-note' });
      const box = el('div');
      wrap.appendChild(note);
      wrap.appendChild(box);
      loadSiteMembers(note, box);
      return wrap;
    },
  },

  /* ------------------------------ الحماية التلقائية ------------------------------ */
  automod: {
    group: 'الحماية',
    label: 'الحماية التلقائية',
    title: 'الحماية التلقائية',
    desc: 'ضبط أنماط المخالفات والعقوبة المطبّقة عليها.',
    render() {
      const punishmentLabels = [
        ['delete', 'حذف الرسالة فقط'],
        ['warn', 'تحذير'],
        ['timeout', 'إسكات مؤقت'],
        ['kick', 'طرد'],
        ['ban', 'حظر'],
      ];
      return [
        dCard('التشغيل العام', '', 'shield', [
          dField('تفعيل الحماية', '', [dSwitch('automod.enabled')]),
          dField(
            'العقوبة عند المخالفة',
            '',
            [dSelect('automod.punishment', punishmentLabels.map(([value, label]) => ({ value, label })), { noneLabel: null })],
          ),
          dField('مدة الإسكات (دقيقة)', 'تُستخدم عند اختيار إسكات مؤقت', [dNumber('automod.timeoutMinutes')]),
        ]),
        dCard('الأنماط الممنوعة', 'كل نمط بمفتاح تشغيل/إطفاء', 'ban', [
          dField('منع السبام', 'رسائل كثيرة في وقت قصير', [dSwitch('automod.antiSpam')]),
          dField('حدّ الرسائل', 'كم رسالة مسموحة', [dNumber('automod.spamMessages'), el('span', { class: 'muted', text: 'خلال' }), dNumber('automod.spamIntervalSeconds'), el('span', { class: 'muted', text: 'ثانية' })]),
          dField('منع الروابط', '', [dSwitch('automod.antiLink')]),
          dField('منع دعوات السيرفرات', '', [dSwitch('automod.antiInvite')]),
          dField('منع المنشن الجماعي', '', [dSwitch('automod.antiEveryone')]),
          dField('حدّ المنشن في الرسالة', '', [dNumber('automod.mentionLimit')]),
          dField('منع الكتابة الكبيرة (CAPS)', '', [dSwitch('automod.antiCaps')]),
          dField('نسبة الأحرف الكبيرة %', '', [dNumber('automod.capsPercent')]),
          dField('روابط مسموحة', 'استثناءات (مثل tenor.com)', [dWordEditor('automod.whitelistDomains', { placeholder: 'giphy.com' })], { wide: true }),
        ]),
        dCard('الكلمات الممنوعة', 'أي رسالة تحتوي كلمة منها تُحذف', 'edit', [
          dField('قائمة الكلمات', '', [dWordEditor('automod.bannedWords', { placeholder: 'اكتب الكلمة ثم Enter' })], { wide: true }),
        ]),
        dCard('الحماية من الهجمات', 'تنبيه أو عقوبة عند دخول أعداد كبيرة', 'shield', [
          dField('تفعيل', '', [dSwitch('automod.antiRaid')]),
          dField('عدد الأعضاء', 'خلال', [dNumber('automod.raidThreshold'), dNumber('automod.raidWindowSeconds'), el('span', { class: 'muted', text: 'ثانية' })]),
          dField(
            'الإجراء',
            '',
            [
              dSelect(
                'automod.raidAction',
                [
                  { value: 'alert', label: 'تنبيه فقط' },
                  { value: 'lockdown', label: 'قفل السيرفر' },
                  { value: 'kick', label: 'طرد الداخلين' },
                ],
                { noneLabel: null },
              ),
            ],
          ),
          dField('أقل عمر للحساب (يوم)', '0 = بدون شرط', [dNumber('automod.raidMinAccountAgeDays')]),
        ]),
        dCard('استثناءات', 'قنوات أو رتب لا تطبق عليها الحماية', 'check', [
          dField('قنوات مستثناة', '', [dListEditor('automod.whitelistChannels', { type: 'channel' })], { wide: true }),
          dField('رتب مستثناة', '', [dListEditor('automod.whitelistRoles', { type: 'role' })], { wide: true }),
        ]),
      ];
    },
  },

  /* ------------------------------ عقوبات التحذيرات ------------------------------ */
  moderation: {
    group: 'الحماية',
    label: 'عقوبات التحذيرات',
    title: 'عقوبات التحذيرات',
    desc: 'العقوبة التلقائية عند بلوغ عدد معيّن من التحذيرات.',
    render() {
      return dCard('العقوبة التلقائية', 'مثال: ثلاثة تحذيرات تؤدي إلى إسكات عشر دقائق', 'hammer', [
        dField('عدد التحذيرات', '0 = معطّل', [dNumber('moderation.warnThreshold')]),
        dField(
          'العقوبة',
          '',
          [
            dSelect(
              'moderation.warnAction',
              [
                { value: 'none', label: 'بدون' },
                { value: 'timeout', label: 'إسكات عشر دقائق' },
                { value: 'kick', label: 'طرد' },
                { value: 'ban', label: 'حظر' },
              ],
              { noneLabel: null },
            ),
          ],
        ),
      ]);
    },
  },

  /* ------------------------------ الخط الفاصل ------------------------------ */
  autoline: {
    group: 'الأعضاء',
    label: 'الخط الفاصل (AutoLine)',
    title: 'الخط الفاصل',
    desc: 'خط تلقائي في القنوات المحدّدة، مع حذف الخط السابق عند وصول رسالة جديدة.',
    render() {
      const type = getPath('autoline.lineType') || 'gif';
      const style = getPath('autoline.gifStyle') || 'glow';
      const styles = state.meta.autolineStyles || DEFAULT_LINE_STYLES;

      /* -------- اختيار النوع: صورة متحركة / رابط خاص / نصّي -------- */
      const typeSeg = el('div', { class: 'seg autoline-type' });
      [
        { key: 'gif', label: 'صورة GIF متحركة', icon: 'sparkles' },
        { key: 'custom', label: 'رابط صورة خاص', icon: 'link' },
        { key: 'text', label: 'خط نصّي', icon: 'type' },
      ].forEach((option) => {
        const btn = el('button', {
          class: type === option.key ? 'active' : '',
          html: `${ic(option.icon, 15)} ${option.label}`,
        });
        btn.addEventListener('click', () => {
          setPath('autoline.lineType', option.key);
          renderSection('autoline');
        });
        typeSeg.appendChild(btn);
      });

      /* -------- معاينة حيّة للخط الحالي (صورة أو نص) -------- */
      const preview = el('div', { class: 'autoline-preview' });
      const current = styles.find((x) => x.key === style) || styles[0];
      if (type === 'custom') {
        const url = getPath('autoline.customUrl') || '';
        if (/^https?:\/\//i.test(url)) preview.appendChild(el('img', { src: url, alt: 'معاينة الخط', class: 'autoline-img' }));
        else preview.appendChild(el('div', { class: 'd-hint', text: 'ألصق رابط صورة مباشر (ينتهي بـ .gif أو .png أو .webp) ويظهر هنا.' }));
      } else if (type === 'text') {
        preview.appendChild(el('div', { class: 'autoline-text', text: getPath('autoline.line') || '────────────────────────' }));
      } else {
        preview.appendChild(el('img', { src: `/autoline/${current.file}`, alt: `خط ${current.label}`, class: 'autoline-img' }));
      }

      /* -------- بطاقات الأنماط (صورة متحركة لكل نمط) -------- */
      const styleGrid = el('div', { class: 'autoline-styles' });
      styles.forEach((item) => {
        const card = el('button', {
          class: `autoline-style${item.key === style && type === 'gif' ? ' active' : ''}`,
        });
        card.appendChild(el('img', { src: `/autoline/${item.file}`, alt: item.label, loading: 'lazy' }));
        const meta = el('div', { class: 'autoline-style-meta' });
        meta.appendChild(el('b', { text: item.label }));
        meta.appendChild(el('span', { text: item.desc }));
        card.appendChild(meta);
        card.addEventListener('click', () => {
          setPath('autoline.gifStyle', item.key);
          setPath('autoline.lineType', 'gif');
          renderSection('autoline');
        });
        styleGrid.appendChild(card);
      });

      return [
        dCard('نوع الخط', 'اختر: صورة GIF متحركة · رابط صورتك · أو خط نصّي', 'lines', [
          dField('النوع', 'الافتراضي: صورة GIF متحركة', [typeSeg], { wide: true }),
          dField('تفعيل', '', [dSwitch('autoline.enabled')]),
          dField('القنوات', 'القنوات التي يعمل فيها الخط', [dListEditor('autoline.channels', { type: 'channel' })], { wide: true }),
        ]),
        dCard(
          type === 'gif' ? 'شكل الخط المتحرك' : type === 'custom' ? 'رابط الخط' : 'نص الخط',
          type === 'gif'
            ? 'اضغط على أي نمط لاختياره — والمعاينة فوق تتحدّث فورًا.'
            : type === 'custom'
              ? 'صورة أو GIF من رابطك المباشر.'
              : 'خط نصّي (يدعم الإيموجيات الخارجية).',
          'sparkles',
          [
            dField('المعاينة', 'شكل الخط اللي بيطلع في القناة', [preview], { wide: true }),
            ...(type === 'gif'
              ? [dField('الأنماط الجاهزة', '4 خطوط متحركة جاهزة', [styleGrid], { wide: true })]
              : type === 'custom'
                ? [dField('رابط الصورة', 'يجب أن ينتهي بـ .gif أو .png أو .webp', [dInput('autoline.customUrl', { placeholder: 'https://example.com/line.gif' })], { wide: true })]
                : [dField('نص الخط', 'يدعم الإيموجيات الخارجية', [dArea('autoline.line')], { wide: true })]),
            dField('حذف الخط السابق', 'عند وصول رسالة جديدة', [dSwitch('autoline.deletePrevious')]),
            dField('حذف الخط مع الرسالة', 'لو انحذفت الرسالة اللي بعده', [dSwitch('autoline.deleteLineWithMessage')]),
            dField('حذف تلقائي بعد (ثانية)', '0 = بدون', [dNumber('autoline.deleteAfter')]),
            dField('اختبار', 'يرسل الخط في القناة المحدّدة', [testButton('إرسال خط تجريبي')]),
          ],
        ),
      ];
    },
  },

  /* ------------------------------ التفاعلات التلقائية ------------------------------ */
  /* ------------------------------ اختصارات الأوامر ------------------------------ */
  commandAliases: {
    group: 'الأوامر',
    label: 'اختصارات الأوامر',
    title: 'اختصارات الأوامر',
    desc: 'كل أوامر البوت: أوامر الأعضاء يستعملها أي عضو · وأوامر الإدارة مخفية عنهم — وكل اختصار تعدّله من هنا.',
    render() {
      const wrap = el('div');
      const statusBox = el('div');
      const listBox = el('div');
      wrap.appendChild(statusBox);
      wrap.appendChild(listBox);

      const load = async () => {
        listBox.innerHTML = '';
        listBox.appendChild(el('div', { class: 'd-empty', text: 'جارٍ تحميل الأوامر…' }));
        try {
          const data = await api(`/guilds/${state.guildId}/commands`);

          /* شريط الحالة: تشغيل · حد الاستخدام · عدد الأوامر */
          statusBox.innerHTML = '';
          const bar = el('div', { class: 'cmd-bar' });
          const enabledWrap = el('div', { class: 'cmd-toggle' });
          const sw = el('label', { class: 'd-switch' });
          const swInput = el('input', { type: 'checkbox' });
          swInput.checked = Boolean(data.enabled);
          sw.appendChild(swInput);
          sw.appendChild(el('span'));
          swInput.addEventListener('change', async () => {
            const next = swInput.checked;
            try {
              await api(`/guilds/${state.guildId}/commands/options`, { method: 'POST', body: { enabled: next } });
              toast(next ? 'الأوامر بلا بريفيكست صارت مشتغلة' : 'تم إيقاف الأوامر بلا بريفيكست');
            } catch (err) {
              swInput.checked = !next;
              toast(err.message, true);
            }
          });
          enabledWrap.appendChild(sw);
          enabledWrap.appendChild(el('div', { html: '<b>الأوامر بلا بريفيكست</b><span>اكتب اسم الأمر بالإنجليزي مباشرة في الشات</span>' }));

          /* اقتراح الأوامر المشابهة: لو عضو كتب كلمة تشبه أمرًا، يردّ عليه البوت بالبدائل */
          const sgWrap = el('label', { class: 'cmd-cd' });
          const sgSwitch = el('label', { class: 'd-switch' });
          const sgInput = el('input', { type: 'checkbox' });
          sgInput.checked = data.suggest !== false;
          sgSwitch.appendChild(sgInput);
          sgSwitch.appendChild(el('span'));
          sgInput.addEventListener('change', async () => {
            try {
              await api(`/guilds/${state.guildId}/commands/options`, { method: 'POST', body: { suggest: sgInput.checked } });
              toast(sgInput.checked ? 'اقتراح الأوامر المشابهة صار مشتغل' : 'تم إيقاف اقتراح الأوامر المشابهة');
            } catch (err) {
              sgInput.checked = !sgInput.checked;
              toast(err.message, true);
            }
          });
          sgWrap.appendChild(sgSwitch);
          sgWrap.appendChild(el('div', { html: '<b>اقتراح الأوامر المشابهة</b><span>مثال: يكتبون «طير» فيردّ عليهم بالأوامر القريبة</span>' }));

          const cd = el('input', { class: 'd-in', type: 'number', min: '0', max: '60', value: String(data.cooldownSeconds ?? 3) });
          const cdWrap = el('label', { class: 'cmd-cd' });
          cdWrap.appendChild(el('span', { text: 'حد الاستخدام (ثانية)' }));
          cdWrap.appendChild(cd);
          const saveCd = el('button', { class: 'd-btn sm', text: 'حفظ' });
          saveCd.addEventListener('click', async () => {
            try {
              await api(`/guilds/${state.guildId}/commands/options`, { method: 'POST', body: { cooldownSeconds: Number(cd.value) || 0 } });
              toast('تم حفظ حد الاستخدام');
            } catch (err) { toast(err.message, true); }
          });
          cdWrap.appendChild(saveCd);

          const counts = el('div', { class: 'cmd-counts' });
          counts.appendChild(el('span', { text: `${data.counts?.allTotal || data.items.length} أمر في البوت` }));
          counts.appendChild(el('span', { class: 'ok', text: `${data.counts?.member ?? 0} أوامر أعضاء` }));
          counts.appendChild(el('span', { class: 'lock', text: `${data.counts?.staff ?? 0} أوامر إدارة` }));

          bar.appendChild(enabledWrap);
          bar.appendChild(counts);
          bar.appendChild(el('span', { class: 'grow' }));
          bar.appendChild(sgWrap);
          bar.appendChild(cdWrap);
          statusBox.appendChild(bar);

          /* قاعدة المنشن: الأوامر اللي تحتاج عضو ما تنفّذ إلا بمنشن صريح */
          statusBox.appendChild(el('div', {
            class: 'cmd-rule',
            html: `${ic('userRound', 15)} <span>الأوامر اللي تحتاج عضو (<code dir="ltr">ban</code> · <code dir="ltr">kick</code> · <code dir="ltr">timeout</code>…) تنفّذ <b>بمنشن صريح @العضو فقط</b> — مو بالرد على رسالة ولا بكتابة الاسم.</span>`,
          }));

          /* بطاقة الأمر: الرد على «طير» وغلطات الكتابة صار نفس شكل بوتات الأوامر */
          statusBox.appendChild(el('div', {
            class: 'cmd-rule',
            html: `${ic('search', 15)} <span>لما عضو يكتب كلمة قريبة من أمر، الرد يجي <b>بطاقة أمر</b> (<code dir="ltr">Command: ban</code> + <b>#الاختصارات</b> · <b>#الاستخدام</b> · <b>#أمثلة للأمر</b>) — بلا أي رابط موقع.</span>`,
          }));

          statusBox.appendChild(el('div', {
            class: 'cmd-rule',
            html: `${ic('globe', 15)} <span><b>الاختصارات بأي لغة:</b> كل أمر عنده اختصاراته العربية والإنجليزية جاهزة (حظر · طرد · توب…)، وأي اختصار جديد تضيفه بأي لغة يشتغل فورًا في الشات بنفس الأمر.</span>`,
          }));

          statusBox.appendChild(el('div', {
            class: 'cmd-rule',
            html: `${ic('check', 15)} <span><b>ردود الأوامر ما تختفي:</b> الرد يبقى في الشات — ما في أي حذف تلقائي. وإذا بدك الرد يروح لحاله، شغّل خيار «حذف الرد بعد ٥ ثوانٍ» من زر «قواعد» تبع الأمر نفسه.</span>`,
          }));

          statusBox.appendChild(el('div', {
            class: 'cmd-rule',
            html: `${ic('lock', 15)} <span><b>كلمة وحدة تكفي:</b> <b>«قفل»</b> يقفل الروم · <b>«فتح»</b> يفتحه · <b>«اخفاء»</b> يخفي الروم عن الأعضاء · <b>«اظهار»</b> يرجّعه · <b>«مسح»</b> ينظّف ١٠٠ رسالة. بلا أي رمز وبلا خيارات (كذلك: اقفل · سكر · افتح · اخفي · اظهر · نظف).</span>`,
          }));

          statusBox.appendChild(el('div', {
            class: 'cmd-rule',
            html: `${ic('sliders', 15)} <span><b>قواعد الأمر:</b> لكل أمر زر «قواعد» — رتب مفعّلة/معطّلة · رومات مفعّلة/معطّلة · وأنواع الردود: حذف رسالة الأمر · حذف الرد مع حذف رسالة العضو · حذف الرد بعد ٥ ثوانٍ.</span>`,
          }));

          /* رابط الموقع: ما يظهر في أي رد — يظهر بكلمة «نيفر» ولمن عنده رول الموقع ومسجّل فيه */
          statusBox.appendChild(el('div', {
            class: 'cmd-rule',
            html: `${ic('lock', 15)} <span>رابط الموقع <b>ما يظهر في أي رد</b> — يظهر فقط لما عضو يكتب كلمة <b>«نيفر»</b>، وبشرطين: عنده <b>رول دخول الموقع</b> و<b>مسجّل</b> فيه بحساب ديسكورد.</span>`,
          }));

          /*
           * مجموعتان واضحتان:
           *   أوامر الأعضاء — يستعملها أي عضو بلا صلاحية، وظاهرة له في ديسكورد وفي الموقع.
           *   أوامر الإدارة — محتاجة صلاحية، ومخفية عن الأعضاء (ما يشوفوها في ديسكورد ولا هنا).
           */
          listBox.innerHTML = '';
          const groups = [
            { key: 'member', items: data.items.filter((i) => i.audience === 'member') },
            { key: 'staff', items: data.items.filter((i) => i.audience === 'staff') },
          ].filter((g) => g.items.length);

          groups.forEach(({ key, items }) => {
            const meta = (data.audiences && data.audiences[key]) || {};
            const card = el('div', { class: `d-card cmd-card aud-${key}` });
            const head = el('div', { class: 'd-card-head' });
            head.appendChild(el('span', { class: 'ico', html: ic(key === 'member' ? 'userRound' : 'shield', 16) }));
            const headTxt = el('div');
            headTxt.appendChild(el('b', { text: `${meta.label || key} (${items.length})` }));
            headTxt.appendChild(el('span', { text: meta.desc || '' }));
            head.appendChild(headTxt);
            card.appendChild(head);

            const body = el('div', { class: 'cmd-body' });
            items.forEach((item) => {
              const row = el('div', { class: 'cmd-row' });
              const nameCell = el('div', { class: 'cmd-name' });
              nameCell.appendChild(el('code', { text: item.name }));
              nameCell.appendChild(el('span', {
                class: `cmd-tag ${item.audience === 'member' ? 'ok' : 'lock'}`,
                text: item.audienceBadge || (item.audience === 'member' ? 'للأعضاء' : 'للإدارة'),
              }));
              if (!item.text) nameCell.appendChild(el('span', { class: 'cmd-tag warn', text: 'سلاش فقط' }));
              if (!item.real) nameCell.appendChild(el('span', { class: 'cmd-tag', text: 'غير مثبّت' }));
              row.appendChild(nameCell);

              row.appendChild(el('div', { class: 'cmd-what', text: item.what }));

              /* تشغيل/إطفاء الأمر بلا بريفيكست */
              const toggleWrap = el('div', { class: 'cmd-enable' });
              const toggle = el('label', { class: 'd-switch' });
              const toggleInput = el('input', { type: 'checkbox' });
              toggleInput.checked = Boolean(item.enabled);
              toggle.appendChild(toggleInput);
              toggle.appendChild(el('span'));
              toggleInput.addEventListener('change', async () => {
                try {
                  await api(`/guilds/${state.guildId}/commands/toggle`, { method: 'POST', body: { command: item.name, enabled: toggleInput.checked } });
                  toast(toggleInput.checked ? `«${item.name}» صار يشتغل بلا بريفيكست` : `«${item.name}» صار يحتاج سلاش فقط`);
                } catch (err) {
                  toggleInput.checked = !toggleInput.checked;
                  toast(err.message, true);
                }
              });
              toggleWrap.appendChild(toggle);
              toggleWrap.appendChild(el('span', { class: 'cmd-perm', text: item.perm ? item.perm : 'للجميع' }));
              row.appendChild(toggleWrap);

              /* محرّر الاختصارات */
              const editor = el('div', { class: 'cmd-alias-editor' });
              const chips = el('div', { class: 'cmd-chips' });
              let current = [...item.aliases];

              const repaint = () => {
                chips.innerHTML = '';
                if (!current.length) chips.appendChild(el('span', { class: 'cmd-none', text: 'بلا اختصار' }));
                (item.aliasLabels || current).forEach((alias, index) => {
                  const raw = current[index] || alias;
                  const chip = el('button', { class: 'cmd-chip', title: 'شيل الاختصار', html: `${esc(alias)} ${ic('close', 12)}` });
                  chip.addEventListener('click', () => {
                    current = current.filter((a) => a !== raw);
                    save();
                  });
                  chips.appendChild(chip);
                });
              };

              const save = async () => {
                try {
                  const res = await api(`/guilds/${state.guildId}/commands/aliases`, { method: 'POST', body: { command: item.name, aliases: current } });
                  current = res.aliases;
                  repaint();
                  toast(`تم حفظ اختصارات ${item.name}`);
                } catch (err) {
                  toast(err.message, true);
                  repaint();
                }
              };

              const addInput = el('input', { class: 'cmd-alias-input', placeholder: 'اختصار بأي لغة', maxlength: '20', dir: 'auto' });
              const addBtn = el('button', { class: 'cmd-add', html: `${ic('plus', 13)} إضافة` });
              const commit = () => {
                const value = String(addInput.value || '').trim().replace(/\s+/g, '');
                if (!value) return;
                if (current.includes(value)) { toast('الاختصار مضاف من قبل', true); return; }
                if (current.length >= 12) { toast('الحد الأقصى ١٢ اختصارًا للأمر', true); return; }
                current = [...current, value];
                addInput.value = '';
                save();
              };
              addBtn.addEventListener('click', commit);
              addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });

              repaint();
              editor.appendChild(chips);
              editor.appendChild(addInput);
              editor.appendChild(addBtn);
              row.appendChild(editor);

              /*
               * قواعد الأمر — نفس خيارات تعديل الأمر في البوتات المعروفة:
               *   رتب مفعّلة/معطّلة · رومات مفعّلة/معطّلة · أنواع الردود (٣ خيارات حذف).
               */
              const rulesBox = el('div', { class: 'cmd-rules hide' });
              const rulesBtn = el('button', { class: 'cmd-rules-btn', title: 'قواعد الأمر', html: `${ic('sliders', 13)} قواعد` });
              rulesBtn.addEventListener('click', () => rulesBox.classList.toggle('hide'));
              row.appendChild(rulesBtn);

              let rules = JSON.parse(JSON.stringify(item.rules || {}));

              const picker = (label, key, options, emptyText, nameOf) => {
                const block = el('div', { class: 'rule-block' });
                block.appendChild(el('span', { class: 'rule-head', text: label }));
                const chipsWrap = el('div', { class: 'rule-chips' });
                const paint = () => {
                  chipsWrap.innerHTML = '';
                  if (!rules[key].length) chipsWrap.appendChild(el('span', { class: 'cmd-none', text: emptyText }));
                  rules[key].forEach((id) => {
                    const chip = el('button', { class: 'rule-chip', title: 'شيل', html: `${esc(nameOf(id))} ${ic('close', 11)}` });
                    chip.addEventListener('click', () => {
                      rules[key] = rules[key].filter((x) => x !== id);
                      paint();
                      paintSelect();
                    });
                    chipsWrap.appendChild(chip);
                  });
                };
                const select = el('select', { class: 'rule-select' });
                const paintSelect = () => {
                  const list = typeof options === 'function' ? options() : options;
                  select.innerHTML = '';
                  select.appendChild(el('option', { value: '', text: '— اختر —' }));
                  list
                    .filter((o) => !rules[key].includes(o.id))
                    .forEach((o) => select.appendChild(el('option', { value: o.id, text: o.label })));
                };
                select.addEventListener('change', () => {
                  if (!select.value) return;
                  rules[key] = [...rules[key], select.value];
                  select.value = '';
                  paint();
                  paintSelect();
                });
                paint();
                paintSelect();
                block.appendChild(chipsWrap);
                block.appendChild(select);
                rulesBox.dataset[`key${key}`] = '1';
                return block;
              };

              const grid = el('div', { class: 'rules-grid' });
              grid.appendChild(picker('رتب مفعّلة (بس أصحابها)', 'enabledRoles', () => state.meta.roles.map((r) => ({ id: r.id, label: r.name })), 'بلا قيد', nameOfRole));
              grid.appendChild(picker('رتب معطّلة (ممنوعة)', 'disabledRoles', () => state.meta.roles.map((r) => ({ id: r.id, label: r.name })), 'بلا قيد', nameOfRole));
              grid.appendChild(picker('رومات مفعّلة (بس فيها)', 'enabledChannels', () => state.meta.channels.filter((c) => c.type !== 4).map((c) => ({ id: c.id, label: `#${c.name}` })), 'كل الرومات', nameOfChannel));
              grid.appendChild(picker('رومات معطّلة (ممنوعة)', 'disabledChannels', () => state.meta.channels.filter((c) => c.type !== 4).map((c) => ({ id: c.id, label: `#${c.name}` })), 'بلا منع', nameOfChannel));
              rulesBox.appendChild(grid);

              const flagsRow = el('div', { class: 'rules-flags' });
              [
                ['autoDeleteInvocation', 'حذف رسالة الأمر فورًا'],
                ['autoDeleteWithMessage', 'حذف الرد لما يحذف العضو رسالته'],
                ['autoDeleteReplyAfter5s', 'حذف الرد بعد ٥ ثوانٍ (افتراضيًا الرد يبقى)'],
              ].forEach(([key, label]) => {
                const flag = el('label', { class: 'rule-flag' });
                const input = el('input', { type: 'checkbox' });
                input.checked = Boolean(rules[key]);
                input.addEventListener('change', () => { rules[key] = input.checked; });
                flag.appendChild(input);
                flag.appendChild(el('span', { text: label }));
                flagsRow.appendChild(flag);
              });
              rulesBox.appendChild(flagsRow);

              const rulesSave = el('button', { class: 'cmd-add rules-save', html: `${ic('save', 13)} حفظ القواعد` });
              rulesSave.addEventListener('click', async () => {
                try {
                  const res = await api(`/guilds/${state.guildId}/commands/rules`, { method: 'POST', body: { command: item.name, rules } });
                  rules = res.rules;
                  toast(`تم حفظ قواعد ${item.name}`);
                } catch (err) {
                  toast(err.message, true);
                }
              });
              rulesBox.appendChild(rulesSave);
              row.appendChild(rulesBox);

              body.appendChild(row);
            });

            if (key === 'staff') {
              card.appendChild(el('div', {
                class: 'cmd-note',
                html: `${ic('eye', 14)} <span>أوامر الإدارة <b>مخفية عن الأعضاء</b> في ديسكورد وفي الموقع — العضو العادي ما يشوفها ولا يقدر يستعملها، فما يخبّ شي في السيرفر.</span>`,
              }));
            }
            card.appendChild(body);
            listBox.appendChild(card);
          });

          if (!data.items.length) {
            listBox.appendChild(el('div', { class: 'd-empty', text: 'ما في أوامر ظاهرة لحسابك.' }));
          }
        } catch (err) {
          listBox.innerHTML = '';
          listBox.appendChild(el('div', { class: 'd-empty', text: err.message }));
        }
      };

      load();
      return wrap;
    },
  },

  /* ------------------------------ مكتبة الأوامر ------------------------------ */
  commandGuide: {
    group: 'الأوامر',
    label: 'مكتبة الأوامر',
    title: 'مكتبة الأوامر',
    desc: 'شرح كل أمر: شو يعمل، كيف تكتبه، وأمثلة جاهزة تنسخها — أوامر الأعضاء وأوامر الإدارة كل واحدة لوحدها.',
    render() {
      const wrap = el('div');
      const toolbar = el('div', { class: 'guide-bar' });
      const box = el('div');
      wrap.appendChild(toolbar);
      wrap.appendChild(box);

      let items = [];
      let activeCat = 'all';
      let activeAudience = 'all';
      let query = '';

      const paint = () => {
        box.innerHTML = '';
        const filtered = items.filter((i) => (activeCat === 'all' || i.category === activeCat)
          && (activeAudience === 'all' || i.audience === activeAudience)
          && (!query
            || i.name.toLowerCase().includes(query)
            || (i.label || '').includes(query)
            || (i.what || '').includes(query)
            || (i.usage || []).join(' ').includes(query)));
        if (!filtered.length) {
          box.appendChild(el('div', { class: 'd-empty', text: 'ما في أمر مطابق لبحثك.' }));
          return;
        }
        const grid = el('div', { class: 'guide-grid' });
        filtered.forEach((item) => grid.appendChild(guideCard(item)));
        box.appendChild(grid);
      };

      (async () => {
        try {
          const data = await api('/commands');
          items = data.items;
          toolbar.innerHTML = '';

          const search = el('input', { class: 'd-in', placeholder: 'ابحث عن أمر…', type: 'search' });
          search.addEventListener('input', () => { query = search.value.trim(); paint(); });
          toolbar.appendChild(el('span', { class: 'guide-search', html: ic('search', 15) }));
          toolbar.appendChild(search);

          /* شرائح الجمهور: أوامر الأعضاء أولًا، ثم كل الأوامر، ثم أوامر الإدارة */
          const audChips = el('div', { class: 'guide-chips guide-aud' });
          [
            ['member', `أوامر الأعضاء (${items.filter((i) => i.audience === 'member').length})`],
            ['all', `كل الأوامر (${items.length})`],
            ['staff', `أوامر الإدارة (${items.filter((i) => i.audience === 'staff').length})`],
          ].forEach(([key, label]) => {
            const chip = el('button', { class: `chip${key === 'member' ? ' active' : ''}`, text: label });
            chip.addEventListener('click', () => {
              activeAudience = key;
              audChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
              paint();
            });
            audChips.appendChild(chip);
          });
          toolbar.appendChild(audChips);

          const chips = el('div', { class: 'guide-chips' });
          [['all', `الكل (${items.length})`], ...data.categories.map((c) => [c.key, `${c.label} (${items.filter((i) => i.category === c.key).length})`])]
            .forEach(([key, label]) => {
              const chip = el('button', { class: `chip${key === 'all' ? ' active' : ''}`, text: label });
              chip.addEventListener('click', () => {
                activeCat = key;
                chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
                paint();
              });
              chips.appendChild(chip);
            });
          toolbar.appendChild(chips);
          toolbar.appendChild(el('span', {
            class: 'guide-count',
            text: `${items.filter((i) => i.audience === 'member').length} أمر للأعضاء · ${items.filter((i) => i.audience === 'staff').length} أمر للإدارة`,
          }));

          paint();
        } catch (err) {
          box.innerHTML = '';
          box.appendChild(el('div', { class: 'd-empty', text: err.message }));
        }
      })();

      return wrap;
    },
  },

  /* ------------------------------ سجل النشاط ------------------------------ */
  audit: {
    group: 'البيانات',
    label: 'سجل النشاط',
    title: 'سجل النشاط',
    desc: 'كل حدث مهم في السيرفر: من غيّر شو ومتى — مع الحفظ الدائم في قاعدة البيانات.',
    render() {
      const wrap = el('div');
      const filters = el('div', { class: 'd-top-chips' });
      const box = el('div');
      const head = el('div', { class: 'd-audit-head' });
      wrap.appendChild(head);
      wrap.appendChild(filters);
      wrap.appendChild(box);

      const state2 = { severity: null, offset: 0, limit: 50, action: null };

      const ACTION_OPTIONS = [
        ['', 'كل الأحداث'],
        ['settings', 'تغيير الإعدادات'],
        ['login', 'تسجيل الدخول'],
        ['member', 'إدارة الأعضاء'],
        ['action', 'إجراءات تجريبية'],
        ['sync', 'المزامنة'],
        ['security', 'حماية'],
      ];

      const load = async () => {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'd-empty', text: 'جارٍ تحميل السجل…' }));
        try {
          const q = new URLSearchParams({ limit: String(state2.limit), offset: String(state2.offset) });
          if (state2.severity) q.set('severity', state2.severity);
          if (state2.action) q.set('action', state2.action);
          const data = await api(`/guilds/${state.guildId}/audit?${q.toString()}`);

          head.innerHTML = '';
          const st = data.stats || {};
          [
            ['scroll', st.total || 0, 'كل الأحداث'],
            ['calendarDay', st.today || 0, 'آخر ٢٤ ساعة'],
            ['warning', st.warn || 0, 'تنبيهات'],
            ['ban', st.danger || 0, 'أحداث خطيرة'],
          ].forEach(([icon, value, label]) => {
            const chip = el('div', { class: 'd-audit-stat' });
            chip.appendChild(el('span', { class: 'ico', html: ic(icon, 15) }));
            chip.appendChild(el('b', { text: Number(value).toLocaleString('ar-EG') }));
            chip.appendChild(el('span', { text: label }));
            head.appendChild(chip);
          });

          box.innerHTML = '';
          if (!data.items.length) {
            box.appendChild(el('div', { class: 'd-empty', text: 'ما في أحداث مسجّلة بعد.' }));
            return;
          }

          const table = el('table', { class: 'd-table' });
          table.appendChild(el('thead', {}, '<tr><th>الحدث</th><th>من</th><th>التفاصيل</th><th>الوقت</th></tr>'));
          const body = el('tbody');
          data.items.forEach((row) => {
            const tr = el('tr', { class: row.severity === 'danger' ? 'au-danger' : row.severity === 'warn' ? 'au-warn' : '' });
            tr.appendChild(
              el('td', {
                html: `<span class="au-badge ${row.severity}">${ic(row.severity === 'danger' ? 'ban' : row.severity === 'warn' ? 'warning' : 'check', 13)} ${esc(row.label)}</span>`,
              }),
            );
            tr.appendChild(
              el('td', {
                html: row.actorId
                  ? `<span class="au-actor">${ic('userRound', 14)} ${esc(row.actorName || row.actorId)}</span>`
                  : '<span class="au-actor muted">النظام</span>',
              }),
            );
            tr.appendChild(el('td', { html: `<span class="au-detail">${esc(row.detail || row.target || '—')}</span>` }));
            tr.appendChild(el('td', { html: `<span class="au-time">${esc(sinceArabic(row.at))}</span>` }));
            body.appendChild(tr);
          });
          table.appendChild(body);
          const wrapTable = el('div', { class: 'd-table-wrap' });
          wrapTable.appendChild(table);
          box.appendChild(wrapTable);

          /* ترقيم الصفحات */
          const pager = el('div', { class: 'd-pager' });
          const pages = Math.ceil(data.total / state2.limit) || 1;
          const current = Math.floor(state2.offset / state2.limit) + 1;
          const prev = el('button', { class: 'd-btn sm ghost', html: `${ic('chevronRight', 14)} الأحدث`, disabled: current <= 1 ? 'disabled' : null });
          prev.addEventListener('click', () => {
            state2.offset = Math.max(0, state2.offset - state2.limit);
            load();
          });
          const next = el('button', { class: 'd-btn sm ghost', html: `الأقدم ${ic('chevronLeft', 14)}`, disabled: current >= pages ? 'disabled' : null });
          next.addEventListener('click', () => {
            if ((state2.offset + state2.limit) >= data.total) return;
            state2.offset += state2.limit;
            load();
          });
          pager.appendChild(el('span', { class: 'muted', text: `صفحة ${current} من ${pages} · ${Number(data.total).toLocaleString('ar-EG')} حدث` }));
          pager.appendChild(el('span', { class: 'grow' }));
          pager.appendChild(prev);
          pager.appendChild(next);
          box.appendChild(pager);
        } catch (err) {
          box.innerHTML = '';
          if (err.status === 403 && (err.code === 'login_required' || /سجّل الدخول/.test(err.message))) {
            const card = el('div', { class: 'd-locked' });
            card.appendChild(el('div', { class: 'ico', html: ic('lock', 22) }));
            card.appendChild(el('b', { text: 'سجل النشاط يظهر بعد تسجيل الدخول' }));
            card.appendChild(el('span', { text: 'السجل يحتوي أسماء الأعضاء وإجراءاتهم — لذلك يُعرض لحساب ديسكورد مسجّل فقط.' }));
            card.appendChild(el('a', { class: 'd-btn primary', href: '/auth/login', html: `${ic('login', 15)} تسجيل الدخول` }));
            box.appendChild(card);
            filters.style.display = 'none';
          } else {
            box.appendChild(el('div', { class: 'd-empty', text: err.message }));
          }
        }
      };

      /* أزرار الفلاتر */
      const sevChips = [
        ['', 'الكل'],
        ['info', 'عادي'],
        ['warn', 'تنبيه'],
        ['danger', 'خطير'],
      ];
      sevChips.forEach(([value, label]) => {
        const chip = el('button', { class: `chip${state2.severity === (value || null) ? ' active' : ''}`, text: label });
        chip.addEventListener('click', () => {
          state2.severity = value || null;
          state2.offset = 0;
          filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
          load();
        });
        filters.appendChild(chip);
      });
      const actionSelect = el('select', { class: 'd-select' });
      ACTION_OPTIONS.forEach(([value, label]) => actionSelect.appendChild(el('option', { value, text: label })));
      actionSelect.addEventListener('change', () => {
        state2.action = actionSelect.value || null;
        state2.offset = 0;
        load();
      });
      filters.appendChild(actionSelect);

      const clearView = el('button', { class: 'd-btn sm ghost', html: `${ic('refresh', 14)} تحديث` });
      clearView.addEventListener('click', () => load());
      filters.appendChild(clearView);

      load();
      return wrap;
    },
  },

  /* ------------------------------ الردود التلقائية ------------------------------ */
  autoReply: {
    group: 'الأعضاء',
    label: 'الردود التلقائية',
    title: 'الردود التلقائية',
    desc: 'حدّد كلمة، والبوت يرد عليك بالرسالة اللي تكتبها — في كل رومات السيرفر.',
    render() {
      const cfg = state.settings.autoReply || {};
      const rules = Array.isArray(cfg.rules) ? cfg.rules : [];

      const MODES = [
        { value: 'contains', label: 'تحتوي على الكلمة (كلمة كاملة)' },
        { value: 'exact', label: 'الرسالة نفسها بالضبط' },
        { value: 'starts', label: 'تبدأ بالكلمة' },
      ];

      /* صفوف القواعد: كل قاعدة تُعدّل مباشرة */
      const rows = el('div');
      rules.forEach((rule, index) => {
        const patch = (part) => {
          const list = rules.map((r, i) => (i === index ? { ...r, ...part } : r));
          setPath('autoReply.rules', list);
        };

        const triggersInput = el('input', {
          class: 'd-input',
          value: (rule.triggers || []).join('، '),
          placeholder: 'مرحبا، هلا، السلام عليكم',
        });
        triggersInput.addEventListener('input', () =>
          patch({ triggers: triggersInput.value.split(/[,،|]/).map((t) => t.trim()).filter(Boolean) }),
        );

        const modeSelect = el('select', { class: 'd-select' });
        MODES.forEach((m) => modeSelect.appendChild(el('option', { value: m.value, text: m.label })));
        pickOption(modeSelect, rule.match || 'contains');
        modeSelect.addEventListener('change', () => patch({ match: modeSelect.value }));

        const channelSelect = el('select', { class: 'd-select' });
        channelSelect.appendChild(el('option', { value: '', text: 'كل رومات السيرفر' }));
        channelOptions().forEach((o) => channelSelect.appendChild(el('option', { value: o.value, text: o.label })));
        pickOption(channelSelect, (rule.channels || [])[0] || '');
        channelSelect.addEventListener('change', () => patch({ channels: channelSelect.value ? [channelSelect.value] : [] }));

        const replyArea = el('textarea', { class: 'd-textarea', placeholder: 'أهلًا {user} — وفصل بين أكثر من رد بـ |' });
        replyArea.value = rule.reply || '';
        replyArea.addEventListener('input', () => patch({ reply: replyArea.value }));

        const cooldownInput = el('input', { class: 'd-input narrow', type: 'number', min: 0, max: 3600 });
        cooldownInput.value = rule.cooldownSeconds ?? cfg.cooldownSeconds ?? 15;
        cooldownInput.addEventListener('input', () => patch({ cooldownSeconds: Math.max(0, Math.min(3600, Number(cooldownInput.value) || 0)) }));

        const delInput = el('input', { class: 'd-input narrow', type: 'number', min: 0, max: 3600 });
        delInput.value = rule.deleteAfterSeconds ?? cfg.deleteAfterSeconds ?? 0;
        delInput.addEventListener('input', () => patch({ deleteAfterSeconds: Math.max(0, Math.min(3600, Number(delInput.value) || 0)) }));

        const pingSwitch = el('label', { class: 'd-switch' });
        const pingInput = el('input', { type: 'checkbox' });
        pingInput.checked = rule.pingUser === true;
        pingInput.addEventListener('change', () => patch({ pingUser: pingInput.checked }));
        pingSwitch.appendChild(pingInput);
        pingSwitch.appendChild(el('span'));

        const activeSwitch = el('label', { class: 'd-switch' });
        const activeInput = el('input', { type: 'checkbox' });
        activeInput.checked = rule.enabled !== false;
        activeInput.addEventListener('change', () => patch({ enabled: activeInput.checked }));
        activeSwitch.appendChild(activeInput);
        activeSwitch.appendChild(el('span'));

        const removeBtn = el('button', { class: 'd-btn sm danger', html: `${ic('trash', 14)} حذف القاعدة` });
        removeBtn.addEventListener('click', () => {
          setPath('autoReply.rules', rules.filter((_, i) => i !== index));
          renderSection('autoReply');
        });

        const head = el('div', { class: 'ar-rule-head' });
        head.appendChild(el('span', { class: 'ar-num', text: String(index + 1) }));
        head.appendChild(el('b', { text: (rule.triggers || []).slice(0, 3).join(' · ') || 'قاعدة جديدة' }));
        head.appendChild(el('span', { class: 'ar-spacer' }));
        head.appendChild(el('span', { class: 'ar-flag', html: `${ic('bell', 13)} مفعّلة`, style: rule.enabled === false ? 'display:none' : '' }));
        head.appendChild(removeBtn);

        const preview = el('div', { class: 'ar-preview' });
        const paintPreview = () => {
          const first = pickLocalReply(rule.reply || '');
          preview.innerHTML = first
            ? `${ic('bubbles', 14)} <span>اللي بينرسل: ${esc(applyLocalVars(first, state.guild))}</span>`
            : `${ic('info', 14)} <span>اكتب نص الرد فوق</span>`;
        };
        replyArea.addEventListener('input', paintPreview);
        paintPreview();

        const card = el('div', { class: 'ar-rule' });
        card.appendChild(head);
        card.appendChild(triggersInput);
        /* ملاحظة: el() وسيطها الثالث نص HTML — نضيف العناصر بـ appendChild لا بمصفوفة */
        const grid = el('div', { class: 'ar-grid' });
        [
          dField('نوع المطابقة', 'كيف نطابق رسالة العضو', [modeSelect]),
          dField('القناة', 'افتراضي: كل رومات السيرفر', [channelSelect]),
          dField('كولداون (ثانية)', 'منع تكرار الرد على نفس العضو', [cooldownInput]),
          dField('حذف الرد بعد (ثانية)', '٠ = يبقى', [delInput]),
          dField('تنبيه العضو', 'يجعل الرد منشن للعضو', [pingSwitch]),
          dField('القاعدة مفعّلة', 'إيقاف قاعدة واحدة بدون حذفها', [activeSwitch]),
        ].forEach((node) => grid.appendChild(node));
        card.appendChild(grid);
        card.appendChild(dField('نص الرد', 'المتغيّرات: {user} منشن · {name} الاسم · {server} السيرفر · {channel} القناة — وفصل بين أكثر من رد بـ |', [replyArea], { wide: true }));
        card.appendChild(preview);
        rows.appendChild(card);
      });

      /* إضافة قاعدة جديدة */
      const newTriggers = el('input', { class: 'd-input', placeholder: 'الكلمات المفتاحية: مرحبا، هلا' });
      const newReply = el('input', { class: 'd-input', placeholder: 'الرد: أهلًا {user}' });
      const addBtn = el('button', { class: 'd-btn primary', html: `${ic('plus', 15)} إضافة رد تلقائي` });
      addBtn.addEventListener('click', () => {
        const triggers = newTriggers.value.split(/[,،|]/).map((t) => t.trim()).filter(Boolean);
        const reply = newReply.value.trim();
        if (!triggers.length) return toast('اكتب كلمة مفتاحية واحدة على الأقل.', true);
        if (!reply) return toast('اكتب نص الرد.', true);
        const list = [
          ...rules,
          {
            id: `r${Date.now().toString(36)}`,
            triggers,
            match: 'contains',
            reply,
            channels: [],
            cooldownSeconds: cfg.cooldownSeconds ?? 15,
            deleteAfterSeconds: cfg.deleteAfterSeconds ?? 0,
            pingUser: false,
            enabled: true,
          },
        ];
        setPath('autoReply.rules', list);
        renderSection('autoReply');
        toast('أضفنا القاعدة — لا تنسَ الحفظ.');
      });
      const adder = el('div', { class: 'd-field-control' });
      [newTriggers, newReply, addBtn].forEach((n) => adder.appendChild(n));

      return [
        dCard('حالة النظام', 'الردود التلقائية تعمل في كل رومات السيرفر', 'bubbles', [
          dField('الردود التلقائية', 'المفتاح الرئيسي — يوقف النظام كامل بضغطة', [dSwitch('autoReply.enabled')]),
          dField('تعمل في كل الرومات', 'مفعّلة = أي روم بالسيرفر · معطّلة = حسب القناة المحدّدة في كل قاعدة', [dSwitch('autoReply.anywhereInServer')]),
          dField('تجاهل البوتات', 'ما يرد على رسائل البوتات', [dSwitch('autoReply.ignoreBots')]),
          dField('الكولداون الافتراضي (ثانية)', 'بين رد ورد لنفس العضو (كل قاعدة تقدر تتجاوزه)', [dNumber('autoReply.cooldownSeconds', { min: 0, max: 3600 })]),
          dField('حذف الرد بعد (ثانية)', 'تنظيف تلقائي لردود البوت (٠ = تبقى)', [dNumber('autoReply.deleteAfterSeconds', { min: 0, max: 3600 })]),
        ]),
        dCard(
          `القواعد (${rules.length})`,
          'كل قاعدة: كلمات مفتاحية + الرد. تُنفَّذ القاعدة الأولى المطابقة فقط',
          'messageEdit',
          rules.length ? [rows] : [el('div', { class: 'd-empty', text: 'ما في ردود تلقائية بعد — أضف أول قاعدة من تحت.' })],
        ),
        dCard('إضافة رد تلقائي', 'اكتب الكلمات ثم الرد، وبعدها كمل التعديل داخل البطاقة', 'plus', [
          dField('قاعدة جديدة', 'الكلمات المفتاحية والرد', [adder], { wide: true }),
          el('p', {
            class: 'd-hint',
            text: 'مثال: الكلمات «مرحبا، هلا، السلام عليكم» ← الرد «أهلًا وسهلًا {user} في سيرفر {server}». وتقدر تكتب أكثر من رد وتفصل بينهم بـ | ليختار البوت واحدًا عشوائيًا.',
          }),
        ]),
      ];
    },
  },

  autoreact: {
    group: 'الأعضاء',
    label: 'التفاعلات التلقائية',
    title: 'التفاعلات التلقائية',
    desc: 'تفاعلات تلقائية على رسائل القنوات المحدّدة أو عند احتواء الرسالة على كلمة.',
    render() {
      const words = state.settings.autoreact.words || [];
      const rows = el('div');
      words.forEach((rule, index) => {
        rows.appendChild(
          dField(`كلمة: ${rule.word}`, `التفاعل: ${rule.emoji}`, [
            (() => {
              const btn = el('button', { class: 'd-btn sm danger', html: `${ic('trash', 14)} حذف` });
              btn.addEventListener('click', () => {
                const list = [...words];
                list.splice(index, 1);
                setPath('autoreact.words', list);
                renderSection('autoreact');
              });
              return btn;
            })(),
          ]),
        );
      });

      const wordInput = el('input', { class: 'd-input', placeholder: 'الكلمة المفتاحية' });
      const emojiInput = el('input', { class: 'd-input narrow', placeholder: 'إيموجي أو <:name:id>' });
      const addRule = el('button', { class: 'd-btn sm primary', html: `${ic('plus', 15)} إضافة قاعدة` });
      addRule.addEventListener('click', () => {
        const word = wordInput.value.trim().toLowerCase();
        const emoji = emojiInput.value.trim();
        if (!word || !emoji) return toast('يجب كتابة الكلمة والإيموجي.', true);
        const list = [...words.filter((r) => r.word !== word), { word, emoji }];
        setPath('autoreact.words', list);
        renderSection('autoreact');
      });
      const adder = el('div', { class: 'd-field-control' });
      [wordInput, emojiInput, addRule].forEach((n) => adder.appendChild(n));

      const emojiOptions = (state.meta.emojis || []).map((e) => ({ value: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`, label: `${e.name}${e.animated ? ' (متحرّك)' : ''}` }));

      return [
        dCard('إعداد التفاعل', '', 'emoticon', [
          dField('تفعيل', '', [dSwitch('autoreact.enabled')]),
          dField('تجاهل رسائل البوتات', '', [dSwitch('autoreact.ignoreBots')]),
          dField('القنوات', 'تفاعل على كل رسالة في هذه القنوات', [dListEditor('autoreact.channels', { type: 'channel' })], { wide: true }),
          dField('الإيموجيات', 'إيموجي عادي أو خارجي — أو اختر من إيموجيات سيرفرك', [dWordEditor('autoreact.emojis', { placeholder: 'إيموجي أو <:name:id>' })], { wide: true }),
          ...(emojiOptions.length
            ? [
                dField('إيموجيات السيرفر', 'إضافة سريعة من إيموجيات سيرفرك', [
                  (() => {
                    const select = el('select', { class: 'd-select' });
                    select.appendChild(el('option', { value: '', text: '— اختر إيموجي —' }));
                    emojiOptions.forEach((o) => select.appendChild(el('option', { value: o.value, text: o.label })));
                    const btn = el('button', { class: 'd-btn sm', html: `${ic('plus', 15)} إضافة` });
                    btn.addEventListener('click', () => {
                      if (!select.value) return toast('اختر إيموجيًا أولًا.', true);
                      const list = state.settings.autoreact.emojis || [];
                      if (list.includes(select.value)) return toast('موجود مسبقًا', true);
                      setPath('autoreact.emojis', [...list, select.value]);
                      renderSection('autoreact');
                    });
                    const wrap = el('div', { class: 'd-field-control' });
                    wrap.appendChild(select);
                    wrap.appendChild(btn);
                    return wrap;
                  })(),
                ]),
              ]
            : []),
        ]),
        dCard('تفاعل حسب كلمة', 'مثال: كلمة «مبروك» تعني إضافة تفاعل تلقائي.', 'message', [rows, dField('إضافة قاعدة', '', [adder], { wide: true })]),
      ];
    },
  },

  /* ------------------------------ التذاكر ------------------------------ */
  tickets: {
    group: 'التذاكر',
    label: 'نظام التذاكر',
    title: 'نظام التذاكر',
    desc: 'لوحة تفاعلية بأربعة أنواع، مع استلام وإغلاق وأرشيف محادثة.',
    render() {
      const types = state.settings.tickets.types || [];

      /* ---------- بطاقة أزرار التذكرة: نص + إيموجي + لون لكل زر ---------- */
      const btnMeta = [
        { key: 'claim', title: 'زر الاستلام', def: { label: 'استلام', emoji: '🙋', style: 'Success' } },
        { key: 'claimDone', title: 'زر «مستلَمة» بعد الاستلام', def: { label: 'مستلَمة', emoji: '🙋', style: 'Secondary' } },
        { key: 'close', title: 'زر الإغلاق', def: { label: 'إغلاق', emoji: '🔒', style: 'Danger' } },
        { key: 'transcript', title: 'زر الأرشيف', def: { label: 'أرشيف', emoji: '📄', style: 'Secondary' } },
        { key: 'addMember', title: 'زر إضافة عضو', def: { label: 'إضافة عضو', emoji: '➕', style: 'Secondary' } },
      ];

      const styleOptions = [
        { value: 'Primary', label: 'أزرق' },
        { value: 'Secondary', label: 'رمادي' },
        { value: 'Success', label: 'أخضر' },
        { value: 'Danger', label: 'أحمر' },
      ];

      const buttonBlocks = btnMeta.map(({ key, title, def }) => {
        const base = `tickets.buttons.${key}`;
        const read = () => {
          const emoji = getPath(`${base}.emoji`);
          return {
            label: (getPath(`${base}.label`) ?? '') || def.label,
            emoji: emoji === null || emoji === undefined ? def.emoji : emoji,
            style: getPath(`${base}.style`) || def.style,
          };
        };
        const preview = dButtonPreview(read);
        const box = el('div', { class: 'd-btnbox' });
        box.appendChild(el('div', { class: 'd-btnbox-title', text: title }));
        box.appendChild(
          dField('نص الزر', 'اللي ينكتب على الزر (حتى ٨٠ حرفًا)', [
            dInput(`${base}.label`, { placeholder: def.label, full: true, onChange: () => preview.refresh() }),
          ]),
        );
        box.appendChild(
          dField('الإيموجي', 'إيموجي عادي أو خارجي <:name:id> — من اللوحة أو بالكتابة', [
            dEmojiField(`${base}.emoji`, { placeholder: def.emoji || 'إيموجي', onChange: () => preview.refresh() }),
          ]),
        );
        box.appendChild(
          dField('لون الزر', '', [dSelect(`${base}.style`, styleOptions, { noneLabel: null, onAfter: () => preview.refresh() })]),
        );
        box.appendChild(dField('المعاينة', 'شكل الزر في ديسكورد', [preview.node]));
        return box;
      });

      const resetButtons = el('button', { class: 'd-btn sm ghost', html: `${ic('refresh', 15)} استرجاع أزرار التذكرة الافتراضية` });
      resetButtons.addEventListener('click', () => {
        btnMeta.forEach(({ key, def }) => setPath(`tickets.buttons.${key}`, { ...def }));
        renderSection('tickets');
        toast('تم استرجاع أزرار التذكرة، اضغط حفظ التغييرات.');
      });

      const buttonsCard = dCard(
        'أزرار التذكرة (نص + إيموجي + لون)',
        'تحكم كامل بأزرار روم التذكرة: اكتب نص كل زر، أضف إيموجي (عادي أو خارجي)، واختر لونه — والمعاينة تظهر فورًا.',
        'ticket',
        [...buttonBlocks, dField('استرجاع الافتراضي', 'يرجّع الأزرار الخمسة لأصلها', [resetButtons], { wide: true })],
      );

      const typeCards = types.map((type, index) => {
        /* معاينة خاصة بهذا النوع (لكل بطاقة معاينتها) */
        const typePreview = dButtonPreview(() => {
          const emoji = getPath(`tickets.types.${index}.emoji`);
          return {
            label: (getPath(`tickets.types.${index}.label`) ?? '') || type.label,
            emoji: emoji === null || emoji === undefined ? '🎫' : emoji,
            style: getPath(`tickets.types.${index}.buttonStyle`) || type.buttonStyle || 'Primary',
          };
        });

        return dCard(
          type.label,
          `المعرّف: <code>${esc(type.id)}</code> • النمط: ${type.buttonStyle || 'Primary'}`,
          'ticket',
          [
            dField('الاسم في اللوحة', '', [dInput(`tickets.types.${index}.label`, { onChange: () => typePreview.refresh() })]),
            dField('الإيموجي', 'إيموجي عادي أو خارجي <:name:id> — أو من اللوحة', [
              dEmojiField(`tickets.types.${index}.emoji`, { placeholder: '🎫', onChange: () => typePreview.refresh() }),
            ]),
            dField('الوصف', 'يظهر في اللوحة تحت الزر', [dInput(`tickets.types.${index}.description`, { full: true })], { wide: true }),
            dField('رسالة داخل التذكرة', 'تعليمات لصاحب التذكرة', [dArea(`tickets.types.${index}.intro`)], { wide: true }),
            dField(
              'لون الزر',
              '',
              [
                dSelect(
                  `tickets.types.${index}.buttonStyle`,
                  [
                    { value: 'Primary', label: 'أزرق' },
                    { value: 'Success', label: 'أخضر' },
                    { value: 'Secondary', label: 'رمادي' },
                    { value: 'Danger', label: 'أحمر' },
                  ],
                  { noneLabel: null, onAfter: () => typePreview.refresh() },
                ),
              ],
            ),
            dField('معاينة الزر', 'شكل زر فتح هذا النوع في ديسكورد', [typePreview.node]),
            dField('حذف النوع', 'يُحفظ بعد الضغط على حفظ', [
              (() => {
                const btn = el('button', { class: 'd-btn sm danger', html: `${ic('trash', 15)} حذف هذا النوع` });
                btn.addEventListener('click', () => {
                  const list = [...types];
                  list.splice(index, 1);
                  setPath('tickets.types', list);
                  renderSection('tickets');
                });
                return btn;
              })(),
            ]),
          ],
        );
      });

      const newId = el('input', { class: 'd-input narrow', placeholder: 'المعرّف' });
      const newLabel = el('input', { class: 'd-input', placeholder: 'الاسم الظاهر' });
      // ملاحظة: إيموجي النوع بيانات تُرسل إلى ديسكورد (زر التذكرة)، وليست عنصرًا في واجهة الموقع
      const newEmoji = el('input', { class: 'd-input narrow', placeholder: 'إيموجي الزر' });
      const addType = el('button', { class: 'd-btn sm primary', html: `${ic('plus', 15)} إضافة نوع` });
      addType.addEventListener('click', () => {
        const id = newId.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
        const label = newLabel.value.trim();
        if (!id || !label) return toast('يجب كتابة المعرّف والاسم.', true);
        if (types.some((t) => t.id === id)) return toast('هذا المعرّف مستخدم مسبقًا.', true);
        if (types.length >= 25) return toast('الحد الأقصى خمسة وعشرون نوعًا.', true);
        setPath('tickets.types', [...types, { id, label, emoji: newEmoji.value.trim() || '🎫', description: '', intro: '', buttonStyle: 'Primary' }]);
        renderSection('tickets');
      });
      const restore = el('button', { class: 'd-btn sm ghost', html: `${ic('refresh', 15)} استرجاع الأنواع الأربعة` });
      restore.addEventListener('click', () => {
        setPath('tickets.types', [
          { id: 'support', label: 'الدعم الفني', emoji: '🛠️', description: 'مشكلة تقنية أو استفسار', intro: 'اكتب مشكلتك بالتفصيل وسيساعدك فريق الدعم الفني.', buttonStyle: 'Primary' },
          { id: 'verify', label: 'التوثيق', emoji: '✅', description: 'طلب توثيق حساب أو رتبة', intro: 'أرسل: من أنت • سبب طلب التوثيق • روابط حساباتك.', buttonStyle: 'Success' },
          { id: 'gift', label: 'الهدايا', emoji: '🎁', description: 'استلام جائزة أو مشكلة في هدية', intro: 'اذكر اسم الهدية/السحب ورقم الرسالة.', buttonStyle: 'Secondary' },
          { id: 'staff', label: 'تقديم إدارة', emoji: '📋', description: 'تقديم للانضمام لفريق الإدارة', intro: 'عبّي نموذج التقديم الذي سيظهر لك بالأزرار.', buttonStyle: 'Danger' },
        ]);
        renderSection('tickets');
        toast('تم استرجاع الأنواع الأربعة، اضغط حفظ التغييرات.');
      });
      const addRow = el('div', { class: 'd-field-control' });
      [newId, newLabel, newEmoji, addType, restore].forEach((n) => addRow.appendChild(n));

      const typeCount = types.length;
      return [
        buttonsCard,
        dCard('الأساسيات', '', 'ticket', [
          dField('تفعيل التذاكر', '', [dSwitch('tickets.enabled')]),
          dField('القسم (Category)', 'تُنشأ فيه قنوات التذاكر', [dSelect('tickets.categoryId', categoryOptions())]),
          dField('رتب الدعم', 'تشوف التذاكر وتستلمها', [dListEditor('tickets.supportRoleIds', { type: 'role' })], { wide: true }),
          dField('قناة أرشيف التذاكر', 'توصلها نسخة المحادثة عند الإغلاق', [dSelect('tickets.logChannelId', channelOptions())]),
          dField('أقصى تذاكر لكل عضو', '', [dNumber('tickets.maxOpenPerUser')]),
        ]),
        dCard('شكل اللوحة', 'اللوحة اللي تنزل في قناة الدعم', 'image', [
          dField(
            'وضع اللوحة',
            typeCount > 5 ? 'تنبيه: الأزرار تسمح بخمسة أنواع كحد أقصى، وعندك ' + typeCount : `عدد الأنواع الحالي: ${typeCount}`,
            [
              dSelect(
                'tickets.panelMode',
                [
                  { value: 'buttons', label: 'أزرار (حتى 5 أنواع)' },
                  { value: 'select', label: 'قائمة منسدلة (حتى 25 نوعًا)' },
                ],
                { noneLabel: null },
              ),
            ],
          ),
          dField('عنوان البنل', '', [dInput('tickets.panelTitle', { full: true })], { wide: true }),
          dField('وصف البنل', '', [dArea('tickets.panelDescription')], { wide: true }),
          dField('فوتر البنل', '', [dInput('tickets.panelFooter', { full: true })], { wide: true }),
          dField('رسالة تعليمات منفصلة', 'رسالة فوق البنل', [dSwitch('tickets.panelSeparateInfo')]),
          dField('نص التعليمات', 'يدعم الإيموجيات الخارجية', [dArea('tickets.panelInfoMessage')], { wide: true }),
          dField('قناة إرسال اللوحة', 'اختر القناة ثم اضغط إرسال (لا يُحفظ)', [
            (() => {
              const select = el('select', { class: 'd-select' });
              select.appendChild(el('option', { value: '', text: '— اختر قناة —' }));
              channelOptions().forEach((o) => select.appendChild(el('option', { value: o.value, text: o.label })));
              select.value = state.panelChannelId || '';
              select.addEventListener('change', () => { state.panelChannelId = select.value; });
              return select;
            })(),
            testButton('نشر لوحة التذاكر', 'panel'),
          ]),
        ]),
        ...typeCards,
        dCard('إضافة نوع جديد', 'أضف أي نوع تذكرة تريده', 'plus', [dField('نوع جديد', '', [addRow], { wide: true })]),
      ];
    },
  },

  /* ------------------------------ تقديم الإدارة ------------------------------ */
  staffapp: {
    group: 'التذاكر',
    label: 'تقديم الإدارة',
    title: 'تقديم الإدارة',
    desc: 'نموذج من خمس خانات مع أزرار القبول والرفض ورسائل تلقائية.',
    render() {
      const a = state.settings.staffApplication || {};
      const fields = a.fields || [];

      const fieldCards = fields.map((field, index) =>
        dCard(
          `الخانة ${index + 1} — ${field.label}`,
          `المعرّف: <code>${esc(field.id)}</code> • ${field.style === 'paragraph' ? 'نص طويل' : 'سطر واحد'}`,
          'clipboard',
          [
            dField('عنوان الخانة', 'يظهر للعضو', [dInput(`staffApplication.fields.${index}.label`)]),
            dField('المثال داخل الخانة', '', [dInput(`staffApplication.fields.${index}.placeholder`, { full: true })], { wide: true }),
            dField(
              'الشكل',
              '',
              [
                dSelect(
                  `staffApplication.fields.${index}.style`,
                  [
                    { value: 'short', label: 'سطر واحد' },
                    { value: 'paragraph', label: 'نص طويل' },
                  ],
                  { noneLabel: null },
                ),
              ],
            ),
            dField('إلزامية', '', [dSwitch(`staffApplication.fields.${index}.required`)]),
          ],
        ),
      );

      return [
        dCard('التشغيل', 'يظهر النموذج في تذاكر «تقديم إدارة» فقط', 'clipboard', [
          dField('تفعيل النموذج', '', [dSwitch('staffApplication.enabled')]),
          dField('قناة مراجعة الطلبات', 'توصلها الطلبات مع أزرار القبول/الرفض', [dSelect('staffApplication.reviewChannelId', channelOptions())]),
          dField('رتب تُنبَّه عند وصول طلب', '', [dListEditor('staffApplication.pingRoleIds', { type: 'role' })], { wide: true }),
          dField('حقل الاسم', 'يُستخرج منه اسم المتقدّم لتسمية التكت', [
            (() => {
              const select = el('select', { class: 'd-select' });
              fields.forEach((f, i) => select.appendChild(el('option', { value: f.id, text: f.label })));
              pickOption(select, a.nameFieldId || fields[0]?.id || '');
              select.addEventListener('change', () => setPath('staffApplication.nameFieldId', select.value));
              return select;
            })(),
          ]),
        ]),
        dCard('نصوص النموذج', '', 'edit', [
          dField('عنوان النموذج', '', [dInput('staffApplication.formTitle', { full: true })], { wide: true }),
          dField('مقدمة الرسالة', 'تظهر قبل الخانات', [dArea('staffApplication.formIntro')], { wide: true }),
          dField('نص زر التعبئة', '', [dInput('staffApplication.formButtonLabel', { full: true })], { wide: true }),
        ]),
        ...fieldCards,
        dCard('عند القبول', 'يصير كل هذا تلقائيًا', 'check', [
          dField('رسالة خاصة للمتقدّم', 'توصله على الخاص', [dArea('staffApplication.acceptMessage')], { wide: true }),
          dField('إرسال الخاص', '', [dSwitch('staffApplication.onAccept.dmApplicant')]),
          dField('رسالة داخل التذكرة', 'المتغيّرات: {user} {number}', [dArea('staffApplication.onAccept.postInTicket')], { wide: true }),
          dField('تنبيه المتقدّم داخل التذكرة', '', [dSwitch('staffApplication.onAccept.pingApplicant')]),
          dField('إعادة تسمية التذكرة', 'تتغيّر باسمه + الترقيم', [dSwitch('staffApplication.onAccept.renameChannel')]),
          dField('شكل اسم التذكرة', '{name} = الاسم • {number} = الرقم', [dInput('staffApplication.onAccept.channelNameFormat', { full: true, placeholder: 'إدارة-{number}-{name}' })], { wide: true }),
          dField('نقل التذكرة إلى قسم', 'قسم «تكتات الإدارة»', [dSelect('staffApplication.onAccept.moveToCategoryId', categoryOptions())]),
          dField('رتبة تُعطى عند القبول', '', [dListEditor('staffApplication.onAccept.addRoleIds', { type: 'role' })], { wide: true }),
        ]),
        dCard('عند الرفض', '', 'close', [
          dField('رسالة خاصة للمتقدّم', '', [dArea('staffApplication.rejectMessage')], { wide: true }),
          dField('إرسال الخاص', '', [dSwitch('staffApplication.onReject.dmApplicant')]),
          dField('طلب سبب الرفض', 'نموذج صغير للمشرف', [dSwitch('staffApplication.askRejectReason')]),
          dField('رسالة داخل التذكرة', '', [dArea('staffApplication.onReject.postInTicket')], { wide: true }),
          dField('إغلاق التذكرة بعد الرفض', '', [dSwitch('staffApplication.onReject.closeTicket')]),
        ]),
      ];
    },
  },

  /* ------------------------------ السجلات ------------------------------ */
  logs: {
    group: 'السجلات',
    label: 'السجلات',
    title: 'السجلات',
    desc: () => `${Object.keys(state.meta.logEvents || {}).length} حدثًا في ${Object.keys(state.meta.logGroups || {}).length} مجموعات — وكل حدث تقدر تحطه في روم خاص فيه.`,
    render() {
      const eventsMeta = state.meta.logEvents || {};
      const groups = state.meta.logGroups || {};
      const activeTotal = Object.keys(eventsMeta).filter((k) => getPath(`logs.events.${k}`)).length;
      const ownChannels = Object.keys(eventsMeta).filter((k) => getPath(`logs.channels.${k}`)).length;

      const cards = [
        dCard('الإعدادات العامة', `المُفعّل حاليًا: ${activeTotal} / ${Object.keys(eventsMeta).length} • أحداث لها روم خاص: ${ownChannels}`, 'scroll', [
          dField('تفعيل السجلات', '', [dSwitch('logs.enabled')]),
          dField('قناة عامة (اختيارية)', 'تُستخدم فقط للأحداث اللي ما لها روم خاص — الأصل: كل حدث لرومه', [dSelect('logs.channelId', channelOptions())]),
          dField('طريقة التوجيه', 'روم الحدث الخاص ← روم المجموعة ← القناة العامة', [
            el('span', { class: 'd-chip', text: `${ownChannels} حدثًا في أرومات خاصة` }),
          ]),
          dField('اختصار', 'فعّل أو أطفئ كل الأحداث مرة واحدة', [
            (() => {
              const on = el('button', { class: 'd-btn sm success', html: `${ic('check', 15)} تفعيل الكل` });
              on.addEventListener('click', () => setAllLogs(true));
              const off = el('button', { class: 'd-btn sm danger', html: `${ic('close', 15)} تعطيل الكل` });
              off.addEventListener('click', () => setAllLogs(false));
              const wrap = el('div', { class: 'd-field-control' });
              wrap.appendChild(on);
              wrap.appendChild(off);
              return wrap;
            })(),
          ]),
        ]),
      ];

      Object.entries(groups).forEach(([groupId, group]) => {
        const keys = Object.keys(eventsMeta).filter((k) => eventsMeta[k].group === groupId);
        const active = keys.filter((k) => getPath(`logs.events.${k}`)).length;

        const grid = el('div', { class: 'd-log-grid' });
        keys.forEach((key) => {
          grid.appendChild(
            dField(
              `${eventsMeta[key].label}`,
              getPath(`logs.channels.${key}`) ? `روم خاص: #${nameOfChannel(getPath(`logs.channels.${key}`))}` : 'بلا روم خاص',
              [
                el('span', { class: 'log-ico', html: ic(iconForEvent(key), 16) }),
                dSwitch(`logs.events.${key}`),
                dSelect(`logs.channels.${key}`, channelOptions(), { noneLabel: 'بلا روم خاص', onAfter: () => renderSection('logs') }),
              ],
            ),
          );
        });

        const onAll = el('button', { class: 'd-btn sm', html: `${ic('check', 14)} الكل` });
        onAll.addEventListener('click', () => setGroupLogs(keys, true));
        const offAll = el('button', { class: 'd-btn sm ghost', html: `${ic('close', 14)} الكل` });
        offAll.addEventListener('click', () => setGroupLogs(keys, false));
        const tailWrap = el('div', { class: 'd-field-control' });
        tailWrap.appendChild(el('span', { class: 'd-chip', text: `${active}/${keys.length}` }));
        tailWrap.appendChild(onAll);
        tailWrap.appendChild(offAll);

        const groupChannel = dField(
          'روم المجموعة',
          'اختصار: يربط كل أحداث هذه المجموعة بروم واحد (الحدث اللي له روم خاص يتقدّم عليه)',
          [dSelect(`logs.channelsByGroup.${groupId}`, channelOptions(), { noneLabel: 'بلا روم للمجموعة' })],
          { wide: true },
        );
        const card = dCard(group.label, '', iconForEvent(keys[0] || groupId), [groupChannel, grid], { tail: tailWrap });
        cards.push(card);
      });

      cards.push(
        dCard('استثناءات', 'قنوات أو رتب لا تُسجَّل أحداثها', 'close', [
          dField('قنوات مستثناة', '', [dListEditor('logs.ignoredChannels', { type: 'channel' })], { wide: true }),
          dField('رتب مستثناة', '', [dListEditor('logs.ignoredRoles', { type: 'role' })], { wide: true }),
          dField('اختبار', 'يرسل رسالة سجل تجريبية', [testButton('إرسال سجل تجريبي')]),
        ]),
      );

      return cards;
    },
  },

  /* ------------------------------ البيانات ------------------------------ */
  data: {
    group: 'البيانات',
    label: 'البيانات',
    title: 'البيانات',
    desc: 'سجل العقوبات، والتذاكر، والمتصدّرون في المستويات.',
    render() {
      const wrap = el('div');
      const seg = el('div', { class: 'd-seg' });
      const box = el('div', { html: '<div class="d-empty">جارٍ التحميل…</div>' });
      const views = [
        ['cases', 'الحالات'],
        ['tickets', 'التذاكر'],
        ['levels', 'المتصدّرون'],
      ];
      if (!state.dataView) state.dataView = 'cases';

      views.forEach(([id, label]) => {
        const btn = el('button', { html: label, class: state.dataView === id ? 'active' : '' });
        btn.addEventListener('click', () => {
          state.dataView = id;
          seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          loadDataView(box, id);
        });
        seg.appendChild(btn);
      });

      wrap.appendChild(seg);
      wrap.appendChild(box);
      loadDataView(box, state.dataView);
      return wrap;
    },
  },
};

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
      const body = { type: state.section, channelId: state.panelChannelId || null };
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
  const wrap = el('div', { style: 'padding:6px 2px' });
  const daily = state.daily || [];
  if (!daily.length) return el('div', { class: 'd-empty', html: `<span class="big">${ic('activity', 28)}</span>لا توجد بيانات نشاط بعد.` });
  const max = Math.max(1, ...daily.map((d) => Math.max(d.messages || 0, d.joins || 0)));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${daily.length * 34} 120`);
  svg.setAttribute('style', 'width:100%;height:150px');
  daily.forEach((d, i) => {
    const h = Math.round(((d.messages || 0) / max) * 100);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(i * 34 + 6));
    rect.setAttribute('y', String(110 - h));
    rect.setAttribute('width', '18');
    rect.setAttribute('height', String(h));
    rect.setAttribute('rx', '5');
    rect.setAttribute('fill', '#5865f2');
    rect.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title')).textContent = `${d.day}: ${d.messages || 0} رسالة • ${d.joins || 0} انضمام`;
    svg.appendChild(rect);
  });
  wrap.appendChild(svg);
  wrap.appendChild(el('div', { class: 'muted', style: 'font-size:.8rem;margin-top:4px', text: 'الأعمدة = عدد الرسائل اليومية' }));
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
  try {
    const data = await api('/admin/security');
    note.innerHTML = '';

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
      table.appendChild(el('thead', {}, '<tr><th>الحدث</th><th>من</th><th>التفاصيل</th><th>الوقت</th></tr>'));
      const body = el('tbody');
      site.items.forEach((row) => {
        const tr = el('tr', { class: row.severity === 'danger' ? 'au-danger' : row.severity === 'warn' ? 'au-warn' : '' });
        tr.appendChild(el('td', { html: `<span class="au-badge ${row.severity}">${esc(row.label)}</span>` }));
        tr.appendChild(el('td', { html: `<span class="au-actor">${esc(row.actorName || row.actorId || 'النظام')}</span>` }));
        tr.appendChild(el('td', { html: `<span class="au-detail">${esc(row.detail || row.target || '—')}</span>` }));
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
        html: `${ic('shield', 15)} <span>هذه الصفحة تظهر لك فقط (مالك الموقع). كل من يسجّل دخول بحساب Discord يظهر هنا تلقائيًا.</span>`,
      }),
    );
    note.appendChild(cards);

    if (!data.members.length) {
      box.innerHTML = '';
      box.appendChild(el('div', { class: 'd-empty', text: 'ما سجّل أحد دخول بعد.' }));
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
      tr.appendChild(el('td', { html: `<span class="sm-badge sm-${esc(m.status)}">${esc(SITE_STATUS_LABEL[m.status] || m.status)}</span>` }));

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

/* ============================ الهيكل العام ============================ */
const GROUP_ORDER = ['عام', 'الأعضاء', 'الأوامر', 'الحماية', 'التذاكر', 'السجلات', 'البيانات', 'إدارة الموقع'];

function buildSidebar() {
  const side = el('aside', { class: 'd-side' });

  const brand = el('div', { class: 'd-side-brand' });
  brand.appendChild(el('span', { class: 'logo', html: logoMark(30) }));
  brand.appendChild(el('span', { html: 'Never<span class="accent">Land</span>' }));
  brand.appendChild(el('a', { class: 'back', href: '/dashboard', html: `${ic('chevronRight', 13)} السيرفرات` }));
  side.appendChild(brand);

  const search = el('div', { class: 'd-search' });
  search.appendChild(el('span', { class: 'ico', html: ic('search', 16) }));
  const searchInput = el('input', { type: 'text', placeholder: 'ابحث عن إعداد...' });
  search.appendChild(searchInput);
  side.appendChild(search);

  const nav = el('nav');
  const items = [];

  GROUP_ORDER.forEach((group) => {
    const entries = Object.entries(SECTIONS).filter(([, s]) => {
      if (s.group !== group) return false;
      if (s.ownerOnly && !state.isOwner) return false; // أقسام المالك لا تظهر لغيره
      return true;
    });
    if (!entries.length) return;
    const groupWrap = el('div', { class: 'd-group' });
    groupWrap.appendChild(el('div', { class: 'd-group-title', text: group }));
    entries.forEach(([id, section]) => {
      const item = el('div', { class: 'd-nav-item', 'data-id': id, title: section.label });
      item.appendChild(el('span', { class: 'ico', html: ic(SECTION_ICONS[id] || 'circle', 18) }));
      item.appendChild(el('span', { class: 'd-nav-label', text: section.label }));
      const dot = el('span', { class: 'dot' });
      item.appendChild(dot);
      item.addEventListener('click', () => {
        state.section = id;
        renderSection(id);
        /* الرابط يتحدّث (#اسم-القسم) — يسمح بفتح قسم معيّن مباشرة من رابط البوت */
        if (window.history?.replaceState) window.history.replaceState(null, '', `#${id}`);
        if (window.innerWidth <= 900) item.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      });
      groupWrap.appendChild(item);
      items.push({ item, id, label: section.label, group, dot });
    });
    nav.appendChild(groupWrap);
  });

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

  side.appendChild(
    el('div', {
      class: 'd-side-foot',
      html: `كل الإعدادات متاحة هنا، ولكل إعداد أمر سلاش مكافئ في ديسكورد.`,
    }),
  );

  return { side, items };
}

function buildHeader() {
  const head = el('div', { class: 'd-head' });
  const headIcon = guildIconUrl(state.guild.id, state.guild.icon);
  if (headIcon) {
    const img = el('img', { class: 'guild-icon', src: headIcon, alt: '' });
    img.addEventListener('error', () => img.replaceWith(iconFallback(state.guild.name)));
    head.appendChild(img);
  } else {
    head.appendChild(iconFallback(state.guild.name));
  }
  const info = el('div');
  info.appendChild(el('h1', { text: state.guild.name }));
  info.appendChild(
    el('div', {
      class: 'sub',
      html: `${(state.guild.memberCount || 0).toLocaleString('ar-EG')} عضو · <span class="${state.guild.botOnline ? 'state-on' : 'state-off'}">${state.guild.botOnline ? 'البوت متصل' : 'البوت غير متصل'}</span> · آخر تحديث ${new Date().toLocaleTimeString('ar-EG')}`,
    }),
  );
  head.appendChild(info);

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
  content.appendChild(el('h2', { class: 'd-page-title', html: `${ic(iconName, 22)} <span>${esc(section.title)}</span>` }));
  /* الوصف يقدر يكون نصًا ثابتًا أو دالة (لعدّادات تتغيّر مثل عدد الأحداث) */
  content.appendChild(el('p', { class: 'd-page-desc', html: typeof section.desc === 'function' ? section.desc() : section.desc }));

  // كل قسم يقدر يرجّع عنصرًا واحدًا أو مصفوفة عناصر أو Fragment
  const output = section.render();
  (Array.isArray(output) ? output : [output]).filter(Boolean).forEach((node) => content.appendChild(node));
  if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateDots(items) {
  const map = {
    overview: null,
    general: null,
    welcome: 'welcome.enabled',
    autorole: 'autorole.enabled',
    leveling: 'leveling.enabled',
    automod: 'automod.enabled',
    moderation: null,
    autoline: 'autoline.enabled',
    autoreact: 'autoreact.enabled',
    tickets: 'tickets.enabled',
    staffapp: 'staffApplication.enabled',
    logs: 'logs.enabled',
    data: null,
  };
  items.forEach(({ item, id }) => {
    const dot = item.querySelector('.dot');
    const key = map[id];
    dot.classList.toggle('off', key ? !getPath(key) : true);
    if (!key) dot.style.display = 'none';
    else dot.style.display = '';
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
    const parts = [`${ic('refresh', 15)} <b>آخر مزامنة مع ديسكورد:</b> <span class="sync-when">${esc(sinceText(s.at))}</span>`];
    if (s.botOnline) parts.push('<span class="sync-ok">البوت متّصل — البيانات لحظية</span>');
    else if (s.hasToken) parts.push('<span class="sync-warn">البوت متوقّف — نعرض آخر مزامنة محفوظة</span>');
    else parts.push('<span class="sync-warn">لم يُربط توكن البوت بعد</span>');
    if (s.guildsKnown) parts.push(`<span class="sync-count">${esc(String(s.guildsKnown))} سيرفر</span>`);
    parts.push(`<span class="sync-live"><i class="live-dot"></i> تغييرات فورية: الموقع ← البوت · وديسكورد ← اللوحة</span>`);
    info.innerHTML = parts.join(' · ');
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
    const badge = bar.querySelector('.sync-live');
    if (!badge) return;
    badge.classList.add('flash');
    setTimeout(() => badge.classList.remove('flash'), 1400);
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
              ? `${ic('shield', 17)} <b>الوصول مقيّد</b> — ${esc(state.viewer.reason || 'تحتاج تسجيل دخول بحساب Discord والرول المطلوب.')}
                 <a class="d-btn primary sm" href="/auth/login">${ic('login', 15)} تسجيل الدخول</a>`
              : `${ic('shield', 17)} <b>عرض عام</b> — تقدر تتصفّح الإعدادات بحرية، أما التعديل فيحتاج تسجيل دخول بحساب Discord.
                 <a class="d-btn primary sm" href="/auth/login">${ic('login', 15)} تسجيل الدخول</a>`,
        }),
      );
    }
    const { side, items } = buildSidebar();
    window.__dashItems = items;
    shell.appendChild(side);

    const main = el('div', { class: 'd-main' });
    main.appendChild(buildHeader());
    main.appendChild(buildSyncBar());
    const content = el('div', { class: 'd-content', id: 'd-content' });
    main.appendChild(content);
    shell.appendChild(main);
    root.appendChild(shell);

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
    renderSection(state.section);
    updateDots(items);
    connectLive();
  } catch (err) {
    root.innerHTML = `<div class="d-loading"><div class="d-empty-ico">${ic('warning', 34)}</div><div>تعذّر تحميل الإعدادات: ${esc(err.message)}</div><a class="d-btn primary" href="/dashboard">الرجوع إلى السيرفرات</a></div>`;
  }
}

document.addEventListener('DOMContentLoaded', boot);
