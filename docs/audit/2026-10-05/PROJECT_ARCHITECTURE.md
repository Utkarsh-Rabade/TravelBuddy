# TravelBuddy — architecture and repository inventory

5 October 2026. FACT/STATIC unless labelled RUNTIME. See master for baseline and verification limits.

## Technology and dependency inventory

One deployable Next.js App Router application, `travelbuddy@1.0.0`. The package description is generic; `main: index.js` does not correspond to an application entrypoint. There is no `index.js`, workspace configuration, Turbo configuration, Next config, formatting config, Dockerfile, Expo app or runtime shared package.

Declared, lockfile and installed direct versions agree:

| Dependency | Declared | Locked/installed | Actual use / maintenance assessment |
|---|---|---|---|
| @clerk/nextjs | ^7.9.1 | 7.9.1 | Provider, widgets and useUser; keep; server auth wiring missing |
| @supabase/supabase-js | ^2.115.0 | 2.115.0 | DB/storage/RPC/legacy auth; keep; requires Node >=22 |
| next | ^16.3.4 | 16.3.4 | App Router/fonts/image/actions; keep and assess patched 16.3.6 advisory |
| react / react-dom | ^19.2.8 | 19.2.8 each | UI/hooks; keep; render-time state violations exist |
| @playwright/test | ^1.63.0 | 1.63.0 | Three smoke cases; browsers initially absent |
| @tailwindcss/postcss | ^4.3.3 | 4.3.3 | Active PostCSS plugin |
| tailwindcss | ^4.3.3 | 4.3.3 | CSS import active; legacy JS config is not explicitly loaded |
| postcss | ^8.5.28 | 8.5.28 | Build pipeline |
| autoprefixer | ^10.5.5 | 10.5.5 | Configured; review redundancy with Tailwind 4, not automatically remove |
| typescript | ^7.0.2 | 7.0.2 | CLI/native toolchain; old transpileModule API not available in audit fixture |
| @types/node | ^26.4.1 | 26.4.1 | Matches local major; CI Node 20 inconsistent |
| @types/react / react-dom | ^19.2.18 / ^19.2.7 | 19.2.18 / 19.2.7 | Appropriate installed React major |
| eslint | ^10.10.0 | 10.10.0 | Present but no usable flat config |
| eslint-config-next | ^16.3.4 | 16.3.4 | Referenced by legacy eslintrc; audit flags transitive dev dependency chain |
| supabase | ^2.116.0 | 2.116.0 | Local CLI/config/migrations; no package script uses it |

No Stripe, NextAuth, validation library, global state library, query cache, map SDK, SMS/email SDK, Sentry or animation runtime package is imported/installed as a direct dependency. Stripe/NextAuth/provider env names are placeholders for planned functionality, not proof of integration. No redundant auth package is installed, but two incompatible auth assumptions coexist in application logic.

`npm ls --depth=0` completed without direct dependency mismatch. Installed Clerk peer ranges accept Next16.3.4/React19.2.8; eslint-config-next's eslint>=9/TypeScript>=3.3.1 ranges accept installed versions. The concrete mismatches are **configuration/API conventions and CI engine choice**, not a demonstrated peer-version conflict. CLI executable confirms2.116.0 and advertises2.119.0; no update was installed. No direct library was proven obsolete/unnecessary enough to remove during this audit.

Security audit reported seven dependency nodes, not seven independently exploitable application vulnerabilities. `next/og` RCE advisory requires attacker-controlled SVG through Node ImageResponse; this application has no such import/route. Upgrade after approval rather than indiscriminately applying npm's suggested major downgrade for development tooling.

## Actual filesystem and dependency directions

```text
TravelBuddy/
├── src/
│   ├── app/                 20 pages; root layout; no API handlers/proxy
│   ├── actions/             matching actions only
│   ├── components/
│   │   ├── forms/           family, traveler, trip, companion, KYC upload
│   │   └── ui/              availability, matches, unused explanation/duplicate
│   ├── lib/                 Supabase client and encryption
│   │   └── matching/        candidate query, scoring, explanation
│   └── styles/              global Tailwind + landing styles
├── supabase/
│   ├── migrations/          canonical Clerk schema/RLS
│   ├── migrations_archive/  old UUID/Supabase Auth design
│   ├── .temp/               private/generated local CLI state
│   └── .branches/           generated branch marker
├── tests/                   one Playwright smoke-test file
├── public/assets/           Earth image
├── docs/                    landing redesign handoff; this audit is additive
├── .github/workflows/       draft CI/CD
├── .agents/skills/          24 instruction packs, references/templates (not app packages)
├── .claude/                 private local permissions/server selections
├── .mcp.json                three remote MCP descriptors, not active tool proof
├── .next/                   generated build/dev outputs
├── node_modules/            installed dependencies
└── root configuration       package/lock, TS, CSS, lint, deployment, env, instructions
```

| Directory / files | Contents / why | Depends on / depended on by | Disposition recommendation |
|---|---|---|---|
| src/app | Public/auth/dashboard/role UI | React/Clerk/forms/Supabase; browser router reaches pages | Keep routes; repair contracts, onboarding and shared shell incrementally |
| src/actions | Three exported matching server functions | matching libs + anonymous singleton; matches page imports all three | Keep intent, replace legacy identity and consolidate canonical operations |
| src/components/forms | Controlled local fields, upload calls | React; pages consume; traveler form imports encryption | Keep forms; add typed validation and safe server persistence |
| src/components/ui | Availability/calendar/match cards | React; companion and matches pages consume | Keep canonical files; unused explanation and nested duplicate require later consolidation |
| src/lib | Singleton anonymous client, unused privileged helper, encryption RPC wrappers | Supabase; most client pages and actions consume | Separate browser/request-scoped/server-only concerns, not a whole-app rewrite |
| src/lib/matching | Candidate scoring + persistence | Supabase and pure calculators; actions consume | Preserve module boundary; repair hard eligibility and schema contract |
| src/styles | Tailwind CSS plus tb-* landing styles | PostCSS; root layout loads globally | Keep visual identity; scope dark base to avoid light-form text conflicts |
| supabase/migrations | 17-table desired schema, 92 policies | Supabase/Postgres; application expects subset | Preserve files/history; future forward fixes only after live drift comparison |
| migrations_archive | Four old schema/policy/index/trigger files | Old Auth UUID design; not active CLI migration directory | Keep evidence; never replay or combine with canonical migrations blindly |
| tests | 3 shallow smoke tests | Playwright config; intended CI | Keep but fix selector and greatly expand meaningful coverage |
| public/assets | 908 KiB filesystem Earth asset | next/image on landing | Keep local asset and optimization; inspect license/provenance before launch |
| docs | One 459-line landing instruction handoff | Design intentions only | Preserve; correct assumptions in new audit rather than overwrite |
| .github | Workflow draft | npm/Playwright/Vercel secrets | Fix gates and environment separation before activation |
| .agents | Local instructions, code examples and language/framework templates | Agent tooling only | Not product monorepo; do not treat template packages as deployed apps |
| .claude | Local permission allowlist + MCP selections | Claude-local tooling | Private configuration, not architecture; keep out of indiscriminate commits |
| .next / tsbuildinfo | Generated runtime/type/compiler cache | Next/TS | Do not trust as clean-build proof; eventual ignore hygiene, no deletion during audit |
| node_modules | Vendor implementation/docs | npm lock | Do not audit every vendor source as product code or commit vendor files |

No business-module application directory is unused wholesale. Most incompleteness is at integration boundaries rather than abandoned large subsystems.

## Configuration and Git findings

- TypeScript is strict, noEmit, bundler resolution and `@/* → src/*`; includes all TS/TSX including tool templates. Existing generated types differ from clean-build checks.
- Tailwind 4 CSS import/PostCSS is active; JS content arrays include nonexistent root app/components. No custom theme/plugins configured.
- `.gitignore:3–5` ignores all package lockfiles; `.env.*` also hides `.env.example`; `.next` and tsbuildinfo are not ignored. Supabase's nested ignore *does* hide `.temp`/`.branches`.
- Git cannot substantiate auth migrations, UI rewrites, regressions, deleted migrations, AI authorship or reverts. All implementation files are untracked; filesystem dates are not reliable historical provenance.
- Workflow watches `main`; supplied branch is `master`. No remote, CI execution history or deployment linkage can be verified.
- Docker compose is a draft single Supabase-image layout with default-style credentials, misspelled secret names and port comments inconsistent with CLI defaults; database image is Postgres 15 while CLI config declares 17. Do not use as production deployment.
- Local configuration is not remote configuration. Supabase Clerk third-party integration is disabled locally. `schema_paths` points at migrations; seed references nonexistent `seed.sql`. Review workflow mode before future schema generation.

## Complete route architecture

Every route below corresponds to `src/app/<route>/page.tsx`; auth uses optional catch-all `[[...rest]]`. There are no route groups, parallel/intercepted routes, application API route handlers, dashboard layouts, loading/error/not-found files, middleware or proxy. The root Server Component layout provides Clerk, global CSS, Inter font and fixed metadata. Auth wrappers are Server Components around Clerk UI; **all other 18 pages are Client Components**.

Auth requirement in the table is intended business access, **not enforced route protection**. F = family owner; C = companion owner; O = owner/assigned participant. Data-level access depends on RLS, which currently receives no Clerk token.

| Route | Purpose / intended user | Data, components and operations | Current status / failure and reachability |
|---|---|---|---|
| `/` | Public landing; signed-in role routing | useUser, fonts, next/image, local illustrative cards; no DB | RUNTIME renders. Render-time redirect precedes later hooks; signed-in hook order risk. CTAs reach auth routes |
| `/auth/sign-in/[[...rest]]` | Public Clerk sign-in/callback | SignIn widget; Clerk service | RUNTIME form + Google button render; login/OAuth completion NOT VERIFIED; no explicit local post-auth destination |
| `/auth/sign-up/[[...rest]]` | Public Clerk registration/callback | SignUp widget; Clerk service | RUNTIME renders; account creation NOT VERIFIED; role/profile provisioning absent |
| `/select-role` | Authenticated onboarding | useUser, unsafeMetadata write, publicMetadata read; no DB | RUNTIME visible signed-out; role buttons silently no-op without user. Companion destination absent |
| `/dashboard/family` | F overview | families + elderly_travelers; Clerk ID filter; inline cards | RUNTIME signed-out remains loading; no server guard. Links incorrectly target trips and traveler-new for trip creation |
| `/dashboard/family/create` | F create profile | FamilyForm; families INSERT with Clerk ID | RUNTIME form renders; submission NOT TESTED; client lacks token; unique owner allows one family |
| `/dashboard/family/edit` | F edit profile | FamilyForm; Supabase Auth + old family_member_id; UPDATE name | RUNTIME error signed-out; static legacy identity/schema blocker; linked by dashboard |
| `/dashboard/family/travelers` | F list travelers | families lookup uses Clerk ID against old column; elderly_travelers SELECT * | RUNTIME signed-out stuck loading; signed-in schema blocker; dashboard link exists |
| `/dashboard/family/travelers/new` | F add traveler | TravelerForm/encryption; Supabase Auth, old family lookup, INSERT | RUNTIME shell renders; persistence blocked by auth + encryption; submission NOT TESTED |
| `/dashboard/family/travelers/[id]` | F traveler details | old family lookup; elderly_travelers SELECT; decrypt sensitive fields | Static auth/schema/encryption + Promise params blockers; list links here; no traveler self-service route |
| `/dashboard/family/travelers/[id]/edit` | F edit traveler | TravelerForm, owner lookup, decrypt, UPDATE by id | Same blockers; SQL policies, not submit handler, must enforce ownership; detail link exists |
| `/dashboard/family/trip-requests` | F request list | legacy family lookup; requests inner-join travelers; badge helpers | RUNTIME error signed-out. Many-to-one embed wrongly treated as array; weak navigation from dashboard |
| `/dashboard/family/trip-requests/new` | F create request | TripRequestForm; two legacy family lookups, travelers SELECT, request INSERT draft | RUNTIME unauthenticated traveler-data error; no date/order/airport validation beyond HTML/SQL length |
| `/dashboard/family/trip-requests/[id]` | F/O request detail | trip_requests + traveler + family, decryption; inline display | No explicit auth/owner check; relies RLS. Promise params, encryption blockers; draft Edit link omitted by boolean precedence; no matching CTA |
| `/dashboard/family/trip-requests/[id]/edit` | F edit draft/searching | Clerk hook + old family filter; TripRequestForm; request UPDATE | Promise params + old columns; React fixture proves render loop when initialData supplied; no loaded-traveler failure recovery |
| `/dashboard/family/trip-requests/[id]/matches` | F rank/select matches | Three server actions + family/trip lookup; MatchResultCard; request status update | RUNTIME perpetual loading; never setIsLoading(false). Stale match fields/legacy Auth; no incoming navigation link found |
| `/dashboard/family/companions` | F browse verified companions | companions SELECT names/DOB/languages/rating; no auth check | RUNTIME local DB connection refused; browse card has no selection/profile navigation; “available” not actually filtered |
| `/dashboard/companions/create` | C onboarding | CompanionForm, AvailabilityCalendar, KYCDocumentUpload; legacy Auth → profile + verification INSERT | RUNTIME shell renders; final save can bypass staged form validation; KYC contract/policies fail; no dashboard entry to reach it |
| `/dashboard/companions/[id]` | C own profile | Clerk ID equality after SELECT companions/verifications | Static token/Promise params; verification.status absent; literal status class interpolation; backs link to absent dashboard |
| `/dashboard/companions/[id]/edit` | C own edit | CompanionForm, calendar, KYC; profile UPDATE then verification INSERT | Static token/params/KYC failures; staged child save differs from final save; no transaction/rollback |

Missing route targets: `/dashboard/companions`, `/dashboard/family/trips`, `/dashboard/family/trips/new`. Missing feature routes: bookings/payment/trips/tracking/chat/notifications/SOS/admin/ratings/traveler dashboard/legal/contact. No route collision was found among existing files. Existence of a route does not establish protected access or functional mutations.

## Frontend and duplication assessment

- React local component state only; no custom hooks, reusable query/cache layer or global store. Most data fetching runs after hydration in useEffect. Failure/loading/empty branches and headers are copied between pages.
- `src/app/page.tsx` is 1,131 lines of marketing JSX/inline styles, font definitions, local interactions and identity routing. Keep the design; eventually split presentation from auth routing and static sections.
- `TripRequestForm.tsx:29–42` sets a newly created state object every render with initialData: reproducible infinite loop. It also always says “Create” when editing.
- `AvailabilityCalendar.tsx:44–77` shallow-copies only the outer object then mutates nested arrays/objects. No time ordering, overlap, timezone, overnight or booking conflict validation. Parent receives changes only after a separate Save Availability click.
- Companion child form save changes parent state; final save reads parent state, not necessarily current edited child inputs. Users can click final button before child save and persist stale/empty names; server-side validation is absent.
- `src/components/ui/MatchResultCard.tsx` is the imported canonical card. `src/components/ui/Matchcomponents/ui/MatchResultCard.tsx` is a near-identical unused nested duplicate, differing only in markup formatting. Both carry literal `${...}` status strings. Keeping both risks divergent fixes; consolidate only after caller check.
- `MatchExplanation.tsx` has no importer. Explanation presentation is separately duplicated inside the canonical card. Later prefer one accessible details component.
- `getMatchAttemptsByTripRequest` and `updateMatchStatus` in `basic-matching-algorithm.ts` are not called by application code; actions repeat equivalent DB behavior and authorization assumptions. Make one operation canonical behind authenticated server functions.
- Status formatting/color helpers are repeated in request list/detail/edit. Age calculations repeat year subtraction and ignore birthdays. Family lookup/auth boilerplate repeats across pages; partial Clerk conversions have already diverged.
- Unused imports include form-local Supabase clients, decrypt helpers, Image/Link in both match cards, routers and TravelerForm in detail. They are small cleanup, not primary blockers or evidence to change stack.

## Documentation discrepancies

`docs/TravelBuddy_UI_Handoff_for_Antigravity.md:7,31–35,51` presents existing flows/auth/matching/sensitive-data protection and successful remote canonical migration as established. Actual code lacks a Clerk token bridge, contains legacy queries, blocks matches and has incomplete encryption/policy enforcement. Remote migration success is **unverified**, not disproved by this local audit. Its route/SOS/location/payment concepts are largely SQL placeholders. The older landing-layout complaints at lines 64–77 no longer describe the rendered current landing page. The handoff's limited landing-only instruction is historical task context, not this audit's scope.
