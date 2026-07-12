/**
 * Generates packages/theme/src/m3-scheme.css from the pulse brand seed colors
 * using Google's Material Color Utilities (the real M3 HCT/tonal-palette
 * algorithm, not a hand-approximation). Run via `pnpm generate:m3` whenever a
 * seed color changes — the output is committed, not built at runtime.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  Blend,
  Hct,
  SchemeFidelity,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '../src/m3-scheme.css');

// Brand seeds — see packages/theme/src/tokens.css for the raw --pulse-* values.
const PURPLE_HEX = '#4f008c'; // primary — drives secondary/neutral hues too
const CORAL_HEX = '#ff375e'; // promoted to the tertiary role (pulse's actual 2nd accent)
const MOONLIGHT_HEX = '#a54ee1'; // kept as one additional named custom role

const purpleArgb = argbFromHex(PURPLE_HEX);
const purpleHct = Hct.fromInt(purpleArgb);

// Neutral/surface/secondary/error roles come from SchemeFidelity (proper M3
// algorithm, verified to look right against a checkpoint screenshot) — only
// primary/tertiary are hand-assigned below, because Fidelity's own contrast-
// driven "primary" landed far darker (~tone 12) than the actual brand purple,
// and its auto-derived "tertiary" invents an unrelated brown/orange hue when
// the brand already has a deliberate second accent (coral) to use instead.
const lightFidelity = new SchemeFidelity(purpleHct, false, 0);
const darkFidelity = new SchemeFidelity(purpleHct, true, 0);

const NEUTRAL_ROLES = {
  secondary: 'secondary',
  'on-secondary': 'onSecondary',
  'secondary-container': 'secondaryContainer',
  'on-secondary-container': 'onSecondaryContainer',
  'secondary-fixed': 'secondaryFixed',
  'secondary-fixed-dim': 'secondaryFixedDim',
  'on-secondary-fixed': 'onSecondaryFixed',
  'on-secondary-fixed-variant': 'onSecondaryFixedVariant',
  error: 'error',
  'on-error': 'onError',
  'error-container': 'errorContainer',
  'on-error-container': 'onErrorContainer',
  surface: 'surface',
  'surface-dim': 'surfaceDim',
  'surface-bright': 'surfaceBright',
  'surface-container-lowest': 'surfaceContainerLowest',
  'surface-container-low': 'surfaceContainerLow',
  'surface-container': 'surfaceContainer',
  'surface-container-high': 'surfaceContainerHigh',
  'surface-container-highest': 'surfaceContainerHighest',
  'on-surface': 'onSurface',
  'surface-variant': 'surfaceVariant',
  'on-surface-variant': 'onSurfaceVariant',
  outline: 'outline',
  'outline-variant': 'outlineVariant',
  shadow: 'shadow',
  scrim: 'scrim',
  'surface-tint': 'surfaceTint',
  'inverse-surface': 'inverseSurface',
  'inverse-on-surface': 'inverseOnSurface',
  'inverse-primary': 'inversePrimary',
  // legacy aliases some CSS/design tooling still expects
  background: 'surface',
  'on-background': 'onSurface',
};

function neutralRoleLines(scheme) {
  return Object.entries(NEUTRAL_ROLES).map(
    ([token, prop]) => `  --md-sys-color-${token}: ${hexFromArgb(scheme[prop])};`,
  );
}

// Standard M3 tone assignments for a "color/onColor/colorContainer/onColorContainer"
// role group (+ the "fixed" pair, mode-invariant per the M3 spec).
const ROLE_TONES = {
  light: { color: 40, onColor: 100, colorContainer: 90, onColorContainer: 10 },
  dark: { color: 80, onColor: 20, colorContainer: 30, onColorContainer: 90 },
  fixed: { fixed: 90, fixedDim: 80, onFixed: 10, onFixedVariant: 30 },
};

/** Hand-assigns a full M3 role group (color/onColor/container/fixed) from a palette,
 *  using the brand's literal hex for `color` in light mode where `useLiteralHex` is
 *  set — otherwise the standard M3 tone (40 light / 80 dark) of that hue+chroma. */
function roleGroupLines(key, palette, mode, { literalHex } = {}) {
  const tones = ROLE_TONES[mode];
  const fixed = ROLE_TONES.fixed;
  const color = mode === 'light' && literalHex ? literalHex : hexFromArgb(palette.tone(tones.color));
  return [
    `  --md-sys-color-${key}: ${color};`,
    `  --md-sys-color-on-${key}: ${hexFromArgb(palette.tone(tones.onColor))};`,
    `  --md-sys-color-${key}-container: ${hexFromArgb(palette.tone(tones.colorContainer))};`,
    `  --md-sys-color-on-${key}-container: ${hexFromArgb(palette.tone(tones.onColorContainer))};`,
    `  --md-sys-color-${key}-fixed: ${hexFromArgb(palette.tone(fixed.fixed))};`,
    `  --md-sys-color-${key}-fixed-dim: ${hexFromArgb(palette.tone(fixed.fixedDim))};`,
    `  --md-sys-color-on-${key}-fixed: ${hexFromArgb(palette.tone(fixed.onFixed))};`,
    `  --md-sys-color-on-${key}-fixed-variant: ${hexFromArgb(palette.tone(fixed.onFixedVariant))};`,
  ];
}

// primary: the seed's own hue+chroma (uncapped, unlike TonalSpot's desaturation) so
// light-mode `primary` reproduces the literal brand purple almost exactly, and
// dark-mode `primary` sits at the standard tone-80 step of that same vivid hue.
const primaryPalette = TonalPalette.fromHueAndChroma(purpleHct.hue, purpleHct.chroma);

// tertiary: pulse coral, hue-harmonized toward the purple seed (a few degrees'
// shift so it reads as "this brand's coral," not a generic red) — this is the
// brand's actual second accent, promoted into M3's tertiary role rather than
// letting the algorithm invent an unrelated complementary hue.
const harmonizedCoralArgb = Blend.harmonize(argbFromHex(CORAL_HEX), purpleArgb);
const tertiaryPalette = TonalPalette.fromInt(harmonizedCoralArgb);

// moon-light: the one remaining brand accent with no standard-role mapping —
// kept as a distinct named custom color group (own color/on/container tones).
const harmonizedMoonlightArgb = Blend.harmonize(argbFromHex(MOONLIGHT_HEX), purpleArgb);
const moonlightPalette = TonalPalette.fromInt(harmonizedMoonlightArgb);

function buildScheme(fidelityScheme, mode) {
  return [
    ...roleGroupLines('primary', primaryPalette, mode, { literalHex: PURPLE_HEX }),
    ...roleGroupLines('tertiary', tertiaryPalette, mode),
    ...roleGroupLines('moonlight', moonlightPalette, mode),
    ...neutralRoleLines(fidelityScheme),
  ];
}

const lightLines = buildScheme(lightFidelity, 'light');
const darkLines = buildScheme(darkFidelity, 'dark');

const css = `/* AUTO-GENERATED by packages/theme/scripts/generate-m3-tokens.mjs — do not hand-edit.
 * Regenerate with \`pnpm --filter @pulse/theme generate:m3\` after changing a seed color.
 *
 * Material Design 3 color roles (https://m3.material.io/styles/color/roles):
 *   - primary: pulse purple ${PURPLE_HEX} itself in light mode (brand-exact), standard
 *     M3 tone-80 of the same hue/chroma in dark mode — Fidelity's auto-computed primary
 *     landed too dark (~tone 12) to read as the brand color, so this role is hand-assigned.
 *   - tertiary: pulse coral ${CORAL_HEX}, harmonized toward the primary hue and given
 *     standard M3 tones — promoted from "custom accent" into the tertiary role itself,
 *     since Fidelity's auto-derived tertiary invents an unrelated hue with no brand meaning.
 *   - moonlight: pulse moon-light ${MOONLIGHT_HEX}, a custom role with no standard M3 slot.
 *   - secondary/error/surface/neutral roles: SchemeFidelity's own output from the purple
 *     seed (unmodified) — verified against a checkpoint screenshot before this pass shipped.
 */

:root {
${lightLines.join('\n')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${darkLines.map((l) => `  ${l}`).join('\n')}
  }
}

:root[data-theme='dark'] {
${darkLines.join('\n')}
}

/* Non-root variants of the two blocks above — lets a nested element (not
 * just <html>) pin itself to light or dark regardless of the page-wide
 * theme, e.g. the form-builder's Google-Forms-style "paper" surface, which
 * stays light even when the rest of the app is in dark mode. */
[data-theme='light'] {
${lightLines.join('\n')}
}

[data-theme='dark'] {
${darkLines.join('\n')}
}
`;

writeFileSync(OUT_FILE, css);
console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)} (${lightLines.length} light + ${darkLines.length} dark role tokens)`);
