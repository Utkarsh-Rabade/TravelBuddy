# Milestone 9 — Chat and Notifications

**Result: PASSED locally.** Scope stops at participant-scoped persisted chat, notification creation/read state and the functional booking-detail communication UI.

## Schema alignment

The implementation uses the live schema without migration changes:

- `public.messages`: `trip_id`, `sender_clerk_id`, `content`, `message_type`, `read_by`, `created_at`.
- `public.notifications`: `user_clerk_id`, constrained `type`, `title`, encrypted `body`/`data` BYTEA fields, `is_read`, `read_at`, `created_at`.
- Conversation membership is derived through `messages.trip_id → trips.booking_id → bookings.trip_request_id → trip_requests.family_id/families` and `bookings.companion_id/companions`.
- No client-supplied owner, sender, family, companion, traveler or booking identity is trusted.

No migration history or remote Supabase database was modified.

## Implementation

### Server actions and contracts

- `src/actions/messages.ts`
  - Participant-scoped message listing by validated trip UUID.
  - Family access is derived from the authenticated family identity and the trip request family relationship.
  - Companion access is derived from the authenticated companion identity and assigned booking relationship.
  - Server assigns `sender_clerk_id` and `created_at`.
  - Rejects empty/oversized content, malformed UUIDs, unsupported message types and inactive/nonexistent trips.
  - Supports text messages using the existing `message_type = text` constraint.
  - Persists read receipts in the existing `read_by` array.
  - Deterministic message IDs and optional idempotency keys make repeated/parallel sends converge to one message.
  - Creates one deterministic `trip_update` notification for the other participant after a newly inserted message.
  - `markMessageRead` authorizes through the message’s actual trip and current participant.
- `src/actions/notifications.ts`
  - Lists only notifications for the authenticated development identity.
  - Supports unread filtering.
  - Marks only owner-scoped notifications as read with a server timestamp.
  - Uses the existing `trip_update` notification type and deterministic IDs.
  - Stores notification context in encrypted server-only `data` BYTEA; no private notification payload is sent to the client unless it can be decoded by the server codec.
  - Exposes a server-only `createTripUpdateNotifications` helper for future authorized lifecycle events without inventing infrastructure.
- `src/lib/message-types.ts`, `src/lib/notification-types.ts`
  - Client-safe action contracts and DTOs.
- `src/lib/traveler-sensitive-fields.ts`
  - Existing server-only AES-256-GCM BYTEA codec now also provides generic JSON encryption/decryption for notification data.

### UI

- `src/app/dashboard/bookings/[id]/page.tsx`
  - Added a basic participant conversation view to the existing booking/trip detail page.
  - Shows messages, sender context, server timestamps, empty/loading/error states and a message composer.
  - Supports family-to-companion messages and companion replies.
  - Marks incoming messages read when the participant opens the conversation.
  - Added a notification list with unread styling and owner-scoped “Mark read” action.
  - Reloads persisted messages and notifications after send/read actions.
  - Existing styling was preserved; no landing-page or major visual redesign was performed.

### Realtime decision

The existing application had no established client Supabase Realtime subscription architecture. Realtime would have required adding new client subscription infrastructure and did not improve the required persisted flow for this milestone. The implementation intentionally uses reliable server-action reads/reloads instead of inventing a realtime rewrite.

## Verification evidence

### End-to-end local suite

`tests/milestone9-local.cjs` ran with real Chromium at `http://127.0.0.1:3109` and real local Supabase. It used a synthetic local fixture and temporarily associated that fixture with the stable development companion identity so the browser could exercise both participant roles.

Fixture IDs:

- Booking: `70ae6c80-cbb8-586a-9117-3ed1d1971cbc`
- Trip: `34237ad8-95f0-51d0-bdb6-f90f2f366b9e`
- Trip request: `619608c7-21a4-4eae-8499-a8741f8ae646`

Verified:

1. Family sent a message and it persisted under the correct trip.
2. Companion retrieved the family message.
3. Companion reply persisted with the authenticated companion as sender.
4. Family retrieved the reply after browser reload.
5. Parallel sends with the same idempotency key produced one message row and one message ID.
6. Empty content and invalid trip UUIDs were rejected.
7. New-message notifications were persisted for the other participant.
8. Family notification listing, unread filtering, mark-read and reload persistence worked.
9. Incoming messages were marked read using the existing `read_by` array when opened.
10. Unrelated family, unrelated companion and anonymous message access were denied.
11. An unrelated user could not mark another user’s notification as read.
12. Anonymous notification access was denied.
13. Browser page errors: 0.

Independent final local SQL verification:

```text
booking: 70ae6c80-cbb8-586a-9117-3ed1d1971cbc
trip: 34237ad8-95f0-51d0-bdb6-f90f2f366b9e
booking status: confirmed
trip request status: booked
messages: 3
read_by: family message read by family + companion; companion reply read by companion + family
notifications: 3 trip_update rows
family notification: read
companion notifications: unread
```

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; booking/trip communication route compiled |
| Browser/database/persistence suite | `PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone9-local.cjs` — PASS |
| Chat persistence | PASS: family message, companion retrieval/reply, family reload |
| Duplicate/concurrency | PASS: deterministic idempotent parallel send |
| Notifications | PASS: persisted `trip_update`, owner-scoped unread/read state |
| Authorization | PASS: participant access only; unrelated roles and anonymous denied |
| Browser page errors | `0` |
| Browser artifact secret scan | Configured service-role/encryption values absent from all 55 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

## Remaining limitations

- Realtime subscriptions were not added because the application has no existing safe Realtime client architecture; persisted reload-based chat is implemented instead.
- Notification bodies remain generic because the live schema stores the body as encrypted BYTEA; event context is stored in encrypted `data` and decoded server-side.
- Only existing notification type `trip_update` is used for chat events. No unsupported event types or new infrastructure were invented.
- Final Clerk/JWT/RLS production acceptance remains deferred.

The temporary test server is stopped. Synthetic local messages and notifications remain. Changes remain uncommitted. **STOP after Milestone 9.**
