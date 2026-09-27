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
        |       +--> liveness / face-match policy
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

~~~text
UNVERIFIED
    |
    v
PENDING
    |
    +---- provider rejected ----> REJECTED
    |
    +---- provider approved
              |
              +-- liveness >= threshold
              +-- face match >= threshold
                       |
                       v
                    VERIFIED
~~~

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

server/src/services/kycEngine.js contains provider adapters for the common authentication patterns used by:

- Cashfree Verification
- Signzy
- HyperVerge

The verification endpoint and credentials are deployment configuration. No fake provider or production mock is included.

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
KYC_PROVIDER_VERIFY_URL=
KYC_PROVIDER_API_KEY=
KYC_PROVIDER_CLIENT_ID=
KYC_PROVIDER_CLIENT_SECRET=
KYC_PROVIDER_API_VERSION=
KYC_WEBHOOK_SECRET=
KYC_WEBHOOK_URL=https://rideon-api-262g.onrender.com/api/v1/kyc/webhook
KYC_PROVIDER_TIMEOUT_MS=30000
KYC_LIVENESS_THRESHOLD=0.70
KYC_FACE_MATCH_THRESHOLD=0.80
~~~

KYC_PROVIDER_VERIFY_URL must be the verification endpoint supplied by the selected provider/account. Do not point production at a fake or test implementation.

## Mobile

src/screens/KycVerificationScreen.js captures:

1. Driving licence or Aadhaar document
2. Live selfie

Both captures use:

~~~text
quality: 0.7
base64: true
~~~

The app uses expo-image-picker camera capture and has the required Expo config-plugin permissions.

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
