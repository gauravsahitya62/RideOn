-- Forward-only fix for legacy delivery_status defaults.
-- Some production databases retained a legacy default of 'not_started' even
-- after the live-tracking constraint was introduced. New bookings must use
-- the normalized tracking lifecycle value 'scheduled'.

ALTER TABLE bookings
  ALTER COLUMN delivery_status SET DEFAULT 'scheduled';

-- Normalize any legacy value if present. This is safe under the normalized
-- constraint because 'not_started' is not an allowed lifecycle state.
UPDATE bookings
SET delivery_status = 'scheduled'
WHERE delivery_status = 'not_started';
