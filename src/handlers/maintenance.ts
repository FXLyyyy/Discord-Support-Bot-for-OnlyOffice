import { Client, Guild, GuildBasedChannel } from 'discord.js';
import {
  getDeletableClosedTickets,
  markChannelDeleted,
  getActiveTicketsWithChannel,
  markTicketChannelGone,
} from '../db/tickets';
import { removeTicketChannel } from '../cache';

// Discord caps a guild at 500 channels (categories included). We begin trimming
// the oldest CLOSED ticket channels once a guild reaches this soft cap, leaving
// ~50 channels of headroom before the hard limit. This loses nothing: every
// closed ticket's transcript lives permanently in DocSpace, and reopening a
// ticket whose channel was trimmed simply recreates a fresh channel.
export const CHANNEL_SOFT_CAP = 450;

// Trim a single guild back under the soft cap. A cheap no-op (one in-memory
// cache read) until the guild is at/over the cap.
export async function trimGuildChannels(guild: Guild): Promise<void> {
  const total = guild.channels.cache.size;
  if (total < CHANNEL_SOFT_CAP) return;

  const overflow = total - CHANNEL_SOFT_CAP + 1; // how many to remove to drop back under
  const candidates = await getDeletableClosedTickets(guild.id, overflow).catch(() => []);
  if (candidates.length === 0) {
    console.warn(`[channelcap] ${guild.name} at ${total} channels but no closed ticket channel available to trim`);
    return;
  }

  console.log(`[channelcap] ${guild.name} at ${total} channels — removing ${candidates.length} oldest closed ticket channel(s)`);
  for (const ticket of candidates) {
    if (!ticket.channel_id) continue;
    const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (channel) await channel.delete('Channel-cap cleanup — oldest closed ticket').catch(console.error);
    await markChannelDeleted(ticket.id).catch(console.error);
  }
}

// Trim every guild the bot is in. Scheduled hourly.
export async function trimAllGuilds(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await trimGuildChannels(guild).catch(err => console.error(`[channelcap] ${guild.id}:`, err));
  }
}

// Reconcile DB state with reality: any active ticket whose channel no longer
// exists (deleted manually, or while the bot was offline) is marked closed and
// dropped from the active-channel cache. The channelDelete event handles this
// in real time while the bot is up; this pass covers downtime.
export async function reconcileTicketChannels(client: Client): Promise<void> {
  const active = await getActiveTicketsWithChannel().catch(() => []);
  if (active.length === 0) return;

  let healed = 0;
  for (const ticket of active) {
    if (!ticket.channel_id) continue;
    let channel: GuildBasedChannel | null = null;
    const guild = client.guilds.cache.get(ticket.guild_id);
    if (guild) channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);

    // Only treat as gone when we can see the guild but not the channel. If the
    // guild itself is unavailable we leave the ticket alone (avoid false closes).
    if (guild && !channel) {
      await markTicketChannelGone(ticket.id).catch(console.error);
      removeTicketChannel(ticket.channel_id);
      healed++;
    }
  }
  if (healed > 0) console.log(`[reconcile] Closed ${healed} ticket(s) whose channel no longer exists`);
}
