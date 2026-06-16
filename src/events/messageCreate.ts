import { Message, GuildMember } from 'discord.js';
import { getServerConfig } from '../db/servers';
import { updateLastActivity, getTicketByChannel, markFirstResponse } from '../db/tickets';
import { createSupportThread } from '../handlers/threadHandler';
import { isSupportMember } from '../utils/permissions';

export const name = 'messageCreate';
export const once = false;

export async function execute(message: Message): Promise<void> {
  if (message.author.bot || !message.guildId) return;

  const config = await getServerConfig(message.guildId);

  // Auto-thread for designated channels
  if (config?.auto_thread_channel_ids.length) {
    await createSupportThread(message, config).catch(console.error);
  }

  // Ticket-channel activity tracking
  const ticket = await getTicketByChannel(message.channelId);
  if (!ticket || ticket.status === 'closed') return;

  await updateLastActivity(message.channelId).catch(console.error);

  // First-response time: stamp when a staff member first replies
  if (!ticket.first_response_at && config && message.member) {
    if (isSupportMember(message.member as GuildMember, config)) {
      await markFirstResponse(ticket.id).catch(console.error);
    }
  }
}
