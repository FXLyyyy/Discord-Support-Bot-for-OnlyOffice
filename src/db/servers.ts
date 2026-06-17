import { q, one } from './client';
import { ServerConfig } from '../types';

const JSONB_KEYS = new Set(['support_role_ids']);
// Only these columns may be written — guards the dynamic INSERT/UPDATE below
// against any column name reaching it that wasn't a hard-coded literal.
const WRITABLE_COLUMNS = new Set(['support_role_ids', 'log_channel_id', 'ticket_category_id']);

// Write-through in-memory cache — config is read on almost every interaction
// but changes only via /config.
const configCache = new Map<string, ServerConfig>();

export async function getServerConfig(guildId: string): Promise<ServerConfig | null> {
  const cached = configCache.get(guildId);
  if (cached) return cached;
  const row = await one<ServerConfig>('SELECT * FROM servers WHERE guild_id = $1', [guildId]);
  if (row) configCache.set(guildId, row);
  return row;
}

export async function upsertServerConfig(
  guildId: string,
  updates: Partial<Omit<ServerConfig, 'guild_id' | 'created_at' | 'updated_at'>>
): Promise<ServerConfig> {
  const keys = Object.keys(updates);
  const illegal = keys.find(k => !WRITABLE_COLUMNS.has(k));
  if (illegal) throw new Error(`Refusing to write unknown server column: ${illegal}`);

  if (keys.length === 0) {
    await q('INSERT INTO servers (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING', [guildId]);
    const row = (await one<ServerConfig>('SELECT * FROM servers WHERE guild_id = $1', [guildId]))!;
    configCache.set(guildId, row);
    return row;
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

  const row = (await one<ServerConfig>(sql, params))!;
  configCache.set(guildId, row); // keep cache fresh on writes
  return row;
}

export async function ensureServerConfig(guildId: string): Promise<ServerConfig> {
  const existing = await getServerConfig(guildId);
  if (existing) return existing;
  return upsertServerConfig(guildId, {});
}
