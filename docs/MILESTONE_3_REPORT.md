# Milestone 3 — Trip Request Management

**Result: PASSED locally.** Scope stops at trip-request management; no later milestone started.

## Scope and boundaries

- Existing development identity adapter and LOCAL Supabase were retained.
- Runtime Supabase URLs were checked as loopback hosts on port `54321` before starting the test server. SQL checks used `supabase_db_TravelBuddy` only.
- Clerk configuration/integration, authentication architecture, landing page, migrations, schema and remote database were not changed.
- Existing form/page layout and classes were retained; functional wiring and a small family-dashboard navigation entry were added. No UI redesign.
- No matching, companion management, bookings, remote writes, database resets, deletions, commits, pushes or deployments were performed.

## Implementation

### Server and data contract

- `src/actions/trip-requests.ts`: owner-scoped traveler options, create, list, single read and update actions.
- `src/lib/trip-request-types.ts`: client-safe typed inputs, DTOs and errors.
- Identity is read through `getCurrentUser()`. Family ownership is resolved from `families.family_member_clerk_id`; the browser never supplies family/owner identity.
- All request reads/updates filter `family_id`. Create/update verifies the selected traveler belongs to the same family. Retrieval also verifies the request/traveler relationship, failing closed on a mismatched relation.
- Traveler options/DTOs contain ID and names only; trip screens no longer fetch or decrypt medical/contact data. A link goes to the existing owner-scoped traveler detail page.
- The existing server-only privileged development database client is used. These checks are application authorization, **not final Clerk JWT/RLS acceptance**.

### Current schema fields

The live local columns/constraints were read and matched against the audited migration. No stale `family_member_id`, browser Supabase Auth or client crypto dependency remains in the four management routes/form.

| Field | Behavior |
| --- | --- |
| `id` | UUID submission identifier; primary-key deduplication |
| `family_id` | Server-derived, immutable |
| `elderly_traveler_id` | Valid UUID; same-family traveler required |
| `origin_airport`, `destination_airport` | Trimmed, uppercased, three ASCII letters, distinct |
| `departure_date` | Strict calendar `YYYY-MM-DD`; new/edited departures cannot be in the past in Asia/Kolkata |
| `return_date` | Valid calendar date, not before departure; `null` for one-way |
| `assistance_level` | `minimal`, `moderate`, `maximum` only |
| `language_requirements` | Text array; whitespace normalized, lowercased, deduplicated/sorted; at most 16 values of at most 80 characters |
| `special_instructions` | Trimmed text or `null`; at most 2,000 characters |
| `status` | Created as `draft`; editable states limited to `draft` and `searching` |
| `matching_criteria` | Existing DB default retained; client writes rejected |
| `created_at`, `updated_at` | DB-created timestamps; explicit update timestamp; client writes rejected |

The database's full status enum remains `draft`, `searching`, `matched`, `booked`, `in_progress`, `completed`, `cancelled`, `expired`. Draft → searching and same-state edits are allowed; searching → draft and edits to later states are denied. Changing to searching records a state only; it does not run matching.

### Submission and update safety

- The new-request page retains one `crypto.randomUUID()` submission ID across retries. Submit guards prevent overlapping form submissions.
- A retry with the same normalized payload returns the existing owned request. A changed payload using that ID returns `CONFLICT` without creating another row.
- Database primary-key uniqueness handles parallel insert races; `23505` recovery re-reads only the current family's row. Foreign-family ID collisions never return foreign records.
- Updates are scoped by family, ID, observed traveler, status and `updated_at`; concurrent changes between read and write return a conflict. This does not promise stale-browser-form merging/version detection.
- Unsupported ownership, criteria, timestamp and other extra input fields are rejected. The action code does not log input payloads or sensitive error details; Next development action diagnostics can still log inputs, so use synthetic data only.

### UI files

- `src/components/forms/TripRequestForm.tsx`: typed fields; lazy initial state fixes the previous render loop; stable edit initialization; save/create labels; optional return date and edit status selector.
- `src/app/dashboard/family/trip-requests/page.tsx`
- `src/app/dashboard/family/trip-requests/new/page.tsx`
- `src/app/dashboard/family/trip-requests/[id]/page.tsx`
- `src/app/dashboard/family/trip-requests/[id]/edit/page.tsx`
- `src/app/dashboard/family/page.tsx`: create/list navigation links.

Management pages use development-session gating, account-keyed mounts, guarded asynchronous loads and finite loading/error states. Validation failures preserve the mounted form's values. Server actions independently authorize every call; page gating is not relied upon for security.

## Verification evidence

### Real Chromium + HTTP actions + local SQL

`tests/milestone3-local.cjs` ran at `http://127.0.0.1:3103` with a server-issued `dev-family-user` session and an ephemeral, unprinted development-session secret. The final successful browser run returned request ID:

`c024c452-38dd-47aa-9cd2-06bdd96e9633`

Verified flow:

1. Existing family dashboard → Create Trip Request → existing owned traveler.
2. Submit BOM → DEL, future departure/return dates, moderate assistance, Hindi/English requirements and synthetic instructions.
3. Retrieve every field through the real action endpoint; status is draft; reload retains saved values.
4. Same-ID/same-payload retry returns that record; changed-payload collision is denied. Two parallel same-ID requests both return one ID; SQL counts exactly one row.
5. Edit to a different existing owned traveler, DEL → LHR, new departure, no return date, maximum assistance, Marathi, changed instructions and searching status.
6. Retrieve updated values; reload detail and list; verify the request remains visible and owner/traveler family relationship is intact. Same-state searching edit succeeds.
7. Invalid calendar/past dates, return-before-departure, malformed/missing traveler, invalid airports/assistance/languages, oversized instructions, forged ownership/criteria and invalid states are denied. Invalid creates leave the table count unchanged.
8. Direct foreign-traveler create/reassignment, foreign-request read/update and ID collision are denied. Foreign detail/edit browser pages show not found, with no form.
9. Companion and anonymous direct calls deny **all five actions**. All four management pages deny companion/anonymous access without exposing the synthetic request data.
10. Searching → draft is denied through both direct action and browser save; edited form values remain available after the error. SQL confirms denied operations did not change request status/destination.

Final independent SQL read of the verified request:

```text
id: c024c452-38dd-47aa-9cd2-06bdd96e9633
origin_airport: DEL
destination_airport: LHR
departure_date: 2026-11-14
return_date: NULL (one-way)
assistance_level: maximum
language_requirements: {marathi}
status: searching
matching_criteria: {}
updated_at > created_at: true
```

**Browser page errors: 0.** Date fixtures are relative to execution time; the date above records the actual final run.

### Reverse ownership / closed states / production fail-closed

`tests/trip-request-ownership-local.cjs` transpiles the actual action source and uses the actual local database client. It injects only a second-family `getCurrentUser()` result because the centralized dev provider intentionally exposes just one family identity. This is a database integration test, not a second-family browser sign-in.

- Second family cannot read/edit the latest updated `dev-family-user` request, create for its traveler, or reuse its ID to obtain data.
- That second family can create/read/update its own request; the original family cannot read/edit that request.
- Own lists/options exclude foreign records; a missing family returns a finite not-found error.
- All six later schema-valid statuses are readable but non-editable; full SQL row snapshots stay unchanged after denial.
- The original family's full SQL request snapshot stays unchanged after second-family denials.
- The real centralized auth adapter and all five trip actions return no identity/`UNAUTHENTICATED` under `NODE_ENV=production`, even with the dev flag and a valid-length test secret present. No development DB client is reached.

### Commands and results

| Check | Actual command/result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; all management routes included |
| Browser/DB suite | `PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone3-local.cjs` — PASS |
| Reverse ownership/closed states | `node tests/trip-request-ownership-local.cjs` — PASS |
| Encryption regression | `node tests/traveler-crypto.cjs` — PASS |
| Lint | `npm run lint` — BLOCKED, exit 2: existing `typescript-eslint does not support TS 7.0` failure before code analysis |
| Browser secret scan | Configured service-role/encryption secret values absent from all 53 `.next/static` production artifact files; values were not printed |

One additional test iteration corrected a test expectation: foreign traveler selection is rejected before a foreign request-ID collision is reached. The collision case now uses the caller's owned traveler to reach that branch; the corrected complete tests passed. Initial test-server launch attempts failed due Next forwarding Node `-e`/`--env-file` arguments; launching a clean CLI child process resolved this without changing application code or configuration files.

## Usage, limits and handoff

- Run local Supabase and `npm run dev` with the existing private `.env.local` settings and explicit dev-auth activation documented in `docs/auth-development.md`. Keep secrets private.
- Sign in as the development family user; use Family Dashboard → Create Trip Request / View Trip Requests. Existing family/traveler profiles are required.
- Browser suite expects a dev-auth-enabled server on port `3103` and at least two existing owned travelers from Milestone 2. Both integration suites refuse non-local Supabase URLs and create uniquely identified synthetic fixtures. They do not delete existing data or clean up fixtures.
- Synthetic requests, foreign families/travelers and closed-state test records remain locally, including earlier successful test iterations. No cleanup/deletion occurred.
- Airport validation checks code shape, not an external airport registry. Language normalization is case-insensitive. Special instructions remain TEXT per the audited schema; do not place real sensitive data into development inputs.
- Final production Clerk/JWT/RLS verification remains deferred. The production build passing does not make development auth a production login or prove production readiness.
- The matching route and other later product paths remain untouched and unverified; their legacy schema/auth issues remain outside this milestone.
- The temporary test server is stopped. Changes remain uncommitted. **STOP after Milestone 3; wait for the next explicit scope.**
