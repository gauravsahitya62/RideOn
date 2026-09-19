# RideOn PostgreSQL setup

This directory contains the initial relational schema for the API's next persistence milestone. **The current Express runtime still uses in-memory demo data**; applying this schema alone does not switch the API to PostgreSQL.

## Requirements

- PostgreSQL 14+ (the schema uses `gen_random_uuid()` and GiST exclusion constraints).
- A database and a migration/deployment role allowed to create the `pgcrypto` and `btree_gist` extensions.
- Keep `DATABASE_URL` server-side only. Do not place it in Expo's `EXPO_PUBLIC_*` variables or commit credentials.

## Fresh database

From the repository root, connect to the intended database using `psql` and apply the schema:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/schema.sql
```

For a local/demo environment, populate the four sample vehicles:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/seed-demo.sql
```

The seed uses deterministic UUIDs and `ON CONFLICT (id) DO UPDATE`, so rerunning it refreshes those demo rows. Do not run it against a production fleet: it intentionally overwrites the four fixed demo IDs.

Apply the schema only to a new/empty database for now. It is a bootstrap script, not yet a versioned migration system; rerunning it may fail because enum types and tables already exist. Back up production data and use reviewed, versioned migrations before upgrading an existing environment.

## Booking overlap protection

The bookings table uses a GiST exclusion constraint over `vehicle_id` and the half-open time range `[start_at, end_at)`. It excludes overlap for `requested`, `confirmed`, and `in_progress` bookings. Adjacent reservations are allowed (one can end exactly when the next begins). The database constraint is intended to be the final concurrency-safe guard when booking creation is moved into a PostgreSQL transaction.

The application must still:

1. Validate date range, vehicle activity, and customer ownership/identity.
2. Insert the booking and its initial `booking_status_events` row in one transaction.
3. Translate PostgreSQL exclusion-constraint violations (`23P01`) into HTTP `409 VEHICLE_UNAVAILABLE`.
4. Avoid exposing booking records without an authenticated, authorized customer or operator.
5. Test competing concurrent booking requests against a real PostgreSQL instance.

## Before enabling live rentals

- Implement and test the database repository; do not silently fall back to in-memory writes when `DATABASE_URL` is configured.
- Add versioned migrations and a controlled migration step to deployment.
- Add authenticated customer/operator authorization, verified contact details, payment-provider webhooks, audit logging, backups, monitoring, and operational cancellation/refund procedures.
- Review privacy, retention, local rental/vehicle requirements, and incident response for the launch city.
