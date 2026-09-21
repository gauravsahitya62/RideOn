-- Link RideOn customers to Supabase Auth users.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS supabase_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS customers_supabase_user_id_uidx
  ON customers(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;
