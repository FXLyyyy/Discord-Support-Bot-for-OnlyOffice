import { supabase } from './client';
import { Ticket, TicketStatus, TicketMessage } from '../types';

export async function createTicket(params: {
  guildId: string;
  channelId: string;
  userId: string;
  ticketNumber: number;
  subject: string;
  description: string;
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
  const { data } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('guild_id', guildId)
    .order('ticket_number', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return 1;
  return (data[0].ticket_number as number) + 1;
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  agentId?: string
): Promise<Ticket> {
  const updates: Record<string, unknown> = { status };
  if (agentId !== undefined) updates.agent_id = agentId;
  if (status === 'closed') updates.closed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select()
    .single();

  if (error) throw error;
  return data as Ticket;
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

export async function getTicketMessages(ticketId: string): Promise<TicketMessage[]> {
  const { data, error } = await supabase
    .from('ticket_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return data as TicketMessage[];
}
