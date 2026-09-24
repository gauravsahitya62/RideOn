-- Forward-only production observability/analytics event ledger.
-- Stores only server-authoritative, privacy-safe business events. event_key makes
-- retries/webhook replays idempotent without mutating financial records.
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name VARCHAR(80) NOT NULL,
  event_key VARCHAR(255) NOT NULL UNIQUE,
  actor_user_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx ON analytics_events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_booking_time_idx ON analytics_events(booking_id, occurred_at DESC);
