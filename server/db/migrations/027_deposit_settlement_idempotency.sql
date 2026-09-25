-- Forward-only idempotency metadata for provider-backed deposit settlement.
ALTER TABLE security_deposits
  ADD COLUMN IF NOT EXISTS settlement_idempotency_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS settlement_provider_reference VARCHAR(255),
  ADD COLUMN IF NOT EXISTS settlement_attempted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS security_deposits_settlement_key_idx
  ON security_deposits(settlement_idempotency_key)
  WHERE settlement_idempotency_key IS NOT NULL;

ALTER TABLE security_deposits ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
