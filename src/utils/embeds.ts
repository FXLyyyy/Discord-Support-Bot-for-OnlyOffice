import { EmbedBuilder, Colors, User } from 'discord.js';
import { Ticket, ServerConfig } from '../types';

export function ticketOpenEmbed(
  user: User,
  ticketNumber: number,
  channelId: string,
  subject: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎫 Ticket Opened')
    .setColor(Colors.Green)
    .addFields(
      { name: 'User', value: `${user} (${user.tag})`, inline: true },
      { name: 'Ticket #', value: String(ticketNumber), inline: true },
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      { name: 'Subject', value: subject, inline: false }
    )
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();
}

export function ticketClaimEmbed(agent: User, ticket: Ticket): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🙋 Ticket Claimed')
    .setColor(Colors.Blue)
    .addFields(
      { name: 'Agent', value: `${agent} (${agent.tag})`, inline: true },
      { name: 'Ticket #', value: String(ticket.ticket_number), inline: true },
      { name: 'Channel', value: `<#${ticket.channel_id}>`, inline: true }
    )
    .setThumbnail(agent.displayAvatarURL())
    .setTimestamp();
}

export function ticketCloseEmbed(closedBy: User, ticket: Ticket, messageCount: number): EmbedBuilder {
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Closed By', value: `${closedBy} (${closedBy.tag})`, inline: true },
    { name: 'Ticket #', value: String(ticket.ticket_number), inline: true },
    { name: 'Messages', value: String(messageCount), inline: true },
    { name: 'Opened By', value: `<@${ticket.user_id}>`, inline: true },
  ];

  if (ticket.agent_id) {
    fields.push({ name: 'Agent', value: `<@${ticket.agent_id}>`, inline: true });
  }

  return new EmbedBuilder()
    .setTitle('🔒 Ticket Closed')
    .setColor(Colors.Red)
    .addFields(fields)
    .setTimestamp();
}

export function panelEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(Colors.Blue)
    .setFooter({ text: 'OnlyOffice Support' });
}

export function ticketWelcomeEmbed(
  user: User,
  ticketNumber: number,
  subject: string,
  description: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Ticket #${ticketNumber} — ${subject}`)
    .setDescription(
      `Hello ${user}! A support agent will be with you shortly.\n\n` +
      `**Issue described:**\n${description}`
    )
    .setColor(Colors.Blue)
    .setFooter({ text: 'Use the buttons below to claim or close this ticket.' })
    .setTimestamp();
}

export function configViewEmbed(config: ServerConfig): EmbedBuilder {
  const roles = config.support_role_ids.length
    ? config.support_role_ids.map(id => `<@&${id}>`).join(', ')
    : 'None';

  const autoThreads = config.auto_thread_channel_ids.length
    ? config.auto_thread_channel_ids.map(id => `<#${id}>`).join(', ')
    : 'None';

  return new EmbedBuilder()
    .setTitle('⚙️ Server Configuration')
    .setColor(Colors.Blue)
    .addFields(
      { name: 'Support Roles', value: roles, inline: false },
      { name: 'Log Channel', value: config.log_channel_id ? `<#${config.log_channel_id}>` : 'Not set', inline: true },
      { name: 'Ticket Category', value: config.ticket_category_id ? `<#${config.ticket_category_id}>` : 'Not set', inline: true },
      { name: 'Auto-Thread Channels', value: autoThreads, inline: false }
    )
    .setTimestamp();
}

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ ${message}`);
}

export function successEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ ${message}`);
}
