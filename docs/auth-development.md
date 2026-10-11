# Retired development authentication — historical notes

**Do not follow the enable/use instructions below.** As of 2026-10-07, the
application uses native Supabase email/password authentication with persistent
SSR cookies and protected database roles. `/api/dev-auth/session` returns 404
for all implemented methods; development flags cannot enable it. Old fixture
components are unmounted and not part of application authentication.

See [Supabase Auth migration report](SUPABASE_AUTH_MIGRATION_REPORT.md) for the
current architecture, local setup, verified checks and deployment considerations.

## Historical Milestone 1 notes (not current operating instructions)

Milestone 1 includes a development-only auth boundary for deterministic local
fixtures. It is separate from Clerk so the application can later replace the
provider behind `src/lib/auth/types.ts` without carrying development behavior
into production.

## Enable locally

Add the following to `.env.local`:

```bash
TRAVELBUDDY_DEV_AUTH_ENABLED=true
TRAVELBUDDY_DEV_AUTH_SECRET="$(openssl rand -base64 32)"
```

The secret must be at least 32 bytes. Restart `next dev` after changing it.

## Use the fixture identities

The client boundary is `useDevelopmentAuth()` from
`src/lib/auth/development-provider.tsx`. Its `signInAsDevUser('family')` and
`signInAsDevUser('companion')` methods create a server-issued session for the
stable `DEV_FAMILY_USER` or `DEV_COMPANION_USER` identity. The session is an
expiring, HMAC-signed, `HttpOnly`, `SameSite=Strict` cookie. Identity is never
selected from a query parameter.

The current Clerk-backed screens are intentionally not migrated in this
milestone. A later auth integration can implement `AuthProviderContract` and
replace the development boundary at one point instead of spreading fixture
checks through pages.

## Production behavior

The provider is enabled only when `NODE_ENV` is `development` or `test` and
`TRAVELBUDDY_DEV_AUTH_ENABLED=true`. In production the session reader returns
no development identity, and the session route rejects sign-in/sign-out
mutations. Do not set the development flag or secret in a production
environment; Clerk remains the production provider until the future adapter is
implemented.
