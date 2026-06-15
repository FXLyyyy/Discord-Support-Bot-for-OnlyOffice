import { Client, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import { getTicketsForInactivityCheck, markInactivityWarned, updateTicketStatus } from '../db/tickets';
import { saveTranscript } from '../db/transcripts';
import { logToChannel } from '../utils/logger';
import { Ticket, TicketMessage } from '../types';

const INACTIVITY_WARN_TEXT =
  '⏰ **Just checking in!** This ticket has been quiet for **24 hours**.\n' +
  "If we don't hear back within the next **24 hours**, it'll be closed automatically. " +
  'Reply any time to keep it open. 🙂';

const AUTO_CLOSE_TEXT =
  '🔒 **This ticket was automatically closed** after 48 hours of inactivity.\n' +
  "No worries — if you still need help, just open a new ticket and we'll pick right back up! 👋";

function autoCloseLogEmbed(ticket: Ticket): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🤖 Ticket Auto-Closed (Inactivity)')
    .setColor(Colors.Orange)
    .addFields(
      { name: 'Ticket #', value: String(ticket.ticket_number), inline: true },
      { name: 'Opened By', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'Subject', value: ticket.subject, inline: false }
    )
    .setTimestamp();
}

async function fetchAllMessages(channel: TextChannel): Promise<TicketMessage[]> {
  const all: TicketMessage[] = [];
  let lastId: string | undefined;

  while (true) {
    const batch = await channel.messages
      .fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) })
      .catch(() => null);

    if (!batch || batch.size === 0) break;
    for (const msg of batch.values()) {
      if (!msg.author.bot) {
        all.push({
          id: msg.id,
          ticket_id: '',
          user_id: msg.author.id,
          username: msg.author.tag,
          content: msg.content,
          attachments: msg.attachments.map(a => ({ name: a.name ?? 'file', url: a.url })),
          created_at: msg.createdAt.toISOString(),
        });
      }
    }
    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return all.reverse();
}

export async function checkInactiveTickets(client: Client): Promise<void> {
  console.log('[inactivity] Running check…');

  const { toWarn, toClose } = await getTicketsForInactivityCheck();

  for (const ticket of toClose) {
    const channel = await client.channels
      .fetch(ticket.channel_id)
      .catch(() => null) as TextChannel | null;

    if (channel?.isTextBased()) {
      const messages = await fetchAllMessages(channel);
      await saveTranscript({ ticketId: ticket.id, guildId: ticket.guild_id, messages }).catch(console.error);
      await channel.send({ content: AUTO_CLOSE_TEXT }).catch(console.error);
    }

    await updateTicketStatus(ticket.id, 'closed').catch(console.error);
    await logToChannel(client, ticket.guild_id, autoCloseLogEmbed(ticket));
    setTimeout(() => channel?.delete('Auto-closed: inactivity').catch(console.error), 3000);

    console.log(`[inactivity] Auto-closed ticket #${ticket.ticket_number}`);
  }

  for (const ticket of toWarn) {
    const channel = await client.channels
      .fetch(ticket.channel_id)
      .catch(() => null) as TextChannel | null;

    if (channel?.isTextBased()) {
      await channel.send({ content: INACTIVITY_WARN_TEXT }).catch(console.error);
      await markInactivityWarned(ticket.id).catch(console.error);
      console.log(`[inactivity] Warned ticket #${ticket.ticket_number}`);
    }
  }

  if (toWarn.length + toClose.length === 0) {
    console.log('[inactivity] No inactive tickets found.');
  }
}
