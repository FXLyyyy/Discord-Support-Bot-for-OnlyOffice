import { MessageFlags,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  GuildMember,
} from 'discord.js';
import { ensureServerConfig, upsertServerConfig } from '../db/servers';
import { configViewEmbed, errorEmbed, successEmbed } from '../utils/embeds';
import { isAdmin } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure the support bot for this server (admin only)')
  .addSubcommand(sub => sub.setName('view').setDescription('View current configuration'))
  .addSubcommand(sub =>
    sub
      .setName('set-log-channel')
      .setDescription('Set the staff-only channel where logs and transcripts are posted')
      .addChannelOption(o =>
        o.setName('channel').setDescription('Log channel (must be staff-only)').addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('set-ticket-category')
      .setDescription('Set the category where ticket channels are created')
      .addStringOption(o => o.setName('category-id').setDescription('Category channel ID').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('add-admin-role')
      .setDescription('Add a role with admin access (config, setup, panel, stats, assign)')
      .addRoleOption(o => o.setName('role').setDescription('Admin role').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('remove-admin-role')
      .setDescription('Remove an admin role')
      .addRoleOption(o => o.setName('role').setDescription('Admin role').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('add-support-role')
      .setDescription('Add an agent role that can work tickets')
      .addRoleOption(o => o.setName('role').setDescription('Agent (support) role').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('remove-support-role')
      .setDescription('Remove an agent role')
      .addRoleOption(o => o.setName('role').setDescription('Agent (support) role').setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const member = interaction.member as GuildMember;
  const config = await ensureServerConfig(guildId);

  if (!isAdmin(member, config)) {
    await interaction.reply({ embeds: [errorEmbed('Only administrators can configure the bot.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'view': {
      await interaction.reply({ embeds: [configViewEmbed(config)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'set-log-channel': {
      const channel = interaction.options.getChannel('channel', true) as TextChannel;
      // Transcripts contain full conversations — refuse a channel @everyone can read.
      const everyonePerms = channel.permissionsFor(interaction.guild!.roles.everyone);
      if (everyonePerms?.has(PermissionFlagsBits.ViewChannel)) {
        await interaction.reply({
          embeds: [errorEmbed(`${channel} is visible to @everyone. Transcripts are sensitive — choose a staff-only channel.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await upsertServerConfig(guildId, { log_channel_id: channel.id });
      await interaction.reply({ embeds: [successEmbed(`Log channel set to ${channel}.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'set-ticket-category': {
      const categoryId = interaction.options.getString('category-id', true).trim();
      const category = interaction.guild!.channels.cache.get(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.reply({ embeds: [errorEmbed('Invalid category ID. Copy the ID of a Category channel.')], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, { ticket_category_id: categoryId });
      await interaction.reply({ embeds: [successEmbed(`Ticket category set to **${category.name}**.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'add-admin-role': {
      const role = interaction.options.getRole('role', true);
      if (config.admin_role_ids.includes(role.id)) {
        await interaction.reply({ embeds: [errorEmbed(`${role} is already an admin role.`)], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, { admin_role_ids: [...config.admin_role_ids, role.id] });
      await interaction.reply({ embeds: [successEmbed(`Added ${role} as an admin role.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'remove-admin-role': {
      const role = interaction.options.getRole('role', true);
      if (!config.admin_role_ids.includes(role.id)) {
        await interaction.reply({ embeds: [errorEmbed(`${role} is not an admin role.`)], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, { admin_role_ids: config.admin_role_ids.filter(id => id !== role.id) });
      await interaction.reply({ embeds: [successEmbed(`Removed ${role} from admin roles.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'add-support-role': {
      const role = interaction.options.getRole('role', true);
      if (config.support_role_ids.includes(role.id)) {
        await interaction.reply({ embeds: [errorEmbed(`${role} is already an agent role.`)], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, { support_role_ids: [...config.support_role_ids, role.id] });
      await interaction.reply({ embeds: [successEmbed(`Added ${role} as an agent role.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'remove-support-role': {
      const role = interaction.options.getRole('role', true);
      if (!config.support_role_ids.includes(role.id)) {
        await interaction.reply({ embeds: [errorEmbed(`${role} is not an agent role.`)], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, { support_role_ids: config.support_role_ids.filter(id => id !== role.id) });
      await interaction.reply({ embeds: [successEmbed(`Removed ${role} from agent roles.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    default:
      await interaction.reply({ embeds: [errorEmbed('Unknown subcommand.')], flags: MessageFlags.Ephemeral });
  }
}
