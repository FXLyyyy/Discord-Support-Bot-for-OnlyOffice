import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { closeTicket } from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Close the current support ticket');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({ embeds: [errorEmbed('This is not an active ticket channel.')], ephemeral: true });
    return;
  }

  const config = await getServerConfig(interaction.guildId!);
  if (!config) {
    await interaction.reply({ embeds: [errorEmbed('Server not configured. Run /config first.')], ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  // Ticket owner or support staff can close
  if (ticket.user_id !== member.id && !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('You do not have permission to close this ticket.')], ephemeral: true });
    return;
  }

  await closeTicket(interaction, ticket, config);
}
