# RideOn Mobile Production Release Notes

## 1. Current Expo/EAS configuration

The repository currently uses:
- Expo SDK `~57.0.0`
- App name: `RideOn`
- Slug: `rideon`
- Version: `1.0.0`
- Android package: `com.rideon.app`
- iOS bundle identifier: `com.rideon.app`
- EAS production profile: `production`
- EAS production channel: `production`
- EAS remote app version source with automatic build-number incrementing
- Runtime version policy: `appVersion`

No new Android/iOS identifiers were invented.

### Versioning

The app version remains `1.0.0`. The production EAS profile has `autoIncrement: true` and `appVersionSource: remote`, so EAS manages Android `versionCode` and iOS `buildNumber`.

Before the first store upload, verify the current remote EAS version state with the EAS account/project. Do not manually reuse a store build number.

## 2. Production environment

The production binary must receive these Expo public values through EAS:

Required:
- `EXPO_PUBLIC_API_URL` — the HTTPS production Render API base URL
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`

Optional:
- `EXPO_PUBLIC_TRACKING_INTERVAL_MS`
- `EXPO_PUBLIC_TRACKING_DISTANCE_METERS`

Do not put any server credential in Expo/EAS public variables.

The following remain Render/server-only:
- `DATABASE_URL`
- `JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYTM_CLIENT_SECRET`
- `PAYTM_WEBHOOK_SECRET`
- `GOOGLE_ROUTES_API_KEY`
- `GOOGLE_GEOCODING_API_KEY`
- OTP provider credentials

Production must not set `EXPO_PUBLIC_USE_LOCAL_API=true`.

## 3. Maps and location

RideOn uses:
- `react-native-maps` with Google Maps on Android/iOS
- Google Routes API on the server
- Google Geocoding API on the server

The mobile SDK keys are public by design but must be restricted:
- Android key: Android application restriction for `com.rideon.app`, limited to the required Maps SDK/API
- iOS key: iOS application restriction for `com.rideon.app`, limited to the required Maps SDK/API

Required Google APIs must be enabled in the Google Cloud project used by RideOn:
- Maps SDK for Android
- Maps SDK for iOS
- Routes API
- Geocoding API

Do not put `GOOGLE_ROUTES_API_KEY` or `GOOGLE_GEOCODING_API_KEY` in Expo variables.

### Location permissions

Foreground location is requested contextually when the customer/vendor uses a location feature.

Background location is requested only when a vendor starts an active delivery. The existing implementation uses Expo's background location task to send delivery coordinates to the authenticated RideOn API while the delivery is active.

Android/iOS store review must explicitly account for this background tracking behavior.

Camera permission is not currently requested by the mobile app. Vehicle photos are selected from the vendor's photo library, so photo-library access is requested contextually when adding vehicle photos.

Notifications are not currently implemented in the mobile app. No push-notification permission is intentionally requested.

## 4. Notifications

No `expo-notifications` implementation was found in the current mobile code. This release therefore does not add a notification system.

When notifications are implemented later, add production credentials, permission handling, token registration, foreground/background handling, and event mapping as a separate feature.

## 5. Deep links

No current mobile deep-link/navigation contract was found for payment return, authentication links, booking links, or support links.

The current Paytm integration is not a verified live provider adapter, so there is no verified payment deep-link contract to configure.

If the eventual provider flow redirects directly to the mobile app, define a dedicated HTTPS universal/app-link or Expo scheme only after the provider's documented callback requirements are known. Do not invent a callback URI.

The server-side `PAYTM_CALLBACK_URL` remains a backend configuration value and must be an actual provider-compatible production URL.

## 6. Payment release gate

The backend intentionally fails closed for live Paytm operations until a verified Paytm checkout/status/refund/settlement adapter is implemented and tested.

Required production flow:

Customer -> payment provider -> provider callback/webhook -> backend signature verification -> authoritative provider status -> booking/payment state transition.

Do not enable production customer payments by simply adding credentials. The current code deliberately prevents that.

## 7. Android release

Exact build command:

```bash
eas build --platform android --profile production
```

Expected artifact: Android App Bundle (`.aab`) for Play Console.

EAS signing credentials must be created/managed by EAS or supplied securely through EAS. Never commit keystores or signing keys.

The repository does not currently contain a custom icon/splash asset set. Do not point Expo configuration at invented or missing files.

## 8. iOS release

Exact build command:

```bash
eas build --platform ios --profile production
```

EAS signing certificates/profiles must be managed by EAS or supplied securely through EAS. Never commit certificates/provisioning profiles.

No iOS-specific deep-link callback is configured because the current payment provider adapter is not live.

## 9. App icon / splash assets

The repository tree does not currently contain a dedicated production app icon/splash asset set.

Before store submission, supply real assets:
- `1024x1024` PNG master app icon
- Android adaptive icon foreground/background assets suitable for Expo/EAS
- iOS icon source suitable for App Store icon generation
- production splash artwork in a format/dimensions supported by the selected Expo SDK
- no development/demo branding

Do not create random placeholder branding as part of this release-hardening change.

## 10. Privacy/data audit

Based on the current mobile/backend implementation, RideOn processes/stores:

### Account information
- name/full name
- email and/or phone used for authentication
- RideOn account role/status
- vendor business/contact information

### Location
- customer delivery coordinates/address when delivery routing is used
- vendor customer-facing service/pickup coordinates/address
- active vendor delivery GPS coordinates during an active delivery
- timestamps and accuracy associated with delivery tracking

### Booking
- vehicle/booking identifiers
- booking dates
- delivery selection/address
- rental, platform fee and security-deposit amounts
- booking/payment/delivery status
- cancellation/refund information

### Vehicle/vendor marketplace data
- vehicle details
- registration information entered by vendors
- vehicle photos selected from the vendor photo library
- vendor service location

### Support/reviews
- support ticket/message content
- customer/vendor reviews and ratings
- review timestamps and booking relationships

### Payment-related data
RideOn stores payment lifecycle/reference/status information needed for its backend payment records. The actual payment instrument/credential data should be treated as provider-side data unless the final provider integration demonstrably sends/stores it in RideOn.

### Device/push data
No push-token collection is currently implemented.

### Third parties
Current code uses Supabase for authentication, Google Maps Platform for map/routing/geocoding, and configured OTP providers such as Resend/Twilio. A final production privacy disclosure must reflect the providers actually enabled in Render/EAS.

This document is an implementation audit, not legal advice. Final store declarations must match the deployed configuration and provider contracts.

## 11. Render production variables

Required by the current server production startup/configuration:
- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `CLIENT_ORIGIN`
- `PAYMENT_PROVIDER=paytm`
- `PAYTM_MERCHANT_ID`
- `PAYTM_CLIENT_ID`
- `PAYTM_CLIENT_SECRET`
- `PAYTM_WEBSITE`
- `PAYTM_CALLBACK_URL`
- `PAYTM_WEBHOOK_SECRET`
- `GOOGLE_ROUTES_API_KEY`

Production OTP delivery additionally requires the credentials for the channel actually enabled:
- `RESEND_API_KEY` + `OTP_FROM_EMAIL`, or
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_PHONE`

Other server configuration is documented in `server/.env.example`.

## 12. Validation

The repository's mobile CI validates:
- npm dependency installation
- Expo Doctor
- public production Expo configuration

The repository does not currently define a root mobile lint or TypeScript typecheck script. Server tests are maintained under `server/`.

The current PR's GitHub checks must be green before release; a queued check is not evidence of a passing build.

## 13. Remaining blockers

1. Verified live Paytm adapter and staging verification are still required.
2. PR #14 Admin/Ops work is separate from the current hardening branch and must be merged/fixed before any release requiring admin operations.
3. Production Android/iOS signing credentials must be configured in EAS.
4. EAS project/account linkage must be verified; no project ID is invented in source.
5. Real restricted Google Maps Android/iOS keys must be configured.
6. Production app icon/splash assets are missing from the repository.
7. Real Privacy Policy, Terms, Support URL and contact details are still required.
8. Physical-device Android/iOS release testing is still required.
9. Current GitHub CI checks on the hardening branch were queued at audit time and must finish successfully.
