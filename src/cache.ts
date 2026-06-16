import { q } from './db/client';

// In-memory set of channel IDs that are currently active tickets.
// Lets messageCreate skip a DB hit for the vast majority of (non-ticket) messages.
const activeTicketChannels = new Set<string>();

export function isTicketChannel(channelId: string): boolean {
  return activeTicketChannels.has(channelId);
}

export function addTicketChannel(channelId: string): void {
  activeTicketChannels.add(channelId);
}

export function removeTicketChannel(channelId: string | null): void {
  if (channelId) activeTicketChannels.delete(channelId);
}

// Populate the set from the database on startup.
export async function loadActiveTicketChannels(): Promise<void> {
  const rows = await q<{ channel_id: string }>(
    `SELECT channel_id FROM tickets WHERE status IN ('open','claimed') AND channel_id IS NOT NULL`
  );
  activeTicketChannels.clear();
  for (const r of rows) activeTicketChannels.add(r.channel_id);
  console.log(`[cache] Loaded ${activeTicketChannels.size} active ticket channel(s)`);
}
