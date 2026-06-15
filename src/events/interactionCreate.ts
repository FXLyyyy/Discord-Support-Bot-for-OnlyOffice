import {
  Interaction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { getTicketByChannel, saveRating } from '../db/tickets';
import { ensureServerConfig } from '../db/servers';
import {
  openTicket,
  closeTicket,
  claimTicket,
  handleTicketModal,
  handleCategorySelect,
} from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';
import { Command } from '../types';

export const name = 'interactionCreate';
export const once = false;

export async function execute(interaction: Interaction): Promise<void> {
  // ── Slash commands ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const client = interaction.client as typeof interaction.client & {
      commands: Map<string, Command>;
    };
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in /${interaction.commandName}:`, err);
      const payload = { content: '❌ An unexpected error occurred.', ephemeral: true };
      interaction.replied || interaction.deferred
        ? await interaction.followUp(payload).catch(console.error)
        : await interaction.reply(payload).catch(console.error);
    }
    return;
  }

  // ── Modal submissions ──────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('open_ticket_modal')) {
      const config = await ensureServerConfig(interaction.guildId!);
      await handleTicketModal(interaction as ModalSubmitInteraction, config);
    }
    return;
  }

  // ── String select menus ────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_ticket_category') {
      await handleCategorySelect(interaction as StringSelectMenuInteraction);
    }
    return;
  }

  // ── Buttons ────────────────────────────────────────────────────────────────
  if (!interaction.isButton()) return;
  const btn = interaction as ButtonInteraction;
  if (!btn.guild) return;

  // Rating buttons: rate_ticket:TICKET_ID:RATING
  if (btn.customId.startsWith('rate_ticket:')) {
    const [, ticketId, ratingStr] = btn.customId.split(':');
    const rating = parseInt(ratingStr, 10);

    if (isNaN(rating) || rating < 1 || rating > 5) {
      await btn.reply({ content: '❌ Invalid rating.', ephemeral: true });
      return;
    }

    await saveRating(ticketId, rating).catch(console.error);

    await btn.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('Thanks for your feedback! 🙏')
          .setDescription(
            `You rated your experience **${'⭐'.repeat(rating)} (${rating}/5)**.\n` +
            `Your feedback helps us improve our support quality.`
          )
          .setColor(Colors.Green),
      ],
      components: [],
    });
    return;
  }

  const config = await ensureServerConfig(btn.guildId!);

  switch (btn.customId) {
    case 'open_ticket':
      await openTicket(btn, config);
      break;

    case 'close_ticket': {
      const ticket = await getTicketByChannel(btn.channelId);
      if (!ticket || ticket.status === 'closed') {
        await btn.reply({ embeds: [errorEmbed('No active ticket found for this channel.')], ephemeral: true });
        return;
      }
      await closeTicket(btn, ticket, config);
      break;
    }

    case 'claim_ticket': {
      const ticket = await getTicketByChannel(btn.channelId);
      if (!ticket || ticket.status === 'closed') {
        await btn.reply({ embeds: [errorEmbed('No active ticket found for this channel.')], ephemeral: true });
        return;
      }
      await claimTicket(btn, ticket, config);
      break;
    }

    default:
      break;
  }
}
