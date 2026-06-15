import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { config } from 'dotenv';
import { readdirSync } from 'fs';
import { join } from 'path';
import { Command } from './types';
import { checkInactiveTickets } from './handlers/inactivityHandler';

config();

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

client.once('ready', () => {
  // Run inactivity check every 30 minutes
  const INTERVAL_MS = 30 * 60 * 1000;
  setInterval(() => {
    checkInactiveTickets(client).catch(console.error);
  }, INTERVAL_MS);

  console.log(`[inactivity] Checker scheduled every 30 minutes`);
});

client.login(process.env.DISCORD_TOKEN);
