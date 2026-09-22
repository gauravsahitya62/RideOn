-- RideOn vendor marketplace MVP. Apply after 002_vendor_platform.sql.
-- Keeps the existing customer/venders model and adds only the fields needed for
-- persisted onboarding, fleet management, customer inventory, and vendor bookings.

DO $$ BEGIN
  ALTER TYPE vendor_status RENAME VALUE 'approved' TO 'active';
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(16),
  ADD COLUMN IF NOT EXISTS email VARCHAR(254);

UPDATE vendors
SET phone = coalesce(phone, support_phone),
    email = coalesce(email, support_email),
    address = coalesce(address, service_city);


CREATE INDEX IF NOT EXISTS vendors_owner_status_idx
  ON vendors(owner_customer_id, status);

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS vehicles_vendor_active_idx
  ON vehicles(owner_id, active, created_at DESC);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT;

UPDATE bookings b
SET vendor_id = v.owner_id
FROM vehicles v
WHERE b.vendor_id IS NULL
  AND v.owner_id IS NOT NULL
  AND b.vehicle_id = v.id;

CREATE INDEX IF NOT EXISTS bookings_vendor_status_created_idx
  ON bookings(vendor_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_vehicle_created_idx
  ON bookings(vehicle_id, created_at DESC);
