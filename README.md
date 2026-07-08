# pulse — KPI Management & Data Collection System

Enterprise KPI management platform: dynamic RBAC, KPI definition & role mapping,
role-aware analytics dashboards, a schema-driven form builder, and a branded portal.

Built on the **pulse by solutions** brand system (see `packages/theme`).

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

## Engineering standards

- **API contract** — every response is wrapped in the `ApiEnvelope` (`packages/contracts/src/envelope.ts`). No exceptions; enforced by a global interceptor + exception filter.
- **Theming** — all colors/typography/spacing come from `packages/theme`. Never hard-code a hex value in app code.
- **Testing** — unit (Vitest) colocated with source, API integration under `apps/api/test`, E2E under `e2e/`.
- **Docs** — start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
