# TravelBuddy — testing and runtime evidence

5 October 2026. No persisted account/profile/trip/upload/payment data was created. Browser tests used a new signed-out Chromium context and an isolated copy at `http://localhost:3100`. This is local development evidence, not a staging/production sign-off.

## Existing test inventory

Only `tests/auth.spec.ts` with three cases:
1. Navigate to sign-in; assert URL.
2. Navigate to sign-up; assert URL.
3. Home title and visible TravelBuddy text.

None submits credentials, invokes Google OAuth, asserts rendered auth controls in its original cases, checks post-login role, validates RLS or exercises a mutation. `playwright.config.ts` expands these into seven desktop/mobile/browser projects (21 listed entries, **three logical cases**, not 21 business flows). No webServer lifecycle/environment loading/browser-install CI step. Base URL hardcoded 3000. Reporter is HTML with retry traces; use synthetic accounts/no secrets in future traces.

No unit/integration/component/API/webhook/SQL/RLS tests, test coverage tool or npm test script. No immutable financial or safety assertions. Broad TS `any` clients hide many schema defects from compile checking.

## Checks executed and exact outcomes

| Command / method | Location / result | What it proves / does not prove |
|---|---|---|
| `git status`, branch, log, ls-files/config names | Original repo; source untracked, one commit, no remote | Baseline only; history cannot prove rewrites/reverts |
| `./node_modules/.bin/tsc --noEmit --incremental false` | Original, exit 0 | Existing type set accepted; **not clean route/build correctness** |
| `npm run lint` | Original, exit 1 | `next lint` removed; supplied command is broken |
| `./node_modules/.bin/eslint src` | Original, exit 2 | No eslint.config.*; code was not successfully linted |
| `npm run build` | Temporary copy, exit 1 | Turbopack rejected node_modules symlink outside copy root; audit harness limitation, not app failure |
| `npm run build -- --webpack` | Temporary copy, exit 1 after compilation | Seven `[id]` page signatures fail generated Promise params types; real production compatibility blocker |
| Playwright existing test run with temporary config | Chromium only, baseURL3100; **2 passed, 1 failed** | URL smoke passes; homepage getByText resolves five elements; full auth remains untested |
| First Playwright attempt | Browser executable missing; no tests exercised | Infrastructure blocked then addressed with isolated browser download; don't count as code failures |
| Pure scorer import using Node TS support | Synthetic objects, no DB | Demonstrates bad matching scores and no date sensitivity |
| TripRequestForm isolated React render using installed Next SWC | Synthetic initialData; **Too many re-renders**; create mode renders | Confirms edit-state root cause without CRUD or database |
| npm audit JSON | Read-only registry advisory check | Seven affected nodes; applicability requires reachability review |
| HTTP GET route probes | Local copy, 9×200 + companion-root404 | Server renders shells; timings include dev first compilation and are not performance SLAs |
| Read-only project Chromium probe | 15 distinct routes/screens; no form submits, auth or uploads | DOM/screenshots/console/network observations below |

Next build all seven failures: companions `[id]` and edit; traveler `[id]` and edit; request `[id]`, edit and matches. Current params prop typed `{id:string}` instead of Promise; browser also reports React.use requirement.

Audit-only initial TS transpilation fixture attempts hit TypeScript 7 removed API and Next SWC binding initialization; final initialized SWC fixture reproduced the React failure. These diagnostic setup failures are not application findings.

`npm ls --depth=0` passed the direct dependency tree; installed peer ranges were checked. Supabase CLI executable version2.116.0 was verified; its incidental generated update-cache refresh was restored byte-for-byte. Final preservation comparison passed for268 pre-existing files. The stopped development server also forwarded the browser-side missing ENCRYPTION_KEY warning and params error, corroborating the static encryption boundary and browser route evidence without submitting sensitive payloads.

## Actual browser verification ledger

URL prefix: `http://localhost:3100`. Every action below is direct navigation/read-only observation, four-second post-DOM observation window. Clicked only the public mobile-menu toggle (nonpersistent UI). Console/network errors were summarized with tokens/URLs redacted. No authenticated session or private rows were viewed.

| URL path / action | Result | Console/network/server evidence |
|---|---|---|
| `/` read at1440×1000 | WORKING rendering: Earth, two columns, nav, sections, CTAs | HTTP200; no console errors/network failures in probe; scrollWidth1440 |
| `/` read at390×844 | WORKING stacked layout | scrollWidth390; clipping cannot be disproved only by width because overflow-x hidden |
| `/` mobile menu open then resize768 | Menu Sign in visible; open dropdown remains after desktop nav appears | No aria-expanded on button; duplicate responsive menu after resize seen in screenshot; no measured nav-anchor overflow |
| `/auth/sign-in` | WORKING entry UI; identifier/password and Continue with Google present | HTTP200; no probe errors; Clerk displays Development mode |
| `/auth/sign-up` | WORKING entry UI; email/password and Google button present | HTTP200; no probe errors; no signup performed |
| Google entry point inspection | Button present in both widgets | **OAuth NOT TESTED — would require external interactive auth/test account and non-read-only session creation** |
| `/select-role` | PARTIAL: selection card visible even signed-out | HTTP200; no console errors; role selection not clicked/persisted |
| `/dashboard/family` | BROKEN signed-out handling: remains Loading... | HTTP200; no errors; static early return never clears loading |
| `/dashboard/companions` | BROKEN / MISSING dashboard | HTTP404 + resource error |
| `/dashboard/family/create` | Form shell WORKING; mutation NOT TESTED | HTTP200; no auth route redirect; screenshot captured |
| `/dashboard/family/travelers/new` | Form shell WORKING; mutation NOT TESTED | HTTP200; no probe error before submit; no traveler created |
| `/dashboard/family/trip-requests/new` | BROKEN prerequisites: Failed to load traveler data, empty select | HTTP200; 2 dev console unauthenticated errors (development effect behavior); no POST |
| `/dashboard/family/trip-requests/00000000-0000-0000-0000-000000000000/matches` | BROKEN: Loading trip request... remains | HTTP200; params Promise errors + unauthenticated loaders; no matching-generation action called |
| `/dashboard/family/companions` | BLOCKED local DB: Loading companions... in window | HTTP200; 6 requests ERR_CONNECTION_REFUSED (SDK retry behavior); no private data read |
| `/dashboard/companions/create` | Form/weekly calendar/upload shells WORKING | HTTP200; no probe errors; no file or final save submitted |
| `/dashboard/family/edit` | Signed-out error state | HTTP200; Failed to load family details, 2 unauthenticated console errors |
| `/dashboard/family/travelers` | BROKEN signed-out handling: Loading travelers... | HTTP200; static early return never clears loading |
| `/dashboard/family/trip-requests` | Signed-out error state | HTTP200; Failed to load trip requests, 2 unauthenticated console errors |

The built-in browser tool separately timed out without creating a tab; inspected tabs were empty. No success was inferred from that dispatch. Project Playwright QA used an isolated installed-browser version, not a user Chrome profile or CDP connection. Only Chromium was run; Firefox/WebKit/real mobile devices were not tested.

## Critical-flow coverage and required tests

| Flow | Existing meaningful coverage / audit observation | Minimum next tests |
|---|---|---|
| Signup | URL + widget only, no account | Email verify and Google test instance onboarding, invalid/duplicate inputs |
| Login | URL/widget only | Session refresh/reload/sign-out/account switch and dashboard resolution |
| Google auth | Button presence only | Callback/error/cancel/return destinations |
| Role selection | Unauthenticated shell only | Correct metadata source, persisted choice, repeated selection, malicious admin role input |
| Family creation | Form only | Session-derived owner, unique/idempotent handling, other-user denial |
| Traveler creation | Form only | Encrypted data round-trip, failure blocks save, cross-family/linked-user rules |
| Trip creation | Prerequisite failure observed | Dates/IATA/assistance/owned traveler constraints |
| Matching | Pure scorer fixture + blocked page | Hard eligibility, dates/conflicts, ties, limits, run repeat/dedupe, truthful explanation |
| Companion selection | Not tested/broken static | Atomic single selection and authorized transitions/concurrency |
| Booking | Missing | Verified companion/ownership/one reservation/acceptance gates |
| Payment | Missing | Signatures, duplicate/out-of-order events, provider success/DB failure repair |
| Cancellation | Missing | Pre/post-payment authorized transitions and refund idempotency |
| KYC | Shell only | Private object ACL, fake MIME/oversize/malware, orphan cleanup, review/rejection/expiry |
| Messaging | Missing | Sender/trip membership, recipient read, attachment ACL, quotas/unread/edit windows |
| Location | Missing | Active consent, other-user deny, freshness/order/accuracy/offline/revocation/retention |
| SOS | Missing | Persist→deliver→ack→escalate→resolve; outages/retries/deduped audit and response drill |
| Rating | Missing | Completed participant only, one vote, aggregate updater and window |
| Authorization | No boundary tests | Signed-out and wrong-role server actions; arbitrary UUID tampering |
| RLS | No live tests | 17-table CRUD role matrix, field/relationship changes, recursive/multi-booking fixtures |
| Admin permissions | Missing | Non-admin deny, tier scope, immutable logs and safe bootstrap |

NOT TESTED — BLOCKED BY no signed-in synthetic accounts/approved mutation test scope, no running isolated DB, no live integration tools, missing operational feature implementations. Current smoke checks must not be interpreted as any of the above passing.

## QA definition of done for next milestone

Reproducible clean build/lint/test scripts, deterministic local/staging configuration, native Clerk-token/RLS integration, safe synthetic fixtures, onboarding/family CRUD happy path, negative cross-user policies and fail-closed encrypted fields. No real sensitive data; no service-role workaround; CI must run tests with isolated DB and server lifecycle. Later use broader browser/device/a11y tests after secure vertical slice exists.
