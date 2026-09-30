'use strict';
function configFor(){ return { enabled:false, channelId:null, messageId:null }; }
function status(){ return { ok:true, guilds:{} }; }
async function publish(){ return null; }
async function clean(){ return null; }
module.exports = { configFor, status, publish, clean, attach(){} };
