# RideOn payments — Razorpay

RideOn keeps booking state and payment state separate. A customer booking remains a booking request until the provider payment is independently verified.

## Environment

Set these on the API server and never expose the secret values to the mobile app:

`PAYMENT_PROVIDER=razorpay`
`RAZORPAY_KEY_ID=`
`RAZORPAY_KEY_SECRET=`
`RAZORPAY_WEBHOOK_SECRET=`

Use Razorpay test-mode credentials for development and CI. Do not place credentials in Git.

## API flow

1. Customer creates a booking request.
2. `POST /api/v1/payments/create-order` verifies ownership/payability and recalculates the authoritative INR total.
3. The API creates or reuses one active Razorpay order for the booking and stores the provider order reference.
4. The mobile app opens the native Razorpay checkout.
5. `POST /api/v1/payments/:id/verify` verifies the checkout signature but leaves the payment in `pending`.
6. Razorpay webhook `POST /api/v1/payments/webhook` is the source of truth for `paid`, `failed`, and `refunded` transitions.
7. The mobile app refreshes the booking state and only shows the paid confirmation after the backend reports `paymentStatus=paid`.

The webhook endpoint verifies the signature against the raw request body and persists the provider event ID for idempotency.

## Webhook configuration

Configure the provider webhook URL as:

`https://<rideon-api-host>/api/v1/payments/webhook`

Use the webhook secret configured as `RAZORPAY_WEBHOOK_SECRET`.

## Refund foundation

The backend contains a provider refund adapter and persisted payment refund state. A paid customer cancellation is intentionally blocked until RideOn has an approved cancellation/refund policy; this prevents the system from producing a cancelled booking with an unresolved paid state.

## Mobile build requirement

The mobile checkout uses `react-native-razorpay`, which is a native dependency. The live payment path therefore requires an Android/iOS development or production build (for example an EAS build) that includes the native module. Expo Go should not be treated as the live-payment runtime.

The existing mobile CI runs Expo Doctor; the payment dependency must also be installed before creating the native build.

## CI

CI should mock the provider boundary and independently test:

- server-side order validation
- checkout signature verification
- webhook signature handling
- provider-order/payment association
- state transitions
- duplicate event idempotency
- retry behavior
- refund state validation
