import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { readdirSync } from 'fs';
import { join } from 'path';

config();

const { DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID');
}

const commands: unknown[] = [];
const commandsPath = join(__dirname, 'commands');

for (const file of readdirSync(commandsPath).filter(f => f.match(/\.[jt]s$/))) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const command = require(join(commandsPath, file));
  if (command.data?.toJSON) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  console.log(`Deploying ${commands.length} slash command(s) globally…`);
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
  console.log('✅ Commands deployed successfully.');
})();
