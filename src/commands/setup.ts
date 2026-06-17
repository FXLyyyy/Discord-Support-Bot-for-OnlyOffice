import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  CategoryChannel,
  TextChannel,
  Role,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { ensureServerConfig, upsertServerConfig } from '../db/servers';
import { postTicketPanel } from '../handlers/panel';
import { errorEmbed, successEmbed } from '../utils/embeds';

const F = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('One-time setup: create the category, channels and support role, then post the panel')
  .addRoleOption(o =>
    o.setName('support_role').setDescription('Existing role to use as support staff (optional — one is created if omitted)').setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function findCategory(guild: ChatInputCommandInteraction['guild'], name: string): CategoryChannel | undefined {
  return guild!.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === name
  ) as CategoryChannel | undefined;
}
function findText(guild: ChatInputCommandInteraction['guild'], name: string): TextChannel | undefined {
  return guild!.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name === name
  ) as TextChannel | undefined;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ embeds: [errorEmbed('This command must be used in a server.')], flags: MessageFlags.Ephemeral });
    return;
  }
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ embeds: [errorEmbed('Only server administrators can run /setup.')], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const botId = interaction.client.user!.id;
    const everyone = guild.roles.everyone.id;

    // 1) Support role — use the provided one, reuse "Support Team", or create it (empty).
    let role = interaction.options.getRole('support_role') as Role | null;
    if (!role) {
      role = guild.roles.cache.find(r => r.name === 'Support Team')
        ?? await guild.roles.create({ name: 'Support Team', mentionable: true, reason: 'Support bot setup' });
    }

    // Staff-only overwrites reused for the categories
    const staffOnly = [
      { id: everyone, deny: [F.ViewChannel] },
      { id: botId, allow: [F.ViewChannel, F.SendMessages, F.ManageChannels, F.ReadMessageHistory, F.EmbedLinks, F.AttachFiles, F.ManageMessages] },
      { id: role.id, allow: [F.ViewChannel, F.SendMessages, F.ReadMessageHistory] },
    ];

    // 2) Active + archive categories
    const ticketsCat = findCategory(guild, 'Tickets')
      ?? await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, permissionOverwrites: staffOnly });
    if (!findCategory(guild, 'Closed Tickets')) {
      await guild.channels.create({ name: 'Closed Tickets', type: ChannelType.GuildCategory, permissionOverwrites: staffOnly });
    }

    // 3) Staff-only log channel
    const logs = findText(guild, 'ticket-logs')
      ?? await guild.channels.create({
        name: 'ticket-logs', type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: everyone, deny: [F.ViewChannel] },
          { id: botId, allow: [F.ViewChannel, F.SendMessages, F.EmbedLinks, F.AttachFiles, F.ReadMessageHistory] },
          { id: role.id, allow: [F.ViewChannel, F.ReadMessageHistory] },
        ],
      });

    // 4) Public, read-only panel channel
    let panelCh = findText(guild, 'create-ticket');
    const panelChannelIsNew = !panelCh;
    if (!panelCh) {
      panelCh = await guild.channels.create({
        name: 'create-ticket', type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: everyone, allow: [F.ViewChannel, F.ReadMessageHistory], deny: [F.SendMessages, F.AddReactions, F.CreatePublicThreads, F.CreatePrivateThreads, F.SendMessagesInThreads] },
          { id: botId, allow: [F.ViewChannel, F.SendMessages, F.EmbedLinks] },
        ],
      });
    }

    // 5) Wire configuration
    const cfg = await ensureServerConfig(guild.id);
    const support_role_ids = cfg.support_role_ids.includes(role.id)
      ? cfg.support_role_ids
      : [...cfg.support_role_ids, role.id];
    await upsertServerConfig(guild.id, {
      support_role_ids,
      log_channel_id: logs.id,
      ticket_category_id: ticketsCat.id,
    });

    // 6) Post the panel only when we just created the channel (avoids duplicates on re-run)
    if (panelChannelIsNew) await postTicketPanel(panelCh as TextChannel);

    await interaction.editReply({
      embeds: [successEmbed(
        `**Setup complete.**\n` +
        `• Active category: ${ticketsCat}\n` +
        `• Panel channel: ${panelCh}${panelChannelIsNew ? ' (panel posted)' : ' (already existed — run /ticket-panel if needed)'}\n` +
        `• Staff log channel: ${logs}\n` +
        `• Archive category: **Closed Tickets**\n` +
        `• Support role: ${role}\n\n` +
        `⚠️ **Final step (manual on purpose):** assign ${role} to your support agents. ` +
        `Only members with that role can manage tickets.`
      )],
    });
  } catch (err) {
    console.error('[setup] failed:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Setup failed. Make sure the bot has Manage Channels and Manage Roles, and its role is high in the list.')],
    });
  }
}
