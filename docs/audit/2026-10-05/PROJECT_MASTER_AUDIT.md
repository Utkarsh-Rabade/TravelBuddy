# TravelBuddy — master audit

Audit date: 5 October 2026 (Asia/Calcutta). Scope: supplied workspace, not an assumed deployed application.

## 1. Executive summary

TravelBuddy is an early single-application Next.js prototype for families arranging elderly-traveler assistance and companions providing it. It contains a polished public landing page, Clerk authentication widgets, role selection, family/traveler/trip-request CRUD screens, companion profile/availability/upload screens, a heuristic matching implementation, and SQL designs for 17 tables. It is **not an operational booking, payment, trip-tracking or emergency-response product**.

The main issue is incomplete integration, not the choice of stack. Canonical SQL uses Clerk TEXT identities while much of the application still expects Supabase Auth UUIDs and old column names. The Supabase client never supplies Clerk session tokens. Matching has separate UI, identity, schema, policy and algorithm blockers. The current production build fails Next.js-generated route types. Source RLS allows companion self-verification and contains unsafe field-update and ownership boundaries.

**Do not launch publicly with real medical, KYC or location data.** Preserve Clerk, Supabase, the single-app structure and the existing visual identity. Repair one secure vertical slice before adding features. No implementation was performed by this audit.

### Evidence labels

- **FACT**: directly inspected source/configuration/filesystem.
- **RUNTIME**: observed local check or browser result.
- **STATIC**: consequence derived from code/SQL; not a live exploitation claim.
- **INFERENCE**: likely implication requiring further evidence.
- **RECOMMENDATION**: future work requiring approval.

All references are workspace-relative. SQL findings concern migration definitions; **remote schema, actual grants, deployed policies and production state were not inspected**. Missing runtime evidence never counts as a successful business flow.

## 2. Exact baseline

| Item | Observation |
|---|---|
| Repository | Single npm application; no application monorepo, workspaces, Turbo, mobile app or shared application packages |
| Branch / HEAD | `master`, `93e361e0bfaffe1f58801606411301304046d456` |
| Git history | One 5 September 2026 commit adding only README and .gitignore |
| Tracked files | Only `README.md` and `.gitignore`; source, migrations, workflow and package manifest were already untracked |
| Remote | None configured |
| Source | 20 page routes; one root layout; 37 application TS/TSX/CSS files |
| Database | Two active migrations, four archived migrations; 17 active table definitions and 92 policy definitions |
| Local runtime | Node 26.8.1, npm 11.19.0 |
| Data endpoint | Public/server Supabase URLs agree and point locally; no listening local Supabase/Postgres service; Docker daemon unavailable |
| Environment targets | Application target differs from both workspace MCP and Supabase CLI link; not silently repointed |

Existing docs were preserved. Builds and browser QA ran against a permission-restricted temporary copy, using installed dependencies. The normal Turbopack build of that copy hit an external-node_modules-symlink limitation: **that failure is an audit-fixture limitation, not an application defect**. The webpack diagnostic build compiled and then failed generated route type checking at all seven `[id]` pages. No original source/configuration was edited.

### Actual checks

| Check | Result |
|---|---|
| `tsc --noEmit --incremental false` in supplied workspace | Exit 0 with existing generated artifacts; insufficient evidence of clean-build compatibility |
| `npm run lint` | Fails: removed `next lint` interpreted as directory `lint` |
| `eslint src` | Exit 2: ESLint 10 cannot find flat configuration |
| Isolated `npm run build -- --webpack` | Fails: seven synchronous `params` definitions violate Next.js 16 Promise route props |
| Existing Playwright tests, isolated Chromium, base URL 3100 | Two navigation tests pass; homepage assertion fails ambiguous text locator; no authentication tested |
| Pure matching fixtures | Pending/wrong-language/empty-slot candidate scores 37; verified unavailable candidate scores 70; unrelated dates receive same availability points |
| React trip form fixture | Existing-data form throws “Too many re-renders”; creation form renders |
| `npm audit --json` | Seven affected dependency nodes: six high, one critical; advisory applicability separately assessed |
| Read-only Chromium navigation | Landing/auth render; companion dashboard 404; family/traveler dashboards remain loading; trip creation reports unauthenticated; matches remain loading with params errors |

## 3. What is genuinely working, broken and unverified

**RUNTIME working:** public landing rendering at desktop/mobile, page title and Earth asset, auth-widget rendering, email/password input presence, Google entry-button presence, mobile menu opening. Form shells render without submitting.

**Broken by runtime/static evidence:** production route type check; lint; companion dashboard route; role metadata consistency; Clerk-to-Supabase identity propagation; legacy family queries; traveler encryption contract; trip editing; matching loading and persistence; KYC record contract; CI test/deploy definitions.

**Missing:** operational booking/payment/refund/payout flows, trip/check-in/location/SOS workflows, chat/notifications, admin verification console, rating workflow, delivery workers, observability and recovery runbooks. Their table definitions are not working features.

**NOT TESTED:** completed signup, login, Google OAuth, role persistence, authenticated CRUD, live RLS, remote migrations, storage access, paid bookings and all safety workflows. Credentials/test accounts, a running isolated database and connected diagnostics are prerequisites. We intentionally did not mutate external accounts or data.

## 4. Top ten problems

1. Clerk identity is not propagated to Supabase; legacy Auth/UUID assumptions remain (`TB-001`, `TB-002`).
2. Companion INSERT/UPDATE policies let owners choose trusted verification/rating fields (`TB-006`).
3. Production build fails seven Next.js route contracts (`TB-003`).
4. Role metadata is written to unsafeMetadata but read inconsistently; companion redirect is a 404 (`TB-004`, `TB-005`).
5. Matching is blocked by never-cleared loading, stale columns, denied updates and non-atomic status handling (`TB-010`–`TB-013`).
6. Medical/contact encryption executes from client imports with an unavailable private key, wrong RPC contract and array/BYTEA mismatch (`TB-008`, `TB-009`).
7. Trip/consent/message/SOS policies have wrong relationship traversal and unsafe update boundaries (`TB-007`, `TB-015`–`TB-019`).
8. Booking/payments and operational safety features are absent despite public safety promises (`TB-020`, `TB-021`).
9. KYC storage provisioning, upload validation, verification persistence and approval/expiration are incomplete (`TB-022`–`TB-024`).
10. Reproducible source baseline and deployment gates are absent: ignored lockfile, almost entirely untracked app, broken lint/test CI and PR deployment marked production (`TB-026`–`TB-029`).

## 5. Reading guide

| Report | Main coverage |
|---|---|
| [Architecture](PROJECT_ARCHITECTURE.md) | Baseline, dependencies, filesystem, all routes, frontend boundaries, Git and duplication |
| [Database](PROJECT_DATABASE_AUDIT.md) | All migrations, table/column ledger, ER model, every table's RLS and app/schema consistency |
| [Authentication](PROJECT_AUTH_AUDIT.md) | Clerk/Supabase lifecycle, legacy assumptions, roles/JWT/admin trust |
| [Security](PROJECT_SECURITY_AUDIT.md) | Severity findings, secrets/configuration, RLS interpretation, safety risks and hardening |
| [UI/UX](PROJECT_UI_UX_AUDIT.md) | Cross-application screen review, screenshots, accessibility and design roadmap |
| [Performance](PROJECT_PERFORMANCE_AUDIT.md) | Measured observations, query/render risks and scale roadmap |
| [Testing](PROJECT_TESTING_AUDIT.md) | Exact checks, browser receipts, exclusions and 20-flow coverage matrix |
| [API](PROJECT_API_AUDIT.md) | All actions, query/mutation modules, business processes and missing service lifecycles |
| [Feature matrix](PROJECT_FEATURE_MATRIX.md) | Intended vs actual product, both journey ledgers and scored completion model |
| [Issue register](PROJECT_ISSUE_REGISTER.md) | Actionable evidence, impacts, priorities, dependencies and recommended fixes |
| [Roadmap](PROJECT_ROADMAP.md) | Incremental target architecture and 12 controlled implementation phases |
| [MCP/tooling](PROJECT_MCP_TOOLING.md) | Configured vs available tools, safe permissions and missing integrations |

Screenshots are under `evidence/`; they contain only signed-out public/form-shell UI. Private configuration values, account payloads and raw private logs are not report artifacts.

## 6. Technology stack / external services

Next16.3.4, React/DOM19.2.8, TS7.0.2, Tailwind4.3.3, Clerk Next7.9.1, Supabase JS2.115.0 and CLI2.116.0, ESLint10.10.0 and Playwright1.63.0. Lock/installed versions agree; declared ranges are unpinned and lock is ignored. Actual external runtime services: Clerk widgets and attempted local Supabase DB/Storage/RPC. Stripe/email/SMS are placeholders; Vercel is deployment configuration intent, not verified hosting. Full dependency engine/advisory evidence: architecture/security reports.

## 7. Repository structure / architecture

One `src/app` application, shared form/UI components, one matching-action module, Supabase/encryption/matching libs, canonical/archive SQL, one smoke-test file and public Earth asset. No monorepo/backend API application/mobile app/shared product packages. Tool skill templates are not applications. The architectural fault is partial Clerk conversion and disconnected lifecycle authority, not too few frameworks.

## 8. Route architecture

20 page routes, one Server root layout, two server auth wrappers and18 client pages. No proxy/middleware, dashboard layout, app API handlers or segment loading/error/not-found files. Every route is mapped with user/data/operations/status in architecture report. Companion dashboard and family trips navigation targets are missing; request-to-matching navigation absent; draft edit conditional is wrong. Browser404/spinners independently corroborate key static defects.

## 9. Authentication architecture

Clerk UI is present and renders; complete signup/login/OAuth/session/onboarding NOT TESTED. Role selection writes unsafeMetadata while checking publicMetadata; landing reads unsafeMetadata. No trusted server role resolver/Clerk server auth or token bridge. Legacy Supabase Auth checks do not obtain the Clerk identity. Keep Clerk and native Supabase third-party integration; don't add another identity provider.

## 10. Database architecture

Canonical model: families→travelers/requests→matches/bookings→payments/trips→consents/locations/messages/SOS/ratings, plus notifications/audit/admin roles. UUID PKs, Clerk TEXT IDs. 17 tables have detailed columns/nullable/FK/ownership/lifecycle ledgers and ER model in database report. Active SQL has no explicit FK/performance indexes, triggers, user sync, storage policies or immutable lifecycle functions. Archived SQL's indexes/timestamps/Auth policies are not active canonical guarantees.

## 11. RLS architecture

All17 source tables enable RLS;92 policies use JWT sub helper and default PUBLIC role scope. Full per-table CRUD matrix is in database report. Important: missing UPDATE WITH CHECK implicitly reuses USING in PostgreSQL; not every absent explicit clause is an ownership hole. Explicit TRUE/pending-only checks and broad full-row privileges are real concerns. Unqualified absent inner columns can correlate to outer policy rows: consent/chat/SOS traversal is wrong, **not asserted to reject migration parsing**. Live deployment/grants remain unknown.

## 12. Business logic / state transitions

Present: profile forms, draft request code, heuristic match code. Missing: authoritative acceptance/reservation/pricing/payment/trip/check-in/completion/rating transitions. Enum CHECKs are not transition graphs. Request INSERT can choose arbitrary enumerated status if ownership check passes; family UPDATE only allows resulting draft/searching, blocking normal matched progress. Broad booking UPDATE allows price/status edits within pending/paid predicates. No multi-step rollback/outbox or meaningful audit writer.

## 13. Matching

Five score components sum nominally100: language25, assumed assistance25, any-slot availability20, verification15, experience15. No route logic, real date/time overlap, capability/expiry/booking conflict hard filter. Pending is intentionally queried; unavailable high-rated candidate scores70 in fixture. UI never exits loading and persistence expects absent columns. Algorithm rules are prototype choices, not an approved product specification.

## 14. Payments

Booking/payment tables/env names and Stripe reference strings only. No checkout/intents/webhooks/refunds/payouts/provider SDK, verified signatures, event inbox/idempotency or reconciliation. Payment success cannot be verified, and no booking system presently exists. Future booking/payment readiness must be transactional and reconciled across provider/DB failure.

## 15. KYC

Raw browser upload shell exists, without declared private bucket/policies, trustworthy MIME/size validation, encryption or admin review. App writes wrong verification column; normal owner INSERT denied. Upload/profile/record operations can diverge; remove doesn't clear verification; no rejection/expiration synchronization. Owner self-verification policy is the most serious trust defect.

## 16. Chat

Schema only; no UI/service/realtime, send policy, actor-membership/attachment/anti-spam/unread lifecycle. Companion access traversal wrong. “Edit within window” comment is not time enforcement. No message persistence or delivery was tested.

## 17. Notifications

Schema/provider env placeholders only; no app/email/SMS delivery, retries, dedupe/read UX or outbox. User update labelled mark-read permits whole-row mutation. Notifications are not an implemented SOS delivery mechanism.

## 18. Location

No GPS/map/polling/subscription or device behavior. Current-location BYTEA intent and plaintext historical coordinates exist, with no retention/coordinate/accuracy/freshness constraints. Tracking/battery/scalability cannot be declared operational from SQL fields.

## 19. SOS

No trigger→persistence→delivery→acknowledgement→escalation→response→resolution implementation. No insert policy/system writer; event/flag can diverge; actors/transitions/timestamps not fully guarded. Landing's dedicated simultaneous response-team claim is unsupported. Operational safety testing/drills are mandatory before restoring such claims.

## 20. Admin

No console/authorization resolver/bootstrap/audit writer. JWT role=admin and admin_roles super_admin/moderator/support are disconnected; self-referential policies risk recursion. Normal Clerk/Supabase role=authenticated is not a working application-admin mapping. No privilege escalation exploit through minted JWT was performed or proven.

## 21. Frontend architecture

Local React state/useEffects with repeated loaders/headers/auth lookups; no shared query or validation layer. Staged companion saves risk stale values; request edit render loop confirmed. Giant client landing combines presentation/identity/navigation. Preserve useful forms/modules; consolidate canonical operations incrementally after regressions are covered.

## 22. UI/UX assessment

Public Earth/typography/cards/CTAs are visually coherent and actually responsive at inspected sizes. Core task UX is weaker: unreadable light-form values, endless spinners, wrong links, missing dashboard/mobile nav, ambiguous multiple saves, unimplemented legal/safety functionality. Solid-color contrast: muted footer2.67:1; pale-on-light input risk1.11:1; regular landing body5.96:1. Full authenticated/mobile/accessibility compliance not established.

## 23. Security assessment

P0 trusted verification/field/identity/encryption/ownership boundaries need repair before real data. No hardcoded live secret pattern found in non-private app source; private env/runtime files exist and were not copied. No source XSS/custom SQL-injection/unsafe redirect sink found, not a penetration-test guarantee. Critical dependency advisory is recorded with absent current next/og exploit path. RLS source review must be followed by live grants/negative tests.

## 24. Performance assessment

Current bottlenecks are correctness (render loop/loading) and integration. Likely future risks: hydration/Clerk/family query waterfalls, per-item crypto RPCs, unindexed FK/RLS joins, unbounded candidate ranking, repeated inserts and future telemetry/outbox volume. No production latency/Core Web Vitals/bundle/load/EXPLAIN benchmark exists. Avoid microservices/performance rewrite before measuring a functioning slice.

## 25. Testing assessment

Three logical Playwright URL/title smoke tests, seven configured browser variants. Audit Chromium rerun:2 pass,1 fail ambiguous homepage locator. No auth submission/core mutations/SQL/RLS/payment/SOS tests. Additional audit-only read-only probes verified15 distinct routes/screens; synthetic pure functions reproduced unsafe ranking and React edit loop. Detailed commands/results/blockers are preserved as redacted summaries in testing report; unrun browsers/live database/production remain unverified.

## 26. Deployment assessment

Vercel intent/config only. Workflow is not release-ready: Node20 vs library>=22, ignored lockfile, no npm test, no browser/server lifecycle, build env only in E2E, preview-labelled deployment uses --prod --force, migration step echo. No remote/release/domain/SSL/backup/PITR/restore/monitoring/on-call evidence. Do not run existing deployment workflow before review.

## 27. MCP/plugin/tooling assessment

Workspace describes Supabase/Clerk/GitHub HTTP MCP; runtime does not expose callable integrations. Supabase descriptor has broad mutable groups and no read_only. App/CLI/MCP target mismatch retained, not repointed. Built-in browser timeout didn't create a tab; isolated project Playwright supplied local evidence. No Stripe/Vercel/Sentry active integration/plugin. Native file/shell/git/docs tooling works. No service was connected or production data read/modified.

## 28. Technical debt / duplicate code

Partial authentication conversion is highest debt. Unused nested MatchResultCard copy, unused matching read/update helpers repeated by actions, unused MatchExplanation and repetitive status/auth/load/header code risk divergence. Only tiny direct imports are unnecessary; no evidence justifies switching framework/state stack. Generated files/skill templates should not pollute baseline/type scope or be treated as product apps. Git history cannot prove repeated AI rewrites.

## 29. Broken vs missing functionality

Broken means source/runtime flow exists but fails its current contract: identity/roles/CRUD boundaries, params build, trip edit/list, match loading/storage/selection, KYC persistence, navigation and lint/CI. Missing means no runtime flow exists: bookings/payments/trips/check-ins/tracking/SOS/chat/notifications/ratings/admin/audit/production ops. Unverified means auth mutations/live schema/grants/provider deployment unavailable or intentionally excluded; do not relabel those successful.

## 30. Feature completion estimates

**Codebase capability completeness≈16%; functional MVP≈10%; verified end-to-end0%; production readiness0% against launch gates.** Rubric:17 separately scored areas×4 evidence gates,275/1700=16.18%, with zero credit for schema-only operational features. Functional estimate is2 of20 narrowly runtime-verified entry capabilities, not full auth or core journey. These are conservative heuristic capability estimates, not measured test coverage/effort percentages. Full area scores and both step-by-step journeys: feature matrix.

## 31. Production readiness

No launch sign-off: reproducible clean deployment, trusted identity, negative RLS, protected sensitive storage, complete booking, reconciled payments, safe delivery/SOS, critical regressions, monitored recovery and truthful legal/support gates are not accepted. Real operational/financial/medical/verification data should not enter this prototype until appropriate gates pass.

## 32. Critical risks / what not to change

Biggest security: self-verification, broad trusted-field updates, missing native identity bridge, unsafe sensitive-data pipeline and incorrect ownership/consent graph. Biggest architecture: stale canonical contracts and no authoritative transactions/operational event delivery. Biggest UI: safety claims/role404/spinners/wrong links/multiple saves/legibility. Biggest performance: render/loading defects now; unbounded/unindexed/waterfall architecture later.

**Preserve:** Clerk, Supabase internal UUID + Clerk TEXT intent, Next App Router, matching-module separation, useful profile/request forms, TravelBuddy Earth/chrome visual identity, existing migrations/archive/history and unrelated local changes. Do not disable RLS, put service role in client, replay archive/reset a DB, switch providers or launch a rewrite.

## 33. Recommended target architecture

Native trusted Clerk identity→typed request/session-token user data client→validated owner-scoped domain operations→transactional state/constraints→verified financial inbox/durable delivery outbox→server-confined sensitive storage/audits/operational monitoring. Keep modular monolith; add bounded workers only for durable operational work. Details and migration safety in roadmap.

## 34. Prioritized future roadmap

50 issues are registered with14 requested columns and concrete locations. First: source/environment/build foundation, native identity, critical trusted-field/crypto/ownership protections, then secure family/companion vertical slices and approved eligibility. Next: atomic booking/payment, trip communication/delivery, consent-bound location/operational SOS, admin and expanded test/UI/production gates. KYC minimum secure approval must precede real matching/bookings even though full admin phase is numbered9. Security/testing happen in every phase, not only phase10.

## 35. Next immediate implementation task

**Phase1 — foundation + critical bugs / trusted identity.** Start with a secret-free reviewed source baseline and explicitly selected isolated development target; repair clean-build/lint contracts. Then native Clerk token/owner/profile routing and critical RLS/crypto barriers. Do not start booking/SOS, redesign the landing or run a migration against a guessed target. Approval is required to proceed beyond this audit.

## 36. Definition of done for next milestone

1. Clean reproducible build/lint/test with supported locked runtime.
2. Signed-in synthetic family/companion reach real appropriate profile/dashboard routes.
3. Native Clerk token reaches isolated SQL and resolves the correct TEXT owner.
4. Negative other-user/anonymous/trusted-field/self-verification tests pass without privileged workarounds.
5. Sensitive synthetic payloads encrypt/decrypt server-side, fail closed and never expose keys; reviewed drift-aware forward changes only.
6. Evidence, unresolved gaps and recovery steps recorded; original history/working features preserved.

No production rollout/remote write is implied. **Audit complete within accessible repository/signed-out runtime scope; live/authenticated/operational gaps remain explicit. Stop and await implementation approval.**

## Requested phase coverage index

| Phase(s) | Evidence location |
|---|---|
| 0 baseline;1 inventory | Architecture + master baseline |
| 2 every route | Architecture complete route table |
| 3 auth | Auth report + legacy inventory |
| 4 schema;5 RLS;6 consistency | Database full table/column/CRUD ledger + mismatch register |
| 7 business;8 matching;9 payments;10 KYC;11 location/SOS;12 chat/notifications;13 APIs | API lifecycle/module/surface report |
| 14 frontend | Architecture frontend/duplication + UI source findings |
| 15 UI/UX | UI screen ledger, problem recommendations and screenshots |
| 16 performance | Performance evidence and scale plan |
| 17 security;18 env | Security threat/secret/environment/hardening ledgers |
| 19 tests;33 browser | Testing commands/runtime/20-flow coverage |
| 20 deployment | Roadmap deployment readiness + master assessment |
| 21 MCP/plugins | MCP/tooling capabilities and limits |
| 22 Git;23 duplication | Architecture Git/config and duplicate callers |
| 24 requirement matrix;25 completion;32 user journeys | Feature matrix and scored/step ledgers |
| 26 issues | Issue register TB-001…TB-050 |
| 27 target;31 implementation | Roadmap current→target and12 phased definitions of done |
| 28 scale | Performance10→100000-user plan |
| 29 security roadmap | Security before-MVP/beta/prod/after-launch gates |
| 30 design roadmap | UI MUST FIX / SHOULD IMPROVE / NICE TO HAVE |
| 34 reports | This master links12 companion reports; no previous doc overwritten |

## Final artifact/preservation verification

- 13 requested Markdown reports, 50 unique issue rows with14 columns, 17 table ledgers,12 roadmap phases and6 signed-out screenshots validated; local Markdown report links resolve.
- Baseline SHA256 comparison: **all268 pre-existing non-vendor/non-.next/non-.git files byte-for-byte unchanged**, including application/configuration/migrations/private inputs and existing docs. New workspace deliverables are confined to this audit directory.
- The read-only Supabase CLI version check incidentally refreshed its generated cli-latest cache; its exact original value and no-newline format were restored against the saved baseline hash. No configuration or database change was used to fix a test.
- Isolated QA server received SIGTERM and completed. No browser/sign-in session was retained in the application; no remote data/account mutation, migration, git write or deployment occurred.
