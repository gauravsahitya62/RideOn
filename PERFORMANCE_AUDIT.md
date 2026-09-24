# RideOn Performance Audit

## Audit basis
Audited the current release implementation at `9268c24855f7afd3396330f66f4eb9d81130ec6e`, focusing on query bounds/fan-out, availability, marketplace reads, tracking request work, notifications, and existing provider caching. No existing migration was modified and no production database was reset.

## Bottlenecks found and fixes
| Area | Evidence | Fix | Expected impact | Tradeoff | Migration |
|---|---|---|---|---|---|
| Marketplace vehicles | Active inventory read was unbounded | Limit/offset pagination, max 100 | Bounds DB results and mobile payloads | Large result sets require paging | 027 |
| Vehicle filters | City/type/order predicates lacked matching catalogue indexes | Functional/composite vehicle indexes | Better index support as inventory grows | Index storage/write overhead | 027 |
| Availability | Vehicle state and overlap were two DB round trips | One NOT EXISTS query | Removes one DB round trip per check | Slightly more complex SQL | 027 |
| Vendor fleet | Fleet listing was unbounded | Limit/offset pagination, max 50 | Bounds fleet reads | Large fleets need paging | 027 |
| Notifications | Page used SELECT * plus separate count query | Explicit columns + window total | Removes one DB round trip per page | Window total still processes matches | Existing 025 |
| Tracking | GPS update read the session again after writing | Reuse mutation result | Removes one DB read per GPS update | Mutation result is response source | none |
| Notification fan-out | Recipients were processed serially | Parallel independent recipient work | Lower fan-out wall time | More concurrent work for large support groups | none |

## Existing controls confirmed
- Booking concurrency/idempotency remains database-authoritative.
- Tracking route refresh is time/movement gated rather than every GPS coordinate.
- Routing and geocoding already have bounded short-lived in-process caches.
- No Redis/external cache was introduced.
- Financial/booking/authorization/deposit state is not cached as authoritative truth.
- Image data remains in object storage rather than PostgreSQL.

## Cost audit
Exact production costs were not claimed because billing telemetry was unavailable. Likely variable-cost drivers are Render compute, Supabase/Postgres, Google routing/geocoding, payment-provider calls, push delivery, image storage, and bandwidth.

## Measurement status
No latency/throughput numbers are fabricated. Full automated benchmark execution requires the repository toolchain in CI/staging; this environment did not execute the Node/Expo stack.

## Required staging load test
Run only against local/test/staging and record concurrency, p50/p95/p99 latency, errors, DB pool saturation, and external-provider call counts for vehicle listing, availability, quote, booking creation, payment creation, notifications, and admin metrics. Never target production.

## Remaining scaling risks
- Offset pagination may degrade at very large offsets; introduce keyset pagination only after measurement.
- Process-local route/geocode caches are not shared between API instances.
- Admin aggregates may need rollups only after measured growth.
- Live Paytm checkout/status/refund integration remains a separate production blocker.
- Physical mobile and staging performance validation remain required.

## Final summary
### Files changed
- server/src/repository.js
- server/src/notifications.js
- server/src/server.js
- server/db/migrations/027_performance_indexes.sql
- PERFORMANCE_AUDIT.md

### Migrations added
- 027_performance_indexes.sql

### Performance improvements
- bounded marketplace inventory reads
- single-query availability check
- bounded vendor fleet reads
- one-round-trip notification page
- one fewer DB read per GPS update
- parallel notification fan-out
- query-aligned indexes

### Tests performed
- source-level audit against the release commit
- replacement-target validation during implementation
- automated CI/staging tests: pending

### Load-test results
Not measured yet; no fabricated figures.

### Render deployment
Required after CI/staging validation because backend code and a new migration changed.
