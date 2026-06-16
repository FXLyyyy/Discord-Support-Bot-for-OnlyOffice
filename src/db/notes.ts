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

export async function countTicketNotes(ticketId: string): Promise<number> {
  const { count } = await supabase
    .from('ticket_notes')
    .select('*', { count: 'exact', head: true })
    .eq('ticket_id', ticketId);
  return count ?? 0;
}

// Counts internal notes across all tickets opened by a given user in a guild.
export async function countUserInternalNotes(guildId: string, userId: string): Promise<number> {
  const { data: tickets } = await supabase
    .from('tickets')
    .select('id')
    .eq('guild_id', guildId)
    .eq('user_id', userId);

  const ids = (tickets ?? []).map(t => t.id as string);
  if (ids.length === 0) return 0;

  const { count } = await supabase
    .from('ticket_notes')
    .select('*', { count: 'exact', head: true })
    .in('ticket_id', ids);
  return count ?? 0;
}
