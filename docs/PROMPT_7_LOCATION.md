# Prompt 7 — location, addresses, maps, and delivery

## Current implementation
- Location selection can be built from the cities actually returned by the existing vehicle catalog; no new service-area endpoint is assumed.
- Saved addresses are local prototype data in the existing app session. They are not synchronized to the backend.
- Doorstep delivery uses the existing booking `delivery` boolean and `address` string contract. The server currently applies its own demo delivery pricing.
- No real map provider is configured in the Expo project. This implementation intentionally does not present a fake map or invent map credentials.

## Map / geolocation follow-up
The project currently has no map or device-geolocation dependency/configuration. A future integration should add a real provider and permissions only after the provider, key/configuration, and production delivery-area contract are established.
