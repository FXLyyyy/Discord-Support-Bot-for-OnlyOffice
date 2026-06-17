import {
  GuildMember,
  PartialGuildMember,
  TextChannel,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import {
  getOpenTicketsForUserInGuild,
  updateTicketStatus,
  markOpenerLeft,
} from '../db/tickets';
import { saveTranscript } from '../db/transcripts';
import { getServerConfig } from '../db/servers';
import { archiveTicketChannel, ensureStaffThread } from '../handlers/ticketHandler';
import { fetchAllMessages } from '../handlers/inactivityHandler';
import { logToChannel } from '../utils/logger';
import { removeTicketChannel } from '../cache';
import { Ticket } from '../types';

export const name = 'guildMemberRemove';
export const once = false;

function leftLogEmbed(ticket: Ticket): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('👋 Ticket Auto-Closed (Opener Left)')
    .setColor(Colors.Orange)
    .addFields(
      { name: 'Ticket #', value: String(ticket.ticket_number), inline: true },
      { name: 'Opened By', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'Subject', value: ticket.subject, inline: false }
    )
    .setTimestamp();
}

// When a member leaves the server, auto-close any live ticket they own: flag it
// as opener-left, preserve the transcript, archive the channel and notify staff.
export async function execute(member: GuildMember | PartialGuildMember): Promise<void> {
  const guildId = member.guild.id;
  const tickets = await getOpenTicketsForUserInGuild(guildId, member.id).catch(() => []);
  if (tickets.length === 0) return;

  const config = await getServerConfig(guildId).catch(() => null);

  for (const ticket of tickets) {
    await markOpenerLeft(ticket.id).catch(console.error);
    await updateTicketStatus(ticket.id, 'closed', undefined, {
      closeReason: 'Opener left the server',
    }).catch(console.error);
    removeTicketChannel(ticket.channel_id);

    const channel = ticket.channel_id
      ? await member.guild.channels.fetch(ticket.channel_id).catch(() => null) as TextChannel | null
      : null;

    if (channel?.isTextBased()) {
      // Preserve the conversation before archiving the channel
      const messages = await fetchAllMessages(channel);
      await saveTranscript({ ticketId: ticket.id, guildId, messages }).catch(console.error);

      // Brief staff in the private thread, then lock & archive the channel
      if (config) {
        const thread = await ensureStaffThread(channel, config, ticket.ticket_number).catch(() => null);
        await thread?.send({
          content: `👋 <@${ticket.user_id}> left the server — ticket **#${ticket.ticket_number}** was auto-closed and archived.`,
          allowedMentions: { parse: [] },
        }).catch(() => null);
      }

      await channel.send({
        content: '👋 **The member who opened this ticket has left the server.** This ticket has been closed and archived.',
        allowedMentions: { parse: [] },
      }).catch(() => null);

      await archiveTicketChannel(channel, member.guild, ticket).catch(console.error);
    }

    await logToChannel(member.client, guildId, leftLogEmbed(ticket));
    console.log(`[memberRemove] Auto-closed ticket #${ticket.ticket_number} — opener left guild ${guildId}`);
  }
}
