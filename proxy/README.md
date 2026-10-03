# Discord REST proxy — تشغيل ثابت وآمن

هذا الـ proxy مخصص لبوت **One Piece** ويُشغَّل **خارج Railway**. السبب: اتصال Railway المباشر بـ Discord REST سبق أن تلقى حجب/429، بينما الموقع والبوت يظلان على Railway.

> لا تضع أي token أو secret في هذا المستودع، في GitHub Actions، أو في الدردشة.

## ما الذي يحميه؟

- يقبل فقط `POST /discord` و `GET /healthz`.
- يرفض أي مسار ليس Discord API نسبيًا؛ لا يمكن تحويله إلى open proxy أو SSRF.
- يطلب `X-NeverLand-Secret` ويقارنه بطريقة آمنة.
- يحتفظ بتوكن Discord على خادم الـ proxy فقط.
- لا يكتب التوكن أو السر أو محتوى طلبات Discord في السجل.
- يستمع افتراضيًا على `127.0.0.1:8787`، وليس على الإنترنت مباشرة.

## متطلبات الاستضافة الدائمة

الخيار الموصى به: **VPS + Cloudflare Named Tunnel**. لا تستخدم رابط Quick Tunnel أو Serveo للإنتاج لأنه يتغير أو ينقطع.

على الـ VPS:

```bash
sudo install -d -m 0755 /opt/neverland-proxy
sudo cp proxy/discord_rest_proxy.py /opt/neverland-proxy/
sudo chmod 0755 /opt/neverland-proxy/discord_rest_proxy.py
sudo install -d -m 0700 /etc/neverland-proxy
sudo nano /etc/neverland-proxy/proxy.env
```

ضع في `/etc/neverland-proxy/proxy.env` القيم التالية **محليًا فقط**:

```ini
DISCORD_TOKEN=ضع_توكن_بوت_One_piece_هنا
DISCORD_REST_PROXY_SECRET=سر_عشوائي_طويل_وفريد
PROXY_HOST=127.0.0.1
PROXY_PORT=8787
```

ثم احمِ الملف:

```bash
sudo chown root:root /etc/neverland-proxy/proxy.env
sudo chmod 600 /etc/neverland-proxy/proxy.env
```

انسخ وحدة systemd المرفقة وشغّل الخدمة:

```bash
sudo cp proxy/neverland-discord-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now neverland-discord-proxy
sudo systemctl status neverland-discord-proxy --no-pager
curl -fsS http://127.0.0.1:8787/healthz
```

الرد الناجح:

```json
{"ok":true}
```

## Cloudflare Named Tunnel

أضف hostname ثابتًا مثل `discord-proxy.example.com` في Cloudflare، ثم اجعل مسار النفق يتجه إلى:

```yaml
ingress:
  - hostname: discord-proxy.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

لا تفتح المنفذ 8787 في جدار الحماية العام.

بعد أن يصبح رابط HTTPS الثابت متاحًا، اضبط **فقط داخل Railway Variables**:

```text
DISCORD_REST_PROXY_URL=https://discord-proxy.example.com
DISCORD_REST_PROXY_SECRET=<نفس السر الموجود على الـ VPS>
```

ثم أعد نشر/تشغيل خدمة Never Land. لا ترسل هذه القيم في الدردشة.

## التحقق قبل وبعد التحديث

1. من أي مكان عام:
   ```bash
   curl -fsS https://discord-proxy.example.com/healthz
   ```
2. افحص:
   ```text
   https://never-land-production.up.railway.app/healthz
   ```
   يجب أن يظهر `restProxy.configured: true` و `restProxy.healthy: true` بعد بدء البوت.
3. اختبر داخل قناة الاختبار فقط:
   - `قفل` → `SendMessages: false`
   - `فتح` → `SendMessages: true` وبدون deny

## تدوير الأسرار

عند أي ظهور لتوكن Discord أو GitHub أو سر proxy في محادثة أو سجل عام، ألغِه/دوّره فورًا. بعد تدوير `DISCORD_REST_PROXY_SECRET` حدّث الطرفين (VPS وRailway) ثم أعد التشغيل.
