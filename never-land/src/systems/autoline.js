'use strict';
const GIF_STYLES = { glow:{label:'Glow',file:'glow.gif'}, flow:{label:'Flow',file:'flow.gif'}, pulse:{label:'Pulse',file:'pulse.gif'}, dash:{label:'Dash',file:'dash.gif'} };
async function sendTestLine(channel){ return channel?.send?.({content:'━━━━━━━━━━━━━━━━━━━━'}); }
module.exports = { GIF_STYLES, attach(){}, sendTestLine, status(){ return { enabled:true }; } };
