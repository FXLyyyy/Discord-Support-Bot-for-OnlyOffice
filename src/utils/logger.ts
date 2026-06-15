import { Client, EmbedBuilder, TextChannel, AttachmentBuilder } from 'discord.js';
import { getServerConfig } from '../db/servers';

export async function logToChannel(
  client: Client,
  guildId: string,
  embed: EmbedBuilder,
  attachment?: AttachmentBuilder
): Promise<void> {
  const config = await getServerConfig(guildId);
  if (!config?.log_channel_id) {
    console.warn(`[logger] No log_channel_id configured for guild ${guildId}`);
    return;
  }

  const channel =
    client.channels.cache.get(config.log_channel_id) ??
    await client.channels.fetch(config.log_channel_id).catch((err) => {
      console.error(`[logger] Failed to fetch log channel ${config.log_channel_id}:`, err);
      return null;
    });

  if (!channel?.isTextBased()) {
    console.warn(`[logger] Log channel ${config.log_channel_id} not found or not text-based`);
    return;
  }

  const payload: Parameters<TextChannel['send']>[0] = { embeds: [embed] };
  if (attachment) payload.files = [attachment];

  await (channel as TextChannel).send(payload).catch((err) =>
    console.error('[logger] Failed to send log embed:', err)
  );
}
