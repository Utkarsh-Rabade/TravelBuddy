# Milestone 10 — Location Sharing and SOS Safety System

**Result: PASSED locally.** This milestone implements consent-gated location persistence and participant-scoped in-app SOS workflows. It does **not** contact emergency services or claim external emergency dispatch.

## Schema audit and justified migration

The existing schema already supported:

- encrypted latest location storage on `trips.current_location`;
- persisted location history in `trip_locations` with latitude, longitude, accuracy and `recorded_at`;
- trip consent records in `trip_consents`;
- `sos_events` with server timestamp, encrypted location BYTEA and the supported states `active`, `acknowledged`, `resolved`;
- in-app `notifications` with the existing `sos` type.

The schema did **not** support a location consent type: `trip_consents.data_type` only allowed `medical`, `accessibility` and `emergency`. This was a genuine defect blocking explicit consent-based location sharing. The only migration change was therefore:

  - extends the existing `trip_consents.data_type` check to include `location`;
  - preserves all existing consent values and table structure.

The migration was applied only to local Supabase with `supabase db push --local`. The remote database was not touched and the database was not reset.

## Implementation

### Server actions and contracts

- `src/lib/safety-types.ts`
  - typed consent, location, SOS event, transition and error contracts.
- `src/actions/safety.ts`
  - `grantLocationConsent`, `getLocationConsent`, `revokeLocationConsent`;
  - `recordTripLocation`, `listTripLocations`;
  - `createSosEvent`, `listSosEvents`, `acknowledgeSos`, `resolveSos`.

### Location privacy and persistence

- Participant context is resolved server-side through `trip → booking → trip_request → family/companion`.
- Family alone can grant or revoke the location consent for its own trip.
- Only the assigned companion can submit location updates.
- Location listing is allowed only to the family participant or assigned companion and only while an active family location consent exists.
- Revocation immediately prevents further location updates and location reads through the safety actions; old rows are not returned after revocation.
- Coordinates are validated server-side:
  - latitude `-90..90`;
  - longitude `-180..180`;
  - integer accuracy `0..10000` metres.
- Client timestamps are ignored. The server sets `recorded_at` and encrypts the latest `trips.current_location` payload.
- History uses the existing `trip_locations` columns exactly; no unsupported metadata was added.

### SOS safety flow

- Family or assigned companion can create an SOS for a confirmed `booked` or `in_progress` trip.
- Actor identity and `triggered_at` are server-derived.
- Optional location is validated and encrypted into the existing `sos_events.location` BYTEA field.
- Deterministic IDs provide retry/parallel idempotency. Explicit keys remain stable; an omitted key deduplicates rapid retries within a short server bucket while allowing a later legitimate event.
- The trip’s existing `sos_triggered` flag is set to `true`.
- Supported transition is strict:
  - `active → acknowledged`;
  - `acknowledged → resolved`.
- Acknowledging/resolving actor IDs and timestamps are server-derived.
- Resolved events cannot be acknowledged or resolved again.
- SOS creates one participant-facing in-app `sos` notification for the other trip participant. No external delivery or emergency-service dispatch is claimed.

### UI

- `src/app/dashboard/bookings/[id]/page.tsx`
  - Added functional Safety section without redesigning the page.
  - Displays location-sharing state, latest permitted location, consent controls, location update form and server-recorded time.
  - Provides participant SOS confirmation and an explicit “in-app only; does not contact emergency services” message.
  - Shows active, acknowledged and resolved SOS states with supported acknowledge/resolve controls.
  - Includes safety loading, retry, failure and closed-trip states.
  - Reloads safety data after mutations.

Emergency contacts remain in the existing encrypted elderly-traveler record and are not duplicated or exposed through this milestone’s safety DTOs. The existing owner-scoped traveler flow remains the source of truth.

## Verification evidence

### End-to-end local suite

`tests/milestone10-local.cjs` ran against real local Supabase and Chromium at `http://127.0.0.1:3110`.

Fixture IDs:

- Booking: `70ae6c80-cbb8-586a-9117-3ed1d1971cbc`
- Trip: `34237ad8-95f0-51d0-bdb6-f90f2f366b9e`
- Trip request: `619608c7-21a4-4eae-8499-a8741f8ae646`

Verified:

1. Location update before consent was rejected.
2. Family granted location consent; the `location` consent row persisted.
3. Assigned companion saved a validated location with a server timestamp.
4. Location history and encrypted latest location persisted.
5. Family and assigned companion retrieved permitted location information.
6. Unrelated family, unrelated companion and anonymous location access were denied.
7. Revoking consent prevented new location updates and further location reads.
8. Consent could be granted again for the active trip.
9. Companion created an SOS; persisted actor was `dev-companion-user`, not a client-supplied identity.
10. SOS notifications were persisted with type `sos` for the other participant.
11. Parallel SOS requests with the same idempotency key converged to one event.
12. Unrelated and anonymous SOS reads were denied.
13. `active → resolved` was rejected; `active → acknowledged → resolved` succeeded.
14. Resolved events rejected further acknowledge/resolve transitions.
15. Completed-trip location and SOS actions were rejected; the local fixture was restored afterward.
16. Browser exercised the family safety view and companion location form.
17. Browser page errors: 0.
18. No external emergency dispatch was claimed or attempted.

Independent final local SQL verification:

```text
booking: 70ae6c80-cbb8-586a-9117-3ed1d1971cbc
booking status: confirmed
trip request status: in_progress
trip: 34237ad8-95f0-51d0-bdb6-f90f2f366b9e
location rows: 2
location consent rows: 2 (one revoked, one active)
sos rows: 2 (one active, one resolved)
sos notifications: 2, both persisted for dev-family-user
```

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; safety UI compiled in booking detail route |
| Local migration | `supabase db push --local` — PASS; location consent constraint applied locally |
| Local schema lint | `supabase db lint --local --fail-on error` — PASS; no schema errors |
| Browser/database/safety suite | `PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone10-local.cjs` — PASS |
| Location privacy | PASS: consent, persistence, revoke and participant scope |
| SOS lifecycle | PASS: active, acknowledged, resolved and invalid transitions |
| SOS duplicate/concurrency | PASS: deterministic same-key parallel requests |
| Authorization | PASS: participant-only; unrelated roles and anonymous denied |
| Browser page errors | `0` |
| Browser artifact secret scan | Configured service-role/encryption values absent from all 56 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

## Safety limitations

- There is no real emergency-service, SMS, phone, email or response-team integration. SOS is an in-app persisted alert and participant notification only.
- `trip_locations` stores its supported coordinate columns as defined by the existing schema. Access is restricted through server-side participant and consent checks; no public location URL or route was created.
- Emergency-contact data remains encrypted in `elderly_travelers`; this milestone does not invent a separate emergency-contact delivery model.
- Realtime safety updates were not added because the application has no existing safe Realtime client architecture.
- Final Clerk/JWT/RLS production acceptance remains deferred.

The temporary test server is stopped. Synthetic local consent, location and SOS fixtures remain. Changes remain uncommitted. **STOP after Milestone 10.**
