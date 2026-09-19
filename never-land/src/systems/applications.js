'use strict';

/**
 * systems/applications.js
 * -------------------------------------------------------------
 * 📝 نظام تقديم الإدارة (Member Applications):
 *
 *  1) عندما يفتح عضو تذكرة من نوع "تقديم إدارة" يرسل البوت رسالة
 *     فيها زر **📝 املأ نموذج التقديم**.
 *  2) الزر يفتح **نموذج Discord (Modal)** من 5 خانات:
 *        الاسم والعمر • من أي بلد • سيرفرات كنت إدارياً فيها • مايك • شعار ورابط
 *  3) بعد الإرسال تذهب الإجابات إلى **قناة مراجعة الإدارة** مع زرّي
 *     ✅ قبول / ❌ رفض (ورفض بسبب اختياري).
 *  4) الرفض ➜ رسالة خاصة للمتقدّم (مع السبب).
 *     القبول ➜ رسالة في تذكرته + رسالة خاصة + **إعادة تسمية التذكرة**
 *     باسمه وترقيمها + **نقلها لقسم تكتات الإدارة** + إعطاؤه رتبًا إن حُدّدت.
 * -------------------------------------------------------------
 */

const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../database');
const dmPolicy = require('../lib/dmPolicy');
const { base } = require('../lib/embeds');
const { truncate } = require('../lib/utils');

/** أقصى عدد حقول يسمح به ديسكورد في النموذج */
const MAX_FIELDS = 5;

const STYLE_MAP = { short: TextInputStyle.Short, paragraph: TextInputStyle.Paragraph };

/* ============================ أدوات مساعدة ============================ */

/** إعدادات نظام التقديم مع حماية من القيم الناقصة */
function cfgOf(settings) {
  const cfg = settings?.staffApplication || {};
  return {
    enabled: cfg.enabled !== false,
    onlyForTypes: cfg.onlyForTypes?.length ? cfg.onlyForTypes : ['staff'],
    reviewChannelId: cfg.reviewChannelId || null,
    pingRoleIds: cfg.pingRoleIds || [],
    formTitle: cfg.formTitle || '📝 نموذج تقديم الإدارة',
    formIntro: cfg.formIntro || 'عبّي الخانات بالأسفل ثم أرسل.',
    formButtonLabel: cfg.formButtonLabel || '📝 املأ نموذج التقديم',
    resendButtonLabel: cfg.resendButtonLabel || '🔁 إعادة إرسال النموذج',
    fields: (cfg.fields || []).slice(0, MAX_FIELDS),
    nameFieldId: cfg.nameFieldId || cfg.fields?.[0]?.id || 'name_age',
    acceptMessage: cfg.acceptMessage || '🎉 تم قبول عرضك!',
    rejectMessage: cfg.rejectMessage || '😔 تم رفض عرضك.',
    askRejectReason: cfg.askRejectReason !== false,
    onAccept: {
      postInTicket: cfg.onAccept?.postInTicket ?? '🎉 {user} **لقد تم قبول عرضك!**',
      dmApplicant: cfg.onAccept?.dmApplicant !== false,
      renameChannel: cfg.onAccept?.renameChannel !== false,
      channelNameFormat: cfg.onAccept?.channelNameFormat || 'إدارة-{number}-{name}',
      moveToCategoryId: cfg.onAccept?.moveToCategoryId || null,
      addRoleIds: cfg.onAccept?.addRoleIds || [],
      pingApplicant: cfg.onAccept?.pingApplicant !== false,
    },
    onReject: {
      postInTicket: cfg.onReject?.postInTicket ?? '❌ {user} تم رفض تقديمك.',
      dmApplicant: cfg.onReject?.dmApplicant !== false,
      closeTicket: cfg.onReject?.closeTicket === true,
    },
  };
}

/**
 * هل هذا النوع من أنواع التذاكر التي تُفعّل فيها الاستمارة؟
 * @param {object} settings إعدادات السيرفر
 * @param {string|object} type معرّف النوع أو كائن النوع
 */
function isApplicationType(settings, type) {
  const cfg = cfgOf(settings);
  if (!cfg.enabled) return false;
  const typeId = typeof type === 'string' ? type : type?.id;
  if (typeof type === 'object' && type?.application === true) return true;
  return cfg.onlyForTypes.includes(typeId);
}

/** ترقيم الطلب: 3 خانات على الأقل (001، 002 ...) */
const padNumber = (value) => String(value).padStart(3, '0');

/** تنظيف اسم القناة ليكون مقبولًا في ديسكورد */
function sanitizeChannelName(value) {
  return String(value || '')
    .replace(/[\\/#?*:|"<>@`]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 90);
}

/**
 * استخراج اسم المتقدّم من قيمة حقل "الاسم والعمر"
 * "أحمد — 18" ➜ "أحمد" | "Ahmed Ali, 17 سنة" ➜ "ahmed-ali"
 */
function extractName(value, fallback = 'متقدم') {
  const raw = String(value || '')
    .split(/[\n|/,،]|—|–|\s-\s/)[0]
    .replace(/[0-9٠-٩]+/g, '')
    .replace(/سنة|سنه|سنا|years?|old|عاما|عمر(ي|ى)?/gi, '')
    .trim();
  const cleaned = sanitizeChannelName(raw);
  return cleaned || sanitizeChannelName(fallback) || 'applicant';
}

/** استبدال المتغيّرات في قوالب الرسائل */
function render(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (full, key) => (vars[key] !== undefined ? String(vars[key]) : full));
}

/** قيمة حقل من رسالة المراجعة (Embed) حسب مُعرّف الحقل */
function fieldValueFromReview(settings, message, fieldId) {
  const cfg = cfgOf(settings);
  const index = cfg.fields.findIndex((f) => f.id === fieldId);
  const label = cfg.fields[index >= 0 ? index : 0]?.label;
  const fields = message?.embeds?.[0]?.fields || [];
  const found = fields.find((f) => f.name === label) || fields[0];
  return found?.value || '';
}

/* ============================ بناء الرسائل والنماذج ============================ */

/** رسالة داخل التذكرة فيها زر فتح النموذج */
function buildFormMessage(settings, ticket, { resend = false } = {}) {
  const cfg = cfgOf(settings);
  const questions = cfg.fields.map((f, i) => `**${i + 1}.** ${f.label}`).join('\n');

  const embed = base({
    color: 0x9b59b6,
    title: cfg.formTitle,
    description: `${cfg.formIntro}\n\n**الخانات المطلوبة:**\n${questions}`,
    footer: `طلب تقديم إدارة #${ticket.id}`,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:apply:open:${ticket.id}`)
      .setLabel(resend ? cfg.resendButtonLabel : cfg.formButtonLabel)
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

/** نموذج التعبئة (Modal) بالخانات الخمس */
function buildFormModal(settings, ticket) {
  const cfg = cfgOf(settings);
  const modal = new ModalBuilder()
    .setCustomId(`ticket:apply:submit:${ticket.id}`)
    .setTitle(truncate(cfg.formTitle.replace(/^\p{Emoji}\s*/u, ''), 45));

  for (const field of cfg.fields.slice(0, MAX_FIELDS)) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(truncate(field.label, 45))
      .setStyle(STYLE_MAP[field.style] ?? TextInputStyle.Short)
      .setRequired(field.required !== false);
    if (field.placeholder) input.setPlaceholder(truncate(field.placeholder, 100));
    if (field.maxLength) input.setMaxLength(Math.min(4000, field.maxLength));
    if (field.minLength) input.setMinLength(field.minLength);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  return modal;
}

/** نموذج سبب الرفض (يظهر للمشرف عند الضغط على ❌ رفض) */
function buildRejectModal(ticket, { ask = true } = {}) {
  const modal = new ModalBuilder()
    .setCustomId(`apply:rejectreason:${ticket.id}`)
    .setTitle(ask ? 'سبب رفض التقديم' : 'تأكيد الرفض');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('سبب الرفض (يُرسل للمتقدّم)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(ask)
        .setMaxLength(500)
        .setPlaceholder('مثال: ناقص الخبرة المطلوبة — أعد التقديم بعد شهر'),
    ),
  );

  return modal;
}

/**
 * إيجاد رسالة المراجعة لقناة الإدارة (يُستخدم عند الرفض من نموذج السبب،
 * لأن تفاعل النموذج لا يحمل مرجع الرسالة).
 */
async function findReviewMessage(client, settings, ticketId) {
  const cfg = cfgOf(settings);
  const channelId = cfg.reviewChannelId || settings.tickets?.logChannelId;
  if (!channelId) return null;
  const channel = client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
  if (!channel?.messages?.fetch) return null;
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  return (
    messages.find((msg) =>
      msg.components?.some((row) =>
        row.components?.some((comp) => String(comp.customId || '').startsWith('apply:review:') && String(comp.customId).endsWith(`:${ticketId}`)),
      ),
    ) ?? null
  );
}

/** استخراج إجابات النموذج كقائمة جاهزة للإمbed */
function collectAnswers(settings, fields) {
  const cfg = cfgOf(settings);
  return cfg.fields.slice(0, MAX_FIELDS).map((field) => ({
    id: field.id,
    label: field.label,
    value: truncate(String(fields.getTextInputValue(field.id) ?? '—'), 1020),
  }));
}

/** رسالة المراجعة التي تُرسل لقناة الإدارة */
function buildReviewPayload(client, settings, ticket, applicant, answers) {
  const cfg = cfgOf(settings);

  const embed = base({
    color: 0xf1c40f,
    title: `📥 طلب تقديم إدارة جديد — #${padNumber(ticket.id)}`,
    description:
      `**المتقدّم:** <@${ticket.user_id}> \`${applicant?.username ?? 'غير معروف'}\`\n` +
      `**الآيدي:** \`${ticket.user_id}\`\n` +
      `**التذكرة:** <#${ticket.channel_id}>\n` +
      `**تاريخ التقديم:** <t:${Math.floor(Date.now() / 1000)}:F>`,
    thumbnail: applicant?.displayAvatarURL?.() || undefined,
    fields: answers.map((a) => ({ name: a.label, value: a.value, inline: false })),
    footer: `${cfg.formTitle} • اضغط ✅ للقبول أو ❌ للرفض`,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`apply:review:accept:${ticket.id}`).setLabel('قبول العرض').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`apply:review:reject:${ticket.id}`).setLabel('رفض العرض').setEmoji('❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setLabel('الذهاب للتذكرة')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${ticket.guild_id}/${ticket.channel_id}`),
  );

  const payload = { embeds: [embed], components: [row] };
  if (cfg.pingRoleIds.length) payload.content = cfg.pingRoleIds.map((r) => `<@&${r}>`).join(' ');
  return payload;
}

/* ============================ الإرسال ============================ */

/** إرسال رسالة النموذج داخل التذكرة */
async function sendFormMessage(client, channel, ticket, options = {}) {
  const settings = db.getGuildSettings(ticket.guild_id);
  return channel.send(buildFormMessage(settings, ticket, options)).catch(() => null);
}

/**
 * إرسال طلب التقديم لقناة المراجعة.
 * @returns {Promise<{ok:boolean, channelId?:string, reason?:string}>}
 */
async function submitApplication(client, interaction, ticket) {
  const settings = db.getGuildSettings(interaction.guildId);
  const cfg = cfgOf(settings);

  const answers = collectAnswers(settings, interaction.fields);
  const reviewChannelId = cfg.reviewChannelId || settings.tickets?.logChannelId;
  const guild = interaction.guild;

  const payload = buildReviewPayload(client, settings, ticket, interaction.user, answers);

  let target = reviewChannelId ? guild.channels.cache.get(reviewChannelId) : null;
  if (!target && reviewChannelId) target = await guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!target) target = interaction.channel; // احتياط: يبقى الطلب داخل التذكرة

  const sent = await target.send(payload).catch((err) => {
  console.error('[تنبيه] فشل إرسال طلب التقديم لقناة المراجعة:', err.message);
    return null;
  });
  if (!sent) return { ok: false, reason: 'sendFailed' };

  if (target.id !== interaction.channelId) {
    await interaction.channel
      .send({
        embeds: [
          base({
            color: 0x2ecc71,
            title: '✅ تم إرسال تقديمك للإدارة',
            description: `وصل طلبك لقناة المراجعة ${target.toString()}، وستصلك النتيجة على الخاص 🔔\n**رقم طلبك:** #${padNumber(ticket.id)}`,
          }),
        ],
      })
      .catch(() => {});
  }

  return { ok: true, channelId: target.id, answers };
}

/**
 * مراجعة الطلب: قبول أو رفض.
 * @param {'accept'|'reject'} decision
 * @param {object} opts {reason, message}
 */
async function reviewApplication(client, interaction, ticket, decision, opts = {}) {
  const settings = db.getGuildSettings(interaction.guildId);
  const cfg = cfgOf(settings);
  const guild = interaction.guild;
  const member = await guild.members.fetch(ticket.user_id).catch(() => null);
  const applicantUser = member?.user ?? (await client.users.fetch(ticket.user_id).catch(() => null));
  const ticketChannel = guild.channels.cache.get(ticket.channel_id) ?? (await guild.channels.fetch(ticket.channel_id).catch(() => null));

  const reviewMessage = opts.message ?? (await findReviewMessage(client, settings, ticket.id));
  const rawName = fieldValueFromReview(settings, reviewMessage, cfg.nameFieldId);
  const name = extractName(rawName, applicantUser?.username);
  const number = padNumber(ticket.id);
  const vars = { user: `<@${ticket.user_id}>`, name: rawName.split('\n')[0], number, ticket: ticket.id, staff: `${interaction.user}` };

  const result = { ok: true, decision, number, name };

  if (decision === 'accept') {
    // 1) إعادة تسمية القناة باسم المتقدّم + الترقيم
    if (cfg.onAccept.renameChannel && ticketChannel) {
      const newName = sanitizeChannelName(render(cfg.onAccept.channelNameFormat, { ...vars, name }));
      if (newName) await ticketChannel.setName(newName, `قبول تقديم إدارة #${number}`).catch(() => {});
    }

    // 2) نقل التذكرة إلى قسم تكتات الإدارة
    if (cfg.onAccept.moveToCategoryId && ticketChannel) {
      const category =
        guild.channels.cache.get(cfg.onAccept.moveToCategoryId) ?? (await guild.channels.fetch(cfg.onAccept.moveToCategoryId).catch(() => null));
      if (category) await ticketChannel.setParent(category.id, { lockPermissions: false }).catch(() => {});
    }

    // 3) إعطاء الرتب
    if (cfg.onAccept.addRoleIds.length && member) {
      for (const roleId of cfg.onAccept.addRoleIds) {
        await member.roles.add(roleId, `قبول تقديم إدارة #${number}`).catch(() => {});
      }
    }

    // 4) رسالة داخل التذكرة
    if (ticketChannel && cfg.onAccept.postInTicket) {
      await ticketChannel
        .send({
          content: cfg.onAccept.pingApplicant ? `<@${ticket.user_id}>` : undefined,
          embeds: [
            base({
              color: 0x2ecc71,
              title: '🎉 تم قبول التقديم',
              description: render(cfg.onAccept.postInTicket, vars),
              fields: [
                { name: 'القرار', value: '✅ مقبول', inline: true },
                { name: 'رقم الملف', value: `#${number}`, inline: true },
                { name: 'المسؤول', value: `${interaction.user}`, inline: true },
              ],
              footer: 'نظام تقديم الإدارة',
            }),
          ],
        })
        .catch(() => {});
    }

    // 5) رسالة خاصة للمتقدّم
    if (applicantUser && cfg.onAccept.dmApplicant) {
      /* ✅ الخاص مسموح هنا — رسالة نصية بلا إمبد */
      const dmText = [
        '🎉 تم قبول تقديمك!',
        render(cfg.acceptMessage, vars),
        `السيرفر: ${guild.name}`,
        `رقم الطلب: #${number}`,
      ].filter(Boolean).join('\n');
      result.dmSent = await dmPolicy.send(applicantUser, dmText, { kind: 'applicationAccepted', settings });
    }
  } else {
    // ❌ الرفض
    if (ticketChannel && cfg.onReject.postInTicket) {
      await ticketChannel
        .send({
          embeds: [
            base({
              color: 0xe74c3c,
              title: '❌ تم رفض التقديم',
              description: render(cfg.onReject.postInTicket, vars),
              fields: [
                { name: 'القرار', value: '❌ مرفوض', inline: true },
                { name: 'المسؤول', value: `${interaction.user}`, inline: true },
                ...(opts.reason ? [{ name: 'السبب', value: truncate(opts.reason, 1000), inline: false }] : []),
              ],
              footer: 'نظام تقديم الإدارة',
            }),
          ],
        })
        .catch(() => {});
    }

    if (applicantUser && cfg.onReject.dmApplicant) {
      /* ❌ الخاص مسموح هنا — رسالة نصية بلا إمبد */
      const dmText = [
        '😔 تم رفض تقديمك.',
        render(cfg.rejectMessage, vars),
        `السيرفر: ${guild.name}`,
        opts.reason ? `سبب الرفض: ${truncate(opts.reason, 900)}` : '',
      ].filter(Boolean).join('\n');
      result.dmSent = await dmPolicy.send(applicantUser, dmText, { kind: 'applicationRejected', settings });
    }

    // إغلاق التذكرة تلقائيًا (اختياري)
    if (cfg.onReject.closeTicket && ticketChannel) {
      const ticketsSystem = require('./tickets');
      await ticketsSystem.closeTicket(client, ticketChannel, interaction.user, { reason: 'رفض تقديم الإدارة' }).catch(() => {});
    }
  }

  // تحديث رسالة المراجعة: تعطيل الأزرار + إظهار القرار
  if (reviewMessage?.editable) {
    const embed = reviewMessage.embeds?.[0];
    const updated = embed
      ? EmbedBuilder.from(embed)
          .setColor(decision === 'accept' ? 0x2ecc71 : 0xe74c3c)
          .addFields({
            name: decision === 'accept' ? '✅ تم القبول' : '❌ تم الرفض',
            value: `بواسطة ${interaction.user} — <t:${Math.floor(Date.now() / 1000)}:R>${opts.reason ? `\n**السبب:** ${truncate(opts.reason, 200)}` : ''}`,
          })
      : null;

    await reviewMessage
      .edit({
        embeds: updated ? [updated] : [],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`apply:review:done:${ticket.id}`)
              .setLabel(decision === 'accept' ? 'مقبول' : 'مرفوض')
              .setEmoji(decision === 'accept' ? '✅' : '❌')
              .setStyle(decision === 'accept' ? ButtonStyle.Success : ButtonStyle.Danger)
              .setDisabled(true),
          ),
        ],
      })
      .catch(() => {});
  }

  // تسجيل في لوقات السيرفر
  try {
    const logging = require('./logging');
    await logging.send(client, guild, 'ticket', {
      title: decision === 'accept' ? `✅ قبول تقديم إدارة #${number}` : `❌ رفض تقديم إدارة #${number}`,
      description: `**المتقدّم:** <@${ticket.user_id}>\n**القرار بواسطة:** ${interaction.user}${opts.reason ? `\n**السبب:** ${truncate(opts.reason, 500)}` : ''}`,
      channelId: cfg.reviewChannelId || undefined,
    });
  } catch {
    /* تجاهل */
  }

  return result;
}

module.exports = {
  MAX_FIELDS,
  findReviewMessage,
  cfgOf,
  isApplicationType,
  buildFormMessage,
  buildFormModal,
  buildRejectModal,
  buildReviewPayload,
  collectAnswers,
  extractName,
  sanitizeChannelName,
  padNumber,
  fieldValueFromReview,
  sendFormMessage,
  submitApplication,
  reviewApplication,
};
