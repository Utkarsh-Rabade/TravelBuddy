# Milestone 7 — Booking and Payment-State Lifecycle

**Result: PASSED locally.** Scope stops at the persisted booking lifecycle and development-only payment-state simulation.

## Boundaries

- Used the existing development authentication abstraction and LOCAL Supabase only.
- Local Supabase was verified on loopback port `54321` before testing.
- Clerk, the landing page, existing visual design, migration history and remote Supabase were not changed.
- No live payment provider was integrated and no real payment was represented as successful.

## Implementation

### Server lifecycle

- `src/actions/bookings.ts`
  - Family-only creation from an accepted, family-owned match attempt.
  - Server-derived family, trip and companion ownership; no client ownership IDs are trusted.
  - Current match integrity checks: accepted structured match, `matched = true`, trip status `matched`, current companion verification/availability/language eligibility and valid departure date.
  - Creates the real `public.bookings` record with schema-supported values:
    - `status = confirmed`
    - `payment_status = pending`
    - `total_amount = 0.00 USD` because no pricing/payment provider exists yet.
  - Deterministic booking UUID/reference derived from the match-attempt UUID.
  - Existing logical booking lookup plus deterministic primary-key/unique conflict handling makes repeated and parallel requests idempotent.
  - Promotes the trip request to `booked` only after booking creation; rolls back the booking if the guarded trip update fails.
  - Ownership-scoped retrieval for family and companion users.
  - Supported schema transitions:
    - `confirmed → cancelled_by_family` only while payment is pending/failed;
    - `confirmed → cancelled_by_companion` only after payment is paid;
    - `confirmed → completed` only by the companion after payment is paid.
  - Rejects changes after cancellation/completion and rejects payment changes after terminal booking states.

### Development payment path

`setDevelopmentPaymentState()` and its explicit wrappers are gated by `NODE_ENV=development|test` plus `TRAVELBUDDY_DEV_PAYMENT_ENABLED=true`. They insert a `payments` row with `type = charge`, a `dev_test_payment_intent_...` marker, amount `0`, and status `succeeded` or `failed`, then persist the separate booking `payment_status`. This is a test-state transition only; it does not contact Stripe or any other gateway.

### UI

- `src/app/dashboard/family/trip-requests/[id]/matches/page.tsx`
  - Added guarded `Create Booking` action for accepted matches.
  - Prevents double-clicks, detects existing bookings after reload and links to the booking detail.
- `src/app/dashboard/bookings/[id]/page.tsx`
  - Functional booking details with loading, failure, not-found and reload states.
  - Shows booking status and payment status separately, plus booking reference, trip and companion details.
  - Family cancellation and companion cancellation/completion controls follow server authorization.
  - Development-only payment controls are clearly labelled as no-charge test controls.

## Verification evidence

### End-to-end local suite

`tests/milestone7-local.cjs` ran against real Chromium at `http://127.0.0.1:3107`, the real local Supabase database/storage service and the existing accepted Milestone 5 match.

Fixture IDs:

- Match attempt: `b8ae7e37-8c70-509c-a863-ca07c8489e4f`
- Trip request: `619608c7-21a4-4eae-8499-a8741f8ae646`
- Companion: `855ce024-ea1f-404f-b159-d9620be3967c`
- Booking: `70ae6c80-cbb8-586a-9117-3ed1d1971cbc`

Verified:

1. Accepted match created exactly one booking.
2. Booking persisted with `confirmed / pending`, zero amount and USD.
3. Booking detail reload preserved the same booking and both states.
4. Two parallel create requests returned the same booking and left one logical row.
5. Development payment persisted `paid` separately and inserted one succeeded test charge.
6. Family retrieved its booking; the matched companion retrieved it.
7. Unrelated family, unrelated companion and anonymous access were denied.
8. Invalid match input was rejected.
9. Pending, expired and rejected companion verification states were each rejected for booking creation, even with the historical match accepted.
10. Family cancellation after successful payment was rejected.
11. Paid booking successfully transitioned to `cancelled_by_companion`; completion and payment mutation after cancellation were rejected.
12. A fresh confirmed/paid booking successfully transitioned to `completed`; cancellation after completion was rejected.
13. Browser page errors: 0.

Final local SQL verification:

```text
booking: 70ae6c80-cbb8-586a-9117-3ed1d1971cbc
trip_request: 619608c7-21a4-4eae-8499-a8741f8ae646
companion: 855ce024-ea1f-404f-b159-d9620be3967c
booking_reference: TB-70AE6C80CBB8E86A1117
total_amount: 0.00
currency: USD
payment_status: paid
status: completed
payment rows: 1
payment type/status: charge / succeeded
payment marker: dev_test_payment_intent_<booking>_paid
trip status: booked
```

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; booking detail route included |
| Browser/database/persistence suite | `NODE_ENV=development TRAVELBUDDY_DEV_PAYMENT_ENABLED=true PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone7-local.cjs` — PASS |
| Ownership/authorization | PASS: family and matched companion allowed; unrelated family/companion and anonymous denied |
| Duplicate/concurrency | PASS: parallel requests produced one booking |
| Payment persistence | PASS: separate booking payment state and `payments` row persisted |
| Invalid transitions | PASS |
| Browser page errors | `0` |
| Browser artifact secret scan | Configured service-role/encryption values absent from all 55 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

## Remaining limitations

- Payment is intentionally a development/test state path only. A real gateway, webhook reconciliation, refunds and production payment authorization remain future work.
- Pricing is not present in the audited architecture, so the booking shell stores `0.00 USD`.
- No booking-specific database unique constraint exists for `(trip_request_id, companion_id)`; application-level deterministic IDs, logical lookup and conflict handling provide duplicate safety for this milestone.
- Final Clerk/JWT/RLS production acceptance remains deferred.

The temporary test server is stopped. Synthetic local booking/payment fixtures remain. Changes remain uncommitted. **STOP after Milestone 7.**
