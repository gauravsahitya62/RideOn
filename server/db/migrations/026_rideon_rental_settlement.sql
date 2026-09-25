-- Forward-only RideOn own-fleet rental settlement support.
-- Adds durable provider-confirmation-safe settlement requests and in-app rental notifications.
-- Existing migration files are intentionally not modified.

CREATE TABLE IF NOT EXISTS security_deposit_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  original_amount_paise BIGINT NOT NULL CHECK (original_amount_paise >= 0),
  approved_deduction_paise BIGINT NOT NULL DEFAULT 0 CHECK (approved_deduction_paise >= 0),
  refundable_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (refundable_amount_paise >= 0),
  settlement_type VARCHAR(24) NOT NULL CHECK (settlement_type IN ('release','deduction')),
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','confirmed','failed','cancelled')),
  provider VARCHAR(64),
  provider_reference VARCHAR(255),
  evidence_reference TEXT,
  reason TEXT,
  requested_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  confirmed_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_deposit_settlements_status_idx
  ON security_deposit_settlements(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS rental_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  notification_type VARCHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rental_notifications_customer_idx
  ON rental_notifications(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rental_notifications_booking_idx
  ON rental_notifications(booking_id, created_at DESC);
