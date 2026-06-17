import { MessageFlags,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  Client,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
  GuildMember,
  TextChannel,
  CategoryChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
  Guild,
  User,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  Collection,
  Message,
  Snowflake,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { ServerConfig, Ticket, TicketMessage } from '../types';
import {
  createTicket,
  getNextTicketNumber,
  updateTicketStatus,
  getOpenTicketForUser,
  getUserPastTickets,
  reopenTicketRecord,
  getTicketByChannel,
  getTicketByNumber,
  setTranscriptUrl,
} from '../db/tickets';
import { getTicketNotes } from '../db/notes';
import { getUserNotes } from '../db/userNotes';
import { addTicketChannel, removeTicketChannel } from '../cache';
import { saveTranscript } from '../db/transcripts';
import {
  ticketWelcomeEmbed,
  ticketOpenEmbed,
  ticketCloseEmbed,
  ticketClaimEmbed,
  errorEmbed,
  successEmbed,
} from '../utils/embeds';
import { logToChannel } from '../utils/logger';
import { isSupportMember } from '../utils/permissions';
import { generateTranscriptHtml } from '../utils/transcriptHtml';
import { createTicketFolder, uploadBufferToFolder, uploadUrlToFolder } from '../utils/docspace';

// ── Shared helpers ────────────────────────────────────────────────────────────

// Builds a private ticket channel with the standard permission overwrites.
async function buildTicketChannel(
  guild: Guild,
  config: ServerConfig,
  ownerId: string,
  botId: string,
  ticketNumber: number,
  subject: string,
  ownerTag: string,
): Promise<TextChannel> {
  const userAllow = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands,
    PermissionsBitField.Flags.AddReactions,
  ]);

  const staffAllow = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.AddReactions,
  ]);

  const botAllow = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
  ]);

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: PermissionsBitField.Flags.ViewChannel },
    { id: ownerId, allow: userAllow },
    { id: botId, allow: botAllow },
    ...config.support_role_ids.map(roleId => ({ id: roleId, allow: staffAllow })),
  ];

  const channel = await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: config.ticket_category_id ?? undefined,
    permissionOverwrites,
    topic: `Ticket #${ticketNumber} | ${subject} | User: ${ownerTag} | Status: Open`,
  });

  return channel as TextChannel;
}

// Posts the intro message (info + buttons + attach hint) into a ticket channel.
async function postTicketIntro(
  channel: TextChannel,
  owner: User,
  config: ServerConfig,
  ticketNumber: number,
  subject: string,
  description: string,
  reopened = false,
): Promise<void> {
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel('Claim')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🙋'),
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
  );

  const rolePings = config.support_role_ids.map(id => `<@&${id}>`).join(' ');
  const header = reopened
    ? `🔄 **Ticket #${ticketNumber} — ${subject}** (reopened)`
    : `🎫 **Ticket #${ticketNumber} — ${subject}**`;

  const infoContent =
    `<@${owner.id}>${rolePings ? ` | ${rolePings}` : ''}\n\n` +
    `${header}\n` +
    `**Opened by:** <@${owner.id}>\n\n` +
    `**Description:**\n>>> ${description}`;

  await channel.send({
    content: infoContent,
    embeds: [ticketWelcomeEmbed(owner, ticketNumber, subject, description)],
    components: [actionRow],
    allowedMentions: { users: [owner.id], roles: config.support_role_ids },
  });

  await channel.send({
    content:
      '📋 **A few things to know:**\n' +
      '• 📎 You can attach files and screenshots directly in this channel.\n' +
      "• ⏰ If there's no activity for **24 hours**, you'll get a reminder; after **48 hours** the ticket auto-closes.\n" +
      '• 🔄 A closed ticket can be **reopened** with the button in it — no need to open a new one.\n' +
      '• 🔒 Please don\'t share passwords or other sensitive data here.',
  });
}

const ARCHIVE_CATEGORY_NAME = 'Closed Tickets';

// Finds a "Closed Tickets" category with room (< 50 children), creating one
// (or an overflow "Closed Tickets 2/3…") when needed to respect Discord limits.
async function findOrCreateArchiveCategory(guild: Guild): Promise<CategoryChannel | null> {
  const categories = guild.channels.cache.filter(
    c => c.type === ChannelType.GuildCategory && c.name.startsWith(ARCHIVE_CATEGORY_NAME)
  );

  for (const cat of categories.values()) {
    const childCount = guild.channels.cache.filter(ch => ch.parentId === cat.id).size;
    if (childCount < 50) return cat as CategoryChannel;
  }

  const n = categories.size;
  const name = n === 0 ? ARCHIVE_CATEGORY_NAME : `${ARCHIVE_CATEGORY_NAME} ${n + 1}`;
  const created = await guild.channels
    .create({ name, type: ChannelType.GuildCategory })
    .catch(() => null);
  return created ?? null;
}

// Locks a ticket channel (read-only for the opener) and moves it to the archive.
// NOTE: we deliberately do NOT rename the channel — Discord rate-limits renames
// to 2 per 10 min, which left channels stuck as "closed-N" during rapid testing.
export async function archiveTicketChannel(channel: TextChannel, guild: Guild, ticket: Ticket): Promise<void> {
  const archive = await findOrCreateArchiveCategory(guild);
  await channel.permissionOverwrites
    .edit(ticket.user_id, { SendMessages: false, ViewChannel: true, ReadMessageHistory: true })
    .catch(console.error);
  if (archive) {
    await channel.setParent(archive.id, { lockPermissions: false }).catch(console.error);
  }
}

// Restores a previously archived channel back to an active ticket channel,
// re-granting the opener full write access.
async function unarchiveTicketChannel(
  channel: TextChannel,
  config: ServerConfig,
  ticket: Ticket
): Promise<void> {
  await channel.permissionOverwrites
    .edit(ticket.user_id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
      AddReactions: true,
      UseApplicationCommands: true,
    })
    .catch(console.error);
  await channel
    .setParent(config.ticket_category_id ?? null, { lockPermissions: false })
    .catch(console.error);
}

// The Claim / Close action row shown on an active ticket.
function ticketActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🙋'),
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
  );
}

// Finds or lazily creates the private staff-only thread for a ticket channel.
// The ticket owner can't see it; support staff are added explicitly.
export async function ensureStaffThread(
  channel: TextChannel,
  config: ServerConfig,
  ticketNumber: number
): Promise<ThreadChannel | null> {
  // Reuse an existing staff thread if present
  let thread = channel.threads.cache.find(
    t => t.name.startsWith('🔒 staff') && !t.archived
  ) as ThreadChannel | undefined;

  if (!thread) {
    const active = await channel.threads.fetchActive().catch(() => null);
    thread = active?.threads.find(t => t.name.startsWith('🔒 staff')) as ThreadChannel | undefined;
  }

  if (thread) return thread;

  const created = await channel.threads
    .create({
      name: `🔒 staff-${ticketNumber}`,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    })
    .catch(err => {
      console.error('[thread] failed to create staff thread:', err);
      return null;
    });

  if (!created) return null;

  // Add all support-staff members so they can see the private thread
  const ids = new Set<string>();
  for (const roleId of config.support_role_ids) {
    channel.guild.roles.cache.get(roleId)?.members.forEach(m => ids.add(m.id));
  }
  for (const id of ids) {
    await created.members.add(id).catch(() => null);
  }

  return created as ThreadChannel;
}

type TicketInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | ModalSubmitInteraction;

// Replies (or edits) ephemerally. editReply can't carry the Ephemeral flag —
// the ephemeral-ness is fixed when the interaction is first answered.
async function ephemeralRespond(
  interaction: TicketInteraction,
  embeds: EmbedBuilder[]
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds });
  } else {
    await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
  }
}

// ── "Open Ticket" button → modal with subject + description ───────────────────

export async function openTicket(
  interaction: ButtonInteraction,
  config: ServerConfig
): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;

  const existing = await getOpenTicketForUser(guild.id, member.id);
  if (existing) {
    await interaction.reply({
      content:
        `⚠️ **You already have an open ticket.**\n` +
        `To keep things organized, each member can have only **one live ticket at a time**.\n\n` +
        `👉 Please continue in <#${existing.channel_id}> — once it's closed, you can open a new one.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('open_ticket_modal')
    .setTitle('Open a Support Ticket');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_subject')
        .setLabel('Subject — a short summary')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. Can't open my .docx file in the editor")
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_description')
        .setLabel('Describe your issue')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("e.g. Editor shows a blank screen when I open my .docx. Version 8.1, Windows 11.")
        .setRequired(true)
        .setMaxLength(1000)
    )
  );

  await interaction.showModal(modal);
}

// ── Modal submitted — create ticket channel ───────────────────────────────────

export async function handleTicketModal(
  interaction: ModalSubmitInteraction,
  config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const subject = interaction.fields.getTextInputValue('ticket_subject');
  const description = interaction.fields.getTextInputValue('ticket_description');

  const existing = await getOpenTicketForUser(guild.id, member.id);
  if (existing) {
    await interaction.editReply({
      content:
        `⚠️ **You already have an open ticket.** Each member can have only one live ticket at a time.\n` +
        `👉 Please continue in <#${existing.channel_id}>.`,
    });
    return;
  }

  const ticketNumber = await getNextTicketNumber(guild.id);

  const channel = await buildTicketChannel(
    guild, config, member.id, interaction.client.user.id, ticketNumber, subject, member.user.tag,
  );

  const newTicket = await createTicket({
    guildId: guild.id,
    channelId: channel.id,
    userId: member.id,
    ticketNumber,
    subject,
    description,
  });
  addTicketChannel(channel.id);

  await postTicketIntro(channel, member.user, config, ticketNumber, subject, description);

  // Staff briefing: persistent user notes + past tickets + their internal notes
  const [pastTickets, userNotes] = await Promise.all([
    getUserPastTickets(guild.id, member.id, newTicket.id).catch(() => []),
    getUserNotes(guild.id, member.id).catch(() => []),
  ]);

  if (pastTickets.length > 0 || userNotes.length > 0) {
    const sections: string[] = [];

    // Persistent profile notes about the user (e.g. "Uses Ubuntu")
    if (userNotes.length > 0) {
      const noteLines = userNotes.slice(0, 12).map(n => {
        const text = n.note.length > 200 ? `${n.note.slice(0, 200)}…` : n.note;
        return `> ${text} *(— ${n.author_tag})*`;
      });
      sections.push(`**📌 User notes:**\n${noteLines.join('\n')}`);
    }

    // Past tickets with their per-ticket internal notes
    if (pastTickets.length > 0) {
      const shown = pastTickets.slice(0, 8);
      const notesByTicket = await Promise.all(shown.map(t => getTicketNotes(t.id).catch(() => [])));

      const lines = shown.map((t, i) => {
        const link = t.transcript_url ? ` — [transcript](${t.transcript_url})` : '';
        const state = t.status === 'closed' ? '' : ' *(open)*';
        const badge = notesByTicket[i].length ? ` — 🗒️ **${notesByTicket[i].length}**` : '';
        return `• **#${t.ticket_number}** — "${t.subject}"${state}${link}${badge}`;
      });
      if (pastTickets.length > shown.length) lines.push(`…and ${pastTickets.length - shown.length} more`);

      const noteBlocks: string[] = [];
      shown.forEach((t, i) => {
        for (const n of notesByTicket[i]) {
          const text = n.note.length > 160 ? `${n.note.slice(0, 160)}…` : n.note;
          noteBlocks.push(`> **#${t.ticket_number}** · *${n.author_tag}*: ${text}`);
        }
      });

      let block = `**Previous tickets (${pastTickets.length}):**\n${lines.join('\n')}`;
      if (noteBlocks.length) block += `\n\n**🗒️ Internal notes from past tickets:**\n${noteBlocks.slice(0, 10).join('\n')}`;
      sections.push(block);
    }

    const thread = await ensureStaffThread(channel, config, ticketNumber);
    await thread
      ?.send({
        content: `🔁 **Returning user briefing — <@${member.id}>**\n\n${sections.join('\n\n')}`,
        // Ping support roles so the (otherwise collapsed) staff thread surfaces
        allowedMentions: { roles: config.support_role_ids },
      })
      .catch(() => null);
  }

  await interaction.editReply({
    content:
      `✅ **Your ticket is open!** Head over to ${channel}.\n` +
      `Our support team has been notified and will be with you shortly. 🙌`,
  });

  await logToChannel(
    interaction.client,
    guild.id,
    ticketOpenEmbed(member.user, ticketNumber, channel.id, subject)
  );
}

// ── Close ticket (shared by button, /close, and auto-close) ───────────────────

export async function closeTicket(
  interaction: TicketInteraction,
  ticket: Ticket,
  _config: ServerConfig,
  opts: { resolution?: string | null; reason?: string | null } = {}
): Promise<void> {
  const resolution = opts.resolution?.trim() || null;
  const reason = opts.reason?.trim() || null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;

  // Resolve channel from cache, falling back to a fetch (cache can be empty on a fresh boot)
  let channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | undefined;
  if (!channel) {
    const fetched = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    channel = (fetched as TextChannel | null) ?? undefined;
  }

  let transcriptMessages: TicketMessage[] = [];

  if (channel) {
    const allMessages: Message[] = [];
    let lastId: Snowflake | undefined;

    while (true) {
      const batch: Collection<Snowflake, Message> = await channel.messages.fetch({
        limit: 100,
        ...(lastId ? { before: lastId } : {}),
      });
      if (batch.size === 0) break;
      allMessages.push(...batch.values());
      lastId = batch.last()?.id;
      if (batch.size < 100) break;
    }

    transcriptMessages = allMessages
      .reverse()
      .filter(msg => !msg.author.bot)
      .map(msg => ({
        id: msg.id,
        ticket_id: ticket.id,
        user_id: msg.author.id,
        username: msg.author.tag,
        content: msg.content,
        attachments: msg.attachments.map(a => ({ name: a.name ?? 'file', url: a.url })),
        created_at: msg.createdAt.toISOString(),
      }));

    await saveTranscript({
      ticketId: ticket.id,
      guildId: guild.id,
      messages: transcriptMessages,
    }).catch(console.error);
  }

  const closedTicket = await updateTicketStatus(ticket.id, 'closed', undefined, {
    closeReason: reason,
    resolution,
  });
  removeTicketChannel(ticket.channel_id);

  // Fetch opener + agent + internal notes in parallel
  const [openerUser, agentUser, notes] = await Promise.all([
    interaction.client.users.fetch(ticket.user_id).catch(() => null),
    closedTicket.agent_id
      ? interaction.client.users.fetch(closedTicket.agent_id).catch(() => null)
      : Promise.resolve(null),
    getTicketNotes(ticket.id).catch(() => []),
  ]);
  const openerTag = openerUser?.tag ?? ticket.user_id;
  const agentTag = agentUser?.tag ?? null;

  // Generate HTML transcript
  const htmlContent = generateTranscriptHtml({
    ticket: closedTicket,
    messages: transcriptMessages,
    notes,
    openedByTag: openerTag,
    agentTag,
    guildName: guild.name,
  });

  // Per-ticket DocSpace folder: PDF transcript (with internals) + user attachments.
  // Canonical archive; folder link is staff-only. No-op if DocSpace isn't configured.
  let folderUrl: string | null = null;
  const folder = await createTicketFolder(`Ticket #${ticket.ticket_number} — ${openerTag}`);
  if (folder) {
    folderUrl = folder.webUrl;
    // Archive the staff HTML we already generated above (includes internal notes).
    // DocSpace stores/previews HTML directly — no PDF toolchain required.
    await uploadBufferToFolder(
      folder.folderId,
      `ticket-${ticket.ticket_number}-transcript.html`,
      Buffer.from(htmlContent, 'utf-8'),
      'text/html',
    ).catch(() => null);
    // Relay every user attachment into the same folder
    for (const m of transcriptMessages) {
      for (const a of m.attachments) {
        await uploadUrlToFolder(folder.folderId, a.url, a.name);
      }
    }
    await setTranscriptUrl(ticket.id, folderUrl).catch(console.error);
  }

  // Staff transcript (HTML, with internal notes) → log channel for a quick view
  const staffFile = new AttachmentBuilder(Buffer.from(htmlContent, 'utf-8'), {
    name: `transcript-ticket-${ticket.ticket_number}.html`,
  });
  const closeEmbed = ticketCloseEmbed(member.user, closedTicket, transcriptMessages.length);
  if (folderUrl) {
    closeEmbed.addFields({ name: '📁 Transcript folder (DocSpace)', value: `[Open in DocSpace](${folderUrl})` });
  }
  await logToChannel(interaction.client, guild.id, closeEmbed, staffFile);

  // Customer transcript — internal notes AND internal close reason stripped
  const customerHtml = generateTranscriptHtml({
    ticket: closedTicket,
    messages: transcriptMessages,
    openedByTag: openerTag,
    agentTag,
    guildName: guild.name,
    includeInternal: false,
  });
  const customerFile = new AttachmentBuilder(Buffer.from(customerHtml, 'utf-8'), {
    name: `transcript-ticket-${ticket.ticket_number}.html`,
  });

  // Archive the channel (read-only + moved to Closed Tickets) — chat is preserved
  if (channel) await archiveTicketChannel(channel, guild, ticket);

  // In-channel close notice + Reopen button (owner keeps read access)
  const reopenRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('reopen_ticket').setLabel('Reopen Ticket').setStyle(ButtonStyle.Success).setEmoji('🔄')
  );
  const channelLines = [`🔒 **This ticket has been closed by ${member}.**`];
  if (resolution) channelLines.push('', '**Resolution:**', `>>> ${resolution}`);
  channelLines.push('', 'Need more help? Reopen this ticket any time with the button below. 🔄');
  await channel?.send({
    content: channelLines.join('\n'),
    components: [reopenRow],
    allowedMentions: { parse: [] }, // resolution is free text — never auto-ping
  }).catch(console.error);

  // DM user: closure (+ resolution) + transcript (no internals) + rating
  if (openerUser) {
    const ratingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...[1, 2, 3, 4, 5].map(n =>
        new ButtonBuilder()
          .setCustomId(`rate_ticket:${ticket.id}:${n}`)
          .setLabel('⭐'.repeat(n))
          .setStyle(n === 5 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );

    const dmLines = [`🔒 Your ticket **#${ticket.ticket_number} — ${ticket.subject}** has been closed.`];
    if (resolution) dmLines.push('', '**Resolution from our team:**', `>>> ${resolution}`);
    dmLines.push(
      '',
      `A full transcript is attached for your records. Thanks for contacting **OnlyOffice Support**! ` +
      `If you have a moment, we'd love to know how we did — just tap a rating below. ⭐`
    );

    await openerUser
      .send({
        content: dmLines.join('\n'),
        files: [customerFile],
        components: [ratingRow],
      })
      .catch(() => null); // DMs may be disabled
  }

  await interaction.editReply({
    content: '✅ Ticket closed and archived. The transcript has been saved and sent to the user.',
  });
}

// ── Close modal (staff): collect a resolution + internal reason ───────────────

export async function showCloseModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId('close_ticket_modal')
    .setTitle('Close & Resolve Ticket');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('resolution')
        .setLabel('Resolution (sent to the user)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Summarize how the issue was resolved. The user will receive this.')
        .setRequired(true)
        .setMaxLength(1000)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('close_reason')
        .setLabel('Internal reason (optional, staff-only)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. resolved, duplicate, no response…')
        .setRequired(false)
        .setMaxLength(200)
    )
  );

  await interaction.showModal(modal);
}

// ── Reopen a closed ticket ────────────────────────────────────────────────────

// Core reopen: reuse the archived channel (chat preserved); if it was already
// cleaned up, build a fresh one. Returns the live channel.
async function performReopen(
  client: Client,
  guild: Guild,
  config: ServerConfig,
  ticket: Ticket
): Promise<TextChannel | null> {
  let channel: TextChannel | undefined;

  if (ticket.channel_id) {
    const fetched = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    channel = (fetched as TextChannel | null) ?? undefined;
  }

  if (channel) {
    // Archived channel still exists → unlock & restore it (full history kept)
    await unarchiveTicketChannel(channel, config, ticket);
    await reopenTicketRecord(ticket.id, channel.id);
  } else {
    // Channel was cleaned up → recreate a fresh one
    const opener = await client.users.fetch(ticket.user_id).catch(() => null);
    channel = await buildTicketChannel(
      guild, config, ticket.user_id, client.user!.id,
      ticket.ticket_number, ticket.subject, opener?.tag ?? ticket.user_id,
    );
    await reopenTicketRecord(ticket.id, channel.id);
  }
  addTicketChannel(channel.id);

  const rolePings = config.support_role_ids.map(id => `<@&${id}>`).join(' ');
  await channel
    .send({
      content:
        `🔄 **Ticket #${ticket.ticket_number} reopened.** <@${ticket.user_id}>${rolePings ? ` | ${rolePings}` : ''}\n` +
        `Welcome back — how can we help?`,
      components: [ticketActionRow()],
      allowedMentions: { users: [ticket.user_id], roles: config.support_role_ids },
    })
    .catch(console.error);

  // Re-assign to the previous agent (if any) and brief them privately
  if (ticket.agent_id) {
    await updateTicketStatus(ticket.id, 'claimed', ticket.agent_id).catch(console.error);

    const thread = await ensureStaffThread(channel, config, ticket.ticket_number);
    const link = ticket.transcript_url
      ? `\n📄 Previous transcript: ${ticket.transcript_url}`
      : '\n📄 Previous transcript: see #ticket-logs.';
    await thread
      ?.send({
        content:
          `🔄 <@${ticket.agent_id}> — ticket **#${ticket.ticket_number}** (${ticket.subject}) was reopened and is back on you.${link}`,
        allowedMentions: { users: [ticket.agent_id] },
      })
      .catch(console.error);
  }

  return channel;
}

export async function reopenTicket(
  interaction: ChatInputCommandInteraction,
  ticket: Ticket,
  config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild!;

  const channel = await performReopen(interaction.client, guild, config, ticket);

  await interaction.editReply({
    content: channel
      ? `🔄 **Ticket #${ticket.ticket_number} reopened** → ${channel}`
      : '❌ Could not reopen this ticket.',
  });

  if (channel) {
    await logToChannel(
      interaction.client,
      guild.id,
      ticketOpenEmbed(interaction.user, ticket.ticket_number, channel.id, `(reopened) ${ticket.subject}`)
    );
  }
}

// In-channel "Reopen Ticket" button (owner or staff)
export async function handleReopenButton(
  interaction: ButtonInteraction,
  config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const ticket = await getTicketByChannel(interaction.channelId);

  if (!ticket) {
    await interaction.editReply({ content: '❌ Ticket record not found for this channel.' });
    return;
  }
  if (ticket.status !== 'closed') {
    await interaction.editReply({ content: 'This ticket is already open.' });
    return;
  }
  if (ticket.user_id !== member.id && !isSupportMember(member, config)) {
    await interaction.editReply({ content: '❌ Only the ticket owner or support staff can reopen this ticket.' });
    return;
  }

  const channel = await performReopen(interaction.client, guild, config, ticket);
  await interaction.editReply({
    content: channel ? `🔄 Ticket reopened: ${channel}` : '❌ Could not reopen this ticket.',
  });

  if (channel) {
    await logToChannel(
      interaction.client,
      guild.id,
      ticketOpenEmbed(member.user, ticket.ticket_number, channel.id, `(reopened) ${ticket.subject}`)
    );
  }
}

// Panel "Reopen a ticket" button → modal asking for the ticket number
export async function showPanelReopenModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId('reopen_panel_modal')
    .setTitle('Reopen a Ticket');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_number')
        .setLabel('Your ticket number (e.g. 7)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('7')
        .setRequired(true)
        .setMaxLength(10)
    )
  );
  await interaction.showModal(modal);
}

// Handles the panel reopen modal submission (user reopening their own old ticket)
export async function handlePanelReopen(
  interaction: ModalSubmitInteraction,
  config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const raw = interaction.fields.getTextInputValue('ticket_number').replace(/[^0-9]/g, '');
  const number = parseInt(raw, 10);

  if (!number || isNaN(number)) {
    await interaction.editReply({ content: '❌ Please enter a valid ticket number.' });
    return;
  }

  const ticket = await getTicketByNumber(guild.id, number);
  if (!ticket) {
    await interaction.editReply({ content: `❌ No ticket #${number} found in this server.` });
    return;
  }

  // Only the original owner (or staff) may reopen it
  if (ticket.user_id !== member.id && !isSupportMember(member, config)) {
    await interaction.editReply({ content: '❌ You can only reopen your own tickets.' });
    return;
  }

  if (ticket.status !== 'closed') {
    await interaction.editReply({ content: `That ticket is still open: <#${ticket.channel_id}>` });
    return;
  }

  const channel = await performReopen(interaction.client, guild, config, ticket);
  await interaction.editReply({
    content: channel ? `🔄 Ticket #${number} reopened: ${channel}` : '❌ Could not reopen this ticket.',
  });

  if (channel) {
    await logToChannel(
      interaction.client,
      guild.id,
      ticketOpenEmbed(member.user, ticket.ticket_number, channel.id, `(reopened) ${ticket.subject}`)
    );
  }
}

// ── Assign ticket to a specific agent (staff/admin) ───────────────────────────

export async function assignTicket(
  interaction: ChatInputCommandInteraction,
  ticket: Ticket,
  config: ServerConfig,
  agent: User
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const updated = await updateTicketStatus(ticket.id, 'claimed', agent.id);

  let channel = interaction.guild!.channels.cache.get(ticket.channel_id) as TextChannel | undefined;
  if (!channel) {
    const fetched = await interaction.guild!.channels.fetch(ticket.channel_id).catch(() => null);
    channel = (fetched as TextChannel | null) ?? undefined;
  }

  await channel
    ?.setTopic(`Ticket #${ticket.ticket_number} | ${ticket.subject} | Agent: ${agent.tag} | Status: Claimed`)
    .catch(console.error);

  await channel
    ?.send({
      content: `📌 **${agent}** has been assigned to this ticket by ${interaction.user}. They'll be helping you out!`,
      allowedMentions: { users: [agent.id] },
    })
    .catch(console.error);

  await interaction.editReply({ embeds: [successEmbed(`Assigned this ticket to ${agent}.`)] });

  await logToChannel(interaction.client, interaction.guild!.id, ticketClaimEmbed(agent, updated));
}

// ── Claim ticket ──────────────────────────────────────────────────────────────

export async function claimTicket(
  interaction: TicketInteraction,
  ticket: Ticket,
  config: ServerConfig
): Promise<void> {
  const member = interaction.member as GuildMember;

  if (!isSupportMember(member, config)) {
    await ephemeralRespond(interaction, [errorEmbed('Only support staff can claim tickets.')]);
    return;
  }

  if (ticket.agent_id) {
    await ephemeralRespond(interaction, [errorEmbed(`This ticket is already claimed by <@${ticket.agent_id}>.`)]);
    return;
  }

  const updated = await updateTicketStatus(ticket.id, 'claimed', member.id);

  let channel = interaction.guild!.channels.cache.get(ticket.channel_id) as TextChannel | undefined;
  if (!channel) {
    const fetched = await interaction.guild!.channels.fetch(ticket.channel_id).catch(() => null);
    channel = (fetched as TextChannel | null) ?? undefined;
  }

  await channel
    ?.setTopic(
      `Ticket #${ticket.ticket_number} | ${ticket.subject} | Agent: ${member.user.tag} | Status: Claimed`
    )
    .catch(console.error);

  // Public claim notification visible to the ticket opener — plain content so it
  // always renders even without the Embed Links permission.
  await channel?.send({
    content: `🙋 **${member}** has claimed this ticket and will be assisting you. Hang tight!`,
    allowedMentions: { users: [] },
  }).catch(console.error);

  await ephemeralRespond(interaction, [successEmbed('You have claimed this ticket.')]);

  await logToChannel(
    interaction.client,
    interaction.guild!.id,
    ticketClaimEmbed(member.user, updated)
  );
}
