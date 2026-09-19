-- RideOn PostgreSQL MVP schema. Apply with a migration tool in deployed environments.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE vehicle_type AS ENUM ('car','bike');
CREATE TYPE booking_status AS ENUM ('requested','confirmed','in_progress','completed','cancelled','rejected');
CREATE TYPE payment_status AS ENUM ('unpaid','pending','paid','refunded','failed');
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(16) NOT NULL UNIQUE,
  email VARCHAR(254),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID,
  type vehicle_type NOT NULL,
  make VARCHAR(80) NOT NULL,
  model VARCHAR(100) NOT NULL,
  year SMALLINT,
  city VARCHAR(100) NOT NULL,
  daily_rate_paise INTEGER NOT NULL CHECK (daily_rate_paise >= 0),
  security_deposit_paise INTEGER NOT NULL DEFAULT 0 CHECK (security_deposit_paise >= 0),
  transmission VARCHAR(30),
  fuel VARCHAR(30),
  seats SMALLINT,
  registration_number VARCHAR(30) UNIQUE,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  delivery_required BOOLEAN NOT NULL DEFAULT true,
  delivery_address TEXT NOT NULL,
  delivery_fee_paise INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_paise >= 0),
  rental_total_paise INTEGER NOT NULL CHECK (rental_total_paise >= 0),
  platform_fee_paise INTEGER NOT NULL DEFAULT 0 CHECK (platform_fee_paise >= 0),
  total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
  status booking_status NOT NULL DEFAULT 'requested',
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  customer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  -- Enforced by PostgreSQL across concurrent requests and API instances.
  EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('requested', 'confirmed', 'in_progress'))
);
CREATE INDEX bookings_vehicle_window_idx ON bookings(vehicle_id, start_at, end_at);
CREATE INDEX bookings_customer_created_idx ON bookings(customer_id, created_at DESC);
CREATE TABLE booking_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  previous_status booking_status,
  next_status booking_status NOT NULL,
  actor_type VARCHAR(30) NOT NULL,
  actor_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
