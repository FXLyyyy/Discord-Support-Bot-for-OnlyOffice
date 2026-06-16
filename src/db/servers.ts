import { q, one } from './client';
import { ServerConfig } from '../types';

const JSONB_KEYS = new Set(['support_role_ids', 'auto_thread_channel_ids']);

export async function getServerConfig(guildId: string): Promise<ServerConfig | null> {
  return one<ServerConfig>('SELECT * FROM servers WHERE guild_id = $1', [guildId]);
}

export async function upsertServerConfig(
  guildId: string,
  updates: Partial<Omit<ServerConfig, 'guild_id' | 'created_at' | 'updated_at'>>
): Promise<ServerConfig> {
  const keys = Object.keys(updates);

  if (keys.length === 0) {
    await q('INSERT INTO servers (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING', [guildId]);
    return (await getServerConfig(guildId))!;
  }

  const params: unknown[] = [guildId];
  const placeholders: string[] = ['$1'];
  keys.forEach((key, i) => {
    const pos = i + 2;
    const value = (updates as Record<string, unknown>)[key];
    if (JSONB_KEYS.has(key)) {
      params.push(JSON.stringify(value));
      placeholders.push(`$${pos}::jsonb`);
    } else {
      params.push(value);
      placeholders.push(`$${pos}`);
    }
  });

  const setClause = keys.map(k => `${k} = EXCLUDED.${k}`).concat('updated_at = NOW()').join(', ');
  const sql =
    `INSERT INTO servers (guild_id, ${keys.join(', ')}) VALUES (${placeholders.join(', ')}) ` +
    `ON CONFLICT (guild_id) DO UPDATE SET ${setClause} RETURNING *`;

  return (await one<ServerConfig>(sql, params))!;
}

export async function ensureServerConfig(guildId: string): Promise<ServerConfig> {
  const existing = await getServerConfig(guildId);
  if (existing) return existing;
  return upsertServerConfig(guildId, {});
}
