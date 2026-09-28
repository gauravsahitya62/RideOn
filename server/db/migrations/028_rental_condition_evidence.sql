-- Forward-only rental condition evidence and handover inspection.
-- Never modifies prior migrations. Stores immutable media records and customer/staff condition acknowledgements.

CREATE TABLE IF NOT EXISTS rental_condition_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  phase VARCHAR(16) NOT NULL CHECK (phase IN ('delivery','pickup')),
  actor_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  actor_role VARCHAR(32) NOT NULL CHECK (actor_role IN ('customer','delivery_staff','fleet_ops','admin')),
  media_type VARCHAR(16) NOT NULL CHECK (media_type IN ('image','video')),
  storage_bucket VARCHAR(120) NOT NULL,
  storage_path TEXT NOT NULL,
  media_url TEXT NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  captured_at TIMESTAMPTZ,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rental_condition_evidence_booking_phase_idx
  ON rental_condition_evidence(booking_id, phase, created_at);

CREATE INDEX IF NOT EXISTS rental_condition_evidence_vehicle_idx
  ON rental_condition_evidence(vehicle_id, created_at);

CREATE TABLE IF NOT EXISTS rental_condition_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  phase VARCHAR(16) NOT NULL CHECK (phase IN ('delivery','pickup')),
  actor_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  actor_role VARCHAR(32) NOT NULL CHECK (actor_role IN ('customer','delivery_staff','fleet_ops','admin')),
  condition_status VARCHAR(32) NOT NULL CHECK (condition_status IN ('no_damage','existing_damage','new_damage','damage_review')),
  damage_notes TEXT,
  odometer INTEGER CHECK (odometer IS NULL OR odometer >= 0),
  fuel_battery NUMERIC(5,2) CHECK (fuel_battery IS NULL OR (fuel_battery >= 0 AND fuel_battery <= 100)),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rental_condition_reports_actor_phase_idx
  ON rental_condition_reports(booking_id, phase, actor_user_id);

CREATE INDEX IF NOT EXISTS rental_condition_reports_booking_phase_idx
  ON rental_condition_reports(booking_id, phase, created_at);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS delivery_condition_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS pickup_condition_status VARCHAR(32);

ALTER TABLE rental_returns
  ADD COLUMN IF NOT EXISTS customer_condition_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS customer_evidence_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE vehicle_inspections
  ADD COLUMN IF NOT EXISTS customer_evidence_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS rental_returns_booking_idx ON rental_returns(booking_id, returned_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_inspections_booking_idx ON vehicle_inspections(booking_id, inspected_at DESC);
