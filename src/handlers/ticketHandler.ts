import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  Client,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  PermissionsBitField,
  GuildMember,
  TextChannel,
  CategoryChannel,
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
// StringSelectMenu* kept for the legacy openTicket fallback path
import { ServerConfig, Ticket, TicketMessage, TICKET_CATEGORIES } from '../types';
import {
  createTicket,
  getNextTicketNumber,
  updateTicketStatus,
  getOpenTicketForUser,
  reopenTicketRecord,
  getTicketByChannel,
} from '../db/tickets';
import { getTicketNotes } from '../db/notes';
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
import { uploadTranscript } from '../utils/docspace';

// ── Shared helpers ────────────────────────────────────────────────────────────

// Builds a private ticket channel with the standard permission overwrites.
async function buildTicketChannel(
  guild: Guild,
  config: ServerConfig,
  ownerId: string,
  botId: string,
  ticketNumber: number,
  subject: string,
  category: string,
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
    topic: `Ticket #${ticketNumber} | ${subject} | ${category} | User: ${ownerTag} | Status: Open`,
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
  category: string,
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
    `**Opened by:** <@${owner.id}>\n` +
    `**Category:** ${category}\n\n` +
    `**Description:**\n>>> ${description}`;

  await channel.send({
    content: infoContent,
    embeds: [ticketWelcomeEmbed(owner, ticketNumber, subject, description, category)],
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
export async function archiveTicketChannel(channel: TextChannel, guild: Guild, ticket: Ticket): Promise<void> {
  const archive = await findOrCreateArchiveCategory(guild);
  await channel.permissionOverwrites
    .edit(ticket.user_id, { SendMessages: false, ViewChannel: true, ReadMessageHistory: true })
    .catch(console.error);
  if (archive) {
    await channel.setParent(archive.id, { lockPermissions: false }).catch(console.error);
  }
  await channel.setName(`closed-${ticket.ticket_number}`).catch(console.error);
}

// Restores a previously archived channel back to an active ticket channel.
async function unarchiveTicketChannel(
  channel: TextChannel,
  config: ServerConfig,
  ticket: Ticket
): Promise<void> {
  await channel.permissionOverwrites
    .edit(ticket.user_id, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true })
    .catch(console.error);
  await channel
    .setParent(config.ticket_category_id ?? null, { lockPermissions: false })
    .catch(console.error);
  await channel.setName(`ticket-${ticket.ticket_number}`).catch(console.error);
}

// The Claim / Close action row shown on an active ticket.
function ticketActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🙋'),
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
  );
}

type TicketInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | ModalSubmitInteraction;

// ── "Open Ticket" button → modal with category + subject + description ────────

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
      ephemeral: true,
    });
    return;
  }

  const categoryHint = Object.values(TICKET_CATEGORIES).join('  ·  ');

  const modal = new ModalBuilder()
    .setCustomId('open_ticket_modal')
    .setTitle('Open a Support Ticket');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_category')
        .setLabel('Category')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(categoryHint)
        .setValue(Object.values(TICKET_CATEGORIES)[0])
        .setRequired(true)
        .setMaxLength(50)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_subject')
        .setLabel('Subject')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. Can't open a document")
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_description')
        .setLabel('Describe your issue')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Please provide as much detail as possible…')
        .setRequired(true)
        .setMaxLength(1000)
    )
  );

  await interaction.showModal(modal);
}

// ── Kept for backward compatibility (old panels still emit this) ──────────────

export async function handleCategorySelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  // Old panels with a select menu: just show the modal using the chosen category
  const categoryValue = interaction.values[0];
  const modal = new ModalBuilder()
    .setCustomId(`open_ticket_modal:${categoryValue}`)
    .setTitle('Open a Support Ticket');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_subject').setLabel('Subject')
        .setStyle(TextInputStyle.Short).setPlaceholder("e.g. Can't open a document")
        .setRequired(true).setMaxLength(100)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_description').setLabel('Describe your issue')
        .setStyle(TextInputStyle.Paragraph).setPlaceholder('Please provide as much detail as possible…')
        .setRequired(true).setMaxLength(1000)
    )
  );
  await interaction.showModal(modal);
}

// ── Step 3: Modal submitted — create ticket channel ───────────────────────────

export async function handleTicketModal(
  interaction: ModalSubmitInteraction,
  config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const subject = interaction.fields.getTextInputValue('ticket_subject');
  const description = interaction.fields.getTextInputValue('ticket_description');

  // New modal: category is a text field. Legacy modal: category is in the customId.
  let category: string;
  if (interaction.customId.includes(':')) {
    const categoryValue = interaction.customId.split(':')[1] ?? 'category_1';
    category = TICKET_CATEGORIES[categoryValue] ?? Object.values(TICKET_CATEGORIES)[0];
  } else {
    const raw = interaction.fields.getTextInputValue('ticket_category').trim();
    const match = Object.values(TICKET_CATEGORIES).find(
      label => label.toLowerCase() === raw.toLowerCase()
    );
    category = match ?? raw; // accept free text if it doesn't match a known label
  }

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
    guild, config, member.id, interaction.client.user.id, ticketNumber, subject, category, member.user.tag,
  );

  await createTicket({
    guildId: guild.id,
    channelId: channel.id,
    userId: member.id,
    ticketNumber,
    subject,
    description,
    category,
  });

  await postTicketIntro(channel, member.user, config, ticketNumber, subject, description, category);

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

  await interaction.deferReply({ ephemeral: true });

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

  // Archive the full transcript to DocSpace (canonical store). Internal link,
  // staff-only — no-op if DocSpace isn't configured yet.
  const docspace = await uploadTranscript(
    `ticket-${ticket.ticket_number}-${openerTag}.html`,
    htmlContent,
  );

  // Staff transcript (with internal notes) → log channel
  const staffFile = new AttachmentBuilder(Buffer.from(htmlContent, 'utf-8'), {
    name: `transcript-ticket-${ticket.ticket_number}.html`,
  });
  const closeEmbed = ticketCloseEmbed(member.user, closedTicket, transcriptMessages.length);
  if (docspace) {
    closeEmbed.addFields({ name: '📄 Transcript (DocSpace)', value: `[Open in DocSpace](${docspace.webUrl})` });
  }
  await logToChannel(interaction.client, guild.id, closeEmbed, staffFile);

  // Customer transcript (NO internal notes) → DM
  const customerHtml = generateTranscriptHtml({
    ticket: closedTicket,
    messages: transcriptMessages,
    notes: [], // never expose internal notes to the user
    openedByTag: openerTag,
    agentTag,
    guildName: guild.name,
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
  await channel?.send({ content: channelLines.join('\n'), components: [reopenRow] }).catch(console.error);

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
      ticket.ticket_number, ticket.subject, ticket.category, opener?.tag ?? ticket.user_id,
    );
    await reopenTicketRecord(ticket.id, channel.id);
  }

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

  return channel;
}

export async function reopenTicket(
  interaction: ChatInputCommandInteraction,
  ticket: Ticket,
  config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild!;

  // Respect the one-live-ticket limit for the original opener
  const existing = await getOpenTicketForUser(guild.id, ticket.user_id);
  if (existing && existing.id !== ticket.id) {
    await interaction.editReply({
      content:
        `⚠️ <@${ticket.user_id}> already has a live ticket (<#${existing.channel_id}>). ` +
        `Close it before reopening **#${ticket.ticket_number}**.`,
    });
    return;
  }

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
  await interaction.deferReply({ ephemeral: true });

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

  const existing = await getOpenTicketForUser(guild.id, ticket.user_id);
  if (existing && existing.id !== ticket.id) {
    await interaction.editReply({
      content: `⚠️ There is already a live ticket open: <#${existing.channel_id}>. Please continue there.`,
    });
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

// ── Claim ticket ──────────────────────────────────────────────────────────────

export async function claimTicket(
  interaction: TicketInteraction,
  ticket: Ticket,
  config: ServerConfig
): Promise<void> {
  const member = interaction.member as GuildMember;

  if (!isSupportMember(member, config)) {
    const reply = { embeds: [errorEmbed('Only support staff can claim tickets.')], ephemeral: true };
    interaction.deferred || interaction.replied
      ? await interaction.editReply(reply)
      : await interaction.reply(reply);
    return;
  }

  if (ticket.agent_id) {
    const reply = {
      embeds: [errorEmbed(`This ticket is already claimed by <@${ticket.agent_id}>.`)],
      ephemeral: true,
    };
    interaction.deferred || interaction.replied
      ? await interaction.editReply(reply)
      : await interaction.reply(reply);
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

  const reply = { embeds: [successEmbed('You have claimed this ticket.')], ephemeral: true };
  interaction.deferred || interaction.replied
    ? await interaction.editReply(reply)
    : await interaction.reply(reply);

  await logToChannel(
    interaction.client,
    interaction.guild!.id,
    ticketClaimEmbed(member.user, updated)
  );
}
