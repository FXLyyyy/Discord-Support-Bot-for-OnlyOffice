import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('remove-user')
  .setDescription('Remove a user from the current ticket channel')
  .addUserOption(o =>
    o.setName('user').setDescription('The user to remove').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({ embeds: [errorEmbed('This is not an active ticket channel.')], ephemeral: true });
    return;
  }

  const config = await getServerConfig(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!config || !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only support staff can remove users from tickets.')], ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);

  if (targetUser.id === ticket.user_id) {
    await interaction.reply({ embeds: [errorEmbed('Cannot remove the ticket owner.')], ephemeral: true });
    return;
  }

  const channel = interaction.channel as TextChannel;
  await channel.permissionOverwrites.delete(targetUser.id);

  await interaction.reply({
    embeds: [successEmbed(`Removed ${targetUser} from the ticket.`)],
  });
}
