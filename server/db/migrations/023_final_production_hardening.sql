-- Final production hardening: query/index support only.
-- No existing data is deleted or rewritten. Existing migrations remain unchanged.

CREATE INDEX IF NOT EXISTS bookings_vehicle_status_window_idx
  ON bookings(vehicle_id, status, start_at, end_at);

CREATE INDEX IF NOT EXISTS payments_status_updated_idx
  ON payments(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS payment_events_booking_created_idx
  ON payment_events(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customers_role_status_idx
  ON customers(role, account_status);

CREATE INDEX IF NOT EXISTS vendors_owner_status_idx
  ON vendors(owner_customer_id, status);

CREATE INDEX IF NOT EXISTS tracking_sessions_active_location_idx
  ON tracking_sessions(status, last_location_at DESC);

CREATE INDEX IF NOT EXISTS reviews_rating_created_idx
  ON reviews(rating, created_at DESC);
