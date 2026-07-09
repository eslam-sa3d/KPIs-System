import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/app-error';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile CAPTCHA check for public form submissions. "Safe when
 * unconfigured": if TURNSTILE_SECRET_KEY isn't set, every check passes with a
 * logged warning rather than locking out every submission — same pattern as
 * this codebase's other optional external integrations.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(requireCaptcha: boolean, token: string | undefined): Promise<void> {
    if (!requireCaptcha) return;
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      this.logger.warn('requireCaptcha is on but TURNSTILE_SECRET_KEY is not configured — skipping verification');
      return;
    }
    if (!token) {
      throw AppError.validation([{ path: 'turnstileToken', message: 'CAPTCHA verification is required' }]);
    }
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const result = (await res.json()) as { success: boolean };
    if (!result.success) {
      throw AppError.validation([{ path: 'turnstileToken', message: 'CAPTCHA verification failed' }]);
    }
  }
}
