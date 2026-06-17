import { q, one } from './client';
import { Ticket, TicketStatus, TicketStats } from '../types';

export async function createTicket(params: {
  guildId: string;
  channelId: string;
  userId: string;
  ticketNumber: number;
  subject: string;
  description: string;
}): Promise<Ticket> {
  return (await one<Ticket>(
    `INSERT INTO tickets (guild_id, channel_id, user_id, ticket_number, subject, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING *`,
    [params.guildId, params.channelId, params.userId, params.ticketNumber, params.subject, params.description]
  ))!;
}

export async function getTicketByChannel(channelId: string): Promise<Ticket | null> {
  return one<Ticket>('SELECT * FROM tickets WHERE channel_id = $1', [channelId]);
}

export async function getTicketById(ticketId: string): Promise<Ticket | null> {
  return one<Ticket>('SELECT * FROM tickets WHERE id = $1', [ticketId]);
}

export async function getTicketByNumber(guildId: string, ticketNumber: number): Promise<Ticket | null> {
  return one<Ticket>('SELECT * FROM tickets WHERE guild_id = $1 AND ticket_number = $2', [guildId, ticketNumber]);
}

export async function getNextTicketNumber(guildId: string): Promise<number> {
  try {
    const row = await one<{ n: number }>('SELECT next_ticket_number($1) AS n', [guildId]);
    if (row && typeof row.n === 'number') return row.n;
  } catch (err) {
    console.error('[tickets] next_ticket_number failed, falling back:', err);
  }
  const row = await one<{ n: number }>(
    'SELECT COALESCE(MAX(ticket_number), 0) + 1 AS n FROM tickets WHERE guild_id = $1',
    [guildId]
  );
  return row?.n ?? 1;
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  agentId?: string,
  extra?: { closeReason?: string | null; resolution?: string | null }
): Promise<Ticket> {
  const sets = ['status = $2'];
  const params: unknown[] = [ticketId, status];
  let pos = 3;

  if (agentId !== undefined) { sets.push(`agent_id = $${pos++}`); params.push(agentId); }
  if (status === 'closed') sets.push('closed_at = NOW()');
  if (extra?.closeReason !== undefined) { sets.push(`close_reason = $${pos++}`); params.push(extra.closeReason); }
  if (extra?.resolution !== undefined) { sets.push(`resolution = $${pos++}`); params.push(extra.resolution); }

  return (await one<Ticket>(
    `UPDATE tickets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  ))!;
}

export async function reopenTicketRecord(ticketId: string, newChannelId: string): Promise<Ticket> {
  return (await one<Ticket>(
    `UPDATE tickets
       SET status = 'open', channel_id = $2, closed_at = NULL, close_reason = NULL,
           resolution = NULL, last_activity_at = NOW(), inactivity_warned_at = NULL, first_response_at = NULL
     WHERE id = $1 RETURNING *`,
    [ticketId, newChannelId]
  ))!;
}

export async function getOpenTicketForUser(guildId: string, userId: string): Promise<Ticket | null> {
  return one<Ticket>(
    `SELECT * FROM tickets WHERE guild_id = $1 AND user_id = $2 AND status IN ('open','claimed')
     ORDER BY created_at DESC LIMIT 1`,
    [guildId, userId]
  );
}

export async function getUserPastTickets(
  guildId: string,
  userId: string,
  excludeTicketId?: string
): Promise<Ticket[]> {
  if (excludeTicketId) {
    return q<Ticket>(
      `SELECT * FROM tickets WHERE guild_id = $1 AND user_id = $2 AND id <> $3 ORDER BY ticket_number DESC`,
      [guildId, userId, excludeTicketId]
    );
  }
  return q<Ticket>(
    `SELECT * FROM tickets WHERE guild_id = $1 AND user_id = $2 ORDER BY ticket_number DESC`,
    [guildId, userId]
  );
}

export async function updateLastActivity(channelId: string): Promise<void> {
  await q(
    `UPDATE tickets SET last_activity_at = NOW(), inactivity_warned_at = NULL
     WHERE channel_id = $1 AND status IN ('open','claimed')`,
    [channelId]
  );
}

export async function markInactivityWarned(ticketId: string): Promise<void> {
  await q('UPDATE tickets SET inactivity_warned_at = NOW() WHERE id = $1', [ticketId]);
}

export async function saveRating(ticketId: string, rating: number, ratedByUserId?: string): Promise<void> {
  await q('UPDATE tickets SET rating = $2, rated_at = NOW() WHERE id = $1', [ticketId, rating]);

  const t = await one<{ guild_id: string; ticket_number: number; user_id: string }>(
    'SELECT guild_id, ticket_number, user_id FROM tickets WHERE id = $1',
    [ticketId]
  );
  if (t) {
    await q(
      `INSERT INTO ticket_ratings (ticket_id, guild_id, ticket_number, rated_by, rating)
       VALUES ($1, $2, $3, $4, $5)`,
      [ticketId, t.guild_id, t.ticket_number, ratedByUserId ?? t.user_id, rating]
    );
  }
}

export async function setTranscriptUrl(ticketId: string, url: string): Promise<void> {
  await q('UPDATE tickets SET transcript_url = $2 WHERE id = $1', [ticketId, url]);
}

export async function markFirstResponse(ticketId: string): Promise<void> {
  await q('UPDATE tickets SET first_response_at = NOW() WHERE id = $1 AND first_response_at IS NULL', [ticketId]);
}

export async function getArchivedTicketsToDelete(retentionDays: number): Promise<Ticket[]> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return q<Ticket>(
    `SELECT * FROM tickets WHERE status = 'closed' AND channel_id IS NOT NULL AND closed_at < $1`,
    [cutoff]
  );
}

export async function markChannelDeleted(ticketId: string): Promise<void> {
  await q('UPDATE tickets SET channel_id = NULL WHERE id = $1', [ticketId]);
}

export async function getTicketsForInactivityCheck(): Promise<{ toWarn: Ticket[]; toClose: Ticket[] }> {
  const warn24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const close48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const toClose = await q<Ticket>(
    `SELECT * FROM tickets WHERE status IN ('open','claimed')
       AND inactivity_warned_at IS NOT NULL AND last_activity_at < $1`,
    [close48h]
  );
  const toWarn = await q<Ticket>(
    `SELECT * FROM tickets WHERE status IN ('open','claimed')
       AND inactivity_warned_at IS NULL AND last_activity_at < $1`,
    [warn24h]
  );
  return { toWarn, toClose };
}

export async function getTicketStats(guildId: string): Promise<TicketStats> {
  const total = (await one<{ c: number }>('SELECT COUNT(*)::int AS c FROM tickets WHERE guild_id = $1', [guildId]))?.c ?? 0;
  const open = (await one<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM tickets WHERE guild_id = $1 AND status IN ('open','claimed')`, [guildId]
  ))?.c ?? 0;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const closedThisMonth = (await one<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM tickets WHERE guild_id = $1 AND status = 'closed' AND closed_at >= $2`,
    [guildId, monthStart.toISOString()]
  ))?.c ?? 0;

  const closedTickets = await q<{
    created_at: string; closed_at: string | null; first_response_at: string | null;
    agent_id: string | null; rating: number | null;
  }>(
    `SELECT created_at, closed_at, first_response_at, agent_id, rating FROM tickets
       WHERE guild_id = $1 AND status = 'closed' AND closed_at IS NOT NULL
       ORDER BY closed_at DESC LIMIT 200`,
    [guildId]
  );

  let avgCloseHours = 0, avgFirstResponseHours = 0, firstResponseCount = 0, avgRating = 0, ratedCount = 0;
  const agentCounts: Record<string, number> = {};

  for (const t of closedTickets) {
    if (t.closed_at) {
      avgCloseHours += (new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000;
    }
    if (t.first_response_at) {
      avgFirstResponseHours += (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000;
      firstResponseCount++;
    }
    if (t.agent_id) agentCounts[t.agent_id] = (agentCounts[t.agent_id] ?? 0) + 1;
    if (t.rating) { avgRating += t.rating; ratedCount++; }
  }

  const n = closedTickets.length;
  avgCloseHours = n > 0 ? avgCloseHours / n : 0;
  avgFirstResponseHours = firstResponseCount > 0 ? avgFirstResponseHours / firstResponseCount : 0;
  avgRating = ratedCount > 0 ? avgRating / ratedCount : 0;

  const topAgents = Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([agentId, count]) => ({ agentId, count }));

  return { total, open, closedThisMonth, avgCloseHours, avgFirstResponseHours, firstResponseCount, avgRating, ratedCount, topAgents };
}
