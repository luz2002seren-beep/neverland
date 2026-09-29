'use strict';

/**
 * أوامر من حزمة ديسكورد نفسها.
 * بعض الأحداث كتوصل raw وما كتخرجش كـ messageCreate / interactionCreate،
 * فيبان البوت أونلاين والأوامر ساكتة.
 */

const textCommands = require('./textCommands');

const seenInteractions = new Set();

function remember(set, id) {
  if (!id) return;
  set.add(id);
  setTimeout(() => set.delete(id), 20000).unref?.();
}

function optionTree(data) {
  const options = data?.options || [];
  const sub = options.find((option) => option.type === 1 || option.type === 2);
  if (!sub) return { sub: null, options };
  return { sub: sub.name, options: sub.options || [] };
}

function findOption(options, name) {
  return (options || []).find((option) => option.name === name) || null;
}

async function channelOf(client, data) {
  const id = data.channel_id;
  if (!id) return null;
  return client.channels?.cache?.get(id) || (await client.channels.fetch(id).catch(() => null));
}

const TEST_CHANNEL_ID = '1553824667167629334';

async function runTextFromPacket(client, data) {
  const selfTest = String(data?.channel_id || '') === TEST_CHANNEL_ID && String(data?.author?.id || '') === String(client.user?.id || '');
  if (!data?.guild_id || data.webhook_id) return;
  if (data.author?.bot && !selfTest) return;
  const content = String(data.content || '').trim();
  if (!content) return;
  const first = content.split(/\s+/)[0];
  if (!textCommands.resolveCommand(data.guild_id, first)
    && !(content.split(/\s+/).length > 1 && textCommands.resolveCommand(data.guild_id, `${content.split(/\s+/)[0]}${content.split(/\s+/)[1]}`))) {
    return;
  }

  const channel = await channelOf(client, data);
  if (!channel?.messages?.fetch) return;
  const message = channel.messages.cache.get(data.id) || (await channel.messages.fetch(data.id).catch(() => null));
  if (!message) {
    console.error('[أوامر] الرسالة وصلت وما قدرناش نجيبها', data.id);
    return;
  }
  await textCommands.handleMessage(client, message, { allowSelfTest: selfTest });
}

function restReply(client, interaction, payload) {
  const appId = client.application?.id || client.user?.id;
  const body = {};
  if (typeof payload === 'string') body.content = payload.slice(0, 2000);
  else if (payload && typeof payload === 'object') {
    if (payload.content) body.content = String(payload.content).slice(0, 2000);
    if (payload.embeds) {
      body.embeds = payload.embeds.map((embed) => (typeof embed.toJSON === 'function' ? embed.toJSON() : embed)).slice(0, 10);
    }
    if (payload.components) body.components = payload.components;
    if (payload.flags) body.flags = payload.flags;
  }
  if (!body.content && !body.embeds && !body.components) body.content = 'تم.';
  if (!interaction.deferred && !interaction.replied) {
    interaction.replied = true;
    return client.rest.post(`/interactions/${interaction.id}/${interaction.token}/callback`, {
      body: { type: 4, data: body },
    });
  }
  return client.rest.patch(`/webhooks/${appId}/${interaction.token}/messages/@original`, { body });
}

async function rescueInteraction(client, data) {
  if (data.type !== 2 || data.data?.type !== 1) return;
  const guild = client.guilds?.cache?.get(data.guild_id) || null;
  if (!guild) return;
  const command = client.commands?.get(data.data.name);
  if (!command?.run) return;
  const channel = await channelOf(client, data);
  const tree = optionTree(data.data);
  const user = data.member?.user || data.user || {};
  let member = guild.members?.cache?.get(user.id) || null;
  if (!member && user.id) member = await guild.members.fetch(user.id).catch(() => null);

  const interaction = {
    id: data.id,
    token: data.token,
    commandName: data.data.name,
    guild,
    guildId: guild.id,
    channel,
    channelId: data.channel_id,
    user: member?.user || user,
    member,
    client,
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    inGuild: () => true,
    options: {
      getSubcommand: () => tree.sub,
      getSubcommandGroup: () => null,
      getString: (name) => {
        const option = findOption(tree.options, name);
        return option ? String(option.value) : null;
      },
      getInteger: (name) => {
        const option = findOption(tree.options, name);
        return option ? Number(option.value) : null;
      },
      getNumber: (name) => {
        const option = findOption(tree.options, name);
        return option ? Number(option.value) : null;
      },
      getBoolean: (name) => {
        const option = findOption(tree.options, name);
        return option ? Boolean(option.value) : null;
      },
      getChannel: (name) => {
        const option = findOption(tree.options, name);
        if (!option?.value) return channel;
        return guild.channels.cache.get(option.value) || channel;
      },
      getUser: (name) => {
        const option = findOption(tree.options, name);
        if (!option?.value) return null;
        return client.users?.cache?.get(option.value) || { id: option.value, tag: option.value, toString() { return `<@${option.value}>`; } };
      },
      getMember: (name) => {
        const option = findOption(tree.options, name);
        return option?.value ? guild.members.cache.get(option.value) || null : null;
      },
      getRole: (name) => {
        const option = findOption(tree.options, name);
        return option?.value ? guild.roles.cache.get(option.value) || null : null;
      },
      getFocused: () => '',
      getAttachment: () => null,
    },
    async reply(payload) { return restReply(client, interaction, payload); },
    async editReply(payload) { return restReply(client, interaction, payload); },
    async followUp(payload) { return restReply(client, interaction, payload); },
    async deferReply() {
      if (interaction.deferred || interaction.replied) return null;
      interaction.deferred = true;
      return client.rest.post(`/interactions/${data.id}/${data.token}/callback`, {
        body: { type: 5 },
      });
    },
    async update(payload) { return restReply(client, interaction, payload); },
    async deleteReply() { return null; },
    async fetchReply() { return null; },
  };

  console.log(`[أوامر] سلاش طارئ /${data.data.name} في ${guild.name}`);
  try {
    require('../lib/replies').wrapInteraction(interaction);
  } catch { /* الرد أهم من التزيين */ }
  await command.run(client, interaction, 'ar');
  if (!interaction.replied && !interaction.deferred) {
    await restReply(client, interaction, { content: 'تم.' });
  }
}

function attach(client) {
  client.on('interactionCreate', (interaction) => remember(seenInteractions, interaction?.id));

  client.on('raw', (packet) => {
    const name = packet?.t;
    const data = packet?.d;
    if (!name || !data) return;

    if (name === 'MESSAGE_CREATE') {
      runTextFromPacket(client, data).catch((err) => {
        console.error('[أوامر] النص الخام فشل:', err?.message || err);
      });
      return;
    }

    if (name === 'INTERACTION_CREATE') {
      setTimeout(() => {
        if (seenInteractions.has(data.id)) return;
        remember(seenInteractions, data.id);
        rescueInteraction(client, data).catch((err) => {
          console.error('[أوامر] السلاش الخام فشل:', err?.message || err);
        });
      }, 400).unref?.();
    }
  });

  const logReady = () => {
    for (const guild of client.guilds.cache.values()) {
      let enabled = true;
      let lock = null;
      try {
        enabled = textCommands.configFor(guild.id).enabled;
        lock = textCommands.resolveCommand(guild.id, 'قفل');
      } catch (err) {
        console.error('[أوامر] فحص الإعداد فشل:', err?.message || err);
      }
      console.log(`[أوامر] ${guild.name} نص=${enabled ? 'شغّال' : 'واقف'} قفل=${lock || 'لا'}`);
    }
    console.log('[أوامر] مستمع الطوارئ شغّال');
  };
  if (client.isReady?.()) logReady();
  else client.once('ready', logReady);
}

module.exports = { attach };
