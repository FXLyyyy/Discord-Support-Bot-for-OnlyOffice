import { MessageFlags,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
} from 'discord.js';
import { getTicketByNumber } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { reopenTicket } from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('reopen')
  .setDescription('Reopen a closed ticket in a fresh channel')
  .addIntegerOption(o =>
    o.setName('ticket').setDescription('The ticket number to reopen').setRequired(true).setMinValue(1)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await getServerConfig(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!config || !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only support staff can reopen tickets.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const number = interaction.options.getInteger('ticket', true);
  const ticket = await getTicketByNumber(interaction.guildId!, number);

  if (!ticket) {
    await interaction.reply({ embeds: [errorEmbed(`No ticket #${number} found in this server.`)], flags: MessageFlags.Ephemeral });
    return;
  }

  if (ticket.status !== 'closed') {
    await interaction.reply({
      embeds: [errorEmbed(`Ticket #${number} is still open: <#${ticket.channel_id}>`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await reopenTicket(interaction, ticket, config);
}
