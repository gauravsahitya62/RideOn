# RideOn Razorpay UPI Payment Runbook

## Provider

RideOn uses Razorpay as the single real payment provider. The integration is server-side REST + Razorpay hosted Checkout. No Razorpay secret is shipped to Expo.

## Sandbox / test setup

1. Create or use a Razorpay test-mode account.
2. Generate a test Key ID and Key Secret.
3. Configure the RideOn API environment:

```dotenv
NODE_ENV=development
PAYMENT_PROVIDER=razorpay
RAZORPAY_ENVIRONMENT=test
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

4. Start the API and mobile app.
5. Create a normal RideOn booking. The amount is calculated by the server.
6. Start payment. RideOn creates a Razorpay order and opens a short-lived RideOn checkout URL.
7. Complete a test UPI payment in Razorpay test mode.
8. Verify that the provider callback/webhook causes the RideOn payment to become `paid`.
9. Kill/reopen the mobile app and use Refresh payment status. The server remains authoritative.

## Production Render configuration

Set these server-only Render environment variables:

```dotenv
NODE_ENV=production
PAYMENT_PROVIDER=razorpay
RAZORPAY_ENVIRONMENT=production
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Never use `EXPO_PUBLIC_*` for these values.

Production startup rejects:
- `PAYMENT_PROVIDER=mock`
- non-Razorpay payment providers
- missing Razorpay production credentials
- missing webhook secret

## Webhook

Configure this exact URL in the Razorpay dashboard:

```
https://rideon-api-262g.onrender.com/api/v1/payments/webhook
```

The webhook secret configured in Razorpay must match `RAZORPAY_WEBHOOK_SECRET`.

RideOn verifies the HMAC signature against the raw request body before parsing or applying an event.

Handled payment events include:
- `payment.captured`
- `order.paid`
- `payment.failed`
- `refund.processed`

A failed/pending refund is intentionally left in RideOn's `refund_pending` state until a confirmed refund event/result is received.

## UPI capabilities

RideOn does not hardcode Google Pay, PhonePe, Paytm, or other individual UPI applications.

The capability response reports the actual implemented integration boundary:
- UPI supported: yes when Razorpay is configured
- Hosted checkout: yes
- Individual UPI app list: not claimed
- Direct VPA collection: not claimed by RideOn's adapter

Razorpay Checkout is responsible for presenting the UPI methods enabled for the merchant account.

## Create-order flow

For an individual booking:

1. Authenticate the customer.
2. Load the booking with customer ownership.
3. Reject cancelled/rejected/completed/already-paid bookings.
4. Calculate amount from persisted booking pricing.
5. Under the existing payment lock, create/reuse the provider order.
6. Persist provider order ID, provider, exact amount in paise, INR and idempotency key.
7. Return a short-lived RideOn checkout URL.

For fleet orders the same provider adapter is used by `POST /api/v1/fleet-orders/:id/payment`, with the server-authoritative fleet order total.

## Verification

`POST /api/v1/payments/:id/verify` never trusts a client success flag or amount.

The adapter retrieves provider payments for the persisted provider order and verifies:
- provider order ID
- provider payment ID when supplied
- exact amount
- INR currency
- provider payment status

Only a provider-captured payment can transition to `paid`.

## Webhook recovery

The webhook is the recovery path when:
- the app is killed
- the network drops
- the browser closes
- the mobile callback is missed
- the customer never returns to the app

Duplicate webhook event IDs are ignored by the existing repository event ledger.

A confirmed payment cannot be downgraded by an out-of-order `payment.failed` event.

## Refunds

RideOn keeps the existing refund claim/idempotency flow.

The adapter:
1. Locates the original captured provider payment.
2. Looks for an existing Razorpay refund using the RideOn refund idempotency key or matching refund.
3. Creates a refund only when no matching refund exists.
4. Returns `confirmed=true` only for a provider-processed refund.
5. Leaves a pending refund in `refund_pending`.
6. Persists the provider refund reference through the existing repository.

Security deposits remain a separate RideOn operational lifecycle and are not treated as an ordinary rental-payment refund.

## Mobile flow

The mobile app:
1. Calls RideOn create-order.
2. Receives a safe checkout URL.
3. Opens the provider-backed hosted checkout.
4. Never receives the Razorpay secret.
5. Returns through the `rideon://payment-return` scheme when the provider callback is completed.
6. Refreshes authoritative booking/payment state from RideOn.
7. Never marks a payment paid locally.

A new production/native build is required after adding the `rideon` URL scheme.

## Troubleshooting

### Payment unavailable
Check:
- `PAYMENT_PROVIDER=razorpay`
- Razorpay Key ID/Secret are present
- webhook secret is present
- Render is running the latest deployment
- the key mode matches `RAZORPAY_ENVIRONMENT`

### Payment created but app still says pending
Check:
- Razorpay webhook delivery
- webhook signature configuration
- Render logs for `payment_webhook_processed`
- use Refresh payment status in the app

### Refund pending
This is expected until Razorpay reports a processed refund. Do not manually mark the payment refunded.

### Amount mismatch
RideOn intentionally rejects provider events whose amount does not equal the persisted booking/fleet order amount.

## Production verification checklist

- [ ] Razorpay live account/KYC/onboarding completed.
- [ ] Live Key ID and Key Secret configured only in Render.
- [ ] Webhook secret configured only in Render.
- [ ] Webhook URL configured exactly.
- [ ] Test payment completed in sandbox.
- [ ] Live low-value UPI transaction completed and verified.
- [ ] Duplicate webhook tested.
- [ ] App-kill recovery tested.
- [ ] Network interruption recovery tested.
- [ ] Refund tested and provider-confirmed.
- [ ] Fleet multi-vehicle payment tested.
- [ ] No mock provider enabled in production.
- [ ] No secrets committed to Git.
- [ ] Production mobile build regenerated after URL-scheme change.

## Provider documentation

Before production launch, the operator should verify the currently applicable Razorpay Orders, Checkout, Payments, Refunds and Webhook documentation in the Razorpay merchant dashboard/developer portal, because provider APIs and supported UPI methods can change independently of the RideOn repository.
