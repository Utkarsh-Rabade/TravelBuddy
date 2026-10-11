# Milestone 2 — Elderly Traveler Management

Date: 6 October 2026 (Asia/Calcutta).
Status: requested traveler flow verified against **local** Supabase. No Clerk,
landing-page, migration, RLS-policy or remote database changes.

## Root causes fixed

- Traveler routes still used Supabase Auth and the absent `family_member_id`.
- Client forms tried to encrypt via undefined pgcrypto RPC wrappers and sent
  per-element arrays to scalar `BYTEA` fields; private keys are unavailable to
  those components.
- Retrieval/editing decrypted on the client and could silently discard fields.
- Edit updates filtered only by traveler ID, rather than deriving the current
  family on the server.

## Files

- `src/actions/travelers.ts`: validated create/list/read/update actions; server
  identity → family ownership lookup → family-scoped queries; no browser owner
  IDs accepted. Stable submission UUID prevents duplicate retries via the
  existing primary key. Updates advance `updated_at` explicitly.
- `src/lib/traveler-sensitive-fields.ts`: `server-only` encryption/decryption.
- `src/components/forms/TravelerForm.tsx`: typed ordinary input; no DB or crypto
  imports. Plain inputs go over same-origin server actions, not into local storage.
- `src/app/dashboard/family/travelers/page.tsx`
- `src/app/dashboard/family/travelers/new/page.tsx`
- `src/app/dashboard/family/travelers/[id]/page.tsx`
- `src/app/dashboard/family/travelers/[id]/edit/page.tsx`
- `tests/milestone2-local.cjs`: real browser/actions/local-DB integration suite.
- `tests/traveler-crypto.cjs`: isolated authenticated-encryption regression checks.

Only functional route wiring/error/role handling changed; no visual-polish phase.

## Sensitive data contract

Existing columns remain unchanged: `medical_conditions BYTEA`,
`accessibility_needs BYTEA`, `emergency_contacts BYTEA`. Each is one serialized
payload protected by AES-256-GCM with a fresh random nonce, stored as a versioned
hex BYTEA envelope. The server reads `ENCRYPTION_KEY` (minimum 32 UTF-8 bytes;
use a high-entropy generated secret), hashes it to the AES key, and never returns
it or raw ciphertext in the DTO. Only an owning-family read decrypts the fields.
An absent key, wrong key, corrupt envelope or incompatible non-null legacy value
fails; it is not silently presented as an empty medical history.

The active schema enables pgcrypto, but no supported public RPC wrapper for the
old helpers exists. Server-side AES avoids adding a crypto SQL API or changing
migration history. This is **not pgcrypto PGP ciphertext**. Keep the current key
when reopening these records. Changing/removing it requires a controlled
decrypt/re-encrypt procedure with the old key; do not overwrite unreadable records.
Key rotation/version selection and importing old PGP records remain future work.

## Actual verification

Endpoint checks: both public and server app configuration resolve to loopback
port **54321**. SQL used `docker exec supabase_db_TravelBuddy psql` against the
running local Postgres container only. No remote MCP database query/write used.

Final browser suite used Chromium and `http://127.0.0.1:3102`, a generated
ephemeral development-session secret and the existing encryption/DB configuration.
Only synthetic records were entered.

| Check | Result |
|---|---|
| Family dashboard → Add Traveler → save → detail | PASS |
| Medical/accessibility/contact encrypted round-trip | PASS |
| Reload original detail | PASS |
| Edit name and medical value → updated detail | PASS |
| Reload edited detail and list retrieval | PASS |
| SQL relationship to `dev-family-user` | PASS |
| Three non-null encrypted BYTEA fields; synthetic plaintext absent | PASS |
| Explicit updated timestamp | PASS |
| Replay same creation submission | PASS; same traveler ID returned |
| Invalid name/date/UUID/update | Rejected by server |
| Other family's fixture traveler read/update | NOT_FOUND; unchanged in SQL |
| Companion direct create/read/update server-action requests | FORBIDDEN |
| Companion new/list/detail/edit pages | Denied; sensitive values not displayed |
| Anonymous direct create/read | UNAUTHENTICATED |
| Browser page errors | 0 |
| Cipher random nonce, round-trip, tampering/wrong/missing key | PASS |
| Browser production-bundle exact secret-value scan | No encryption or service-role value found |

Final integration traveler: `6ceca4ba-f1a6-4f44-8f1f-6d44afae20fd`.
The suite uses unique synthetic names. An earlier repeat run hit an ambiguous
list heading because two completed fixtures shared a name; that was a test
selector issue, not a persistence failure. Unique per-run names fixed it and
the full final suite passed. Synthetic records/foreign-family fixtures remain
locally for inspection; no cleanup/reset/deletion was performed.

Commands actually run:

```sh
./node_modules/.bin/tsc --noEmit --incremental false
npm run build
npm run lint
node tests/traveler-crypto.cjs
PLAYWRIGHT_BROWSERS_PATH=<isolated-browser-directory> node tests/milestone2-local.cjs
```

TypeScript: PASS. Production build: PASS. Lint: BLOCKED before code evaluation
by the existing TypeScript 7 / typescript-eslint incompatibility (exit 2); no
dependency upgrade or disabled lint rule was used to hide that failure.

## Limits and next boundary

Authorization proved here is the temporary development application's role and
ownership enforcement through a server-only privileged DB client. **This is not
Clerk JWT/RLS verification or a production-readiness claim.** Dev identities are
TEXT owners, not real Clerk accounts. Later replace the centralized auth/data
provider with validated Clerk sessions/user-token RLS access; retain server
ownership filters and the same DTO/codec. Development-created rows must stay in
the development DB unless explicitly mapped/imported with reviewed consent.

Real sensitive data must not be used in this development setup: Next's dev
action diagnostics can log inputs. The audit still records unrelated legacy
crypto/query paths outside traveler management; those were not widened or fixed
as part of this milestone. Trip requests/matching/later features are not verified.

Milestone 2 complete within the requested local development scope. Test server
stopped. Stop here; no later milestone started.
