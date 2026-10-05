(() => {
  'use strict';

  const form = document.getElementById('botSettingsForm');
  const notice = document.getElementById('botNotice');
  const refresh = document.getElementById('refreshBotStatus');
  let current = null;

  const at = (object, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
  const put = (object, path, value) => {
    const parts = path.split('.');
    let cursor = object;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) cursor[part] = value;
      else cursor = cursor[part] = cursor[part] || {};
    });
    return object;
  };

  function tell(message, type = 'info') {
    if (!notice) return;
    notice.hidden = false;
    notice.dataset.type = type;
    notice.textContent = message;
  }

  function clearNotice() {
    if (notice) notice.hidden = true;
  }

  function humanState(state) {
    return ({ disabled: 'متوقف بأمان', starting: 'جارٍ البدء', ready: 'متصل', degraded: 'يحتاج انتباه', stopped: 'موقوف' })[state] || state || 'غير معروف';
  }

  function fillStatus(data) {
    const runtime = data.runtime || {};
    const environment = data.environment || {};
    const set = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };
    set('runtimeState', humanState(runtime.state));
    set('runtimeError', runtime.error || (runtime.user ? `Logged in as ${runtime.user.tag || runtime.user.id}` : 'لا توجد بيانات حساسة معروضة هنا.'));
    set('openTickets', String(data.ticketsOpen || 0));
    set('casesRecent', String(data.casesRecent || 0));

    const checks = [
      environment.tokenConfigured ? 'Token ✓' : 'Token missing',
      environment.applicationConfigured ? 'App ✓' : 'Client ID missing',
      environment.primaryGuildConfigured ? 'Guild ✓' : 'Primary guild missing',
      environment.transport === 'proxy' ? (environment.proxyConfigured ? 'Relay ✓' : 'Relay incomplete') : environment.transport === 'direct' ? 'Direct REST (explicit)' : 'REST blocked',
    ];
    set('discordReadiness', checks.every((item) => item.endsWith('✓')) ? 'جاهز للتشغيل' : 'إعداد ناقص');
    set('discordReadinessHint', checks.join(' · '));
  }

  function populate(values) {
    if (!form || !values) return;
    form.querySelectorAll('[data-path]').forEach((field) => {
      const value = at(values, field.dataset.path);
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else if (field.dataset.list) field.value = Array.isArray(value) ? value.join('\n') : '';
      else field.value = value == null ? '' : String(value);
    });
    if (form.dataset.readonly === 'true') form.querySelectorAll('input, textarea, select, button').forEach((field) => { field.disabled = true; });
  }

  function collect() {
    const patch = {};
    form.querySelectorAll('[data-path]').forEach((field) => {
      let value;
      if (field.type === 'checkbox') value = field.checked;
      else if (field.dataset.list) value = field.value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
      else if (field.type === 'number') value = Number(field.value);
      else value = field.value;
      put(patch, field.dataset.path, value);
    });
    return patch;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
      ...options,
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) throw new Error(payload?.message || 'Unable to complete the request.');
    return payload;
  }

  async function load() {
    clearNotice();
    try {
      const data = await request('/api/bot-v2');
      current = data;
      populate(data.settings);
      fillStatus(data);
    } catch (error) {
      tell(`تعذّر تحميل مركز البوت: ${error.message}`, 'error');
    }
  }

  if (refresh) refresh.addEventListener('click', load);
  if (form && form.dataset.readonly !== 'true') {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit) { submit.disabled = true; submit.textContent = 'جارٍ الحفظ…'; }
      clearNotice();
      try {
        const data = await request('/api/bot-v2/config', { method: 'PUT', body: JSON.stringify({ settings: collect() }) });
        current = data;
        populate(data.settings);
        fillStatus(data);
        tell('تم حفظ إعدادات Bot V2. التشغيل يحتاج RUN_BOT=true وإعدادات Railway المعتمدة فقط.', 'success');
      } catch (error) {
        tell(`لم يتم الحفظ: ${error.message}`, 'error');
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = 'حفظ إعدادات Bot V2'; }
      }
    });
  }

  load();
})();
