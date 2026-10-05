# ---------- Never Land ----------
# صورة خفيفة لتشغيل البوت + لوحة التحكم
FROM node:20-slim

# أدوات بناء better-sqlite3 (تُحذف لاحقًا لتقليل الحجم)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# Lockfile install is smaller and reproducible; dev/test packages stay out of production RAM/image.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

# مجلد قاعدة البيانات (يُربط كـ volume)
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
