'use strict';

/**
 * ربط لوقات سيرفر One Piece بالرومات الحقيقية.
 * يُطبَّق مرة واحدة لكل نسخة ربط حتى ما يمسح تعديل لاحق من اللوحة.
 */
const GUILD_ID = '1160219059921629276';
const LINK_VERSION = 1;

const ROOMS = {
  member: '1553824779545616464',
  boost: '1553824789540372483',
  bot: '1553824805495636060',
  role: '1554478778665672734',
  channel: '1554478783204167771',
  voice: '1553824774495408238',
  message: '1553824771043627019',
  timeout: '1554478770281254982',
  kickBan: '1554478774463107132',
  thread: '1554478787654066231',
  invite: '1553824792644419784',
  server: '1553824783169359923',
  ticket: '1553824786290049197',
  mod: '1553824767612686406',
  protect: '1554480020343365713',
};

function channelMap() {
  const map = {
    messageDelete: ROOMS.message,
    messageEdit: ROOMS.message,
    messageBulkDelete: ROOMS.message,
    memberJoin: ROOMS.member,
    memberLeave: ROOMS.member,
    memberNickname: ROOMS.member,
    memberAvatar: ROOMS.member,
    memberUsername: ROOMS.member,
    memberKick: ROOMS.kickBan,
    memberBan: ROOMS.kickBan,
    memberUnban: ROOMS.kickBan,
    memberTimeout: ROOMS.timeout,
    memberBoost: ROOMS.boost,
    memberRoleUpdate: ROOMS.role,
    roleCreate: ROOMS.role,
    roleDelete: ROOMS.role,
    roleUpdate: ROOMS.role,
    channelCreate: ROOMS.channel,
    channelDelete: ROOMS.channel,
    channelUpdate: ROOMS.channel,
    channelPermissions: ROOMS.channel,
    serverUpdate: ROOMS.server,
    emojiCreate: ROOMS.server,
    emojiDelete: ROOMS.server,
    stickerCreate: ROOMS.server,
    stickerDelete: ROOMS.server,
    inviteCreate: ROOMS.invite,
    inviteDelete: ROOMS.invite,
    threadCreate: ROOMS.thread,
    threadDelete: ROOMS.thread,
    voiceJoin: ROOMS.voice,
    voiceLeave: ROOMS.voice,
    voiceMove: ROOMS.voice,
    voiceMute: ROOMS.voice,
    voiceDeafen: ROOMS.voice,
    modActions: ROOMS.mod,
    automod: ROOMS.protect,
    ticket: ROOMS.ticket,
    botStatus: ROOMS.bot,
  };
  return map;
}

function apply(db) {
  const current = db.getGuildSettings(GUILD_ID);
  if (current?.logs?.linkVersion === LINK_VERSION) return false;
  const channels = channelMap();
  const events = Object.fromEntries(Object.keys(channels).map((key) => [key, true]));
  db.updateGuildSettings(GUILD_ID, {
    logs: {
      enabled: true,
      linkVersion: LINK_VERSION,
      channels,
      events,
    },
  });
  return true;
}

module.exports = { apply, GUILD_ID, LINK_VERSION, channelMap };
