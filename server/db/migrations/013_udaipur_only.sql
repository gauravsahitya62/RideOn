-- RideOn currently serves Udaipur only.
-- Disable legacy/demo inventory in other cities without changing ownership or pricing.
UPDATE vehicles
SET active = false,
    updated_at = now()
WHERE lower(trim(city)) <> 'udaipur';

-- Keep vendor service-area data aligned with the current operating city.
UPDATE vendors
SET service_city = 'Udaipur',
    updated_at = now()
WHERE lower(trim(service_city)) <> 'udaipur';
