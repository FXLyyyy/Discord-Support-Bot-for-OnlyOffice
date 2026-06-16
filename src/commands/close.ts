import { MessageFlags, SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { closeTicket } from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Close the current support ticket')
  .addStringOption(o =>
    o.setName('resolution')
      .setDescription('Resolution summary sent to the user')
      .setRequired(false)
      .setMaxLength(1000)
  )
  .addStringOption(o =>
    o.setName('reason')
      .setDescription('Internal close reason (staff-only, not shown to the user)')
      .setRequired(false)
      .setMaxLength(200)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({ embeds: [errorEmbed('This is not an active ticket channel.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const config = await getServerConfig(interaction.guildId!);
  if (!config) {
    await interaction.reply({ embeds: [errorEmbed('Server not configured. Run /config first.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const member = interaction.member as GuildMember;
  // Ticket owner or support staff can close
  if (ticket.user_id !== member.id && !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('You do not have permission to close this ticket.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const resolution = interaction.options.getString('resolution');
  const reason = interaction.options.getString('reason');
  await closeTicket(interaction, ticket, config, { resolution, reason });
}
