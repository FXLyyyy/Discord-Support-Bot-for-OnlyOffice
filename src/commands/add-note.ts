import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { addTicketNote } from '../db/notes';
import { getServerConfig } from '../db/servers';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';
import { logToChannel } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('add-note')
  .setDescription('Add an internal staff note to this ticket (never shown to the user)')
  .addStringOption(o =>
    o.setName('note').setDescription('The internal note to record').setRequired(true).setMaxLength(1000)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await getServerConfig(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!config || !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only support staff can add internal notes.')], ephemeral: true });
    return;
  }

  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({
      embeds: [errorEmbed('This command can only be used inside an active ticket channel.')],
      ephemeral: true,
    });
    return;
  }

  const note = interaction.options.getString('note', true);

  await addTicketNote({
    ticketId: ticket.id,
    authorId: member.id,
    authorTag: member.user.tag,
    note,
  });

  await interaction.reply({
    embeds: [successEmbed('Internal note saved. It will appear in the transcript but is hidden from the user.')],
    ephemeral: true,
  });

  // Keep a record in the log channel too
  await logToChannel(
    interaction.client,
    interaction.guildId!,
    new EmbedBuilder()
      .setTitle('🗒️ Internal Note Added')
      .setColor(Colors.Orange)
      .addFields(
        { name: 'Ticket #', value: String(ticket.ticket_number), inline: true },
        { name: 'By', value: `${member}`, inline: true },
        { name: 'Note', value: note.slice(0, 1024), inline: false }
      )
      .setTimestamp()
  );
}
