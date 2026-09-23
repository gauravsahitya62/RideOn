# RideOn payments — UPI-first

This document describes the MVP UPI payment architecture.

RideOn keeps booking state and payment state separate. A booking is not treated as paid merely because a customer returns from a UPI app or submits a transaction reference.

## Environment

`PAYMENT_PROVIDER=upi`
`UPI_VPA=<RideOn merchant VPA>`
`UPI_MERCHANT_NAME=RideOn`
`UPI_WEBHOOK_SECRET=<server-side callback verification secret>`

## Flow

1. Create the booking request.
2. Create or reuse the active UPI payment using the server-calculated INR amount.
3. Open the returned `upi://pay` URI when a compatible UPI app is available.
4. Treat app return as a client-side signal only.
5. Allow the customer to submit a UPI transaction reference as supporting information.
6. Keep the payment in `pending` until an authoritative provider callback/reconciliation mechanism verifies the transaction.
7. Apply the callback transactionally and ignore duplicate event IDs.

## State machine

`unpaid → pending → paid`

`pending → failed`

`paid → refunded`

## Verification rules

The backend validates:

- authenticated customer ownership;
- authoritative booking amount;
- INR currency;
- payment/booking association;
- callback signature;
- provider event/reference ID;
- allowed payment state transitions.

A customer-entered UTR/reference never independently changes the payment to `paid`.

## Webhook

Provider callbacks use:

`POST /api/v1/payments/webhook`

with `X-UPI-Signature` and `X-UPI-Event-Id` or the generic `X-Payment-Signature` header.

## Production requirement

The repository implements the UPI-first boundary and secure state model. A real production payment integration is only complete when the selected payment infrastructure provides authoritative server-to-server verification and that mechanism has been tested in staging/device testing.

Refund completion likewise requires a verified provider/refund mechanism; a client action alone cannot mark a payment refunded.
