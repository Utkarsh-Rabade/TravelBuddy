# Milestone 4 — Companion Profile & Availability

**Result: PASSED locally.** Scope stops at companion profile and availability; no later milestone started.

## Scope and boundaries

- Used the existing development authentication abstraction and local Supabase only.
- Local Supabase URLs were verified as loopback hosts on port `54321` before the browser server started. No remote Supabase calls, migrations, resets or schema changes were made.
- Clerk, the landing page and migration history were not changed.
- Existing page/component styling and structure were preserved. Changes are functional wiring and the missing `/dashboard/companions` route.
- KYC file upload/verification mutation was intentionally not included. The existing upload component used legacy browser Supabase/storage behavior and its database field names did not match the audited schema. This milestone reads the authoritative verification state but does not claim approval.
- No commits, pushes or deployments were performed.

## Live audited schema used

The local database was inspected before implementation. `public.companions` contains exactly:

```text
id UUID primary key
user_clerk_id TEXT unique not null
first_name TEXT not null
last_name TEXT not null
date_of_birth DATE
languages_spoken TEXT[]
availability_calendar JSONB
verification_status TEXT: pending | verified | expired | rejected
rating_average DECIMAL(3,2)
total_trips INTEGER
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

The implementation uses these current names. It does not invent stale fields such as `experience`, `assistance_capabilities`, a separate availability table, or a user-owned rating field.

Schema-supported meaning:

- Profile information: first name, last name, date of birth and spoken languages.
- Reputation/experience signals: read-only `rating_average` and `total_trips`.
- Availability: weekly `availability_calendar` JSONB with weekday keys and time ranges.
- Verification: read-only `verification_status`; a newly created profile is always `pending`.
- The current matching engine consumes `languages_spoken`, `availability_calendar`, `verification_status`, `rating_average` and `total_trips`. Those exact fields are returned by the safe DTO and persisted without compatibility aliases.
- No assistance-capability column exists in the current schema. The existing matching code derives assistance scoring from verification status; no unsupported capability data was fabricated.

## Implementation

### Server layer

- `src/actions/companions.ts`
- `src/lib/companion-types.ts`

Actions:

- `getCurrentCompanionProfile()`
- `createCompanionProfile(input, submissionId)`
- `updateCompanionProfile(id, input)`
- `getCurrentCompanionAvailability()`
- `updateCompanionAvailability(id, calendar, submissionId)`

Authorization and data safety:

- Every action reads centralized `getCurrentUser()` and requires role `companion`.
- `user_clerk_id` is derived from the server session. Browser owner IDs, profile IDs supplied as ownership, verification fields and reputation values are not trusted.
- Profile reads/updates are scoped to `user_clerk_id`; cross-companion access returns `NOT_FOUND`.
- Family users receive `FORBIDDEN`; anonymous users receive `UNAUTHENTICATED`.
- Create forces `verification_status = 'pending'`. Updates cannot write `user_clerk_id`, `verification_status`, `rating_average`, `total_trips`, timestamps, availability or arbitrary fields through the profile form.
- Returned DTOs are constrained to the fields the companion UI needs. No KYC document payloads or server credentials are returned.

Validation:

- Names are required, trimmed and bounded.
- Date of birth uses strict calendar validation, has a minimum supported year and cannot be future-dated.
- Languages are a bounded string array, normalized to lowercase, whitespace-normalized, deduplicated and sorted.
- Availability accepts only weekday keys and exact `HH:mm` ranges. It rejects malformed times, missing values, `start >= end`, overlaps, unknown days, extra range keys, null ranges and excessive range counts. Ranges are canonicalized by weekday and start time.
- Existing profile identity uniqueness and the profile UUID primary key protect parallel create attempts. Equivalent retries return the same owned profile; changed payloads conflict.
- Availability has no separate table in the audited schema. Duplicate/parallel availability submissions update one owner-scoped JSONB row and equivalent retries return the same canonical calendar; no duplicate availability records can be created.

### UI layer

- `src/app/dashboard/companions/page.tsx`: new working companion dashboard.
- `src/app/dashboard/companions/create/page.tsx`: development companion-only creation flow with stable retry submission ID.
- `src/app/dashboard/companions/[id]/page.tsx`: owner-scoped profile/reputation/verification/availability view.
- `src/app/dashboard/companions/[id]/edit/page.tsx`: owner-scoped profile edit and separate availability save flow with stable retry submission ID.
- `src/components/forms/CompanionForm.tsx`: typed schema-supported profile fields.
- `src/components/ui/AvailabilityCalendar.tsx`: weekly time editor, accessible labels, client feedback and server-action save.

The old browser Supabase queries, Clerk `useUser()` calls, client owner comparisons and self-service verification mutations were removed from these companion management paths. Availability controls use `type="button"` so they cannot accidentally submit the profile form. Async loads are guarded against stale account/page results, and forms retain values after rejected server validation.

## Verification evidence

### Browser and local database suite

`tests/milestone4-local.cjs` ran with real Chromium at `http://127.0.0.1:3104`, a server-issued `dev-companion-user` session, and the actual local Supabase database. The final successful run returned profile ID:

`123c08ea-c54e-43d0-8f4c-e11d9b02b674`

Verified end-to-end:

1. Companion dashboard → create profile with synthetic name, date of birth and languages.
2. Save to local Supabase; retrieve the profile and confirm identity association, `pending` verification, rating `0`, trips `0` and normalized languages.
3. Reload dashboard/profile; values persist.
4. Edit name/languages; retrieve updated profile; reload detail; values persist.
5. Configure Monday `09:00–17:00` availability in the existing calendar UI.
6. Save availability through the owner-scoped action; reload profile; retrieve the same range.
7. Retry profile create and availability save; same normalized data returns the same result without duplicate records.
8. Invalid profile data: empty name, invalid calendar dates, future date of birth, wrong language type and forged verification/reputation/owner fields were rejected. The companion row count stayed unchanged.
9. Invalid availability data: reversed range, malformed time, overlap, unknown day, extra range field and null range were rejected.
10. Family direct reads/updates/availability writes were denied. Anonymous direct reads/updates were denied.
11. A second synthetic companion profile was created through the same server action layer. Each companion could access its own profile only; cross-companion profile and availability reads/updates returned `NOT_FOUND`.
12. Browser page errors: `0`.

Final independent SQL read of the verified owner profile:

```text
id: 123c08ea-c54e-43d0-8f4c-e11d9b02b674
user_clerk_id: dev-companion-user
first_name: M4 Updated
last_name: Companion
languages_spoken: {english,marathi}
availability_calendar: Monday 09:00–17:00
verification_status: pending
rating_average: 0.00
total_trips: 0
updated_at > created_at: true
```

### Production fail-closed check

The test transpiled and exercised the actual centralized auth adapter/actions with `NODE_ENV=production`, even when the development flag and a test-length secret were present. All five companion actions returned `UNAUTHENTICATED`; the development database client was not reached. This is a development/protection check, not final Clerk JWT/RLS acceptance.

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; companion dashboard/create/detail/edit routes included |
| Browser/database/security suite | `PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone4-local.cjs` — PASS |
| Browser errors | `0` |
| Production browser artifact secret scan | Configured service-role/encryption values absent from all 54 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

The first two test attempts exposed only test-harness issues: a text selector that did not match the rendered combined reputation line, then JSON object-key ordering in a SQL assertion; both were corrected and the complete final suite passed. One failed run's synthetic development profile was removed locally before rerunning; no remote data or migration history was affected.

## Local fixtures and limits

- The successful final owner profile and synthetic second-companion ownership fixtures remain in local Supabase. No cleanup of the final verification data was performed.
- The availability schema is weekly; it does not support dated availability records. Date validation therefore applies to the profile date of birth, while availability validates time ranges and weekday structure.
- The implementation does not perform KYC approval, edit verification status, write ratings or increment trip counts. Those remain controlled by the intended verification/admin/trip workflows.
- Existing matching and other later product paths were not redesigned or claimed production-ready. Final Clerk integration and production RLS/JWT acceptance remain deferred.
- The temporary test server is stopped. Changes remain uncommitted. **STOP after Milestone 4; wait for the next explicit scope.**
