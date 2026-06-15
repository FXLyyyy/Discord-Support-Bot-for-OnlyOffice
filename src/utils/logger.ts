import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { getServerConfig } from '../db/servers';

export async function logToChannel(
  client: Client,
  guildId: string,
  embed: EmbedBuilder
): Promise<void> {
  const config = await getServerConfig(guildId);
  if (!config?.log_channel_id) {
    console.warn(`[logger] No log_channel_id configured for guild ${guildId}`);
    return;
  }

  // Try cache first, fall back to fetch (cache can be empty on fresh start)
  const channel =
    client.channels.cache.get(config.log_channel_id) ??
    await client.channels.fetch(config.log_channel_id).catch((err) => {
      console.error(`[logger] Failed to fetch log channel ${config.log_channel_id}:`, err);
      return null;
    });

  if (!channel?.isTextBased()) {
    console.warn(`[logger] Log channel ${config.log_channel_id} is not text-based or not found`);
    return;
  }

  await (channel as TextChannel).send({ embeds: [embed] }).catch((err) =>
    console.error('[logger] Failed to send log embed:', err)
  );
}
