-- RideOn performance/scalability indexes.
-- Forward-only. Existing migrations and production data are not modified.

CREATE INDEX IF NOT EXISTS vehicles_active_city_name_idx
  ON vehicles(active, lower(trim(city)), name);

CREATE INDEX IF NOT EXISTS vehicles_active_type_name_idx
  ON vehicles(active, type, name);

CREATE INDEX IF NOT EXISTS vehicles_owner_active_created_idx
  ON vehicles(owner_id, active, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_customer_created_idx
  ON bookings(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_vehicle_window_active_idx
  ON bookings(vehicle_id, start_at, end_at)
  WHERE status IN ('requested','confirmed','in_progress');

CREATE INDEX IF NOT EXISTS tracking_sessions_booking_status_idx
  ON tracking_sessions(booking_id, status);

CREATE INDEX IF NOT EXISTS support_tickets_raised_updated_idx
  ON support_tickets(raised_by_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS support_tickets_status_updated_idx
  ON support_tickets(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_created_idx
  ON ticket_messages(ticket_id, created_at ASC);

CREATE INDEX IF NOT EXISTS reviews_booking_reviewer_type_idx
  ON reviews(booking_id, reviewer_user_id, review_type);

CREATE INDEX IF NOT EXISTS reviews_created_idx
  ON reviews(created_at DESC);

CREATE INDEX IF NOT EXISTS financial_transactions_booking_type_status_idx
  ON financial_transactions(booking_id, transaction_type, status);

CREATE INDEX IF NOT EXISTS security_deposits_status_updated_idx
  ON security_deposits(status, updated_at DESC);
