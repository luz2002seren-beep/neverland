'use strict';

const {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const logging = require('../../systems/logging');

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('logs')
      .setDescription('السجلات: قناة اللوقات واختيار الأحداث (38 حدثًا في 9 مجموعات)');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(
      sub('channel', 'تحديد قناة السجلات').addChannelOption((o) =>
        o.setName('القناة').setDescription('القناة (اتركها فارغة للمعاينة فقط)').addChannelTypes(ChannelType.GuildText).setRequired(false)),
    );
    builder.addSubcommand(sub('enable', 'تفعيل نظام السجلات'));
    builder.addSubcommand(sub('disable', 'تعطيل نظام السجلات'));
    builder.addSubcommand(sub('events', 'اختيار الأحداث المسجّلة حسب المجموعة (قوائم تفاعلية)'));
    builder.addSubcommand(sub('all', 'تفعيل كل الأحداث (38)'));
    builder.addSubcommand(sub('none', 'تعطيل كل الأحداث'));
    builder.addSubcommand(
      sub('ignore', 'استثناء قناة أو رتبة من السجلات')
        .addChannelOption((o) => o.setName('القناة').setDescription('قناة مستثناة').addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName('الرتبة').setDescription('رتبة مستثناة')),
    );
    builder.addSubcommand(
      sub('eventchannel', 'ربط حدث واحد بروم خاص فيه (مثال: الحظر لحاله · الطرد لحاله)')
        .addStringOption((o) => o.setName('الحدث').setDescription('اسم الحدث — اكتب للبحث').setRequired(true).setAutocomplete(true))
        .addChannelOption((o) =>
          o.setName('القناة').setDescription('روم هذا الحدث — اتركها فارغة لإلغاء الربط').addChannelTypes(ChannelType.GuildText).setRequired(false)),
    );
    builder.addSubcommand(
      sub('groupchannel', 'ربط مجموعة أحداث كاملة (الرسائل · الأعضاء · الرتب...) بروم واحد')
        .addStringOption((o) =>
          o.setName('المجموعة').setDescription('المجموعة').setRequired(true).addChoices(
            ...Object.entries(logging.EVENT_GROUPS).map(([value, g]) => ({ name: g.label, value })),
          ))
        .addChannelOption((o) =>
          o.setName('القناة').setDescription('روم المجموعة — اتركها فارغة لإلغاء الربط').addChannelTypes(ChannelType.GuildText).setRequired(false)),
    );
    builder.addSubcommand(sub('channels', 'عرض خريطة القنوات: أي حدث يروح لأي روم'));
    builder.addSubcommand(sub('status', 'عرض حالة السجلات والأحداث المفعّلة'));
    builder.addSubcommand(sub('test', 'إرسال رسالة تجريبية إلى قناة السجلات'));
    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();
    const settings = db.getGuildSettings(interaction.guildId);

    /* ------------------------- القناة ------------------------- */
    if (sub === 'channel') {
      const channel = interaction.options.getChannel('القناة');
      if (!channel) {
        return interaction.reply({ embeds: [embeds.info('قناة السجلات', 'لم تُحدّد قناة. استخدم `/logs status` لعرض الإعدادات.')], flags: 64 });
      }
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.reply({
          embeds: [embeds.error('صلاحيات ناقصة', `عندي صلاحيات ناقصة في ${channel}. أحتاج: عرض القناة، إرسال رسائل، إدراج روابط.`)],
          flags: 64,
        });
      }
      db.updateGuildSettings(interaction.guildId, { logs: { enabled: true, channelId: channel.id } });
      const total = Object.keys(logging.EVENT_META).length;
      return interaction.reply({
        embeds: [embeds.success('قناة السجلات', `✅ تم ضبط السجلات على ${channel} وتفعيلها.\n\n📊 الأحداث المتاحة: **${total}** — فعّلها/أطفئها بـ \`/logs events\`.`)],
        flags: 64,
      });
    }

    /* ----------------------- تفعيل/تعطيل ----------------------- */
    if (sub === 'enable' || sub === 'disable') {
      const enabled = sub === 'enable';
      if (enabled && !settings.logs.channelId) {
        return interaction.reply({ embeds: [embeds.error('لا توجد قناة', 'حدّد قناة أولًا: `/logs channel`')], flags: 64 });
      }
      db.updateGuildSettings(interaction.guildId, { logs: { enabled } });
      return interaction.reply({
        embeds: [embeds.success('السجلات', enabled ? '✅ تم تفعيل نظام السجلات.' : '🔴 تم تعطيل نظام السجلات.')],
        flags: 64,
      });
    }

    /* ----------------------- كل الأحداث ----------------------- */
    if (sub === 'all' || sub === 'none') {
      const events = {};
      for (const key of Object.keys(logging.EVENT_META)) events[key] = sub === 'all';
      db.updateGuildSettings(interaction.guildId, { logs: { events, enabled: true } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'أحداث السجلات',
            sub === 'all'
              ? `✅ تم تفعيل كل الأحداث (**${Object.keys(events).length}** حدثًا).`
              : '🔴 تم تعطيل كل الأحداث (لن تُسجَّل أي أحداث).',
          ),
        ],
        flags: 64,
      });
    }

    /* ----------------------- قائمة المجموعات ----------------------- */
    if (sub === 'events') {
      const current = settings.logs.events || {};
      const menu = new StringSelectMenuBuilder()
        .setCustomId('logs:group')
        .setPlaceholder('اختر مجموعة الأحداث التي تريد ضبطها...')
        .addOptions(
          Object.entries(logging.EVENT_GROUPS).map(([groupId, group]) => {
            const keys = Object.keys(logging.EVENT_META).filter((k) => logging.EVENT_META[k].group === groupId);
            const active = keys.filter((k) => current[k]).length;
            return {
              label: `${group.label} (${active}/${keys.length})`,
              value: groupId,
              emoji: group.emoji,
              description: `تفعيل أو تعطيل أحداث ${group.label}`,
            };
          }),
        );

      return interaction.reply({
        embeds: [
          embeds.info(
            '📜 مجموعات السجلات',
            'اختر مجموعة من القائمة لعرض أحداثها (المفعّلة بعلامة ✔️) ثم احفظ.\n\n' +
              Object.entries(logging.EVENT_GROUPS)
                .map(([gid, g]) => {
                  const keys = Object.keys(logging.EVENT_META).filter((k) => logging.EVENT_META[k].group === gid);
                  return `${g.emoji} **${g.label}** — ${keys.length} أحداث`;
                })
                .join('\n'),
          ),
        ],
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: 64,
      });
    }

    /* ----------------------- الاستثناءات ----------------------- */
    if (sub === 'ignore') {
      const channel = interaction.options.getChannel('القناة');
      const role = interaction.options.getRole('الرتبة');
      if (!channel && !role) {
        const cfg = settings.logs;
        return interaction.reply({
          embeds: [
            embeds.info('الاستثناءات', undefined, {
              fields: [
                { name: 'قنوات مستثناة', value: (cfg.ignoredChannels || []).map((c) => `<#${c}>`).join(' ') || 'لا يوجد', inline: false },
                { name: 'رتب مستثناة', value: (cfg.ignoredRoles || []).map((r) => `<@&${r}>`).join(' ') || 'لا يوجد', inline: false },
              ],
            }),
          ],
          flags: 64,
        });
      }

      const patch = {};
      if (channel) {
        const list = settings.logs.ignoredChannels || [];
        patch.ignoredChannels = list.includes(channel.id) ? list.filter((c) => c !== channel.id) : [...list, channel.id];
      }
      if (role) {
        const list = settings.logs.ignoredRoles || [];
        patch.ignoredRoles = list.includes(role.id) ? list.filter((r) => r !== role.id) : [...list, role.id];
      }
      db.updateGuildSettings(interaction.guildId, { logs: patch });
      const updated = db.getGuildSettings(interaction.guildId).logs;
      return interaction.reply({
        embeds: [
          embeds.success(
            'الاستثناءات',
            [
              `**قنوات مستثناة:** ${(updated.ignoredChannels || []).map((c) => `<#${c}>`).join(' ') || 'لا يوجد'}`,
              `**رتب مستثناة:** ${(updated.ignoredRoles || []).map((r) => `<@&${r}>`).join(' ') || 'لا يوجد'}`,
            ].join('\n'),
          ),
        ],
        flags: 64,
      });
    }

    /* --------------------------- الحالة --------------------------- */
    /* ------------------- روم خاص لكل حدث / لكل مجموعة ------------------- */
    const checkChannelPerms = (channel) => {
      const perms = channel.permissionsFor(interaction.guild.members.me);
      return Boolean(perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]));
    };

    if (sub === 'eventchannel') {
      const key = interaction.options.getString('الحدث');
      const channel = interaction.options.getChannel('القناة');

      if (!logging.EVENT_META[key]) {
        return interaction.reply({ embeds: [embeds.error('حدث غير معروف', `ما لقيت حدثًا باسم \`${key}\`. استخدم \`/logs channels\` لعرض القائمة.`)], flags: 64 });
      }
      if (channel && !checkChannelPerms(channel)) {
        return interaction.reply({
          embeds: [embeds.error('صلاحيات ناقصة', `ما عندي صلاحية كاملة في ${channel}. أحتاج: عرض القناة • إرسال رسائل • إدراج روابط.`)],
          flags: 64,
        });
      }

      const channels = { ...(settings.logs.channels || {}), [key]: channel ? channel.id : null };
      db.updateGuildSettings(interaction.guildId, { logs: { channels, enabled: true } });
      const meta = logging.EVENT_META[key];
      return interaction.reply({
        embeds: [
          embeds.success(
            channel ? 'تم ربط الحدث بروم' : 'تم إلغاء الربط',
            channel
              ? `**${meta.label}** صار يروح إلى ${channel}\n> المجموعة: ${logging.EVENT_GROUPS[meta.group].label}`
              : `**${meta.label}** رجع للقناة العامة (أو بلا تسجيل إذا ما في قناة عامة).`,
            { fields: [{ name: 'ملاحظة', value: 'كل حدث تقدر تحطه في روم لحاله — مثال: الحظر لحاله والطرد لحاله.', inline: false }] },
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'groupchannel') {
      const groupId = interaction.options.getString('المجموعة');
      const channel = interaction.options.getChannel('القناة');
      if (!logging.EVENT_GROUPS[groupId]) {
        return interaction.reply({ embeds: [embeds.error('مجموعة غير معروفة', 'اختر مجموعة من القائمة.')], flags: 64 });
      }
      if (channel && !checkChannelPerms(channel)) {
        return interaction.reply({
          embeds: [embeds.error('صلاحيات ناقصة', `ما عندي صلاحية كاملة في ${channel}. أحتاج: عرض القناة • إرسال رسائل • إدراج روابط.`)],
          flags: 64,
        });
      }
      const byGroup = { ...(settings.logs.channelsByGroup || {}), [groupId]: channel ? channel.id : null };
      db.updateGuildSettings(interaction.guildId, { logs: { channelsByGroup: byGroup, enabled: true } });

      const count = Object.keys(logging.EVENT_META).filter((k) => logging.EVENT_META[k].group === groupId).length;
      const group = logging.EVENT_GROUPS[groupId];
      return interaction.reply({
        embeds: [
          embeds.success(
            channel ? 'تم ربط المجموعة بروم' : 'تم إلغاء ربط المجموعة',
            channel
              ? `${group.label} (${count} حدثًا) صارت تروح إلى ${channel}`
              : `${group.label} رجعت للقناة العامة للأحداث اللي ما لها روم خاص.`,
            { fields: [{ name: 'أولوية التوجيه', value: 'روم الحدث الخاص ← روم المجموعة ← القناة العامة', inline: false }] },
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'channels') {
      const channels = settings.logs.channels || {};
      const byGroup = settings.logs.channelsByGroup || {};
      const fields = Object.entries(logging.EVENT_GROUPS).map(([groupId, group]) => {
        const events = Object.keys(logging.EVENT_META).filter((k) => logging.EVENT_META[k].group === groupId);
        const lines = events.map((key) => {
          const own = channels[key];
          const viaGroup = byGroup[groupId];
          const where = own ? `<#${own}>` : viaGroup ? `<#${viaGroup}> (المجموعة)` : settings.logs.channelId ? `<#${settings.logs.channelId}> (العامة)` : '— بلا روم';
          return `${own ? '📌' : '•'} ${logging.EVENT_META[key].label} ← ${where}`;
        });
        const groupLine = byGroup[groupId] ? `**روم المجموعة:** <#${byGroup[groupId]}>` : '**روم المجموعة:** —';
        return { name: `${group.emoji} ${group.label}`, value: `${groupLine}\n${lines.join('\n')}`.slice(0, 1020), inline: true };
      });

      const ownCount = Object.values(channels).filter(Boolean).length;
      return interaction.reply({
        embeds: [
          embeds.info('خريطة قنوات السجلات', undefined, {
            fields: [
              { name: 'أحداث لها روم خاص', value: `${ownCount} / ${Object.keys(logging.EVENT_META).length}`, inline: true },
              { name: 'القناة العامة', value: settings.logs.channelId ? `<#${settings.logs.channelId}>` : 'غير محدّدة (اختيارية)', inline: true },
              ...(fields.length > 9 ? fields.slice(0, 9) : fields),
            ],
            footer: 'للتعديل: /logs eventchannel — أو من لوحة التحكم',
          }),
        ],
        flags: 64,
      });
    }

    if (sub === 'status') {
      const current = settings.logs.events || {};
      const grouped = logging.groupedEvents();
      const fields = Object.entries(grouped).map(([groupId, events]) => {
        const group = logging.EVENT_GROUPS[groupId];
        const list = events
          .map((event) => `${current[event.key] ? '✅' : '❌'} ${event.label}`)
          .join('\n');
        return { name: `${group.emoji} ${group.label}`, value: list, inline: true };
      });

      const activeCount = Object.keys(logging.EVENT_META).filter((k) => current[k]).length;

      return interaction.reply({
        embeds: [
          embeds.info('📜 حالة السجلات', undefined, {
            fields: [
              { name: 'الحالة', value: settings.logs.enabled ? '🟢 مُفعّل' : '🔴 مُعطّل', inline: true },
              { name: 'القناة', value: settings.logs.channelId ? `<#${settings.logs.channelId}>` : 'غير محدّدة', inline: true },
              { name: 'الأحداث المُفعّلة', value: `${activeCount} / ${Object.keys(logging.EVENT_META).length}`, inline: true },
              ...fields,
            ],
            footer: 'استخدم /logs events لتعديل الأحداث',
          }),
        ],
        flags: 64,
      });
    }

    /* --------------------------- تجربة --------------------------- */
    if (sub === 'test') {
      await interaction.deferReply({ flags: 64 });
      const sent = await logging.send(client, interaction.guild, 'modActions', {
        title: 'رسالة تجريبية',
        description: 'هذه رسالة تجريبية للتأكد من أن قناة السجلات تعمل بشكل صحيح ✅',
        fields: [{ name: 'بواسطة', value: `${interaction.user}`, inline: true }],
      });
      return interaction.editReply({
        embeds: [
          sent
            ? embeds.success('تم', '✅ تم إرسال الرسالة التجريبية، شاهد قناة السجلات.')
            : embeds.error('فشل', '❌ ما قدرت أرسل. تأكد من تحديد القناة وتفعيل السجلات وصلاحيات البوت.'),
        ],
      });
    }
  },

  async autocomplete(client, interaction) {
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const list = Object.entries(logging.EVENT_META)
      .filter(([key, meta]) => key.toLowerCase().includes(focused) || meta.label.includes(focused) || meta.group.includes(focused))
      .slice(0, 25)
      .map(([key, meta]) => ({ name: `${meta.label} — ${logging.EVENT_GROUPS[meta.group].label}`, value: key }));
    await interaction.respond(list).catch(() => {});
  },

  /** تُستخدم من قائمة المجموعات */
  buildGroupEventsMenu(groupId, settings) {
    const current = settings.logs?.events || {};
    const events = Object.keys(logging.EVENT_META).filter((key) => logging.EVENT_META[key].group === groupId);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`logs:events:${groupId}`)
      .setPlaceholder('اختر الأحداث المطلوب تسجيلها...')
      .setMinValues(0)
      .setMaxValues(events.length)
      .addOptions(
        events.map((key) => ({
          label: logging.EVENT_META[key].label,
          value: key,
          emoji: logging.EVENT_META[key].emoji,
          default: Boolean(current[key]),
        })),
      );
    return {
      embeds: [
        embeds.info(
          `${logging.EVENT_GROUPS[groupId].emoji} أحداث: ${logging.EVENT_GROUPS[groupId].label}`,
          'الأحداث المحدّدة (✔️) هي المُفعّلة حاليًا. عدّل ثم أرسل لتُحفظ فورًا.\n> ملاحظة: إلغاء تحديد الكل يُعطّل كل أحداث هذه المجموعة.',
        ),
      ],
      components: [new ActionRowBuilder().addComponents(menu)],
    };
  },
};
