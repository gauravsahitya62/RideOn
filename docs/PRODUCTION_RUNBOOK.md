# Production operations runbook

## Environment separation

RideOn uses three environments:

- **development**: local Expo + API; in-memory API fallback may be used for development/test only.
- **staging**: separate Render/API + PostgreSQL + Supabase project and isolated payment credentials. Use `NODE_ENV=staging` and an explicit `CLIENT_ORIGIN`.
- **production**: separate API + PostgreSQL + Supabase project, explicit CORS, UPI merchant configuration and webhook verification secret, and no in-memory persistence.

Never copy production secrets into repository files, local `.env` files committed to git, or GitHub Actions logs.

## Required production configuration

At minimum configure:

- `NODE_ENV=production`
- `DATABASE_URL`
- `DATABASE_SSL` as required by the database provider
- `DATABASE_POOL_MAX`
- `CLIENT_ORIGIN` with one or more explicit origins
- `JWT_SECRET` (32+ characters; legacy auth endpoints still exist)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `PAYMENT_PROVIDER=upi`
- `UPI_VPA`
- `UPI_MERCHANT_NAME`
- `UPI_WEBHOOK_SECRET`
- `TRUST_PROXY=true` only when the deployment is actually behind a trusted reverse proxy

The API intentionally fails fast in production when required authentication/payment/database configuration is missing.

## Database backup and restore

This repository does **not** operate backups by itself. The PostgreSQL provider must supply and retain the backup artifacts.

Required operator policy before launch:

1. Daily backups at minimum; use point-in-time recovery where the provider supports it.
2. Retain enough history to cover the agreed operational recovery window; record the exact retention in the hosting provider.
3. Verify backups by performing a restore test before launch and after material infrastructure changes.
4. Document the recovery target, the restored database identifier, and the timestamp of the last verified backup.
5. Roll back application deployment separately from database rollback; do not treat an application redeploy as a database restore.

Do not mark backup coverage as operational until a real restore test has succeeded.

## Production deployment checklist

1. Apply migrations with `npm run db:migrate` against the intended PostgreSQL database.
2. Confirm `GET /health` returns HTTP 200 and the database dependency is healthy.
3. Confirm logs contain request IDs and no passwords, OTPs, access tokens, payment secrets, or raw customer payloads.
4. Configure the selected UPI/payment-provider webhook URL and `UPI_WEBHOOK_SECRET`.
5. Exercise a staging payment flow before enabling production payments.
6. Generate and install a real Expo/EAS production build.
7. Test authentication/session restoration, browse, quote, booking, payment, cancellation, vendor fulfillment, and support on target devices.
8. Keep rollback instructions and the previous known-good mobile/backend versions recorded.

## Launch evidence required

The following must be evidenced externally before public launch:

- successful production/staging deployment
- successful database migration
- verified backup + restore
- working UPI/payment-provider verification + webhook callback
- production mobile build installed on target devices
- smoke test of customer and vendor critical flows
- crash/error monitoring configured
- support/cancellation/refund/legal text finalized
