-- Remove the four demo vehicles inserted by 001_initial.sql.
-- Preserve booking history: deactivate any demo vehicle referenced by a booking,
-- and delete only unreferenced demo rows.

UPDATE vehicles
SET active = false
WHERE id IN ('creta-01', 'baleno-01', 'classic-01', 'activa-01')
  AND EXISTS (
    SELECT 1
    FROM bookings
    WHERE bookings.vehicle_id = vehicles.id
  );

DELETE FROM vehicles
WHERE id IN ('creta-01', 'baleno-01', 'classic-01', 'activa-01')
  AND NOT EXISTS (
    SELECT 1
    FROM bookings
    WHERE bookings.vehicle_id = vehicles.id
  );
