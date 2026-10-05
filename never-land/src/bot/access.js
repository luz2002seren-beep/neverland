'use strict';

const { PermissionFlagsBits } = require('discord.js');

function isModerator(member, settings) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const staffIds = settings.moderation?.staffRoleIds || [];
  return staffIds.some((roleId) => member.roles?.cache?.has(roleId));
}

function canLock(member, settings) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  const allowed = settings.moderation?.lockAllowedRoleIds || [];
  return allowed.some((roleId) => member.roles?.cache?.has(roleId)) || isModerator(member, settings);
}

module.exports = { isModerator, canLock };
