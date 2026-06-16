import { MessageFlags,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { addTicketNote } from '../db/notes';
import { getServerConfig } from '../db/servers';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';
import { ensureStaffThread } from '../handlers/ticketHandler';

export const data = new SlashCommandBuilder()
  .setName('internal')
  .setDescription('Post a staff-only internal note (hidden from the customer)')
  .addStringOption(o =>
    o.setName('note').setDescription('The internal note').setRequired(true).setMaxLength(1000)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await getServerConfig(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!config || !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only support staff can post internal notes.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const ticket = await getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({
      embeds: [errorEmbed('This command can only be used inside an active ticket channel.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const note = interaction.options.getString('note', true);

  // Persist for the transcript
  await addTicketNote({
    ticketId: ticket.id,
    authorId: member.id,
    authorTag: member.user.tag,
    note,
  });

  // Post into the private staff thread (customer can't see it)
  const thread = await ensureStaffThread(interaction.channel as TextChannel, config, ticket.ticket_number);
  await thread?.send({ content: `🗒️ **${member}**: ${note}`, allowedMentions: { parse: [] } }).catch(() => null);

  await interaction.reply({
    embeds: [
      successEmbed(
        thread
          ? `Internal note posted to ${thread} (staff-only) and saved to the transcript.`
          : 'Internal note saved to the transcript. (Could not open a private thread — check the bot\'s Manage Threads permission.)'
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
