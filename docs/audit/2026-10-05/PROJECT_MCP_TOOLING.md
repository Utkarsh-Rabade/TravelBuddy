# TravelBuddy — MCP, plugins and audit tooling

5 October 2026. **Configured ≠ connected ≠ authenticated ≠ authorized.** No server configuration, cloud account, local application permission or OAuth identity was changed by this audit.

## Available and configured inventory

| Tool/integration | Present state | TravelBuddy use / access | Audit action / safe alternative |
|---|---|---|---|
| Supabase MCP | Workspace `.mcp.json`: HTTP mcp.supabase.com/mcp, project_ref plus docs/account/database/debugging/development/functions/branching; no read_only=true | Highly useful for columns/constraints/grants/pg_policies/functions/migration history/buckets/diagnostic EXPLAIN. Needs approved project metadata access, read-only DB role and constrained features | **Not exposed as a callable integration here**; no remote query. Read active/archive SQL and config; obtain read-only schema export or connect approved service |
| Clerk MCP | Workspace HTTP mcp.clerk.com/mcp; local Claude config lists enabled server | Useful for instance config/redirect/third-party integration and test-role metadata. Minimum config reads; avoid listing real users/PII without need | **Not exposed here**; public widgets + source/official docs. Synthetic test accounts and read-only instance configuration later |
| GitHub MCP | Workspace HTTP api.github.com/mcp descriptor; local selected-server name | Useful after repository exists remotely: commit/PR/check/branch/issues read. No local remote is configured | **No active callable GitHub integration**; local git log/status/diff sufficient baseline; don't invent remote history |
| Built-in browser | browser tools available; no tab initially; open localhost timed out, subsequent tab list empty | Local signed-out UI observation, controlled navigation; auth remains user handoff | Failed browser opening not claimed success; no browser settings/permissions altered |
| Project Playwright | @playwright/test1.63.0 + config + tests; expected Chromium initially missing | Read-only synthetic QA using new browser context, not user profile. Screenshots/DOM/network summaries | Isolated headless Chromium download (~94MiB + FFmpeg) under approved temp directory; existing tests and audit-only probes run; no global browser choice change |
| Stripe MCP | No callable integration or local descriptor; Stripe runtime absent | Future sandbox webhook/event/reconciliation reads; never charges/refunds during audit | **MISSING INTEGRATION** and implementation. Schema/env inspection only; no need connect payment service before approved payment scope |
| Vercel MCP | No callable integration; vercel.json/workflow only | Useful read-only deployment/target/build logs and environment **names**, not secret values | **MISSING INTEGRATION**; workflow review only; actual deployment state unverified |
| Sentry/observability | No dependency/config/callable integration | Useful later for redacted error traces/latency | **MISSING implementation/integration**; local console errors and static logging review |
| Filesystem/shell/git | Available | Source/config names, dependency lock/versions, local checks | Used read-only except additive reports/evidence and isolated QA fixtures; no git write or DB command |
| Documentation/web research | webfetch/context7 available; Supabase/Clerk/Next skill packs | Official API/semantics/advisory verification, no private source upload | Used Supabase Clerk/changelog, Context7 Clerk metadata/session-token docs, PostgreSQL RLS docs, GHSA, installed Next docs |
| Supabase CLI / Docker | CLI2.116.0 installed; config; Docker executable but daemon unreachable | Could support isolated schema tests once local environment approved | No start/reset/push/link/deploy; no database modified |
| Local extensions | extension.actions returns Google Workspace, image generation and uploads actions | Not required for TravelBuddy auth/database/payment audit | Not invoked; don't treat unrelated Gmail/Drive actions as relevant connected Supabase tools |

OmniRush Cloud is not ready for desired agent integrations in this workspace. Safe setup path: sign in to OmniRush and connect approved services in **Settings → Connect**; inspect inventory under **Settings → Library**, and use **Settings → Debug** in developer mode to repair/test agent access if necessary. Remote MCP descriptors in another client do not automatically authorize this conversation.

## Configuration safety

- Local `.claude/settings.local.json` lists supabase/clerk/github and 30 permission entries. Only categories/counts were reported; private command payloads were not copied into docs.
- No application-local OpenCode plugin/config or custom runtime plugin implementation exists. `.agents/skills` has24 instruction packs, including Supabase/Clerk/Context7/setup-Serena. Instructions do not establish a running Serena or MCP tool.
- Supabase workspace MCP exposes broad mutable database/functions/branching capabilities and lacks read-only mode. Do not automatically run migrations/SQL merely because a tool is registered.
- `project_ref` scoping disables account tools server-side even if account appears in requested features (external Supabase docs); this is not assurance of read-only permissions.
- Application Supabase endpoint is local, while CLI/MCP are remote-linked targets and do not agree with app. Retain target differences until owner confirms environment strategy. Earlier Antigravity configuration edit was undone before this audit; it was not changed again.

## Recommended safe capability profile

For a future continuation, explicitly choose the intended development project. Grant only metadata/read-only diagnostics needed: schemas/columns/constraints/indexes/RLS/grants/functions/migration history/bucket metadata and read-only plans, not user rows or KYC file downloads. Use Supabase `read_only=true`, limit features, keep tool approval enabled, and do not use a service-role workaround.

Clerk reads should be restricted to development instance configuration and synthetic account metadata. GitHub/Vercel reads require exact repository/deployment identity. Stripe only sandbox reads after payment code exists. Production incident data needs separately justified, minimal redacted access.

## Missing integration ledger

| Missing | Why it helps / absent capability | Safe alternative now |
|---|---|---|
| Live Supabase metadata | Verify deployed schema/policies/grants/issuer integration rather than inferred SQL | Read-only sanitized metadata export; active/archive source review |
| Clerk config/test session | Verify redirect, JWT/issuer/native integration and role lifecycle | Public widget inspection + official docs; user-mediated synthetic staging sign-in later |
| Remote GitHub context | Establish actual PR/history/source baseline | Local Git only; no remote exists |
| Production Vercel state | Verify environment/build/domain/webhook targets | Review vercel.json/workflow; mark live state NOT VERIFIED |
| Operational monitoring | Detect real retry/backlog/SOS/payment failures | Local error summaries; define instrumentation and response gates |

The audit does not claim that any integration was connected, authenticated or production-safe. A read-only SQL endpoint can still expose sensitive data; minimize query scope and never export private payloads into versioned reports.
