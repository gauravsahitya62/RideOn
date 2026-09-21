-- OTP-based customer authentication support.
-- OTP codes are short-lived, single-use, and stored only as hashes.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('phone','email')),
  destination VARCHAR(254) NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_otps_destination_idx ON auth_otps(destination, channel, created_at DESC);
