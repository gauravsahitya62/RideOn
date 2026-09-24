-- Forward-only booking return and security-deposit lifecycle support.
-- Does not alter already-applied migrations or production data.
ALTER TABLE security_deposits
  ADD COLUMN IF NOT EXISTS deduction_reason TEXT,
  ADD COLUMN IF NOT EXISTS evidence_reference TEXT,
  ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspected_by UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS security_deposits_status_updated_idx
  ON security_deposits(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS security_deposits_booking_unique_idx
  ON security_deposits(booking_id);

