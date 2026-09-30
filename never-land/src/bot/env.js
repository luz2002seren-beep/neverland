'use strict';
require('dotenv').config();
const clean = (v) => String(v || '').trim();
const list = (v) => clean(v).split(',').map(x => x.trim()).filter(Boolean);
const bool = (v, d=false) => v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v));
const env = {
  token: clean(process.env.DISCORD_TOKEN),
  clientId: clean(process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID),
  guildId: clean(process.env.PRIMARY_GUILD_ID || process.env.ONE_PIECE_GUILD_ID || process.env.GUILD_ID),
  owners: list(process.env.OWNER_USER_ID || process.env.DEVELOPER_IDS || process.env.BOT_OWNERS),
  prefix: clean(process.env.BOT_PREFIX || '!'),
  locale: clean(process.env.DEFAULT_LANGUAGE || 'en'),
  presence: {
    name: clean(process.env.PRESENCE_NAME) || '𝑵𝒆𝒗𝒆𝒓 𝑳𝒂𝒏𝒅',
    status: clean(process.env.PRESENCE_STATUS) || 'online',
    url: clean(process.env.PRESENCE_URL) || 'https://www.twitch.tv/never_land',
  },
  web: {
    enabled: !bool(process.env.RUN_WEB === 'false' ? 'false' : process.env.WEB_DISABLED, false),
  },
  logs: {
    member: clean(process.env.LOG_MEMBER_CHANNEL_ID) || '1553824779545616464',
    boost: clean(process.env.LOG_BOOST_CHANNEL_ID) || '1553824789540372483',
    system: clean(process.env.LOG_SYSTEM_CHANNEL_ID) || '1553824805495636060',
    roles: clean(process.env.LOG_ROLES_CHANNEL_ID) || '1554478778665672734',
    channels: clean(process.env.LOG_CHANNELS_CHANNEL_ID) || '1554478783204167771',
    invites: clean(process.env.LOG_INVITES_CHANNEL_ID) || '1553824792644419784',
    voice: clean(process.env.LOG_VOICE_CHANNEL_ID) || '1553824805495636060',
    moderation: clean(process.env.LOG_MODERATION_CHANNEL_ID) || '1553824805495636060',
  },
};
env.ready = env.token.length > 50 && env.clientId;
module.exports = env;
