import { q, one } from './client';

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
  return (await one<UserNote>(
    `INSERT INTO user_notes (guild_id, user_id, author_id, author_tag, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.guildId, params.userId, params.authorId, params.authorTag, params.note]
  ))!;
}

export async function getUserNotes(guildId: string, userId: string): Promise<UserNote[]> {
  return q<UserNote>(
    'SELECT * FROM user_notes WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at ASC',
    [guildId, userId]
  );
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
  await q('DELETE FROM user_notes WHERE id = $1', [target.id]);
  return target;
}
