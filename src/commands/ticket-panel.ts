import {
  MessageFlags,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { ensureServerConfig } from '../db/servers';
import { isAdmin } from '../utils/permissions';
import { postTicketPanel, DEFAULT_PANEL_TITLE, DEFAULT_PANEL_DESCRIPTION } from '../handlers/panel';

export const data = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Send a ticket panel to the current channel (admin only)')
  .addStringOption(o =>
    o.setName('title').setDescription('Panel embed title').setRequired(false)
  )
  .addStringOption(o =>
    o.setName('description').setDescription('Panel embed description').setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ embeds: [errorEmbed('This command must be used in a server.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const config = await ensureServerConfig(interaction.guildId!);
  if (!isAdmin(interaction.member as GuildMember, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only administrators can post the panel.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const title = interaction.options.getString('title') ?? DEFAULT_PANEL_TITLE;
  const description = interaction.options.getString('description') ?? DEFAULT_PANEL_DESCRIPTION;

  await postTicketPanel(interaction.channel as TextChannel, title, description);

  await interaction.reply({ embeds: [successEmbed('Panel created!')], flags: MessageFlags.Ephemeral });
}
