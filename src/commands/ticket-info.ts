import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, TextChannel, GuildMember } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { countTicketNotes, countUserInternalNotes } from '../db/notes';
import { getUserNotes } from '../db/userNotes';
import { getServerConfig } from '../db/servers';
import { errorEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('ticket-info')
  .setDescription('Show information about the current ticket');

const STATUS_COLOR: Record<string, number> = {
  open:    Colors.Green,
  claimed: Colors.Blue,
  closed:  Colors.Red,
};

const STATUS_LABEL: Record<string, string> = {
  open:    '🟢 Open',
  claimed: '🔵 Claimed',
  closed:  '🔴 Closed',
};

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await getServerConfig(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!config || !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only support staff can use this command.')], ephemeral: true });
    return;
  }

  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({ embeds: [errorEmbed('This is not an active ticket channel.')], ephemeral: true });
    return;
  }

  const channel = interaction.channel as TextChannel;
  const msgCount = await channel.messages
    .fetch({ limit: 100 })
    .then(c => c.size)
    .catch(() => 0);

  const openedTs = Math.floor(new Date(ticket.created_at).getTime() / 1000);

  const fields = [
    { name: 'Subject',    value: ticket.subject,                    inline: false },
    { name: 'Status',     value: STATUS_LABEL[ticket.status],       inline: true  },
    { name: 'Opened By',  value: `<@${ticket.user_id}>`,            inline: true  },
    { name: 'Opened',     value: `<t:${openedTs}:R>`,               inline: true  },
    { name: 'Messages',   value: String(msgCount),                  inline: true  },
  ];

  if (ticket.agent_id) {
    fields.push({ name: 'Agent', value: `<@${ticket.agent_id}>`, inline: true });
  }

  if (ticket.rating) {
    fields.push({ name: 'Rating', value: `${'⭐'.repeat(ticket.rating)} (${ticket.rating}/5)`, inline: true });
  }

  // Internal-note indicators
  const [ticketNotes, crossNotes, profileNotes] = await Promise.all([
    countTicketNotes(ticket.id),
    countUserInternalNotes(interaction.guildId!, ticket.user_id),
    getUserNotes(interaction.guildId!, ticket.user_id),
  ]);
  fields.push({
    name: '🗒️ Internal notes',
    value: ticketNotes > 0 ? `${ticketNotes} in this ticket` : 'None in this ticket',
    inline: true,
  });
  if (crossNotes > ticketNotes) {
    fields.push({
      name: '⚠️ This user',
      value: `Has **${crossNotes}** internal note(s) across their tickets`,
      inline: true,
    });
  }
  if (profileNotes.length > 0) {
    const text = profileNotes
      .slice(0, 8)
      .map(n => `• ${n.note.length > 120 ? `${n.note.slice(0, 120)}…` : n.note}`)
      .join('\n');
    fields.push({ name: '📌 User notes', value: text.slice(0, 1024), inline: false });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Ticket #${ticket.ticket_number}`)
    .setColor(STATUS_COLOR[ticket.status] ?? Colors.Blue)
    .addFields(fields)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
