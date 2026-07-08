# pulse KPI System — Architecture & System Design

## 1. Tech Stack

| Layer            | Technology                                   | Rationale |
|------------------|----------------------------------------------|-----------|
| Frontend         | **Next.js 15 (React 19, TypeScript)**        | App Router with route-level code splitting (lazy loading by default), server components for fast first paint, first-class SSR for the public landing page (SEO) while the authenticated portal renders as a client app. |
| UI Theming       | **CSS variables + `@pulse/theme` tokens**    | Single source of truth for brand color, typography, spacing, radii. Framework-agnostic — the same tokens feed Tailwind, styled-components, or chart configs. |
| Charts           | **Recharts** (wrapped in `@pulse/ui` chart primitives) | Declarative, themeable via tokens, tree-shakeable. |
| Backend          | **NestJS 10 (TypeScript)**                   | Opinionated modular architecture (modules/providers/guards/interceptors) that maps 1:1 to SOLID; DI container keeps components decoupled and unit-testable. |
| ORM / Database   | **Prisma + PostgreSQL 16**                   | Postgres `JSONB` powers the schema-driven Form Builder and flexible KPI metadata; GIN indexes keep JSONB queries fast; Prisma gives typed queries and migration discipline. |
| Cache / Sessions | **Redis 7**                                  | Permission-set cache (RBAC hot path), refresh-token/session store, rate-limiter counters, dashboard aggregate cache. |
| Auth             | **JWT (15-min access) + rotating refresh tokens (httpOnly, Secure, SameSite=Strict cookies)** | Stateless request auth with revocable sessions; refresh rotation defeats token replay. |
| Validation       | **Zod** (shared via `@pulse/contracts`)      | One schema validates on the client (instant UX feedback) and the server (trust boundary). |
| Testing          | **Vitest** (unit/integration) + **Supertest** (API) + **Playwright** (E2E) | Fast TS-native unit runner; black-box HTTP tests; cross-browser E2E. |
| CI/CD            | **GitHub Actions**                           | Lint → typecheck → unit → integration (Postgres/Redis services) → E2E → build → deploy. |

## 2. High-Level System Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │                  CLIENTS                    │
                        │   Browser (public landing / auth portal)    │
                        └──────────────────────┬──────────────────────┘
                                               │ HTTPS
                        ┌──────────────────────▼──────────────────────┐
                        │            EDGE / CDN (static assets,       │
                        │         brand assets, cached SSR pages)     │
                        └──────────────────────┬──────────────────────┘
              ┌────────────────────────────────┼───────────────────────────────┐
              │ Next.js Frontend (Vercel/Node) │       NestJS API (/api/v1)    │
              │  • Landing page (SSR, public)  │  ┌──────────────────────────┐ │
              │  • Portal shell (lazy routes)  │  │ Global middleware chain: │ │
              │  • ThemeProvider (@pulse/theme)│  │ Helmet → CORS → RateLimit│ │
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
                                     │  • JSONB form schemas│   │  • session store     │
                                     │  • JSONB submissions │   │  • rate-limit buckets│
                                     │  • KPI facts         │   │  • dashboard cache   │
                                     └──────────────────────┘   └──────────────────────┘
```

### Request lifecycle (authenticated)

1. **Edge** serves static/brand assets; API requests pass through.
2. **Rate limiter** (Redis sliding window, per-IP + per-user) rejects abuse with `429` in the standard envelope.
3. **Auth guard** verifies the JWT access token (no DB hit).
4. **RBAC guard** resolves the user's effective permission set — Redis first (`rbac:perms:{userId}`, 5-min TTL, invalidated on any role/permission mutation), Postgres on miss.
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

- Route-level code splitting + `next/dynamic` for chart-heavy widgets (lazy loading).
- Redis caching of permission sets and dashboard aggregates (short TTL + event invalidation).
- Postgres: GIN indexes on JSONB answers, composite indexes on `(kpiId, periodStart)` facts, keyset pagination for large submission tables.
- CDN-cached SSR landing page; brand SVGs inlined or edge-cached.

## 6. Security

- Helmet (CSP, HSTS, nosniff), strict CORS allowlist.
- Rate limiting: global + tighter buckets on `/auth/*`.
- Input validation at the trust boundary (Zod), output encoding by React (XSS), parameterized queries via Prisma (SQLi).
- CSRF: auth cookies are `SameSite=Strict`; mutating endpoints additionally require the `Authorization: Bearer` header (double-submit pattern).
- Passwords: argon2id. Secrets via environment/secret manager, never committed.
- Audit log table records role/permission mutations and data exports.
