# RideOn API deployment: Supabase + Render

This is the recommended first production-shaped deployment for the current Express API. It is a modular monolith, not microservices. Keep the API stateless and run multiple instances behind Render's routing when traffic requires it; PostgreSQL remains the source of truth.

## Service layout

- **Expo app:** public API URL only (`EXPO_PUBLIC_API_URL`). Never embed database URLs, JWT signing secrets, Supabase service-role keys, or payment secrets in the app.
- **API:** Render Web Service, Node.js 20+, root directory `server`, build command `npm ci`, start command `npm start` (if no lockfile exists, use `npm install` until a lockfile is committed).
- **Database:** Supabase managed PostgreSQL, same/nearby region as API where available. Use the Supabase connection pooler for horizontally scaled API traffic; select the pooler mode supported by the app's `pg` usage and provider guidance. Use direct DB connection for migration jobs when required.
- **Images:** Supabase Storage or another object store; store object URLs/keys in PostgreSQL, not image binaries.

## Provisioning steps (owner action required)

1. Create a Supabase project and choose a region close to the initial launch market and API region. Save the database password securely.
2. In Supabase, obtain the connection string. Prefer a pooled connection for the API and a direct/migration connection for schema migrations. Confirm SSL requirements and set `DATABASE_SSL=true` when using the current strict TLS configuration.
3. Create a Render Web Service connected to this repository and select branch `feat/backend-postgres-v1` for preview, or the reviewed/merged production branch later.
4. Configure Render environment variables from `server/.env.example`: `NODE_ENV=production`, `PORT` (Render supplies this), `DATABASE_URL`, `DATABASE_SSL=true`, `DATABASE_POOL_MAX` sized against Supabase's connection limits, a long random `JWT_SECRET`, `CLIENT_ORIGIN` set to the exact permitted web origin(s), `ACCESS_TOKEN_TTL_SECONDS`, and `BCRYPT_ROUNDS`.
5. Run migrations as a controlled one-off release/deploy command: `npm run db:migrate` from the `server` directory, using a database role permitted to create required extensions and schema objects. Do not run demo seed SQL in production.
6. Set `EXPO_PUBLIC_API_URL` to the deployed HTTPS API URL in the Expo build environment, rebuild the app, and smoke-test on a physical device.
7. Configure health checks against `/health`, structured logs, error alerting, backups/PITR as available on the selected Supabase plan, and a documented restore test.

## Important current-code gaps before public launch

- The API still needs complete vendor onboarding/approval, vendor-only fleet CRUD, vendor-scoped booking queries and fulfillment state transitions. Migration `002_vendor_platform.sql` creates schema support but does not by itself implement those routes or authorization.
- Existing public vehicle routes currently source a fixed in-code demo fleet. Switch them to database-backed queries before treating inventory as live.
- Payment adapter is intentionally unconfigured. Do not accept real money until a provider adapter, signed raw-body webhook verification, refunds/reconciliation, and payout workflows are implemented and tested.
- The current API has a process-local rate limiter. For multi-instance production, move rate limiting to a shared store or enforce it at the edge.
- Use proper production CORS allowlisting (current configuration expects one origin string; multiple app/web origins need deliberate support).
- Add automated integration tests against PostgreSQL, especially concurrent overlapping reservations, ownership/IDOR checks, cancellation races, and idempotency behavior.
- Review phone/email verification, account recovery, privacy/retention, vendor KYC, rental agreements, insurance, and local legal requirements for launch city.

## Scaling notes for 100,000+ registered users

100,000 accounts is not the same as 100,000 concurrent requests. Start with one stateless API service and a managed Postgres instance with connection pooling, indexes, query timeouts, pagination, backups, and observability. Load-test realistic browse/search and booking bursts. Scale API instances horizontally, cap each pool so aggregate connections stay within database limits, and add Redis/queue workers only when metrics justify shared caching, distributed rate limiting, reservation holds, or asynchronous notifications. Avoid microservices until independent scaling or team ownership creates a demonstrated need.

## Secret handling

Never commit `.env`, production URLs containing passwords, service-role keys, JWT secrets, or payment secrets. Rotate any credential accidentally committed. The Supabase service-role key is not required for this API's direct PostgreSQL connection and must never be shipped to Expo.
