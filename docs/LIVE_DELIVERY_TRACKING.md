# RideOn Live Delivery Tracking

Phase 2 builds on the existing Google Maps/Routes foundation and activates location collection only for an authorized vehicle delivery.

## State model

The existing rental booking lifecycle remains the source of truth for rental state. Delivery has a separate scoped status:

```
scheduled -> in_delivery -> delivered
                     \-> aborted
```

This avoids turning the existing `confirmed -> in_progress -> completed` rental lifecycle into a delivery state machine.

A delivery session can only start when:
- the booking belongs to the vendor
- booking status is `confirmed`
- payment is `paid`, `held`, `settlement_pending`, or `settled`
- delivery is enabled
- a delivery address and coordinates exist
- vendor location permission is granted
- no other active tracking session exists

## Tracking session

`tracking_sessions` stores:
- session ID
- booking
- vendor
- status
- started/ended timestamps
- latest latitude/longitude
- GPS accuracy
- last location timestamp
- latest route distance/duration/polyline
- expiry timestamp

Migration `018_live_delivery_tracking.sql` creates this model. Migration `019_tracking_route_polyline.sql` adds road-route geometry.

## Realtime

RideOn uses a lightweight authenticated WebSocket transport implemented directly on the existing Node HTTP server. No second realtime infrastructure or polling loop was introduced.

Customer subscription:

```
Customer app
  -> authenticated WebSocket
  -> RideOn API
  -> booking-scoped tracking channel
```

The customer can only subscribe to their own booking.

The vendor never receives a public tracking channel for another vendor.

## GPS strategy

The delivery device uses Expo Location:
- balanced accuracy
- default ~10 second interval
- default ~50 metre distance threshold

Both thresholds are configurable.

The backend validates latitude, longitude, accuracy, timestamp, vendor ownership and active session status.

A stale/out-of-order GPS packet is rejected.

## Background behavior

When a vendor starts an active delivery:
1. foreground permission is requested
2. background permission is requested
3. server creates the active tracking session
4. Expo background location updates begin

The background task stores only the active booking ID in SecureStore and sends authenticated GPS updates to RideOn.

When delivery is delivered, aborted, cancelled, or the session expires, the task is stopped.

The background location capability requires an Expo development/custom/EAS native build. It is not represented as an Expo Go capability.

## ETA

GPS packets do **not** trigger a routing API request every time.

A new Google Routes calculation occurs only when:
- the configured time interval has elapsed, or
- the delivery vehicle has moved beyond the configured distance threshold.

Defaults:
- route refresh: 60 seconds
- movement threshold: 300 metres

The latest road route geometry, distance and duration are stored in the active tracking session and broadcast to the customer.

## Customer experience

During `in_delivery`:

- moving vehicle marker
- customer destination
- road route
- remaining distance
- estimated arrival
- last update time
- live/stale state

The vehicle marker is animated between accepted GPS positions.

If the location becomes stale, RideOn displays:

> Live location temporarily unavailable

and the last update age instead of presenting the old coordinate as live.

When delivery completes, the WebSocket receives a completion event and live tracking stops.

## Stop conditions

Tracking stops when:
- vendor marks delivered
- vendor aborts delivery
- customer cancels the booking
- the session expires
- the server rejects further updates because the session is inactive

## Privacy

RideOn does not continuously track vendors.

A tracking session exists only for an active delivery. Outside that state the vendor device does not have an active RideOn delivery location task.

The customer cannot query another customer's booking.

## Required environment

Server:
- `TRACKING_SESSION_MAX_MINUTES=180`
- `TRACKING_STALE_SECONDS=90`
- `TRACKING_ROUTE_REFRESH_SECONDS=60`
- `TRACKING_ROUTE_REFRESH_METERS=300`

Existing map/routing server variables remain required:
- `GOOGLE_ROUTES_API_KEY`
- `GOOGLE_GEOCODING_API_KEY`

Optional Expo public tuning:
- `EXPO_PUBLIC_TRACKING_INTERVAL_MS=10000`
- `EXPO_PUBLIC_TRACKING_DISTANCE_METERS=50`

The existing restricted Google Maps mobile keys remain unchanged.

## Native build

The existing Expo configuration now enables:
- foreground location
- background location
- iOS background location capability
- Android background location capability
- react-native-maps

Because background location is a native capability, rebuild the development/preview/production binary after these configuration changes. OTA JavaScript updates alone do not add missing native permissions/capabilities.

## Next phase

This phase intentionally does not add continuous vendor tracking outside active delivery. Future work can improve driver assignment, richer trip-progress events, push notifications, and operational dispatch without changing the privacy boundary.
