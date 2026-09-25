-- Forward-only RideOn-owned fleet operations foundation.
-- Legacy vendor ownership columns remain readable for historical data, but all
-- new operational fields are owned by RideOn and enforced server-side.

DO $$ BEGIN
  CREATE TYPE fleet_vehicle_operational_state AS ENUM ('AVAILABLE','RESERVED','RENTED','RETURNED','INSPECTION','MAINTENANCE','INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS fleet_vehicle_class VARCHAR(16) NOT NULL DEFAULT 'bike',
  ADD COLUMN IF NOT EXISTS variant VARCHAR(100),
  ADD COLUMN IF NOT EXISTS color VARCHAR(40),
  ADD COLUMN IF NOT EXISTS pickup_location TEXT,
  ADD COLUMN IF NOT EXISTS service_area JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS operational_state fleet_vehicle_operational_state NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN IF NOT EXISTS maintenance_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_odometer INTEGER,
  ADD COLUMN IF NOT EXISTS current_fuel_battery NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_fleet_class_allowed') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_fleet_class_allowed CHECK (fleet_vehicle_class IN ('bike','scooter'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_odometer_nonnegative') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_odometer_nonnegative CHECK (current_odometer IS NULL OR current_odometer >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_fuel_battery_range') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_fuel_battery_range CHECK (current_fuel_battery IS NULL OR current_fuel_battery BETWEEN 0 AND 100);
  END IF;
END $$;

UPDATE vehicles
SET fleet_vehicle_class = CASE WHEN lower(coalesce(name,'') || ' ' || coalesce(model,'')) ~ '(activa|access|scooty|scooter)' THEN 'scooter' ELSE 'bike' END
WHERE fleet_vehicle_class IS NULL OR fleet_vehicle_class='bike';

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_registration_unique_idx ON vehicles(registration_number) WHERE registration_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicles_rideon_operational_idx ON vehicles(fleet_vehicle_class,city,operational_state,active);

CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  inspection_type VARCHAR(24) NOT NULL CHECK (inspection_type IN ('pickup','return','maintenance','routine')),
  odometer INTEGER,
  fuel_battery NUMERIC(5,2),
  exterior_condition TEXT,
  damage_notes TEXT,
  inspection_status VARCHAR(24) NOT NULL CHECK (inspection_status IN ('pending','passed','failed','damage_review')),
  condition_photos TEXT[] NOT NULL DEFAULT '{}',
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  inspected_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (odometer IS NULL OR odometer >= 0),
  CHECK (fuel_battery IS NULL OR fuel_battery BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS vehicle_inspections_vehicle_idx ON vehicle_inspections(vehicle_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_inspections_booking_idx ON vehicle_inspections(booking_id, inspected_at DESC);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL CHECK (status IN ('required','scheduled','started','completed')),
  notes TEXT,
  cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (cost_paise >= 0),
  service_date TIMESTAMPTZ,
  next_service_date TIMESTAMPTZ,
  odometer_at_service INTEGER CHECK (odometer_at_service IS NULL OR odometer_at_service >= 0),
  created_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_idx ON vehicle_maintenance(vehicle_id,created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_status_idx ON vehicle_maintenance(status,updated_at DESC);

CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  assignment_type VARCHAR(24) NOT NULL CHECK (assignment_type IN ('delivery','pickup','return')),
  staff_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','started','completed','cancelled')),
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_assignments_staff_idx ON vehicle_assignments(staff_user_id,status,scheduled_at);
CREATE INDEX IF NOT EXISTS vehicle_assignments_booking_idx ON vehicle_assignments(booking_id,status);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pickup_location TEXT,
  ADD COLUMN IF NOT EXISTS assigned_staff_user_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_fulfillment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_received_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bookings_assigned_staff_idx ON bookings(assigned_staff_user_id,delivery_status,scheduled_fulfillment_at);

CREATE TABLE IF NOT EXISTS fleet_operation_audit (
  id BIGSERIAL PRIMARY KEY,
  vehicle_id VARCHAR(64) REFERENCES vehicles(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  previous_state TEXT,
  next_state TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_operation_audit_vehicle_idx ON fleet_operation_audit(vehicle_id,created_at DESC);
CREATE INDEX IF NOT EXISTS fleet_operation_audit_booking_idx ON fleet_operation_audit(booking_id,created_at DESC);

-- New RideOn fleet bookings must never depend on vendor ownership.
UPDATE fleet_orders SET fleet_owner='rideon' WHERE fleet_owner IS NULL;
