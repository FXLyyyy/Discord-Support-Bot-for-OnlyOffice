import { q, one } from './client';
import { TicketNote } from '../types';

export async function addTicketNote(params: {
  ticketId: string;
  authorId: string;
  authorTag: string;
  note: string;
}): Promise<TicketNote> {
  return (await one<TicketNote>(
    `INSERT INTO ticket_notes (ticket_id, author_id, author_tag, note)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.ticketId, params.authorId, params.authorTag, params.note]
  ))!;
}

export async function getTicketNotes(ticketId: string): Promise<TicketNote[]> {
  return q<TicketNote>(
    'SELECT * FROM ticket_notes WHERE ticket_id = $1 ORDER BY created_at ASC',
    [ticketId]
  );
}

export async function countTicketNotes(ticketId: string): Promise<number> {
  const row = await one<{ c: number }>('SELECT COUNT(*)::int AS c FROM ticket_notes WHERE ticket_id = $1', [ticketId]);
  return row?.c ?? 0;
}

// Counts internal notes across all tickets opened by a user in a guild.
export async function countUserInternalNotes(guildId: string, userId: string): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM ticket_notes n
       JOIN tickets t ON t.id = n.ticket_id
     WHERE t.guild_id = $1 AND t.user_id = $2`,
    [guildId, userId]
  );
  return row?.c ?? 0;
}
