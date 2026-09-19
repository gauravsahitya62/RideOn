-- RideOn PostgreSQL production foundation migration.
-- Apply after creating the database. This migration is intentionally SQL-only so it
-- can be used by psql, CI, or a future migration runner.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE vehicle_type AS ENUM ('car','bike');
CREATE TYPE booking_status AS ENUM ('requested','confirmed','in_progress','completed','cancelled','rejected');
CREATE TYPE payment_status AS ENUM ('unpaid','pending','paid','refunded','failed');

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(16) NOT NULL UNIQUE,
  email VARCHAR(254),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID,
  type vehicle_type NOT NULL,
  name VARCHAR(160),
  make VARCHAR(80),
  model VARCHAR(100),
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

CREATE TABLE IF NOT EXISTS bookings (
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
  payment_provider_reference TEXT,
  customer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('requested','confirmed','in_progress'))
);

CREATE INDEX IF NOT EXISTS bookings_vehicle_window_idx ON bookings(vehicle_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_customer_created_idx ON bookings(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  previous_status booking_status,
  next_status booking_status NOT NULL,
  actor_type VARCHAR(30) NOT NULL,
  actor_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL,
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider_event_id VARCHAR(255) NOT NULL UNIQUE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status payment_status NOT NULL,
  provider_reference TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
