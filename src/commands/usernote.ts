import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { addUserNote, getUserNotes, deleteUserNoteAt } from '../db/userNotes';
import { getServerConfig } from '../db/servers';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('usernote')
  .setDescription('Persistent agent-only notes about a user (not tied to a ticket)')
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription('Add a note about a user')
      .addUserOption(o => o.setName('user').setDescription('The user').setRequired(true))
      .addStringOption(o => o.setName('note').setDescription('Note text, e.g. "Uses Ubuntu 22.04"').setRequired(true).setMaxLength(500))
  )
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('Show all notes about a user')
      .addUserOption(o => o.setName('user').setDescription('The user').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('remove')
      .setDescription('Remove a note by its number (see /usernote list)')
      .addUserOption(o => o.setName('user').setDescription('The user').setRequired(true))
      .addIntegerOption(o => o.setName('number').setDescription('Note number from the list').setRequired(true).setMinValue(1))
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await getServerConfig(interaction.guildId!);
  const member = interaction.member as GuildMember;

  if (!config || !isSupportMember(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only support staff can manage user notes.')], ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const target = interaction.options.getUser('user', true);

  if (sub === 'add') {
    const note = interaction.options.getString('note', true);
    await addUserNote({
      guildId: interaction.guildId!,
      userId: target.id,
      authorId: member.id,
      authorTag: member.user.tag,
      note,
    });
    await interaction.reply({ embeds: [successEmbed(`Note saved for ${target}.`)], ephemeral: true });
    return;
  }

  if (sub === 'list') {
    const notes = await getUserNotes(interaction.guildId!, target.id);
    if (notes.length === 0) {
      await interaction.reply({ embeds: [successEmbed(`No notes for ${target} yet.`)], ephemeral: true });
      return;
    }
    const lines = notes.map((n, i) => {
      const date = new Date(n.created_at).toLocaleDateString('en-GB');
      return `**${i + 1}.** ${n.note}\n   _— ${n.author_tag}, ${date}_`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`Notes for ${target.tag}`)
      .setColor(Colors.Blurple)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Remove with /usernote remove user number' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'remove') {
    const number = interaction.options.getInteger('number', true);
    const removed = await deleteUserNoteAt(interaction.guildId!, target.id, number);
    await interaction.reply({
      embeds: [removed ? successEmbed(`Removed note #${number} for ${target}.`) : errorEmbed(`No note #${number} found for ${target}.`)],
      ephemeral: true,
    });
    return;
  }
}
