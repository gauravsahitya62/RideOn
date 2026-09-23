# RideOn payments — UPI-first

RideOn uses UPI as the primary MVP payment method. Payment state remains separate from booking state.

## Environment

Set these on the API server and never expose server-side secrets to the mobile app:

`PAYMENT_PROVIDER=upi`
`UPI_VPA=<RideOn merchant VPA>`
`UPI_MERCHANT_NAME=RideOn`
`UPI_WEBHOOK_SECRET=<server-side callback verification secret>`

The API generates a trusted UPI payment URI containing the server-calculated INR amount and a unique payment reference.

## Payment flow

1. Customer creates a booking request.
2. `POST /api/v1/payments/create-order` authenticates the customer, verifies ownership/payability, derives the amount from the stored booking, and creates/reuses the active UPI payment.
3. Mobile opens the returned `upi://pay` URI when a compatible UPI app is available.
4. Returning to RideOn is never treated as proof of payment.
5. Customer submits the transaction reference only as supporting information.
6. The server records that reference as `pending`; it does not mark the payment paid.
7. An authoritative UPI/payment-provider callback must pass signature, amount, INR, booking association, event-id and state-transition validation before the payment becomes `paid`.

## Payment status

`unpaid → pending → paid`

Failure:

`pending → failed`

Refund:

`paid → refunded`

A submitted UPI reference is not sufficient to enter `paid`.

## Webhook

Configure the provider callback to:

`https://<rideon-api-host>/api/v1/payments/webhook`

Use `X-UPI-Signature` and `X-UPI-Event-Id` (or the generic `X-Payment-Signature` fallback) according to the selected provider adapter.

The callback must contain the authoritative booking/payment reference, amount in paise, currency `INR`, status and event ID.

## Important production limitation

The repository now implements the UPI-first payment architecture and deliberately refuses to treat manual UPI/UTR submission as payment confirmation. A real production payment integration is only complete once the chosen UPI/payment infrastructure provides an authoritative server-to-server verification mechanism and that mechanism has been exercised in staging/device testing.

## Refunds

Paid customer cancellation remains protected by the existing refund policy. Refund completion must be verified by the configured payment infrastructure before the database reaches `refunded`.
