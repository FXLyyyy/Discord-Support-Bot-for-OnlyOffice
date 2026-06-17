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
import { isAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';

const F = PermissionFlagsBits;

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('One-time setup: create roles, category, channels and post the panel (admin only)')
  .addRoleOption(o =>
    o.setName('admin_role').setDescription('Existing admin role (optional — one is created if omitted)').setRequired(false)
  )
  .addRoleOption(o =>
    o.setName('agent_role').setDescription('Existing agent role (optional — one is created if omitted)').setRequired(false)
  );

function findCategory(guild: ChatInputCommandInteraction['guild'], name: string): CategoryChannel | undefined {
  return guild!.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name) as CategoryChannel | undefined;
}
function findText(guild: ChatInputCommandInteraction['guild'], name: string): TextChannel | undefined {
  return guild!.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === name) as TextChannel | undefined;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ embeds: [errorEmbed('This command must be used in a server.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const config = await ensureServerConfig(guild.id);
  if (!isAdmin(interaction.member as GuildMember, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only administrators can run /setup.')], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const botId = interaction.client.user!.id;
    const everyone = guild.roles.everyone.id;

    // 1) Roles — provided, reused, or created empty. Membership stays manual.
    let adminRole = interaction.options.getRole('admin_role') as Role | null;
    if (!adminRole) {
      adminRole = guild.roles.cache.find(r => r.name === 'Support Admins')
        ?? await guild.roles.create({ name: 'Support Admins', mentionable: true, reason: 'Support bot setup' });
    }
    let agentRole = interaction.options.getRole('agent_role') as Role | null;
    if (!agentRole) {
      agentRole = guild.roles.cache.find(r => r.name === 'Support Agents')
        ?? await guild.roles.create({ name: 'Support Agents', mentionable: true, reason: 'Support bot setup' });
    }

    // Staff (admin + agent) can see the private categories/channels
    const staffView = [F.ViewChannel, F.SendMessages, F.ReadMessageHistory];
    const staffOnly = [
      { id: everyone, deny: [F.ViewChannel] },
      { id: botId, allow: [F.ViewChannel, F.SendMessages, F.ManageChannels, F.ReadMessageHistory, F.EmbedLinks, F.AttachFiles, F.ManageMessages] },
      { id: adminRole.id, allow: staffView },
      { id: agentRole.id, allow: staffView },
    ];

    // 2) Active + archive categories
    const ticketsCat = findCategory(guild, 'Tickets')
      ?? await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, permissionOverwrites: staffOnly });
    if (!findCategory(guild, 'Closed Tickets')) {
      await guild.channels.create({ name: 'Closed Tickets', type: ChannelType.GuildCategory, permissionOverwrites: staffOnly });
    }

    // 3) Parent "Support" category for the panel + log channels
    const supportCat = findCategory(guild, 'Support')
      ?? await guild.channels.create({ name: 'Support', type: ChannelType.GuildCategory });

    // 4) Staff-only log channel (under the Support category)
    const logs = findText(guild, 'ticket-logs')
      ?? await guild.channels.create({
        name: 'ticket-logs', type: ChannelType.GuildText, parent: supportCat.id,
        permissionOverwrites: [
          { id: everyone, deny: [F.ViewChannel] },
          { id: botId, allow: [F.ViewChannel, F.SendMessages, F.EmbedLinks, F.AttachFiles, F.ReadMessageHistory] },
          { id: adminRole.id, allow: [F.ViewChannel, F.ReadMessageHistory] },
          { id: agentRole.id, allow: [F.ViewChannel, F.ReadMessageHistory] },
        ],
      });

    // 5) Public, read-only panel channel (under the Support category)
    let panelCh = findText(guild, 'create-ticket');
    const panelChannelIsNew = !panelCh;
    if (!panelCh) {
      panelCh = await guild.channels.create({
        name: 'create-ticket', type: ChannelType.GuildText, parent: supportCat.id,
        permissionOverwrites: [
          { id: everyone, allow: [F.ViewChannel, F.ReadMessageHistory], deny: [F.SendMessages, F.AddReactions, F.CreatePublicThreads, F.CreatePrivateThreads, F.SendMessagesInThreads] },
          { id: botId, allow: [F.ViewChannel, F.SendMessages, F.EmbedLinks] },
        ],
      });
    }

    // 5) Wire configuration (merge, don't duplicate)
    const admin_role_ids = config.admin_role_ids.includes(adminRole.id) ? config.admin_role_ids : [...config.admin_role_ids, adminRole.id];
    const support_role_ids = config.support_role_ids.includes(agentRole.id) ? config.support_role_ids : [...config.support_role_ids, agentRole.id];
    await upsertServerConfig(guild.id, { admin_role_ids, support_role_ids, log_channel_id: logs.id, ticket_category_id: ticketsCat.id });

    // 6) Post the panel only when we just created the channel (avoids duplicates)
    if (panelChannelIsNew) await postTicketPanel(panelCh as TextChannel);

    await interaction.editReply({
      embeds: [successEmbed(
        `**Setup complete.**\n` +
        `• Active category: ${ticketsCat}\n` +
        `• Panel channel: ${panelCh}${panelChannelIsNew ? ' (panel posted)' : ' (already existed — run /ticket-panel if needed)'}\n` +
        `• Staff log channel: ${logs}\n` +
        `• Archive category: **Closed Tickets**\n` +
        `• Admin role: ${adminRole}  |  Agent role: ${agentRole}\n\n` +
        `⚠️ **Final step (manual on purpose):** assign ${adminRole} to your leads and ${agentRole} to your agents. ` +
        `Roles define who can do what; membership is an admin decision.`
      )],
    });
  } catch (err) {
    console.error('[setup] failed:', err);
    await interaction.editReply({
      embeds: [errorEmbed('Setup failed. Ensure the bot has Manage Channels and Manage Roles, and its role is high in the list.')],
    });
  }
}
