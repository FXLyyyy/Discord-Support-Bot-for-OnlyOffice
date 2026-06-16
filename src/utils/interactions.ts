import { CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';

type Dismissable = CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

// Deletes an interaction's (ephemeral) reply after a delay, so transient
// "only you can see this" confirmations clear themselves instead of piling up.
export function autoDismiss(interaction: Dismissable, ms = 8000): void {
  setTimeout(() => {
    interaction.deleteReply().catch(() => null);
  }, ms);
}
