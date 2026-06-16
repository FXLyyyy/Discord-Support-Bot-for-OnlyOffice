import { Message, GuildMember } from 'discord.js';
import { getServerConfig } from '../db/servers';
import { updateLastActivity, getTicketByChannel, markFirstResponse } from '../db/tickets';
import { isSupportMember } from '../utils/permissions';

export const name = 'messageCreate';
export const once = false;

export async function execute(message: Message): Promise<void> {
  if (message.author.bot || !message.guildId) return;

  // Ticket-channel activity tracking
  const ticket = await getTicketByChannel(message.channelId);
  if (!ticket || ticket.status === 'closed') return;

  await updateLastActivity(message.channelId).catch(console.error);

  // First-response time: stamp when a staff member first replies
  if (!ticket.first_response_at && message.member) {
    const config = await getServerConfig(message.guildId);
    if (config && isSupportMember(message.member as GuildMember, config)) {
      await markFirstResponse(ticket.id).catch(console.error);
    }
  }
}
