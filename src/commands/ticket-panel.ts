import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
} from 'discord.js';
import { panelEmbed, errorEmbed } from '../utils/embeds';
import { ensureServerConfig } from '../db/servers';
import { q } from '../db/client';

export const data = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Send a ticket panel to the current channel')
  .addStringOption(o =>
    o.setName('title').setDescription('Panel embed title').setRequired(false)
  )
  .addStringOption(o =>
    o.setName('description').setDescription('Panel embed description').setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ embeds: [errorEmbed('This command must be used in a server.')], ephemeral: true });
    return;
  }

  const title = interaction.options.getString('title') ?? '🎫 OnlyOffice Support';
  const description =
    interaction.options.getString('description') ??
    [
      "👋 **Hi there! Need a hand?** We're happy to help.",
      '',
      '**How to open a ticket:**',
      '`1️⃣` Click the **Open a Ticket** button below',
      '`2️⃣` Choose a category and describe your issue',
      '`3️⃣` A private channel opens just for you and our team',
      '',
      '📎 You can attach files and screenshots once your ticket is open.',
    ].join('\n');

  await ensureServerConfig(interaction.guildId!);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket')
      .setLabel('Open a Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
    new ButtonBuilder()
      .setCustomId('reopen_panel')
      .setLabel('Reopen a Ticket')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄')
  );

  // Render the panel text as plain content (always shows, even without the
  // Embed Links permission) AND as an embed (nicer when the permission is granted).
  const panelContent = `## ${title}\n${description}`;

  const channel = interaction.channel as TextChannel;
  const message = await channel.send({
    content: panelContent,
    embeds: [panelEmbed(title, description)],
    components: [row],
  });

  await q(
    'INSERT INTO panels (guild_id, channel_id, message_id) VALUES ($1, $2, $3)',
    [interaction.guildId!, interaction.channelId, message.id]
  );

  await interaction.reply({ embeds: [{ description: '✅ Panel created!', color: 0x00b300 }], ephemeral: true });
}
