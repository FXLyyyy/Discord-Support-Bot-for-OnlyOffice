import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { getServerConfig } from '../db/servers';

export async function logToChannel(
  client: Client,
  guildId: string,
  embed: EmbedBuilder
): Promise<void> {
  const config = await getServerConfig(guildId);
  if (!config?.log_channel_id) return;

  const channel = client.channels.cache.get(config.log_channel_id);
  if (!channel?.isTextBased()) return;

  await (channel as TextChannel).send({ embeds: [embed] }).catch(console.error);
}
