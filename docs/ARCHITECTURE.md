# pulse KPI System — Architecture & System Design

## 1. Tech Stack

| Layer            | Technology                                   | Rationale |
|------------------|----------------------------------------------|-----------|
| Frontend         | **Next.js 15 (React 19, TypeScript), static export** | App Router, but built with `output: 'export'` — every route is pre-rendered to static HTML/JS at build time and served with no Node server at runtime (deploys to GitHub Pages or Render's static hosting). There is no per-request SSR; the portal is a client-rendered app that fetches from the API after load. |
| UI Theming       | **CSS variables + `@pulse/theme` tokens**    | Single source of truth for brand color, typography, spacing, radii. Framework-agnostic — the same tokens feed Tailwind and chart configs. Applied via a `data-theme` attribute toggle on `<html>`, not a React context provider. |
| Charts           | **Recharts**, imported directly              | Declarative, themeable via tokens, code-split with `next/dynamic` where it matters (the dashboard). |
| Backend          | **NestJS 10 (TypeScript)**                   | Opinionated modular architecture (modules/providers/guards/interceptors) that maps 1:1 to SOLID; DI container keeps components decoupled and unit-testable. |
| ORM / Database   | **Prisma + PostgreSQL 16**                   | Postgres `JSONB` powers the schema-driven Form Builder and flexible KPI metadata; GIN indexes keep JSONB queries fast; Prisma gives typed queries and migration discipline. |
| Cache            | **Redis 7**                                  | RBAC permission-set cache (the hot path on nearly every authenticated request) and rate-limiter counters. Sessions and refresh tokens are Postgres-backed, not Redis — see `Session`/`PasswordResetToken` in the Prisma schema. |
| Auth             | **JWT (15-min access) + rotating refresh tokens (httpOnly, Secure cookie)** | Stateless request auth with revocable, DB-backed sessions; refresh rotation with reuse-as-theft detection defeats token replay. Cookie `SameSite` is deployment-dependent (`strict` by default, `none` when web and API are on separate sites, as they are on Render) — see `REFRESH_COOKIE_SAMESITE`. |
| Validation       | **Zod** (shared via `@pulse/contracts`)      | One schema validates on the client (instant UX feedback) and the server (trust boundary). Covers request/input shapes; response DTOs are not yet modeled in contracts (see Known Gaps). |
| Testing          | **Vitest** (unit/integration) + **Supertest** (API) + **Playwright** (E2E) | Fast TS-native unit runner; black-box HTTP tests; cross-browser E2E. |
| CI/CD            | **GitHub Actions → Render**                  | Lint → typecheck → unit → integration (live Postgres/Redis service containers) → E2E → security audit → deploy. The deploy stage only runs on `main` after every prior stage passes, and triggers Render via deploy hooks — Render's own auto-deploy-on-push must stay disabled for this to be the only path to production (see `ci.yml`). |

## 2. High-Level System Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │                  CLIENTS                    │
                        │   Browser (public landing / auth portal)    │
                        └──────────────────────┬──────────────────────┘
                                               │ HTTPS
                        ┌──────────────────────▼──────────────────────┐
                        │     STATIC HOST (GitHub Pages / Render)     │
                        │   pre-rendered HTML/JS, no server at runtime│
                        └──────────────────────┬──────────────────────┘
              ┌────────────────────────────────┼───────────────────────────────┐
              │  Next.js app, client-rendered  │       NestJS API (/api/v1)    │
              │  • Portal shell (client routes)│  ┌──────────────────────────┐ │
              │  • data-theme attribute toggle │  │ Global middleware chain: │ │
              │    (@pulse/theme tokens)       │  │ Helmet → CORS → RateLimit│ │
              │  • Zod client-side validation  │  │ → Auth Guard → RBAC Guard│ │
              └───────────────┬────────────────┘  │ → Zod ValidationPipe     │ │
                              │ JSON (ApiEnvelope)│ → Envelope Interceptor   │ │
                              └───────────────────►──────────────────────────┘ │
                                                 │   Feature Modules:          │
                                                 │   auth │ rbac │ kpis │      │
                                                 │   forms │ dashboards │ users│
                                                 └──────┬──────────────┬───────┘
                                                        │              │
                                     ┌──────────────────▼───┐   ┌──────▼───────────────┐
                                     │  PostgreSQL 16       │   │  Redis 7             │
                                     │  • relational core   │   │  • permission cache  │
                                     │  • JSONB form schemas│   │  • rate-limit buckets│
                                     │  • JSONB submissions │   │                      │
                                     │  • KPI facts         │   │                      │
                                     │  • sessions & reset  │   │                      │
                                     │    tokens            │   │                      │
                                     └──────────────────────┘   └──────────────────────┘
```

### Request lifecycle (authenticated)

1. **Static host** serves the pre-built frontend bundle directly — there's no edge compute or per-request rendering in this diagram, just static file serving. The browser then talks to the API directly over `fetch`.
2. **Rate limiter** (`@nestjs/throttler`, Redis-backed storage, per-IP + per-user) rejects abuse with `429` in the standard envelope. Tighter buckets apply to `/auth/*`.
3. **Auth guard** verifies the JWT access token (no DB hit).
4. **RBAC guard** resolves the user's effective permission set — Redis first (`rbac:perms:{userId}`, 5-min TTL, invalidated on any role/permission mutation), Postgres on miss and on Redis unavailability.
5. **Zod validation pipe** parses the request body against the shared contract schema; failures return `422 VALIDATION_ERROR` with field-level details.
6. **Service layer** executes business logic; repositories own all Prisma access.
7. **Envelope interceptor** wraps every success in the standard `ApiEnvelope`; the **global exception filter** does the same for errors — no route can leak a non-standard payload.

## 3. Module Boundaries (SOLID / decoupling)

Each NestJS module owns one bounded context and exposes only its service interface:

- `auth` — credentials, token issuance/rotation, session revocation. Knows nothing about KPIs.
- `rbac` — roles, permissions, user↔role assignment, permission resolution. Other modules depend on the `PermissionsGuard` + `@RequirePermissions()` decorator only (Dependency Inversion — they depend on the contract, not the resolver).
- `kpis` — KPI definitions, role/department/stream mappings, KPI fact ingestion.
- `forms` — form schemas (versioned), submission engine, aggregation/export.
- `dashboards` — read-side aggregation, scoped by the caller's resolved permissions.
- `users`, `departments` — directory data.

Cross-cutting concerns (envelope, errors, pagination, validation) live once in `common/` and `@pulse/contracts` (DRY).

## 4. Key Design Decisions

### Dynamic RBAC (permissions, not enums)
Permissions are **rows, not code**: `resource` × `action` (`read | write | execute | manage`). Admins compose custom roles from permission rows at runtime; code only ever asserts `kpi:write`-style strings via the guard. Adding a new role requires zero deployments.

### Schema-driven Form Builder
A form is a **versioned JSONB document** (field types, labels, validation rules, conditional visibility). Submissions store `{ formVersionId, answers: JSONB }` so historical submissions always validate against the schema they were created with. The server rebuilds a Zod validator from the stored schema on every submission — client input is never trusted.

### Role-scoped dashboards
Dashboards never receive raw "who am I" filters from the client. The API derives scope (departments, streams, own-vs-all) from the resolved permission set server-side, so widening access is impossible from the browser.

## 5. Performance

- Route-level code splitting via Next's App Router; `next/dynamic` for chart-heavy widgets specifically (Recharts is otherwise a meaningful bundle-size cost).
- Redis caches the RBAC permission set only (short TTL + event invalidation on any role/permission mutation). Dashboard/report aggregation is not cached — it recomputes from Postgres on every request, pushed into `GROUP BY` queries rather than loaded into application memory (see `getTeamOverview`, `SubmissionsService.summary`).
- Postgres: GIN index on JSONB submission answers, standard FK indexes throughout. List/table endpoints use offset pagination (`page`/`pageSize`), not keyset — fine at current volumes, worth revisiting if any single form's submission count grows into the tens of thousands.
- The frontend ships as a static bundle (see §1) — there's no SSR page to CDN-cache; "performance" here means bundle size and client-side render cost, not server response time.

## 6. Security

- Helmet (CSP, HSTS, nosniff), strict CORS allowlist (`CORS_ORIGINS`, credentialed).
- Rate limiting: global default (120 req/min) + tighter buckets on `/auth/*` (10/min login, 5/min forgot-password), backed by Redis so limits hold across multiple API instances.
- Input validation at the trust boundary (Zod), output encoding by React (XSS), parameterized queries via Prisma everywhere except the deliberate GIN-index migration DDL (SQLi surface: none found).
- CSRF: the refresh-token cookie's `SameSite` is deployment-dependent — `strict` when web and API share a site, `none` when they're on separate origins (as on Render, where `REFRESH_COOKIE_SAMESITE=none` is required for the cookie to survive at all). The actual CSRF mitigation is that every mutating request must carry a short-lived `Authorization: Bearer` access token the browser cannot be tricked into attaching via a cross-site form submission — this holds regardless of the cookie's `SameSite` value.
- Passwords: argon2id. First-admin credentials are never allowed to default to a known value in production — the seed script fails closed instead (see `apps/api/prisma/seed.ts`).
- Audit log table records role/permission mutations and data exports.

## 7. Known Gaps

Kept here deliberately rather than only in a one-off review, so drift is visible in-repo:

- API response shapes are not yet modeled in `@pulse/contracts` — only request/input schemas are shared. The frontend hand-declares response types per page today; `FormFieldSummary` is the one place this is done the right way and is the template to follow when this gets fixed properly.
- File uploads are stored as Postgres blobs, not object storage — a deliberate scale tradeoff (see the comment on `FileUpload` in `schema.prisma`), fine today, worth re-litigating before either upload volume or traffic grows meaningfully.
- Passwords: argon2id. Secrets via environment/secret manager, never committed.
- Audit log table records role/permission mutations and data exports.
