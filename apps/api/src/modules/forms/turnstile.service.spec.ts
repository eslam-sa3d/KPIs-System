import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = originalSecret;
    global.fetch = originalFetch;
  });

  it('no-ops when requireCaptcha is off, regardless of configuration', async () => {
    const service = new TurnstileService();
    await expect(service.verify(false, undefined)).resolves.toBeUndefined();
  });

  it('skips verification (and does not throw) when unconfigured', async () => {
    const service = new TurnstileService();
    await expect(service.verify(true, undefined)).resolves.toBeUndefined();
  });

  it('rejects a missing token once a secret is configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const service = new TurnstileService();
    await expect(service.verify(true, undefined)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts a token that Cloudflare confirms as valid', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    global.fetch = vi.fn(async () => ({ json: async () => ({ success: true }) })) as never;
    const service = new TurnstileService();
    await expect(service.verify(true, 'good-token')).resolves.toBeUndefined();
  });

  it('rejects a token that Cloudflare confirms as invalid', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    global.fetch = vi.fn(async () => ({ json: async () => ({ success: false }) })) as never;
    const service = new TurnstileService();
    await expect(service.verify(true, 'bad-token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
