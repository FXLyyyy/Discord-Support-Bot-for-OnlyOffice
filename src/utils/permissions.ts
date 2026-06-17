import { GuildMember } from 'discord.js';
import { ServerConfig } from '../types';

// Admin = a server manager (Discord Administrator / Manage Server) OR a member
// of a configured admin role. Admins can run management commands and everything
// an agent can.
export function isAdmin(member: GuildMember, config: ServerConfig): boolean {
  if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) return true;
  return member.roles.cache.some(role => (config.admin_role_ids ?? []).includes(role.id));
}

// Agent (support staff) = an admin OR a member of a configured support role.
// Gates the day-to-day ticket operations.
export function isSupportMember(member: GuildMember, config: ServerConfig): boolean {
  if (isAdmin(member, config)) return true;
  return member.roles.cache.some(role => config.support_role_ids.includes(role.id));
}
