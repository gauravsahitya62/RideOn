-- Persist provider-specific payment attempts separately from booking state.
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

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(255);

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS amount_paise BIGINT;

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'INR';
