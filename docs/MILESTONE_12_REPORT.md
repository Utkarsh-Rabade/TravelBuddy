# Milestone 12 — Admin and Platform Operations

**Result: PASSED locally.** This is the final major functional milestone before Clerk integration, final authentication/RLS hardening, production deployment and the planned full UI/UX redesign.

## Schema and authorization audit

The existing schema already supported the required minimum admin operations:

- `admin_roles(clerk_id, role)` with `super_admin`, `moderator` and `support`;
- `verifications` with document metadata, background-check state, verification/expiry timestamps and protected storage path;
- `companions.verification_status` with `pending`, `verified`, `expired`, `rejected`;
- `audit_logs` with `VERIFICATION` action support;
- existing families, companions, travelers, trip requests, bookings, trips, ratings, SOS events and notifications.

No migration was required. No migration history, unrelated behavior or remote Supabase database was modified.

For local development only, `dev-admin-user` was seeded in the local `admin_roles` table as `super_admin`. The database row—not a client flag, URL role, request body or hidden UI control—is authoritative.

## Implementation

### Development auth boundary

- `src/lib/auth/types.ts`
  - adds the development-only `admin` application role to the existing auth boundary.
- `src/lib/auth/development-users.ts`
  - adds deterministic `dev-admin-user`.
- `src/app/api/dev-auth/session/route.ts`
  - allows the existing development session route to issue the admin test identity.
- `src/components/auth/DevelopmentAuthControls.tsx`
  - adds a development-only admin sign-in control.

Clerk was not changed.

### Admin contracts and server actions

- `src/lib/admin-types.ts`
  - safe bounded overview, entity, verification, booking, trip, SOS and rating contracts.
- `src/actions/admin.ts`
  - `getAdminOverview({limit, offset})`;
  - `getAdminVerification(verificationId)`;
  - `reviewAdminVerification(verificationId, decision, expiresAt?)`;
  - compatibility alias `reviewAdminCompanionVerification`.

Admin authorization requires both:

1. an authenticated current development user; and
2. an allowed `admin_roles` row for that exact authenticated ID.

The bounded overview uses count queries and paginated filtered reads rather than loading entire tables. It includes:

- KPI counts for families, companions, elderly travelers, trip requests, bookings, trips, ratings, notifications, SOS events and pending verifications;
- bounded safe family and companion summaries;
- pending verification metadata;
- booking and trip lifecycle summaries;
- SOS status/timestamp summaries without precise locations;
- rating/review summaries.

Sensitive data excluded from the admin DTOs includes document storage paths, encrypted medical fields, emergency contacts, encrypted trip locations, precise SOS locations, notification payloads and private owner identity fields not needed for operations.

### Verification workflow

`reviewAdminVerification` wraps the existing trusted `reviewCompanionVerification` workflow and does not duplicate its transition logic:

- `pending + pending background check → approve → verified + passed`;
- `pending + pending background check → reject → rejected + failed`;
- `verified + passed background check → expire → expired + passed`.

Invalid transitions are rejected. Ordinary companions cannot call the admin action or modify their own verification status. Successful reviews write encrypted `VERIFICATION` audit records containing the server-derived actor, affected record, decision, resulting safe status and timestamp. The audit payload does not contain document or location data.

### Admin UI

- `src/app/dashboard/admin/page.tsx`
  - admin-only client guard with explicit unauthenticated/denied states;
  - KPI/stat cards;
  - bounded families and companions overview;
  - pending verification queue and detail view;
  - approve/reject/expire controls with confirmation, loading, error and refresh states;
  - safe bookings/trips summaries;
  - SOS overview without location data;
  - ratings/reviews visibility;
  - loading, empty, error and reload states.

The UI guard is only a usability boundary. All server actions independently enforce the admin role row.

## Verification evidence

### End-to-end local suite

`tests/milestone12-local.cjs` ran against real local Supabase and Chromium at `http://127.0.0.1:3112`.

Fixture IDs:

- Verification: `e60c9e52-78a8-4c52-b366-0896c7c80c81`
- Companion: `123c08ea-c54e-43d0-8f4c-e11d9b02b674`

Verified:

1. Admin accessed the dashboard and server overview.
2. Family, companion and anonymous callers were denied admin overview access.
3. Family and companion direct verification review calls were denied.
4. Pending verification appeared in the admin queue.
5. Safe verification metadata was returned without storage path, location or medical/contact fields.
6. Admin could inspect real KPI counts and bounded booking/trip/SOS/rating data.
7. Admin approve transition succeeded and updated both verification and companion status.
8. Repeated invalid approve transition was rejected.
9. Admin expire transition succeeded after approval.
10. Companion self-review remained denied.
11. Verification audit rows were written with server-derived admin actor and timestamps.
12. Browser reload preserved the admin dashboard and queue state.
13. Browser page errors: 0.

The test restores the verification/companion fixture state after each run. The local admin role remains seeded so `dev-admin-user` can continue to exercise the dashboard. Synthetic audit history remains local.

Independent final local SQL verification:

```text
admin role: dev-admin-user / super_admin
verification fixture: background_check_status=passed
companion fixture: verification_status=expired
verification audit rows for dev-admin-user: 7
remote database: not touched
```

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; `/dashboard/admin` included in route output |
| Browser/database/admin suite | `/usr/bin/time -p env PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone12-local.cjs` — PASS; wall time 2.96s |
| Admin authorization | PASS: admin allowed; family/companion/anonymous denied |
| Verification lifecycle | PASS: approve, invalid repeat, expire |
| Auditability | PASS: encrypted `VERIFICATION` audit records |
| Bounded reads/performance sanity | PASS: overview uses count/head queries and bounded page reads; no unbounded admin list query or per-row relationship loop |
| Browser page errors | `0` |
| Browser artifact secret scan | Configured service-role/encryption values absent from all 57 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

## Remaining limitations and handoff

- Admin roles are currently provisioned in local data only. Production Clerk identity mapping and final JWT/RLS enforcement remain intentionally deferred.
- The admin surface is operationally minimal and read-oriented; no arbitrary destructive editing was added.
- Document content remains behind the existing protected KYC endpoint and is not exposed by the admin overview. A future production admin document-review policy should be finalized alongside Clerk/RLS hardening.
- Precise SOS/location data is intentionally omitted from the platform overview; safety-specific participant flows remain the source of truth.
- No final visual redesign was performed.

The temporary test server is stopped. Changes remain uncommitted. **STOP after Milestone 12.**
