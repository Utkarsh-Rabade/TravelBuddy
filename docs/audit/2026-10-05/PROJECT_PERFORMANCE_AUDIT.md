# TravelBuddy — performance and scale audit

5 October 2026. No load test, production traces, database EXPLAIN, real-user Core Web Vitals or completed production bundle report available. Below distinguishes measurements from architectural risks.

## Observed evidence

| Observation | Evidence / limitation |
|---|---|
| Source payload/complexity | Landing 1,131 lines; 90 star nodes; all 18 non-auth pages are client components; full-page headers/forms repeated |
| Asset | Earth source ~908KiB filesystem size; next/image fill/priority/sizes is used; delivered optimized size not measured |
| Fonts | Root Inter plus landing Inter, Space Grotesk and JetBrains Mono; duplicate Inter configurations, multiple weights; Next font build-time optimization present |
| Dev HTTP initial response | Home3.13s, auth0.48–0.56s, basic screens0.32–0.61s, matches0.92s; first dev compilation included; **not production latency or comparative benchmarks** |
| Browser at1440/390 | No observed landing network/console errors and matching viewport/document widths; no LCP/INP/CLS measurement |
| Browsing companions | 6 connection-refused requests within observation window; disconnected local DB and SDK retries, not high-volume query load |
| Matching synthetic behavior | O(N) scoring + O(NlogN) sorting; all candidates fetched; no actual date checks. This is correctness first, not a measured speed issue |
| Build | webpack compile6.2s then route types fail; production pages/bundles unavailable; default-copy Turbopack error was harness-specific |

## Current rendering/data-access risks (STATIC)

- Client pages wait for hydration/Clerk, then fetch family, then travelers. Repeated family lookups across pages cause waterfalls/full reloads (internal `<a>` rather than Link). No shared request resolver/cache/query state or server initial DTOs.
- All-public marketing is client-rendered for tiny menu/scroll/auth routing; splitting static sections into server presentation could reduce JS, but quantify after correctness and build fixes.
- Infinite-loading/React render-loop bugs are actual apparent performance failures; optimize those before bundle tuning.
- Encryption causes per-item network RPCs. Two arrays plus JSON are processed sequentially at top-level; decrypt arrays then contacts adds additional waterfall. Failing operations silently filter data. Correct server crypto batch/serialized fields, not a faster failing RPC loop.
- SQL SELECT * retrieves medical/contact bytes in family dashboard/list and matching; verifications(*) fetched for score unused. Overfetch increases sensitive boundary and network cost.
- Matching fetches all visible verified/pending candidates, scores in memory and writes up to10 separately. No database prefilter/date/conflict model/pagination/candidate cap/dedupe; Supabase max_rows1000 can silently truncate candidates and bias rank.
- No active FK/status/time/verified-candidate indexes; nested RLS repeatedly traverses families→requests→bookings→trips. Old archive indexes do not apply automatically to canonical tables.
- Scalar subqueries can error with multiple bookings; recursion in admin RLS is correctness/availability, not merely slow query.
- No dynamic imports/code-splitting beyond framework defaults, no measured large third-party map/chart/animation package. Do not remove core libraries for imagined bundle savings.
- Fixed blur/backdrop-filter, animated box shadows and 90 twinkles can raise paint/composition cost; no reduced-motion/offscreen pausing. GPU/battery impact **unmeasured**.
- No current Realtime/location subscriptions to leak or exhaust connections. Future 10-second telemetry at1000 concurrent trips would be ~100 inserts/s; illustrative budget, not implemented load.

## Capacity roadmap (recommendation, not measured capacity)

| Scale | Likely constraints / work | Gate before scaling |
|---|---|---|
| **10 users** | Integration/security/build blockers dominate; keep Next+Supabase+Clerk monolith; reliable onboarding/CRUD, guarded matching/booking, metrics and private fixtures | Core journey/negative RLS tests, staging isolated from production |
| **100 users** | Client waterfalls, unpaginated lists, missing FK indexes, duplicate match writes and admin/KYC backlog | Profile/request DTOs, query limits, EXPLAIN/index evidence, basic outbox/retries, p95 and error dashboards |
| **1,000 users** | Scanning candidates and event/query volume; whole-row overfetch; eventual location storage/subscriptions | Hard eligibility DB filters, bound ranking candidates, account-scoped caching, booking locks/idempotency, asynchronous notifications, retention and subscription budgets |
| **10,000 users** | Concurrent bookings, webhook bursts, worker throughput, telemetry history/retention and operational response capacity | Load tests with realistic mixes; job queues/backpressure/dead letters; scheduled aggregation/cleanup; location time indexes/partitioning if evidence warrants; DB/worker scaling |
| **100,000 users** | Regional latency, safety on-call/compliance, large geo-temporal histories, notification vendor quotas | Proven query/cache/partition plans, regional availability/recovery strategy, capacity budgets, separate independently scaling workers if bottlenecks measured; no automatic microservices rewrite |

At100/1000/10000, failures are **projected risks**, not tested user limits. Sensitive user-scoped caches must include identity/consent and invalidation; never share decrypted medical/KYC payloads in public caches.

## Measurement plan

1. Clean production build and synthetic secure staging; measure route JS/assets/fonts and public LCP/INP/CLS on mobile.
2. Instrument query counts/durations, identity/token refresh, server action latency and DB policy plans without PII/token logging.
3. Read-only EXPLAIN on representative owned queries; add reviewed forward indexes based on plans/selectivity.
4. Benchmark eligible candidate counts (10/100/1000) and concurrent selection, not only a pure scorer loop.
5. Simulate payment bursts/offline tracking/delivery retries in isolated fixtures; test budgets and retention.
6. Compare before/after same workload/device/network; report percentiles and error rates. Bundle lines, local compile time and file counts are not production performance scores.
