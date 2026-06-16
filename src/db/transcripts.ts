import { one } from './client';
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
