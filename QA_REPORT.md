# RideOn End-to-End QA & Reliability Report

Date: 2026-09-24
Branch: `feat/mobile-production-release`
PR: #16
Head at report generation: `27a171c8f7f0f57dd7934f7f62a09944d07bf8d2` (subsequent QA fixes are also on this branch)

## Test methodology

- Inspected the current mobile and API implementation before making changes.
- Inspected the complete migration chain through migration 025 without editing an applied migration.
- Reviewed existing automated API tests and CI workflows.
- Applied targeted fixes only where an implementation defect or release blocker was found.
- Local execution was attempted, but the execution environment cannot resolve `github.com`, so the repository could not be cloned and the local Node/Expo suites could not be executed here.
- GitHub Actions runs for the current branch were triggered by the changes but remained queued at the time of this report. Therefore no queued CI run is marked PASS.
- No production database was reset or recreated.

## CRITICAL

| Test scenario | Result | Root cause | Fix applied | Remaining issue |
|---|---|---|---|---|
| Customer payment → real UPI → provider verification → webhook → confirmation | FAIL | The repository has no verified live Paytm checkout/status/refund adapter. | Existing fail-closed behavior retained; no fake payment success added. | Implement and stage-test the real Paytm adapter before production payment testing. |
| Admin login → dashboard → users/vendors/vehicles/bookings/payments/refunds/deposits/deliveries/reviews/support/audit | FAIL | Admin/Ops foundation is in PR #14 and is not part of the current PR #16 branch. Current branch has only support/admin ticket endpoints, not the full Admin/Ops API/UI. | No duplicate admin system was rebuilt during this pass. | PR #14 must be integrated and its failing CI fixed before admin E2E can pass. |
| Current CI / full automated suite | FAIL — not yet executable/verified | Current GitHub Actions runs are queued; local repository execution is unavailable in this environment. | Added/fixed tests and allowed CI to trigger from the updated branch. | Wait for current API/mobile CI and fix any failures revealed by the actual runner. |

## HIGH

| Test scenario | Result | Root cause | Fix applied | Remaining issue |
|---|---|---|---|---|
| Vendor security-deposit inspection endpoint | FAIL → FIXED in code | Mobile API called `POST /api/v1/vendor/bookings/:id/security-deposit/inspection`, but the current server had no matching route. | Added authenticated vendor-only route backed by the existing transactional repository inspection method. | Endpoint still needs runner/device E2E verification. |
| City/map center reliability | FAIL → FIXED in code | Customer UI defaulted to Udaipur; map implementations contained hardcoded Jaipur/Udaipur coordinates; delivery picker defaulted to Jaipur. | Removed production city/coordinate fallbacks. Map center now derives from actual vendor/current/delivery location data; when no location exists, the UI shows an explicit unavailable state instead of a fake center. | Physical map/API verification still required. |
| Vendor service-city isolation | FAIL → FIXED in code | Repository had a hardcoded Jaipur fallback when creating vendor profiles. | Production now requires an explicit service city; only test execution gets an isolated test-city fallback. | Vendor onboarding must be exercised against Render. |
| OTP generation | FAIL → FIXED in code | OTP used `Math.random()`. | Switched to `crypto.randomInt()`. | Delivery provider/device testing still required. |

## MEDIUM

| Test scenario | Result | Root cause | Fix applied | Remaining issue |
|---|---|---|---|---|
| Notification inbox/read state | PASS in code/test coverage; runner pending | Notification backend/mobile implementation was newly added and had no complete server-route test. | Added authenticated notification inbox/read-state test plus push/notification service tests. | CI/device push verification pending. |
| Security-deposit payment notifications | PASS in code | Deposit state changes existed but customer notification coverage was incomplete. | Added held/released notification generation from authoritative payment events; inspection emits pending/deduction notifications. | Physical/provider verification pending. |
| Booking concurrency/idempotency | PASS in existing automated coverage; runner pending | Existing PostgreSQL exclusion constraint, row locks and idempotency implementation were present. | No rebuild; preserved existing protections. | Actual CI and staging concurrency test required. |
| Tracking authorization | PASS in existing automated coverage; runner pending | Customer WebSocket and vendor update paths are ownership-scoped. | No unnecessary rebuild. | Physical network-loss/stale-GPS test required. |

## LOW

| Test scenario | Result | Root cause | Fix applied | Remaining issue |
|---|---|---|---|---|
| Legacy duplicate map screen | PASS — hardened | Two map implementations existed, increasing divergence risk. | Removed hardcoded coordinate fallback from the legacy screen too. | Legacy screen should eventually be removed if confirmed unused. |
| Production logging | PASS by inspection | Structured server logs remain, but they do not intentionally log OTP/payment credentials. | No blanket removal of legitimate operational logs. | Full deployed-log audit still required. |

## Existing coverage inspected

The current API test suite already covers:

- authentication/login
- anonymous route rejection
- token expiry
- booking creation/cancellation
- idempotency
- concurrent booking attempts
- availability
- invalid booking windows
- webhook validation/idempotency
- payment state machine
- refunds/idempotency
- security-deposit inspection
- vendor booking lifecycle
- vendor isolation
- delivery tracking authorization
- Supabase identity/role handling
- vendor service locations
- marketplace map
- route configuration failures
- reviews
- support tickets/messages/lifecycle
- support staff authorization

This report does not mark those tests PASS based only on source inspection; their current branch runner result is pending.

## Production configuration findings

### Safe / fail-closed

- Production requires `DATABASE_URL`.
- Production requires a strong `JWT_SECRET`.
- Production requires explicit `CLIENT_ORIGIN`.
- Production requires Supabase configuration.
- Production requires Paytm configuration and refuses non-Paytm providers.
- Payment operations refuse to claim success without a verified provider integration.
- Google Routes configuration is required in production.
- Tracking is restricted to active delivery sessions.
- Vendor/customer access is scoped server-side.

### Remaining production blockers

1. Real Paytm UPI checkout/status/refund adapter is not implemented and must not be simulated.
2. Admin/Ops PR #14 is not integrated into the current release branch.
3. Current branch CI is queued and therefore not yet verified.
4. Physical Android/iOS testing is still required.
5. EAS signing/store configuration remains a release task.
6. Restricted Google Maps keys and real Maps testing remain required.
7. Production notification push testing remains required.
8. Real security-deposit refund provider behavior remains dependent on the live payment adapter.

## Manual physical-device smoke suite still required

### Android
- Register/OTP/login/logout/restart/session restoration
- Browse/search/filter/details
- Quote/availability
- Booking with duplicate taps and network interruption
- Real Paytm UPI checkout once adapter exists
- Vendor accept/reject
- Delivery permission and active background GPS
- Lock-screen/background tracking
- Stale GPS/network loss
- Delivered → completed → review
- Support create/reply/resolve/reopen
- Notification permission, foreground/background, cold-start tap
- Vendor onboarding/fleet/image upload
- Vendor cross-account isolation
- Admin dashboard after PR #14 integration

### iOS
Repeat the same matrix, specifically checking:
- Safe areas
- keyboard behavior
- background location permission
- notification permission
- notification cold-start routing
- map rendering with restricted iOS key
- modal/back behavior

## Deployment decision

**Another production deployment is required after the current QA fixes are validated.**

Do not promote the current branch to live production yet. The current implementation intentionally blocks live payment success until a verified provider adapter exists, and the full Admin/Ops foundation is still separate.


## Observability pass — 2026-09-25

Implemented on this branch:
- privacy-safe structured request/error logging with request IDs and durations
- liveness `/health` and dependency readiness `/health/ready`
- forward-only analytics ledger migration 026 with idempotent event keys
- server-side admin metrics aggregation
- read-only financial reconciliation
- operational alerts for pending payments/refunds, stale/expired tracking and repeated push failures
- authoritative booking/payment/delivery/support/review/registration analytics events
- mobile error-reporting integration point with redaction of sensitive and location fields
- production operations runbook
- observability release gates and OpenAPI documentation
- observability privacy tests and readiness tests

Validation limitation remains: GitHub Actions must execute the current branch before any automated test or build result is marked PASS. Physical Android/iOS and live provider verification remain manual release gates.
