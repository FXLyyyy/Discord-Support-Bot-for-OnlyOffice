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
import { supabase } from '../db/client';
import { TICKET_CATEGORIES } from '../types';

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

  const title = interaction.options.getString('title') ?? '🎫 Support Tickets';
  const description =
    interaction.options.getString('description') ??
    'Need help? Click the button below to open a support ticket. Our team will assist you as soon as possible.';

  await ensureServerConfig(interaction.guildId!);

  const BUTTON_STYLES = [ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Secondary];
  const BUTTON_EMOJIS = ['📋', '🔧', '💡'];

  const buttons = Object.entries(TICKET_CATEGORIES).map(([value, label], i) =>
    new ButtonBuilder()
      .setCustomId(`open_ticket:${value}`)
      .setLabel(label)
      .setStyle(BUTTON_STYLES[i] ?? ButtonStyle.Secondary)
      .setEmoji(BUTTON_EMOJIS[i] ?? '🎫')
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

  const channel = interaction.channel as TextChannel;
  const message = await channel.send({
    embeds: [panelEmbed(title, description)],
    components: [row],
  });

  await supabase.from('panels').insert({
    guild_id: interaction.guildId!,
    channel_id: interaction.channelId,
    message_id: message.id,
  });

  await interaction.reply({ embeds: [{ description: '✅ Panel created!', color: 0x00b300 }], ephemeral: true });
}
