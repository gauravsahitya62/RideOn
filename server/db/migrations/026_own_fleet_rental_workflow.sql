-- Forward-only operational support for the own-fleet rental lifecycle.
-- Do not modify or backfill existing lifecycle/payment records.

CREATE TABLE IF NOT EXISTS notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  audience_role VARCHAR(32) NOT NULL DEFAULT 'customer',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notification_events_customer_created_idx
  ON notification_events(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_events_booking_idx
  ON notification_events(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fleet_damage_cases_status_idx
  ON fleet_damage_cases(status, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_fleet_lifecycle_idx
  ON bookings(lifecycle_state, end_at);

CREATE INDEX IF NOT EXISTS security_deposits_settlement_idx
  ON security_deposits(status, updated_at DESC);
