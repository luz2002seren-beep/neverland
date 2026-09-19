'use strict';

/**
 * events/interactionCreate.js
 * -------------------------------------------------------------
 * الموجّه (Router) لكل التفاعلات:
 *   • أوامر السلاش (مع كولداون وفحص صلاحيات)
 *   • الأزرار
 *   • قوائم الاختيار (Select Menus)
 *   • النماذج (Modals)
 * كل الأخطاء تُعالج هنا حتى لا يتعطّل البوت أبدًا.
 * -------------------------------------------------------------
 */

const { Events, MessageFlags, ActionRowBuilder } = require('discord.js');
const db = require('../database');
const { t } = require('../lib/i18n');
const embeds = require('../lib/embeds');
const tickets = require('../systems/tickets');
const setupWizard = require('../systems/setupWizard');
const logging = require('../systems/logging');


/** الرد الآمن (يشتغل مع reply أو defer أو update) */
async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch {
    return null;
  }
}

/** فحص الكولداون */
function checkCooldown(client, interaction, command) {
  /* الكولداون مشيل من الأوامر: أي أمر بلا حد (أو حده 0) يشتغل بلا انتظار */
  const cooldownSeconds = Number(command.cooldown) || 0;
  if (cooldownSeconds <= 0) return 0;
  if (!client.cooldowns.has(command.data.name)) client.cooldowns.set(command.data.name, new Map());

  const timestamps = client.cooldowns.get(command.data.name);
  const key = `${interaction.guildId ?? 'dm'}:${interaction.user.id}`;
  const now = Date.now();

  if (timestamps.has(key)) {
    const expires = timestamps.get(key) + cooldownSeconds * 1000;
    if (now < expires) {
      return Math.ceil((expires - now) / 1000);
    }
  }
  timestamps.set(key, now);
  setTimeout(() => timestamps.delete(key), cooldownSeconds * 1000);
  return 0;
}

module.exports = {
  name: Events.InteractionCreate,
  /* مُصدَّر للاختبارات: يرجّع 0 يعني بلا انتظار */
  checkCooldown,

  async execute(client, interaction) {
    const lang = interaction.guildId ? db.locale(interaction.guildId) : 'en';

    /* كل ردود التفاعل تمر بالترجمة + الخط المزخرف (يُطفأ من اللوحة) */
    try {
      require('../lib/replies').wrapInteraction(interaction);
    } catch {
      /* ما نمنع أي أمر بسبب التزيين */
    }

    try {
      /* ======================= الإكمال التلقائي ======================= */
      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command?.autocomplete) {
          await command.autocomplete(client, interaction).catch(() => {
            if (!interaction.responded) interaction.respond([]).catch(() => {});
          });
        } else if (!interaction.responded) {
          await interaction.respond([]).catch(() => {});
        }
        return;
      }

      /* ======================= أوامر السلاش ======================= */
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          return safeReply(interaction, { content: '❌ أمر غير معروف.', flags: MessageFlags.Ephemeral });
        }

        const remaining = checkCooldown(client, interaction, command);
        if (remaining > 0) {
          return safeReply(interaction, {
            content: `⏳ انتظر ${remaining} ثانية قبل استخدام هذا الأمر مرة أخرى.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // فحص صلاحيات المستخدم المطلوبة للأمر
        if (command.permissions?.length && interaction.guild) {
          const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
          const isDev = require('../config').bot.developerIds.includes(interaction.user.id);
          const ok = member.permissions.has(command.permissions) || isDev;
          if (!ok) {
            return safeReply(interaction, {
              content: t(lang, 'common.noPermission'),
              flags: MessageFlags.Ephemeral,
            });
          }
        }

        // فحص صلاحيات البوت
        if (command.botPermissions?.length && interaction.guild) {
          const me = interaction.guild.members.me;
          if (me && !me.permissions.has(command.botPermissions)) {
            return safeReply(interaction, {
              content: t(lang, 'common.botNoPermission'),
              flags: MessageFlags.Ephemeral,
            });
          }
        }

    console.log(`[تنفيذ] ${interaction.user.tag} استخدم /${interaction.commandName} في ${interaction.guild?.name ?? 'الخاص'}`);
        await command.run(client, interaction, lang);
        return;
      }

      /* ======================= قوائم الاختيار =======================
       * ملاحظة مهمة: قوائم الأعضاء/الرتب/القنوات أنواعها مختلفة عن قائمة النصوص،
       * فـ isStringSelectMenu() ترجع false لها — كان هذا سبب تعطّل «إضافة عضو» للتذكرة.
       * isAnySelectMenu() تشمل كل الأنواع (نصوص · أعضاء · رتب · قنوات · منشنات).
       */
      if (interaction.isAnySelectMenu?.() || interaction.isStringSelectMenu()) {
        const [scope, action] = interaction.customId.split(':');

        if (scope === 'ticket' && action === 'open') {
          return openTicket(client, interaction, lang, interaction.values[0]);
        }

        // إضافة عضو/أعضاء للتذكرة عبر قائمة الأعضاء (نوع القائمة: UserSelect)
        if (scope === 'ticket' && action === 'adduser') {
          const ticket = db.getTicketById(Number(interaction.customId.split(':')[2]))
            ?? db.getTicketByChannel(interaction.channelId);
          if (!ticket) return safeReply(interaction, { content: '❌ تذكرة غير موجودة.', flags: MessageFlags.Ephemeral });

          const selected = interaction.values || [];
          const added = [];
          const failed = [];
          for (const id of selected) {
            const ok = await interaction.channel.permissionOverwrites
              .edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }, { reason: `إضافة بواسطة ${interaction.user.tag}` })
              .then(() => true)
              .catch(() => false);
            if (ok) added.push(id); else failed.push(id);
          }

          if (added.length) {
            await interaction.channel
              .send({ content: `➕ تمت إضافة ${added.map((id) => `<@${id}>`).join(' ')} إلى التذكرة بواسطة ${interaction.user}` })
              .catch(() => {});
          }
          const text = added.length
            ? `✅ تمت إضافة ${added.map((id) => `<@${id}>`).join(' ')} للتذكرة.${failed.length ? `\n⚠️ فشل: ${failed.length}` : ''}`
            : '❌ ما قدرت أضيف — تأكد إن عندي صلاحية **إدارة الرومات/الصلاحيات**.';
          return safeReply(interaction, { content: text, flags: MessageFlags.Ephemeral });
        }

        // قوائم إعدادات أخرى (setup wizard) تُوجَّه إلى المعالج
        if (scope === 'setup') {
          return setupWizard.handleSelect(client, interaction, lang);
        }

        // اختيار مجموعة سجلات ثم أحداثها
        if (scope === 'logs' && action === 'group') {
          const logsCommand = client.commands.get('logs');
          const settings = db.getGuildSettings(interaction.guildId);
          const payload = logsCommand.buildGroupEventsMenu(interaction.values[0], settings);
          return interaction.update(payload);
        }

        if (scope === 'logs' && action === 'events') {
          const groupId = interaction.customId.split(':')[2];
          const settings = db.getGuildSettings(interaction.guildId);
          const current = settings.logs.events || {};
          const groupKeys = Object.keys(logging.EVENT_META).filter((key) => logging.EVENT_META[key].group === groupId);
          const selected = new Set(interaction.values);

          const events = { ...current };
          for (const key of groupKeys) events[key] = selected.has(key);

          db.updateGuildSettings(interaction.guildId, { logs: { events, enabled: true } });

          const active = groupKeys.filter((k) => selected.has(k));
          return interaction.update({
            embeds: [
              embeds.success(
                'تم حفظ أحداث السجلات',
                active.length
                  ? `**${logging.EVENT_GROUPS[groupId].label}** — المُفعّلة الآن (${active.length}/${groupKeys.length}):\n${active.map((k) => `• ${logging.EVENT_META[k].label}`).join('\n')}`
                  : `🔴 تم تعطيل كل أحداث **${logging.EVENT_GROUPS[groupId].label}**.`,
              ),
            ],
            components: [],
          });
        }
        return;
      }

      /* ======================= الأزرار ======================= */
      if (interaction.isButton()) {
        const [scope, action, arg] = interaction.customId.split(':');

        // فتح تذكرة من زر (الوضع الافتراضي للوحة)
        if (scope === 'ticket' && action === 'open') {
          return openTicket(client, interaction, lang, arg);
        }

        /* 📝 زر فتح نموذج تقديم الإدارة (Modal) */
        if (scope === 'ticket' && action === 'apply') {
          const applications = require('../systems/applications');
          const ticket = db.getTicketById(Number(interaction.customId.split(':')[3])) ?? db.getTicketByChannel(interaction.channelId);
          if (!ticket) return safeReply(interaction, { content: '❌ تذكرة غير موجودة.', flags: MessageFlags.Ephemeral });
          if (ticket.user_id !== interaction.user.id) {
            return safeReply(interaction, { content: '❌ هذا النموذج لصاحب التذكرة فقط.', flags: MessageFlags.Ephemeral });
          }
          const settings = db.getGuildSettings(interaction.guildId);
          return interaction.showModal(applications.buildFormModal(settings, ticket));
        }

        /* ✅❌ أزرار مراجعة تقديم الإدارة (قبول/رفض) */
        if (scope === 'apply' && action === 'review') {
          const decisions = { accept: 'accept', reject: 'reject' };
          const parts = interaction.customId.split(':');
          const decision = decisions[parts[2]];
          const ticket = db.getTicketById(Number(parts[3]));
          if (!ticket || !decision) {
            return safeReply(interaction, { content: '❌ الطلب غير موجود.', flags: MessageFlags.Ephemeral });
          }

          const settings = db.getGuildSettings(interaction.guildId);
          const isStaff =
            (settings.tickets?.supportRoleIds || []).some((r) => interaction.member?.roles?.cache?.has(r)) ||
            interaction.member?.permissions?.has('ManageChannels');
          if (!isStaff) {
            return safeReply(interaction, { content: '❌ فقط الإدارة يمكنها قبول أو رفض الطلبات.', flags: MessageFlags.Ephemeral });
          }

          const applications = require('../systems/applications');

          // الرفض ➜ نطلب السبب في نموذج صغير أولًا (إن كان مفعّلًا)
          if (decision === 'reject' && settings.staffApplication?.askRejectReason !== false) {
            return interaction.showModal(applications.buildRejectModal(ticket, { ask: true }));
          }

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await applications.reviewApplication(client, interaction, ticket, decision, { message: interaction.message });
          logTicket(client, interaction, `${decision === 'accept' ? 'قبول' : 'رفض'} تقديم إدارة #${ticket.id}`);
          return interaction.editReply({
            content:
              decision === 'accept'
                ? `✅ تم **قبول** الطلب #${result.number}${result.dmSent ? ' وأُرسلت رسالة خاصة للمتقدّم' : ' (تعذّر إرسال الخاص — الخاص مقفل)'}.`
                : `❌ تم **رفض** الطلب${result.dmSent ? ' وأُرسلت رسالة خاصة للمتقدّم' : ' (تعذّر إرسال الخاص — الخاص مقفل)'}.`,
          });
        }

        if (scope === 'help') {
          const helpCommand = client.commands.get('help');
          if (helpCommand?.renderCategory) {
            await interaction.deferUpdate().catch(() => {});
            const payload = helpCommand.renderCategory(client, action, lang, interaction.guildId, interaction.member);
            await interaction.editReply(payload).catch(() => {});
          }
          return;
        }

        if (scope === 'ticket') {
          const ticket = db.getTicketById(Number(arg)) || db.getTicketByChannel(interaction.channelId);
          if (!ticket) {
            return safeReply(interaction, { content: '❌ تذكرة غير موجودة.', flags: MessageFlags.Ephemeral });
          }

          if (action === 'claim') {
            const settings = db.getGuildSettings(interaction.guildId);
            const isSupport =
              (settings.tickets.supportRoleIds || []).some((r) => interaction.member?.roles?.cache?.has(r)) ||
              interaction.member?.permissions?.has('ManageChannels');
            if (!isSupport) {
              return safeReply(interaction, { content: '❌ فقط فريق الدعم يمكنه استلام التذاكر.', flags: MessageFlags.Ephemeral });
            }
            db.updateTicket(ticket.id, { claimed_by: interaction.user.id });
            await interaction.reply({ content: t(lang, 'tickets.claimed', { user: `${interaction.user}` }) });
            await interaction.message?.edit({ components: [tickets.ticketControls(ticket.id, true, settings.tickets)] }).catch(() => {});
            return;
          }

          if (action === 'close') {
            const settings = db.getGuildSettings(interaction.guildId);
            const isOwner = ticket.user_id === interaction.user.id;
            const isSupport =
              (settings.tickets.supportRoleIds || []).some((r) => interaction.member?.roles?.cache?.has(r)) ||
              interaction.member?.permissions?.has('ManageChannels');
            if (!isOwner && !isSupport) {
              return safeReply(interaction, { content: '❌ ما عندك صلاحية إغلاق هذه التذكرة.', flags: MessageFlags.Ephemeral });
            }
            await interaction.reply({ content: '🔒 جارٍ إغلاق التذكرة وحفظ الأرشيف...' });
            await tickets.closeTicket(client, interaction.channel, interaction.user);
            logTicket(client, interaction, `إغلاق تذكرة #${ticket.id}`);
            return;
          }

          if (action === 'addmember') {
            const { UserSelectMenuBuilder } = require('discord.js');
            const row = new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId(`ticket:adduser:${ticket.id}`)
                .setPlaceholder('اختر الأعضاء لإضافتهم للتذكرة...')
                .setMinValues(1)
                .setMaxValues(5),
            );
            return interaction.reply({ content: '➕ اختر العضو:', components: [row], flags: MessageFlags.Ephemeral });
          }

          if (action === 'transcript') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const file = await tickets.buildArchive(interaction.channel);
            if (!file) return interaction.editReply({ content: '❌ تعذّر إنشاء الأرشيف.' });
            return interaction.editReply({ content: '📄 أرشيف التذكرة:', files: [file] });
          }
          return;
        }

        if (scope === 'selfrole') {
          const roleId = arg;
          const guild = interaction.guild;
          const role = guild.roles.cache.get(roleId);
          if (!role) return safeReply(interaction, { content: '❌ الرتبة غير موجودة.', flags: MessageFlags.Ephemeral });
          const has = interaction.member.roles.cache.has(roleId);
          await (has ? interaction.member.roles.remove(role) : interaction.member.roles.add(role)).catch(() => {});
          return safeReply(interaction, {
            content: has ? `➖ تم سحب رتبة **${role.name}**` : `➕ تم إعطاؤك رتبة **${role.name}**`,
            flags: MessageFlags.Ephemeral,
          });
        }

        if (scope === 'setup') {
          return setupWizard.handleButton(client, interaction, action, lang);
        }
        return;
      }

      /* ======================= النماذج (Modals) ======================= */
      if (interaction.isModalSubmit()) {
        const [scope, action] = interaction.customId.split(':');

        /* 📝 إرسال نموذج تقديم الإدارة */
        if (scope === 'ticket' && action === 'apply') {
          const applications = require('../systems/applications');
          const ticket = db.getTicketById(Number(interaction.customId.split(':')[3])) ?? db.getTicketByChannel(interaction.channelId);
          if (!ticket) return safeReply(interaction, { content: '❌ تذكرة غير موجودة.', flags: MessageFlags.Ephemeral });

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await applications.submitApplication(client, interaction, ticket);
          if (!result.ok) return interaction.editReply({ content: '❌ تعذّر إرسال الطلب للإدارة، كلّم الإدارة مباشرة.' });
          logTicket(client, interaction, `تقديم إدارة جديد #${ticket.id} (نموذج)`);
          return interaction.editReply({
            content: '✅ تم إرسال تقديمك للإدارة!\nسيصلك الرد على الخاص 🔔 — لا تغلق التذكرة حتى تصل النتيجة.',
          });
        }

        /* ❌ سبب رفض تقديم الإدارة */
        if (scope === 'apply' && action === 'rejectreason') {
          const applications = require('../systems/applications');
          const ticket = db.getTicketById(Number(interaction.customId.split(':')[2]));
          if (!ticket) return safeReply(interaction, { content: '❌ الطلب غير موجود.', flags: MessageFlags.Ephemeral });

          const settings = db.getGuildSettings(interaction.guildId);
          const isStaff =
            (settings.tickets?.supportRoleIds || []).some((r) => interaction.member?.roles?.cache?.has(r)) ||
            interaction.member?.permissions?.has('ManageChannels');
          if (!isStaff) return safeReply(interaction, { content: '❌ فقط الإدارة يمكنها رفض الطلبات.', flags: MessageFlags.Ephemeral });

          const reason = interaction.fields.getTextInputValue('reason').trim();
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await applications.reviewApplication(client, interaction, ticket, 'reject', { reason, message: interaction.message });
          logTicket(client, interaction, `رفض تقديم إدارة #${ticket.id}`);
          return interaction.editReply({
            content: `❌ تم رفض الطلب${result.dmSent ? ' وأُرسلت رسالة خاصة للمتقدّم مع السبب' : ' (تعذّر إرسال الخاص — الخاص مقفل)'}.`,
          });
        }

        if (scope === 'setup') return setupWizard.handleModal(client, interaction, action, lang);
        if (scope === 'report') {
          const targetId = interaction.fields.getTextInputValue('target');
          const reason = interaction.fields.getTextInputValue('reason');
          const settings = db.getGuildSettings(interaction.guildId);
          const reportChannel = settings.reports?.channelId;
          await interaction.reply({ content: '✅ تم إرسال البلاغ للإدارة، شكراً لك!', flags: MessageFlags.Ephemeral });
          if (reportChannel) {
            const channel = interaction.guild.channels.cache.get(reportChannel);
            if (channel?.isTextBased?.()) {
              await channel
                .send({
                  embeds: [
                    embeds.info('بلاغ جديد', `**المُبلِّغ:** ${interaction.user}\n**المُبلَّغ عنه:** ${targetId}\n**السبب:** ${reason}`),
                  ],
                })
                .catch(() => {});
            }
          }
          return;
        }
      }
    } catch (err) {
      client.errorCount += 1;
   console.error('[خطأ] خطأ في معالجة التفاعل:', err);
      await safeReply(interaction, {
        content: '❌ صار خطأ غير متوقع أثناء تنفيذ الأمر. تم تسجيله في السجلات.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

/** فتح تذكرة (يُستخدم من الأزرار والقوائم) */
async function openTicket(client, interaction, lang, typeId) {
  if (!interaction.guild) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const ticketsSystem = require('../systems/tickets');
  const result = await ticketsSystem.createTicket(client, interaction.guild, interaction.user, typeId);

  if (!result.ok) {
    const messages = {
      disabled: t(lang, 'common.disabled'),
      noCategory: t(lang, 'tickets.noCategory'),
      maxOpen: t(lang, 'tickets.maxOpen', { max: result.max }),
      createFailed: '❌ تعذّر إنشاء التذكرة. تأكد من صلاحيات البوت (إدارة القنوات).',
    };
    return interaction.editReply({ content: messages[result.reason] || '❌ حدث خطأ.' });
  }

  const typeLabel = (db.getGuildSettings(interaction.guildId).tickets?.types || []).find((ty) => ty.id === result.ticket.type)?.label ?? result.ticket.type;
  logTicket(client, interaction, `فتح تذكرة #${result.ticket.id} (${typeLabel})`);
  return interaction.editReply({
    content: t(lang, 'tickets.created', { type: typeLabel, channel: `<#${result.channel.id}>` }),
  });
}

/** إرسال لوق للتذاكر */
async function logTicket(client, interaction, action) {
  try {
    const logging = require('../systems/logging');
    await logging.send(client, interaction.guild, 'ticket', {
      title: action,
      fields: [
        { name: 'العضو', value: `${interaction.user}`, inline: true },
        { name: 'القناة', value: `${interaction.channel}`, inline: true },
      ],
    });
  } catch {
    /* تجاهل */
  }
}
