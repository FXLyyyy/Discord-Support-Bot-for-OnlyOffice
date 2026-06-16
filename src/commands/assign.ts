import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { assignTicket } from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('assign')
  .setDescription('Assign this ticket to a specific support agent')
  .addUserOption(o =>
    o.setName('agent').setDescription('The agent to assign the ticket to').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await getServerConfig(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!config || !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only support staff can assign tickets.')], ephemeral: true });
    return;
  }

  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({ embeds: [errorEmbed('This is not an active ticket channel.')], ephemeral: true });
    return;
  }

  const agent = interaction.options.getUser('agent', true);
  if (agent.bot) {
    await interaction.reply({ embeds: [errorEmbed('You cannot assign a ticket to a bot.')], ephemeral: true });
    return;
  }

  await assignTicket(interaction, ticket, config, agent);
}
