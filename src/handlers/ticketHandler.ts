import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
  GuildMember,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Collection,
  Message,
  Snowflake,
} from 'discord.js';
import { ServerConfig, Ticket, TicketMessage } from '../types';
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

type TicketInteraction = ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction;

export async function openTicket(
  interaction: ButtonInteraction,
  config: ServerConfig
): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;

  if (await hasOpenTicket(guild.id, member.id)) {
    await interaction.reply({ embeds: [errorEmbed('You already have an open ticket!')], ephemeral: true });
    return;
  }

  // Show modal — actual channel creation happens in handleTicketModal
  const modal = new ModalBuilder()
    .setCustomId('open_ticket_modal')
    .setTitle('Open a Support Ticket');

  const subjectInput = new TextInputBuilder()
    .setCustomId('ticket_subject')
    .setLabel('Subject')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. Can\'t open a document')
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('ticket_description')
    .setLabel('Describe your issue')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Please provide as much detail as possible...')
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
  );

  await interaction.showModal(modal);
}

export async function handleTicketModal(
  interaction: ModalSubmitInteraction,
  config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const subject = interaction.fields.getTextInputValue('ticket_subject');
  const description = interaction.fields.getTextInputValue('ticket_description');

  if (await hasOpenTicket(guild.id, member.id)) {
    await interaction.editReply({ embeds: [errorEmbed('You already have an open ticket!')] });
    return;
  }

  const ticketNumber = await getNextTicketNumber(guild.id);

  const permissionOverwrites: {
    id: string;
    allow?: bigint[];
    deny?: bigint[];
  }[] = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    },
  ];

  for (const roleId of config.support_role_ids) {
    permissionOverwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ManageMessages,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: config.ticket_category_id ?? undefined,
    permissionOverwrites,
    topic: `Ticket #${ticketNumber} | User: ${member.user.tag} | Status: Open`,
  });

  await createTicket({
    guildId: guild.id,
    channelId: channel.id,
    userId: member.id,
    ticketNumber,
    subject,
    description,
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

  await channel.send({
    content: `${member}`,
    embeds: [ticketWelcomeEmbed(member.user, ticketNumber, subject, description)],
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

export async function closeTicket(
  interaction: TicketInteraction,
  ticket: Ticket,
  _config: ServerConfig
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | undefined;
  let messageCount = 0;

  if (channel) {
    const allMessages: Message[] = [];
    let lastId: Snowflake | undefined;

    // eslint-disable-next-line no-constant-condition
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

    messageCount = allMessages.length;

    const transcriptMessages: TicketMessage[] = allMessages
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

  await updateTicketStatus(ticket.id, 'closed');

  await logToChannel(
    interaction.client,
    guild.id,
    ticketCloseEmbed(member.user, ticket, messageCount)
  );

  await interaction.editReply({
    embeds: [successEmbed('Ticket closed. This channel will be deleted in 5 seconds.')],
  });

  setTimeout(() => {
    channel?.delete('Ticket closed').catch(console.error);
  }, 5000);
}

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
    ?.setTopic(`Ticket #${ticket.ticket_number} | Agent: ${member.user.tag} | Status: Claimed`)
    .catch(console.error);

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
