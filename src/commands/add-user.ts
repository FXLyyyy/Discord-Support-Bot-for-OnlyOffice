import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionsBitField,
  TextChannel,
} from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { getServerConfig } from '../db/servers';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('add-user')
  .setDescription('Add a user to the current ticket channel')
  .addUserOption(o =>
    o.setName('user').setDescription('The user to add').setRequired(true)
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
    await interaction.reply({ embeds: [errorEmbed('Only support staff can add users to tickets.')], ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const channel = interaction.channel as TextChannel;

  await channel.permissionOverwrites.edit(targetUser.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  });

  await interaction.reply({
    embeds: [successEmbed(`Added ${targetUser} to the ticket.`)],
  });
}
