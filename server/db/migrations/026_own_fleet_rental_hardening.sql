-- Forward-only hardening for RideOn-owned rental lifecycle.
-- Never rewrite or remove an already-applied migration.

ALTER TABLE bookings
  ADD CONSTRAINT bookings_lifecycle_state_allowed
  CHECK (lifecycle_state IN (
    'CONFIRMED','DELIVERY_ASSIGNED','PICKUP_ASSIGNED','DELIVERY_STARTED',
    'READY_FOR_PICKUP','HANDED_OVER','ACTIVE_RENTAL','RETURN_REQUESTED',
    'RETURNED','INSPECTION','COMPLETED','DAMAGE_REVIEW_REQUIRED','OVERDUE'
  ));

ALTER TABLE fleet_damage_cases
  ADD CONSTRAINT fleet_damage_cases_approved_within_estimate
  CHECK (approved_deduction_paise <= estimated_amount_paise);

CREATE UNIQUE INDEX IF NOT EXISTS rental_handovers_one_per_booking_idx
  ON rental_handovers(booking_id);

CREATE UNIQUE INDEX IF NOT EXISTS rental_returns_one_per_booking_idx
  ON rental_returns(booking_id);

CREATE INDEX IF NOT EXISTS bookings_fleet_active_window_idx
  ON bookings(vehicle_id,start_at,end_at)
  WHERE status IN ('requested','confirmed','in_progress')
    AND lifecycle_state NOT IN ('RETURNED','INSPECTION','COMPLETED','DAMAGE_REVIEW_REQUIRED');

CREATE INDEX IF NOT EXISTS fleet_damage_cases_pending_idx
  ON fleet_damage_cases(updated_at DESC)
  WHERE status IN ('reported','under_review','disputed');

CREATE INDEX IF NOT EXISTS security_deposits_settlement_queue_idx
  ON security_deposits(updated_at DESC)
  WHERE status IN ('held','settlement_pending','release_pending');

-- PostgreSQL partial uniqueness used for operational idempotency:
-- exactly one handover and one return record may exist for each booking.
