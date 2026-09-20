'use strict';

/**
 * commands/moderation/role.js
 * -------------------------------------------------------------
 * 🎭 أمر إعطاء/سحب الرتب — يشتغل بكل الطرق:
 *
 *   • العضو: **منشن** @العضو أو **آيديه** الرقمي (123456789012345678)
 *   • الرتبة: **منشن** @رتبة أو من القائمة أو **آيديه** الرقمي
 *   • السحب: خيار «إزالة» (نفس الأمر يعطي ويسحب)
 *   • أكثر من رتبة بنفس الأمر: آيديهات مفصولة بفاصلة أو مسافة
 *
 * ويشتغل كذلك مكتوبًا في الشات بلا بريفيكست (اختصارات: رول · رتبة · رتب).
 *
 * ✔ ما يسلّم على خطأ صامت: كل فشل يظهر بسببه الحقيقي
 *   (البوت ما عنده صلاحية · الرتبة أعلى من رتبة البوت · العضو أعلى من الإداري…)
 * ✔ ما يعطي الرتبة إذا البوت ما يقدر عليها أصلًا — يجيب السبب بدل ما يوعدك ويتمرمط.
 * ✔ يسجّل العملية في اللوقات (إعطاء رتبة / سحب رتبة).
 * -------------------------------------------------------------
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../lib/embeds');
const logging = require('../../systems/logging');

/** أي رقم طوله منطقي لآيدي ديسكورد */
const ID_RE = /\d{15,25}/g;

/** أسباب المنع — كل سبب وشرحه بالعربي */
const REASONS = {
  everyone: 'رتبة @everyone ما تنعطى ولا تنزالت (كل الأعضاء عندهم هي أصلًا).',
  managed: 'هذه رتبة يديرها بوت/تكامل (Integration) — ديسكورد ما يسمح بإعطائها يدويًا.',
  botPermission: 'البوت ما عنده صلاحية **إدارة الرتب** — أعطِ البوت الصلاحية ثم أعد المحاولة.',
  botHierarchy: 'رتبة البوت أقل من هذه الرتبة أو مساوية لها — ارفع رتبة البوت فوقها (ترتيب الرتب في إعدادات السيرفر).',
  userPermission: 'ما عندك صلاحية **إدارة الرتب**.',
  hierarchy: 'هذه الرتبة أعلى من رتبتك أو مساوية لها — ما تقدر تعطي/تسحب رتبة أعلى منك.',
  targetHierarchy: 'العضو المستهدف رتبته أعلى منك أو مساوية لك — ما تقدر تعدّل رتبه.',
  noMember: 'العضو مو موجود بالسيرفر — تأكد من المنشن أو الآيدي.',
  noRole: 'ما قدرت ألاقي الرتبة — حدّدها بالمنشن/القائمة أو بالآيدي الرقمي.',
  noInput: 'حدّد العضو (منشن أو آيدي) والرتبة (منشن/قائمة أو آيدي) — مثال: `رول @عضو @رتبة` أو `رول 123456789012345678 987654321098765432`.',
};

/** استخراج كل الآيديهات من نص */
function idsOf(...values) {
  const out = [];
  for (const value of values) {
    const text = String(value || '');
    if (!text) continue;
    const found = text.match(ID_RE);
    if (found) out.push(...found);
  }
  return [...new Set(out)];
}

/** فحص قدرة البوت/الإداري على هذه الرتبة تحديدًا */
function checkRole({ guild, me, executor, target, role }) {
  if (role.id === guild.id) return 'everyone';
  if (role.managed) return 'managed';

  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return 'botPermission';
  if (role.position >= (me.roles.highest?.position ?? -1)) return 'botHierarchy';

  const isOwner = guild.ownerId === executor.id;
  const isAdmin = executor.permissions?.has(PermissionFlagsBits.Administrator);
  if (!isOwner && !isAdmin) {
    if (!executor.permissions?.has(PermissionFlagsBits.ManageRoles)) return 'userPermission';
    if (role.position >= (executor.roles.highest?.position ?? -1)) return 'hierarchy';
    if (target.id !== executor.id && (target.roles.highest?.position ?? -1) >= (executor.roles.highest?.position ?? -1)) {
      return 'targetHierarchy';
    }
  }
  return null;
}

/** شرح خطأ ديسكورد لو صار (بدل ما نبلعه) */
function apiError(err) {
  const code = err?.code;
  if (code === 50013) return 'ديسكورد رفض: البوت ما عنده صلاحية كافية (تأكد أن رتبة البوت فوق الرتبة المطلوبة).';
  if (code === 50028) return 'ديسكورد رفض: المشرف المستهدف أعلى من رتبة العضو.';
  return String(err?.message || 'خطأ غير معروف من ديسكورد');
}

module.exports = {
  permissions: [PermissionFlagsBits.ManageRoles],
  botPermissions: [PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('إعطاء رتبة لعضو أو سحبها — بالمنشن أو بالآيدي')
    .addUserOption((o) => o.setName('العضو').setDescription('العضو المطلوب (منشن)').setRequired(false))
    .addRoleOption((o) => o.setName('الرتبة').setDescription('الرتبة المطلوبة (منشن أو من القائمة)').setRequired(false))
    .addStringOption((o) =>
      o
        .setName('آيدي')
        .setDescription('آيدي العضو — يشتغل بدل المنشن (مثال: 123456789012345678)')
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('آيدي-الرتبة')
        .setDescription('آيدي الرتبة — ويقبل أكثر من رتبة مفصولة بفاصلة')
        .setRequired(false),
    )
    .addBooleanOption((o) => o.setName('إزالة').setDescription('سحب الرتبة بدل إعطائها').setRequired(false))
    .addStringOption((o) => o.setName('السبب').setDescription('سبب العملية (يُسجَّل في اللوقات)').setRequired(false).setMaxLength(400)),

  async run(client, interaction, lang) {
    await interaction.deferReply();

    const guild = interaction.guild;
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    const executor = interaction.member ?? (await guild.members.fetch(interaction.user.id).catch(() => null));
    const reason = interaction.options.getString('السبب') || 'بدون سبب';
    const remove = Boolean(interaction.options.getBoolean('إزالة'));

    /* ---------- ١) نجمّع المدخلات: منشن + آيديهات (من أي حقل) ---------- */
    const picked = interaction.options.getUser('العضو');
    const pickedRole = interaction.options.getRole('الرتبة');
    const rawIds = idsOf(interaction.options.getString('آيدي'), interaction.options.getString('آيدي-الرتبة'));

    /* ---------- ٢/٣) نصنّف كل آيدي: رتبة؟ عضو؟ غير معروف؟ ----------
       (ما نفرّق من أي خيار إجى الآيدي — العضو والرتبة يشتغلوا بأي حقل، حتى لو انعكس الترتيب) */
    const roleIds = [];
    if (pickedRole?.id) roleIds.push(pickedRole.id);
    const memberCandidates = [];
    const unknownIds = [];

    for (const id of rawIds) {
      if (roleIds.includes(id)) continue;
      const known = guild.roles.cache.get(id) || (await guild.roles.fetch(id).catch(() => null));
      if (known) roleIds.push(known.id);
      else memberCandidates.push(id);
    }

    let member = picked?.id ? await guild.members.fetch(picked.id).catch(() => null) : null;
    for (const id of memberCandidates) {
      const found = await guild.members.fetch(id).catch(() => null);
      if (found) {
        if (!member) member = found;
      } else {
        unknownIds.push(id);
      }
    }

    const roles = roleIds.map((id) => guild.roles.cache.get(id)).filter(Boolean);

    /* ---------- ٤) رسائل الخطأ الواضحة ---------- */
    const lines = [];
    if (!member) lines.push(`❌ ${REASONS.noMember}`);
    if (!roles.length) lines.push(`❌ ${REASONS.noRole}`);
    if (!member && !roles.length && !rawIds.length && !pickedRole) {
      return interaction.editReply({ embeds: [embeds.error('🎭 إعطاء رتبة', REASONS.noInput)] });
    }
    if (lines.length) {
      if (unknownIds.length) lines.push(`> آيديهات ما لقيتها لا عضو ولا رتبة: \`${unknownIds.join('`, `')}\``);
      return interaction.editReply({ embeds: [embeds.error('🎭 إعطاء رتبة', lines.join('\n'))] });
    }

    /* ---------- ٥) نفحص كل رتبة وننفّذ اللي يمرّ ---------- */
    const done = [];
    const skipped = [];

    for (const role of roles) {
      const problem = checkRole({ guild, me, executor, target: member, role });
      if (problem) {
        skipped.push(`<@&${role.id}> — ${REASONS[problem]}`);
        continue;
      }

      const has = member.roles.cache.has(role.id);
      if (!remove && has) {
        skipped.push(`<@&${role.id}> — العضو عنده هي الرتبة أصلًا.`);
        continue;
      }
      if (remove && !has) {
        skipped.push(`<@&${role.id}> — العضو ما عنده هي الرتبة.`);
        continue;
      }

      try {
        await (remove
          ? member.roles.remove(role, `${remove ? 'سحب رتبة' : 'إعطاء رتبة'} بواسطة ${interaction.user.tag} — ${reason}`.slice(0, 500))
          : member.roles.add(role, `إعطاء رتبة بواسطة ${interaction.user.tag} — ${reason}`.slice(0, 500)));
        done.push(role);
      } catch (err) {
        skipped.push(`<@&${role.id}> — ${apiError(err)}`);
      }
    }

    /* ---------- ٦) سجل اللوقات ---------- */
    if (done.length) {
      await logging
        .logModAction(client, guild, {
          action: remove ? 'سحب رتبة' : 'إعطاء رتبة',
          moderator: interaction.user,
          target: member.user,
          reason: `${done.map((r) => r.name).join(' · ')}${reason && reason !== 'بدون سبب' ? ` — ${reason}` : ''}`,
        })
        .catch(() => {});
    }

    /* ---------- ٧) الرد (نصّي افتراضيًا من صفحة «ردود اوامر» + قيم للمتغيّرات) ---------- */
    const names = done.map((r) => `<@&${r.id}>`).join(' · ');
    const title = remove ? '🎭 سحب رتبة' : '🎭 إعطاء رتبة';
    const head = done.length
      ? `${remove ? '✅ انسحبت' : '✅ انعطت'} ${names} ${remove ? 'من' : 'لـ'} ${member}`
      : '⚠️ ما تغيّر أي شي';
    const detail = [
      done.length ? `**الرتب:** ${done.map((r) => `${r.name} (\`${r.id}\`)`).join(' · ')}` : null,
      `**العضو:** ${member} \`${member.id}\``,
      `**الإداري:** ${interaction.user}`,
      `**السبب:** ${reason}`,
      skipped.length ? `**ما زبط:**\n> ${skipped.join('\n> ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    interaction.__replyVars = {
      user: `${member}`,
      target: `${member}`,
      role: done.map((r) => r.name).join(' · ') || roles.map((r) => r.name).join(' · '),
      roleMention: names,
      roles: done.map((r) => `${r.name} (${r.id})`).join(' · '),
      count: String(done.length),
      action: remove ? 'سحب رتبة' : 'إعطاء رتبة',
      moderator: `${interaction.user}`,
      reason,
      notes: skipped.join(' | '),
      server: guild.name,
    };

    return interaction.editReply({
      embeds: [
        (done.length ? embeds.success : embeds.error)(title, `${head}\n${detail}`, {
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
        }),
      ],
    });
  },
};

/* للاختبارات: فحص القدرة والشرح بدون تنفيذ */
module.exports.__test = { checkRole, idsOf, apiError, REASONS };
