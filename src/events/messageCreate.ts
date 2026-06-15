import { Message } from 'discord.js';
import { getServerConfig } from '../db/servers';
import { createSupportThread } from '../handlers/threadHandler';

export const name = 'messageCreate';
export const once = false;

export async function execute(message: Message): Promise<void> {
  if (message.author.bot || !message.guildId) return;

  const config = await getServerConfig(message.guildId);
  if (!config || !config.auto_thread_channel_ids.length) return;

  await createSupportThread(message, config).catch(console.error);
}
