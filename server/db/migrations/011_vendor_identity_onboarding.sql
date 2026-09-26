-- Vendor identity/onboarding hardening.
-- Keep Supabase Auth as the single authentication identity and map it to the
-- existing RideOn customer -> vendor relationship.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS supabase_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS customers_supabase_user_id_uidx
  ON customers(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vendors_owner_customer_uidx
  ON vendors(owner_customer_id);
