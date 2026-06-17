import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember, MessageFlags } from 'discord.js';
import { getServerConfig } from '../db/servers';
import { isAdmin } from '../utils/permissions';
import { isDocSpaceConfigured } from '../utils/docspace';
import { runDatabaseBackup } from '../utils/backup';
import { errorEmbed, successEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('Run a database backup to DocSpace now (admin only)');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await getServerConfig(interaction.guildId!);
  if (!config || !isAdmin(interaction.member as GuildMember, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only administrators can run a backup.')], flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isDocSpaceConfigured()) {
    await interaction.reply({ embeds: [errorEmbed('DocSpace is not configured, so backups have nowhere to go.')], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await runDatabaseBackup();
  await interaction.editReply({
    embeds: [successEmbed('Backup attempted. Check the "Database Backups" folder in DocSpace and the bot logs for the result.')],
  });
}
