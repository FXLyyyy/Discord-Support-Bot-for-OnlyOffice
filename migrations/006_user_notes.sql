-- Persistent, agent-only notes attached to a user (not to any single ticket)

CREATE TABLE IF NOT EXISTS user_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id   TEXT        NOT NULL,
  user_id    TEXT        NOT NULL,
  author_id  TEXT        NOT NULL,
  author_tag TEXT        NOT NULL,
  note       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_notes_lookup_idx ON user_notes (guild_id, user_id);
