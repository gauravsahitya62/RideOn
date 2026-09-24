# RideOn Maps & Delivery Foundation

## Provider

RideOn Phase 1 uses **Google Maps Platform** with:
- **react-native-maps** for the native Android/iOS map surface.
- **Google Routes API** for server-side driving distance and traffic-aware estimated duration.
- **Google Geocoding API** for address-to-coordinate lookup.

This fits the current Expo architecture because the native map is configured through the existing dynamic `app.config.js` and is intended for EAS/custom development builds rather than relying on Expo Go for provider-specific native configuration. India coverage and future routing/live-location workflows are supported by the Google Maps Platform stack.

Live GPS tracking is intentionally not implemented in this phase.

## Privacy

Vendor coordinates are stored as **service/pickup locations**. The customer map does not expose private home coordinates. Vendors can place a service pin and save a customer-facing service address from the vendor Profile screen.

## Architecture

```
Customer mobile
  -> RideOn API
      -> Google Geocoding API
      -> Google Routes API
```

The Google Routes/Geocoding server keys are server-only. Mobile maps use platform-restricted public keys configured by `app.config.js`.

## Customer flow

Explore -> See vendors on map -> Select vendor -> Browse vehicles -> Enter/search delivery location -> Routing -> Estimated delivery time -> Existing booking/quote/payment flow.

Vendor markers represent service locations. Multiple active vehicles at one vendor are represented by one marker and a vehicle count.

## Booking data

Booking records retain:
- delivery address
- delivery latitude/longitude
- vendor service latitude/longitude snapshot
- routed distance
- routed duration
- routing provider

Route data is supplementary to the existing server quote. Delivery pricing remains server-controlled and is not accepted from the mobile client.

## Caching

Routing is cached in-process for a short configurable TTL (default 2 minutes) with a bounded cache. Geocoding uses a longer short-lived cache (default 10 minutes). This reduces duplicate provider calls without becoming persistent route state.

## Required environment

Render/server:
- `GOOGLE_ROUTES_API_KEY`
- `GOOGLE_GEOCODING_API_KEY`
- optional `ROUTE_CACHE_TTL_MS`, `ROUTE_TIMEOUT_MS`, `GEOCODE_CACHE_TTL_MS`, `GEOCODE_TIMEOUT_MS`

Expo/EAS build:
- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`

The mobile keys should be restricted to RideOn's Android package/iOS bundle identifier `com.rideon.app` and only the required Maps SDK APIs. Never use a server key in `EXPO_PUBLIC_*`.

## Failure behavior

The app handles denied location permission, missing provider configuration, no geocoding match, routing timeout, provider failure, and network errors with user-facing messages. Booking and existing pricing remain usable when routing is temporarily unavailable, but the UI does not fabricate an ETA.

## Remaining Phase 2 work

The next phase can build on the saved coordinates and routing layer for:
- continuous driver/vendor location updates
- authenticated live location channels
- customer tracking map
- trip-progress states
- location freshness/staleness handling
- background location policy and battery considerations
