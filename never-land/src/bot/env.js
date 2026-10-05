'use strict';

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const snowflake = (value) => /^\d{15,22}$/.test(String(value || '').trim());

function read() {
  const token = String(process.env.DISCORD_TOKEN || '').trim();
  const proxyUrl = String(process.env.DISCORD_REST_PROXY_URL || '').trim().replace(/\/+$/, '');
  const mode = String(process.env.DISCORD_REST_MODE || '').trim().toLowerCase();
  const directAllowed = truthy(process.env.ALLOW_DIRECT_DISCORD_REST);
  const transport = mode === 'direct' || directAllowed ? 'direct' : proxyUrl ? 'proxy' : 'blocked';

  return {
    enabled: truthy(process.env.RUN_BOT),
    token,
    hasToken: token.length >= 50 && /^[A-Za-z0-9._-]+$/.test(token),
    applicationId: String(process.env.CLIENT_ID || '').trim(),
    primaryGuildId: String(process.env.PRIMARY_GUILD_ID || '').trim(),
    hasPrimaryGuild: snowflake(process.env.PRIMARY_GUILD_ID),
    transport,
    proxyUrl,
    proxySecret: String(process.env.DISCORD_REST_PROXY_SECRET || ''),
  };
}

function publicConfig() {
  const env = read();
  return {
    enabled: env.enabled,
    tokenConfigured: env.hasToken,
    applicationConfigured: snowflake(env.applicationId),
    primaryGuildConfigured: env.hasPrimaryGuild,
    primaryGuildId: env.hasPrimaryGuild ? env.primaryGuildId : '',
    transport: env.transport,
    proxyConfigured: Boolean(env.proxyUrl && env.proxySecret),
  };
}

module.exports = { read, publicConfig };
