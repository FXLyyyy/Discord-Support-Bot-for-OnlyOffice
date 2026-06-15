import { Message, ThreadAutoArchiveDuration } from 'discord.js';
import { ServerConfig } from '../types';

export async function createSupportThread(message: Message, config: ServerConfig): Promise<void> {
  if (!config.auto_thread_channel_ids.includes(message.channelId)) return;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return;

  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const thread = await message.startThread({
    name: `${message.author.username} | ${dateStr}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: 'Auto support thread',
  });

  await thread.send(
    `${message.author} Thank you for reaching out! A support member will be with you shortly. ` +
    `Please keep all follow-up messages in this thread.`
  );
}
