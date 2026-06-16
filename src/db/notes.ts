import { supabase } from './client';
import { TicketNote } from '../types';

export async function addTicketNote(params: {
  ticketId: string;
  authorId: string;
  authorTag: string;
  note: string;
}): Promise<TicketNote> {
  const { data, error } = await supabase
    .from('ticket_notes')
    .insert({
      ticket_id: params.ticketId,
      author_id: params.authorId,
      author_tag: params.authorTag,
      note: params.note,
    })
    .select()
    .single();

  if (error) throw error;
  return data as TicketNote;
}

export async function getTicketNotes(ticketId: string): Promise<TicketNote[]> {
  const { data, error } = await supabase
    .from('ticket_notes')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data ?? []) as TicketNote[];
}
