-- Persist the server-authoritative security deposit on each booking.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS security_deposit_paise BIGINT NOT NULL DEFAULT 0
    CHECK (security_deposit_paise >= 0);
