# RideOn Performance Audit

## Audit basis
Current release implementation audited at commit `9268c24855f7afd3396330f66f4eb9d81130ec6e`. The audit focused on actual query shapes, result bounds, request fan-out, tracking write/read frequency, notification fan-out, and existing routing/geocoding caching.

No existing migration was modified and no production database was reset.

## Bottlenecks found and changes

| Area | Evidence | Fix | Expected impact | Tradeoff | Migration |
|---|---|---|---|---|---|
| Marketplace vehicles | Active inventory query had no result bound | Added bounded limit/offset pagination (100 max) | Prevents unbounded DB results and mobile payload growth | Consumers with >100 matches must page | 027 |
| Vehicle filtering | Current city/type/order predicates lacked matching composite/functional indexes | Added vehicle catalogue indexes | Better index support as inventory grows | Extra index storage/write cost | 027 |
| Availability | Vehicle state and conflicting-booking checks were two DB round trips | Combined into one `NOT EXISTS` query | Removes one DB round trip per availability check | Slightly more complex SQL | 027 |
| Vendor fleet | Vendor vehicle listing was unbounded | Added 50-item limit/offset pagination | Bounds fleet reads and response size | Additional page requests for large fleets | 027 |
| Notifications | Notification list used `SELECT *` and a second count query | Explicit columns + window total in one query | Removes one DB round trip per page | Window total still processes matched rows | Existing 025 indexes |
| Tracking | GPS update path read the tracking session again after updating it | Reuses the write result; route update also returns latest session | Removes one DB read per GPS update | Response is sourced from the mutation result | none |
| Notification fan-out | Recipient notification writes were serialized | Parallelized independent recipient work | Reduces fan-out wall-clock time | More concurrent work for large recipient sets | none |
| Routing/geocoding | Existing bounded process-local caches and route refresh thresholds were already present | Kept existing controls; no new infrastructure | Avoids unnecessary provider calls within current policy | Cache is process-local | none |

## Existing controls confirmed
- Booking creation keeps database-level concurrency protection and idempotency.
- Tracking remains rate-limited and route recalculation is movement/time gated rather than every GPS coordinate.
- Routing and geocoding already use bounded short-lived caches.
- Financial, booking ownership, authorization, and security-deposit state remain database-authoritative.
- No Redis or new external cache was introduced.
- Image storage remains object-storage based.

## Cost audit
Exact production costs were not claimed because billing telemetry was not available in this audit. Likely variable-cost drivers are Render compute, Supabase/Postgres, Google routing/geocoding, payment provider calls, push delivery, image storage, and bandwidth. Current code controls map-provider usage with cache/refresh gates and controls notification duplication with idempotency.

## Measurement status
No latency or throughput numbers are fabricated. The available environment did not provide an executable checkout of the repository's Node/Expo toolchain, so automated benchmark execution remains a CI/staging task.

## Required staging load test
Run only against local/test/staging:
- vehicle listing
- availability
- quote
- booking creation
- payment creation
- notifications
- admin metrics

Record concurrency, p50/p95/p99 latency, errors, DB pool saturation, and provider call counts. Never run the load test against production.

## Remaining scaling risks
- Offset pagination can degrade at very large offsets; keyset pagination should only be introduced if measured as a real bottleneck.
- Process-local route/geocode caches do not share between multiple API instances.
- Admin aggregates are database-side but may need rollups only after measured growth.
- Live Paytm checkout/status/refund integration remains a separate production blocker.
- Physical mobile and staging performance validation remain required.

## Final summary
### Files changed
- `server/src/repository.js`
- `server/src/notifications.js`
- `server/src/server.js`
- `server/db/migrations/027_performance_indexes.sql`
- `PERFORMANCE_AUDIT.md`

### Migrations added
- `027_performance_indexes.sql`

### Performance improvements
- bounded marketplace inventory reads
- single-query availability check
- bounded vendor fleet reads
- one-round-trip notification page
- one fewer DB read per GPS update
- parallel notification fan-out
- query-aligned indexes

### Tests performed
- source-level audit against current release commit
- replacement-target validation during implementation
- automated CI/staging tests: pending

### Load-test results
Not measured yet; no fabricated figures.

### Render deployment
A Render deployment is required after CI/staging validation because backend code and a new migration changed. Do not treat the branch as production-ready until those checks pass.
