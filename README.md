# RideOn — mobile rental MVP

RideOn is an Expo / React Native customer app concept for booking cars and bikes with doorstep delivery. The repository also contains an Express API scaffold and a PostgreSQL schema starter.

## Repository map

- `App.js`, `app.json`, `package.json`: Expo mobile app.
- `src/services/api.js`: mobile HTTP client and configurable API base URL.
- `server/src/server.js`: REST API, validation, demo fleet and booking lifecycle endpoints.
- `server/src/server.test.js`: Node test-runner API tests.
- `server/db/schema.sql`: PostgreSQL starting schema (not connected to runtime yet).
- `.env.example`, `server/.env.example`: configuration templates.
- `.github/workflows/rideon-api.yml`: automated API test workflow.

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

Replace the example LAN IP with your computer's reachable local IP. Ensure the phone and computer share a network and your firewall allows port 4000.

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

Run tests with `npm test` from `server/`. The GitHub Actions workflow runs the API suite on relevant pushes and pull requests; check the Actions tab for its actual result.

## MVP limitations — do not use for live rentals yet

- Demo fleet and bookings are held in process memory and disappear on restart; PostgreSQL schema is a starting point, not wired to a runtime database adapter or migrations.
- Overlap prevention is process-local and not concurrency-safe across multiple server instances; booking creation records a request, not a confirmed reservation.
- Authentication, OTP, identity/license verification, owner and delivery-partner consoles, admin moderation, real payment/refund webhooks, push notifications, maps/geocoding, audit/monitoring, rate limiting, and production deployment remain to be integrated and security-reviewed.
- Prices and delivery fee are demo values; configure verified city-specific rates and taxes before launch.
- Never put payment secrets or server credentials in the mobile bundle.
