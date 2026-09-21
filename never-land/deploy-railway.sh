#!/usr/bin/env bash
# -----------------------------------------------------------------
#  Never Land  →  Railway   (رابط دائم يفتح من أي جهاز)
#  الاستخدام:  npm run deploy:railway      أو      bash deploy-railway.sh
#  ما يحتاج توكن مكتوب: Railway يعطيك كود دخول توافق عليه من المتصفح.
# -----------------------------------------------------------------
set -e
CLI_DIR="/tmp/railway-cli"

echo "==> 1/5 تثبيت Railway CLI (مرة واحدة) ..."
if [ ! -x "$CLI_DIR/node_modules/.bin/railway" ]; then
  mkdir -p "$CLI_DIR"
  npm i --prefix "$CLI_DIR" @railway/cli --silent
fi
RAILWAY="$CLI_DIR/node_modules/.bin/railway"
"$RAILWAY" --version

echo
echo "==> 2/5 تسجيل الدخول ..."
echo "   إذا كنت على جهازك: يفتح المتصفح تلقائيًا."
echo "   إذا كنت على سيرفر: سيطبع رابطًا وكودًا — افتحه ووافق."
"$RAILWAY" login || "$RAILWAY" login --browserless

echo
echo "==> 3/5 إنشاء المشروع ورفعه ..."
"$RAILWAY" up -y --new --name never-land

echo
echo "==> 4/5 ضبط متغيّرات البيئة ..."
# سر الجلسات: نولّده عشوائيًا هنا بدل تركه فارغًا.
# بلا هذا، config.js كان يرجع القيمة الاحتياطية المعلنة 'never-land-change-me'
# فيصير ممكنًا تزوير كوكي الدخول وانتحال أي حساب — حتى المالك.
# نحتفظ به في متغيّر حتى يبقى ثابتًا بين عمليات النشر (تغييره يُبطل الجلسات).
SESSION_SECRET_VALUE="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
echo "   ✓ ولّدنا SESSION_SECRET عشوائيًا (لن يُطبع هنا)."
"$RAILWAY" variables \
  --set "DASHBOARD_PORT=3000" \
  --set "PUBLIC_ACCESS=false" \
  --set "LOGIN_REQUIRED=true" \
  --set "SESSION_SECRET=$SESSION_SECRET_VALUE" \
  --set "REQUIRED_ROLE_ID=1549364852433354792" \
  --set "ROLE_CACHE_SECONDS=300" \
  --set "DATABASE_PATH=/data/neverland.db" \
  --set "SITE_NAME=Never Land" \
  --skip-deploys || true

echo
echo "==> 5/5 إنشاء نطاق عام ..."
"$RAILWAY" domain || true

cat <<'VARS'

──────────────────────────────────────────────────────────────
بقي خطوتان من لوحة Railway (اختيارهما بضغطة):
  1) Volume:  أضف مجلدًا واربطه بـ  /data     ← ليحفظ قاعدة البيانات
  2) Variables: أضف توكن البوت ليعمل البوت أيضًا:
        DISCORD_TOKEN   = توكن البوت
        CLIENT_ID       = آيدي التطبيق
        CLIENT_SECRET   = سر التطبيق
        DEMO_MODE       = false
        RUN_BOT         = true
     وبدون توكن؟ الموقع يشتغل عادي — البوت فقط لا يعمل.
  3) بعد إضافة توكن Discord: أضف رابط العودة في Developer Portal > OAuth2:
        https://<نطاق-مشروعك>/auth/callback
     وضع نفس النطاق في DASHBOARD_URL

ملاحظة أمان:
  • SESSION_SECRET وُلّد عشوائيًا وضُبط تلقائيًا في الخطوة 4.
  • لا تغيّره إلا عند الضرورة — تغييره يُبطل جلسات كل الأعضاء الحاليين.
  • إن أضفت SITE_ADMINS أو OWNER_USER_ID فلا تستخدم قيم المستودع الافتراضية.
──────────────────────────────────────────────────────────────
VARS
