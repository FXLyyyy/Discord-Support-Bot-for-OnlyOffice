-- Internal notes, first-response tracking, close reason + resolution, atomic numbering

-- 1. New ticket columns
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS close_reason      TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution        TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transcript_url    TEXT;

-- 2. Internal staff notes (never shown to the ticket opener)
CREATE TABLE IF NOT EXISTS ticket_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  TEXT        NOT NULL,
  author_tag TEXT        NOT NULL,
  note       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticket_notes_ticket_idx ON ticket_notes (ticket_id);

-- 3. Atomic per-guild ticket numbering (fixes the race where two users
--    opening at the same instant could get the same number)
CREATE TABLE IF NOT EXISTS ticket_counters (
  guild_id    TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

-- Seed counters from existing tickets so numbering continues without collisions
INSERT INTO ticket_counters (guild_id, last_number)
SELECT guild_id, MAX(ticket_number) FROM tickets GROUP BY guild_id
ON CONFLICT (guild_id) DO UPDATE SET last_number = EXCLUDED.last_number;

CREATE OR REPLACE FUNCTION next_ticket_number(g_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO ticket_counters (guild_id, last_number)
  VALUES (g_id, 1)
  ON CONFLICT (guild_id)
  DO UPDATE SET last_number = ticket_counters.last_number + 1
  RETURNING last_number INTO n;
  RETURN n;
END;
$$ LANGUAGE plpgsql;
