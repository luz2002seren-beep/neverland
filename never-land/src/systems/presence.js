'use strict';
let last=null;
function describe(p=last){ return p ? `${p.status||'online'} · ${p.name||'Never Land'}` : 'default presence'; }
function applied(client){ return client?.user?.presence || null; }
function state(){ return last; }
function save(client, guildId, data){ last=data; if(client?.user) client.user.setPresence({status:data.status||'online',activities:[{name:data.name||'Never Land'}]}).catch(()=>{}); return { guildId, presence:data }; }
module.exports = { describe, applied, state, save, attach(){} };
