-- Booking/payment lifecycle hardening.
-- Existing payment_status is shared by bookings and payments, so extend the enum
-- instead of introducing a second incompatible state column.
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'held';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'settlement_pending';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'settled';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'refund_pending';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'disputed';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancellation_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (cancellation_fee_paise >= 0),
  ADD COLUMN IF NOT EXISTS refund_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (refund_amount_paise >= 0),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE INDEX IF NOT EXISTS bookings_status_created_idx ON bookings(status,created_at DESC);

-- Older production databases may already have migration 010 recorded while
-- lacking the newer lifecycle tables. Make this migration self-healing.
CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  transaction_type VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_transaction_id VARCHAR(255),
  idempotency_key VARCHAR(128),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_provider_ref_idx
  ON financial_transactions(provider,provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_transactions_booking_idx
  ON financial_transactions(booking_id,created_at DESC);

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
CREATE INDEX IF NOT EXISTS security_deposits_status_idx
  ON security_deposits(status,updated_at DESC);

-- The deposit table already exists from migration 010. These indexes make
-- customer/vendor lifecycle reads deterministic and inexpensive.
CREATE INDEX IF NOT EXISTS security_deposits_booking_status_idx
  ON security_deposits(booking_id,status,updated_at DESC);

-- One logical refund request per payment. Repeated client taps/retries must
-- resolve to the same financial transaction rather than creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_refund_once_idx
  ON financial_transactions(booking_id,transaction_type)
  WHERE transaction_type = 'refund';
