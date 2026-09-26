# RideOn Maps & Delivery

## Provider

RideOn uses Google Maps Platform:
- `react-native-maps` for the native Android/iOS map surface.
- Google Routes API for server-side driving distance and estimated duration.
- Google Geocoding API for address-to-coordinate lookup.
- Expo Location for contextual foreground location and active-delivery background location.

## Mobile map keys

Mobile maps require public but application-restricted Google keys:
- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`

The production Android key must be restricted to package `com.rideon.app` and the Android Maps SDK/API. The production iOS key must be restricted to bundle identifier `com.rideon.app` and the iOS Maps SDK/API.

A single `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` compatibility fallback remains supported, but separate platform keys are recommended for production so each key can be application-restricted correctly.

## Server keys

Render/server only:
- `GOOGLE_ROUTES_API_KEY`
- `GOOGLE_GEOCODING_API_KEY`

Never expose these through `EXPO_PUBLIC_*`.

## Required Google APIs

Enable the APIs actually used by the deployment:
- Maps SDK for Android
- Maps SDK for iOS
- Routes API
- Geocoding API

## Location/privacy

Customer delivery coordinates are used for routing and ETA. Vendor coordinates represent customer-facing service/pickup locations rather than private home coordinates.

Foreground location is requested contextually when the user chooses to use device location.

Background location is requested only when a vendor starts an active vehicle delivery. The existing `expo-task-manager` task sends the latest authorized delivery coordinate to RideOn while the active tracking session is valid. Tracking stops when delivery completes/aborts or the server reports that the tracking session is no longer active.

Android and iOS store disclosures must explicitly describe this active-delivery background location behavior.

## Architecture

```
Customer/Vendor mobile
  -> RideOn API
      -> Google Geocoding API
      -> Google Routes API

Vendor active delivery
  -> Expo background location task
      -> authenticated RideOn API
      -> active tracking session
      -> customer live-delivery map
```

## Failure behavior

The app handles denied location permission, missing provider configuration, no geocoding match, routing timeout, provider failure, stale GPS, and network errors with user-facing messages. The server remains authoritative for routing/price/booking/tracking state and does not accept client-supplied pricing.

## Production verification

Before release:
1. Test Android and iOS physical devices with production-restricted map keys.
2. Verify the map renders without using Expo Go-only configuration.
3. Verify address search and ETA against the production Render API.
4. Start an actual staging delivery and verify background location updates.
5. Verify tracking becomes stale/ends cleanly when the delivery session expires or completes.
