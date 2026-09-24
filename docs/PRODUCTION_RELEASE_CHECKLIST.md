# RideOn Production Release Checklist

## Render API

Required production environment variables:

- NODE_ENV=production
- DATABASE_URL
- DATABASE_SSL=true
- JWT_SECRET (32+ random characters)
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- CLIENT_ORIGIN (explicit production origin; never *)
- PAYMENT_PROVIDER=paytm
- PAYTM_MERCHANT_ID
- PAYTM_CLIENT_ID
- PAYTM_CLIENT_SECRET
- PAYTM_WEBSITE
- PAYTM_CALLBACK_URL
- PAYTM_WEBHOOK_SECRET
- GOOGLE_ROUTES_API_KEY

Configure OTP delivery when email/phone OTP is enabled:

- RESEND_API_KEY
- OTP_FROM_EMAIL
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_FROM_PHONE

Do not put any server secret in the Expo app or commit it to Git.

Render continues using the existing Docker service and health check. The start script applies only unapplied forward migrations before starting the API.

## Expo / EAS

Production builds must explicitly set:

- EAS_BUILD_PROFILE=production
- EAS_UPDATE_CHANNEL=production
- EXPO_PUBLIC_API_URL=https://<production-render-host>
- EXPO_PUBLIC_SUPABASE_URL
- EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (or platform-specific Android/iOS keys)

Background location is configured because the current delivery-tracking architecture uses an Expo background task during an active delivery. The server independently authorizes every location update against the active tracking session, booking and vendor ownership.

## Payment release blocker

The current repository contains payment lifecycle, idempotency and webhook state handling, but server/src/payments.js does not contain a verified live Paytm checkout/status/refund implementation. Its live methods intentionally fail closed with an integration-required error.

Therefore do not enable real customer payments in production until the Paytm implementation is completed and verified against the merchant account and webhook contract. Credentials alone do not make the existing implementation production-ready.

## Verification

Before release:

1. Apply migrations to a staging database from a fresh database.
2. Run npm test against memory and PostgreSQL.
3. Run Expo Doctor and production Expo configuration validation.
4. Build a production EAS binary with production API and Maps configuration.
5. Manually test customer, vendor, admin, payment, deposit, delivery tracking and support flows.
6. Confirm Render /health returns ok.
7. Verify webhook signature handling using the actual provider's signed payload.
8. Verify payment success is only accepted after authoritative provider confirmation.
9. Verify duplicate webhook/retry/refund behavior.
10. Verify suspended customer/vendor accounts cannot use marketplace APIs.
