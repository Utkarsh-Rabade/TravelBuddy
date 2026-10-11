# Milestone 6 — Companion KYC and Verification Lifecycle

**Result: PASSED locally.** Scope stops at KYC submission, private document access and server-controlled verification lifecycle.

## Scope and boundaries

- Used the existing development authentication abstraction and LOCAL Supabase only.
- Local Supabase was verified on loopback port `54321` before testing.
- Clerk, the landing page, migration history and remote Supabase were not changed.
- No public storage URLs were generated and no service-role credential reached the client.
- Existing UI structure was preserved; KYC was added to the companion profile/detail and edit paths, not the profile-creation form.

## Existing storage defect and implementation decision

The audited/local architecture had a legacy client upload component targeting `companion-verifications`, but the live local storage metadata showed:

- no existing `companion-verifications` bucket;
- no storage object policies;
- no protected server upload/download path.

The database audit documented this as a high-severity gap. A migration was not necessary: the implementation adds a server-only bucket initializer that creates/configures `companion-verifications` on first use with:

- `public = false`;
- 10 MiB maximum size;
- `application/pdf`, `image/jpeg`, and `image/png` allowlist.

The application uses the existing server-only privileged Supabase client for storage operations. The bucket is private; download is streamed through an authenticated owner-checked route. No `getPublicUrl()` call exists in the KYC path.

## Implementation

### Server/storage files

- `src/app/api/companion/kyc/route.ts`
  - `POST` accepts a multipart document from the current companion only.
  - validates extension, MIME type and 10 MiB size;
  - writes a unique owner-scoped path: `companion-verifications/<companionId>/<uuid>.<extension>`;
  - inserts the real `public.verifications` row with `background_check_status = 'pending'`;
  - keeps companion status at `pending` and cannot set approval fields;
  - rolls back uploaded objects/rows on later failure.
  - `GET` returns only safe metadata for the current companion.
- `src/app/api/companion/kyc/[id]/route.ts`
  - streams a private object only after companion ownership verification;
  - rejects anonymous, family and foreign-companion access;
  - sends private/no-store download headers.
- `src/actions/companion-verifications.ts`
  - companion-only safe metadata action, owner-scoped by session-derived `user_clerk_id`.
- `src/lib/verification/access.ts`
- `src/lib/verification/metadata.ts`
- `src/lib/verification/storage.ts`
- `src/lib/verification/types.ts`

### Trusted lifecycle workflow

`src/lib/verification/server-workflow.ts` contains the trusted server/admin workflow. It is deliberately server-only and is not imported by companion client code or exposed as a companion action. It uses the actual schema fields:

| Current state | Decision | Verification row | Companion row |
| --- | --- | --- | --- |
| pending | approve | `background_check_status = passed`, `verified_at` set, optional future `expires_at` | `verification_status = verified` |
| pending | reject | `background_check_status = failed`, approval timestamps cleared | `verification_status = rejected` |
| verified | expire | preserves `background_check_status = passed`, sets `expires_at` now/past | `verification_status = expired` |

Transitions are guarded by current state and timestamps. Companions cannot call this workflow, set verification status, change approval timestamps or set expiry. A best-effort rollback protects against a failed two-table transition.

The existing schema separates `verifications.background_check_status` from `companions.verification_status`; the workflow synchronizes both without inventing columns.

### UI

- `src/components/forms/KYCDocumentUpload.tsx`
- `src/app/dashboard/companions/[id]/page.tsx`
- `src/app/dashboard/companions/[id]/edit/page.tsx`

The UI submits multipart data through `/api/companion/kyc`, shows persisted metadata/status after reload, and links only to the protected download endpoint. There is no self-service approve/reject/expire control. Expiry is displayed from the persisted expiry timestamp even though the verification row's background status remains `passed`.

## Matching integration

The existing matching engine was not redesigned. Its verified eligibility rule now respects the lifecycle already implemented in Milestone 5:

- pending companion: excluded;
- rejected companion: excluded;
- expired companion: excluded;
- verified + eligible + available companion: eligible.

The test exercised the real matching algorithm against the local database after each lifecycle transition.

## Verification evidence

### Final end-to-end run

`tests/milestone6-local.cjs` ran with real Chromium at `http://127.0.0.1:3106`, local Supabase storage/database and the actual companion profile. Final verification ID:

`e60c9e52-78a8-4c52-b366-0896c7c80c81`

Verified:

1. Companion opened the own profile and submitted a synthetic PDF through the real multipart API.
2. File persisted in private storage and a `verifications` row persisted with `document_type = kyc` and `background_check_status = pending`.
3. Reload preserved the pending metadata.
4. Protected download returned the PDF bytes only to the owning companion.
5. Family and anonymous metadata/download access returned 403/401.
6. A different companion's metadata list excluded the verification and its protected download returned 404.
7. Pending companion was absent from real matching results.
8. Trusted server workflow approved the submission; companion became `verified`, verification became `passed`, and the companion appeared in matching results.
9. A second submission moved the companion back to pending; matching excluded it.
10. Trusted workflow rejected the second submission; companion became `rejected`, persisted after reload and remained excluded.
11. A third submission was approved, then expired; companion became `expired`, persisted after reload and was excluded from matching.
12. Attempted re-approval of the expired verification was rejected.
13. Browser page errors: 0.

Independent final SQL state:

```text
verification id: e60c9e52-78a8-4c52-b366-0896c7c80c81
companion id: 123c08ea-c54e-43d0-8f4c-e11d9b02b674
document_type: kyc
background_check_status: passed
companion verification_status: expired
bucket public: false
bucket size: 10485760 bytes
object count for owner path: 3 synthetic test objects
```

The final `passed` verification row plus companion `expired` state is intentional: expiration is represented by the companion lifecycle state and `expires_at`, while `background_check_status` remains the historical passed check.

### Commands and results

| Check | Actual result |
| --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` — PASS |
| Production build | `npm run build` — PASS; KYC API routes included |
| Browser/storage/database/lifecycle suite | `PLAYWRIGHT_BROWSERS_PATH=/private/var/folders/9b/_9r15nrx4_3gf1nd8tg9_2vw0000gn/T/opencode/travelbuddy-m1-browsers node tests/milestone6-local.cjs` — PASS |
| Persistence/reload | PASS |
| Authorization/storage access | PASS: owner only; family 403; anonymous 401; foreign companion 404 |
| Matching lifecycle integration | PASS: pending/rejected/expired excluded; verified eligible companion included |
| Browser page errors | `0` |
| Browser artifact secret scan | Configured service-role/encryption values absent from all 54 `.next/static` files; values were not printed |
| Lint | `npm run lint` — BLOCKED before code analysis, exit 2: existing `typescript-eslint does not support TS 7.0` |

## Remaining limitations

- The trusted admin workflow is server-only and has no admin UI or admin AuthRole in the temporary development provider. It is ready for the intended future admin/Clerk workflow; companion-facing code cannot invoke it.
- Storage bucket initialization is application-managed because the audited storage bucket/policies were absent and migration history was not modified.
- Files are persisted as raw private storage objects; malware scanning, KYC provider integration, document encryption-at-rest beyond Supabase Storage, and operational audit logging are not implemented in this milestone.
- Final Clerk/JWT/RLS production acceptance remains deferred.

The temporary test server is stopped. Synthetic local verification rows/objects remain. Changes remain uncommitted. **STOP after Milestone 6.**
