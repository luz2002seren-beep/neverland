'use strict';
/**
 * tools/send-test-welcome.js
 * -------------------------------------------------------------
 * إرسال ترحيب تجريبي حقيقي في روم الترحيب — بنفس كود البوت:
 *   ١) رسالة الصورة (إطار Never Land + أفتار العضو داخل الدائرة)
 *   ٢) رسالة النص (Welcome · Member · Inv By)
 * يستخدم REST مباشرة حتى ما يفتح جلسة بوابة ثانية مع البوت الشغّال.
 *
 * التشغيل: DISCORD_TOKEN=... node tools/send-test-welcome.js [guildId] [channelId]
 * -------------------------------------------------------------
 */
const fs = require('node:fs');
const path = require('node:path');

const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const GUILD = process.argv[2] || '1542345715949506630';
const CHANNEL = process.argv[3] || '1549365058633736243';
const API = 'https://discord.com/api/v10';
const H = { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'NeverLand/1.0' };
const SITE = process.env.SITE_URL || 'https://never-land-production.up.railway.app';

const get = async (p) => {
  const r = await fetch(`${API}${p}`, { headers: H });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(j).slice(0, 140)}`);
  return j;
};

(async () => {
  if (!TOKEN) throw new Error('حطّ DISCORD_TOKEN أولًا');
  process.env.DATABASE_PATH = process.env.DATABASE_PATH || '/tmp/nl-welcome-test.db';
  process.env.DEMO_MODE = 'true';

  const config = require(path.join(__dirname, '..', 'src', 'config'));
  const welcome = require(path.join(__dirname, '..', 'src', 'systems', 'welcome'));

  /* نفس الإعدادات الحيّة من الموقع (النص + القناة + الإيموجي المصحّح) */
  let cfg = { ...config.defaults.welcome };
  const res = await fetch(`${SITE}/api/guilds/${GUILD}`).catch(() => null);
  if (res?.ok) {
    const live = (await res.json())?.settings?.welcome;
    if (live?.message) cfg = { ...cfg, ...live };
  }

  const guild = await get(`/guilds/${GUILD}?with_counts=true`);
  const list = await get(`/guilds/${GUILD}/members?limit=40`).catch(() => []);
  const raw = list.find((x) => !x.user.bot && x.avatar) || list.find((x) => !x.user.bot)
    || (await get(`/guilds/${GUILD}/members/${guild.owner_id}`));
  const member = raw.user ? raw : { user: raw.user || raw, nick: null };
  const user = member.user;
  const hash = member.avatar || user.avatar;
  const avatarUrl = hash
    ? `https://cdn.discordapp.com/${member.avatar ? `guilds/${GUILD}/users/${user.id}/avatars/${hash}` : `avatars/${user.id}/${hash}`}.png?size=512`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) % 5n)}.png`;

  const subject = {
    id: user.id,
    user: {
      id: user.id, username: user.username, tag: `${user.username}#0000`,
      globalName: user.global_name || member.nick || user.username,
      displayAvatarURL: () => avatarUrl, createdTimestamp: Date.now(),
    },
    displayName: member.nick || user.global_name || user.username,
    guild: { id: GUILD, name: guild.name, memberCount: guild.approximate_member_count || 0, iconURL: () => null },
  };

  const payloads = await welcome.buildWelcomeMessages(null, subject, { welcome: cfg }, {});
  console.log(`عدد الرسائل: ${payloads.length} (١ الصورة · ٢ النص)`);
  console.log('النص:'); console.log(payloads[1].content);

  const ids = [];
  for (const [i, payload] of payloads.entries()) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({
      content: payload.content ?? undefined,
      allowed_mentions: payload.allowedMentions || { parse: ['users'] },
    }));
    for (const [fi, file] of (payload.files || []).entries()) {
      form.append(`files[${fi}]`, new Blob([file.attachment || file], { type: 'image/webp' }), file.name || 'welcome.webp');
    }
    const r = await fetch(`${API}/channels/${CHANNEL}/messages`, { method: 'POST', headers: H, body: form });
    const out = await r.json().catch(() => null);
    ids.push(out?.id);
    console.log(`  → رسالة ${i + 1}: HTTP ${r.status} · ${out?.id} · مرفقات ${out?.attachments?.length || 0} · إمبدات ${out?.embeds?.length || 0}`);
    if (out?.attachments?.[0]?.url) console.log('     الصورة:', out.attachments[0].url.split('?')[0]);
  }
  fs.writeFileSync('/tmp/nl-welcome-ids.json', JSON.stringify(ids));
})().catch((err) => { console.error('❌', err.message); process.exit(1); });
