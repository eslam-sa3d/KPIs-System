/**
 * Branded HTML email bodies. Deliberately NOT sharing anything with the
 * app's own CSS (no custom properties, no @font-face, no flex/grid) — email
 * clients (Outlook especially) need table-based layout and inline styles,
 * and can't load the app's 'stc forward' webfont, so this hard-codes the
 * pulse brand hexes (packages/theme/src/tokens.css) with a plain sans-serif
 * fallback stack instead.
 */

const BRAND = {
  purple: '#4f008c',
  purpleDark: '#3a1066',
  coral: '#ff375e',
  onyx: '#1d252d',
  silver: '#8e9aa0',
  silverLight: '#dddfe2',
  air: '#ffffff',
  pageWash: '#f6f1fb', // pale tint of --pulse-purple, for the page background behind the card
};

const FONT_STACK = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

/** Wraps body content in the shared card/header/footer chrome every pulse
 *  transactional email uses — logo, pale-purple page wash, white card.
 *
 *  Responsive via two layers, since email clients vary wildly in CSS
 *  support: (1) the outer tables are fluid (`width:480px; max-width:100%`),
 *  which degrades correctly even in clients that ignore <style> entirely —
 *  the card just shrinks to the viewport; (2) a <style> media query tightens
 *  padding/type size under 480px for clients that DO support it (Apple
 *  Mail, Gmail app, Outlook.com — notably not Outlook desktop, which layer
 *  (1) alone still covers safely). */
function emailShell(logoUrl: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>pulse</title>
<style>
  @media only screen and (max-width: 480px) {
    .pulse-card-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .pulse-outer-pad { padding-left: 12px !important; padding-right: 12px !important; padding-top: 28px !important; }
    .pulse-h1 { font-size: 19px !important; line-height: 25px !important; }
    .pulse-logo { width: 132px !important; height: 57px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${BRAND.pageWash}; font-family:${FONT_STACK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.pageWash};">
  <tr>
    <td align="center" class="pulse-outer-pad" style="padding: 40px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px; max-width:100%; background-color:${BRAND.air}; border-radius:16px; overflow:hidden;">
        <tr>
          <td align="center" class="pulse-card-pad" style="padding: 36px 40px 0;">
            <img src="${logoUrl}" width="160" height="69" alt="pulse by solutions" class="pulse-logo" style="display:block; border:0; width:160px; height:69px;" />
          </td>
        </tr>
        <tr>
          <td class="pulse-card-pad" style="padding: 28px 40px 40px;">
            ${bodyHtml}
          </td>
        </tr>
      </table>
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px; max-width:100%;">
        <tr>
          <td align="center" class="pulse-card-pad" style="padding: 24px 40px 0; font-family:${FONT_STACK}; font-size:12px; line-height:18px; color:${BRAND.silver};">
            pulse by solutions
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A pill CTA button — the "bulletproof button" pattern (padded &lt;a&gt;
 *  inside a bgcolor'd table cell) instead of CSS background/border-radius
 *  on the anchor directly, since Outlook's Word rendering engine ignores
 *  those properties on inline elements. */
function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
    <tr>
      <td align="center" bgcolor="${BRAND.purple}" style="border-radius:999px;">
        <a href="${href}" target="_blank" style="display:inline-block; padding:14px 32px; font-family:${FONT_STACK}; font-size:15px; font-weight:bold; color:${BRAND.air}; text-decoration:none; border-radius:999px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

export function resetPasswordEmail(params: {
  displayName: string;
  resetUrl: string;
  logoUrl: string;
  expiresInMinutes: number;
}): string {
  const { displayName, resetUrl, logoUrl, expiresInMinutes } = params;
  const body = `
    <h1 class="pulse-h1" style="margin:0 0 8px; font-family:${FONT_STACK}; font-size:22px; line-height:28px; font-weight:bold; color:${BRAND.onyx};">
      reset your password
    </h1>
    <p style="margin:0; font-family:${FONT_STACK}; font-size:15px; line-height:22px; color:${BRAND.onyx};">
      hi ${displayName}, someone requested a password reset for your pulse account. if this was you, use the
      button below to choose a new one.
    </p>
    ${ctaButton(resetUrl, 'reset password')}
    <p style="margin:0 0 4px; font-family:${FONT_STACK}; font-size:13px; line-height:20px; color:${BRAND.silver};">
      or copy and paste this link:
    </p>
    <p style="margin:0 0 20px; font-family:${FONT_STACK}; font-size:13px; line-height:20px; word-break:break-all;">
      <a href="${resetUrl}" style="color:${BRAND.purple};">${resetUrl}</a>
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 8px; border-top:1px solid ${BRAND.silverLight};">
      <tr>
        <td style="padding-top:20px; font-family:${FONT_STACK}; font-size:12px; line-height:18px; color:${BRAND.silver};">
          this link expires in ${expiresInMinutes} minutes. if you didn't request this, you can safely ignore this
          email — your password won't change.
        </td>
      </tr>
    </table>`;
  return emailShell(logoUrl, body);
}
