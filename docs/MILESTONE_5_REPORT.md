# Milestone 5 — Matching Engine and Ranked Companion Results

**Result: PASSED locally.** Scope stops at matching, persisted match attempts and family accept/reject controls.

## Scope and boundaries

- Used the existing development authentication abstraction and LOCAL Supabase only.
- Local Supabase URLs were verified as loopback hosts on port `54321` before the browser server started.
- Clerk, the landing page, migration history and remote Supabase were not changed.
- No schema change was necessary. The live `match_attempts` schema was inspected before implementation and the code was aligned to it.
- Existing matching UI structure/classes were preserved; only functional auth, loading, persistence and result-display wiring changed.
- No AI model or random score is involved. This is deterministic rule-based matching.

## Live schema correction

The audited/live `public.match_attempts` table contains:

```text
id UUID primary key
trip_request_id UUID
companion_id UUID
score NUMERIC
explanation JSONB
matched BOOLEAN
created_at TIMESTAMPTZ
```

It does **not** contain `match_score`, `status` or `match_attempted_at`. All database queries and writes now use `score`, `explanation`, `matched` and `created_at`. Client compatibility aliases named `match_score` and `match_attempted_at` are derived DTO values only; they are never queried or written as database columns.

Because the schema has no status column, the existing `explanation JSONB` field stores a structured envelope:

```json
{
  "text": "...",
  "status": "pending | accepted | rejected",
  "components": {}
}
```

The existing `matched` boolean is `true` for accepted attempts and `false` for pending/rejected attempts. Legacy string/older JSON explanations remain readable with a safe pending/accepted fallback.

## Eligibility and scoring

Implemented in:

- `src/lib/matching/types.ts`
- `src/lib/matching/score-calculator.ts`
- `src/lib/matching/explanation-generator.ts`
- `src/lib/matching/basic-matching-algorithm.ts`
- `src/actions/match-companions.ts`

### Enforced eligibility

A companion is eligible only when:

1. `verification_status = 'verified'`.
2. `availability_calendar` is structurally valid and has at least one valid range for every weekday touched by the trip date span.
3. When language requirements are present, at least one required language matches `languages_spoken` case-insensitively.

Pending, expired, rejected, unavailable, malformed-calendar and language-incompatible companions are excluded before scoring. A profile's existence alone is not sufficient.

The trip schema has dates but no time-of-day, and companion availability is weekly rather than date-specific. Therefore availability matching is correctly limited to weekday coverage; it does not pretend to prove a particular time-slot match.

### Deterministic score

Only supported fields are scored:

| Factor | Weight | Rule |
| --- | ---: | --- |
| Language | 40 | Matched required-language ratio; no requirements receives full language points |
| Availability | 30 | Full points only when all trip weekdays are covered |
| Verification | 15 | Verified eligible companions receive the verified score |
| Reputation | 15 | `rating_average` plus logarithmically bounded `total_trips` |

Scores are capped at 100 and sorted by score descending, then normalized companion name, then UUID. Each explanation contains score details, matched languages, covered weekdays/date span, verification, rating/trips and limitations.

### Explicit schema limitations

- Route compatibility cannot be computed: companions have no route, airport or region fields.
- Assistance capabilities cannot be computed: companions have no assistance-capability field. Verification is an eligibility requirement, not a fabricated capability signal.
- Experience is represented only by the available `rating_average` and `total_trips` fields.
- No AI matching claim is made.

## Authorization and persistence

Family actions:

- `findMatchingCompanionsAction(tripRequestId)`
- `getMatchAttemptsAction(tripRequestId)`
- `updateMatchStatusAction(matchAttemptId, 'accepted' | 'rejected')`

All derive family ownership from the centralized session and `families.family_member_clerk_id`. The trip request and match attempt are re-read through that family before calculating, reading or updating. Foreign-family IDs return not-found behavior without disclosure.

Companion action:

- `getCompanionMatchAttemptsAction()`

It resolves the companion profile from the session's `user_clerk_id` and returns only attempts with that `companion_id`. It does not expose another companion's attempts or private family data. The audited schema has no companion update policy for match attempts; companions therefore have no self-service accept/reject mutation.

Anonymous requests are rejected. Family users cannot use companion-scoped reads. Companion users cannot use family matching actions.

### Duplicate handling

- Attempt identity is deterministically derived from `trip_request_id + companion_id` as a UUID.
- Existing attempts are reused on repeated matching calls; parallel/unique collisions are re-read rather than duplicated.
- Repeated accept/reject of the same current status is idempotent. Changing an already decided status is rejected.
- Accepted match attempts update the owner-scoped trip request to `matched`; rejection only updates that attempt.

## UI changes

- `src/app/dashboard/family/trip-requests/[id]/matches/page.tsx`
- `src/components/ui/MatchResultCard.tsx`

The matching page now uses the development auth boundary and server actions only. It provides finite loading, error and empty states; stale-load guards; ranked cards; identity/profile data; score; verification; rating/trips; languages; availability summary; explanation and limitations; accept/reject controls; and reload persistence. Direct browser Supabase and Clerk ownership checks were removed from this path.

## Verification evidence

### Final local run

`tests/milestone5-local.cjs` ran with real Chromium at `http://127.0.0.1:3105` and the actual local Supabase database. The final successful test request was:

`619608c7-21a4-4eae-8499-a8741f8ae646`

Final ranked companion IDs:

1. `855ce024-ea1f-404f-b159-d9620be3967c` — score 97
2. `947dbac8-92db-428e-a0b6-aacf9ff30a98` — score 87

Verified:

1. A real family trip request was created through the existing trip-request server action and moved to `searching`.
2. Synthetic companion profiles and availability were created through the existing companion server actions. Verification states were set only by local admin SQL fixtures because no admin verification action exists; companions cannot self-upgrade their state.
3. Verified, available, English-capable companions were returned and ranked deterministically.
4. Verified but unavailable, verified language-incompatible and pending companions were excluded.
5. Match explanations contained supported factors and explicit route/assistance limitations.
6. Two `match_attempts` rows persisted with live columns, deterministic scores and JSONB explanations.
7. A repeated matching operation returned the same attempt IDs and left the count at two.
8. Accepting the top match persisted `matched = true`, explanation status `accepted`, and trip request status `matched`.
9. Reload showed persisted previous attempts/status. A pending second attempt could be rejected and persisted.
10. Another family could not read/find the request; anonymous calls were denied.
11. Companion-scoped reads returned only that companion's attempts. Another companion could not update the top attempt.
12. Invalid IDs/statuses were rejected.
13. Browser page errors: `0`.

Independent SQL verification for the final request:

```text
attempt 1: score 97.00, matched true, explanation JSONB object, trip status matched
attempt 2: score 87.00, matched false, explanation JSONB object, trip status matched
```

The test server was stopped after verification. Synthetic local fixtures remain; no cleanup or remote modification was performed.

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; matching route included |
| End-to-end browser/database/security suite | `PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone5-local.cjs` — PASS |
| Matching calculation/ranking | Included in the final suite — PASS |
| Local persistence/reload | Included in the final suite and independent SQL read — PASS |
| Authorization/duplicate tests | Included in the final suite — PASS |
| Browser page errors | `0` |
| Production browser artifact secret scan | Configured service-role/encryption values absent from all 54 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

## Remaining limitations

- Final Clerk/JWT/RLS acceptance remains deferred; development authorization is not production identity verification.
- Route and assistance compatibility cannot be computed until the schema contains those companion capabilities.
- Weekly availability cannot prove time-of-day compatibility because trip requests contain dates only.
- Verification approval, ratings and trip-count updates remain controlled by the intended admin/trip workflows.
- The existing matching engine is deterministic and rule-based, not AI.

**STOP after Milestone 5. Changes remain uncommitted.**
