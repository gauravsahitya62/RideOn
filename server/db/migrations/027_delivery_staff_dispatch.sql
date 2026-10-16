-- Forward-only delivery staff dispatch support.
-- Reuses vehicle_assignments/tracking_sessions; no existing migration is modified.

CREATE INDEX IF NOT EXISTS vehicle_assignments_dispatch_idx
  ON vehicle_assignments(assignment_type,status,scheduled_at,created_at);

CREATE INDEX IF NOT EXISTS bookings_delivery_dispatch_idx
  ON bookings(status,payment_status,delivery_required,assigned_staff_user_id,start_at);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pickup_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_requested_by UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_pickup_request_idx
  ON bookings(pickup_requested_at,return_requested_at,lifecycle_state);

ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS staff_user_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tracking_sessions_staff_booking_idx
  ON tracking_sessions(staff_user_id,booking_id,status,last_location_at DESC);
