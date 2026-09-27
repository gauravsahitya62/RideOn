# RideOn KYC Core

## Purpose

RideOn KYC is an isolated backend core designed so the identity-verification domain can later be extracted into a standalone B2B SaaS service for vehicle-rental operators.

The KYC boundary is deliberately independent from the payment provider and from vendor-era marketplace entities.

## Runtime boundary

~~~text
Expo / React Native
        |
        | authenticated HTTPS
        v
RideOn API
        |
        +--> KycEngine
        |       |
        |       +--> SHA-256 document fingerprint
        |       +--> global blacklist check
        |       +--> provider adapter
        |       +--> provider-specific verification policy
        |       +--> webhook processing
        |
        +--> PostgreSQL
                |
                +--> kyc_core.verifications
                +--> kyc_core.global_blacklist
                +--> public.customers.kyc_status
~~~

## Sensitive-data rule

Raw document numbers are normalized only in memory and immediately converted to SHA-256 before the blacklist lookup. Raw document numbers are not persisted by RideOn.

Captured document/selfie images are passed to the configured verification provider and are not stored in kyc_core.

Provider OCR output is persisted in ocr_data_extracted because it is part of the verification audit record. Production retention and access policies should be reviewed before enabling additional OCR fields.

## Verification lifecycle

For the current Cashfree Secure ID integration, RideOn verifies the Driving Licence number and date of birth through the Secure ID Driving Licence API.

~~~text
UNVERIFIED
    |
    v
PENDING
    |
    +---- Cashfree rejected ----> REJECTED
    |
    +---- Cashfree approved
              |
              v
           VERIFIED
~~~

The KYC engine still supports biometric policy fields for providers that require them. Cashfree Driving Licence verification does not automatically imply face liveness or face match; those are separate Secure ID products and must not be treated as completed unless explicitly integrated.

A document matching kyc_core.global_blacklist is rejected before any external provider request and the customer is moved to BLACKLISTED.

## Booking enforcement

The server checks KYC before:

- creating a single booking
- creating a multi-vehicle fleet order
- creating a single-booking payment order
- creating a fleet payment order
- calling the external payment provider

The authoritative failure contract is:

~~~json
{
  "success": false,
  "error_code": "KYC_REQUIRED",
  "message": "Verify your driver credentials before booking a vehicle."
}
~~~

## Provider adapter

server/src/services/kycEngine.js contains provider adapters for:

- Cashfree Secure ID
- Signzy
- HyperVerge

The active Cashfree integration uses the Secure ID Driving Licence endpoint with X-Client-Id, X-Client-Secret, and x-api-version: 2024-12-01 headers. Sandbox and production Secure ID base URLs are selected by environment, with sandbox as the safe default.

The verification endpoint and credentials remain deployment configuration. No fake provider or production mock is included.

The adapter normalizes provider responses into:

- PENDING
- APPROVED
- REJECTED
- provider verification ID
- government reference
- OCR result
- liveness score
- face-match score
- decision reason

Provider webhooks are authenticated with HMAC verification and deduplicated using provider_event_id.

## Configuration

Set a real provider before enabling KYC:

~~~env
KYC_PROVIDER=cashfree
KYC_CLIENT_ID=rideon_internal
KYC_PROVIDER_ENVIRONMENT=sandbox
KYC_PROVIDER_CLIENT_ID=<Cashfree Secure ID Client ID>
KYC_PROVIDER_CLIENT_SECRET=<Cashfree Secure ID Client Secret>
KYC_PROVIDER_API_VERSION=2024-12-01
KYC_PROVIDER_VERIFY_URL=https://sandbox.cashfree.com/verification/driving-license
KYC_DIGILOCKER_REDIRECT_URL=https://rideon-api-262g.onrender.com/api/v1/kyc/digilocker/callback
KYC_WEBHOOK_URL=https://rideon-api-262g.onrender.com/api/v1/kyc/webhook
KYC_PROVIDER_TIMEOUT_MS=30000
KYC_LIVENESS_THRESHOLD=0.70
KYC_FACE_MATCH_THRESHOLD=0.80
~~~

For production, switch KYC_PROVIDER_ENVIRONMENT=production and use production Secure ID credentials. The base URL becomes https://api.cashfree.com/verification; do not use sandbox credentials against production endpoints.

KYC_PROVIDER_VERIFY_URL is optional for Cashfree because the adapter derives it from the environment. If set explicitly, it must match the selected environment.

## Mobile

The current mobile KYC flow supports two methods:

1. Driving Licence number + date of birth, verified through Cashfree Secure ID.
2. Aadhaar through Cashfree Secure ID DigiLocker consent. The app opens the Cashfree DigiLocker URL in the browser and synchronizes the verification status when the customer returns to RideOn.

The backend sends the Driving Licence fields directly to Cashfree Secure ID. For Aadhaar, RideOn does not ask the customer to type an Aadhaar number; Cashfree handles the DigiLocker consent journey. Cashfree credentials are never sent to the Expo application.

RideOn stores the KYC status and provider reference needed to reconcile the verification. Raw Aadhaar numbers are not collected by the mobile flow.

## Future B2B extraction

The portable KYC domain boundary is:

~~~text
KycEngine
ProviderAdapter
VerificationPolicy
BlacklistRepository
VerificationRepository
WebhookProcessor
~~~

When extracted, client_id already provides tenant isolation semantics:

~~~text
rideon_internal
tenant_a
tenant_b
...
~~~

external_user_id remains the tenant's external identity reference rather than a KYC-core-owned customer identity.

## Migration

Database changes are forward-only:

~~~text
server/db/migrations/026_add_kyc_infrastructure.sql
~~~

Never reset production or modify an already-applied migration. Future KYC schema changes must use 027_*, 028_*, etc.
