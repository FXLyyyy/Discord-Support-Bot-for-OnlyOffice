import { supabase } from './client';

export interface UserNote {
  id: string;
  guild_id: string;
  user_id: string;
  author_id: string;
  author_tag: string;
  note: string;
  created_at: string;
}

export async function addUserNote(params: {
  guildId: string;
  userId: string;
  authorId: string;
  authorTag: string;
  note: string;
}): Promise<UserNote> {
  const { data, error } = await supabase
    .from('user_notes')
    .insert({
      guild_id: params.guildId,
      user_id: params.userId,
      author_id: params.authorId,
      author_tag: params.authorTag,
      note: params.note,
    })
    .select()
    .single();

  if (error) throw error;
  return data as UserNote;
}

export async function getUserNotes(guildId: string, userId: string): Promise<UserNote[]> {
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data ?? []) as UserNote[];
}

// Deletes the note at the given 1-based position (as shown by /usernote list).
export async function deleteUserNoteAt(
  guildId: string,
  userId: string,
  position: number
): Promise<UserNote | null> {
  const notes = await getUserNotes(guildId, userId);
  const target = notes[position - 1];
  if (!target) return null;
  await supabase.from('user_notes').delete().eq('id', target.id);
  return target;
}
