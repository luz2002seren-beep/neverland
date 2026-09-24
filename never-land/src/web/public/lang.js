'use strict';

/**
 * لغة الموقع: عربي (افتراضي) · English · Français
 * القاموس في lang-dict.js (window.NL_EN / window.NL_FR).
 * الترجمة تتم على النصوص الظاهرة فقط، وأسماء السيرفرات والحسابات تبقى كما هي.
 */
(function (global) {
  const LANGS = ['ar', 'en', 'fr'];
  const SKIP = '.user-name, .guild-info > b, .guild-info b, .d-server-info > b, .d-server-info b, .d-emoji-txt, [data-nl-raw]';

  const PATTERNS = {
    en: [
      [/لم تتم المزامنة بعد/g, 'Not synced yet'],
      [/قبل لحظات/g, 'just now'],
      [/قبل (\d+) دقيقة/g, '$1 min ago'],
      [/قبل (\d+) ساعة/g, '$1 h ago'],
      [/قبل (\d+) يوم/g, '$1 d ago'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*عضو/g, '$1 members'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*سيرفر/g, '$1 servers'],
      [/صفحة (\d+) من (\d+)/g, 'Page $1 of $2'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*حدث/g, '$1 events'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*رسالة/g, '$1 messages'],
    ],
    fr: [
      [/لم تتم المزامنة بعد/g, 'Pas encore synchronisé'],
      [/قبل لحظات/g, 'à l’instant'],
      [/قبل (\d+) دقيقة/g, 'il y a $1 min'],
      [/قبل (\d+) ساعة/g, 'il y a $1 h'],
      [/قبل (\d+) يوم/g, 'il y a $1 j'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*عضو/g, '$1 membres'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*سيرفر/g, '$1 serveurs'],
      [/صفحة (\d+) من (\d+)/g, 'Page $1 sur $2'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*حدث/g, '$1 événements'],
      [/(\d[\d\s,\u0660-\u0669.]*)\s*رسالة/g, '$1 messages'],
    ],
  };

  function lang() {
    const cur = document.documentElement.lang;
    return LANGS.includes(cur) ? cur : 'ar';
  }

  function table() {
    return lang() === 'en' ? global.NL_EN || {} : lang() === 'fr' ? global.NL_FR || {} : null;
  }

  function phrasesFor(dict) {
    if (!dict._sorted) {
      dict._sorted = Object.keys(dict)
        .filter((k) => k.length >= 8 && !k.startsWith('_'))
        .sort((a, b) => b.length - a.length);
    }
    return dict._sorted;
  }

  function applyPatterns(s, code) {
    let out = s;
    for (const [re, rep] of PATTERNS[code] || []) out = out.replace(re, rep);
    return out;
  }

  function translate(s, mode) {
    if (s == null || typeof s !== 'string') return s;
    const code = lang();
    if (code === 'ar' || !/[\u0600-\u06FF]/.test(s)) return s;
    const dict = table();
    if (!dict) return s;
    const trimmed = s.trim();
    if (Object.prototype.hasOwnProperty.call(dict, trimmed)) {
      return s.replace(trimmed, dict[trimmed]);
    }
    let out = s;
    if (mode !== 'exact') {
      for (const key of phrasesFor(dict)) {
        if (out.includes(key)) out = out.split(key).join(dict[key]);
      }
    }
    return applyPatterns(out, code);
  }

  function skipEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches('script, style, textarea, input, option, code, ' + SKIP)) return true;
    if (el.closest('script, style, textarea, option, code, ' + SKIP)) return true;
    return false;
  }

  function translateNode(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      if (skipEl(node.parentElement)) return;
      const next = translate(node.nodeValue, 'full');
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== 1 || skipEl(node)) return;
    for (const name of ['placeholder', 'title', 'aria-label']) {
      if (!node.hasAttribute(name)) continue;
      const v = node.getAttribute(name);
      const n = translate(v, 'full');
      if (n !== v) node.setAttribute(name, n);
    }
    for (const child of [...node.childNodes]) translateNode(child);
  }

  let observing = false;
  function refresh() {
    if (lang() === 'ar' || !document.body) return;
    translateNode(document.body);
  }

  function boot() {
    const code = lang();
    document.documentElement.lang = code;
    document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    if (code !== 'ar') refresh();
    if (!observing) {
      observing = true;
      const obs = new MutationObserver((recs) => {
        const actions = document.querySelector('.d-head-actions');
        if (actions && !actions.querySelector('.lang-switch')) mountSwitch(actions);
        if (lang() === 'ar') return;
        for (const rec of recs) {
          if (rec.type === 'characterData') translateNode(rec.target);
          for (const n of rec.addedNodes) translateNode(n);
          if (rec.type === 'attributes' && rec.target && rec.target.nodeType === 1) {
            const v = rec.target.getAttribute(rec.attributeName);
            if (v) {
              const n = translate(v, 'full');
              if (n !== v) rec.target.setAttribute(rec.attributeName, n);
            }
          }
        }
      });
      obs.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'title', 'aria-label'],
      });
    }
    document.documentElement.removeAttribute('data-lang-pending');
    const actions = document.querySelector('.d-head-actions');
    if (actions) mountSwitch(actions);
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang()) return;
    try { localStorage.setItem('neverland-lang', next); } catch (e) { /* ignore */ }
    document.cookie = 'nl_lang=' + next + '; Path=/; Max-Age=31536000; SameSite=Lax';
    const url = new URL(location.href);
    const had = url.searchParams.has('lang');
    url.searchParams.delete('lang');
    if (had) location.href = url.toString();
    else location.reload();
  }

  function mountSwitch(host) {
    if (!host || host.querySelector('.lang-switch')) return;
    const box = document.createElement('div');
    box.className = 'lang-switch';
    box.setAttribute('role', 'group');
    const titles = { ar: 'العربية', en: 'English', fr: 'Français' };
    const labels = { ar: 'ع', en: 'EN', fr: 'FR' };
    const cur = lang();
    box.setAttribute('aria-label', cur === 'fr' ? 'Langue' : cur === 'en' ? 'Language' : 'اللغة');
    for (const code of LANGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-btn' + (code === cur ? ' on' : '');
      b.dataset.setLang = code;
      b.textContent = labels[code];
      b.title = titles[code];
      b.setAttribute('aria-label', titles[code]);
      box.appendChild(b);
    }
    host.prepend(box);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-lang]');
    if (!b) return;
    e.preventDefault();
    setLang(b.getAttribute('data-set-lang'));
  });

  global.NL = {
    t: (s) => translate(s, 'full'),
    exact: (s) => translate(s, 'exact'),
    lang,
    setLang,
    refresh,
    mountSwitch,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
