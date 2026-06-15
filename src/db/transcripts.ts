import { supabase } from './client';
import { Transcript, TicketMessage } from '../types';

export async function saveTranscript(params: {
  ticketId: string;
  guildId: string;
  messages: TicketMessage[];
}): Promise<Transcript> {
  const { data, error } = await supabase
    .from('transcripts')
    .insert({
      ticket_id: params.ticketId,
      guild_id: params.guildId,
      messages: params.messages,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Transcript;
}

export async function getTranscript(ticketId: string): Promise<Transcript | null> {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('ticket_id', ticketId)
    .single();

  if (error) return null;
  return data as Transcript;
}
