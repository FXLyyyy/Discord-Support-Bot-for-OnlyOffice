import { Client } from 'discord.js';

export const name = 'ready';
export const once = true;

export async function execute(client: Client<true>): Promise<void> {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} guild(s)`);
}
