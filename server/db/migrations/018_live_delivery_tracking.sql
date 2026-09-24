-- Forward-only live delivery tracking foundation.
-- Tracking is explicitly scoped to an active vehicle-delivery session.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(24) NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_final_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS delivery_final_longitude NUMERIC(9,6);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_delivery_status_allowed') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_delivery_status_allowed
      CHECK (delivery_status IN ('scheduled','in_delivery','delivered','aborted'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  last_latitude NUMERIC(9,6),
  last_longitude NUMERIC(9,6),
  last_accuracy_meters NUMERIC(8,2),
  last_location_at TIMESTAMPTZ,
  last_route_distance_meters INTEGER,
  last_route_duration_seconds INTEGER,
  last_route_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT tracking_sessions_status_allowed CHECK (status IN ('active','completed','aborted','expired')),
  CONSTRAINT tracking_sessions_latitude_range CHECK (last_latitude IS NULL OR last_latitude BETWEEN -90 AND 90),
  CONSTRAINT tracking_sessions_longitude_range CHECK (last_longitude IS NULL OR last_longitude BETWEEN -180 AND 180),
  CONSTRAINT tracking_sessions_accuracy_nonnegative CHECK (last_accuracy_meters IS NULL OR last_accuracy_meters >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS tracking_sessions_one_active_booking_idx
  ON tracking_sessions(booking_id)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS tracking_sessions_customer_lookup_idx
  ON tracking_sessions(booking_id,status,started_at DESC);

CREATE INDEX IF NOT EXISTS tracking_sessions_vendor_lookup_idx
  ON tracking_sessions(vendor_id,status,last_location_at DESC);

CREATE INDEX IF NOT EXISTS bookings_delivery_status_idx
  ON bookings(delivery_status,delivery_started_at DESC);

-- Existing bookings are not retroactively considered delivered/in-flight.
