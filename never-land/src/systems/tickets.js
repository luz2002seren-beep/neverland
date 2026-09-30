'use strict';
function effectiveImages(cfg={}){ return { panelImage:cfg.panelImage||null, panelFooterImage:cfg.panelFooterImage||null }; }
function panelSignature(cfg={}){ return JSON.stringify({ title:cfg.title||'Tickets', channelId:cfg.panelChannelId||null }); }
function status(guildId){ return guildId ? { guildId, active:0, runtime:'clean' } : { active:0, runtime:'clean' }; }
function scheduleEnsure(){ return false; }
async function ensurePanel(client, guild){ return { ok:true, guildId:guild?.id, runtime:'clean' }; }
module.exports = { effectiveImages, panelSignature, status, scheduleEnsure, ensurePanel, attach(){} };
