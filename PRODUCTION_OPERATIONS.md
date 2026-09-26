# RideOn Production Operations

## Observability model

RideOn uses request correlation IDs and privacy-safe structured JSON logs.

Every HTTP request records:
- request ID
- timestamp
- HTTP method
- route
- HTTP status
- duration
- authenticated internal user ID when available

Requests returning 5xx, 401 or 403 produce a separate structured failure event. Requests slower than `SLOW_REQUEST_MS` (default 1000 ms) produce a slow-request event.

Logs never intentionally include passwords, OTPs, access/refresh tokens, API keys, payment credentials, or exact GPS coordinates.

## Health checks

- `GET /health` — liveness only. A 200 response means the API process is running.
- `GET /health/ready` — readiness. In production this checks database reachability, verified payment-provider readiness, routing configuration and Supabase configuration.

Render should use `/health/ready` as the traffic-readiness gate when the payment provider is verified. Until live payments are verified, readiness will correctly remain unavailable.

## Admin operational endpoints

These endpoints require the `admin` role:

- `GET /api/v1/admin/metrics?from=<ISO>&to=<ISO>`
- `GET /api/v1/admin/reconciliation?limit=100`
- `GET /api/v1/admin/operational-alerts?limit=100`

Metrics are aggregated server-side. Reconciliation is read-only.

## Analytics

Authoritative business events are written to `analytics_events` with a unique `event_key`. Retries and webhook replays therefore do not create duplicate analytics rows.

Currently instrumented events include booking creation/status changes, payment webhook outcomes, support ticket creation and review creation. The analytics ledger is deliberately not a raw activity log.

Do not add personal content, payment credentials, OTPs, exact private locations or support-message text to event properties.

## Financial reconciliation

The reconciliation endpoint identifies internal inconsistencies such as:
- payment pending states
- refund pending states
- payment record/booking state mismatches
- missing payment records for paid bookings

It does not mutate financial records.

The current implementation cannot independently query provider-side payment state without a live provider reconciliation API. Provider state therefore remains a documented limitation rather than being inferred.

## Operational alerts

The operational-alert endpoint identifies:
- payments/refunds stuck pending for more than 30 minutes
- stale active tracking sessions
- expired active tracking sessions
- repeatedly failing enabled push devices

Tracking expiry is already handled by the authoritative tracking repository methods. Never manually resume a tracking session.

## Common incidents

### Payment stuck

1. Check `/health/ready`.
2. Check Render logs for `payment_*`, `request_failure` and provider errors.
3. Check `/api/v1/admin/reconciliation`.
4. Check `/api/v1/admin/operational-alerts`.
5. Verify the provider dashboard/webhook delivery.
6. Do not mark the booking paid manually.
7. Do not edit payment rows directly.

### Booking stuck

1. Find the booking in the admin operational tooling.
2. Inspect booking status events and request IDs in Render logs.
3. Check payment/reconciliation state before changing anything.
4. Use the authoritative booking API transition if a valid transition is available.
5. Never bypass authorization or write directly to production tables.

### Refund stuck

1. Check the payment/refund state.
2. Check provider webhook delivery.
3. Check reconciliation output.
4. Retry only through the authorized refund workflow.
5. Do not manually mark a refund complete without the provider reference.

### Tracking stopped

1. Check the active tracking session and stale alert.
2. Confirm vendor delivery is still authorized and in progress.
3. Check device GPS permission and network state.
4. If the session expired, start a new authorized delivery session only through the normal workflow.
5. Never resume tracking automatically.

### Render deployment failed

1. Inspect the failed deployment logs.
2. Verify required environment variables are present without copying secret values into tickets/chat.
3. Verify migrations before API startup.
4. Revert the application deployment through Render/Git history if required.
5. Do not reset the production database.

### Database migration failed

1. Stop promotion of the deployment.
2. Inspect the exact migration failure in Render logs.
3. Confirm which migration version was recorded.
4. Fix the migration with a new forward-only migration if necessary.
5. Never edit an already-applied migration.
6. Never reset production data.

## Privacy and incident safety

Operational tooling must use internal IDs and aggregate data where possible.

Never use:
- direct production SQL edits as a normal recovery procedure
- authentication bypasses
- payment-verification bypasses
- manual payment-success marking
- deletion of financial records
- production database resets

All financial and lifecycle changes must go through the authoritative application workflow.

## Required Render configuration

Existing production configuration remains required. For observability, optionally set:

`SLOW_REQUEST_MS=1000`

The analytics migration `026_observability_analytics.sql` is applied automatically by the existing migration runner. No production database reset is required.

## External monitoring

Render should monitor:
- `/health`
- `/health/ready`
- HTTP 5xx rate
- latency / slow requests
- deployment failures

A third-party crash/analytics service is not currently hardcoded into the mobile app. If one is selected later, integrate it using its public/client SDK configuration only and keep server secrets server-side.
