# RideOn — mobile rental MVP

RideOn is an Expo / React Native customer app concept for booking cars and bikes with doorstep delivery. The repository also contains an Express API scaffold and a PostgreSQL schema.

## Repository

- `App.js`, `app.json`, `package.json`: Expo mobile app.
- `server/src/server.js`: REST API, validation, demo fleet and booking lifecycle endpoints.
- `server/src/server.test.js`: Node test-runner API smoke tests.
- `server/db/schema.sql`: PostgreSQL starting schema.
- `server/.env.example`: server environment template.

## Mobile app

Requirements: Node.js 20+ and Expo-compatible Android/iOS tooling.

```bash
npm install
npx expo start
```

Use the Expo Go app to scan the QR code, or run `npm run android` / `npm run ios` with the required local tooling. The UI is currently a prototype; confirm the Expo SDK compatibility for your installed environment before producing store builds.

## API

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Health check: `GET http://localhost:4000/health`

### Endpoints

- `GET /api/v1/vehicles?type=car|bike|all&city=Jaipur&q=...`
- `GET /api/v1/vehicles/:id`
- `POST /api/v1/bookings/quote`
- `POST /api/v1/bookings`
- `GET /api/v1/bookings/:id`
- `PATCH /api/v1/bookings/:id/cancel`

Booking payload requires `customerName`, `phone`, `vehicleId`, ISO `startAt`/`endAt`, `address`; `delivery` defaults to true.

Run tests with `npm test` from `server/`.

## MVP limitations — do not use for live rentals yet

- API demo fleet and bookings are held in process memory and disappear on restart; PostgreSQL schema is a starting contract, not yet wired to a database adapter or migrations.
- Availability checks are not concurrency-safe; booking creation currently records a request, not a confirmed reservation.
- Authentication, OTP, identity/license verification, owner and delivery-partner consoles, admin moderation, real payment/refund webhooks, push notifications, maps/geocoding, audit/monitoring, rate limiting, and production deployment remain to be integrated and security-reviewed.
- Prices and delivery fee are demo values; configure verified city-specific rates and taxes before launch.
- Never put payment secrets or server credentials in the mobile bundle.
