# RideOn marketplace payments — Paytm

RideOn treats the rental obligation and refundable security deposit as separate financial objects. The accounting ledger is not an internal wallet and is not described as an escrow account.

## Booking financials

- rental amount: rental charge attributable to the vendor.
- security deposit: refundable customer obligation.
- platform fee: existing RideOn platform charge.
- customer total = rental + security deposit + applicable customer fees.
- vendor settlement = rental - platform fee - approved adjustments.
- security refund = security deposit - approved deduction.

Security deposit money is never vendor revenue.

## Lifecycle

Rental payment:
PENDING -> PAID -> HELD/UNSETTLED -> SETTLEMENT_PENDING -> SETTLED

Security deposit:
PENDING -> HELD -> REFUND_PENDING -> REFUNDED

Damage:
HELD -> DEDUCTION_PENDING -> PARTIALLY_DEDUCTED -> REFUND_PENDING -> REFUNDED

Disputes are preserved as DISPUTED until an authorized resolution.

Vendor settlement is not triggered by payment success alone. Booking completion and return/inspection conditions are required.

## Paytm boundary

The server uses a provider abstraction for customer payment creation, verification, refunds, vendor settlement, settlement status, webhook verification, and reconciliation.

Configured variable names:
- PAYTM_MERCHANT_ID
- PAYTM_CLIENT_ID
- PAYTM_CLIENT_SECRET
- PAYTM_WEBSITE
- PAYTM_CALLBACK_URL
- PAYTM_WEBHOOK_SECRET

This session could not live-verify current Paytm external documentation, so the implementation intentionally does not invent Paytm endpoint URLs, payloads, checksum rules, marketplace product names, sub-merchant identifiers, or payout endpoints. Provider-specific live operations fail closed with PAYTM_ONBOARDING_REQUIRED until the verified Paytm product integration is enabled.

## Render

render.yaml contains only the non-secret provider selector. Put all Paytm credentials/secrets in Render Environment settings.

The old UPI_VPA and UPI_WEBHOOK_SECRET production dependency is removed.

## External onboarding

Before live transactions, complete Paytm merchant onboarding and confirm the exact Paytm products enabled for collections, refunds, and marketplace/vendor settlement. Do not describe the flow as escrow unless the actual arrangement explicitly permits that terminology.
