-- Auth contract hardening for customer/vendor onboarding.
-- Keeps Supabase Auth as the authentication source while ensuring the
-- RideOn identity schema exists before the server queries it.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer','vendor'));

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS supabase_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS customers_supabase_user_id_uidx
  ON customers(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE vendors
    ADD CONSTRAINT vendors_owner_customer_uidx UNIQUE (owner_customer_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS customers_email_lower_idx
  ON customers ((lower(email)))
  WHERE email IS NOT NULL;
