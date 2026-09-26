-- Forward-only Maps and delivery-location foundation.
-- Vendor coordinates are service/pickup coordinates, not private home coordinates.
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS service_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS service_longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS service_address TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vendors_service_latitude_range') THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_service_latitude_range CHECK (service_latitude IS NULL OR service_latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vendors_service_longitude_range') THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_service_longitude_range CHECK (service_longitude IS NULL OR service_longitude BETWEEN -180 AND 180);
  END IF;
END $$;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS delivery_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS vendor_service_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS vendor_service_longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS route_distance_meters INTEGER,
  ADD COLUMN IF NOT EXISTS route_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS route_provider VARCHAR(40);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_delivery_latitude_range') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_delivery_latitude_range CHECK (delivery_latitude IS NULL OR delivery_latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_delivery_longitude_range') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_delivery_longitude_range CHECK (delivery_longitude IS NULL OR delivery_longitude BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_vendor_service_latitude_range') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_vendor_service_latitude_range CHECK (vendor_service_latitude IS NULL OR vendor_service_latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_vendor_service_longitude_range') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_vendor_service_longitude_range CHECK (vendor_service_longitude IS NULL OR vendor_service_longitude BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_route_distance_nonnegative') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_route_distance_nonnegative CHECK (route_distance_meters IS NULL OR route_distance_meters >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_route_duration_nonnegative') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_route_duration_nonnegative CHECK (route_duration_seconds IS NULL OR route_duration_seconds >= 0);
  END IF;
END $$;

UPDATE vendors
SET service_address = COALESCE(service_address, address)
WHERE service_address IS NULL AND address IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendors_service_location_idx
  ON vendors(service_city, service_latitude, service_longitude)
  WHERE service_latitude IS NOT NULL AND service_longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_delivery_location_idx
  ON bookings(delivery_latitude, delivery_longitude)
  WHERE delivery_latitude IS NOT NULL AND delivery_longitude IS NOT NULL;
