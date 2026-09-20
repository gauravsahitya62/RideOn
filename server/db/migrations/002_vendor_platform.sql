-- RideOn vendor platform extension. Apply after 001_initial.sql.
-- Keep vehicle ownership and vendor permissions in the database; API must
-- enforce authorization on every vendor mutation.

DO $$ BEGIN
  CREATE TYPE vendor_status AS ENUM ('pending','approved','suspended','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_customer_id UUID NOT NULL UNIQUE REFERENCES customers(id),
  business_name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(100) NOT NULL,
  support_phone VARCHAR(16) NOT NULL,
  support_email VARCHAR(254),
  status vendor_status NOT NULL DEFAULT 'pending',
  service_city VARCHAR(100) NOT NULL,
  service_area JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_available BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing owner_id was intentionally nullable for seeded demo inventory.
-- New vendor-created vehicles must always have an approved vendor owner.
DO $$ BEGIN
  ALTER TABLE vehicles ADD CONSTRAINT vehicles_owner_vendor_fk
    FOREIGN KEY (owner_id) REFERENCES vendors(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS vehicles_active_city_type_idx
  ON vehicles(city, type) WHERE active = true;
CREATE INDEX IF NOT EXISTS vehicles_owner_created_idx
  ON vehicles(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vendors_status_city_idx
  ON vendors(status, service_city);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(24) NOT NULL DEFAULT 'not_started'
    CHECK (delivery_status IN ('not_started','assigned','picked_up','on_the_way','delivered','return_due','returned','issue')),
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

CREATE INDEX IF NOT EXISTS bookings_vendor_created_idx
  ON bookings(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_status_start_idx
  ON bookings(status, start_at);

CREATE TABLE IF NOT EXISTS vendor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  gross_paise BIGINT NOT NULL CHECK (gross_paise >= 0),
  platform_fee_paise BIGINT NOT NULL CHECK (platform_fee_paise >= 0),
  net_paise BIGINT NOT NULL CHECK (net_paise >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','paid','failed','reversed')),
  provider_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (gross_paise >= platform_fee_paise),
  CHECK (net_paise = gross_paise - platform_fee_paise)
);
CREATE INDEX IF NOT EXISTS vendor_payouts_vendor_status_idx
  ON vendor_payouts(vendor_id, status, created_at DESC);

-- Booking-to-vendor ownership is populated from the selected vehicle in the
-- API transaction for new bookings. Backfill existing rows where possible.
UPDATE bookings b SET vendor_id = v.owner_id
FROM vehicles v
WHERE b.vehicle_id = v.id AND b.vendor_id IS NULL AND v.owner_id IS NOT NULL;
