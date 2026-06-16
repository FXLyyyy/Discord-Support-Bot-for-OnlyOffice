import { supabase } from './client';
import { Ticket, TicketStatus, TicketMessage, TicketStats } from '../types';

export async function createTicket(params: {
  guildId: string;
  channelId: string;
  userId: string;
  ticketNumber: number;
  subject: string;
  description: string;
  category: string;
}): Promise<Ticket> {
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      guild_id: params.guildId,
      channel_id: params.channelId,
      user_id: params.userId,
      ticket_number: params.ticketNumber,
      subject: params.subject,
      description: params.description,
      category: params.category,
      status: 'open',
    })
    .select()
    .single();

  if (error) throw error;
  return data as Ticket;
}

export async function getTicketByChannel(channelId: string): Promise<Ticket | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('channel_id', channelId)
    .single();

  if (error) return null;
  return data as Ticket;
}

export async function getNextTicketNumber(guildId: string): Promise<number> {
  // Atomic increment via Postgres function (no race between concurrent opens)
  const { data, error } = await supabase.rpc('next_ticket_number', { g_id: guildId });
  if (!error && typeof data === 'number') return data;

  // Fallback (e.g. migration not yet applied): non-atomic max + 1
  const { data: rows } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('guild_id', guildId)
    .order('ticket_number', { ascending: false })
    .limit(1);

  if (!rows || rows.length === 0) return 1;
  return (rows[0].ticket_number as number) + 1;
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  agentId?: string,
  extra?: { closeReason?: string | null; resolution?: string | null }
): Promise<Ticket> {
  const updates: Record<string, unknown> = { status };
  if (agentId !== undefined) updates.agent_id = agentId;
  if (status === 'closed') updates.closed_at = new Date().toISOString();
  if (extra?.closeReason !== undefined) updates.close_reason = extra.closeReason;
  if (extra?.resolution !== undefined) updates.resolution = extra.resolution;

  const { data, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select()
    .single();

  if (error) throw error;
  return data as Ticket;
}

export async function getTicketByNumber(
  guildId: string,
  ticketNumber: number
): Promise<Ticket | null> {
  const { data } = await supabase
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .eq('ticket_number', ticketNumber)
    .limit(1);

  return data && data.length > 0 ? (data[0] as Ticket) : null;
}

export async function reopenTicketRecord(
  ticketId: string,
  newChannelId: string
): Promise<Ticket> {
  const { data, error } = await supabase
    .from('tickets')
    .update({
      status: 'open',
      channel_id: newChannelId,
      closed_at: null,
      close_reason: null,
      resolution: null,
      last_activity_at: new Date().toISOString(),
      inactivity_warned_at: null,
      first_response_at: null,
    })
    .eq('id', ticketId)
    .select()
    .single();

  if (error) throw error;
  return data as Ticket;
}

// Sets first_response_at only if it hasn't been set yet
export async function markFirstResponse(ticketId: string): Promise<void> {
  await supabase
    .from('tickets')
    .update({ first_response_at: new Date().toISOString() })
    .eq('id', ticketId)
    .is('first_response_at', null);
}

// Archived tickets whose channel is older than the retention window and still exists
export async function getArchivedTicketsToDelete(retentionDays: number): Promise<Ticket[]> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('tickets')
    .select('*')
    .eq('status', 'closed')
    .not('channel_id', 'is', null)
    .lt('closed_at', cutoff);

  return (data ?? []) as Ticket[];
}

// Marks a ticket's channel as physically removed (channel_id null = "cleaned up")
export async function markChannelDeleted(ticketId: string): Promise<void> {
  await supabase.from('tickets').update({ channel_id: null }).eq('id', ticketId);
}

export async function hasOpenTicket(guildId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('tickets')
    .select('id')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .in('status', ['open', 'claimed'])
    .limit(1);

  return !!(data && data.length > 0);
}

// Returns the user's current live (open or claimed) ticket, if any.
export async function getOpenTicketForUser(
  guildId: string,
  userId: string
): Promise<Ticket | null> {
  const { data } = await supabase
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .in('status', ['open', 'claimed'])
    .order('created_at', { ascending: false })
    .limit(1);

  return data && data.length > 0 ? (data[0] as Ticket) : null;
}

export async function getTicketMessages(ticketId: string): Promise<TicketMessage[]> {
  const { data, error } = await supabase
    .from('ticket_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return data as TicketMessage[];
}

export async function updateLastActivity(channelId: string): Promise<void> {
  await supabase
    .from('tickets')
    .update({ last_activity_at: new Date().toISOString(), inactivity_warned_at: null })
    .eq('channel_id', channelId)
    .in('status', ['open', 'claimed']);
}

export async function markInactivityWarned(ticketId: string): Promise<void> {
  await supabase
    .from('tickets')
    .update({ inactivity_warned_at: new Date().toISOString() })
    .eq('id', ticketId);
}

export async function saveRating(ticketId: string, rating: number): Promise<void> {
  await supabase
    .from('tickets')
    .update({ rating, rated_at: new Date().toISOString() })
    .eq('id', ticketId);
}

export async function getTicketsForInactivityCheck(): Promise<{
  toWarn: Ticket[];
  toClose: Ticket[];
}> {
  const now = new Date();
  const warn24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const close48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const { data: toClose } = await supabase
    .from('tickets')
    .select('*')
    .in('status', ['open', 'claimed'])
    .not('inactivity_warned_at', 'is', null)
    .lt('last_activity_at', close48h);

  const { data: toWarn } = await supabase
    .from('tickets')
    .select('*')
    .in('status', ['open', 'claimed'])
    .is('inactivity_warned_at', null)
    .lt('last_activity_at', warn24h);

  return {
    toClose: (toClose ?? []) as Ticket[],
    toWarn: (toWarn ?? []) as Ticket[],
  };
}

export async function getTicketStats(guildId: string): Promise<TicketStats> {
  const { count: total } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId);

  const { count: open } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .in('status', ['open', 'claimed']);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { count: closedThisMonth } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('status', 'closed')
    .gte('closed_at', monthStart.toISOString());

  const { data: closedTickets } = await supabase
    .from('tickets')
    .select('created_at, closed_at, first_response_at, agent_id, rating')
    .eq('guild_id', guildId)
    .eq('status', 'closed')
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .limit(200);

  let avgCloseHours = 0;
  let avgFirstResponseHours = 0;
  let firstResponseCount = 0;
  let avgRating = 0;
  let ratedCount = 0;
  const agentCounts: Record<string, number> = {};

  for (const t of closedTickets ?? []) {
    if (t.closed_at) {
      avgCloseHours +=
        (new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()) /
        (1000 * 60 * 60);
    }
    if (t.first_response_at) {
      avgFirstResponseHours +=
        (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) /
        (1000 * 60 * 60);
      firstResponseCount++;
    }
    if (t.agent_id) agentCounts[t.agent_id] = (agentCounts[t.agent_id] ?? 0) + 1;
    if (t.rating) { avgRating += t.rating; ratedCount++; }
  }

  const n = closedTickets?.length ?? 0;
  avgCloseHours = n > 0 ? avgCloseHours / n : 0;
  avgFirstResponseHours = firstResponseCount > 0 ? avgFirstResponseHours / firstResponseCount : 0;
  avgRating = ratedCount > 0 ? avgRating / ratedCount : 0;

  const topAgents = Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([agentId, count]) => ({ agentId, count }));

  return {
    total: total ?? 0,
    open: open ?? 0,
    closedThisMonth: closedThisMonth ?? 0,
    avgCloseHours,
    avgFirstResponseHours,
    firstResponseCount,
    avgRating,
    ratedCount,
    topAgents,
  };
}
