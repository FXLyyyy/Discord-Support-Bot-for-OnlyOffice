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

// ── Step 1: Category button on panel → show modal immediately ─────────────────

export async function openTicketWithCategory(
  interaction: ButtonInteraction,
  config: ServerConfig,
  categoryValue: string
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

  const modal = new ModalBuilder()
    .setCustomId(`open_ticket_modal:${categoryValue}`)
    .setTitle('Open a Support Ticket');

  modal.addComponents(
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

// ── Legacy: "Open Ticket" single button → show category select ────────────────
// Kept for panels created before the 3-button layout was introduced.

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

  const select = new StringSelectMenuBuilder()
    .setCustomId('select_ticket_category')
    .setPlaceholder('Choose a category…')
    .addOptions(
      Object.entries(TICKET_CATEGORIES).map(([value, label]) =>
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(value)
      )
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Select a Category')
        .setDescription('Please choose the category that best describes your issue.')
        .setColor(Colors.Blue),
    ],
    components: [row],
    ephemeral: true,
  });
}

// ── Legacy step 2: Category selected → show modal ─────────────────────────────

export async function handleCategorySelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const categoryValue = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`open_ticket_modal:${categoryValue}`)
    .setTitle('Open a Support Ticket');

  modal.addComponents(
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

  // customId format: "open_ticket_modal:category_value"
  const categoryValue = interaction.customId.split(':')[1] ?? 'category_1';
  const category = TICKET_CATEGORIES[categoryValue] ?? 'Category 1';

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
  await channel.send({
    content: `${member}${rolePings ? ` | ${rolePings}` : ''}`,
    embeds: [ticketWelcomeEmbed(member.user, ticketNumber, subject, description, category)],
    components: [actionRow],
  });

  await interaction.editReply({
    embeds: [successEmbed(`Your ticket has been created: ${channel}`)],
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
  const channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | undefined;

  // Public status message visible to everyone in the ticket channel
  await channel?.send({
    embeds: [
      new EmbedBuilder()
        .setDescription(`🔒 **${member.user.tag}** is closing this ticket. Saving transcript…`)
        .setColor(Colors.Orange),
    ],
  }).catch(console.error);

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

  // Fetch agent tag if claimed
  let agentTag: string | null = null;
  if (closedTicket.agent_id) {
    const agentUser = await interaction.client.users
      .fetch(closedTicket.agent_id)
      .catch(() => null);
    agentTag = agentUser?.tag ?? null;
  }

  // Fetch opener tag
  const openerUser = await interaction.client.users
    .fetch(ticket.user_id)
    .catch(() => null);
  const openerTag = openerUser?.tag ?? ticket.user_id;

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

  // DM user for rating
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
        embeds: [
          new EmbedBuilder()
            .setTitle('How was your support experience?')
            .setDescription(
              `**Ticket #${ticket.ticket_number}:** ${ticket.subject}\n\n` +
              `Please rate your experience below. Your feedback helps us improve.`
            )
            .setColor(Colors.Blue),
        ],
        components: [ratingRow],
      })
      .catch(() => null); // DMs may be disabled
  }

  await interaction.editReply({
    embeds: [successEmbed('Ticket closed. This channel will be deleted in 5 seconds.')],
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

  const channel = interaction.guild!.channels.cache.get(ticket.channel_id) as TextChannel | undefined;
  await channel
    ?.setTopic(
      `Ticket #${ticket.ticket_number} | ${ticket.subject} | Agent: ${member.user.tag} | Status: Claimed`
    )
    .catch(console.error);

  // Public claim notification visible to the ticket opener
  await channel?.send({
    embeds: [
      new EmbedBuilder()
        .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
        .setDescription(`🙋 **${member.user}** has claimed this ticket and will assist you shortly.`)
        .setColor(Colors.Green)
        .setTimestamp(),
    ],
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
