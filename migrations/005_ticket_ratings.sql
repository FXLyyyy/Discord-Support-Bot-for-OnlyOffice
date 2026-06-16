-- Dedicated table collecting every star rating submitted by customers

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
