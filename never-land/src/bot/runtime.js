'use strict';
require('node:dns').setDefaultResultOrder('ipv4first');
const {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  Options,
} = require('discord.js');
const env = require('./env');
const { cmds } = require('./commands');
const { onMessage } = require('./text');
const logs = require('./logs');
const tickets = require('./tickets');
const { patchGateway, installProxy, probeProxy } = require('./rest-safe');
const { reply, embed, no } = require('./fx');

// Discord.js caches can grow with every member, presence, message and reaction.
// This bot needs only a small working set for one guild, so bounded caches keep
// memory stable even during busy periods without removing required functionality.
const CACHE_LIMITS = {
  ...Options.DefaultMakeCacheSettings,
  MessageManager: 0,
  GuildMessageManager: 0,
  GuildMemberManager: {
    maxSize: 250,
    keepOverLimit: member => member.id === env.clientId,
  },
  UserManager: {
    maxSize: 250,
    keepOverLimit: user => user.id === env.clientId,
  },
  PresenceManager: 0,
  VoiceStateManager: 100,
  ReactionManager: 0,
  ReactionUserManager: 0,
  GuildInviteManager: 0,
  GuildBanManager: 0,
  GuildEmojiManager: 0,
  GuildStickerManager: 0,
  ThreadMemberManager: 0,
};

function isPrimaryGuild(subject) {
  const id = typeof subject === 'string' ? subject : subject?.id;
  return Boolean(env.guildId && id && String(id) === env.guildId);
}

async function leaveUnexpectedGuild(guild) {
  if (isPrimaryGuild(guild)) return;
  console.warn(`[bot] refusing non-primary guild ${guild?.id || 'unknown'}; leaving it.`);
  await guild?.leave?.().catch(error => {
    console.error('[bot] could not leave non-primary guild:', error?.message || error);
  });
}

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildInvites,
    ],
    // Guild messages are complete events; partials would cause extra REST work
    // and retain objects that the clean runtime does not need.
    partials: [],
    makeCache: Options.cacheWithLimits(CACHE_LIMITS),
    allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
    rest: { timeout: 8_000 },
    shards: [0],
    waitGuildTimeout: 8_000,
  });

  client.commands = new Collection(cmds);
  installProxy(client);
  patchGateway(client);
  logs.attach(client);

  client.once('ready', () => {
    try {
      client.user.setPresence({
        status: env.presence.status,
        activities: [{ name: env.presence.name, type: ActivityType.Streaming, url: env.presence.url }],
      });
    } catch {
      // Presence failures must not take down the web service or bot Gateway.
    }

    global.__neverlandClient = client;
    const unexpected = [...client.guilds.cache.values()].filter(guild => !isPrimaryGuild(guild));
    if (unexpected.length) void Promise.all(unexpected.map(leaveUnexpectedGuild));

    // Health is observable without exposing the proxy URL or proxy secret.
    void probeProxy();
    const healthTimer = setInterval(() => { void probeProxy(); }, 60_000);
    healthTimer.unref?.();

    console.log(`[bot] ready ${client.user.tag} in ${client.guilds.cache.size} guild(s); primary=${env.guildId}`);
  });

  // Do not merely ignore extra servers: leave them as soon as Discord reports them.
  client.on('guildCreate', guild => { void leaveUnexpectedGuild(guild); });

  client.on('messageCreate', async message => {
    if (!isPrimaryGuild(message.guild)) return;
    await onMessage(message);
  });

  client.on('interactionCreate', async interaction => {
    // Tickets, slash commands, buttons and modals are all constrained here before
    // any handler can take action.
    if (!isPrimaryGuild(interaction.guild || interaction.guildId)) return;
    try {
      if (await tickets.onInteraction(interaction)) return;
      if (!interaction.isChatInputCommand()) return;
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // Acknowledge slow moderation calls before their REST work starts. This
      // avoids Discord's 3-second interaction timeout while preserving each
      // command's intended public/ephemeral response visibility.
      if (command.defer) await interaction.deferReply({ ephemeral: Boolean(command.ephemeral) });
      await command.run(interaction);
    } catch (error) {
      console.error('[command]', error?.message || error);
      if ('reply' in interaction) {
        await reply(interaction, {
          embeds: [embed('❌ Command failed', error?.message || 'Unknown error', no)],
        }, true).catch(() => {});
      }
    }
  });

  return client;
}

async function start() {
  if (!env.ready) {
    console.log('[bot] skipped: DISCORD_TOKEN, CLIENT_ID, or PRIMARY_GUILD_ID is missing/invalid');
    return null;
  }
  const client = createClient();
  await client.login(env.token);
  return client;
}

module.exports = { start, createClient, isPrimaryGuild, CACHE_LIMITS };
