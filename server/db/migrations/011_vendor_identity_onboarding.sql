-- Vendor identity/onboarding hardening.
-- Keep Supabase Auth as the single authentication identity and map it to the
-- existing RideOn customer -> vendor relationship.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS supabase_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS customers_supabase_user_id_uidx
  ON customers(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

-- A vendor is represented only by the existing vendors row.
CREATE UNIQUE INDEX IF NOT EXISTS vendors_owner_customer_uidx
  ON vendors(owner_customer_id);

-- Make vendor creation safe for concurrent registration retries.
CREATE OR REPLACE FUNCTION rideon_ensure_vendor_for_customer(
  p_customer_id UUID,
  p_business_name VARCHAR DEFAULT NULL,
  p_contact_name VARCHAR DEFAULT NULL,
  p_phone VARCHAR DEFAULT NULL,
  p_email VARCHAR DEFAULT NULL,
  p_service_city VARCHAR DEFAULT 'Jaipur'
) RETURNS vendors
LANGUAGE plpgsql
AS $$
DECLARE
  result vendors;
  customer customers;
BEGIN
  SELECT * INTO customer FROM customers WHERE id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO result FROM vendors
  WHERE owner_customer_id=p_customer_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN result;
  END IF;

  INSERT INTO vendors(
    owner_customer_id,business_name,contact_name,phone,email,address,
    support_phone,support_email,status,service_city,service_area
  )
  VALUES(
    p_customer_id,
    COALESCE(NULLIF(p_business_name,''),customer.full_name,'RideOn Vendor'),
    COALESCE(NULLIF(p_contact_name,''),customer.full_name,'Vendor'),
    COALESCE(NULLIF(p_phone,''),CASE WHEN customer.phone LIKE 'supabase-%' THEN '' ELSE customer.phone END,''),
    COALESCE(NULLIF(p_email,''),customer.email,''),
    COALESCE(NULLIF(p_service_city,''),'Jaipur'),
    COALESCE(NULLIF(p_phone,''),CASE WHEN customer.phone LIKE 'supabase-%' THEN '' ELSE customer.phone END,''),
    COALESCE(NULLIF(p_email,''),customer.email),
    'active',
    COALESCE(NULLIF(p_service_city,''),'Jaipur'),
    '{}'::jsonb
  )
  ON CONFLICT(owner_customer_id) DO NOTHING
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    SELECT * INTO result FROM vendors WHERE owner_customer_id=p_customer_id;
  END IF;

  RETURN result;
END;
$$;

-- Enforce one RideOn customer -> at most one vendor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='vendors_owner_customer_id_key'
  ) THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_owner_customer_id_key UNIQUE(owner_customer_id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP FUNCTION IF EXISTS rideon_ensure_vendor_for_customer(
  UUID,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR
);
