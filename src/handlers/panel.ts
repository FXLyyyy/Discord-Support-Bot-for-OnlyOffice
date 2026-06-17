import { TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { panelEmbed } from '../utils/embeds';
import { q } from '../db/client';

export const DEFAULT_PANEL_TITLE = '🎫 OnlyOffice Support';
export const DEFAULT_PANEL_DESCRIPTION = [
  "👋 **Hi there! Need a hand?** We're happy to help.",
  '',
  '**How to open a ticket:**',
  '`1️⃣` Click the **Open a Ticket** button below',
  '`2️⃣` Describe your issue in the form',
  '`3️⃣` A private channel opens just for you and our team',
  '',
  '📎 You can attach files and screenshots once your ticket is open.',
].join('\n');

// Posts the ticket panel into a channel and records it in the panels table.
// Shared by /ticket-panel and /setup.
export async function postTicketPanel(
  channel: TextChannel,
  title: string = DEFAULT_PANEL_TITLE,
  description: string = DEFAULT_PANEL_DESCRIPTION
): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('open_ticket').setLabel('Open a Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
    new ButtonBuilder().setCustomId('reopen_panel').setLabel('Reopen a Ticket').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );

  // Plain content always renders; embed is a bonus when Embed Links is granted.
  const message = await channel.send({
    content: `## ${title}\n${description}`,
    embeds: [panelEmbed(title, description)],
    components: [row],
  });

  await q(
    'INSERT INTO panels (guild_id, channel_id, message_id) VALUES ($1, $2, $3)',
    [channel.guildId, channel.id, message.id]
  );
}
