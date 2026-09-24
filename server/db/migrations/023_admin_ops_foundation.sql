-- RideOn Admin/Ops foundation. Forward-only; never edit previously applied migrations.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'customers'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%IN%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE customers DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS account_status VARCHAR(16) NOT NULL DEFAULT 'active';

ALTER TABLE customers
  ADD CONSTRAINT customers_account_status_allowed
  CHECK (account_status IN ('active','suspended'));

ALTER TABLE customers
  ADD CONSTRAINT customers_role_allowed_v2
  CHECK (role IN ('customer','vendor','support','admin'));

CREATE INDEX IF NOT EXISTS customers_role_account_status_idx
  ON customers(role, account_status, created_at DESC);

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16) NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS moderation_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='reviews_moderation_status_allowed'
  ) THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_moderation_status_allowed
      CHECK (moderation_status IN ('visible','hidden'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reviews_moderation_status_created_idx
  ON reviews(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
  ON admin_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_admin_created_idx
  ON admin_audit_logs(admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_entity_idx
  ON admin_audit_logs(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION rideon_prevent_admin_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_logs_append_only ON admin_audit_logs;
CREATE TRIGGER admin_audit_logs_append_only
BEFORE UPDATE OR DELETE ON admin_audit_logs
FOR EACH ROW EXECUTE FUNCTION rideon_prevent_admin_audit_mutation();

CREATE INDEX IF NOT EXISTS bookings_vendor_status_created_idx
  ON bookings(vendor_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_status_created_idx
  ON payments(status, created_at DESC);

CREATE INDEX IF NOT EXISTS vehicles_active_created_idx
  ON vehicles(active, created_at DESC);
