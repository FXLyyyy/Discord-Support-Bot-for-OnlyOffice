import {
  Interaction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  GuildMember,
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
  showCloseModal,
} from '../handlers/ticketHandler';
import { errorEmbed } from '../utils/embeds';
import { isSupportMember } from '../utils/permissions';
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
    const modal = interaction as ModalSubmitInteraction;
    try {
      if (modal.customId.startsWith('open_ticket_modal')) {
        const config = await ensureServerConfig(modal.guildId!);
        await handleTicketModal(modal, config);
      } else if (modal.customId === 'close_ticket_modal') {
        const config = await ensureServerConfig(modal.guildId!);
        const ticket = await getTicketByChannel(modal.channelId!);
        if (!ticket || ticket.status === 'closed') {
          await modal.reply({ content: '❌ No active ticket found for this channel.', ephemeral: true });
          return;
        }
        const resolution = modal.fields.getTextInputValue('resolution');
        const reason = modal.fields.getTextInputValue('close_reason');
        await closeTicket(modal, ticket, config, { resolution, reason });
      }
    } catch (err) {
      console.error(`[modal] ${modal.customId} error:`, err);
      const payload = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
      modal.replied || modal.deferred
        ? await modal.followUp(payload).catch(console.error)
        : await modal.reply(payload).catch(console.error);
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
      const member = btn.member as GuildMember;
      if (isSupportMember(member, config)) {
        // Staff must provide a resolution → collect it via a modal
        await showCloseModal(btn);
      } else if (ticket.user_id === member.id) {
        // Ticket owner closing their own ticket — no resolution required
        await closeTicket(btn, ticket, config);
      } else {
        await btn.reply({ embeds: [errorEmbed('You do not have permission to close this ticket.')], ephemeral: true });
      }
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
