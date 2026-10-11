# TravelBuddy — API, services and business lifecycle audit

5 October 2026. Application server surface = **three exported Server Actions in one module**. There are no `route.ts` handlers, webhooks, Edge Functions, background jobs, RPC wrappers defined by this application, payment services or delivery workers. Supabase PostgREST/Storage/RPC are external SDK surfaces, not custom repository APIs.

## Complete server action register

All three use imported anonymous singleton Supabase, not request-scoped Clerk auth. No input runtime schema, ID length/UUID validation, rate limiting, idempotency key, transaction, correlation ID or structured error is present. TS types do not validate untrusted action invocations. Errors become generic success:false text with raw exception console logging.

| Action / lines | Input / output | Authorization and DB | Side effects / failure modes |
|---|---|---|---|
| findMatchingCompanionsAction:9–90 | tripRequestId string → up to 10 sanitized companion objects, score/text explanation/attempt ID; or generic failure | getUser; trip inner-join families.family_member_id; separate old family lookup/equality; calls matching helper | Queries unnecessary medical/KYC data; parallel attempt INSERTs; partial success can persist rows even if Promise.all fails; no dedupe/run identity; wrong columns and missing session block flow |
| getMatchAttemptsAction:95–160 | tripRequestId string → any[] attempts + companion names/status/rating | Same getUser + old family checks | SELECT match_attempts, order nonexistent match_attempted_at; does not return explicit public DTO; no pagination; read-only action despite action transport |
| updateMatchStatusAction:165–233 | matchAttemptId string, TS accepted/rejected union → updated any row | Same legacy getUser; nested trip_requests selects only families, then checks matchAttempt.trip_requests.family_id which was not selected | UPDATE nonexistent status/updated_at; source family policy denies UPDATE; no request/bookings transition or selection exclusivity; union not runtime validated |

Ownership check shape defect in update action exists **in addition to** the canonical schema defect. Fixing only family_member_id would still leave missing selected family_id. Replacing anonymous client with service-role merely to get success would create a privileged authorization bypass; do not do it.

## All non-action service functions

| Module / operation | Inputs, DB calls and callers | Important behavior |
|---|---|---|
| supabase.ts:6 singleton | Public URL/anon key; imported by pages/forms/actions/libs | No Clerk token/SSR cookie context; implicit Supabase Auth persistence; one instance exported |
| supabase.ts:9 createServerClient | Server URL/service-role key; no caller | Privileged bypass client; no server-only guard; unused, not evidence of functioning system writes |
| encryption.ts encryptText/decryptText | Plain/cipher text and env key; calls pgp_sym_encrypt/decrypt RPC with custom parameter names | Extension is enabled, but no matching public wrapper/API signature defined; catches failures and returns null |
| encryptJSON/decryptJSON | JSON stringify/parse around above RPCs | No schema validation; parse failure/null indistinguishable from empty data |
| encryptStringArray/decryptStringArray | Per-element RPCs; array mapped/filter nulls | Wrong contract for scalar BYTEA; partially failed sensitive fields silently dropped; multiple network calls |
| matching/findMatchingCompanions | Trip ID; trip inner traveler/family SELECT; all verified/pending companions + verifications SELECT | Scores candidates in memory, filters >0, sorts descending; no session/owner validation inside library |
| matching/saveMatchAttempt | Trip/companion/score/text/status → INSERT | Stale match_score/status/match_attempted_at; no deduplication or transaction |
| matching/getMatchAttemptsByTripRequest | Trip ID → SELECT attempts and companion info | Unused duplicate of action read; stale order column |
| matching/updateMatchStatus | Attempt ID/status → UPDATE | Unused duplicate of action mutation; no auth/owner boundary |
| scoreCalculator | Untyped trip/candidate objects → rounded total and component scores | Pure heuristic, no live eligibility; details below |
| explanationGenerator | Untyped trip/candidate/score → explanation text | Assumes traveler object; repeats heuristic capability assumptions; no versioned evidence |

## Client mutation/query surface

No standalone hidden API modules were found. This table maps page-level operations; authentication/field details are in architecture/auth reports.

| Operation / files | Input / validation / ownership | Mutation / response / error / atomicity |
|---|---|---|
| Role choice, select-role | family/companion button; user exists check only | Clerk unsafeMetadata update; redirect; error logged but not shown; no profile write |
| Family create/edit | name, HTML required; create uses Clerk, edit legacy Auth | families INSERT/select.single or UPDATE by id; create redirects, edit local optimistic name; no affected-row validation on edit |
| Traveler list/detail | User family lookup and traveler ID; client ownership filters | SELECT * + sensitive RPC decrypt; catches generic failure; full fields overfetched |
| Traveler create/edit | Names, date, comma lists, required primary contact; client encryption; legacy owner lookup | elderly_travelers INSERT or UPDATE by id; alerts/redirect; encryption can silently null fields; no server atomic validation |
| Trip list/create/edit/detail | HTML required fields/max 3 chars; dates no order; client traveler ID | request INSERT draft or UPDATE; list wrong relationship shape; detail no explicit owner check; form edit infinite rerender |
| Match accept | Action ID; current user on client only | action updates attempt, client separately writes request matched and ignores returned error; no transaction/rollback/booking |
| Companion create/edit | Child local profile/calendar state; final click no child validation; legacy/Clerk mix | profile write followed by optional verification write; failure leaves profile saved; retry can hit unique user constraint |
| KYC upload/remove | File accept filter only; no server MIME/size validator or owner prefix | Storage upload before profile/verification; onUpload stores path; remove deletes object but does not clear persisted verification; orphan/dangling references |
| Public companion browse | No auth check; verified status filter, rating sort | Reads DOB and labels candidates available without availability predicate; no interaction onward |

## Product lifecycle reconstructed from code

```text
Present shells:
Landing → Clerk entry → inconsistent role selection
Family → create family → traveler CRUD → draft request → broken matching UI
Companion → create/edit profile → weekly availability → raw KYC upload attempt

Only SQL concepts after that:
match_attempts → bookings → payments → trips
trips → consents / locations / messages / SOS / ratings
notifications and audit_logs have no operational writers
```

| Business process | Input / intended state / ownership | Actual side effects, recovery and edge cases |
|---|---|---|
| Family/profile creation | Authenticated identity + name; one family per Clerk user | No provision-on-login; unique identity guards duplicates but no friendly existing-profile path; token bridge missing |
| Traveler management | Family-owned traveler, contact/medical/accessibility needs | No invitation/link identity validation; no sensitive fail-closed encryption; generic alerts; birthdate/age/date locale edge cases unchecked |
| Request | Family-owned traveler + IATA/dates/assistance/languages; starts draft | No same-family DB invariant, route/date rules or approved state graph; special instructions plaintext; no notification/audit |
| Match generation | Own request, eligible available verified companion | Prototype scores pending candidates; stale persistence; unbounded candidate fetch; partial writes no rollback; no audit version |
| Select companion | One exclusive valid attempt; promote request and book after mutual acceptance | Family UPDATE policy missing; request matched denied; client ignores error; no companion acceptance, reservation or booking writer |
| Verification | Private document + trusted reviewer decision/expiry | No reviewer/admin process; no state synchronization; direct profile status can be self-chosen under policies |
| Book/pay/travel/complete/rate | Selected eligible C, priced B, confirmed payment, paid active trip, completed eligible rating | **Missing implementation**; SQL enumerations alone do not enforce relationships or transitions |

Every present mutation lacks domain-event notifications/audits and a rollback strategy beyond generic failure. Simple one-row inserts are atomic at DB statement level; multi-step KYC/matching/selection are **not atomic workflows**.

## Matching engine: plain English and technical specification

It fetches a request, then visible companions whose status is verified **or pending**. It awards points for shared language, assumed assistance capability based on verification status, whether any calendar day has any slot, verification status again, and rating/trip experience. Any positive score survives; it sorts by score and saves at most ten attempts. The UI shows five and announces more without a mechanism to reveal them.

Technical formula (`score-calculator.ts:30–178`):

```text
L = round(25 * case-insensitive exact matched required languages / count)
    (25 if no required languages)
A = round(base(status) * factor(assistance))
    base: verified25, pending15, expired10, rejected0
    factor: minimal1, moderate0.8, maximum0.6, fallback0.8
V = 20 if no departure_date OR ANY calendar slot-array.length > 0 else 0
K = verified15, pending8, expired4, rejected0
E = round((rating_average/5)*10 + min(5, log10(max(1,total_trips))*2.5))
total = round(min(100, L+A+V+K+E))
```

- **No route match:** origin/destination never enter score; no candidate route data model.
- **No actual date/time overlap:** tripStart/tripEnd are parsed but unused. Blank slots count as available. No timezone, duration, exclusions or existing-booking conflict check.
- **No hard eligibility:** pending is included; language/capability/availability failures can still rank. Current RLS often hides other pending candidates from family users, so query intent and actual token-visible candidate set can differ.
- **No KYC expiration/background result gate:** joins verifications but scoring ignores documents/status/timestamps.
- **Double-counts verification:** assistance base and verification points both depend on it; ID verification is not proof of personal-care or medical capability.
- **No lower clamp/rating bound:** SQL allows DECIMAL(3,2) values outside 0–5. A 9.99 rating produces 20 experience points with zero trips in the isolated fixture.
- Languages use lower-case exact equality, no trimming/deduplication/locale canonicalization beyond form parsing; multi-language requirements contribute fractionally rather than hard coverage.
- Tie order inherits fetched rating order and stable sort; no deterministic ID tie-breaker. No minimum threshold except >0; no fairness/new-companion policy, geographical availability or ranking calibration.
- Explanation says verified companions can handle all assistance levels and lacks date/route evidence; when no language requirement it can produce empty “Speaks ” strength.
- Data overfetch: traveler medical/contact bytes and verifications(*) are loaded although scorer does not use them. DTO ultimately returns DOB unnecessarily; explanation embeds traveler name.
- Complexity: O(N·language-comparisons + N log N), all candidate payloads materialized; Promise.all parallelizes trivial async scoring but does not reduce DB fetch. API default row cap may silently truncate candidates. Up to ten separate inserts; no cache/dedupe/run version/eligibility snapshot/expiry or selection lock.

RUNTIME pure fixtures: pending + wrong language + empty slot + maximum assistance = **37**; fully verified/high-rated but empty calendar = **70**; unrelated departure dates both get **20** availability points. These reproduce heuristic defects, **not proof live matching succeeds** (the overall flow is blocked).

Intended rules come from landing/handoff (route, language, assistance, availability, verification, experience). No formal approved weight/threshold document exists; do not describe these prototype weights as approved business rules.

Primary future correction: verified, unexpired, capability/route/schedule/conflict-compatible eligibility **before** scoring, minimal candidate projection, versioned bounded deterministic scoring with truthful explanations, then transactional audited single selection. Keep a modular monolith; no new matching microservice is justified.

## Payments and booking audit

Schema includes Stripe reference strings, booking payment_status, ledger type for fees/payouts/refunds, and total_amount. **No Stripe import/dependency, checkout, payment-intent creation, webhook handler, signature check, event deduplication, refund/payout worker, fee calculation, receipt or reconciliation exists.** Environment names and comments describing service_role webhooks do not implement them.

Defaults permit a booking to be labelled confirmed while payment is pending. No paid-gate trip creation, one booking per request, reference idempotency, price/currency authority or out-of-order handling. No app currently writes bookings, so these are latent schema design gaps, not evidence unpaid trips have occurred.

Required future architecture: server-priced reservation, provider intent idempotency, signature-verified event inbox, monotonic payment reconciliation, transactional booking/trip readiness, durable outbox and retry/repair. Payment success must never be presented as booking success until persisted reconciliation confirms both. No money was moved or provider account inspected.

## KYC / verification audit

Upload component allows PDF/JPG/PNG in browser accept attribute and says max 10MB but enforces neither size nor trustworthy content. It generates Math.random filename without owner-scoped path, uploads raw file to `companion-verifications` bucket with a redundant same-name prefix, then calls parent callback. No encryption, signed viewer, backend review, malware scan, bucket provisioning/policies or cleanup is present.

Companion profile writes precede verification writes; verification uses nonexistent status and source INSERT is admin-only. Orphan objects/profile partial success and duplicate retries are possible. Removing file never tells parent to clear KYC path/verification record; existing documents state in edit is loaded but not used to initialize uploader. Verification expiration/rejection/reupload and companion status are unsynchronized. App comments “managed separately” name no implementation.

## Location / check-in / SOS audit

No geolocation calls, tracking map, update schedule, accuracy UI, Realtime subscriptions, polling, consent enforcement, encryption pipeline, battery policy or retention job exists. SQL only: encrypted current_location intent, plaintext historical points, recorded_at/accuracy, last_check_in and event incident fields.

Expected incident: trigger → atomically persist event/audit → durable notification → verified family/companion delivery → acknowledgement → escalation/response → guarded resolution. Actual: **none of these runtime steps exists**. No ordinary INSERT on sos_events; wrong reader traversal; resolved rows still satisfy one update actor branch; no status/actor/timestamp constraints or event/flag synchronization. No delivery SLA, offline fallback, location unavailable handling, deduplication or response team integration. Landing's one-tap simultaneous team/contact alerts are unsupported.

## Chat / notifications / ratings / admin

- Chat has only schema: no persistence caller, send policy, recipient membership validation, file attachment access, editing window, unread state, subscriptions, moderation/spam/rate limit. Wrong companion SELECT path and broad sender updates require repair before implementation.
- Notifications have no in-app/email/SMS delivery/read UI or workers. No outbox, retries, delivery acknowledgements/deduplication; user read policy allows more than read fields.
- Ratings have no INSERT/workflow/completion gate/aggregate updater. Trusted companion rating_average is presently owner-editable instead of derived.
- Admin has no console/routes or safe provisioning. Table role hierarchy is disconnected from JWT-admin policies and self-referential RLS. No application audit writer exists.

These are **MISSING**, not partially functional because table names appear in SQL.
