import { Injectable, Logger } from '@nestjs/common';

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email';

/**
 * Transactional email via MailerSend's HTTP API — no SDK, just fetch, matching
 * this codebase's other thin external-API wrappers (see TurnstileService).
 * "Safe when unconfigured": if MAILERSEND_API_KEY isn't set, the email is
 * logged instead of sent rather than throwing — local dev and CI never need
 * real credentials, and a password-reset flow that would otherwise 500
 * without them degrades to "check the server log for the link" instead.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async send(to: string, subject: string, html: string): Promise<void> {
    const apiKey = process.env.MAILERSEND_API_KEY;
    const fromEmail = process.env.MAIL_FROM_EMAIL ?? 'no-reply@pulse.local';
    const fromName = process.env.MAIL_FROM_NAME ?? 'pulse';

    if (!apiKey) {
      this.logger.warn(`MAILERSEND_API_KEY is not configured — logging email instead of sending.\nTo: ${to}\nSubject: ${subject}\n${html}`);
      return;
    }

    const res = await fetch(MAILERSEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email: to }],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`MailerSend send failed (${res.status}): ${body}`);
      // A failed reset email shouldn't surface as a 500 to the caller — the
      // forgot-password endpoint always returns success regardless (no
      // enumeration), so this is a log-and-move-on, not a thrown error.
    }
  }
}
