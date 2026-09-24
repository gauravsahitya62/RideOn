-- Multi-city marketplace policy.
-- A vendor may have a primary service city, but every vehicle has its own
-- service/listing city. Customer inventory is filtered by vehicles.city.
-- This supersedes the temporary Udaipur-only policy from 013_udaipur_only.sql.
--
-- Do not rewrite active flags here: active/inactive is vendor-controlled and
-- must not be inferred from the historical city restriction.
CREATE INDEX IF NOT EXISTS vehicles_active_city_lower_idx
  ON vehicles ((lower(trim(city)))) WHERE active = true;
