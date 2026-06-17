import './utils/fileLogger'; // must be first — patches console + captures crashes
import { Client, GatewayIntentBits, Partials, Collection, REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { Command } from './types';
import { checkInactiveTickets, cleanupArchivedTickets } from './handlers/inactivityHandler';
import { loadActiveTicketChannels } from './cache';
import { runDatabaseBackup } from './utils/backup';
import { isDocSpaceConfigured } from './utils/docspace';

// Env is loaded by Node's native --env-file flag (see package.json scripts);
// docker-compose injects vars directly. No dotenv dependency needed.

if (!process.env.DISCORD_TOKEN) {
  throw new Error('Missing DISCORD_TOKEN environment variable');
}

interface BotClient extends Client {
  commands: Collection<string, Command>;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  // Nothing pings by default — every place that should mention sets allowedMentions
  // explicitly. Closes mention-injection (@everyone in user/agent text) globally.
  allowedMentions: { parse: [] },
}) as BotClient;

client.commands = new Collection<string, Command>();

// Load events
const eventsPath = join(__dirname, 'events');
for (const file of readdirSync(eventsPath).filter(f => f.match(/\.[jt]s$/))) {
  const event = require(join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args: unknown[]) => event.execute(...args));
  } else {
    client.on(event.name, (...args: unknown[]) => event.execute(...args));
  }
}

// Load commands
const commandsPath = join(__dirname, 'commands');
for (const file of readdirSync(commandsPath).filter(f => f.match(/\.[jt]s$/))) {
  const command = require(join(commandsPath, file)) as Partial<Command>;
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command as Command);
  }
}

// Register slash commands with Discord. Guild-scoped if DISCORD_GUILD_ID is set
// (instant), otherwise global. Idempotent — safe to run on every startup.
async function registerCommands(): Promise<void> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    console.warn('[commands] DISCORD_CLIENT_ID not set — skipping command registration');
    return;
  }
  const body = [...client.commands.values()].map(c => c.data.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
  const guildId = process.env.DISCORD_GUILD_ID;
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`[commands] Registered ${body.length} commands to guild ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log(`[commands] Registered ${body.length} commands globally`);
    }
  } catch (err) {
    console.error('[commands] Failed to register commands:', err);
  }
}

client.once('ready', async () => {
  await registerCommands();
  await loadActiveTicketChannels().catch(err => console.error('[cache] load failed:', err));

  // Run inactivity check every 30 minutes
  setInterval(() => {
    checkInactiveTickets(client).catch(console.error);
  }, 30 * 60 * 1000);
  console.log(`[inactivity] Checker scheduled every 30 minutes`);

  // Clean up old archived ticket channels once a day
  setInterval(() => {
    cleanupArchivedTickets(client).catch(console.error);
  }, 24 * 60 * 60 * 1000);
  console.log(`[cleanup] Archived-ticket cleanup scheduled daily`);

  // Scheduled database backup to DocSpace (default every 24h; 0 disables)
  const backupHours = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
  if (isDocSpaceConfigured() && backupHours > 0) {
    // First backup 10 min after startup, so frequent restarts don't keep
    // postponing it; then on the regular interval.
    setTimeout(() => runDatabaseBackup().catch(console.error), 10 * 60 * 1000);
    setInterval(() => {
      runDatabaseBackup().catch(console.error);
    }, backupHours * 60 * 60 * 1000);
    console.log(`[backup] Database backup scheduled every ${backupHours}h (first run in ~10 min)`);
  }

  console.log(`[bot] Logged in as ${client.user?.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
