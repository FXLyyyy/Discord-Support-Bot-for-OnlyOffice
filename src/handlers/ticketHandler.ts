import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  PermissionsBitField,
  GuildMember,
  TextChannel,
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
  hasOpenTicket,
} from '../db/tickets';
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

  if (await hasOpenTicket(guild.id, member.id)) {
    await interaction.reply({
      embeds: [errorEmbed('You already have an open ticket!')],
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

  if (await hasOpenTicket(guild.id, member.id)) {
    await interaction.editReply({ embeds: [errorEmbed('You already have an open ticket!')] });
    return;
  }

  const ticketNumber = await getNextTicketNumber(guild.id);

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
    { id: member.id, allow: userAllow },
    { id: interaction.client.user.id, allow: botAllow },
    ...config.support_role_ids.map(roleId => ({ id: roleId, allow: staffAllow })),
  ];

  const channel = await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: config.ticket_category_id ?? undefined,
    permissionOverwrites,
    topic: `Ticket #${ticketNumber} | ${subject} | ${category} | User: ${member.user.tag} | Status: Open`,
  });

  await createTicket({
    guildId: guild.id,
    channelId: channel.id,
    userId: member.id,
    ticketNumber,
    subject,
    description,
    category,
  });

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
      .setEmoji('🔒')
  );

  const rolePings = config.support_role_ids.map(id => `<@&${id}>`).join(' ');

  // Critical ticket info lives in plain message content so it ALWAYS renders,
  // even if the bot lacks the "Embed Links" permission in this channel.
  const infoContent =
    `${member}${rolePings ? ` | ${rolePings}` : ''}\n\n` +
    `🎫 **Ticket #${ticketNumber} — ${subject}**\n` +
    `**Opened by:** ${member}\n` +
    `**Category:** ${category}\n\n` +
    `**Description:**\n>>> ${description}`;

  await channel.send({
    content: infoContent,
    embeds: [ticketWelcomeEmbed(member.user, ticketNumber, subject, description, category)],
    components: [actionRow],
    allowedMentions: { users: [member.id], roles: config.support_role_ids },
  });

  await channel.send({
    content: '📎 Need to share a file or screenshot? Upload it directly in this channel.',
  });

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
  _config: ServerConfig
): Promise<void> {
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

  const closedTicket = await updateTicketStatus(ticket.id, 'closed');

  // Fetch opener + agent in parallel
  const [openerUser, agentUser] = await Promise.all([
    interaction.client.users.fetch(ticket.user_id).catch(() => null),
    closedTicket.agent_id
      ? interaction.client.users.fetch(closedTicket.agent_id).catch(() => null)
      : Promise.resolve(null),
  ]);
  const openerTag = openerUser?.tag ?? ticket.user_id;
  const agentTag = agentUser?.tag ?? null;

  // Generate HTML transcript
  const htmlContent = generateTranscriptHtml({
    ticket: closedTicket,
    messages: transcriptMessages,
    openedByTag: openerTag,
    agentTag,
    guildName: guild.name,
  });

  const transcriptFile = new AttachmentBuilder(Buffer.from(htmlContent, 'utf-8'), {
    name: `transcript-ticket-${ticket.ticket_number}.html`,
  });

  // Post close embed + transcript to log channel
  const closeEmbed = ticketCloseEmbed(member.user, closedTicket, transcriptMessages.length);
  await logToChannel(interaction.client, guild.id, closeEmbed, transcriptFile);

  // Friendly heads-up in the channel before it disappears
  await channel?.send({
    content:
      `🔒 **This ticket has been closed by ${member}.**\n` +
      `Thanks for reaching out to OnlyOffice Support! This channel will be removed in a few seconds. 👋`,
  }).catch(console.error);

  // DM user: confirm closure + ask for a rating
  if (openerUser) {
    const ratingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...[1, 2, 3, 4, 5].map(n =>
        new ButtonBuilder()
          .setCustomId(`rate_ticket:${ticket.id}:${n}`)
          .setLabel('⭐'.repeat(n))
          .setStyle(n === 5 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );

    await openerUser
      .send({
        content:
          `🔒 Your ticket **#${ticket.ticket_number} — ${ticket.subject}** has been closed.\n\n` +
          `Thanks for contacting **OnlyOffice Support**! If you have a moment, ` +
          `we'd love to know how we did — just tap a rating below. ⭐`,
        components: [ratingRow],
      })
      .catch(() => null); // DMs may be disabled
  }

  await interaction.editReply({
    content: '✅ Ticket closed. The transcript has been saved and this channel will be deleted shortly.',
  });

  setTimeout(() => {
    channel?.delete('Ticket closed').catch(console.error);
  }, 5000);
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
