import { q, one } from './client';
import { Transcript, TicketMessage } from '../types';

export async function saveTranscript(params: {
  ticketId: string;
  guildId: string;
  messages: TicketMessage[];
}): Promise<Transcript> {
  return (await one<Transcript>(
    `INSERT INTO transcripts (ticket_id, guild_id, messages)
     VALUES ($1, $2, $3::jsonb) RETURNING *`,
    [params.ticketId, params.guildId, JSON.stringify(params.messages)]
  ))!;
}

export async function getTranscript(ticketId: string): Promise<Transcript | null> {
  return one<Transcript>(
    'SELECT * FROM transcripts WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1',
    [ticketId]
  );
}
