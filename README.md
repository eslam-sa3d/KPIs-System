# pulse — KPI Management & Data Collection System

Enterprise KPI management platform: dynamic RBAC, KPI definition & role mapping,
role-aware analytics dashboards, a schema-driven form builder, and a branded portal.

Built on the **pulse by solutions** brand system (see `packages/theme`).

## Tech stack

**Monorepo tooling**: pnpm workspaces (`pnpm@9.15.0`), Node ≥20

**Backend** — `apps/api` (`@pulse/api`)
- [NestJS 10](https://nestjs.com/) on Express
- [Prisma 6](https://www.prisma.io/) + PostgreSQL 16 (JSONB-driven KPI/form schema)
- Redis (`ioredis`)
- JWT auth (`@nestjs/jwt`), `argon2` password hashing
- `zod` validation
- `exceljs` / `pdfkit` for exports
- Vitest (unit) + Supertest (integration)

**Frontend** — `apps/web` (`@pulse/web`)
- [Next.js 15](https://nextjs.org/) (React 19), static export (`next build` → `out/`, served via `serve`)
- Tailwind CSS 4
- Radix UI (`radix-ui`), `cmdk`, `lucide-react`
- `@dnd-kit` (drag-and-drop form builder)
- Zustand (state), Recharts (charts)
- `mammoth` / `read-excel-file` (doc/Excel import), `qrcode`

**Shared packages**
- `@pulse/contracts` — shared Zod schemas/types between API and web
- `@pulse/theme` — shared design tokens (pulse brand)

**Testing / CI**: Vitest across packages, Playwright for E2E, GitHub Actions for CI

**Hosting**: Render (API, web, Postgres, key-value) with a GitHub Pages static mirror of the frontend — see [Deployments](#deployments).

## Monorepo layout

```
apps/
  api/          NestJS backend (auth, rbac, kpis, forms, dashboards)
  web/          Next.js frontend (landing page + portal)
packages/
  contracts/    Shared API envelope, error codes, pagination, form-schema Zod contracts
  theme/        Centralized brand tokens (CSS variables + TS tokens)
e2e/            Playwright end-to-end suite
docs/           Architecture & engineering standards
.github/        CI/CD workflows
```

## Quickstart

```bash
pnpm install
docker compose up -d postgres redis   # local infra
pnpm db:migrate && pnpm db:seed       # schema + default roles/admin
pnpm dev                              # api on :4000, web on :3000
```

## Deployments

Push to `main` triggers everything — no manual steps:

| What | Where | How |
|---|---|---|
| Full stack (recommended) | **Render** — web `pulse-web-wu0e.onrender.com`, API `pulse-api-k8ga.onrender.com`, plus managed Postgres & key-value | [render.yaml](render.yaml) blueprint, auto-sync on push |
| Frontend mirror | **GitHub Pages** — `eslam-sa3d.github.io/KPIs-System` | [deploy-pages.yml](.github/workflows/deploy-pages.yml) publishes the static export to `gh-pages` |
| Quality gates | **GitHub Actions** — lint → typecheck → unit → integration (live Postgres/Redis) → E2E (Playwright) → audit | [ci.yml](.github/workflows/ci.yml) |

Notes:
- The web app is a static export (`next build` → `out/`); the API is the only server. Set `NEXT_PUBLIC_API_URL` at build time to point a frontend at an API.
- API CORS origins come from the `CORS_ORIGINS` env var (comma-separated).
- The API seeds idempotently on boot (`prisma migrate deploy && pnpm db:seed`); override the default admin with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- Render free-tier: services sleep after 15 min idle (~30–50s cold start); the free Postgres expires 30 days after creation unless upgraded.

## Engineering standards

- **API contract** — every response is wrapped in the `ApiEnvelope` (`packages/contracts/src/envelope.ts`). No exceptions; enforced by a global interceptor + exception filter.
- **Theming** — all colors/typography/spacing come from `packages/theme`. Never hard-code a hex value in app code.
- **Testing** — unit (Vitest) colocated with source, API integration under `apps/api/test`, E2E under `e2e/`.
- **Docs** — start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
