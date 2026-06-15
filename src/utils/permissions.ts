import { GuildMember } from 'discord.js';
import { ServerConfig } from '../types';

export function isSupportMember(member: GuildMember, config: ServerConfig): boolean {
  if (member.permissions.has('Administrator')) return true;
  return member.roles.cache.some(role => config.support_role_ids.includes(role.id));
}
