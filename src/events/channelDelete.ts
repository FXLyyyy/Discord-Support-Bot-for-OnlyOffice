import { DMChannel, GuildChannel } from 'discord.js';
import { getTicketByChannel, markTicketChannelGone, markChannelDeleted } from '../db/tickets';
import { removeTicketChannel, isTicketChannel } from '../cache';

export const name = 'channelDelete';
export const once = false;

// When a ticket channel is deleted (manually by staff, or any other reason),
// keep the DB and cache consistent: drop it from the active set and close the
// ticket if it was still open. The transcript already lives in DocSpace, and a
// reopen will recreate a fresh channel.
export async function execute(channel: DMChannel | GuildChannel): Promise<void> {
  if (channel instanceof DMChannel) return;

  // Fast path: ignore channels we never tracked as active tickets…
  const wasActive = isTicketChannel(channel.id);
  removeTicketChannel(channel.id);

  // …but a closed/archived ticket channel can be deleted too — confirm via DB.
  const ticket = await getTicketByChannel(channel.id).catch(() => null);
  if (!ticket) {
    if (wasActive) console.warn(`[channelDelete] active channel ${channel.id} had no ticket row`);
    return;
  }

  if (ticket.status !== 'closed') {
    await markTicketChannelGone(ticket.id).catch(console.error);
    console.log(`[channelDelete] ticket #${ticket.ticket_number} channel deleted — marked closed`);
  } else {
    // Already closed → just clear the dangling channel reference.
    await markChannelDeleted(ticket.id).catch(console.error);
  }
}
