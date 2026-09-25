-- Forward-only RideOn reservation grouping.
-- Existing rows are preserved; each pre-existing reservation receives its own group.
ALTER TABLE rideon_vehicle_reservations
  ADD COLUMN IF NOT EXISTS reservation_group_id UUID;

UPDATE rideon_vehicle_reservations
SET reservation_group_id = COALESCE(reservation_group_id, id)
WHERE reservation_group_id IS NULL;

ALTER TABLE rideon_vehicle_reservations
  ALTER COLUMN reservation_group_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS rideon_vehicle_reservations_group_idx
  ON rideon_vehicle_reservations(reservation_group_id,status,expires_at);
