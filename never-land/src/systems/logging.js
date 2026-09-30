'use strict';
const EVENT_GROUPS = {
  members:{label:'Members',emoji:'👥'}, moderation:{label:'Moderation',emoji:'🛡️'}, roles:{label:'Roles',emoji:'🎭'}, channels:{label:'Channels',emoji:'📺'}, voice:{label:'Voice',emoji:'🔊'}, system:{label:'System',emoji:'⚙️'}
};
const EVENT_META = {
  memberJoin:{label:'Member join',emoji:'👋',group:'members'}, memberLeave:{label:'Member leave',emoji:'🚪',group:'members'}, messageDelete:{label:'Message delete',emoji:'🗑️',group:'moderation'}, roleUpdate:{label:'Role update',emoji:'🎭',group:'roles'}, channelCreate:{label:'Channel create',emoji:'🟢',group:'channels'}, channelDelete:{label:'Channel delete',emoji:'🔴',group:'channels'}, voiceState:{label:'Voice action',emoji:'🔊',group:'voice'}
};
async function send(client, guild, event, data={}){ const id=data.channelId || data.logChannelId; const ch=id && await client.channels.fetch(id).catch(()=>null); return ch?.send?.({content:`${EVENT_META[event]?.emoji||'📌'} **${EVENT_META[event]?.label||event}**`}); }
module.exports = { EVENT_GROUPS, EVENT_META, attach(){}, send, status(){ return { enabled:true, runtime:'clean' }; } };
