# RideOn

RideOn is an Expo / React Native vehicle-rental app with an Express API and PostgreSQL persistence foundation. The repository keeps the existing mobile/API contracts where practical while making booking, authentication, and persistence boundaries explicit.

## Repository map

- `App.js`, `app.json`, `package.json`: Expo mobile app and release configuration.
- `src/screens/RideOnApp.js`: customer discovery, auth, booking, Trips, profile, and checkout flows.
- `src/services/api.js`: mobile HTTP client, bearer-token handling, secure session persistence, timeout/error handling.
- `server/src/server.js`: Express API, validation, fleet catalogue, authentication, booking lifecycle, health, and payment webhook boundary.
- `server/src/repository.js`: PostgreSQL repository with an explicit in-memory fallback for local tests/prototyping.
- `server/src/payments.js`: provider-neutral webhook verification and payment transition rules.
- `server/src/server.test.js`: API regression and contract tests.
- `server/db/schema.sql`: canonical PostgreSQL schema snapshot for the current application contract.
- `server/db/migrations/001_initial.sql`: ordered initial migration used by the migration runner.
- `server/scripts/migrate.js`: ordered PostgreSQL migration runner.
- `.github/workflows/rideon-api.yml`: memory-path and PostgreSQL integration CI.
- `.github/workflows/rideon-mobile.yml`: Expo dependency/doctor checks.

## Mobile development

Requirements: Node.js 20+ and Expo-compatible Android/iOS tooling.

```bash
npm install
npx expo start
```

API base URL is controlled by `EXPO_PUBLIC_API_URL`. Android emulator defaults to `http://10.0.2.2:4000`; iOS simulator defaults to `http://localhost:4000`. A physical device needs a reachable LAN URL.

Example:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000
```

The mobile client aborts HTTP requests after 20 seconds and reports network/HTTP errors to the calling screen. A timeout does not guarantee that the server stopped processing a mutation, which is why booking submission also uses an idempotency key.

### Mobile authentication/session

The app uses the backend's phone/password registration and login endpoints. Access tokens are stored in Expo SecureStore rather than plain local storage and restored when the app starts. Passwords are never persisted locally. A server-side token expiry or 401 clears the stored session.

Guest browsing remains available, but booking quote/create and booking history/detail/cancellation require authentication.

## Backend development

```bash
cd server
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Health endpoint:

```
GET http://localhost:4000/health
```

When PostgreSQL is not configured, the API reports `storage.persistent: false` and uses the explicit in-memory fallback. Production refuses to start without `DATABASE_URL`.

### Environment

Configure server values through `server/.env`:

```dotenv
PORT=4000
NODE_ENV=development
CLIENT_ORIGIN=*
DATABASE_URL=
DATABASE_SSL=false
DATABASE_POOL_MAX=10
JWT_SECRET=
ACCESS_TOKEN_TTL_SECONDS=3600
BCRYPT_ROUNDS=12
PAYMENT_PROVIDER=unconfigured
PAYMENT_WEBHOOK_SECRET=
```

Production also requires an explicit `CLIENT_ORIGIN`; wildcard CORS is rejected in production. A production deployment may not select an unimplemented payment provider.

## Database and migrations

The application uses PostgreSQL for persistent customers, vehicles, bookings, status events, idempotency keys, and payment events.

Run the ordered migration runner:

```bash
cd server
DATABASE_URL='postgresql://user:password@host:5432/rideon' npm run db:migrate
```

The runner creates `schema_migrations` and applies `server/db/migrations/*.sql` in filename order. Re-running it skips already-applied migration versions.

The canonical schema uses the same stable public vehicle identifiers that the mobile/API catalogue already exposes:

- `creta-01`
- `baleno-01`
- `classic-01`
- `activa-01`

The PostgreSQL `vehicles.id` and `bookings.vehicle_id` fields are `VARCHAR(64)` so these public IDs remain stable across requests and persistence.

### Currency convention

The API boundary uses INR rupees for existing mobile compatibility:

- `pricePerDay`, `rental`, `deliveryFee`, `platformFee`, `total`: INR rupees.
- `*_paise` database columns and payment webhook `amountPaise`: integer paise.

The repository performs the rupee-to-paise conversion exactly at the PostgreSQL write boundary and divides paise back to rupees when mapping persisted bookings to the API. No client-side payment amount is trusted.

The current fleet rates are demo values and must be replaced with verified commercial rates before launch.

### Existing database caution

The repository previously contained an un-applied UUID vehicle schema and ambiguous monetary-unit behavior. The new canonical migration is intentionally safe for a fresh database and does not silently rewrite unknown existing monetary data. Before upgrading an already-populated legacy database, take a PostgreSQL backup and explicitly verify the current vehicle IDs and monetary units before applying a data-conversion migration. A restore-from-backup is the safe rollback path; no destructive automatic rollback is provided for data-bearing legacy conversions.

## API endpoints

Public:

- `GET /health`
- `GET /api/v1/vehicles?type=car|bike|all&city=Jaipur&q=...`
- `GET /api/v1/vehicles/:id`

Authentication:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`

Authenticated customer endpoints:

- `POST /api/v1/bookings/quote`
- `POST /api/v1/bookings`
- `GET /api/v1/bookings?limit=20&offset=0`
- `GET /api/v1/bookings/:id`
- `PATCH /api/v1/bookings/:id/cancel`

The booking API accepts the existing mobile-friendly `startDate` + `durationDays` format or explicit ISO `startAt` + `endAt`.

## Booking reliability

Persistent booking creation is transactional. PostgreSQL is the authoritative concurrency guard:

- booking windows use an exclusion constraint over `tstzrange(start_at, end_at, '[)')`;
- idempotency keys are unique per customer;
- concurrent requests using the same idempotency key are serialized with a PostgreSQL transaction advisory lock;
- booking status events are written in the same transaction as the booking.

Quote availability is advisory; the database constraint is authoritative at reservation time.

## Authentication and authorization

Customer passwords are hashed with bcrypt. JWT access tokens default to one hour and are signed using `JWT_SECRET`.

Customer booking routes require a bearer token and enforce customer ownership. A customer attempting to read or cancel another customer's booking receives `404 BOOKING_NOT_FOUND` rather than another customer's record.

Authentication endpoints have a dedicated rate limit in addition to the global API limiter.

## Payments

RideOn uses **Razorpay** as its single real UPI payment provider. The mobile app receives a short-lived RideOn checkout URL; Razorpay Checkout then presents the UPI methods enabled for the merchant account. Merchant secrets remain server-side.

Payment creation is server-authoritative:

- `POST /api/v1/payments/create-order` derives the amount from the persisted booking.
- `POST /api/v1/fleet-orders/:id/payment` derives the amount from the persisted fleet order.
- Provider order IDs and exact INR paise amounts are persisted.
- `POST /api/v1/payments/:id/verify` performs provider-side status/amount/order/currency verification before `paid` can be applied.
- `POST /api/v1/payments/webhook` verifies the Razorpay webhook HMAC against the raw request body and processes provider events idempotently.
- Duplicate and out-of-order events cannot downgrade an already confirmed payment.
- Refunds use Razorpay's refund API and the existing RideOn refund transaction/idempotency flow.
- Production rejects `PAYMENT_PROVIDER=mock` and requires Razorpay credentials.

Required server variables:

```dotenv
PAYMENT_PROVIDER=razorpay
RAZORPAY_ENVIRONMENT=production
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

Production webhook:

```text
https://rideon-api-262g.onrender.com/api/v1/payments/webhook
```

See [docs/PAYMENTS_RUNBOOK.md](docs/PAYMENTS_RUNBOOK.md) for sandbox setup, production configuration, webhook setup, UPI capability behavior, refunds, and release verification.
## Testing


Memory-path API tests:

```bash
cd server
npm install
npm test
```

PostgreSQL integration tests:

```bash
cd server
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/rideon' npm run db:migrate
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/rideon' NODE_ENV=test npm test
```

GitHub Actions runs both paths. The PostgreSQL job starts PostgreSQL 16, applies the ordered migrations, and executes the same API suite against the persistent repository.

The test suite covers authentication, protected access, ownership isolation, stable vehicle IDs, invalid vehicle IDs, quote currency, persisted pricing round trips, idempotency, concurrent overlap rejection, concurrent same-key replay, invalid input, and payment verification/state rules.

There is no real payment-provider transaction in CI.

## Deployment guidance

The backend can be containerized from `server/`:

```bash
cd server
docker build -t rideon-api .
docker run --rm -p 4000:4000 --env-file .env rideon-api
```

For a real deployment, provision PostgreSQL separately, run the migration runner before the API starts, set production environment variables, and expose `GET /health` to the platform health-check system.

No production host/account, domain, database instance, or payment credentials are committed to this repository.

## Release limitations

RideOn should not be treated as production-ready solely because CI is green. Remaining launch work includes:

- provisioning and verifying a real PostgreSQL environment;
- selecting and implementing a real payment provider;
- device/emulator end-to-end testing of the customer journey;
- production mobile build/signing configuration and a release build;
- backups, monitoring, alerting, and operational runbooks;
- commercial inventory/rates, tax rules, cancellation/refund policy, and any required identity/licence verification.

No device-level UI test, production deployment, or real payment transaction is claimed by this repository.

## Production hardening

The launch-hardening work is tracked in [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md). Production startup now fails fast for missing database/auth/payment configuration, CORS is explicit, proxy trust is opt-in, API requests receive correlation IDs, and API CI uses deterministic `npm ci` installs.

EAS builds expose explicit development/preview/production channels. Production builds require `EXPO_PUBLIC_API_URL` and reject local API hosts.
