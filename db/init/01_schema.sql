-- Full schema for the Discord Support Bot (self-hosted Postgres).
-- Applied automatically by the postgres container on first boot.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Per-guild configuration
CREATE TABLE IF NOT EXISTS servers (
  guild_id           TEXT        PRIMARY KEY,
  support_role_ids   JSONB       NOT NULL DEFAULT '[]',
  log_channel_id     TEXT,
  ticket_category_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS panels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    TEXT        NOT NULL REFERENCES servers(guild_id) ON DELETE CASCADE,
  channel_id  TEXT        NOT NULL,
  message_id  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id             TEXT        NOT NULL REFERENCES servers(guild_id) ON DELETE CASCADE,
  channel_id           TEXT        UNIQUE,            -- nullable: set NULL once the channel is cleaned up
  user_id              TEXT        NOT NULL,
  agent_id             TEXT,
  status               TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','closed')),
  ticket_number        INTEGER     NOT NULL,
  subject              TEXT        NOT NULL DEFAULT 'Support Request',
  description          TEXT,
  rating               INTEGER     CHECK (rating >= 1 AND rating <= 5),
  rated_at             TIMESTAMPTZ,
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inactivity_warned_at TIMESTAMPTZ,
  first_response_at    TIMESTAMPTZ,
  close_reason         TEXT,
  resolution           TEXT,
  transcript_url       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at            TIMESTAMPTZ,
  UNIQUE (guild_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS tickets_channel_idx        ON tickets (channel_id);
CREATE INDEX IF NOT EXISTS tickets_guild_user_idx     ON tickets (guild_id, user_id, status);
CREATE INDEX IF NOT EXISTS tickets_guild_status_idx   ON tickets (guild_id, status);
CREATE INDEX IF NOT EXISTS tickets_inactivity_idx     ON tickets (status, last_activity_at) WHERE status IN ('open','claimed');

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  username    TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  attachments JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcripts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id    TEXT        NOT NULL,
  messages    JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Internal staff notes (per ticket)
CREATE TABLE IF NOT EXISTS ticket_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  TEXT        NOT NULL,
  author_tag TEXT        NOT NULL,
  note       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ticket_notes_ticket_idx ON ticket_notes (ticket_id);

-- Persistent agent-only notes about a user
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

-- Star ratings log
CREATE TABLE IF NOT EXISTS ticket_ratings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id      TEXT        NOT NULL,
  ticket_number INTEGER,
  rated_by      TEXT,
  rating        INTEGER     NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ticket_ratings_guild_idx  ON ticket_ratings (guild_id);
CREATE INDEX IF NOT EXISTS ticket_ratings_ticket_idx ON ticket_ratings (ticket_id);

-- Atomic per-guild ticket numbering
CREATE TABLE IF NOT EXISTS ticket_counters (
  guild_id    TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

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

-- Keep servers.updated_at fresh
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER servers_updated_at
  BEFORE UPDATE ON servers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
