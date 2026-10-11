# Milestone 11 — Ratings, Reviews, Reputation and Post-Trip Closure

**Result: PASSED locally.** This milestone adds completed-trip rating/review submission, trusted companion reputation recalculation and post-trip read-only closure behavior.

## Schema audit

The existing schema already supported the required model, so no migration was added:

- `public.ratings`
  - `trip_id` foreign key to `trips`;
  - `rater_clerk_id`;
  - `ratee_clerk_id`;
  - integer `score` with an existing `1..5` check;
  - `comment`;
  - `created_at` and `updated_at`.
- `public.companions`
  - existing `rating_average` aggregate;
  - existing `total_trips` reputation/experience field.
- The matching engine already reads `rating_average` and `total_trips`, while separately requiring verified status, language compatibility and availability.

No migration history, unrelated functionality or remote Supabase database was modified.

## Implementation

### Server actions and contracts

- `src/lib/rating-types.ts`
  - typed rating input, DTO, eligibility, list and error contracts.
- `src/actions/ratings.ts`
  - `getRatingEligibility`;
  - `getRatingsForTrip`;
  - `submitRating` and compatibility alias `createRating`.

### Eligibility and authorization

- Only the family owner may submit a reputation rating because the target is the assigned companion.
- Submission requires all of:
  - authenticated development family identity;
  - validated trip → booking → request → family relationship;
  - completed booking;
  - completed trip request;
  - non-null trip end time;
  - assigned companion relationship.
- Companion participants may retrieve the completed-trip rating but cannot submit a self-rating.
- Unrelated family, unrelated companion and anonymous users are denied.
- The browser submits only `{ tripId, score, comment }`; actor and target identities are derived on the server.

### Validation and duplicate safety

- Score must be an integer from `1` to `5`.
- Review text is optional, trimmed, bounded to 1000 characters and rejects control characters/blank text.
- Invalid UUIDs, invalid scores, malformed comments, unrelated trips and pre-completion submissions are rejected.
- Rating IDs are deterministic from trip, authenticated rater and assigned companion, independent of client idempotency values.
- Existing relationship lookup plus deterministic primary-key conflict handling makes repeated and parallel submissions converge to one rating.
- A later retry never overwrites the first persisted score or review.

### Reputation and matching

- After a new or repeated rating, `rating_average` is recomputed server-side from persisted rows that independently pass all of these checks:
  - completed trip/booking/request;
  - ratee is the assigned companion;
  - rater is the completed trip’s family owner;
  - score is valid;
  - rater and ratee are not the same identity.
- Invalid/spoofed rows are excluded from the aggregate and from trip review DTOs.
- Only `rating_average` is updated; `total_trips` remains controlled by the existing trip/reputation flow.
- No client action can update companion aggregates directly.
- Existing matching remains safety-gated: it filters companions to `verification_status = verified` and still applies language and availability eligibility before reputation scoring. A high rating cannot bypass those requirements.

### Post-trip chat closure

- `src/actions/messages.ts` was narrowly adjusted so completed-trip participants can still retrieve existing conversation history and mark messages read.
- New messages remain blocked after completion because active-trip send access is still required.
- Existing location, check-in, SOS, booking and trip transition restrictions remain unchanged.

### UI

- `src/app/dashboard/bookings/[id]/page.tsx`
  - Added a completed-trip-only rating section.
  - Provides an accessible 1–5 star control and optional review field.
  - Shows loading, validation, submission, success, already-rated and error states.
  - Reloads server-backed rating state after submission.
  - Shows authorized trip reviews and current companion reputation values without exposing rater/ratee IDs.
  - The prompt is unavailable before trip completion.
  - Existing Milestones 8–10 lifecycle, chat, notification, location and SOS UI remains in place without redesign.

## Verification evidence

### End-to-end local suite

`tests/milestone11-local.cjs` ran against real local Supabase and Chromium at `http://127.0.0.1:3111`.

Fixture IDs:

- Booking: `70ae6c80-cbb8-586a-9117-3ed1d1971cbc`
- Trip: `34237ad8-95f0-51d0-bdb6-f90f2f366b9e`
- Trip request: `619608c7-21a4-4eae-8499-a8741f8ae646`
- Companion: `123c08ea-c54e-43d0-8f4c-e11d9b02b674`

Verified:

1. Pre-completion rating was rejected.
2. Completed trip became rating-eligible for the family owner.
3. Family rating and review persisted in `public.ratings`.
4. Browser reload preserved the rating/review and displayed the saved state.
5. Two parallel duplicate submissions returned the existing rating and left one legitimate family rating.
6. Invalid scores, blank comments and malformed IDs were rejected.
7. Anonymous, unrelated family and unrelated companion access was denied.
8. Companion could retrieve the authorized completed-trip review but could not submit a self-rating.
9. An unrelated trip ID was denied.
10. Companion `rating_average` became `5.00` from the valid family rating.
11. A directly inserted spoofed rating row did not affect `rating_average` or authorized review results.
12. Matching safety gates remained represented by the existing implementation: verified companions only, plus availability/language eligibility before reputation scoring.
13. Completed-trip chat history remained readable, while new active-trip chat sends were denied.
14. Completed trip status remained persisted in both booking and trip request records.
15. Browser page errors: 0.

Independent final local SQL verification:

```text
booking: 70ae6c80-cbb8-586a-9117-3ed1d1971cbc
booking status: completed
trip request status: completed
trip end_time: 2026-10-07 04:08:21.272+00
ratings rows: 2 total (1 valid family rating, 1 spoofed row intentionally ignored)
valid rating: dev-family-user → dev-companion-user, score 5
companion rating_average: 5.00
companion total_trips: 0 (unchanged by rating submission)
```

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; completed-trip rating UI compiled |
| Browser/database/rating suite | `PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone11-local.cjs` — PASS |
| Eligibility/authorization | PASS: completed family owner only; unrelated/anonymous denied |
| Persistence/reload | PASS |
| Duplicate/concurrency | PASS: one logical family rating |
| Reputation consistency | PASS: valid rating affected aggregate; spoofed row did not |
| Completed-trip closure | PASS: rating available, active-trip mutations rejected, history readable |
| Browser page errors | `0` |
| Browser artifact secret scan | Configured service-role/encryption values absent from all 56 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

## Remaining limitations

- `total_trips` remains governed by the existing trip/reputation flow and is intentionally not incremented by rating submission.
- The existing ratings schema has no database uniqueness constraint; deterministic server IDs, relationship checks and conflict handling provide application-level duplicate safety without a migration.
- The existing RLS policy is not the active development authorization mechanism; these server actions use server-derived development identity and the server-only database client, consistent with prior milestones. Final Clerk/JWT/RLS production acceptance remains deferred.
- No moderation workflow or public review feed was invented; reviews remain scoped to authorized participants of the completed trip.

The temporary test server is stopped. Synthetic local rating/reputation fixtures remain. Changes remain uncommitted. **STOP after Milestone 11.**
