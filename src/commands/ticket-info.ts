import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, TextChannel, GuildMember } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
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
    { name: 'Category',   value: ticket.category,                   inline: true  },
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

  const embed = new EmbedBuilder()
    .setTitle(`Ticket #${ticket.ticket_number}`)
    .setColor(STATUS_COLOR[ticket.status] ?? Colors.Blue)
    .addFields(fields)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
