import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of truth for process.env — validated once, at import time,
 * so a missing/malformed required var fails fast at boot instead of
 * surfacing as an obscure runtime error deep in a request. Loads apps/api/.env
 * itself (silently a no-op if absent, e.g. in CI/production where real env
 * vars are injected directly) rather than depending on some other import
 * (e.g. @prisma/client) to have done it first.
 *
 * TURNSTILE_SECRET_KEY is deliberately NOT here: TurnstileService re-reads
 * process.env on every call by design ("safe when unconfigured", and its
 * spec toggles the var at runtime between tests), so freezing it at import
 * time would change that behavior.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET must be set — refusing to start without it'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  MAILERSEND_API_KEY: z.string().optional(),
  MAIL_FROM_EMAIL: z.string().default('no-reply@pulse.local'),
  MAIL_FROM_NAME: z.string().default('pulse'),
  REFRESH_COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  WEB_URL: z.string().default('http://localhost:3000'),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return parsed.data;
}

const raw = loadEnv();

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(','),
};
