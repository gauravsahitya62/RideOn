# RideOn Security Audit

Date: 2026-09-25

## Scope
Security and privacy review of RideOn authentication, authorization, booking, pricing, payments, security deposits, vendor operations, live location, uploads, input validation, rate limiting, HTTP/CORS, database access, support/reviews, notifications/privacy boundaries, map/API-key configuration, and repository secret exposure.

## Findings and fixes

| Severity | Component | Finding | Root cause | Fix | Test / validation |
|---|---|---|---|---|---|
| HIGH | Payment events | A provider payment order could be paired with a different booking ID supplied in the event. | Event processing previously resolved the booking from the event payload instead of enforcing the persisted payment-to-booking relationship. | Payment events now resolve the booking from the persisted payment row and reject a mismatched event booking ID. | Repository payment-event path updated; targeted binding regression is included in the audit test plan. |
| MEDIUM | Legacy JWT | Locally issued JWTs did not require issuer, audience, or environment binding. | Verification checked signature and basic role claims only. | Tokens now carry and require issuer, audience, and environment. | Test: legacy JWT rejects wrong issuer, audience, and environment. |
| MEDIUM | OTP delivery/logging | Development OTP delivery logged and returned the OTP. | Development helper exposed the authentication secret to logs and API callers. | Development/test delivery now preserves the production response contract and never logs or returns OTPs. | Source audit confirms no development OTP output path. |
| MEDIUM | Vehicle image uploads | Client-declared MIME type could be spoofed. | Validation trusted the declared type after base64 decode. | Added base64-shape checks, decoded-size limits, and JPEG/PNG/WebP magic-byte validation. | Test: vehicle image validation rejects MIME-spoofed payloads before storage. |
| MEDIUM | Booking privacy | Ordinary booking payloads exposed exact delivery/vendor GPS fields outside active tracking. | Common booking serializer returned stored location fields for every booking response. | Exact delivery coordinates are now scoped to active authorized tracking/operational workflows; ordinary booking payloads omit them. | Test: ordinary booking responses do not expose exact GPS coordinates. |
| MEDIUM | Tracking WebSocket | The bearer token embedded in the existing WebSocket auth subprotocol was echoed in the response header. | Handshake selected the full auth-bearing protocol value. | Server still accepts the existing auth-bearing input but responds with fixed non-secret protocol `rideon-tracking`. | Handshake source review; mobile client input remains unchanged. |
| LOW | Booking validation | Vehicle IDs were unbounded at the API schema boundary. | Schema accepted any non-empty string. | Trimmed and capped vehicle IDs at 64 characters before repository access. | Schema validation review. |
| INFORMATIONAL | CORS/proxy | Production needed explicit configuration guardrails. | Permissive defaults could otherwise be inherited from environment mistakes. | Production rejects wildcard CLIENT_ORIGIN and trusts exactly one proxy hop. | Existing boot-time guards reviewed. |
| INFORMATIONAL | Maps/secrets | Native Maps keys are public client credentials, while routing/geocoding/service-role/provider secrets must remain server-only. | Client/server environment variables are easy to mix up during deployment. | Expo uses public map-key variables only; server-only keys remain non-EXPO_PUBLIC. | Configuration and commit-history checks found no committed service-role or Google API key. |

## Existing controls verified

Production protected routes use Supabase token validation. Server-side role checks are applied to customer, vendor, support, and admin operations.

Customer booking reads and cancellation are ownership-scoped. Vendor booking, vehicle, delivery, and service-location operations are scoped to the authenticated vendor. Support tickets/messages and reviews enforce ownership and role requirements.

Booking totals are recalculated server-side from persisted vehicle pricing, authoritative dates, and the delivery flag. Database booking overlap protection and idempotency controls are present.

Payment order creation uses the persisted booking total. Payment verification and webhook processing require provider-side verification/signature checks; mobile success alone does not advance payment state.

Refund and security-deposit transitions include server-side state checks and idempotency-oriented transaction records. Delivery tracking requires an authorized customer/vendor relationship and an active delivery lifecycle; late location updates are rejected.

SQL access is parameterized. Request body size is bounded. Helmet is enabled, X-Powered-By is disabled, and endpoint-specific rate limits cover authentication, reviews, support, and delivery GPS updates.

## Database migrations

No database migration was added by this audit. Existing migrations were not modified.

Existing schema protections reviewed include booking overlap constraints, idempotency uniqueness, payment-event uniqueness, and active-tracking uniqueness.

## Security tests

Added:
- Legacy JWT issuer/audience/environment rejection.
- MIME-spoofed image rejection.
- Ordinary booking GPS privacy.

Existing tests cover customer/vendor IDOR boundaries, vendor authorization, booking idempotency/concurrency, server-side pricing, payment webhook signature rejection, refund lifecycle, deposit authorization, tracking authorization, inactive vehicles, support ownership, review ownership, and booking lifecycle transitions.

## Validation status

The repository has a GitHub Actions API workflow with memory and PostgreSQL test jobs. The security changes were committed directly to main. CI should be checked against the latest security commit before production rollout.

A successful local production build is not claimed unless the corresponding build/CI result is available.

## Secrets requiring rotation

No committed secret was identified by the repository-level source/history checks performed during this audit.

Rotate any server credential if it has ever been pasted into chat, logs, screenshots, CI output, or a shared .env file. Server-only Supabase, payment, routing, geocoding, JWT, and provider secrets must never be placed in Expo public variables.

## Manual Render / Supabase / provider configuration

- Set an explicit production CLIENT_ORIGIN; do not use *.
- Set production DATABASE_URL with a least-privileged credential and TLS verification.
- Configure Supabase Auth and the server-side key expected by the API.
- Configure a real payment provider and webhook secret; production rejects the mock provider.
- Keep service-role, payment, routing, geocoding, and JWT secrets server-only.
- Restrict native Google Maps client keys to the RideOn Android package/iOS bundle and only required Maps APIs.
- Keep Render's reverse-proxy configuration consistent with the single trusted proxy hop.
- Configure real OTP delivery infrastructure; development/test OTP values are no longer emitted by the API.

## Remaining risks

Payment-provider-specific verification depends on the provider adapter being correctly onboarded/configured; the code intentionally fails closed when the live provider integration is unavailable.

Vendor service coordinates are required by the marketplace map contract and therefore remain visible to users of that workflow. Vendors should not store a private/home location as a public service point.

Authorized customers receive live GPS during an active delivery. A final production privacy policy should define retention/deletion of historical tracking data before broad rollout.


## Follow-up security hardening — 2026-09-25

| Severity | Component | Finding | Root cause | Fix | Test / validation |
|---|---|---|---|---|---|
| MEDIUM | Vendor/customer privacy | A vendor could retrieve a customer's review history from unrelated bookings after opening one of that customer's completed bookings. | The vendor endpoint loaded all reviews received by the customer instead of scoping the query to the authorized booking. | Added a repository method that enforces vendor ownership of the requested booking and returns only reviews attached to that booking; the endpoint now uses that method. | New regression test covers the booking-scoped history boundary. |
| MEDIUM | Authentication error privacy | OTP provider error text/status fields could be surfaced to API callers. | Auth handlers passed through provider messages and provider-specific fields. | OTP request and verification responses now use generic client-facing failure messages; provider details stay server-side. | Source validation confirms provider fields are not returned. |
| MEDIUM | Payment abuse | Payment order creation and provider verification had only the global API throttle. | Financial endpoints did not have a tighter operation-specific limit. | Added a 20 requests/minute payment-operation limiter to create-order and verification. | Source validation confirms both routes use the dedicated limiter. |
| LOW | API abuse/input | Vehicle IDs and several map/search query values were not consistently bounded at the HTTP boundary. | Client-controlled strings could pass into repository/provider paths without matching length caps. | Vehicle IDs capped at 64 characters; city/address and vehicle-search filters receive bounded input. | New oversized vehicle-ID regression test plus source validation. |
| LOW | Privacy | Pickup-only bookings could persist delivery GPS supplied by a caller even though no delivery workflow existed. | Coordinate normalization happened before applying the delivery flag. | Delivery coordinates are persisted only when delivery is enabled. | New pickup-only GPS privacy regression test. |
| MEDIUM | In-memory financial lifecycle | Refund idempotency could crash in memory mode. | Refund logic referenced an uninitialized `financialTransactions` map. | Initialized the in-memory financial transaction map. | Source validation confirms the map exists before refund operations use it. |
| LOW | Authentication logging | Registration diagnostics logged the authenticated account email. | Identity-link logging included the Supabase email for correlation. | Removed the email from that log event while retaining non-secret request correlation and account-type information. | Source validation confirms the identity-link event no longer logs email. |

## Follow-up validation

The server test source contains 57 tests after the added security regressions. The repository's API workflow is configured for both memory and PostgreSQL migration/test jobs. The GitHub connector did not expose a push-triggered workflow result for the latest security commit, so a passing CI/build result is not claimed here.

No database migration was added or modified; all follow-up fixes are application/repository-layer changes.

The repository-level secret scan performed during this audit returned no committed matches for the checked private-key, service-role, payment-secret, JWT-secret, or Google API-key patterns. This does not substitute for rotating credentials that may have been exposed outside Git history.
