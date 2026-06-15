export interface ServerConfig {
  guild_id: string;
  support_role_ids: string[];
  log_channel_id: string | null;
  ticket_category_id: string | null;
  panel_channel_id: string | null;
  auto_thread_channel_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Panel {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string;
  created_at: string;
}

export type TicketStatus = 'open' | 'claimed' | 'closed';

export interface Ticket {
  id: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  agent_id: string | null;
  status: TicketStatus;
  ticket_number: number;
  subject: string;
  description: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string;
  username: string;
  content: string;
  attachments: Array<{ name: string; url: string }>;
  created_at: string;
}

export interface Transcript {
  id: string;
  ticket_id: string;
  guild_id: string;
  messages: TicketMessage[];
  created_at: string;
}

export interface Command {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: import('discord.js').ChatInputCommandInteraction) => Promise<void>;
}
