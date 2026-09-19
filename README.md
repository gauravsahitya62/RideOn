# RideOn — mobile rental MVP

RideOn is an Expo / React Native customer app concept for booking cars and bikes with doorstep delivery. The repository also contains an Express API scaffold and a PostgreSQL schema starter.

## Repository map

- `App.js`, `app.json`, `package.json`: Expo mobile app.
- `src/services/api.js`: mobile HTTP client, configurable API base URL, and request timeout/error handling.
- `server/src/server.js`: REST API, validation, demo fleet and booking lifecycle endpoints.
- `server/src/server.test.js`: Node test-runner API tests.
- `server/db/schema.sql`: PostgreSQL starting schema (not connected to runtime yet).
- `server/Dockerfile`: container build for the API demo.
- `.env.example`, `server/.env.example`: configuration templates.
- `.github/workflows/rideon-api.yml`: automated API test workflow.
- `.github/workflows/rideon-mobile.yml`: Expo dependency/doctor check workflow.

## Mobile app

Requirements: Node.js 20+ and Expo-compatible Android/iOS tooling.

```bash
npm install
npx expo start
```

Use Expo Go to scan the QR code, or run `npm run android` / `npm run ios` with the required local tooling. For a physical phone, set `EXPO_PUBLIC_API_URL` to a reachable address for your development machine; `localhost` on a phone points to the phone itself. Android emulator default is `http://10.0.2.2:4000`; iOS simulator default is `http://localhost:4000`.

Example root `.env`:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000
```

Replace the example LAN IP with your computer's reachable local IP. Ensure the phone and computer share a network and your firewall allows port 4000. The mobile HTTP client aborts requests after 20 seconds when `AbortController` is available and reports network, timeout, and HTTP errors to callers. This timeout is a client resilience measure, not a guarantee that the server stopped processing a timed-out mutation.

## API

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Health check: `GET http://localhost:4000/health`

Build and run the API container from `server/`:

```bash
docker build -t rideon-api .
docker run --rm -p 4000:4000 rideon-api
```

### Endpoints

- `GET /api/v1/vehicles?type=car|bike|all&city=Jaipur&q=...`
- `GET /api/v1/vehicles/:id`
- `POST /api/v1/bookings/quote`
- `POST /api/v1/bookings`
- `GET /api/v1/bookings/:id`
- `PATCH /api/v1/bookings/:id/cancel`

The API accepts either explicit ISO `startAt` and `endAt`, or the mobile-friendly `startDate` (`YYYY-MM-DD`) and `durationDays` format. A valid booking requires `vehicleId` and a delivery `address`; `delivery` defaults to true. `customerName` defaults to “RideOn guest” and `phone` is optional for this prototype—collect and verify customer contact details before live operation.

Example mobile payload:

```json
{
  "vehicleId": "creta-01",
  "startDate": "2030-05-01",
  "durationDays": 2,
  "delivery": true,
  "address": "12 Example Road, Jaipur"
}
```

Run API tests with `npm test` from `server/`. Root `package.json` currently provides Expo start/platform scripts but no root test or build script. GitHub Actions checks API tests and Expo project compatibility on relevant pushes/pull requests; inspect the Actions tab for the actual run result. The Expo doctor workflow is not a device-level UI test.

## QA and release checklist

Before considering a release, run the API test suite and Expo doctor workflow, then exercise the customer journey on supported iOS/Android devices against the intended backend: launch, browse/search/filter, switch city, inspect a vehicle, set dates, select pickup/delivery and address, obtain a quote, review, submit, inspect Trips/detail, and cancel where the server allows it. Verify loading/error/retry states and accessibility with screen readers and larger text. Confirm that a booking only shows success after the server acknowledges it and that payment status is not inferred from booking status.

No device/emulator end-to-end test is implied by this repository documentation. Record actual workflow and device results before release.

## MVP limitations — do not use for live rentals yet

- Demo fleet and bookings are held in process memory and disappear on restart; PostgreSQL schema is a starting point, not wired to a runtime database adapter or migrations.
- Overlap prevention is process-local and not concurrency-safe across multiple server instances; booking creation records a request, not a confirmed reservation.
- Authentication, OTP, identity/license verification, owner and delivery-partner consoles, admin moderation, real payment/refund webhooks, push notifications, maps/geocoding, audit/monitoring, rate limiting, and production deployment remain to be integrated and security-reviewed.
- No real payment provider is configured. The app's payment selection is a demo/unavailable state; no online payment, charge, refund, or transaction reference should be represented as completed.
- Prices and delivery fee are demo values; configure verified city-specific rates and taxes before launch.
- Never put payment secrets or server credentials in the mobile bundle.


## Verified CI status

- The mobile workflow runs dependency installation and \`npx expo-doctor\`; it is not an Android/iOS build and cannot prove device UI behavior.
- A previous mobile run on commit \`f41dc977a5477f2210b5bf5d371142c202196ff3\` completed with 20/21 Expo Doctor checks passing. The single failure was the Expo SDK 57 dependency-version mismatch; the repository dependencies have since been aligned to the versions reported by that run.
- API workflow runs observed in GitHub Actions were successful on the commits where the API workflow was triggered. The repository still does not claim a device test or production build.



## Backend production foundation

The backend now has a production-oriented persistence/authentication boundary while retaining a memory fallback for local prototype use.

### Database

Set `DATABASE_URL` to a PostgreSQL connection string. Apply `server/db/schema.sql` against the target database before starting the API.

The schema includes customers, vehicles, bookings, booking status events, idempotency keys, and payment events. Booking overlap protection uses PostgreSQL's exclusion constraint over `tstzrange`, which is the concurrency control relied upon for persistent reservations.

The repository reports storage mode from `GET /health`. Without `DATABASE_URL`, it explicitly reports `persistent: false`; this is not a production persistence mode.

### Authentication

Customer registration and password login are available at:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`

Booking quote, create, history, detail, and cancellation routes require `Authorization: Bearer <token>`.

Passwords are hashed with bcrypt. Production requires `JWT_SECRET`. Access tokens default to one hour; change `ACCESS_TOKEN_TTL_SECONDS` as appropriate for deployment.

Authorization is customer-scoped: a customer can only retrieve, list, or cancel their own bookings.

### Booking history

`GET /api/v1/bookings?limit=20&offset=0` returns only the authenticated customer's bookings. Results are bounded to a maximum page size of 50.

### Reservation safety

Booking creation accepts an optional `Idempotency-Key` header. Persistent PostgreSQL bookings additionally use the database exclusion constraint to reject overlapping reservations under concurrent requests. The server still re-checks availability before quoting/creating, but the database constraint is the authoritative concurrency guard.

### Payments

No real payment provider is configured.

The API contains a provider-neutral webhook verification boundary and an explicit payment lifecycle (`unpaid`, `pending`, `paid`, `failed`, `refunded`). Payment status changes are accepted only through a verified webhook when a provider and webhook secret are configured. Duplicate provider event IDs are ignored.

Do not set `PAYMENT_PROVIDER` to a real provider until its credentials and provider-specific signature format have been implemented and tested.

### Environment

Server environment variables are documented in `server/.env.example`:

```dotenv
DATABASE_URL=
DATABASE_SSL=false
DATABASE_POOL_MAX=10
JWT_SECRET=
ACCESS_TOKEN_TTL_SECONDS=3600
BCRYPT_ROUNDS=12
PAYMENT_PROVIDER=unconfigured
PAYMENT_WEBHOOK_SECRET=
```

Never place these server secrets in the Expo app or commit real credentials.

### Running backend tests

```bash
cd server
npm install
npm test
```

The automated tests exercise the in-memory repository path, authentication/authorization behavior, booking ownership, idempotency, overlapping reservations, and the payment verification boundary.

Database connectivity, PostgreSQL constraint behavior across multiple API instances, and real payment-provider webhook interoperability still require an environment with the relevant external services.
