-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Server configuration per Discord guild
CREATE TABLE IF NOT EXISTS servers (
  guild_id             TEXT PRIMARY KEY,
  support_role_ids     JSONB        NOT NULL DEFAULT '[]',
  log_channel_id       TEXT,
  ticket_category_id   TEXT,
  panel_channel_id     TEXT,
  auto_thread_channel_ids JSONB     NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Ticket panels (embed + button messages)
CREATE TABLE IF NOT EXISTS panels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    TEXT        NOT NULL REFERENCES servers(guild_id) ON DELETE CASCADE,
  channel_id  TEXT        NOT NULL,
  message_id  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual support tickets
CREATE TABLE IF NOT EXISTS tickets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id       TEXT        NOT NULL REFERENCES servers(guild_id) ON DELETE CASCADE,
  channel_id     TEXT        NOT NULL UNIQUE,
  user_id        TEXT        NOT NULL,
  agent_id       TEXT,
  status         TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'claimed', 'closed')),
  ticket_number  INTEGER     NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  UNIQUE (guild_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS tickets_guild_user_status_idx
  ON tickets (guild_id, user_id, status);

-- Messages logged per ticket (for transcripts)
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  username    TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  attachments JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transcript snapshots saved on ticket close
CREATE TABLE IF NOT EXISTS transcripts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id    TEXT        NOT NULL,
  messages    JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on servers
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
