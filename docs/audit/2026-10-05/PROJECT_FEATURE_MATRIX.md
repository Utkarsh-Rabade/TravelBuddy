# TravelBuddy — requirements, feature matrix and completion

5 October 2026. Product intent reconstructed from landing/handoff, SQL/comments and forms; there is no formal approved PRD/algorithm/operational SLA in the repository. Treat prototype choices as current implementation, not approved requirements.

## Intended vs actual

| Feature | Intended | Implemented / partial | Broken / missing | Tested status | Production ready? |
|---|---|---|---|---|---|
| Public landing | Trustworthy travel-companion discovery | Complete responsive visual sections, Earth, CTAs | Unsupported safety/services claims, placeholder legal/demo profiles | Signed-out rendering/mobile menu verified | No public claim/legal gate |
| Authentication | Clerk Google/email/password session | Provider + widgets | Server guards/token bridge/redirect lifecycle | Widget/Google button only; no auth submission | No |
| Roles/onboarding | Family/companion appropriate profile/dashboard | Role buttons/metadata preference | public/unsafe mismatch; companion404; no provisioning | Signed-out card inspected | No |
| Family profile | One owner creates/edits family | UI and insert/edit code | No token; edit old Auth/column | Form only; edit error | No |
| Traveler profile | Owned secure sensitive records | Create/list/detail/edit forms | Legacy auth/schema; crypto array/BYTEA/RPC; linking/consent | Create shell; edit/decrypt NOT TESTED | No |
| Trip requests | Owned validated draft/search/update | Five request routes/forms | Legacy identities; edit loop; many-to-one shape; same-family/date rules | Failure UI + form-loop fixture | No |
| Companion profile | Own skills/availability profile | Three routes/form/calendar | Dashboard missing; legacy create identity; staged-save loss | Shell only | No |
| Availability | Reliable date/time travel coverage | Weekly slot editor | No timezone/conflict validation; matcher ignores overlap | Shell/source only | No |
| KYC | Private upload→review→eligible→expiry/rejection | Raw upload + verification SQL | Bucket/policies/contract/reviewer/sync absent; self-verify policies | No upload or real document tested | No |
| Matching | Eligible route/language/capability/schedule rank | Modular 5-component prototype scorer/explanation | UI forever loading; fields/RLS/actions stale; no hard filters/route/date | Pure scorer fixtures only | No |
| Selection/booking | Atomic one selection, C accepts, reserve trip | Booking SQL; attempted match acceptance | No booking writer/acceptance/transaction/exclusivity | NOT TESTED, missing | No |
| Payments/fees/payouts/refunds | Reconciled secure provider lifecycle | Payment refs/types/env names only | All operational payment integration missing | NOT TESTED | No |
| Cancellation | Guarded booking/request state and refund | Enum values and broad update policies | No cancellation UX/service/state transitions | NOT TESTED | No |
| Trip/check-ins/completion | Paid active trip with scheduled checkpoints | Trips SQL/time/check-in fields | No routes/jobs/guards | NOT TESTED | No |
| Location | Consent-bound fresh current/history data | Current BYTEA + historical coordinates SQL | No GPS/update/subscription/retention; history plaintext | NOT TESTED | No |
| SOS | Reliable trigger/delivery/ack/escalation/response/resolve | Incident schema + claims | Entire operational safety system missing | NOT TESTED | No |
| Chat | Private participant messaging/attachments/unread | Messages SQL | No sender insert/UI/service/realtime; wrong access graph | NOT TESTED | No |
| Notifications | In-app/email/SMS delivery with retries | Notifications SQL/provider env placeholders | No UI/system writer/provider/outbox | NOT TESTED | No |
| Ratings | Completed-trip eligible vote + aggregates | Ratings SQL | No INSERT/UI/aggregate authority | NOT TESTED | No |
| Admin/audit | Trusted review/override/audit/monitoring | Roles/log SQL | Console/bootstrap/recursive policies/writers absent | NOT TESTED | No |

## Completion scoring method

Percentages are **conservative audit estimates, not effort estimates or measured coverage**. Each area has four evidence gates: (1) coherent source artifact/model, (2) connected functional behavior, (3) meaningful integrated/negative verification, (4) deployable secure operational acceptance. Each earns25 points; where a narrower verified item counts, the row explains it. Missing or unverified gates earn zero, even if files exist. Architecture/frontend have separate structural/presentation criteria; see row basis. “Production readiness” is also subject to hard launch gates below.

| Area | Gates earned / 4 | Estimate | Basis / main gap |
|---|---|---|---|
| Architecture | 2 | 50% | Clear single stack/module graph and domain entity intent; identity/lifecycle consistency and operational boundaries fail |
| Backend | 1 | 25% | Matching action/module structure; authenticated working operations absent |
| Database | 1 | 25% | Entity/FK model exists; deployed consistency/security/lifecycle tests unverified |
| Authentication | 1 | 25% | Real Clerk entry widgets render; onboarding/token/role/server protection broken |
| Frontend | 2 | 50% | Route/form breadth plus public/form-shell rendering; connected journeys/accessibility/build incomplete |
| UX/UI | 1 | 25% | Public visual identity coherent; task usability, safety truthfulness and accessibility gates fail |
| Matching | 1 | 25% | Pure scoring source executes; correctness/integration/selection not usable |
| Payments | 0 | 0% | SQL references do not earn implementation credit |
| KYC | 1 | 25% | Upload shell/source exists; secure end-to-end verification missing |
| Chat | 0 | 0% | Schema-only |
| Notifications | 0 | 0% | Schema-only |
| Location | 0 | 0% | Schema-only |
| SOS | 0 | 0% | Schema-only; operational safety absent |
| Testing | 1 | 25% | Two reproducible read-only smoke successes; core/negative/operational tests absent |
| Security | 0 | 0% | RLS source is groundwork but critical trusted-field issue fails security gate |
| Deployment | 0 | 0% | Config artifacts only; build/workflow/targets not reliable |
| Production readiness | 0 | 0% | No accepted integrated release/security/operations gates |

**CURRENT CODEBASE COMPLETENESS ≈16%**: equal-weight17-area rubric, 275/1700=16.18%. This does not mean84% of lines are missing; it weights operational capability rather than visual size. Coarse source evidence warrants uncertainty; do not use as fixed delivery forecast.

**FUNCTIONAL MVP COMPLETENESS ≈10%**: two of20 feature families have runtime-verified narrow entry behavior (public rendering and auth entry UI), 18 lack an accepted useful connected flow. Not a complete authentication system or real family journey. **END-TO-END COMPLETENESS 0% verified**: neither family nor companion journey completes. **PRODUCTION READINESS 0% against launch gates**, not zero useful foundation.

Launch gates (0/10 accepted): reproducible clean deployment; trusted identity/roles; negative RLS/privileged-field protection; protected sensitive storage; core complete booking journey; reconciled payments; working operational safety/delivery; critical automated regressions; monitored rollback/backups/restore; truthful privacy/legal/support/incident operations. No gate was signed off by this audit.

## Critical family journey ledger

Statuses assess the step, not route-file existence. BROKEN (STATIC) means inspected contracts cannot fulfill it as written; actual authenticated mutations remain unperformed. No private-data or write-based “simulation” was done.

| Expected step | Status | Evidence / next missing boundary |
|---|---|---|
| Landing | WORKING (render) | Desktop/mobile observed; claim correctness separate blocker |
| Get Started | WORKING (link) | href /auth/sign-up; signup route renders |
| Sign Up | NOT VERIFIED | Widget only; no account created |
| Google/email authentication | NOT VERIFIED | Inputs/button present, no OAuth/password submitted |
| Role selection | BROKEN (STATIC) | Metadata read/write mismatch, no trusted provisioning; card renders |
| Correct dashboard/session | BROKEN (STATIC) | No server guard/token bridge; signed-out infinite loading reproduced |
| Create family | PARTIALLY WORKING (shell) | Correct Clerk field but no token; persistence NOT VERIFIED |
| Add traveler | BROKEN (STATIC) | Legacy Auth/family column + unsafe crypto contract |
| Edit traveler | BROKEN (STATIC) | Same blockers plus Promise params; secure round-trip untested |
| Create trip request | BROKEN | Runtime prerequisite error; legacy lookup and missing invariant |
| Matching | BROKEN | Perpetual spinner, unreachable CTA, stale action persistence |
| View eligible companions | PARTIALLY WORKING (prototype) | Public browse query/card exists; local DB unavailable; algorithm not eligibility-safe |
| Select companion | BROKEN (STATIC) | Missing family match UPDATE and non-atomic/denied status promotion |
| Booking | MISSING | SQL only, no writer/acceptance/reservation |
| Payment | MISSING | No provider/webhook/reconciliation |
| Trip activation | MISSING | No paid transition/route/writer |
| Tracking | MISSING | Location SQL only |
| Check-ins | MISSING | Field only, no schedule/UI |
| SOS | MISSING | No persisted incident/delivery/response workflow |
| Completion | MISSING | No authoritative finish/transition operation |
| Rating | MISSING | No eligible vote/aggregate writer |

## Critical companion journey ledger

| Expected step | Status | Evidence / next missing boundary |
|---|---|---|
| Landing | WORKING (render) | Companion marketing CTA present |
| Sign Up | NOT VERIFIED | Clerk widget; no account creation |
| Google/email/session | NOT VERIFIED | No completed authentication |
| Role selection | BROKEN (STATIC) | Inconsistent metadata source; redirected dashboard absent |
| Companion dashboard | MISSING / BROKEN | /dashboard/companions actual404 |
| Companion profile creation | PARTIALLY WORKING (shell) | Rendered form; Supabase getUser used for Clerk field; no write performed |
| Profile edit | BROKEN (STATIC) | Token/params plus staged-save mismatch; actual edit unverified |
| Availability | PARTIALLY WORKING (shell) | Weekly editor, no valid schedule/conflict lifecycle |
| KYC | PARTIALLY WORKING (shell) | No secure bucket/policy/record/approval round-trip; no document uploaded |
| Verification/rejection/expiry | MISSING | No reviewer service; owner self-verification risk instead |
| Eligible for matching | BROKEN (STATIC) | Pending candidates allowed, date/route/capability gate absent |
| Receive match | MISSING | No dashboard/inbox/notification |
| Accept booking | MISSING | Family attempt mutation is not companion consent; no booking workflow |
| Trip | MISSING | SQL only |
| Location/check-ins | MISSING | No client/API/background flow |
| Completion | MISSING | No guarded finish/settlement |
| Rating | MISSING | No eligible rating writer/aggregation |

A successful future milestone must walk these journeys with separate synthetic identities, cross-user denial checks and network/DB failure recovery, not simply inspect page snapshots. Account completion and live database behavior are explicit follow-up verification gates.
