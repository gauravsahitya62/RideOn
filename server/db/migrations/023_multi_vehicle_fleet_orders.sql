-- Forward-only multi-vehicle fleet booking architecture.
-- Existing one-vehicle bookings remain the operational source of truth.
-- fleet_orders groups those child bookings into one customer checkout/order.

CREATE TABLE IF NOT EXISTS fleet_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_owner VARCHAR(32) NOT NULL DEFAULT 'rideon',
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  fleet_owner VARCHAR(32) NOT NULL DEFAULT 'rideon',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  delivery_required BOOLEAN NOT NULL DEFAULT true,
  delivery_address TEXT NOT NULL,
  rental_total_paise BIGINT NOT NULL CHECK (rental_total_paise >= 0),
  delivery_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_paise >= 0),
  platform_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_paise >= 0),
  security_deposit_paise BIGINT NOT NULL DEFAULT 0 CHECK (security_deposit_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise >= 0),
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  status VARCHAR(24) NOT NULL DEFAULT 'requested',
  idempotency_key VARCHAR(128),
  quote_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS fleet_orders_customer_created_idx
  ON fleet_orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fleet_order_items (
  id BIGSERIAL PRIMARY KEY,
  fleet_order_id UUID NOT NULL REFERENCES fleet_orders(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  line_rental_total_paise BIGINT NOT NULL CHECK (line_rental_total_paise >= 0),
  line_delivery_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (line_delivery_fee_paise >= 0),
  line_platform_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (line_platform_fee_paise >= 0),
  line_security_deposit_paise BIGINT NOT NULL DEFAULT 0 CHECK (line_security_deposit_paise >= 0),
  line_total_paise BIGINT NOT NULL CHECK (line_total_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fleet_order_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS fleet_order_items_order_idx
  ON fleet_order_items(fleet_order_id);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS fleet_order_id UUID REFERENCES fleet_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_fleet_order_idx
  ON bookings(fleet_order_id);
