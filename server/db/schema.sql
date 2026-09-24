-- RideOn PostgreSQL schema/migration source of truth.
-- Public vehicle IDs are stable text identifiers such as creta-01.
-- API prices are represented in INR rupees; every *_paise column stores integer paise.
-- The statements below are safe to re-run for fresh databases and seeded fleet rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN CREATE TYPE vehicle_type AS ENUM ('car','bike'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE booking_status AS ENUM ('requested','confirmed','in_progress','completed','cancelled','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $ BEGIN CREATE TYPE payment_status AS ENUM ('unpaid','pending','paid','held','settlement_pending','settled','refund_pending','refunded','failed','disputed'); EXCEPTION WHEN duplicate_object THEN NULL; END $;

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
  id VARCHAR(64) PRIMARY KEY,
  owner_id UUID,
  type vehicle_type NOT NULL,
  name VARCHAR(160),
  make VARCHAR(80),
  model VARCHAR(100),
  year SMALLINT,
  city VARCHAR(100) NOT NULL,
  daily_rate_paise BIGINT NOT NULL CHECK (daily_rate_paise >= 0),
  security_deposit_paise BIGINT NOT NULL DEFAULT 0 CHECK (security_deposit_paise >= 0),
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
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  delivery_required BOOLEAN NOT NULL DEFAULT true,
  delivery_address TEXT NOT NULL,
  delivery_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_paise >= 0),
  rental_total_paise BIGINT NOT NULL CHECK (rental_total_paise >= 0),
  platform_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise >= 0),
  status booking_status NOT NULL DEFAULT 'requested',
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  payment_provider_reference TEXT,
  customer_notes TEXT,
  cancellation_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (cancellation_fee_paise >= 0),
  refund_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (refund_amount_paise >= 0),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CONSTRAINT bookings_vehicle_window_excl EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('requested','confirmed','in_progress'))
);

CREATE INDEX IF NOT EXISTS bookings_vehicle_window_idx ON bookings(vehicle_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_customer_created_idx ON bookings(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_status_created_idx ON bookings(status, created_at DESC);

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

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  provider_order_id VARCHAR(255),
  provider_payment_id VARCHAR(255),
  provider_reference TEXT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status payment_status NOT NULL DEFAULT 'unpaid',
  idempotency_key VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_booking_active_order_idx
  ON payments(booking_id)
  WHERE status IN ('unpaid','pending');

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_order_idx
  ON payments(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_idx
  ON payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_booking_created_idx
  ON payments(booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT,
  original_amount_paise BIGINT NOT NULL CHECK (original_amount_paise >= 0),
  refundable_amount_paise BIGINT NOT NULL CHECK (refundable_amount_paise >= 0),
  approved_deduction_paise BIGINT NOT NULL DEFAULT 0 CHECK (approved_deduction_paise >= 0),
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  provider VARCHAR(40),
  provider_transaction_id VARCHAR(255),
  refund_provider_reference VARCHAR(255),
  deduction_reason TEXT,
  evidence_reference TEXT,
  dispute_status VARCHAR(40),
  idempotency_key VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ,
  CHECK (approved_deduction_paise <= original_amount_paise),
  CHECK (refundable_amount_paise + approved_deduction_paise = original_amount_paise)
);
CREATE INDEX IF NOT EXISTS security_deposits_booking_status_idx ON security_deposits(booking_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider_event_id VARCHAR(255) NOT NULL UNIQUE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status payment_status NOT NULL,
  provider_reference TEXT,
  amount_paise BIGINT,
  currency VARCHAR(3) DEFAULT 'INR',
  provider_order_id VARCHAR(255),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Stable public IDs matching the mobile/API catalogue.
INSERT INTO vehicles (
  id, type, name, make, model, city, daily_rate_paise, active, transmission, fuel, seats
)
VALUES
  ('creta-01', 'car', 'Hyundai Creta', 'Hyundai', 'Creta', 'Jaipur', 249900, true, 'Automatic', 'Petrol', 5),
  ('baleno-01', 'car', 'Maruti Baleno', 'Maruti', 'Baleno', 'Jaipur', 149900, true, 'Manual', 'Petrol', 5),
  ('classic-01', 'bike', 'Royal Enfield Classic 350', 'Royal Enfield', 'Classic 350', 'Jaipur', 99900, true, NULL, NULL, 2),
  ('activa-01', 'bike', 'Honda Activa 6G', 'Honda', 'Activa 6G', 'Jaipur', 49900, true, 'Automatic', 'Petrol', 2)
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  name = EXCLUDED.name,
  make = EXCLUDED.make,
  model = EXCLUDED.model,
  city = EXCLUDED.city,
  daily_rate_paise = EXCLUDED.daily_rate_paise,
  active = EXCLUDED.active,
  transmission = EXCLUDED.transmission,
  fuel = EXCLUDED.fuel,
  seats = EXCLUDED.seats;
