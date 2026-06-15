import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { claimTicket } from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('claim')
  .setDescription('Claim the current support ticket as your own');

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

  await claimTicket(interaction, ticket, config);
}
