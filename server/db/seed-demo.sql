-- Idempotent demo fleet seed for a fresh RideOn PostgreSQL database.
-- Run after schema.sql. IDs are deterministic UUIDs so the app/API can map stable
-- public vehicle slugs to database rows without relying on generated UUIDs.
INSERT INTO vehicles
  (id, type, make, model, year, city, daily_rate_paise, transmission, fuel, seats, active)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'car', 'Hyundai', 'Creta', 2024, 'Jaipur', 249900, 'Automatic', 'Petrol', 5, true),
  ('00000000-0000-4000-8000-000000000002', 'car', 'Maruti', 'Baleno', 2024, 'Jaipur', 149900, 'Manual', 'Petrol', 5, true),
  ('00000000-0000-4000-8000-000000000003', 'bike', 'Royal Enfield', 'Classic 350', 2024, 'Jaipur', 99900, NULL, NULL, 2, true),
  ('00000000-0000-4000-8000-000000000004', 'bike', 'Honda', 'Activa 6G', 2024, 'Jaipur', 49900, 'Automatic', 'Petrol', 2, true)
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  make = EXCLUDED.make,
  model = EXCLUDED.model,
  year = EXCLUDED.year,
  city = EXCLUDED.city,
  daily_rate_paise = EXCLUDED.daily_rate_paise,
  transmission = EXCLUDED.transmission,
  fuel = EXCLUDED.fuel,
  seats = EXCLUDED.seats,
  active = EXCLUDED.active;
