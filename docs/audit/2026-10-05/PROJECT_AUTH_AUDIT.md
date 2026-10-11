# TravelBuddy — authentication and identity audit

5 October 2026. Clerk is the intended identity provider. Keep it. Findings distinguish repository integration from Clerk-hosted configuration, which was not inspected.

## Actual identity architecture

| Layer | Repository evidence | Assessment |
|---|---|---|
| Provider | `src/app/layout.tsx:4,19` ClerkProvider | Present; runtime widgets load with development-mode instance |
| Sign-in/up | `auth/sign-in` SignIn / `auth/sign-up` SignUp | Prebuilt current Clerk widgets; no custom flow/password handling |
| Google | Runtime Continue with Google on both widgets | Entry point verified; OAuth completion NOT TESTED |
| Client identity | useUser in landing/roles/some dashboards | Inconsistent conversion; no shared identity/profile resolver |
| Server identity | All 3 actions use supabase.auth.getUser | No Clerk auth()/currentUser()/protect() or middleware/proxy in app |
| Database token | `src/lib/supabase.ts:6` anonymous createClient | No accessToken callback/getToken/Authorization injection |
| Data ownership | current_clerk_id = JWT sub; Clerk IDs TEXT in active SQL | Correct identity *intent*, no actual trusted token propagation |
| Supabase Auth | getUser used in 7 page files + actions; local auth enabled | Second incompatible active assumption, not a complete alternative login UI |
| Admin | JWT role=admin vs admin_roles super_admin/moderator/support | Disconnected trust sources; no app resolver/console |

There is no Clerk user mirror, webhook, invitation/linking process, account-deletion handler or profile provisioning job. No direct custom JWT verification is present. No auth token was printed or sent to a new integration during the audit.

## New-user lifecycle trace

1. Public landing CTAs link `/auth/sign-up` (RUNTIME correct URL).
2. Clerk widget accepts Google/email/password input. Only rendering verified; no account created.
3. No local SignUp redirect props, environment redirect names or proxy enforce onboarding. Hosted Clerk settings may affect landing but are unverified.
4. Landing detects logged-in user and reads `unsafeMetadata.role`, redirecting to family or companion, otherwise `/select-role`.
5. Select-role reads `publicMetadata.role` but writes **unsafeMetadata** (`select-role/page.tsx:14,31–35`). Existing chosen roles are not consistently detected. This is not an SDK error: current frontend updateMetadata legitimately writes unsafeMetadata only.
6. Family selection points at a dashboard with no automatic profile create. Family create uses correct Clerk ID but client lacks token, so source RLS cannot recognize owner. Family editing/traveler flows still require Supabase user/old columns.
7. Companion selection points at `/dashboard/companions`, which returns **404**. Creation exists at `/dashboard/companions/create` but no dashboard resolves new vs existing profile.

Verdict: account-entry UI works; **onboarding through a usable dashboard is broken/unverified**, not complete.

## Existing-user lifecycle trace

1. `/auth/sign-in` widget renders; full login/session persistence not tested.
2. On return to landing, client redirects during render before its later useState/useEffect hooks. Transition from signed-out/loading to signed-in can change hook count; RUNTIME signed-in fixture unavailable.
3. Roles are mutable frontend preferences in unsafeMetadata, inconsistently read from publicMetadata on select-role. There is no trusted server role lifecycle or restrictions on profile role changes.
4. Family users encounter missing token bridge and inconsistent legacy queries. Signed-out family/traveler dashboards never clear loading after `if (!clerkId) return`.
5. Companion destination absent; no user-id→profile-id resolver.

No persistent login tests, refresh behavior, account switching or signed-out redirect tests exist. Dependencies in many effects omit user ID; identity changes can leave stale data or fail to refetch. Current anonymous client usually denies access, but a future bridge must explicitly clear state on account changes.

## Legacy assumption inventory

| Location | Remaining assumption |
|---|---|
| `actions/match-companions.ts:17,103,174` | Supabase user exists in a server singleton; no request cookies or Clerk auth |
| Same actions:28,43,114,129,186,207 | families.family_member_id (absent canonical SQL) |
| `dashboard/family/edit:28–34` | Supabase Auth UUID and legacy family filter |
| `family/travelers/page:43` | Clerk string compared against legacy family_member_id |
| `family/travelers/new:16–22`, detail:26–33, edit:27–33 | Legacy Supabase user + old family identity |
| `family/trip-requests/page:36–42`, new:26–32,57–63 | Legacy Auth/field queries |
| `family/trip-requests/[id]/edit:72,96`, matches:61 | Clerk user but old family field |
| `companions/create:58–65` | Comment says Clerk, actual getUser from Supabase; UUID assigned to Clerk ID |
| Four archived migrations | auth.users mirror, auth.uid(), user_id/traveler_user_id/family_member_id UUIDs |
| `.env.example` / workflow | NEXTAUTH_URL/SECRET despite no NextAuth package or code |

Repository-wide source searches found no active auth.uid() SQL in canonical migrations, no recipients identity column in messaging, no Clerk getToken usage, no server auth(), no user sync and no current admin-role implementation. Tool-skill templates may contain example auth() functions; they are not product routes.

## Security and trust

- `publicMetadata` is server writable; `unsafeMetadata` is frontend writable. Unsafe role is acceptable as a nonprivileged onboarding preference only, **never authority for admin, KYC or financial privileges**.
- RLS top-level `role` is also the PostgREST database role. Normal Clerk/Supabase integration uses `authenticated`, so `role=admin` policies are not a working application-admin mapping. No evidence shows current users can forge signed admin claims; do not claim that exploit.
- current_clerk_id() reads claims, not issuer/signature/expiry. Supabase third-party integration must perform verification; disabled in local config. Remote integration unknown.
- Service role helper is uncalled. It is in a client-imported module without server-only boundary; **no emitted frontend secret exposure was established**, because server-only env variables are not automatically public. Move privileged construction to isolated server-only module before actual use.
- No guard stops signed-out users reaching role/form screens. This is a UX/auth boundary gap, not proof RLS data is public.

## Recommended primary resolution (future only)

Keep Clerk as sole application identity; use native Clerk third-party Supabase integration with request/session-token accessToken callbacks, not a new shared JWT-secret template. Protect server operations with await auth(), derive owner IDs from session, validate IDs/roles and keep data access under user RLS where possible. Resolve role consistently using server-controlled profile/onboarding metadata; never let role preference confer privileged authority. Add profile resolver/dashboard entry and sign-out/session-change handling.

External verification: Supabase `https://supabase.com/docs/guides/auth/third-party/clerk.md` and Clerk integration docs retrieved through Context7 confirm native session-token integration and frontend unsafeMetadata-only writes. JWT-template integration is deprecated; these external docs are guidance, not evidence it is configured here.
