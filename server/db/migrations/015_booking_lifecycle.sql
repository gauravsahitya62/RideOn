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

-- The deposit table already exists from migration 010. These indexes make
-- customer/vendor lifecycle reads deterministic and inexpensive.
CREATE INDEX IF NOT EXISTS security_deposits_booking_status_idx
  ON security_deposits(booking_id,status,updated_at DESC);

-- One logical refund request per payment. Repeated client taps/retries must
-- resolve to the same financial transaction rather than creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_refund_once_idx
  ON financial_transactions(booking_id,transaction_type)
  WHERE transaction_type = 'refund';
