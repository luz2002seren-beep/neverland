'use strict';

/**
 * app-sections.js — أقسام لوحة التحكم (الجزء الأكبر من الواجهة)
 * -------------------------------------------------------------
 * كان هذا الكتلة داخل app.js (2,228 سطرًا من 3,829) فصار ملفًا مستقلًا.
 *
 * لماذا هذا آمن بلا أي نظام وحدات؟
 *   • كل <script> كلاسيكي يتقاسم البيئة المعجمية العامة، فـ const SECTIONS
 *     هنا ظاهرة لدوال app.js.
 *   • app.js لا يمسّ SECTIONS على المستوى الأعلى إطلاقًا (مُتحقَّق: 0 استعمال
 *     خارج الكتل)، فلا خطر TDZ عند تنفيذ هذا الملف بعده.
 *   • الإقلاع مؤجَّل إلى DOMContentLoaded، أي بعد تنفيذ كل الوسوم.
 *
 * يعتمد على أدوات معرَّفة في app.js: state, el, ic, esc, toast, getPath,
 * setPath, dField, dSwitch, dInput, dList, dNumber, dArea, dSelect, dChips,
 * dCard, dListEditor, dWordEditor, dEmojiField, dButtonPreview, pickOption,
 * channelOptions, roleOptions, categoryOptions, nameOfChannel, nameOfRole,
 * icon, iconForEvent, DEFAULT_LINE_STYLES.
 *
 * [مهم] لازم يُحمَّل بعد app.js (انظر ASSET_FILES ووسم <script> في routes/pages.js).
 * -------------------------------------------------------------
 */
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
        ['chart', (st.messages ?? 0).toLocaleString(numLoc()), 'رسائل محسوبة'],
        ['users', (state.guild.memberCount || st.trackedMembers || 0).toLocaleString(numLoc()), 'عضو'],
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
        dField('عدد الأعضاء', '', [el('b', { class: 'accent', text: (state.guild.memberCount || 0).toLocaleString(numLoc()) })]),
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
      /* معاينة حيّة لشكل الردود — نفس محرّك البوت على السيرفر (مو نسخة مكرّرة) */
      const sampleNode = el('div', { class: 'd-sample' });
      const paintSample = async () => {
        const english = getPath('replies.english') === false ? '0' : '1';
        const font = getPath('replies.fancyFont') === false ? '0' : '1';
        try {
          const data = await api(`/guilds/${state.guildId}/replies/preview?english=${english}&font=${font}`);
          sampleNode.innerHTML = '';
          data.samples.forEach(({ before, after }) => {
            const row = el('div', { class: 'd-sample-row' });
            row.appendChild(el('span', { class: 'old', text: before }));
            row.appendChild(el('span', { class: 'arrow', html: ic('arrowLeft', 14) }));
            row.appendChild(el('span', { class: 'new', text: after }));
            sampleNode.appendChild(row);
          });
        } catch {
          sampleNode.innerHTML = '';
          sampleNode.appendChild(el('span', { class: 'd-chip', text: 'ما قدرت أجيب المعاينة' }));
        }
      };
      paintSample();

      const repaint = () => setTimeout(paintSample, 120);

      /* --------- معاينة حالة البوت (Presence): بنفسجية وقت البث --------- */
      const presenceBox = el('div', { class: 'd-sample pres-preview' });
      const paintPresence = () => {
        presenceBox.textContent = '';
        const name = String(getPath('presence.name') || '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅');
        const type = String(getPath('presence.type') || 'streaming');
        const status = String(getPath('presence.status') || 'online');
        const verbs = { streaming: 'يبثّ', playing: 'يشتغل على', watching: 'يشاهد', listening: 'يسمع', competing: 'يتنافس في', custom: 'الحالة' };
        const statusLabels = { online: 'متصل', idle: 'خامل', dnd: 'عدم الإزعاج', invisible: 'غير ظاهر' };
        const dotColors = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', invisible: '#80848e' };
        const isStream = type === 'streaming';

        const line = el('div', { class: 'd-sample-row pres-line' });
        const dot = el('span', { class: `pres-dot${isStream ? ' live' : ''}` });
        dot.style.background = isStream ? '#9146ff' : (dotColors[status] || '#23a55a');
        line.appendChild(dot);
        line.appendChild(el('b', { text: name }));
        if (isStream) line.appendChild(el('span', { class: 'pres-badge', text: 'مباشر' }));
        presenceBox.appendChild(line);
        presenceBox.appendChild(el('div', { class: 'd-chip', text: `${verbs[type] || 'الحالة'} ${name} · ${statusLabels[status] || status}` }));
        if (isStream && !getPath('presence.url')) {
          presenceBox.appendChild(el('div', { class: 'd-chip warn', text: 'نوع «بث مباشر» يحتاج رابط بث (افتراضيًا رابط تويش)' }));
        }
      };
      paintPresence();

      const applyPresenceBtn = el('button', { class: 'd-btn sm primary', html: `${ic('check', 15)} طبّق الحالة الآن` });
      applyPresenceBtn.addEventListener('click', async () => {
        applyPresenceBtn.disabled = true;
        try {
          const result = await api(`/guilds/${state.guildId}/presence`, {
            method: 'POST',
            body: {
              name: getPath('presence.name'),
              type: getPath('presence.type'),
              url: getPath('presence.url'),
              status: getPath('presence.status'),
            },
          });
          toast(result.message || 'تحدّثت حالة البوت.');
        } catch (err) {
          toast(err.message || 'ما قدرت أضبط الحالة.', true);
        } finally {
          applyPresenceBtn.disabled = false;
        }
      });

      const presenceFields = [
        dField('المعاينة', 'شكل الحالة كما تظهر عند الأعضاء', [presenceBox], { wide: true }),
        dField('اسم الحالة', 'اللي ينكتب جنب «يبثّ» — يدعم الخط المزخرف', [
          dInput('presence.name', { full: true, placeholder: '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅', onChange: () => paintPresence() }),
        ], { wide: true }),
        dField('نوع الحالة', '«بث مباشر» = لون بنفسجي + شارة مباشر (زي حالة ستريمنغ)', [
          dChips('presence.type', [
            { value: 'streaming', label: 'بث مباشر (بنفسجي)', onAfter: () => paintPresence() },
            { value: 'playing', label: 'يلعب', onAfter: () => paintPresence() },
            { value: 'watching', label: 'يشاهد', onAfter: () => paintPresence() },
            { value: 'listening', label: 'يسمع', onAfter: () => paintPresence() },
            { value: 'competing', label: 'يتنافس', onAfter: () => paintPresence() },
          ]),
        ], { wide: true }),
        dField('رابط البث', 'مطلوب لنوع «بث مباشر» — رابط تويش أو يوتيوب', [
          dInput('presence.url', { full: true, placeholder: 'https://www.twitch.tv/never_land', onChange: () => paintPresence() }),
        ], { wide: true }),
        dField('حالة الاتصال', 'لون النقطة جنب الاسم', [
          dChips('presence.status', [
            { value: 'online', label: 'متصل', onAfter: () => paintPresence() },
            { value: 'idle', label: 'خامل', onAfter: () => paintPresence() },
            { value: 'dnd', label: 'عدم الإزعاج', onAfter: () => paintPresence() },
            { value: 'invisible', label: 'غير ظاهر', onAfter: () => paintPresence() },
          ]),
        ], { wide: true }),
        dField('تطبيق الحالة', 'يُطبَّق فورًا على البوت الشغّال (بلا إعادة تشغيل)', [applyPresenceBtn]),
      ];

      return [
        dCard('الأساسيات', 'تنطبق على كل الأنظمة', 'settings', [
          dField('لغة البوت', 'اللغة الافتراضية للرسائل والأوامر', [
            dSelect('language', [{ value: 'ar', label: '🇸🇦 العربية' }, { value: 'en', label: '🇬🇧 English' }], { noneLabel: null }),
          ]),
          dField('البادئة النصية', 'للأوامر التقليدية بالرسائل (اختياري)', [dInput('prefix', { narrow: true, placeholder: '!' })]),
          dField('قناة الاستفسارات', 'قناة عامة للأسئلة (اختياري)', [dSelect('reports.channelId', channelOptions())]),
          dField('نظام الدعوات (Referral)', 'تتبّع من دعا من', [dSwitch('referral.enabled')]),
          dField('قناة الدعوات', '', [dSelect('referral.channelId', channelOptions())]),
        ]),
        dCard('حالة البوت (Presence)', 'اللي تظهر تحت اسم البوت في كل السيرفرات · «بث مباشر» = لون بنفسجي + شارة مباشر · التعديل يطبَّق فورًا بلا إعادة تشغيل.', 'activity', presenceFields, { wide: true }),
        dCard(
          'شكل الردود',
          'ردود البوت كلها بالإنجليزية وبالخط المزخرف — القوائم والأزرار تبقى بنص عادي حتى تكون واضحة.',
          'message',
          [
            dField('ردود بالإنجليزية', 'كل رسائل البوت بالإنجليزية (الأوامر · الترحيب · اللوقات · التذاكر)', [
              dSwitch('replies.english', repaint),
            ]),
            dField('الخط المزخرف', 'الخط المزخرف 𝑪𝒉𝒂𝒕 مع حماية المنشنات والروابط والأكواد', [
              dSwitch('replies.fancyFont', repaint),
            ]),
            dField('معاينة', 'شكل الرد قبل وبعد', [sampleNode], { wide: true }),
          ],
        ),
      ];
    },
  },

  /* ------------------------------ الترحيب ------------------------------ */
  welcome: {
    group: 'الأعضاء',
    label: 'الترحيب والوداع',
    title: 'الترحيب والوداع',
    desc: 'صورة إطار Never Land وأفتار العضو داخل الدائرة + رسالة عادية بلا إطار، ورسائل الوداع والدعم.',
    render() {
      const frag = document.createDocumentFragment();

      /* --------- ١) صورة الترحيب (بطاقة بالأفتار) — الأهم --------- */
      const previewPath = '/api/welcome-card';
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
              { value: 'frame', label: 'إطار Never Land (الأفتار داخل الدائرة)' },
              { value: 'card', label: 'بطاقة ترحيب بالأفتار (الطريقة الاحترافية)' },
              { value: 'avatar', label: 'صورة الأفتار فقط' },
              { value: 'custom', label: 'رابط صورة مخصّص' },
              { value: 'none', label: 'بدون صورة' },
            ],
            { noneLabel: null, onAfter: () => { previewImg.src = `${previewPath}?t=${Date.now()}`; } },
          ),
        ]),
        dField('صورة الإطار', 'صورة السيرفر اللي فيها الدائرة الفارغة — يُرسم أفتار العضو داخل الدائرة', [dInput('welcome.frameImage', { full: true, onChange: () => { previewImg.src = `${previewPath}?t=${Date.now()}`; } })], { wide: true }),
        dField('مكان الدائرة داخل الصورة', 'نسب من العرض/الارتفاع: cx (يمين) · cy (تحت) · r (نصف القطر)', [
          dInput('welcome.frameCircle.cx', { narrow: true, placeholder: 'cx' }),
          dInput('welcome.frameCircle.cy', { narrow: true, placeholder: 'cy' }),
          dInput('welcome.frameCircle.r', { narrow: true, placeholder: 'r' }),
        ]),
        dField('النص المرسوم على الصورة', 'يُستخدم في «بطاقة ترحيب بالأفتار» — المتغيّرات: {displayName} · {username} · {server} · {memberCount}', [dInput('welcome.cardMessage', { full: true, placeholder: 'مثال: أهلاً بك {displayName} في {server}' })], { wide: true }),
        dField('خلفية البطاقة', 'رابط صورة (اختياري) — بدونها تُستخدم ألوان التدرّج', [dInput('welcome.cardBackground', { full: true, placeholder: 'https://...' })], { wide: true }),
        dField('تدرّج لون البطاقة', 'من لون إلى لون', [dInput('welcome.cardTheme.from', { narrow: true }), dInput('welcome.cardTheme.to', { narrow: true })]),
        dField('رابط الصورة المخصّصة', 'يُستخدم عند اختيار «رابط صورة مخصّص» — يدعم {avatar}', [dInput('welcome.imageUrl', { full: true, placeholder: 'https://...' })], { wide: true }),
        dField('إرفاق الصورة كملف', 'جودة أفضل من الرابط', [dSwitch('welcome.attachImage')]),
        dField('اختبار البطاقة', 'يرسل بطاقة نموذجية في قناة الترحيب', [testButton('إرسال بطاقة تجريبية', 'card')]),
        dField('ترحيب تجريبي كامل', 'يرسل رسالة ترحيب حقيقية (الصورة + النص + الداعي) في قناة الترحيب', [
          (() => {
            const btn = el('button', { class: 'd-btn sm primary', html: `${ic('userPlus', 15)} أرسل ترحيب تجريبي` });
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              try {
                const result = await api(`/guilds/${state.guildId}/actions/welcome`, {
                  method: 'POST',
                  body: { channelId: getPath('welcome.channelId') || null },
                });
                const r = result.result || {};
                const extra = r.separateMessages ? ` · رسالة الصورة: ${r.imageMessageId} · رسالة النص: ${r.textMessageId}` : '';
                toast((result.message || 'انبعت الترحيب التجريبي — شوف الروم.') + extra);
              } catch (err) {
                toast(err.message || 'ما قدرت أرسل الترحيب.', true);
              } finally {
                btn.disabled = false;
              }
            });
            return btn;
          })(),
        ]),
      ];

      function welcomePublicCodes() {
        return dList('welcome.publicInviteCodes', { full: true, placeholder: 'مثال: NeverLand · discord.gg/xxxx' });
      }

      /* فحص الإيموجيات: نبيّن أي إيموجي في النص مو موجود بالسيرفر (بينطبع كنص) */
      const emojiCheck = el('div', { class: 'd-sample cr-preview' });
      const paintEmojiCheck = () => {
        emojiCheck.textContent = '';
        const text = String(getPath('welcome.message') || '');
        const known = new Map((state.meta.emojis || []).map((e) => [String(e.id), e]));
        const tags = [...text.matchAll(/<(a?):([\w~]+):(\d{5,})>/g)];
        const missing = [];
        const seen = new Set();
        tags.forEach(([, animated, name, id]) => {
          if (seen.has(id)) return;
          seen.add(id);
          if (!known.has(id)) missing.push({ name, id, animated: Boolean(animated) });
        });
        if (!tags.length) {
          emojiCheck.appendChild(el('div', { class: 'd-empty', text: 'ما في إيموجيات خارجية في النص — كل شي تمام.' }));
          return;
        }
        if (!missing.length) {
          emojiCheck.appendChild(el('div', { class: 'd-empty', text: 'كل الإيموجيات الموجودة في النص مسجّلة عندك في السيرفر — راح تظهر صح.' }));
          return;
        }
        missing.forEach((m) => {
          const row = el('div', { class: 'd-empty' });
          row.appendChild(el('b', { text: `${m.name} ` }));
          row.appendChild(el('span', { text: `(${m.animated ? 'متحرك' : 'ثابت'}) — مو موجود في السيرفر، وراح ينطبع كنص «:${m.name}:». أضِفه للسيرفر ويرجع يظهر تلقائيًا.` }));
          emojiCheck.appendChild(row);
        });
      };
      paintEmojiCheck();

      const cardNode = dCard(
        'صورة الترحيب (إطار Never Land بالأفتار)',
        'الصورة اللي فيها الدائرة الفارغة، ويُرسم فيها أفتار العضو الجديد — تُرسل مع رسالة عادية بدون إطار Embed.',
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
            dField('نص الرسالة', 'يظهر تحت الصورة · المتغيّرات: {user} · {displayName} · {inviter} (مين أرسل الرابط) · {inviteCode} · {memberCount} — ويدعم الإيموجيات الخارجية <:name:id>', [dArea('welcome.message', { onChange: () => paintEmojiCheck() })], { wide: true }),
            dField('فحص الإيموجيات', 'ديسكورد ما يعرض إيموجي سيرفر ثاني — لازم الإيموجي يكون موجود عندك في السيرفر', [emojiCheck], { wide: true }),
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
            dField('طريقة الإرسال', '«الصورة أولًا» = رسالة فيها الصورة بالأول، وبعدها رسالة فيها النص (زي ما طلبت)', [
              dChips('welcome.imageFirst', [ { value: true, label: 'الصورة أولًا ثم النص (رسالتان)' }, { value: false, label: 'رسالة واحدة (صورة + نص)' } ]),
            ], { wide: true }),
            dField('منشن الداعي في {inviter}', 'مفعّل = {inviter} يطلع منشن · مطفأ = اسم الداعي فقط', [dSwitch('welcome.inviterMention')]),
            dField('منشن الدعوة العامة', 'آيدي العضو الذي يُمنشن لما تكون الدعوة عامة (رابط عام/فانيتي) أو صاحبها غير معروف — بدل «غير معروف»', [dInput('welcome.publicInviterId', { full: true, placeholder: 'آيدي العضو' })], { wide: true }),
            dField('أكواد الدعوات العامة', 'روابط/أكواد تُعتبر عامة ⇒ يُمنشن صاحب الدعوة العام بدل صانع الرابط — افصل بينها بفاصلة أو سطر', [welcomePublicCodes()], { wide: true }),
            dField('إيموجي بديل (يونيكود)', 'يُستخدم وقت الإرسال إذا تعذّر رفع الإيموجي الخارجي للسيرفر — بدل ما ينطبع :os49: نصًا', [dInput('welcome.emojiFallback', { narrow: true, placeholder: 'بدون' })]),
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
    desc: 'الدفاعات المفعّلة. الزائر ما يشوف بيانات السيرفر.',
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
    desc: 'تضيف من يدخل الموقع. اللي يحاول يدخل يظهر هنا لحالك، وما يفتح إلا بعد ما تسمح له.',
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

          /* حد الاستخدام (الكولداون) انشال من الأوامر — ما في حقل باللوحة */
          const counts = el('div', { class: 'cmd-counts' });
          counts.appendChild(el('span', { text: `${data.counts?.allTotal || data.items.length} أمر في البوت` }));
          counts.appendChild(el('span', { class: 'ok', text: `${data.counts?.member ?? 0} أوامر أعضاء` }));
          counts.appendChild(el('span', { class: 'lock', text: `${data.counts?.staff ?? 0} أوامر إدارة` }));

          bar.appendChild(enabledWrap);
          bar.appendChild(counts);
          bar.appendChild(el('span', { class: 'grow' }));
          bar.appendChild(sgWrap);
          statusBox.appendChild(bar);

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

  /* ------------------------------ ردود أوامر ------------------------------ */
  commandReplies: {
    group: 'الأوامر',
    label: 'ردود أوامر',
    title: 'ردود أوامر',
    desc: 'شكل رد البوت على كل أمر: رسالة نصية عادية أو إمبد — وتكتب نص الرد بنفسك (متغيّرات: {user} · {reason} · {case} · {count} · {channel} · {moderator}).',
    render() {
      const wrap = el('div');
      const box = el('div');
      wrap.appendChild(box);

      const MODES = [
        { value: 'default', label: 'الافتراضي' },
        { value: 'text', label: 'رسالة نصية' },
        { value: 'embed', label: 'إمبد (إطار)' },
      ];

      const paintPreview = (previewEl, preview) => {
        previewEl.innerHTML = '';
        const row = (cls, label, text) => {
          const node = el('div', { class: `d-sample-row ${cls}` });
          node.appendChild(el('span', { class: 'new', text: `${label}: ${String(text || '—').slice(0, 400)}` }));
          return node;
        };
        previewEl.appendChild(row('old', 'الافتراضي', preview.before));
        previewEl.appendChild(row('new', 'الحالي', preview.after));
      };

      const load = async () => {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'd-empty', text: 'جارٍ تحميل الأوامر…' }));
        try {
          const data = await api(`/guilds/${state.guildId}/command-replies`);
          box.innerHTML = '';

          const bar = el('div', { class: 'guide-bar' });
          bar.appendChild(el('div', { class: 'd-empty', text: `${data.items.length} أمر — كل أمر تختار شكله وتكتب نصه، واللي تكتبه ينحفظ مع شريط الحفظ السفلي.` }));
          box.appendChild(bar);

          const list = el('div', { class: 'cr-list' });
          box.appendChild(list);

          data.items.forEach((item) => {
            const card = el('div', { class: 'd-card cr-card' });
            const head = el('div', { class: 'd-card-head' });
            head.appendChild(el('h3', { html: `<code>/${item.name}</code> ${item.label}` }));
            head.appendChild(el('span', {
              class: `tag ${item.audience === 'staff' ? 'lock' : 'ok'}`,
              text: item.audience === 'staff' ? 'إدارة' : 'أعضاء',
            }));
            card.appendChild(head);

            const body = el('div', { class: 'd-card-body cr-body' });

            /* الوضع: افتراضي · نص · إمبد */
            const modeSelect = el('select', { class: 'd-select' });
            MODES.forEach((m) => {
              const opt = el('option', { value: m.value, text: m.label });
              if ((getPath(`commandReplies.${item.name}.mode`) || 'default') === m.value) opt.selected = true;
              modeSelect.appendChild(opt);
            });
            modeSelect.value = getPath(`commandReplies.${item.name}.mode`) || 'default';

            /* نص الرد المخصّص */
            const textArea = el('textarea', { class: 'd-textarea', rows: '2', placeholder: 'اكتب نص الرد هنا (اختياري)…' });
            textArea.value = getPath(`commandReplies.${item.name}.text`) || '';
            textArea.addEventListener('input', () => {
              setPath(`commandReplies.${item.name}.text`, textArea.value);
              refresh();
            });

            modeSelect.addEventListener('change', () => {
              if (modeSelect.value === 'default') setPath(`commandReplies.${item.name}.mode`, '');
              else setPath(`commandReplies.${item.name}.mode`, modeSelect.value);
              refresh();
            });

            const previewEl = el('div', { class: 'd-sample cr-preview' });
            paintPreview(previewEl, { before: item.before, after: item.after });

            let timer = null;
            const refresh = () => {
              clearTimeout(timer);
              timer = setTimeout(async () => {
                try {
                  const mode = modeSelect.value === 'default' ? '' : modeSelect.value;
                  const query = new URLSearchParams({ command: item.name, mode, text: textArea.value || '' }).toString();
                  const live = await api(`/guilds/${state.guildId}/command-replies?${query}`);
                  paintPreview(previewEl, live.preview);
                } catch { /* المعاينة بس */ }
              }, 250);
            };

            body.appendChild(dField('شكل الرد', 'افتراضي = نفس ما هو الآن (العقوبات نصية والبقية إمبد)', [modeSelect]));
            body.appendChild(dField('نص الرد', 'لو كتبت نص هنا يُستخدم بدل النص الأصلي — المتغيّرات تُستبدل تلقائيًا', [textArea], { wide: true }));
            body.appendChild(dField('معاينة', 'فوق: الافتراضي · تحت: بعد تعديلك', [previewEl], { wide: true }));

            card.appendChild(body);
            list.appendChild(card);
          });
        } catch (err) {
          box.innerHTML = '';
          box.appendChild(el('div', { class: 'd-empty', text: err.message || 'ما قدرت أجيب الأوامر.' }));
        }
      };

      load();
      return wrap;
    },
  },

  /* ------------------------------ روم الأوامر ------------------------------ */
  commandRoom: {
    group: 'الأوامر',
    label: 'روم الأوامر',
    title: 'روم الأوامر',
    desc: 'روم مخصّص للأوامر: البوت ينشر فيه رسالة ترحيب بصور السيرفر، ويحذف كل الرسائل (ومنها رسالته) ويعيد نشرها كل مدة تحددها — ٦٠ ثانية افتراضيًا.',
    render() {
      const wrap = el('div');

      const sendRow = el('div', { class: 'd-inline' });
      const channelSelect = el('select', { class: 'd-select' });
      channelSelect.appendChild(el('option', { value: '', text: '— اختر روم الأوامر —' }));
      channelOptions().forEach((o) => channelSelect.appendChild(el('option', { value: o.value, text: o.label })));
      channelSelect.value = state.commandRoomChannelId || getPath('commandRoom.channelId') || '';
      channelSelect.addEventListener('change', () => {
        state.commandRoomChannelId = channelSelect.value;
        setPath('commandRoom.channelId', channelSelect.value);
      });
      sendRow.appendChild(channelSelect);

      const sendNow = el('button', { class: 'd-btn sm', html: `${ic('upload', 15)} إرسال الرسالة الآن` });
      sendNow.addEventListener('click', async () => {
        sendNow.disabled = true;
        try {
          const body = { channelId: channelSelect.value || getPath('commandRoom.channelId') };
          await api(`/guilds/${state.guildId}/command-room/publish`, { method: 'POST', body });
          toast('انبعتت رسالة روم الأوامر — شوف الروم.');
        } catch (err) {
          toast(err.message || 'ما قدرت أرسل الرسالة.', 'error');
        } finally {
          sendNow.disabled = false;
        }
      });
      sendRow.appendChild(sendNow);

      const cleanNow = el('button', { class: 'd-btn sm ghost', html: `${ic('trash', 15)} نظّف الروم الآن` });
      cleanNow.addEventListener('click', async () => {
        cleanNow.disabled = true;
        try {
          const body = { channelId: channelSelect.value || getPath('commandRoom.channelId') };
          await api(`/guilds/${state.guildId}/command-room/clean`, { method: 'POST', body });
          toast('تم تنظيف الروم.');
        } catch (err) {
          toast(err.message || 'ما قدرت أنظّف الروم.', 'error');
        } finally {
          cleanNow.disabled = false;
        }
      });
      sendRow.appendChild(cleanNow);

      /* معاينة الصورة */
      const preview = el('div', { class: 'd-sample cr-preview' });
      const paint = () => {
        const previewBox = el('div', { class: 'd-sample-row new' });
        const img = el('img', {
          src: '/assets/commands-room.webp',
          alt: 'صورة روم الأوامر',
          style: 'max-width:100%;border-radius:12px;border:1px solid var(--line)',
        });
        previewBox.appendChild(el('span', { class: 'new', text: (getPath('commandRoom.text') || '(ما في نص)').slice(0, 200) }));
        preview.appendChild(el('div', { class: 'd-empty', text: 'الصورة المرفقة مع الرسالة:' }));
        preview.appendChild(img);
        preview.appendChild(previewBox);
      };
      paint();

      wrap.appendChild(
        dCard('إعداد روم الأوامر', 'اختر الروم، اكتب الرسالة، وحدّد كل كم ثانية يُنظَّف الروم.', 'refresh', [
          dField('تشغيل روم الأوامر', 'التنظيف التلقائي + رسالة الترحيب', [dSwitch('commandRoom.enabled')]),
          dField('الروم', 'الروم المخصّص للأوامر', [channelSelect], { wide: true }),
          dField('كل كم ثانية يُنظَّف؟', 'الحد الأدنى ١٥ ثانية — الافتراضي ٦٠', [dNumber('commandRoom.intervalSeconds', { min: 15, max: 3600 })]),
          dField('إعادة النشر كل دورة', 'يحذف الرسالة ويبعت وحدة جديدة كل دورة — ما تظهر «تم التعديل»', [dSwitch('commandRoom.repost')]),
          dField('تثبيت الرسالة', 'مطفّي افتراضيًا — وما يشتغل أصلًا لما «إعادة النشر» مفعّلة (الرسالة تنحذف وتُستبدل كل دورة)', [dSwitch('commandRoom.pin')]),
          dField('نص الرسالة', 'يُنشر كما هو (بلا ترجمة) مع صورة السيرفر', [dArea('commandRoom.text')], { wide: true }),
          dField('صورة الرسالة', 'مسار داخل المشروع أو رابط خارجي', [dInput('commandRoom.image', { full: true })], { wide: true }),
          dField('الصورة الحالية', 'هذي الصورة اللي تنزل مع الرسالة', [preview], { wide: true }),
          dField('إجراءات فورية', 'لا تحتاج حفظ — تنفّذ حالًا على الروم', [sendRow], { wide: true }),
        ]),
      );

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
            chip.appendChild(el('b', { text: Number(value).toLocaleString(numLoc()) }));
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
          pager.appendChild(el('span', { class: 'muted', text: `صفحة ${current} من ${pages} · ${Number(data.total).toLocaleString(numLoc())} حدث` }));
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
          '',
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

      const newLabel = el('input', { class: 'd-input', placeholder: 'الاسم الظاهر' });
      // ملاحظة: إيموجي النوع بيانات تُرسل إلى ديسكورد (زر التذكرة)، وليست عنصرًا في واجهة الموقع
      const newEmoji = el('input', { class: 'd-input narrow', placeholder: 'إيموجي الزر' });
      const addType = el('button', { class: 'd-btn sm primary', html: `${ic('plus', 15)} إضافة نوع` });
      addType.addEventListener('click', () => {
        const label = newLabel.value.trim();
        const slug = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
        const id = slug || `type-${Date.now().toString(36)}`;
        if (!label) return toast('اكتب اسم النوع.', true);
        if (types.some((t) => t.id === id)) return toast('هذا النوع موجود مسبقًا.', true);
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
      [newLabel, newEmoji, addType, restore].forEach((n) => addRow.appendChild(n));

      /* معاينة صور اللوحة (الرئيسية + الزخرفية) ورسالة التذكرة */
      const assetSrc = (value, fallback) => {
        const raw = String(value || '').trim();
        if (/^https?:\/\//i.test(raw)) return raw;
        const base = raw ? raw.split('/').pop() : fallback;
        return `/assets/${base || fallback}`;
      };
      const imageBox = (box, label, src) => {
        box.appendChild(el('div', { class: 'd-empty', text: label }));
        box.appendChild(el('img', { src, alt: label, style: 'max-width:100%;border-radius:12px;border:1px solid var(--line)' }));
      };
      const panelPreview = el('div', { class: 'd-sample cr-preview' });
      const paintPanelPreview = () => {
        panelPreview.textContent = '';
        const hero = getPath('tickets.panelImage');
        const foot = getPath('tickets.panelFooterImage');
        if (hero) imageBox(panelPreview, 'صورة اللوحة (بخلفية شفافة — تنزل بدل النص):', assetSrc(hero, 'commands-room.webp'));
        if (foot) imageBox(panelPreview, 'الخط/الصورة أسفل القائمة:', assetSrc(foot, 'tickets-panel-footer.webp'));
        if (!hero && !foot) panelPreview.appendChild(el('div', { class: 'd-empty', text: 'ما في صور محفوظة — اللوحة تنزل نصية.' }));
      };
      paintPanelPreview();
      const openPreview = el('div', { class: 'd-sample cr-preview' });
      const paintOpenPreview = () => {
        openPreview.textContent = '';
        const openImg = getPath('tickets.openImage');
        if (openImg) imageBox(openPreview, 'صورة رسالة فتح التذكرة:', assetSrc(openImg, 'tickets-panel-v5.webp'));
        else openPreview.appendChild(el('div', { class: 'd-empty', text: 'ما في صورة — الرسالة تنزل نصية.' }));
      };
      paintOpenPreview();

      const typeCount = types.length;
      return [
        buttonsCard,
        dCard('رسالة فتح التذكرة', 'هذه الرسالة تُرسل داخل غرفة التذكرة لحظة فتحها — صورة بلا نص.', 'messageEdit', [
          dField('صورة الرسالة', 'الصورة اللي تنزل داخل التذكرة (PNG بخلفية شفافة · فارغة = ترجع الرسالة النصية)', [dInput('tickets.openImage', { full: true, onChange: () => paintOpenPreview() })], { wide: true }),
          dField('صورة فقط', 'صورة بلا عنوان ولا وصف ولا حقول (زي الصورة اللي طلبتها)', [dSwitch('tickets.openImageOnly')]),
          dField('معاينة الصورة', 'هذي الصورة اللي تطلع للأعضاء داخل التذكرة', [openPreview], { wide: true }),
          dField('عنوان الرسالة', 'يُستخدم فقط إذا الصورة مطفّية · متغيّرات: {emoji} · {id} · {type} · {user} · {server}', [dInput('tickets.openTitle', { full: true })], { wide: true }),
          dField('الوصف', 'الأسطر الطويلة مدعومة (اضغط Enter لسطر جديد)', [dArea('tickets.openDescription')], { wide: true }),
          dField('سطر إضافي', 'يُضاف أسفل الوصف مع تعليمات كل نوع', [dArea('tickets.openIntro')], { wide: true }),
          dField('إظهار الحقول', 'صاحب التذكرة · النوع · الحالة', [dSwitch('tickets.openFields')]),
          dField('التذييل', 'اتركه فارغًا لبلا تذييل', [dInput('tickets.openFooter', { full: true })], { wide: true }),
        ]),
        dCard('الأساسيات', '', 'ticket', [
          dField('تفعيل التذاكر', '', [dSwitch('tickets.enabled')]),
          dField('القسم (Category)', 'تُنشأ فيه قنوات التذاكر', [dSelect('tickets.categoryId', categoryOptions())]),
          dField('رتب الدعم', 'تشوف التذاكر وتستلمها', [dListEditor('tickets.supportRoleIds', { type: 'role' })], { wide: true }),
          dField('قناة أرشيف التذاكر', 'توصلها نسخة المحادثة عند الإغلاق', [dSelect('tickets.logChannelId', channelOptions())]),
          dField('أقصى تذاكر لكل عضو', '', [dNumber('tickets.maxOpenPerUser')]),
        ]),
        dCard('شكل اللوحة', 'اللوحة اللي تنزل في قناة الدعم — صورة السيرفر (بخلفية شفافة) + قائمة الأنواع تحتها (بلا نص)', 'image', [
          dField('صورة اللوحة', 'الصورة هي اللوحة (بدل العنوان والوصف) — PNG بخلفية شفافة، مسار داخل المشروع أو رابط · اتركها فارغة للوحة النصية', [dInput('tickets.panelImage', { full: true, onChange: () => paintPanelPreview() })], { wide: true }),
          dField('صورة فقط', 'بلا عنوان ولا وصف ولا حقول — الصورة لحالها', [dSwitch('tickets.panelImageOnly')]),
          dField('خط/صورة أسفل القائمة', 'اختياري — اتركه فارغًا لبلا أي خط تحت القائمة (الوضع الحالي)', [dInput('tickets.panelFooterImage', { full: true, onChange: () => paintPanelPreview() })], { wide: true }),
          dField('معاينة الصور', 'هذي الصور اللي تنزل في ديسكورد مع اللوحة', [panelPreview], { wide: true }),
          dField('نص القائمة المنسدلة', 'النص اللي يظهر قبل ما يختار العضو نوع التذكرة', [dInput('tickets.panelPlaceholder', { full: true })], { wide: true }),
          dField(
            'وضع اللوحة',
            typeCount > 5 ? 'تنبيه: الأزرار تسمح بخمسة أنواع كحد أقصى، وعندك ' + typeCount : `عدد الأنواع الحالي: ${typeCount}`,
            [
              dSelect(
                'tickets.panelMode',
                [
                  { value: 'select', label: 'قائمة منسدلة (حتى 25 نوعًا)' },
                  { value: 'buttons', label: 'أزرار (حتى 5 أنواع)' },
                ],
                { noneLabel: null },
              ),
            ],
          ),
          dField('عنوان البنل', 'يُستخدم فقط إذا الصورة مطفّية', [dInput('tickets.panelTitle', { full: true })], { wide: true }),
          dField('وصف البنل', 'يُستخدم فقط إذا الصورة مطفّية', [dArea('tickets.panelDescription')], { wide: true }),
          dField('قناة نشر اللوحة', 'تُحفظ — واللوحة تنزل فيها تلقائيًا', [dSelect('tickets.panelChannelId', channelOptions())]),
          dField('تحديث تلقائي', 'أي تعديل على الصورة أو الأنواع أو الوضع → البوت ينشر اللوحة من جديد لحاله', [dSwitch('tickets.panelAutoPost')]),
          dField('إجراءات فورية', 'تنفّذ حالًا: تنظّف اللوحة القديمة وتنشر الجديدة', [testButton('نشر لوحة التذاكر', 'panel')]),
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
          field.style === 'paragraph' ? 'نص طويل' : 'سطر واحد',
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
