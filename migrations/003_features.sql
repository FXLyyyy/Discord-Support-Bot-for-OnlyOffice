-- Ticket categories, rating, and inactivity tracking

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category        TEXT        NOT NULL DEFAULT 'General';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating          INTEGER     CHECK (rating >= 1 AND rating <= 5);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rated_at        TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS inactivity_warned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS tickets_inactivity_idx
  ON tickets (status, last_activity_at)
  WHERE status IN ('open', 'claimed');
