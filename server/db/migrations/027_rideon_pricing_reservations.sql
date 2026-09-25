-- Forward-only RideOn own-fleet pricing/reservation support.
-- Does not modify or reset existing data.
CREATE TABLE IF NOT EXISTS rideon_pricing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  daily_rate_paise BIGINT NOT NULL CHECK (daily_rate_paise >= 0),
  security_deposit_paise BIGINT NOT NULL CHECK (security_deposit_paise >= 0),
  delivery_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_paise >= 0),
  pricing_active BOOLEAN NOT NULL DEFAULT TRUE,
  changed_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rideon_pricing_history_vehicle_idx ON rideon_pricing_history(vehicle_id,created_at DESC);

CREATE TABLE IF NOT EXISTS rideon_vehicle_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','released','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  UNIQUE (customer_id,idempotency_key),
  UNIQUE (vehicle_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS rideon_vehicle_reservations_lookup_idx
  ON rideon_vehicle_reservations(vehicle_id,start_at,end_at,status,expires_at);
