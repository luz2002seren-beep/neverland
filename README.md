# Never Land

نظام إدارة سيرفرات ديسكورد متكامل: **بوت + موقع + لوحة تحكم عربية** — مبني بـ Node.js و discord.js v14.

يجمع الحماية التلقائية، أوامر الإشراف، السجلات الشاملة (38 حدثًا)، الترحيب بالبطاقة المصوّرة، التذاكر، تقديم الإدارة، الرتب التلقائية، المستويات، والخط الفاصل التلقائي — في مشروع واحد مفتوح المصدر.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![License](https://img.shields.io/badge/License-MIT-3ba55d)](never-land/LICENSE)

---

## 📁 محتوى المستودع

| المسار | الوصف |
|---|---|
| [`never-land/`](never-land) | **المشروع كامل**: البوت + الموقع + اللوحة + الاختبارات + التوثيق |
| [`معاينة-الموقع.html`](معاينة-الموقع.html) | معاينة الصفحة الرئيسية (تعمل بدون سيرفر) |
| [`معاينة-اللوحة.html`](معاينة-اللوحة.html) | معاينة لوحة التحكم بكل أقسامها الـ13 |
| [`معاينة-السيرفرات.html`](معاينة-السيرفرات.html) | معاينة صفحة اختيار السيرفر |
| [`أيقونات-الموقع.png`](أيقونات-الموقع.png) | عرض أيقونات الموقع المرسومة (81 أيقونة SVG) |
| [`شرح-تقديم-الإدارة.svg`](شرح-تقديم-الإدارة.svg) | مخطط سير نظام تقديم الإدارة |

---

## ⚡ ما يميّز المشروع

- **العربية أولًا:** كل ردود البوت ولوحة التحكم بالعربية (مع دعم الإنجليزية)، وفلتر الكلمات يفهم الكتابة العربية (تشكيل وهمزات وتاء مربوطة).
- **موقع رسمي حقيقي:** صفحات مبنية من الخادم + واجهة API + قاعدة بيانات، مع أيقونة ومانيفست و`robots.txt` و`sitemap.xml` وصفحة 404 مصمّمة.
- **بدون إيموجيات كيبورد في الواجهة:** 81 أيقونة SVG مرسومة محليًا (بدون أي اتصال خارجي).
- **لوحة تحكم بـ22 قسمًا:** وضع ليلي/نهاري، بحث، حفظ فوري، وتسجيل دخول Discord.
- **قاعدة بيانات مرنة:** SQLite افتراضيًا، أو JSON بدون أي مكتبات خارجية (`DATABASE_DRIVER=json`).
- **قابل للنشر بأي مكان:** Docker • docker-compose • PM2 • Railway (تدعم `PORT` و`RAILWAY_PUBLIC_DOMAIN` تلقائيًا).

---

## 🚀 تشغيل سريع

```bash
git clone https://github.com/luz2002seren-beep/workspace-01a0aabc-9001-7d05-bfd6-54b2bdbd3258.git
cd workspace-01a0aabc-9001-7d05-bfd6-54b2bdbd3258/never-land
npm install
cp .env.example .env     # ثم ضع DISCORD_TOKEN و CLIENT_ID و CLIENT_SECRET
npm start
```

- البوت والموقع معًا: `npm start`
- البوت فقط: `npm run bot`
- الموقع فقط: `npm run web`
- الاختبارات: `npm test` (56 اختبارًا) · `npm run test:guards` (15 حاجزًا أمنيًا)

---

## 📚 التوثيق

| الملف | المحتوى |
|---|---|
| [`never-land/README.md`](never-land/README.md) | الدليل الكامل: الميزات، الإعدادات، النشر، استكشاف الأخطاء |
| [`never-land/START-HERE.md`](never-land/START-HERE.md) | ابدأ من هنا في 5 دقائق |
| [`never-land/الأوامر.md`](never-land/الأوامر.md) | 30 أمر سلاش + جدول 38 حدث سجل |

---

## 🔐 ملاحظات أمنية

- لا ترفع ملف `.env` أبدًا — التوكنات تُضاف كمتغيّرات بيئة على منصة النشر.
- قاعدة البيانات (`data/*.db`) محلية ولا تُرفع.
- كل الأسرار مستثناة في `.gitignore`.

### ⚠️ `SESSION_SECRET` إلزامي في الإنتاج

الموقع يوقّع كوكي الجلسة (`neverland.sid`) بـ `SESSION_SECRET` عبر HMAC.
**من يعرف السر يستطيع توقيع أي معرّف جلسة، فينتحل أي حساب — حتى المالك —
دون أي كلمة سر.**

لذلك عند `NODE_ENV=production` **يرفض المشروع الإقلاع** إذا كان السر قيمة
افتراضية معلنة أو أقصر من 32 محرفًا، ويطبع:

```
[FATAL] INSECURE_SESSION_SECRET
```

ولّد سرًا وضعه في متغيّرات بيئة منصة النشر:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Railway:  railway variables --set "SESSION_SECRET=<السر>"
# Render:   Environment → Add
```

`deploy-railway.sh` يولّده ويضبطه تلقائيًا. وتغيير السر يُبطل الجلسات
القائمة تلقائيًا (سيلزم الأعضاء إعادة الدخول) — لا حاجة لأي إجراء إضافي.

### الحواجز الأمنية الآلية

```bash
npm run test:guards   # 15 حاجزًا: السرّان المعلنان مرفوضان · بوابة الإنتاج
                      # مربوطة بالخادم · لا أسرار في المستودع · عزل بيئة الاختبارات
```

هذه الحواجز تعمل كاختبار انحدار، ويشغّلها CI (`.github/workflows/ci.yml`)
على كل push وpull request — مع بناء صورة Docker والتأكد أنها ترفض السر
الافتراضي هي أيضًا.

## 📄 الترخيص

MIT — راجع [`never-land/LICENSE`](never-land/LICENSE).
