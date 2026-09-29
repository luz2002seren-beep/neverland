'use strict';

/**
 * events/messages.js
 * -------------------------------------------------------------
 * لوقات الرسائل: الحذف، التعديل، الحذف الجماعي (مع كشف المنفّذ من Audit Log).
 * -------------------------------------------------------------
 */

const { Events, AuditLogEvent } = require('discord.js');
const logging = require('../systems/logging');
const autoline = require('../systems/autoline');
const { findExecutor } = require('../lib/audit');
const { truncate } = require('../lib/utils');

module.exports = [
  {
    name: Events.MessageDelete,
    async execute(client, message) {
      if (!message.guild || message.author?.bot) return;

      // الخط الفاصل ما يأخّر اللوق
      const lineTask = autoline.handleMessageDelete(client, message).catch(() => {});

      const { executor } = await findExecutor(message.guild, AuditLogEvent.MessageDelete, {
        targetId: message.author.id,
        maxAgeMs: 5000,
      });

      await logging.send(client, message.guild, 'messageDelete', {
        title: 'Message Deleted',
        description: truncate(message.content || 'Attachment or embed only', 1024),
        thumbnail: message.author.displayAvatarURL({ size: 256 }),
        fields: [
          { name: 'Author', value: `${message.author} \`${message.author.tag}\``, inline: true },
          { name: 'Channel', value: `${message.channel}`, inline: true },
          ...(executor ? [{ name: 'Deleted By', value: `${executor}`, inline: true }] : []),
        ],
        footer: `ID ${message.id}`,
        channelId: message.channelId,
        member: message.member,
      });
      await lineTask;
    },
  },
  {
    name: Events.MessageUpdate,
    async execute(client, oldMessage, newMessage) {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;

      await logging.send(client, newMessage.guild, 'messageEdit', {
        title: 'تعديل رسالة',
        fields: [
          { name: 'الكاتب', value: `${newMessage.author} \`${newMessage.author.tag}\``, inline: true },
          { name: 'القناة', value: `${newMessage.channel}`, inline: true },
          { name: 'قبل', value: truncate(oldMessage.content || '—', 1000), inline: false },
          { name: 'بعد', value: truncate(newMessage.content || '—', 1000), inline: false },
          { name: 'الرابط', value: `[اذهب للرسالة](${newMessage.url})`, inline: false },
        ],
      });
    },
  },
  {
    name: Events.MessageBulkDelete,
    async execute(client, messages, channel) {
      if (!channel.guild) return;
      const { executor } = await findExecutor(channel.guild, AuditLogEvent.MessageBulkDelete, { maxAgeMs: 8000 });
      await logging.send(client, channel.guild, 'messageBulkDelete', {
        title: 'حذف جماعي للرسائل',
        description: `تم حذف **${messages.size}** رسالة في ${channel}.`,
        fields: [
          ...(executor ? [{ name: 'بواسطة', value: `${executor}`, inline: true }] : []),
          { name: 'القناة', value: `${channel}`, inline: true },
        ],
      });
    },
  },
];
