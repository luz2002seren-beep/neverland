'use strict';

/** Clean Never Land Bot V2 runtime. It is dormant unless RUN_BOT=true. */
const {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Options,
} = require('discord.js');
const { read } = require('./env');
const status = require('./status');
const settingsStore = require('./settings');
const { install: installRestTransport } = require('./restTransport');
const commands = require('./commands');
const tickets = require('./tickets');
const automod = require('./automod');
const logs = require('./logs');

let client = null;
let activeEnv = null;

function activeInPrimaryGuild(guildId) {
  return Boolean(activeEnv?.primaryGuildId && guildId === activeEnv.primaryGuildId);
}

async function safeWelcome(member) {
  const settings = settingsStore.get();
  if (!settings.modules.welcome || !settings.welcome.enabled) return;
  const channelId = settings.welcome.channelId;
  const channel = channelId && (member.guild.channels.cache.get(channelId) || await member.guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return;
  const content = settings.welcome.message
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{memberCount}', String(member.guild.memberCount));
  await channel.send({ content: content.slice(0, 1_900), allowedMentions: { users: [member.id], roles: [] } }).catch(() => {});
}

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [],
    makeCache: Options.cacheWithLimits({
      MessageManager: 100,
      GuildMemberManager: { maxSize: 250, keepOverLimit: (member) => member.id === member.client.user?.id },
      UserManager: 300,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      ThreadManager: 25,
      ThreadMemberManager: 25,
    }),
    sweepers: {
      messages: { interval: 3_600, lifetime: 900 },
      users: { interval: 3_600, filter: () => (user) => user.id !== client?.user?.id },
    },
    allowedMentions: { parse: [], repliedUser: false },
  });
}

function wireEvents(bot, env) {
  bot.once(Events.ClientReady, async (readyClient) => {
    status.set({
      state: 'ready',
      readyAt: Date.now(),
      guilds: readyClient.guilds.cache.size,
      user: { id: readyClient.user.id, tag: readyClient.user.tag },
      error: null,
    });
    try {
      readyClient.user.setPresence({
        activities: [{ name: 'Never Land', type: ActivityType.Watching }],
        status: 'online',
      });
      const count = await commands.register(readyClient, env.primaryGuildId);
      console.log(`[bot-v2] ready as ${readyClient.user.tag}; ${count} guild command(s) synchronized.`);
    } catch (error) {
      status.set({ error: `Slash-command sync failed: ${String(error.message).slice(0, 180)}` });
      console.error('[bot-v2] command sync:', error.message);
    }
  });

  bot.on(Events.InteractionCreate, async (interaction) => {
    if (!activeInPrimaryGuild(interaction.guildId)) {
      if (interaction.isRepliable?.()) await interaction.reply({ content: 'This bot is not enabled for this server.', ephemeral: true }).catch(() => {});
      return;
    }
    const settings = settingsStore.get();
    if (interaction.isButton?.()) {
      await tickets.handleButton(interaction, settings).catch((error) => console.error('[bot-v2] ticket button:', error.message));
    } else if (interaction.isChatInputCommand?.()) {
      await commands.execute(interaction, env);
    }
  });

  bot.on(Events.MessageCreate, (message) => {
    if (!activeInPrimaryGuild(message.guildId)) return;
    automod.handle(message, settingsStore.get()).catch((error) => console.error('[bot-v2] automod:', error.message));
  });

  bot.on(Events.MessageDelete, (message) => {
    if (!activeInPrimaryGuild(message.guildId) || !message.author) return;
    const settings = settingsStore.get();
    logs.send(bot, settings, 'message', {
      title: 'Message deleted',
      description: `Author: <@${message.author.id}>\nChannel: <#${message.channelId}>\nContent: ${String(message.content || 'Unavailable').slice(0, 1_500)}`,
      color: 0xfee75c,
    });
  });

  bot.on(Events.GuildMemberAdd, (member) => {
    if (!activeInPrimaryGuild(member.guild.id)) return;
    safeWelcome(member).catch((error) => console.error('[bot-v2] welcome:', error.message));
    logs.send(bot, settingsStore.get(), 'member', {
      title: 'Member joined',
      description: `<@${member.id}> joined the server.`,
      color: 0x57f287,
    });
  });

  bot.on(Events.GuildMemberRemove, (member) => {
    if (!activeInPrimaryGuild(member.guild.id)) return;
    logs.send(bot, settingsStore.get(), 'member', {
      title: 'Member left',
      description: `<@${member.id}> left the server.`,
      color: 0xed4245,
    });
  });

  bot.on(Events.Error, (error) => {
    status.set({ state: 'degraded', error: String(error.message || error).slice(0, 240) });
    console.error('[bot-v2] client error:', error.message || error);
  });

  bot.on(Events.ShardDisconnect, () => status.set({ state: 'degraded', error: 'Discord gateway disconnected.' }));
  bot.on(Events.ShardResume, () => status.set({ state: 'ready', error: null }));
}

async function start() {
  if (client) return client;
  const env = read();
  activeEnv = env;
  if (!env.enabled) {
    status.set({ state: 'disabled', transport: env.transport, error: null });
    return null;
  }
  status.set({ state: 'starting', startedAt: Date.now(), transport: env.transport, error: null });
  if (!env.hasToken || !env.hasPrimaryGuild) {
    status.set({ state: 'degraded', error: 'RUN_BOT is enabled but the token or primary guild ID is missing/invalid.' });
    console.error('[bot-v2] not starting: missing valid DISCORD_TOKEN or PRIMARY_GUILD_ID.');
    return null;
  }

  try {
    client = createClient();
    installRestTransport(client.rest, env);
    wireEvents(client, env);
    await client.login(env.token);
    return client;
  } catch (error) {
    status.set({ state: 'degraded', error: String(error.message || error).slice(0, 240) });
    console.error('[bot-v2] startup failed:', error.message || error);
    try { client?.destroy(); } catch { /* nothing to clean up */ }
    client = null;
    return null;
  }
}

async function stop() {
  if (client) {
    try { client.destroy(); } catch { /* nothing to clean up */ }
    client = null;
  }
  status.set({ state: 'stopped', user: null, guilds: 0 });
}

function getClient() {
  return client;
}

module.exports = { start, stop, getClient, status: status.get };
