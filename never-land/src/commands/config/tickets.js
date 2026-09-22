'use strict';

const { SlashCommandBuilder, SlashCommandSubcommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database');
const embeds = require('../../lib/embeds');
const tickets = require('../../systems/tickets');

module.exports = {
  permissions: [PermissionFlagsBits.ManageGuild],
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('tickets')
      .setDescription('إدارة نظام التذاكر (الدعم الفني • التوثيق • الهدايا • تقديم إدارة)');

    const sub = (name, description) => new SlashCommandSubcommandBuilder().setName(name).setDescription(description);

    builder.addSubcommand(
      sub('setup', 'إعداد التذاكر: القسم، رتب الدعم، قناة السجلات')
        .addChannelOption((o) => o.setName('القسم').setDescription('قسم (Category) تُنشأ فيه التذاكر').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
        .addRoleOption((o) => o.setName('رتبة_الدعم_1').setDescription('رتبة فريق الدعم').setRequired(false))
        .addRoleOption((o) => o.setName('رتبة_الدعم_2').setDescription('رتبة دعم إضافية').setRequired(false))
        .addChannelOption((o) => o.setName('قناة_السجلات').setDescription('قناة تُرسل فيها أرشيف التذاكر').addChannelTypes(ChannelType.GuildText).setRequired(false)),
    );

    builder.addSubcommand(
      sub('panel', 'نشر لوحة التذاكر في قناة (رسالة واحدة · بلا فوتر)').addChannelOption((o) =>
        o.setName('القناة').setDescription('القناة (افتراضيًا الحالية)').addChannelTypes(ChannelType.GuildText).setRequired(false)),
    );

    builder.addSubcommand(
      sub('panelmode', 'وضع اللوحة: أزرار (Buttons) أو قائمة منسدلة (Select)').addStringOption((o) =>
        o.setName('الوضع').setDescription('اختر شكل اللوحة').setRequired(true)
          .addChoices({ name: '🔘 أزرار', value: 'buttons' }, { name: '📋 قائمة منسدلة', value: 'select' })),
    );

    builder.addSubcommand(
      sub('panelinfo', 'تعديل عنوان ووصف اللوحة')
        .addStringOption((o) => o.setName('العنوان').setDescription('عنوان اللوحة').setRequired(false).setMaxLength(200))
        .addStringOption((o) => o.setName('الوصف').setDescription('وصف اللوحة').setRequired(false).setMaxLength(1000)),
    );

    builder.addSubcommand(
      sub('applychannel', '📝 تحديد قناة مراجعة طلبات تقديم الإدارة')
        .addChannelOption((o) => o.setName('القناة').setDescription('القناة التي تُرسل فيها الطلبات').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    );

    builder.addSubcommand(
      sub('applycategory', '📁 القسم الذي تُنقل إليه تذاكر المقبولين (تكتات الإدارة)')
        .addChannelOption((o) => o.setName('القسم').setDescription('قسم تكتات الإدارة').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
    );

    builder.addSubcommand(
      sub('applyrole', '🎭 رتبة تُعطى تلقائيًا لمن يُقبل تقديمه')
        .addRoleOption((o) => o.setName('الرتبة').setDescription('رتبة الإدارة').setRequired(true))
        .addBooleanOption((o) => o.setName('إزالة').setDescription('إزالة الرتبة من قائمة القبول بدل إضافتها').setRequired(false)),
    );

    builder.addSubcommand(
      sub('applyping', '🔔 رتبة تُنبَّه عند وصول طلب تقديم جديد')
        .addRoleOption((o) => o.setName('الرتبة').setDescription('رتبة الإدارة').setRequired(true)),
    );

    builder.addSubcommand(
      sub('applytoggle', '📝 تفعيل/تعطيل استمارة تقديم الإدارة')
        .addBooleanOption((o) => o.setName('التفعيل').setDescription('true = تفعيل • false = تعطيل').setRequired(true)),
    );

    builder.addSubcommand(sub('application', '📝 عرض إعدادات استمارة تقديم الإدارة'));

    builder.addSubcommand(sub('enable', 'تفعيل نظام التذاكر'));
    builder.addSubcommand(sub('disable', 'تعطيل نظام التذاكر'));

    builder.addSubcommand(
      sub('list', 'عرض كل التذاكر (مفتوحة ومغلقة)').addStringOption((o) =>
        o.setName('الحالة').setDescription('تصفية').addChoices({ name: 'مفتوحة', value: 'open' }, { name: 'مغلقة', value: 'closed' })),
    );

    builder.addSubcommand(
      sub('addtype', 'إضافة نوع تذكرة جديد (يدعم إيموجيات خارجية)')
        .addStringOption((o) => o.setName('الآيدي').setDescription('مُعرّف بالإنجليزية مثل temp').setRequired(true).setMaxLength(20))
        .addStringOption((o) => o.setName('الاسم').setDescription('الاسم الظاهر بالعربية').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('إيموجي').setDescription('إيموجي عادي أو خارجي (عادي/متحرّك)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('وصف').setDescription('وصف قصير يظهر في اللوحة').setRequired(false).setMaxLength(100))
        .addStringOption((o) => o.setName('رسالة_داخلية').setDescription('نص تعليمات يظهر داخل التذكرة').setRequired(false).setMaxLength(500)),
    );

    builder.addSubcommand(
      sub('removetype', 'حذف نوع تذكرة').addStringOption((o) =>
        o.setName('الآيدي').setDescription('مُعرّف النوع').setRequired(true).setAutocomplete(true)),
    );

    builder.addSubcommand(sub('types', 'عرض الأنواع الحالية + خيار استرجاع الأنواع الأربعة الافتراضية')
      .addBooleanOption((o) => o.setName('الافتراضية').setDescription('استرجاع الأنواع الأربعة الافتراضية (دعم فني، توثيق، هدايا، تقديم إدارة)')));

    builder.addSubcommand(
      sub('add', 'إضافة عضو إلى التذكرة الحالية (منشن أو آيدي)')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو المطلوب').setRequired(false))
        .addStringOption((o) => o.setName('آيدي').setDescription('آيدي العضو — يشتغل حتى لو برّا السيرفر').setRequired(false)),
    );

    /* 🔔 تذكير: يشتغل داخل غرفة التذكرة فقط — يبعت رسالة خاصة نصية للعضو */
    builder.addSubcommand(
      sub('remind', '🔔 تذكير عضو بتذكرته (رسالة خاصة نصية — يعمل داخل غرفة التذكرة فقط)')
        .addUserOption((o) => o.setName('العضو').setDescription('العضو المطلوب تذكيره').setRequired(true))
        .addStringOption((o) => o.setName('الرسالة').setDescription('سطر إضافي يظهر بالرسالة').setRequired(false)),
    );

    builder.addSubcommand(
      sub('button', 'التحكم بزر داخل التذكرة: النص + الإيموجي + اللون')
        .addStringOption((o) =>
          o.setName('الزر').setDescription('أي زر تريد تعديله').setRequired(true).addChoices(
            { name: 'استلام (قبل الاستلام)', value: 'claim' },
            { name: 'مستلَمة (بعد الاستلام)', value: 'claimDone' },
            { name: 'إغلاق', value: 'close' },
            { name: 'أرشيف', value: 'transcript' },
            { name: 'إضافة عضو', value: 'addMember' },
          ))
        .addStringOption((o) => o.setName('نص').setDescription('نص الزر الظاهر (حتى 80 حرفًا)').setMaxLength(80))
        .addStringOption((o) =>
          o.setName('إيموجي').setDescription('إيموجي عادي أو خارجي (عادي/متحرّك) — اكتب «حذف» لإزالته').setMaxLength(80).setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('لون').setDescription('لون الزر').addChoices(
            { name: 'أزرق', value: 'Primary' },
            { name: 'رمادي', value: 'Secondary' },
            { name: 'أخضر', value: 'Success' },
            { name: 'أحمر', value: 'Danger' },
          ))
        .addBooleanOption((o) => o.setName('الافتراضي').setDescription('استرجاع هذا الزر لشكله الافتراضي')),
    );

    builder.addSubcommand(sub('buttons', 'عرض شكل أزرار التذكرة الحالية'));

    builder.addSubcommand(sub('stats', 'إحصائيات التذاكر'));
    return builder;
  })(),

  async run(client, interaction, lang) {
    const sub = interaction.options.getSubcommand();
    const settings = db.getGuildSettings(interaction.guildId);

    if (sub === 'setup') {
      const category = interaction.options.getChannel('القسم');
      const role1 = interaction.options.getRole('رتبة_الدعم_1');
      const role2 = interaction.options.getRole('رتبة_الدعم_2');
      const logChannel = interaction.options.getChannel('قناة_السجلات');

      const supportRoleIds = [role1?.id, role2?.id].filter(Boolean);
      db.updateGuildSettings(interaction.guildId, {
        tickets: {
          enabled: true,
          categoryId: category.id,
          ...(supportRoleIds.length ? { supportRoleIds } : {}),
          ...(logChannel ? { logChannelId: logChannel.id } : {}),
        },
      });

      return interaction.reply({
        embeds: [
          embeds.success('إعداد التذاكر', undefined, {
            fields: [
              { name: 'القسم', value: `${category}`, inline: true },
              { name: 'رتب الدعم', value: supportRoleIds.map((r) => `<@&${r}>`).join(' ') || 'لم تُحدّد (استخدم أزرار الصلاحيات)', inline: false },
              { name: 'قناة السجلات', value: logChannel ? `${logChannel}` : 'غير محدّدة', inline: false },
              { name: 'الخطوة التالية', value: 'أرسل لوحة التذاكر في قناة الدعم: `/tickets panel`', inline: false },
            ],
          }),
        ],
        flags: 64,
      });
    }

    if (sub === 'panel') {
      const channel = interaction.options.getChannel('القناة') || interaction.channel;
      if (!settings.tickets.categoryId) {
        return interaction.reply({ embeds: [embeds.error('لم يُعدّ بعد', 'استخدم `/tickets setup` أولًا لتحديد القسم.')], flags: 64 });
      }
      /* نحفظ قناة اللوحة ثم ننشر النسخة الجديدة (صورة + قائمة) ونحفظ بصمتها */
      db.updateGuildSettings(interaction.guildId, { tickets: { enabled: true, panelChannelId: channel.id } });
      const posted = await tickets.ensurePanel(client, interaction.guild, { force: true });
      if (!posted.ok) return interaction.reply({ embeds: [embeds.error('فشل', 'ما قدرت أرسل اللوحة في هذه القناة.')], flags: 64 });
      const cleaned = posted.cleaned || 0;
      return interaction.reply({
        embeds: [
          embeds.success(
            'لوحة التذاكر',
            `✅ تم إرسال اللوحة في ${channel} — صورة السيرفر + ${db.getGuildSettings(interaction.guildId).tickets.panelMode === 'select' ? 'قائمة الأنواع' : 'أزرار الأنواع'}${db.getGuildSettings(interaction.guildId).tickets.panelFooterImage ? ' + صورة زخرفية' : ''} (بلا نص).${cleaned ? `\n> ونظّفت ${cleaned} رسالة قديمة.` : ''}`,
            { fields: [{ name: 'الوضع', value: db.getGuildSettings(interaction.guildId).tickets.panelMode === 'select' ? 'قائمة منسدلة' : 'أزرار', inline: true }] },
          ),
        ],
        flags: 64,
      });
    }

    /* ----------------- 📝 استمارة تقديم الإدارة ----------------- */
    const appCfg = () => settings.staffApplication || {};

    if (sub === 'applychannel') {
      const channel = interaction.options.getChannel('القناة');
      db.updateGuildSettings(interaction.guildId, { staffApplication: { reviewChannelId: channel.id, enabled: true } });
      return interaction.reply({
        embeds: [embeds.success('قناة مراجعة طلبات الإدارة', `تم التعيين على ${channel}\nسيصل كل تقديم إدارة هنا مع زرّي ✅ قبول / ❌ رفض.`)],
        flags: 64,
      });
    }

    if (sub === 'applycategory') {
      const category = interaction.options.getChannel('القسم');
      db.updateGuildSettings(interaction.guildId, { staffApplication: { onAccept: { moveToCategoryId: category.id } } });
      return interaction.reply({
        embeds: [embeds.success('قسم تكتات الإدارة', `عند قبول أي تقديم ستُنقل تذكرته تلقائيًا إلى **${category.name}** مع تسميتها باسم المتقدّم وترقيمها.`)],
        flags: 64,
      });
    }

    if (sub === 'applyrole') {
      const role = interaction.options.getRole('الرتبة');
      const remove = interaction.options.getBoolean('إزالة') === true;
      const current = appCfg().onAccept?.addRoleIds || [];
      const next = remove ? current.filter((r) => r !== role.id) : [...new Set([...current, role.id])];
      db.updateGuildSettings(interaction.guildId, { staffApplication: { onAccept: { addRoleIds: next } } });
      return interaction.reply({
        embeds: [
          embeds.success(
            remove ? 'تمت إزالة الرتبة من قائمة القبول' : 'رتبة تُعطى عند القبول',
            next.length ? next.map((r) => `<@&${r}>`).join(' • ') : 'لا توجد رتب حاليًا.',
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'applyping') {
      const role = interaction.options.getRole('الرتبة');
      db.updateGuildSettings(interaction.guildId, { staffApplication: { pingRoleIds: [role.id] } });
      return interaction.reply({ embeds: [embeds.success('رتبة التنبيه', `سيتم تنبيه ${role} عند وصول طلب تقديم جديد.`)], flags: 64 });
    }

    if (sub === 'applytoggle') {
      const enabled = interaction.options.getBoolean('التفعيل');
      db.updateGuildSettings(interaction.guildId, { staffApplication: { enabled } });
      return interaction.reply({
        embeds: [
          enabled
            ? embeds.success('تم تفعيل استمارة التقديم 📝')
            : embeds.warning('تم تعطيل استمارة التقديم', 'لن يظهر زر النموذج في تذاكر تقديم الإدارة.'),
        ],
        flags: 64,
      });
    }

    if (sub === 'application') {
      const cfg = appCfg();
      const review = cfg.reviewChannelId || settings.tickets.logChannelId;
      const typesList = (cfg.onlyForTypes || ['staff']).map((x) => '`' + x + '`').join(' , ');
      const fieldsList = (cfg.fields || []).map((f, i) => `**${i + 1}.** ${f.label}`).join('\n');
      return interaction.reply({
        embeds: [
          embeds.info('📝 إعدادات استمارة تقديم الإدارة', 'نموذج من 5 خانات يُرسل لقناة المراجعة مع أزرار القبول والرفض.', {
            fields: [
              { name: 'الحالة', value: cfg.enabled === false ? '🔴 معطّلة' : '🟢 مفعّلة', inline: true },
              { name: 'الأنواع المفعّلة', value: typesList, inline: true },
              { name: 'قناة المراجعة', value: review ? `<#${review}>` : '❌ غير محدّدة — استخدم `/tickets applychannel`', inline: false },
              {
                name: 'قسم تكتات الإدارة',
                value: cfg.onAccept?.moveToCategoryId ? `<#${cfg.onAccept.moveToCategoryId}>` : 'لم يُحدّد — `/tickets applycategory`',
                inline: true,
              },
              {
                name: 'رتب القبول',
                value: cfg.onAccept?.addRoleIds?.length ? cfg.onAccept.addRoleIds.map((r) => `<@&${r}>`).join(' ') : 'لا شيء',
                inline: true,
              },
              { name: 'تنبيه الإدارة', value: cfg.pingRoleIds?.length ? cfg.pingRoleIds.map((r) => `<@&${r}>`).join(' ') : 'بدون تنبيه', inline: true },
              { name: 'خانات النموذج', value: fieldsList || 'الافتراضية (5 خانات)', inline: false },
              {
                name: 'شكل اسم التذكرة عند القبول',
                value: '`' + (cfg.onAccept?.channelNameFormat || 'إدارة-{number}-{name}') + '`',
                inline: false,
              },
            ],
            footer: 'عدّل النصوص والخانات من لوحة التحكم',
          }),
        ],
        flags: 64,
      });
    }

    if (sub === 'enable' || sub === 'disable') {
      if (sub === 'enable' && !settings.tickets.categoryId) {
        return interaction.reply({ embeds: [embeds.error('لم يُعدّ بعد', 'استخدم `/tickets setup` أولًا.')], flags: 64 });
      }
      db.updateGuildSettings(interaction.guildId, { tickets: { enabled: sub === 'enable' } });
      return interaction.reply({
        embeds: [embeds.success('التذاكر', sub === 'enable' ? '✅ تم التفعيل.' : '🔴 تم التعطيل.')],
        flags: 64,
      });
    }

    if (sub === 'panelmode') {
      const mode = interaction.options.getString('الوضع');
      db.updateGuildSettings(interaction.guildId, { tickets: { panelMode: mode } });
      return interaction.reply({
        embeds: [
          embeds.success(
            'وضع اللوحة',
            mode === 'select'
              ? '✅ تم اختيار **القائمة المنسدلة**.\nأعد إرسال اللوحة: `/tickets panel`'
              : '✅ تم اختيار **الأزرار** (أزرار لكل نوع، تدعم الإيموجيات الخارجية).\nأعد إرسال اللوحة: `/tickets panel`',
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'panelinfo') {
      const title = interaction.options.getString('العنوان');
      const description = interaction.options.getString('الوصف');
      const patch = {};
      if (title) patch.panelTitle = title;
      if (description) patch.panelDescription = description;
      if (!Object.keys(patch).length) {
        return interaction.reply({ embeds: [embeds.error('لا يوجد جديد', 'حدّد عنوانًا أو وصفًا للتعديل.')], flags: 64 });
      }
      db.updateGuildSettings(interaction.guildId, { tickets: patch });
      return interaction.reply({
        embeds: [embeds.success('تم التحديث', '✅ تم حفظ تعديلات اللوحة. أعد إرسالها بـ `/tickets panel`.')],
        flags: 64,
      });
    }

    if (sub === 'types') {
      const resetDefault = interaction.options.getBoolean('الافتراضية');
      if (resetDefault) {
        const defaults = require('../../config').defaults.tickets.types;
        /* الأنواع الأربعة الافتراضية (عربية) + قائمة منسدلة (select) بدل الأزرار */
        db.updateGuildSettings(interaction.guildId, { tickets: { types: defaults, panelMode: 'select', enabled: true } });
      }
      const types = db.getGuildSettings(interaction.guildId).tickets.types || [];
      return interaction.reply({
        embeds: [
          embeds.info(
            '🎫 أنواع التذاكر الحالية',
            resetDefault ? '✅ تم استرجاع الأنواع الأربعة الافتراضية.\n\n' : undefined,
            {
              fields: types.map((type) => ({
                name: `${type.emoji || '🎫'} ${type.label} (\`${type.id}\`)`,
                value: type.description || '—',
                inline: false,
              })),
              footer: `العدد: ${types.length} • الوضع: ${db.getGuildSettings(interaction.guildId).tickets.panelMode}`,
            },
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'list') {
      const status = interaction.options.getString('الحالة') || null;
      const { items, total } = db.listTickets({ guildId: interaction.guildId, status, limit: 20 });
      if (!items.length) {
        return interaction.reply({ embeds: [embeds.info('التذاكر', '📭 لا توجد تذاكر.')], flags: 64 });
      }
      const lines = items.map(
        (t) => `**#${t.id}** ${t.status === 'open' ? '🟢' : '🔴'} — <@${t.user_id}> • \`${t.type}\` • <#${t.channel_id}>\n> <t:${Math.floor(t.created_at / 1000)}:R>${t.claimed_by ? ` • استلمها <@${t.claimed_by}>` : ''}`,
      );
      return interaction.reply({
        embeds: [embeds.info(`🎫 التذاكر (${total})`, lines.join('\n').slice(0, 3800))],
        flags: 64,
      });
    }

    if (sub === 'addtype') {
      const id = interaction.options.getString('الآيدي').toLowerCase().replace(/[^a-z0-9-_]/g, '');
      const label = interaction.options.getString('الاسم');
      const emoji = interaction.options.getString('إيموجي');
      const description = interaction.options.getString('وصف');
      const intro = interaction.options.getString('رسالة_داخلية');
      const types = settings.tickets.types || [];
      if (types.some((t) => t.id === id)) {
        return interaction.reply({ embeds: [embeds.error('موجود', `النوع \`${id}\` موجود مسبقًا.`)], flags: 64 });
      }
      if (types.length >= 5 && settings.tickets.panelMode !== 'select') {
        return interaction.reply({
          embeds: [embeds.error('حد الأزرار', 'وضع الأزرار يسمح بـ 5 أنواع كحد أقصى (25 سطرًا).\nحوّل للوضع `select` بـ `/tickets panelmode` أو احذف نوعًا.')],
          flags: 64,
        });
      }
      if (types.length >= 25) {
        return interaction.reply({ embeds: [embeds.error('الحد الأقصى', 'لا يمكن إضافة أكثر من 25 نوعًا (حد ديسكورد).')], flags: 64 });
      }
      types.push({
        id,
        label,
        ...(emoji ? { emoji } : {}),
        ...(description ? { description } : {}),
        ...(intro ? { intro } : {}),
      });
      db.updateGuildSettings(interaction.guildId, { tickets: { types } });
      return interaction.reply({
        embeds: [embeds.success('نوع جديد', `✅ تمت إضافة النوع **${label}** (\`${id}\`).\n\nحدّث اللوحة بأمر \`/tickets panel\` لتظهر الأنواع الجديدة.`)],
        flags: 64,
      });
    }

    if (sub === 'removetype') {
      const id = interaction.options.getString('الآيدي');
      const types = (settings.tickets.types || []).filter((t) => t.id !== id);
      db.updateGuildSettings(interaction.guildId, { tickets: { types } });
      return interaction.reply({ embeds: [embeds.success('حذف نوع', `✅ تم حذف النوع \`${id}\`.`)], flags: 64 });
    }

    if (sub === 'add') {
      const picked = interaction.options.getUser('العضو');
      const idInput = String(interaction.options.getString('آيدي') || '').trim();
      const targetId = picked?.id || (/\d{17,20}/.exec(idInput) || [])[0] || null;
      if (!targetId) {
        return interaction.reply({ embeds: [embeds.error('❌ حدّد العضو', 'اكتب منشن العضو أو آيديه.')], flags: 64 });
      }

      const ticket = db.getTicketByChannel(interaction.channelId);
      if (!ticket) {
        return interaction.reply({ embeds: [embeds.error('ليست تذكرة', 'هذا الأمر يعمل داخل قناة تذكرة فقط.')], flags: 64 });
      }

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      const user = picked || member?.user || (await interaction.client.users.fetch(targetId).catch(() => null)) || { id: targetId, toString: () => `<@${targetId}>`, username: targetId };

      if (member) {
        const added = await interaction.channel.permissionOverwrites
          .edit(targetId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }, { reason: `إضافة بواسطة ${interaction.user.tag}` })
          .then(() => true)
          .catch(() => false);
        if (!added) {
          return interaction.reply({ embeds: [embeds.error('تعذّرت الإضافة', 'تأكد إن عندي صلاحية **إدارة الرومات/الصلاحيات**.')], flags: 64 });
        }
        await interaction.channel.send({ content: `➕ تمت إضافة ${user} إلى التذكرة بواسطة ${interaction.user}` }).catch(() => {});
        return interaction.reply({ embeds: [embeds.success('إضافة عضو', `✅ تمت إضافة ${user} إلى التذكرة.`)] });
      }

      /* برّا السيرفر: ما يمكن فتح صلاحياته — نوضّح السبب */
      return interaction.reply({
        embeds: [embeds.error('❌ هذا الشخص مو بالسيرفر', 'ما يمكن إضافته للتذكرة وهو مو موجود بالسيرفر — لازم يدخل السيرفر أولًا.')],
        flags: 64,
      });
    }

    if (sub === 'remind') {
      const target = interaction.options.getUser('العضو');
      const note = interaction.options.getString('الرسالة') || '';
      const ticket = db.getTicketByChannel(interaction.channelId);
      if (!ticket) {
        return interaction.reply({
          embeds: [embeds.error('ليست تذكرة', 'أمر **تذكير** يشتغل داخل غرفة تذكرة مفتوحة فقط.')],
          flags: 64,
        });
      }
      const result = await tickets.remind(interaction.client, {
        channel: interaction.channel,
        guild: interaction.guild,
        ticket,
        target,
        note,
        by: interaction.user,
      });
      return interaction.reply({
        embeds: [
          result.sent
            ? embeds.success('تذكير', `🔔 أُرسل تذكير لـ ${target} على الخاص (رسالة نصية بلا إمبد).`)
            : embeds.error('ما وصلت الرسالة', `${target} مغلق الخاص — ما قدرت أوصله. جرّب تذكّره بالروم.`),
        ],
      });
    }

    /* ----------------- ✍️ التحكم بأزرار التذكرة (نص + إيموجي + لون) ----------------- */
    if (sub === 'button') {
      const key = interaction.options.getString('الزر');
      const label = interaction.options.getString('نص');
      const emoji = interaction.options.getString('إيموجي');
      const style = interaction.options.getString('لون');
      const reset = interaction.options.getBoolean('الافتراضي') === true;

      if (!tickets.BUTTON_KEYS.includes(key)) {
        return interaction.reply({ embeds: [embeds.error('زر غير معروف', 'اختر زرًا من القائمة.')], flags: 64 });
      }

      const current = { ...(db.getGuildSettings(interaction.guildId).tickets.buttons || {}) };

      if (reset) {
        /* الاسترجاع = نكتب القيم الافتراضية صراحةً (الحذف وحده ما يرجّع الافتراضي مع الدمج الجزئي) */
        current[key] = { ...tickets.DEFAULT_BUTTONS[key] };
      } else {
        if (!label && !emoji && !style) {
          return interaction.reply({
            embeds: [embeds.error('لا يوجد جديد', 'حدّد نصًا أو إيموجيًا أو لونًا — أو استخدم `الافتراضي: true` للاسترجاع.')],
            flags: 64,
          });
        }
        const entry = { ...(current[key] || {}) };
        if (label) entry.label = label.trim().slice(0, 80);
        if (emoji) entry.emoji = /^(بدون|حذف|none|remove|-$)$/i.test(emoji.trim()) ? '' : emoji.trim();
        if (style) entry.style = style;
        current[key] = entry;
      }

      db.updateGuildSettings(interaction.guildId, { tickets: { buttons: current } });
      const raw = tickets.buttonRaw(db.getGuildSettings(interaction.guildId).tickets, key);
      const preview = `${raw.emoji ? `${raw.emoji} ` : ''}${raw.label}`;

      return interaction.reply({
        embeds: [
          embeds.success(
            reset ? 'تم استرجاع الزر الافتراضي' : 'تم تعديل الزر',
            `**${tickets.BUTTON_LABELS[key] || key}** صار: ${preview}`,
            {
              fields: [
                { name: 'اللون', value: { Primary: 'أزرق', Secondary: 'رمادي', Success: 'أخضر', Danger: 'أحمر' }[raw.style] || raw.style, inline: true },
                { name: 'الإيموجي', value: raw.emoji ? `${raw.emoji}${raw.emoji.includes('<') ? ' (خارجي)' : ''}` : 'بلا إيموجي', inline: true },
                { name: 'ملاحظة', value: 'التعديل يظهر في التذاكر الجديدة، وفي رسالة التذكرة الحالية عند تحديث أزرارها. كل الأزرار قابلة للتعديل من الموقع أيضًا.', inline: false },
              ],
            },
          ),
        ],
        flags: 64,
      });
    }

    if (sub === 'buttons') {
      const cfgNow = db.getGuildSettings(interaction.guildId).tickets;
      const STYLE_AR = { Primary: 'أزرق', Secondary: 'رمادي', Success: 'أخضر', Danger: 'أحمر' };
      const lines = tickets.BUTTON_KEYS.map((key) => {
        const b = tickets.buttonRaw(cfgNow, key);
        return `**${tickets.BUTTON_LABELS[key] || key}**\n> النص: ${b.label} • الإيموجي: ${b.emoji || '—'} • اللون: ${STYLE_AR[b.style] || b.style}`;
      });
      return interaction.reply({
        embeds: [embeds.info('أزرار التذكرة الحالية', lines.join('\n\n'), { footer: 'للتعديل: /tickets button — أو من لوحة التحكم' })],
        flags: 64,
      });
    }

    if (sub === 'stats') {
      const stats = db.getStats(interaction.guildId);
      const open = db.countTickets(interaction.guildId, 'open');
      const closed = db.countTickets(interaction.guildId, 'closed');
      return interaction.reply({
        embeds: [
          embeds.info('📊 إحصائيات التذاكر', undefined, {
            fields: [
              { name: 'الإجمالي', value: `**${stats.tickets}**`, inline: true },
              { name: 'مفتوحة', value: `**${open}**`, inline: true },
              { name: 'مغلقة', value: `**${closed}**`, inline: true },
              { name: 'الأنواع', value: `${(settings.tickets.types || []).length}`, inline: true },
              { name: 'رتب الدعم', value: `${(settings.tickets.supportRoleIds || []).length}`, inline: true },
            ],
          }),
        ],
        flags: 64,
      });
    }
  },

  async autocomplete(client, interaction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focusedOption = interaction.options.getFocused(true);
    const focused = String(focusedOption.value || '').toLowerCase();

    /* إيموجيات السيرفر: تدعم العادية والمتحرّكة — تُدخل بصيغة <:name:id> أو <a:name:id> */
    if (focusedOption.name === 'إيموجي') {
      const guild = client.guilds?.cache?.get(interaction.guildId);
      const list = [...(guild?.emojis?.cache?.values?.() ?? [])]
        .filter((e) => !focused || e.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((e) => ({ name: `${e.name}${e.animated ? ' — متحرّك' : ''}`, value: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` }));
      const extra = ['حذف الإيموجي'].filter(() => 'حذف'.includes(focused) || !focused).map((label) => ({ name: label, value: 'حذف' }));
      return interaction.respond([...list, ...(focused.length <= 2 ? extra : [])].slice(0, 25)).catch(() => {});
    }

    const types = db.getGuildSettings(interaction.guildId).tickets?.types || [];
    await interaction.respond(
      types.filter((t) => t.id.includes(focused) || t.label.toLowerCase().includes(focused)).map((t) => ({ name: `${t.label} (${t.id})`, value: t.id })).slice(0, 25),
    );
  },
};
