import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { closeTicket } from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('solved')
  .setDescription('Mark your ticket as solved — this closes it and saves a transcript');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({
      embeds: [errorEmbed('This command can only be used inside an active ticket channel.')],
      ephemeral: true,
    });
    return;
  }

  const config = await getServerConfig(interaction.guildId!);
  if (!config) {
    await interaction.reply({
      embeds: [errorEmbed('Server not configured. Ask an admin to run /config first.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  // The ticket owner or support staff can mark it solved
  if (ticket.user_id !== member.id && !isSupportMember(member, config)) {
    await interaction.reply({
      embeds: [errorEmbed('Only the ticket owner or support staff can mark this ticket as solved.')],
      ephemeral: true,
    });
    return;
  }

  await closeTicket(interaction, ticket, config);
}
