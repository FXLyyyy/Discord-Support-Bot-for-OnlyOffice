import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { getTicketStats } from '../db/tickets';
import { errorEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show support ticket statistics for this server');

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const stats = await getTicketStats(interaction.guildId!).catch(() => null);
  if (!stats) {
    await interaction.editReply({ embeds: [errorEmbed('Failed to fetch statistics.')] });
    return;
  }

  const topAgentsField = stats.topAgents.length
    ? stats.topAgents
        .map((a, i) => `${['🥇','🥈','🥉'][i]} <@${a.agentId}> — **${a.count}** tickets`)
        .join('\n')
    : 'No data yet';

  const embed = new EmbedBuilder()
    .setTitle('📊 Support Statistics')
    .setColor(Colors.Blue)
    .addFields(
      { name: '🎫 Total Tickets',       value: String(stats.total),           inline: true },
      { name: '📬 Open / Claimed',       value: String(stats.open),            inline: true },
      { name: '📅 Closed This Month',    value: String(stats.closedThisMonth), inline: true },
      { name: '⏱️ Avg Close Time',       value: stats.avgCloseHours > 0 ? fmtHours(stats.avgCloseHours) : 'N/A', inline: true },
      { name: '⚡ Avg First Response',   value: stats.firstResponseCount > 0 ? fmtHours(stats.avgFirstResponseHours) : 'N/A', inline: true },
      { name: '⭐ Avg Rating',           value: stats.ratedCount > 0 ? `${stats.avgRating.toFixed(1)}/5 (${stats.ratedCount} rated)` : 'No ratings yet', inline: true },
      { name: '🏆 Top Agents',          value: topAgentsField,                inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
