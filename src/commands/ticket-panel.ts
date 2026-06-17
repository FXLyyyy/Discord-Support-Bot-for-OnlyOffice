import {
  MessageFlags,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { ensureServerConfig } from '../db/servers';
import { postTicketPanel, DEFAULT_PANEL_TITLE, DEFAULT_PANEL_DESCRIPTION } from '../handlers/panel';

export const data = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Send a ticket panel to the current channel')
  .addStringOption(o =>
    o.setName('title').setDescription('Panel embed title').setRequired(false)
  )
  .addStringOption(o =>
    o.setName('description').setDescription('Panel embed description').setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ embeds: [errorEmbed('This command must be used in a server.')], flags: MessageFlags.Ephemeral });
    return;
  }

  await ensureServerConfig(interaction.guildId!);

  const title = interaction.options.getString('title') ?? DEFAULT_PANEL_TITLE;
  const description = interaction.options.getString('description') ?? DEFAULT_PANEL_DESCRIPTION;

  await postTicketPanel(interaction.channel as TextChannel, title, description);

  await interaction.reply({ embeds: [successEmbed('Panel created!')], flags: MessageFlags.Ephemeral });
}
