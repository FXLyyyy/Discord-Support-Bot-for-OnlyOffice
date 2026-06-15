import { Interaction, ButtonInteraction } from 'discord.js';
import { getTicketByChannel } from '../db/tickets';
import { ensureServerConfig } from '../db/servers';
import { openTicket, closeTicket, claimTicket } from '../handlers/ticketHandler';
import { Command } from '../types';

export const name = 'interactionCreate';
export const once = false;

export async function execute(interaction: Interaction): Promise<void> {
  // ── Slash commands ────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const client = interaction.client as typeof interaction.client & {
      commands: Map<string, Command>;
    };
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in command /${interaction.commandName}:`, err);
      const payload = { content: '❌ An unexpected error occurred.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(console.error);
      } else {
        await interaction.reply(payload).catch(console.error);
      }
    }
    return;
  }

  // ── Button interactions ───────────────────────────────────────────────────
  if (!interaction.isButton()) return;
  const btn = interaction as ButtonInteraction;
  if (!btn.guild) return;

  const config = await ensureServerConfig(btn.guildId!);

  switch (btn.customId) {
    case 'open_ticket':
      await openTicket(btn, config);
      break;

    case 'close_ticket': {
      const ticket = await getTicketByChannel(btn.channelId);
      if (!ticket || ticket.status === 'closed') {
        await btn.reply({ content: '❌ No active ticket found for this channel.', ephemeral: true });
        return;
      }
      await closeTicket(btn, ticket, config);
      break;
    }

    case 'claim_ticket': {
      const ticket = await getTicketByChannel(btn.channelId);
      if (!ticket || ticket.status === 'closed') {
        await btn.reply({ content: '❌ No active ticket found for this channel.', ephemeral: true });
        return;
      }
      await claimTicket(btn, ticket, config);
      break;
    }

    default:
      break;
  }
}
