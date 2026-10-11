# Native Supabase Auth migration

Date: 2026-10-07. Status: implemented and verified **locally**, not deployed.

## Outcome

TravelBuddy now uses native Supabase email/password authentication, persistent
SSR cookies, sign-out, protected routes and trusted family/companion/admin roles.
Clerk is no longer an application dependency, provider, proxy or authentication
UI. No social login or development authentication is part of normal app flow.
The landing-page design and existing entity/business contracts are retained.

The app remains pointed at its existing local Supabase stack. The separately
connected remote project was inspected read-only and was not changed. No commit,
push, deployment, database reset, table drop or historical identity rewrite occurred.

## Session and role architecture

- `src/lib/supabase.ts`: public cookie-backed `@supabase/ssr` browser singleton.
  It no longer contains a privileged server factory.
- `src/lib/supabase-auth-server.ts`: fresh per-request server client using async
  Next.js cookies. Ordinary owned operations run with the user's JWT and RLS.
- `src/lib/supabase-server.ts`: explicit server-only `createServiceRoleClient`.
  Session persistence/automatic refresh are disabled on this privileged client.
- `src/lib/auth/server.ts`: `getCurrentUser`, `getCurrentUserId` and
  `getCurrentUserRole` verify identity with the Auth server's `getUser()`.
  No server authorization trusts `getSession()` or user-editable metadata.
- `src/lib/auth/roles.ts`: current admin membership is read from protected
  `admin_roles`; family/companion membership from `app_user_roles`. Admin
  membership takes precedence. Missing membership is represented as `null`, not
  an invalid cast into the role union.
- `src/actions/set-role.ts`: idempotent, one-time family/companion choice for
  the verified user. Other role strings, switching roles, assigning other users
  and self-assigned admin are denied. Admin provisioning is a trusted operation,
  never an onboarding option.
- `src/proxy.ts`: verifies/refreshes identity, forwards renewed request and
  response cookies, applies private no-store cache headers, and redirects
  anonymous/no-role/wrong-role page requests. Actions/API handlers independently
  authorize their operations rather than relying only on page protection.
- `GET /api/auth/session`: verified identity/trusted role only, no token payload,
  with private no-store headers. Failures return a visible retryable error.
- `AppAuthProvider`/`useAppAuth`: maps this verified endpoint into the existing
  dashboard contract; cancels stale requests, times out failed checks, refreshes
  outside Supabase auth-event locks and rechecks restored browser pages.
- `/auth/confirm`: verifies email token hashes or a PKCE code. Fixed relative
  redirects preserve the public origin behind Next.js/proxies and do not trust
  caller-supplied redirect destinations. No social sign-in UI/provider was added.
- Native forms handle invalid input, password confirmation, provider errors,
  duplicate accounts, loading and email-confirmation-required messaging. They
  avoid competing post-login redirects. Dashboard and onboarding show sign-out.

Browser SDK cookies intentionally remain browser-readable so the Supabase client
can manage sessions. Their user object is not server authority: server identity
is verified, and role decisions use protected database membership every time.

## Identity and data preservation

The original 17 tables retain their UUID entity IDs, TEXT `*_clerk_id` identity
columns, related identity arrays, relationships and encrypted fields. New native
Auth user UUIDs are stored as strings in those existing columns; the historical
names do not mean that Clerk authentication remains. No cast/rename/backfill
attempted to convert old text owners into new Auth accounts.

Inspection found zero native Auth users before migration, no `user_%` or UUID
owner values in local families/companions, and existing synthetic text owners.
No account was automatically linked, and no native signup inherits old fixture
ownership or the historical development administrator's membership. Real
historical-account linking, if later needed, requires an explicit verified mapping.

Local retained counts after all checks: **17 families, 38 companions, 1 booking,
1 trip, 3 verifications, 0 Auth users**. The migration itself left the aggregate
row fingerprints of these five original tables identical. The integration suite
also compares all **18 application tables plus `auth.users`** before/after each
run and cleans only its newly created records, users and KYC objects. The final
run restored every fingerprint. A response-read test race left one newly created
signup temporarily; its exact identity/creation time were verified and it was
removed, and the harness now recovers exact current-run credentials on failure.

## Forward migrations and RLS

Historical migration files are unchanged. Applied locally through `supabase
migration up --local`:

1. `supabase/migrations/20261007155556_native_supabase_auth.sql`
   - Adds protected `app_user_roles` with a native Auth-user FK, family/companion
     CHECK, self-read/self-insert and no user UPDATE/DELETE permissions.
   - Replaces the inspected legacy policies/grants on the original 17 tables.
     All 18 public tables have RLS enabled, including previously disabled
     `match_attempts`. No table/data/history is dropped or recreated.
   - Replaces JWT `role=admin` assumptions and recursive admin-role policies with
     trusted membership. Narrow boolean/role helpers live in non-exposed
     `app_private`, check the calling native identity and have fixed search paths
     and revoked PUBLIC/anonymous execution. They accept no arbitrary user ID.
   - Ordinary owner CRUD uses role + ownership predicates. Column grants block
     companion verification/reputation/owner writes and notification payload
     forgery. Requests validate the family/traveler edge and mutable states.
   - Fixes participant joins for bookings, trips, consents, chat, SOS and ratings.
     Plaintext location reads require active, non-expired family consent.
   - Removes full-row public verified-companion access. The authenticated family
     catalogue is an explicit safe server projection without DOB/owner IDs.
   - Lifecycle/matching/payment/chat/safety/rating/verification mutations have
     no direct authenticated Data API write grants. They use authorized server
     workflows, not client-forged transitions or scores.
2. `supabase/migrations/20261007161023_native_auth_insert_visibility.sql`
   - The first real integration run exposed `INSERT … RETURNING` visibility:
     STABLE same-table owner lookup helpers cannot see the new row yet.
   - Family/companion SELECT policies now compare the new row's owner directly
     with native identity and trusted role. Cross-table helpers remain narrow.
     This is a second forward migration, not rewritten applied history.

`current_clerk_id()` is retained for SQL compatibility with a fixed search path.
The private KYC bucket remains non-public: owner metadata/relationship checks
precede privileged storage access, including an owned-companion path prefix check.

## Deliberate service-role boundaries

Ordinary family/traveler/companion/request CRUD, own notifications and owner KYC
metadata use the authenticated client. The following remain trusted server
workflows with native role and full ownership/participant checks before returns
or mutations:

- Matching eligibility/scoring persistence and request match transitions; safe
  verified companion catalogue/candidate projections.
- Booking/payment and trip lifecycle/check-in operations, including cross-party
  safe DTO projections and existing optimistic state checks/idempotency.
- Chat/read markers and encrypted notification delivery to the other participant.
- Consent, location and SOS state transitions and encrypted safety context.
- Completed-trip rating creation and reputation aggregation. Clients cannot
  write verification/rating/trip-count fields directly.
- Admin overview/review/audit, requiring both verified native admin role and
  protected `admin_roles` membership.
- Private KYC storage/upload/verification-state workflow after authenticated
  companion ownership checks.

Helpers taking a database client no longer have privileged default arguments.
Notification fan-out was moved from a client-invokable `use server` action module
to `src/lib/notification-workflow.ts` with `server-only` and participant checks.
RLS cannot protect service-role operations; the server checks and their negative
tests are an intentional, necessary second boundary.

## Actual verification

Local runtime: Node 26.8.1, Next.js 16.3.4, Supabase JS 2.115.0, SSR 0.12.7.
Both Supabase libraries are pinned; `package-lock.json` was regenerated.

| Check | Actual result |
| --- | --- |
| `npm run typecheck` | Passed for integrated TypeScript source/tests; new CJS helpers also passed `node --check` |
| `npm run build` | Production build passed; native routes/proxy compiled |
| `npm test` | Passed server AES-GCM codec round-trip/nonce/tampering/wrong-key/missing-key checks |
| `TRAVELBUDDY_TEST_START_SERVER=true npm run test:auth:local` | Passed **19 real Auth/RLS/business/browser check groups** |
| `npx playwright test tests/auth.spec.ts --project=chromium --reporter=line` | **3 passed** using production server lifecycle |
| `npm run test:bundle-safety` | **37 public JS bundles** contained no configured server-secret literals or Clerk SDK references |
| `supabase db advisors --local --type security --level warn` | **No issues found** after both migrations |
| Public-table inspection | **18/18 tables have RLS enabled** |
| YAML parsing | Updated GitHub Actions file parsed successfully with Ruby YAML |
| `git diff --check` | Passed for tracked changes; most application source is pre-existing untracked work |
| `npm run lint` | **Blocked before source analysis:** installed `typescript-eslint` does not support TypeScript 7.0 |
| Performance advisors | **16 multiple-permissive-SELECT-policy warnings** remain; no speed claim/benchmark was made |

The integration suite uses the real `getCurrentUser()` implementation and real
Supabase Auth/JWTs/RLS. Its in-process action checks adapt only request-cookie
access with AsyncLocalStorage; identity/roles are not mocked. It also exercises
the actual built HTTP KYC/confirmation/session endpoints and Chromium UI.

Covered: invalid/weak/duplicate signup, invalid credentials, role persistence,
metadata/admin forgery denial, ordinary CRUD and cross-family/cross-companion
denial, matching/booking/trips, chat/notification isolation, consented/revoked
location, SOS, completed-trip ratings/reputation, private KYC and trusted admin
review, email-token confirmation, proxy refresh cookies/cache headers, mobile
form validation, real UI signup/onboarding/profile creation, reload/navigation,
sign-out/back navigation, and reopening a separate Chromium process with
persistent cookies. Final browser page-error count: **zero**.

The test runs caught and fixed insert visibility, competing login navigation and
internal-origin confirmation redirects. A later response-body read race was in
the test harness, not authentication; it now reads the verified application
session after navigation and recovers only exact current-run credentials on
cleanup. Earlier failures are not being relabeled as passes.

## Remaining references and gaps

- No `@clerk/`, `CLERK_`, `clerk-provider` or development database factory remains
  in application runtime source. Root package/lockfile, example environment,
  GitHub workflow and Supabase config no longer configure Clerk.
- Existing `*_clerk_id` columns/DTO fields, `admin_roles.clerk_id`, identity arrays
  and `current_clerk_id()` intentionally retain compatibility names. Historical
  migrations/audits/milestone reports and separate MCP/skill templates still
  mention Clerk. That tooling was not uninstalled as an unrelated cleanup.
- Private `.env.local` was preserved. Any obsolete Clerk entries in it are inert
  and may be removed manually; no private values were copied to this report or
  example configuration. The built application does not require Clerk keys.
- Retired development fixture files remain unmounted; their endpoint returns
  404. Old milestone scripts that mock identities or use this retired endpoint
  were **not run** as native-auth evidence. Do not run their historical fixture
  mutation recipes against production or existing data.
- Local email confirmations remain disabled, as in the existing config. Real
  provider-generated email-token confirmation and invalid-token rejection were
  tested, but SMTP delivery and the signup UI's confirmation-required message
  with confirmations enabled were **not exercised end-to-end**. Stage that
  configuration before deployment. Signup UI requires 8 characters; the existing
  local Auth-server minimum remains 6. Sign-in does not incorrectly enforce the
  signup minimum against an already valid account.
- Only Chromium (desktop and mobile viewport) was exercised here. Other browser
  projects were not run.
- Existing development-only payment simulation is unchanged and disabled in
  production; the zero-dollar booking shell is **not production payment processing**.
- GitHub Actions now uses Node 22, a local masked Supabase environment and the
  repeatable native suite instead of remote/Clerk test secrets. YAML was checked,
  and the CI helper's syntax was checked, but its environment export and GitHub
  CI/deployment were not executed; the retained lint step still hits
  the existing TypeScript/ESLint incompatibility. No toolchain downgrade or check
  bypass was introduced.
- Performance warnings concern separate admin/owner SELECT policies. See
  [multiple permissive policies remediation](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).
  These are not the repaired RLS-disabled/unsafe-write security issues.
- Remote migrations, real administrator provisioning, production email settings,
  credential retirement and deployment remain operator steps. No native admin
  account or development-auth shortcut was left behind by testing.

## How to run and deploy safely

Keep the existing private `.env.local`; use `.env.example` as the variable schema,
not as a replacement for credentials. Public and privileged Supabase URLs/keys
must target the **same intended project**. Keep the existing encryption secret
stable so historical BYTEA envelopes remain readable.

Local setup/checks (Node >=22, Docker, the existing local stack):

```sh
npm ci
npx supabase start
npx supabase migration up --local
npm run typecheck
npm test
npm run build
npm run test:bundle-safety
npx playwright install chromium
TRAVELBUDDY_TEST_START_SERVER=true npm run test:auth:local
npx playwright test tests/auth.spec.ts --project=chromium --reporter=line
npm run dev
```

The checks here used the already-installed Chromium headless shell through
`PLAYWRIGHT_BROWSERS_PATH`; no browser install was needed during verification.
The native suite defaults to `http://127.0.0.1:3113`, refuses non-loopback
Supabase/app targets, starts/stops only its own app-server child when requested,
creates isolated native users and leaves no native admin fixture behind. Do not
run it alongside unrelated data mutations, since fingerprints intentionally
detect changes to pre-existing records.

Use `http://127.0.0.1:3000/auth/sign-up` for the configured local web origin.
Sign up, select family/companion, and create the appropriate profile. Old synthetic
profiles are preserved but are not automatically assigned to the new account.

Before any remote deployment:

1. Inspect that target project's actual schema/data/migration history; apply the
   two new migrations forward only after review/authorization. Do not reset it
   or replay `supabase/migrations_archive`.
2. Configure its native email/password Auth, password policy, production site URL,
   exact allowed callback origins and SMTP/email-confirmation behavior. Do not
   enable social providers for this email/password-only interface.
3. For confirmation links that work across browsers, the Supabase signup email
   template can link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`.
   The existing default PKCE-code callback is also supported, but requires the
   browser that retains its signup code verifier. The token-hash path was tested.
4. Provision an administrator only through an authorized privileged operation
   using the verified native user's ID in `admin_roles.clerk_id`; never repurpose
   the old development admin record or expose self-assignment in the UI.
5. Resolve the documented lint/CI toolchain incompatibility, exercise the
   confirmation-required signup/SMTP flow and review the existing deployment
   configuration before enabling CI deployments. The pre-existing preview job
   still uses `--prod --force`; that unrelated deploy behavior was not changed
   or executed by this migration.

Supabase RLS reference: https://supabase.com/docs/guides/database/postgres/row-level-security
SSR reference: https://supabase.com/docs/guides/auth/server-side/creating-a-client
TypeScript/lint incompatibility reference: https://github.com/typescript-eslint/typescript-eslint/issues/10940

## Exact implementation file inventory

The list below describes intentional edits/additions in this migration, not all
pre-existing untracked project files or generated build/browser artifacts.

### Added

```text
src/lib/supabase-config.ts
src/lib/supabase-auth-server.ts
src/lib/auth/roles.ts
src/lib/auth/provider.tsx
src/lib/notification-workflow.ts
src/app/api/auth/session/route.ts
src/app/auth/confirm/route.ts
src/app/dashboard/layout.tsx
src/components/auth/EmailPasswordForm.tsx
src/components/auth/SignOutButton.tsx
supabase/migrations/20261007155556_native_supabase_auth.sql
supabase/migrations/20261007161023_native_auth_insert_visibility.sql
tests/native-auth-local.cjs
tests/auth-bundle-safety.cjs
tests/ci-local-env.cjs
docs/SUPABASE_AUTH_MIGRATION_REPORT.md
```

### Updated

```text
.gitignore
.env.example
package.json
package-lock.json
playwright.config.ts
.github/workflows/ci-cd.yml
supabase/config.toml
src/lib/supabase.ts
src/lib/supabase-server.ts
src/lib/auth/server.ts
src/lib/auth/types.ts
src/lib/auth/development-provider.tsx
src/proxy.ts
src/app/layout.tsx
src/app/page.tsx
src/app/select-role/page.tsx
src/app/auth/sign-in/[[...rest]]/page.tsx
src/app/auth/sign-up/[[...rest]]/page.tsx
src/app/api/dev-auth/session/route.ts
src/actions/set-role.ts
src/actions/family.ts
src/actions/travelers.ts
src/actions/trip-requests.ts
src/actions/companions.ts
src/actions/match-companions.ts
src/actions/bookings.ts
src/actions/trips.ts
src/actions/messages.ts
src/actions/notifications.ts
src/actions/safety.ts
src/actions/ratings.ts
src/actions/admin.ts
src/actions/companion-verifications.ts
src/lib/matching/basic-matching-algorithm.ts
src/lib/verification/access.ts
src/lib/verification/server-workflow.ts
src/lib/verification/storage.ts
src/app/api/companion/kyc/route.ts
src/app/api/companion/kyc/[id]/route.ts
src/app/dashboard/admin/page.tsx
src/app/dashboard/bookings/[id]/page.tsx
src/app/dashboard/companions/page.tsx
src/app/dashboard/companions/create/page.tsx
src/app/dashboard/companions/[id]/page.tsx
src/app/dashboard/companions/[id]/edit/page.tsx
src/app/dashboard/family/page.tsx
src/app/dashboard/family/create/page.tsx
src/app/dashboard/family/edit/page.tsx
src/app/dashboard/family/companions/page.tsx
src/app/dashboard/family/travelers/page.tsx
src/app/dashboard/family/travelers/new/page.tsx
src/app/dashboard/family/travelers/[id]/page.tsx
src/app/dashboard/family/travelers/[id]/edit/page.tsx
src/app/dashboard/family/trip-requests/page.tsx
src/app/dashboard/family/trip-requests/new/page.tsx
src/app/dashboard/family/trip-requests/[id]/page.tsx
src/app/dashboard/family/trip-requests/[id]/edit/page.tsx
src/app/dashboard/family/trip-requests/[id]/matches/page.tsx
tests/auth.spec.ts
docs/auth-development.md
```

### Removed

```text
src/lib/auth/clerk-provider.tsx
```

Not modified: private `.env.local`, historical migrations/audits/milestone reports,
encryption codec/keys, separate Clerk MCP/skill configuration or pre-existing
business entity data. No generated/private browser-session artifacts are included
in this inventory.
