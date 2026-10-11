# TravelBuddy — incremental target architecture and implementation roadmap

5 October 2026. **Recommendation only. Implementation requires approval.** Estimates are engineer-days/weeks with experienced developer + QA availability; external setup/product/legal/safety decisions can dominate calendar time. No full rewrite is recommended.

## Current architecture → target architecture

```text
CURRENT
Client pages/forms → anonymous singleton Supabase → canonical Clerk SQL
        ↘ mixed Supabase Auth / stale UUID-era fields
Matching actions → same singleton → stale attempt model
Client crypto RPCs; raw KYC upload; schema-only future services
Disconnected role/route logic; no authoritative domain transitions/outbox

TARGET (proposed, not implemented)
Clerk native verified identity + consistent onboarding/profile resolver
        ↓
Next public/server presentation + small interactive client components
        ↓
Request/session-token Supabase client with least-privilege RLS
        ↓
Typed, validated owner-scoped domain operations
  profiles / verification / requests / matching / bookings / payments / trips
        ↓
Transactional constraints + immutable trusted fields + event inbox/outbox
        ↓
Separate bounded workers where required (delivery/reconciliation/retention)
        ↓
Redacted audits, monitored failures, operational response and recovery
```

Stay on one Next.js application and Supabase/Postgres; no monorepo/microservice migration is justified. Worker functions are isolated operational executors, not a forced business-service rewrite. Hosted services must be approved and truly configured, not inferred from environment names.

### What stays / changes / eventual removals

| Keep | Change incrementally | Consolidate / eventually retire | Introduce only as needed |
|---|---|---|---|
| Clerk identity provider and prebuilt widgets | Native Clerk tokens, server guards, trusted role/profile onboarding | Active Supabase Auth UUID assumptions; unused NextAuth placeholders after caller check | Request-scoped typed user client and server-only system client |
| Supabase UUID PK + Clerk TEXT ownership approach | Verify live drift then reviewed forward RLS/constraints/indexes | Never erase archival evidence or rewrite applied migration history | Generated DB types, DTOs, field/state enforcement |
| Family/traveler/request/profile route intent and useful forms | Reliable state/validation/persistence/mobile shell | Duplicate nested match card, unused persistence helpers/repeated formatting | Minimal shared loading/errors/validation/domain operations |
| Matching module boundary | Hard eligibility then explainable deterministic scoring | Unsafe pending/capability/date heuristics | Versioned eligibility/ranking contract and atomic selection |
| Public visual identity/Earth/typography | Truthful safety copy, scoped accessible input/theme tokens | Redundant font/config patterns only after measurement | Coherent accessible task design and legal/support context |
| Simple Vercel/Next deployment direction | Correct preview/prod gates, supported Node, tracked lockfile | Draft Docker deployment if CLI is canonical; no deletion during audit | Environment validation, isolated fixtures, observability/restore runbooks |

## Controlled implementation phases

Every phase includes tests/security in its own definition of done. Phase10 is broad regression/hardening, **not permission to postpone authorization until the end**. Files are current modules; any new modules mentioned below are proposals, not existing directories.

### Phase 1 — foundation + critical bugs (exact next phase)

- **Objective:** stable, secure, reproducible baseline and trusted identity; do not add booking/tracking features yet.
- **Prerequisites:** approval; owner selects development environment; read-only live schema/grant/history comparison; synthetic Clerk test identities. Never infer remote target from a local config.
- **Modules:** package/lock/ignore, TS/dynamic routes, lint/workflow/Playwright config, lib/supabase/encryption, landing/select-role, active policy definitions only as references for *new* reviewed forward migrations.
- **Features/technical:** build/lint scripts; Promise params; trip form render fix; finite loading/role resolver/dashboard entry; native Clerk token bridge; canonical identity queries/types; protected server-only privileged/crypto boundaries; correct unsafe safety claims after product approval.
- **Database/security:** compare drift; prohibit owner self-verification/field tampering; repair critical graph/invariants in reviewed forward migration, not historical edits; fail-closed crypto and least-privilege user RLS; environment/secret hygiene. No production mutation without explicit separate rollout.
- **Testing:** clean build/lint/smoke; role/session synthetic flow; negative other-user/anonymous/trusted-field tests; crypto fixture round-trip/failure; no real PHI.
- **Acceptance / definition of done:** supported locked toolchain passes clean checks; role redirects reach existing routes; authenticated user token reaches isolated DB; cross-user writes and self-verification denied; no client key or silent encrypted-data loss; reviewed forward changes staged only in approved environment; evidence documented.
- **Risk/effort:** HIGH integration/security; ~7–12 engineer-days plus setup. Split execution into baseline/toolchain, identity/guards, data-contract/policy checks rather than one giant commit.

### Phase 2 — core family journey

- **Objective:** complete family→traveler→validated draft request as one usable secure journey.
- **Prerequisites:** Phase1 token/owner/type/crypto/RLS gates.
- **Modules:** dashboard/family routes, FamilyForm, TravelerForm, TripRequestForm; typed profile/request operations.
- **Features/technical:** idempotent family resolution, traveler add/edit/details, correct request object joins, finite errors, accurate navigation/edit/matching next step, preserved values.
- **Database/security:** same-family traveler/request constraint; sensitive serialization and controlled access; immutable owner identities, date/airport checks and timestamp behavior via forward migrations.
- **Testing:** two-family positive/negative CRUD, encrypted round-trip, invalid dates/IATA/identity, zero-row updates and retry/session change.
- **Acceptance/DOD:** synthetic family completes signed-in CRUD without console/server errors or hidden field loss; wrong family IDs denied; records/relations match canonical verified schema.
- **Risk/effort:** MEDIUM; ~5–8 days.

### Phase 3 — companion journey

- **Objective:** reliable role dashboard, owned profile and meaningful availability staging.
- **Prerequisites:** Phase1/2 identity/navigation foundation; agreed capability/timezone model.
- **Modules:** companions/create/[id]/edit, CompanionForm, AvailabilityCalendar; proposed dashboard resolver.
- **Features/technical:** single coherent validated save, existing-profile handling, availability times/timezone/conflict validation, read-only trusted eligibility status.
- **Database/security:** authoritative skill/capability and schedule representation if required via reviewed forward migration; no self-rating/verification; owner-only edit.
- **Testing:** persisted latest child input, invalid/overlap/overnight slots, repeat profile creation, account switching, tampered trusted fields.
- **Acceptance/DOD:** companion can return to profile and sees exact saved availability; no stale staged save; can't change approval/history fields.
- **Risk/effort:** MEDIUM; ~5–8 days.

### Phase 4 — matching

- **Objective:** eligible deterministic explainable results and one authorized selected candidate.
- **Prerequisites:** validated request/schedules/capabilities; approved verification pipeline (Phase9 minimum secure approval slice must precede real eligibility); agreed route/availability rules.
- **Modules:** matching libs/actions/matches page/cards; generated attempt DTOs.
- **Features/technical:** hard filters, dates/timezones/conflicts, bounded candidate query, stable ties/thresholds, truthful reasons, view-more behavior; loading/error fix; atomic exclusive selection.
- **Database/security:** canonical match lifecycle/run version/exclusivity and guarded transition; minimal candidate projection; no medical/KYC overfetch.
- **Testing:** eligibility denial (pending/expired/wrong route/no slot), ranking/ties/fairness fixtures, repeats/concurrent selection, partial-write recovery and RLS.
- **Acceptance/DOD:** no ineligible candidate appears; explanations match factors; selected state consistent atomically; performance measured with realistic candidate counts.
- **Risk/effort:** HIGH product/safety; ~1–2 weeks.

### Phase 5 — booking + payments

- **Objective:** companion acceptance/reservation and reconciled sandbox checkout/refund lifecycle.
- **Prerequisites:** Phase4 plus secure KYC approval; approved pricing/currency/fees/cancellation/payout policy and sandbox provider account.
- **Modules:** new booking/payment domain operations/routes and verified webhook; existing bookings/payments schema as baseline.
- **Features/technical:** server pricing, idempotent reservation/intent, signature-verified event inbox, deduped monotonic reconciliation, retries/repair, receipts/cancellation/refunds; define payouts before claiming support.
- **Database/security:** unique booking/reference/provider events, monetary invariants, transactional readiness; only trusted system controls payment fields; durable outbox/audit.
- **Testing:** success/failure/out-of-order/duplicate event, provider-success DB-failure, cancellation/refund replay, concurrent reservations/forged totals.
- **Acceptance/DOD:** payment success only yields ready booking after durable reconciliation; no double charge/reservation; repair is demonstrable without manual unsafe edits.
- **Risk/effort:** HIGH money; ~2–4 weeks plus provider/legal setup.

### Phase 6 — trip experience

- **Objective:** authorized paid-trip start/check-in/completion and post-trip rating eligibility.
- **Prerequisites:** Phase5 reconciled booking; consent and emergency scope approved.
- **Modules:** proposed trip/routes/domain ops, trips/consents/ratings/audit relationships.
- **Features/technical:** paid gate, participant views, guarded monotonic lifecycle, check-in visibility, completion/ratings and authoritative aggregates.
- **Database/security:** one active trip/booking, chronological/actor/state checks, completed-participant rating uniqueness, consent grant/revoke/expiry service.
- **Testing:** unpaid/unauthorized start denial, invalid transitions/replays, completion consistency, rating spoof/duplicate and expiry/revoke.
- **Acceptance/DOD:** no unpaid trip starts; participants see intended minimal fields; completion/rating aggregates reconcile and audit.
- **Risk/effort:** HIGH; ~1–2 weeks.

### Phase 7 — chat + notifications

- **Objective:** reliable participant communication/in-app delivery before operational safety alerts depend on it.
- **Prerequisites:** Phase6 participant/consent graph; approved delivery channels and message retention.
- **Modules:** proposed message/notification UI/services, messages/notifications/storage/outbox; no existing runtime implementation to reuse beyond schema.
- **Features/technical:** sender-owned messages, unread/read states, controlled attachments, paginated history, scoped realtime cleanup; email/SMS only with approved provider; dedupe/retry/dead-letter delivery receipts.
- **Database/security:** exact participant policies including INSERT, immutable actor/trip fields, bounded editing/deletion, attachment ACL, recipient-only read mutations and rate quotas.
- **Testing:** cross-trip sender/read denial, file access, spam/payload bounds, duplicate delivery/event, offline reconnect/subscription cleanup.
- **Acceptance/DOD:** durable message history and notification status with no cross-trip disclosure; missed delivery is visible/recoverable, not silently claimed sent.
- **Risk/effort:** HIGH privacy/operations; ~1–3 weeks.

### Phase 8 — location + SOS

- **Objective:** trustworthy consent-scoped tracking and operational emergency workflow, not merely a button/map.
- **Prerequisites:** Phase6/7; documented responsible response team, emergency fallback, location accuracy/retention/notification SLA and drill plan.
- **Modules:** proposed location/SOS clients/endpoints/workers; trips/locations/consents/sos_events/audit/outbox; mobile-web device testing.
- **Features/technical:** permission/freshness/accuracy UI, battery-aware update policy, offline buffering/ordering, consent revoke, trigger→durable incident→delivery→ack→escalation→resolution; “not emergency-service replacement” communication where applicable.
- **Database/security:** immutable participant/actor refs, bounds/retention/cleanup, active paid trip/consent gate, authoritative event/flag sync and guarded timestamps/states.
- **Testing:** no GPS/poor accuracy/background/offline/battery, stale/out-of-order telemetry, revoked access, recipient/vendor outage, duplicate SOS, missed ack escalation and actual response drill.
- **Acceptance/DOD:** drills prove event persistence, delivery evidence, fallback/escalation and audited resolution under failure; no unsupported safety claims.
- **Risk/effort:** VERY HIGH safety; ~2–4+ weeks with operational stakeholders. Do not make rescue guarantees from code tests alone.

### Phase 9 — admin + KYC

- **Objective:** least-privilege reviewer console and authoritative private verification lifecycle.
- **Prerequisites:** Phase1 trusted admin model and private storage; secure minimum review/approval slice is a **dependency of Phase4/5**, not work deferred until afterward. Full admin console may follow trip work.
- **Modules:** current upload/companion code plus proposed admin/review operations; admin_roles/verifications/audit/storage.
- **Features/technical:** upload submission, reviewer decision/reasons, expiry/rejection/reupload, signed private document view, synchronized eligibility, orphan/deletion recovery and auditable overrides.
- **Database/security:** nonrecursive admin trust, no client approval authority, field immutability, owner-scoped bucket access, document validation/retention and privileged-action audit.
- **Testing:** non-admin/other-owner access deny, expiry/race/status-sync, malicious uploads, reviewer tier restrictions, failed record creation/storage cleanup.
- **Acceptance/DOD:** only authorized reviewer can verify, actual review state controls match eligibility, private objects inaccessible to public/other users; immutable decision/audit receipts.
- **Risk/effort:** HIGH PII/trust; ~1–3 weeks. Move minimum safe KYC gate earlier in execution dependency graph.

### Phase 10 — testing + security regression

- **Objective:** comprehensive boundary and failure-path release proof, building on tests in every earlier phase.
- **Prerequisites:** working integrated staging features and deterministic synthetic fixtures.
- **Modules:** tests/config/CI, proposed SQL/RLS tests and sandbox event fixtures; all guarded domain operations.
- **Features/technical:** both user journeys, three browsers/real mobile, accessibility/keyboard, concurrency/idempotency, account-switch/logout, retry/offline/failure injection.
- **Database/security:** role×table×CRUD/column/relationship RLS matrix, privilege escalation, grant changes, crypto/key rotation, retention and migration replay in isolated DB; dependency/advisor review.
- **Testing:** coverage tied to20 critical capabilities, not line-count targets; no real PHI/payment/SOS sends to real people.
- **Acceptance/DOD:** critical flows/negative checks pass; P0/P1 defects resolved or explicitly exclude feature; no ignored failures, no RLS disable or privileged workaround; independent security review.
- **Risk/effort:** HIGH; ~1–3 weeks, ongoing thereafter.

### Phase 11 — UI/UX polish

- **Objective:** premium trustworthy accessible task experience while retaining current visual identity.
- **Prerequisites:** reliable behaviors; content/claims/legal acceptance.
- **Modules:** root/global styles, shared form/card/nav components, auth appearance, dashboard/error/loading/empty views and public page.
- **Features/technical:** semantic tokens/light-vs-dark scope, bounded forms/spacing, readable inputs, accessible nav/disclosures/labels/live messages, correct mobile layouts/touch targets/reduced motion, truthful explanations/illustrations.
- **Database/security:** no visual-only schema redesign; minimal DTO displays, consent/KYC privacy explanations, clear safety/error states.
- **Testing:** contrast/keyboard/screenreader, mobile/tablet/desktop screenshots, 320–1440 widths, focus/error recovery, no horizontal clipping and public CTA regression.
- **Acceptance/DOD:** task journeys usable with keyboard/mobile and readable at AA; no hidden/desynchronizing saves; unsupported claims removed; approved TravelBuddy style preserved.
- **Risk/effort:** MEDIUM; ~1–2 weeks. Fix core accessibility/navigation earlier, not postpone all UI defects.

### Phase 12 — deployment + production hardening

- **Objective:** controlled independently recoverable public deployment after release gates.
- **Prerequisites:** Phases1–11 relevant accepted features; approved operations/safety ownership; real production vendor configuration reviewed.
- **Modules:** package/lock/Node/CI, vercel.json, Supabase config/new forward migrations, environment runbook, provider webhook targets, proposed instrumentation/runbooks.
- **Features/technical:** dev/staging/prod separation, preview never production, branch protection/review, supported pinned runtime/action supply chain, migration review/checkpoint, deployment approvals/domain/SSL, rate limits and redacted monitoring.
- **Database/security:** production grants/issuer/storage verified read-only first; backup/PITR options confirmed; restore drill and forward repair plan; no destructive rollback/reset; secrets rotation and least-privilege identities.
- **Testing:** clean checkout build/lint/full gates; sandbox-to-prod webhook config check, smoke after deployment, failure/rollback/restore/on-call drill and telemetry/delivery budget/load tests.
- **Acceptance/DOD:** correct domain/TLS/vendor targets; no production writes from PR CI; verified restored data/recovered service; observed alerts/audit/incident escalation; all launch gates documented and signed off.
- **Risk/effort:** HIGH; ~1–2 weeks plus infrastructure/compliance/response readiness.

## Dependency order clarification

The numbered plan is not a permission to match/book unverified companions before Phase9. After Phase3, implement the **minimum secure KYC approval gate** from Phase9, then Phase4/5. Expand admin UX later. Likewise basic validation/tests/security and accessible errors happen throughout, with Phase10/11 consolidating proof/polish. A reasonable delivery sequence is1→2→3→9-minimum→4→5→6→7→8→9-full→10→11→12.

## Deployment readiness checklist — actual state vs required

| Area | Current evidence | Required before public production |
|---|---|---|
| Hosting | Vercel headers/draft action only | Verified actual project/region/domain/TLS/access config |
| Source/branches | master; one commit2 files; no remote | Reviewed full snapshot, secret/lock hygiene, deliberate main branch/protection |
| Runtime/build | LocalNode26; CINode20; build fails params | Pinned supported Node/deps, successful clean production check |
| CI/CD | Missing npm test/server/browser; preview uses prod | Minimal privileges, isolated fixtures/envs, preview/prod approval segregation |
| Migrations | Two canonical/four archived; workflow echo | Read-only deployed-history comparison, additive reviewed staging rehearsal and forward recovery |
| Supabase | Local endpoint down; live state unknown | Confirm issuer/grants/RLS/storage/network production configuration |
| Clerk | Development widgets; no native DB bridge | Production instance/redirects/native tokens/admin trust verified |
| Stripe/delivery | No runtime integrations | Sandbox proof, prod keys/webhook signatures/targets/idempotency/reconciliation and vendor quotas |
| Observability | console exceptions, unused audit_logs | Redacted structured logs/metrics/alerts, durable audits, monitoring owner |
| Backups/recovery | No runbook/drill evidence | Confirm provider backup/PITR retention; restore proof and RPO/RTO |
| Safety/operations | Landing claims, no response workflow | Staffed ownership, incident escalation drills, truthful emergency fallback/limitations |

## Immediate milestone and stop boundary

**Next implementation phase: Phase1 — foundation + critical bugs / trusted identity.** First execution task is a reviewed baseline/environment contract and clean-build repair; follow with token/identity/trusted-field fixes in isolated development. Do not begin payments, safety or a landing redesign first.

Milestone done only when: clean build/lint checks pass; signed-in synthetic family/companion resolve to real routes; user-token SQL recognizes correct Clerk identity; other-user and self-verification attempts are denied; sensitive fixture encryption is server-only/fail-closed; report evidence updated; source/migration history preserved. Any remote rollout requires target/authority confirmation. **Stop after this audit and await approval.**
