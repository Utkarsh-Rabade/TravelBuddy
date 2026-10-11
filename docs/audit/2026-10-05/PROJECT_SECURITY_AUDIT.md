# TravelBuddy — security and configuration audit

5 October 2026. Threat model: families' private traveler/medical/contact records, companions' KYC and trusted eligibility, trip participant identity, money, precise location and safety incidents. Source weaknesses are **not claimed live exploits**; deployed grants/policies and account configuration remain unverified.

## Highest-impact findings

| Severity | Finding / root cause | Evidence | Required mitigation |
|---|---|---|---|
| CRITICAL | Owners can set their own companion verification_status/rating/trip count on INSERT/UPDATE | RLS:81–86, schema:38–41 | Trusted fields only changed by privileged verified operations; negative owner tests; no blanket RLS disable |
| HIGH | Clerk identities not propagated; legacy auth bypasses intended lifecycle by failure | supabase.ts:6, actions:17 | Native issuer integration + user-token clients + authenticated server actions |
| HIGH | Verified companion policy is full-row public access, not basic profile projection | RLS:87–89 | Explicit minimal public projection/API; protect DOB/identity/calendar; verify actual grants |
| HIGH | Explicit verification pending-only CHECK fails to bind new companion ownership | RLS:112–121 | Bind both current/result identity and immutable approval fields |
| HIGH | trips companion CHECK TRUE + SOS check are not column/ownership/state restrictions | RLS:324–355 | Guarded mutations; immutable booking relation; triggers/column privilege separation where appropriate |
| HIGH | Request can reference another family's traveler UUID | schema:63–64; RLS:152–160 | Composite invariant + owner lookup; negative cross-tenant tests |
| HIGH | Wrong consent/chat/SOS relationship traversal; scalar assumptions | RLS:382,433,505,551 and scalar lookups | Qualified ER joins, complete participant read/write tests and multi-booking fixtures |
| HIGH | No server-confined functioning sensitive encryption | encryption.ts; TravelerForm:73–80 | Validated serialized encrypted payloads, server-only keys, fail closed, rotation/versioning |
| HIGH | Private KYC bucket/policies/validation/approval missing | KYCDocumentUpload; no storage SQL | Owner-scoped private storage, validated MIME/size/content, controlled review access, lifecycle cleanup |
| HIGH | Recursive/disconnected admin policy | RLS:617–634 and top-level role bypasses | One explicit trusted admin source, least privilege and audited provisioning |
| HIGH | Financial update policies allow whole-row changes while status predicate holds | RLS:256–276 | Trusted pricing/payment fields; narrowly scoped cancellation transition |
| HIGH | No operational SOS delivery/escalation/audit despite marketing response-team promise | landing:913–918; no service code | Correct claims immediately after approval; implement and drill safety workflow before promises |
| MEDIUM | Sender/read-state/rating policies imply restrictions that do not exist | RLS:510–529,586–592 | Immutable actors/membership, update field allowlists and bounded windows |
| MEDIUM | No validation/rate-limit/abuse layer on actions/uploads | all actions accept string IDs; upload trusts extension | Runtime schemas, bounded payloads and per-user/IP quotas |

Detailed per-table permissions and implicit WITH CHECK semantics are in the database report. No source SQL uses SECURITY DEFINER or unsafe authorization from user_metadata. No actual CSRF exploit, custom redirect exploit, SQL string injection or dangerouslySetInnerHTML/XSS sink was found in application source. JSX escapes displayed values and Supabase query APIs are used rather than handcrafted SQL. This is not an assurance that external services are securely configured.

## Secret inventory — values intentionally excluded

| Report label | Location | Type | Severity / rotation recommendation |
|---|---|---|---|
| SECRET FOUND | `.env.local:3` | Clerk private key format | HIGH if shared outside trusted developer boundary; rotate if fresh-folder transfer exposed it; validity not tested |
| SECRET FOUND | `.env.local:9` | Supabase service-role JWT-formatted value | HIGH privileged credential; local-target token may be default local material; verify provenance, rotate deployed counterpart if exposed |
| SECRET FOUND | `.env.local:25,28` | Default/placeholder-like encryption/JWT configuration | HIGH if used for real data; replace before real deployment, plan encrypted-data key migration rather than lose records |
| PRIVATE SECRET FILE PRESENT | `supabase/.temp/start-secrets/.../env/docker.env` | Generated runtime secret file | Content deliberately not read; preserve private storage, never copy to committed artifacts |
| DEFAULT CREDENTIALS FOUND | `docker-compose.yml:11–20,28–30` | Database/JWT-style defaults | HIGH if reused outside local sandbox; replace/rotate in deployment, do not expose ports publicly |

Other nonempty Stripe/email/SMS/NextAuth values were not validated and must not be assumed real working credentials. Publishable Clerk and anon Supabase keys are public-key configuration, not private secret exposures by themselves. `.env.local` is ignored; Git history contains no secret file. No hardcoded live private-key/token pattern was found in non-private application/config/docs source. A regex scan is not a certified secret scan; it excludes vendor/generated/private payload content.

No keys were printed in these reports. We did not call APIs with privileged keys. The temp runtime copy retained private env in its protected temporary location, not in audit docs. Screenshots are signed-out views.

## Application-security boundaries

- All actions must authenticate independently; UI role checks cannot authorize an action endpoint.
- Client-provided trip/traveler/companion IDs must be checked under trusted session identity; unguessable UUIDs are not authorization.
- No server-only imports protect encryption/privileged client modules. Future accidental imports are a risk; an unused helper is not proof of present key leakage.
- Error handling logs raw exception objects in many modules. Unknown payloads could later expose PII, document paths or DB errors; use redacted structured events/correlation IDs. No PII log payload was collected during this audit.
- RLS is row-level, not column-level. Policy labels “document upload only”, “mark read”, “location only”, “within window” do not implement those restrictions.
- Service-role bypass is intended for trusted system operations, but must enforce its own authorization, transitions and audits. No such operational writer currently exists.
- Notification title, special instructions, messages, rating comments and incident notes can contain plaintext sensitive data despite selected BYTEA columns. Define classification, retention and minimal displays.
- Historical location is plaintext; no coordinate validation/retention. Consent fields do not gate sharing or deletion. Account/trip/financial cascading deletion requires deliberate policy.
- Vercel headers add nosniff/DENY; deprecated X-XSS-Protection is not XSS defense. No application CSP, referrer/permissions policy, documented CSRF/origin review, abuse limits or observability is present. Review Clerk requirements before enforcing CSP.

## Environment/configuration ledger

Names only. Example = `.env.example`; all listed application example names exist but the file is ignored by `.env.*`. “Unused” refers to current product code, not future intent. Presence of nonempty local values does not establish validity.

| Variable | Purpose / actual use | Boundary | Required now? / documentation |
|---|---|---|---|
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | ClerkProvider/SDK automatic configuration | Public | Required widgets; example exists, local development-key format |
| CLERK_SECRET_KEY | SDK server capabilities | Server-only | Required intended server auth; example exists; no app server Clerk call currently |
| NEXT_PUBLIC_SUPABASE_URL | supabase.ts:3 | Public | Required client initialization; example exists; local endpoint not running |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | supabase.ts:4 | Public legacy anon | Required current client; example exists; not a user session token |
| SUPABASE_URL | supabase.ts:10 privileged helper | Server-only | Unused helper currently; duplicates public URL; optional until system operations |
| SUPABASE_SERVICE_ROLE_KEY | supabase.ts:11 privileged helper | Server-only secret | Unused current operation; never make NEXT_PUBLIC; isolate server module |
| ENCRYPTION_KEY | encryption.ts:7 | Server-only secret | Intended sensitive field encryption; required for real storage but imported from browser code, unavailable there; example default-like value is unsafe for real data |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | Only example/local/workflow | Public | Unused; future checkout only |
| STRIPE_SECRET_KEY | Only example/local/workflow | Server-only secret | Unused; future payment service |
| STRIPE_WEBHOOT_SECRET | Only example/local/workflow | Server-only secret | **Misspelled** throughout; no webhook consumes it; future name should be STRIPE_WEBHOOK_SECRET |
| EMAIL_PROVIDER_KEY / SMS_PROVIDER_KEY | Only example/local | Server-only secrets | Unused; no delivery provider selected in code |
| NEXTAUTH_URL / NEXTAUTH_SECRET | Only example/local | Server config/secret | Unused legacy assumptions; no NextAuth dependency |
| JWT_SECRET | Local only | Server-only secret | No product reference/example; default-like configuration, not active Clerk JWT verifier |
| NODE_ENV | encryption.ts:9 / framework | Runtime | Framework supplied; warn behavior only, not secret |
| CI | playwright.config.ts:26–30 | Build environment | Controls forbidOnly/retries/workers; supplied CI rather than example |
| VERCEL_TOKEN | Workflow preview/production actions | CI secret | Needed only if deploying via workflow; no example/runbook |
| VERCEL_ORG_ID / VERCEL_PROJECT_ID | Workflow actions | CI target identifiers | No verified project linkage; not necessarily secret but protect deployment context |
| GITHUB_TOKEN | Workflow Vercel action | CI token | GitHub runner supplies scoped token; permissions not configured explicitly |
| OPENAI_API_KEY | Supabase Studio env reference | Local tooling secret | Optional Studio AI; not app runtime |
| SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN | Supabase disabled Twilio config | Server/local secret | Not active; no app SMS service |
| SUPABASE_AUTH_EXTERNAL_APPLE_SECRET | Disabled Supabase Apple config | Server/local secret | Not active; not Clerk Google configuration |
| S3_HOST / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY | Supabase experimental OrioleDB env refs | Local tooling/server secrets | Not proven active; optional experiment, not production app requirement |
| POSTGRES_PASSWORD / DATABASE_URL / DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME | Docker compose | Local/server credentials | Draft local stack; no app direct Postgres connection |
| SUPERBASE_SECRET / SUPERBASE_JWT_SECRET | Docker compose | Secret-like, **misspelled** | Unsupported/ambiguous names; no app references; deployment template not trusted |

Potential additions are recommendations, not missing references: approved Clerk redirect/issuer config, publishable Supabase key name for new client, validated server encryption configuration, correct Stripe webhook secret when implementing payments, environment-specific deployment target validation. Do not add Stripe secrets for a nonexistent flow just to satisfy templates.

CI only exposes service env to its E2E step, not the build step. Local app and remote CLI/MCP targets differ. There is no environment validator or documented dev/staging/production separation. Do not reconnect a remote database simply to make local errors disappear.

## Dependency risk evidence

`npm audit` on 5 October reports next 16.3.4 critical GHSA-vcvr-r3jv-pc5j, fixed 16.3.6, plus six high dependency nodes in ESLint/globbing transitive chains (brace-expansion, braces, micromatch, fast-glob, eslint-config-next, @next/eslint-plugin-next). Advisory describes Node `next/og` ImageResponse with untrusted SVG; no corresponding application sink exists here. Classify **critical package advisory / not demonstrated reachable app RCE**, not a proven compromise. Do not downgrade Next to npm's old-major dev-tooling recommendation; inspect safe compatible fixes and commit a reviewed lockfile after approval.

External references checked: Supabase Clerk integration docs; PostgreSQL 17 CREATE POLICY semantics (`https://www.postgresql.org/docs/17/sql-createpolicy.html`); GHSA (`https://github.com/advisories/GHSA-vcvr-r3jv-pc5j`). No cloud resource was modified.

## Security-hardening roadmap

| Stage | Required work / acceptance gate |
|---|---|
| **Before MVP** | Establish committed reproducible baseline (no private material); fix trusted Clerk/token/owner lifecycle; forbid self-verification; qualify relationship policies; server-only fail-closed crypto; correct private KYC storage; tests for other-user IDs, anonymous access, state/field tampering and immutable audit intent. Remove unimplemented safety promises after approval. No real PHI/KYC until boundary tests pass |
| **Before public beta** | Reviewed forward migrations against deployment drift; role/tenant RLS integration matrix including multi-booking; validated uploads and malware/content limits; verified Stripe signatures, event idempotency/reconciliation and refunds; user/IP rate limits, quotas, spam prevention, session-change tests; consent/retention and privacy/legal publication; secret rotation/recovery exercises |
| **Before production** | Separate prod accounts/config/secrets and least-privilege admin roles; MFA for admins; pinned action/dependency provenance; monitored auth/payment/location/SOS failures; durable notification outbox/retries/dead letters; tested backups/restore and migration rollback plan; security headers/CSP validation; incident response/on-call owners; safety operational drills and documented emergency fallback |
| **After launch** | Scheduled dependency/advisor reviews, access recertification, penetration testing, abuse monitoring, retention cleanup evidence, key rotation without data loss, restore drills, audit integrity checks, payment reconciliation and safety incident postmortems |

No proposed control is a reason to replace Clerk or disable RLS. Operational emergency response cannot be outsourced to UI labels, notifications alone or a nominal database table.
