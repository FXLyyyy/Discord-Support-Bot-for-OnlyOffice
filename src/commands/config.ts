import { MessageFlags,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { ensureServerConfig, getServerConfig, upsertServerConfig } from '../db/servers';
import { configViewEmbed, errorEmbed, successEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure the support bot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('view').setDescription('View current configuration')
  )
  .addSubcommand(sub =>
    sub
      .setName('set-log-channel')
      .setDescription('Set the channel where ticket logs are posted')
      .addChannelOption(o =>
        o
          .setName('channel')
          .setDescription('Log channel')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('set-ticket-category')
      .setDescription('Set the category where ticket channels are created')
      .addStringOption(o =>
        o.setName('category-id').setDescription('Category channel ID').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('add-support-role')
      .setDescription('Add a role that can manage tickets')
      .addRoleOption(o => o.setName('role').setDescription('Support role').setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName('remove-support-role')
      .setDescription('Remove a support role')
      .addRoleOption(o => o.setName('role').setDescription('Support role').setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'view': {
      const config = await getServerConfig(guildId);
      if (!config) {
        await interaction.reply({ embeds: [errorEmbed('No configuration found. Use other /config subcommands to set it up.')], flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ embeds: [configViewEmbed(config)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'set-log-channel': {
      const channel = interaction.options.getChannel('channel', true);
      await upsertServerConfig(guildId, { log_channel_id: channel.id });
      await interaction.reply({ embeds: [successEmbed(`Log channel set to ${channel}.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'set-ticket-category': {
      const categoryId = interaction.options.getString('category-id', true).trim();
      const category = interaction.guild!.channels.cache.get(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.reply({ embeds: [errorEmbed('Invalid category ID. Make sure to copy the ID of a Category channel.')], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, { ticket_category_id: categoryId });
      await interaction.reply({ embeds: [successEmbed(`Ticket category set to **${category.name}**.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'add-support-role': {
      const role = interaction.options.getRole('role', true);
      const config = await ensureServerConfig(guildId);
      if (config.support_role_ids.includes(role.id)) {
        await interaction.reply({ embeds: [errorEmbed(`${role} is already a support role.`)], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, {
        support_role_ids: [...config.support_role_ids, role.id],
      });
      await interaction.reply({ embeds: [successEmbed(`Added ${role} as a support role.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    case 'remove-support-role': {
      const role = interaction.options.getRole('role', true);
      const config = await ensureServerConfig(guildId);
      if (!config.support_role_ids.includes(role.id)) {
        await interaction.reply({ embeds: [errorEmbed(`${role} is not a support role.`)], flags: MessageFlags.Ephemeral });
        return;
      }
      await upsertServerConfig(guildId, {
        support_role_ids: config.support_role_ids.filter(id => id !== role.id),
      });
      await interaction.reply({ embeds: [successEmbed(`Removed ${role} from support roles.`)], flags: MessageFlags.Ephemeral });
      break;
    }

    default:
      await interaction.reply({ embeds: [errorEmbed('Unknown subcommand.')], flags: MessageFlags.Ephemeral });
  }
}
