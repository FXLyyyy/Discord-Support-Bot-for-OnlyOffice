import { supabase } from './client';
import { ServerConfig } from '../types';

export async function getServerConfig(guildId: string): Promise<ServerConfig | null> {
  const { data, error } = await supabase
    .from('servers')
    .select('*')
    .eq('guild_id', guildId)
    .single();

  if (error) return null;
  return data as ServerConfig;
}

export async function upsertServerConfig(
  guildId: string,
  updates: Partial<Omit<ServerConfig, 'guild_id' | 'created_at' | 'updated_at'>>
): Promise<ServerConfig> {
  const { data, error } = await supabase
    .from('servers')
    .upsert({ guild_id: guildId, ...updates })
    .select()
    .single();

  if (error) throw error;
  return data as ServerConfig;
}

export async function ensureServerConfig(guildId: string): Promise<ServerConfig> {
  const existing = await getServerConfig(guildId);
  if (existing) return existing;
  return upsertServerConfig(guildId, {});
}
