# RideOn Production Release Checklist

## Backend / Render

Required production environment variables currently used by the server:
- `NODE_ENV=production`
- `DATABASE_URL`
- `DATABASE_SSL=true`
- `JWT_SECRET` (32+ random characters)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `CLIENT_ORIGIN` (explicit; never `*`)
- `PAYMENT_PROVIDER=paytm`
- `PAYTM_MERCHANT_ID`
- `PAYTM_CLIENT_ID`
- `PAYTM_CLIENT_SECRET`
- `PAYTM_WEBSITE`
- `PAYTM_CALLBACK_URL`
- `PAYTM_WEBHOOK_SECRET`
- `GOOGLE_ROUTES_API_KEY`

OTP delivery, when enabled, additionally requires the actual configured provider credentials documented in `server/.env.example`.

Never put Render/server secrets in Expo.

## Expo / EAS

Production builds require:
- `EAS_BUILD_PROFILE=production`
- `EAS_UPDATE_CHANNEL=production`
- `EXPO_PUBLIC_API_URL=https://<production-render-host>`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`

The production app rejects a missing API URL. Local API access is opt-in only.

## Native identifiers

- Android package: `com.rideon.app`
- iOS bundle identifier: `com.rideon.app`
- App version: `1.0.0`
- EAS remote version source + automatic incrementing are enabled.

No signing credentials, keystores, certificates or provisioning profiles belong in Git.

## Maps / location

Google Maps SDK keys must be application-restricted to the above Android/iOS identifiers. Server routing/geocoding keys stay on Render.

Foreground location is contextual. Background location is requested only for active vendor delivery tracking.

## Notifications

Push notifications are not implemented in the current mobile app. Do not claim notification support in store metadata yet.

## Observability\n\nProduction observability includes request IDs, structured privacy-safe HTTP/error logs, `/health`, `/health/ready`, server-side analytics, admin metrics, read-only financial reconciliation and operational alerts. See `PRODUCTION_OPERATIONS.md`.\n\n## Payment release blocker

The current repository contains payment lifecycle, idempotency and webhook state handling, but `server/src/payments.js` does not contain a verified live Paytm checkout/status/refund/settlement adapter. Live provider operations intentionally fail closed.

Do not enable real customer payments until the verified Paytm product integration is implemented and tested against the actual merchant account and webhook contract.

## Mobile build verification

Run on a machine with Node/npm/EAS access:

```bash
npm install
npx expo-doctor
NODE_ENV=production EAS_BUILD_PROFILE=production EAS_UPDATE_CHANNEL=production EXPO_PUBLIC_API_URL=https://<production-render-host> npx expo config --type public
eas build --platform android --profile production
eas build --platform ios --profile production
```

The last two commands create builds only; they do not submit them.

## Release gates

Before submission, verify:
1. Render `/health`.
2. Database migrations.
3. Real payment checkout/status/refund/webhook flow.
4. Maps/routing/geocoding.
5. Authentication/session refresh.
6. Booking/concurrency/cancellation.
7. Security deposit.
8. Active-delivery background tracking on physical devices.
9. Reviews/support/admin.
10. Store privacy, metadata, icon and screenshot requirements.

See `RELEASE_CHECKLIST.md` and `docs/MOBILE_PRODUCTION_RELEASE.md`.


## Notifications release gate

Migration `025_notifications.sql` adds in-app notifications, push-device registrations and basic transactional/promotional preference storage.

Before production:
- Apply migration 025 after the existing migration chain.
- Verify Expo/EAS notification configuration on physical Android and iOS devices.
- Test permission grant, denial and later re-enable.
- Test booking, payment, refund, delivery and support notifications from authoritative backend events.
- Test notification tap navigation and stale/deleted target handling.
- Verify invalid Expo tokens are disabled.
- Never add `EXPO_ACCESS_TOKEN` to an Expo public variable.
- Do not expect security-deposit hold/release notifications until the deployed security-deposit workflow exposes authoritative hold/release state transitions; the current release does not invent those events.
