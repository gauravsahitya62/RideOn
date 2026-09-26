-- Forward-only RideOn operations roles and pickup coordinates.
-- Legacy vendor roles/data remain untouched for historical compatibility.

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_role_check;
ALTER TABLE customers ADD CONSTRAINT customers_role_check
  CHECK (role IN ('customer','vendor','support','admin','delivery_staff'));

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS pickup_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS pickup_longitude NUMERIC(9,6);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_pickup_latitude_range') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_pickup_latitude_range CHECK (pickup_latitude IS NULL OR pickup_latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_pickup_longitude_range') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_pickup_longitude_range CHECK (pickup_longitude IS NULL OR pickup_longitude BETWEEN -180 AND 180);
  END IF;
END $$;

ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS staff_user_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE tracking_sessions ALTER COLUMN vendor_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tracking_sessions_owner_actor_check') THEN
    ALTER TABLE tracking_sessions ADD CONSTRAINT tracking_sessions_owner_actor_check
      CHECK (vendor_id IS NOT NULL OR staff_user_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tracking_sessions_staff_lookup_idx
  ON tracking_sessions(staff_user_id,status,last_location_at DESC);
