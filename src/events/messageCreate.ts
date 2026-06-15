import { Message } from 'discord.js';
import { getServerConfig } from '../db/servers';
import { updateLastActivity } from '../db/tickets';
import { createSupportThread } from '../handlers/threadHandler';

export const name = 'messageCreate';
export const once = false;

export async function execute(message: Message): Promise<void> {
  if (message.author.bot || !message.guildId) return;

  // Run both in parallel — they're independent
  await Promise.allSettled([
    // Auto-thread for designated channels
    getServerConfig(message.guildId).then(config => {
      if (config?.auto_thread_channel_ids.length) {
        return createSupportThread(message, config);
      }
    }),

    // Update last_activity_at if message is inside an active ticket channel
    updateLastActivity(message.channelId),
  ]);
}
