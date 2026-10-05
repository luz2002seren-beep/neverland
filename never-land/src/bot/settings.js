'use strict';

/**
 * Bot V2 configuration lives in the existing Never Land database KV store.
 * It is intentionally separate from the legacy per-guild settings schema so
 * the rebuilt runtime can evolve without reviving any removed bot code.
 */
const db = require('../database');

const KV_KEY = 'neverland_bot_v2_config';
const SNOWFLAKE = /^\d{15,22}$/;
const ACTIONS = new Set(['delete', 'warn', 'timeout']);

const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  updatedAt: 0,
  modules: {
    moderation: true,
    automod: true,
    tickets: true,
    welcome: false,
    logging: true,
    utility: true,
  },
  moderation: {
    staffRoleIds: [],
    lockAllowedRoleIds: [],
    defaultTimeoutMinutes: 60,
    warnThreshold: 3,
  },
  automod: {
    enabled: true,
    mentionLimit: 6,
    duplicateWindowSeconds: 12,
    duplicateThreshold: 4,
    blockedWords: [],
    action: 'timeout',
    timeoutMinutes: 10,
    exemptRoleIds: [],
    logChannelId: '',
  },
  logs: {
    enabled: true,
    moderationChannelId: '',
    messageChannelId: '',
    memberChannelId: '',
    ticketChannelId: '',
    systemChannelId: '',
  },
  tickets: {
    enabled: true,
    categoryId: '',
    supportRoleIds: [],
    panelChannelId: '',
    panelMessageId: '',
    title: 'Need help?',
    greeting: 'Describe what you need and a staff member will be with you shortly.',
    closeAfterHours: 0,
  },
  welcome: {
    enabled: false,
    channelId: '',
    message: 'Welcome {user} to {server}!',
    leaveMessage: '{user} left {server}.',
  },
  commands: {
    moderation: true,
    tickets: true,
    utility: true,
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function string(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function id(value) {
  const valueString = string(value, 22);
  return SNOWFLAKE.test(valueString) ? valueString : '';
}

function ids(value, max = 20) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(id).filter(Boolean))].slice(0, max);
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function words(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|,/)
      : [];
  return [...new Set(list.map((item) => string(item, 80).toLowerCase()).filter(Boolean))].slice(0, 100);
}

/** Only known fields are accepted; no user-controlled properties are spread. */
function normalize(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const modules = source.modules || {};
  const moderation = source.moderation || {};
  const automod = source.automod || {};
  const logs = source.logs || {};
  const tickets = source.tickets || {};
  const welcome = source.welcome || {};
  const commands = source.commands || {};

  return {
    schemaVersion: 1,
    updatedAt: Number(source.updatedAt) || 0,
    modules: {
      moderation: bool(modules.moderation, DEFAULTS.modules.moderation),
      automod: bool(modules.automod, DEFAULTS.modules.automod),
      tickets: bool(modules.tickets, DEFAULTS.modules.tickets),
      welcome: bool(modules.welcome, DEFAULTS.modules.welcome),
      logging: bool(modules.logging, DEFAULTS.modules.logging),
      utility: bool(modules.utility, DEFAULTS.modules.utility),
    },
    moderation: {
      staffRoleIds: ids(moderation.staffRoleIds),
      lockAllowedRoleIds: ids(moderation.lockAllowedRoleIds),
      defaultTimeoutMinutes: number(moderation.defaultTimeoutMinutes, DEFAULTS.moderation.defaultTimeoutMinutes, 1, 40_320),
      warnThreshold: number(moderation.warnThreshold, DEFAULTS.moderation.warnThreshold, 1, 20),
    },
    automod: {
      enabled: bool(automod.enabled, DEFAULTS.automod.enabled),
      mentionLimit: number(automod.mentionLimit, DEFAULTS.automod.mentionLimit, 1, 50),
      duplicateWindowSeconds: number(automod.duplicateWindowSeconds, DEFAULTS.automod.duplicateWindowSeconds, 3, 120),
      duplicateThreshold: number(automod.duplicateThreshold, DEFAULTS.automod.duplicateThreshold, 2, 20),
      blockedWords: words(automod.blockedWords),
      action: ACTIONS.has(automod.action) ? automod.action : DEFAULTS.automod.action,
      timeoutMinutes: number(automod.timeoutMinutes, DEFAULTS.automod.timeoutMinutes, 1, 40_320),
      exemptRoleIds: ids(automod.exemptRoleIds),
      logChannelId: id(automod.logChannelId),
    },
    logs: {
      enabled: bool(logs.enabled, DEFAULTS.logs.enabled),
      moderationChannelId: id(logs.moderationChannelId),
      messageChannelId: id(logs.messageChannelId),
      memberChannelId: id(logs.memberChannelId),
      ticketChannelId: id(logs.ticketChannelId),
      systemChannelId: id(logs.systemChannelId),
    },
    tickets: {
      enabled: bool(tickets.enabled, DEFAULTS.tickets.enabled),
      categoryId: id(tickets.categoryId),
      supportRoleIds: ids(tickets.supportRoleIds),
      panelChannelId: id(tickets.panelChannelId),
      panelMessageId: id(tickets.panelMessageId),
      title: string(tickets.title, 80) || DEFAULTS.tickets.title,
      greeting: string(tickets.greeting, 1_000) || DEFAULTS.tickets.greeting,
      closeAfterHours: number(tickets.closeAfterHours, DEFAULTS.tickets.closeAfterHours, 0, 720),
    },
    welcome: {
      enabled: bool(welcome.enabled, DEFAULTS.welcome.enabled),
      channelId: id(welcome.channelId),
      message: string(welcome.message, 1_500) || DEFAULTS.welcome.message,
      leaveMessage: string(welcome.leaveMessage, 1_500) || DEFAULTS.welcome.leaveMessage,
    },
    commands: {
      moderation: bool(commands.moderation, DEFAULTS.commands.moderation),
      tickets: bool(commands.tickets, DEFAULTS.commands.tickets),
      utility: bool(commands.utility, DEFAULTS.commands.utility),
    },
  };
}

function merge(base, patch) {
  const output = clone(base);
  if (!patch || typeof patch !== 'object') return output;
  for (const [key, value] of Object.entries(patch)) {
    // At every depth, only fields already present in the trusted shape survive.
    if (!Object.prototype.hasOwnProperty.call(output, key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = merge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function get() {
  try {
    const raw = db.getKV(KV_KEY);
    if (!raw) return clone(DEFAULTS);
    return normalize(JSON.parse(raw));
  } catch {
    return clone(DEFAULTS);
  }
}

function update(patch) {
  const next = normalize({ ...merge(get(), patch), updatedAt: Date.now() });
  db.setKV(KV_KEY, JSON.stringify(next));
  return next;
}

module.exports = {
  KV_KEY,
  DEFAULTS,
  get,
  update,
  normalize,
};
