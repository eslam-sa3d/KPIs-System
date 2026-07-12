/**
 * Generates packages/theme/src/atlaskit-scheme.css from @atlaskit/tokens'
 * shipped default theme (color, spacing, motion, typography) plus pulse's
 * brand overrides for the --ds-* tokens that carry visible brand identity
 * (brand/selected/link/danger color roles).
 *
 * @atlaskit/tokens ships its default theme values as JS modules meant to be
 * loaded asynchronously at runtime (`enableGlobalTheme`), which injects a
 * <style> tag after the JS runs — fine for a normal client app, but this repo
 * statically exports with no server, and the existing dark-mode system
 * deliberately avoids any flash-of-wrong-theme via a blocking inline script
 * that only works against plain committed CSS. So, same as
 * generate-m3-tokens.mjs already does for the M3 palette, this script reaches
 * into @atlaskit/tokens' internal (non-exported-subpath) theme artifacts at
 * build time and writes one plain committed CSS file — loads like any other
 * stylesheet, zero JS, zero flash. Re-run `pnpm generate:atlaskit-theme`
 * after bumping @atlaskit/tokens, since these are internal paths without a
 * semver contract.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '../src/atlaskit-scheme.css');

const require = createRequire(import.meta.url);
const tokensPkgDir = path.dirname(require.resolve('@atlaskit/tokens/package.json'));
const themesDir = path.join(tokensPkgDir, 'dist/cjs/artifacts/themes');

/** Pulls every `--ds-*: value;` custom-property declaration out of a theme
 *  CSS string, regardless of which selector it's nested under — sidesteps
 *  parsing @atlaskit/tokens' own (compound, codegen'd) selectors entirely. */
function extractDeclarations(css) {
  return css.match(/--ds-[\w-]+:\s*[^;]+;/g) ?? [];
}

/** Pulls top-level `@keyframes ... { ... }` blocks out verbatim (used by the
 *  motion theme's enter/exit animations). */
function extractKeyframes(css) {
  return css.match(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}/g) ?? [];
}

function loadTheme(fileName) {
  return require(path.join(themesDir, fileName)).default;
}

const lightCss = loadTheme('atlassian-light.js');
const darkCss = loadTheme('atlassian-dark.js');
const spacingCss = loadTheme('atlassian-spacing.js');
const motionCss = loadTheme('atlassian-motion.js');
const typographyCss = loadTheme('atlassian-typography.js').replace(
  /"Atlassian Sans"/g,
  "'stc forward'",
);

const lightDecls = extractDeclarations(lightCss);
const darkDecls = extractDeclarations(darkCss);
const staticDecls = [
  ...extractDeclarations(spacingCss),
  ...extractDeclarations(motionCss),
  ...extractDeclarations(typographyCss),
];
const keyframes = extractKeyframes(motionCss);

// pulse brand overrides — only the color roles that carry visible brand
// identity (brand/selected/link/danger). Aliased to the M3 roles already
// computed in m3-scheme.css (imported alongside this file) rather than
// re-deriving colors, so both token systems always agree. Everything else
// (neutrals, surfaces, elevation, focus rings, warning/success) is left as
// @atlaskit/tokens' own default — same "hand-assign brand roles, let the
// algorithm/defaults handle the rest" philosophy as generate-m3-tokens.mjs.
//
// Shared between light and dark — safe because every value here is itself
// mode-aware (light/dark blocks below resolve `--md-sys-color-*` to that
// mode's own tone), EXCEPT the *-bold roles that back solid button fills,
// which intentionally do NOT follow M3's own dark-mode convention of
// swapping to a light/pastel tone + dark text (correct per the M3 spec, but
// reads as washed-out for a filled CTA button against this app's near-black
// dark surfaces). Buttons keep a bold, saturated pulse-purple/coral fill
// with white text in both modes — brandBoldOverrides below is the one block
// that differs per mode, layered on top of this shared one.
const brandOverrides = `
  /* brand */
  --ds-background-brand-boldest: var(--md-sys-color-on-primary-fixed-variant);
  --ds-background-brand-subtlest: var(--md-sys-color-primary-container);
  --ds-background-brand-subtlest-hovered: var(--md-sys-color-secondary-container);
  --ds-background-brand-subtlest-pressed: var(--md-sys-color-secondary-fixed);
  --ds-border-brand: var(--md-sys-color-primary);
  --ds-text-brand: var(--md-sys-color-primary);
  --ds-icon-brand: var(--md-sys-color-primary);
  --ds-chart-brand: var(--md-sys-color-primary);
  --ds-chart-brand-hovered: var(--md-sys-color-on-primary-fixed-variant);

  /* focus ring — every text field / select / checkbox / radio's focus
     outline, otherwise Atlaskit's default blue */
  --ds-border-focused: var(--md-sys-color-primary);

  /* selected (mirrors brand — same role, different token family; several
     components, e.g. selected tabs/menu items/checked controls, read this
     one instead of color.background.brand.*) */
  --ds-background-selected: var(--md-sys-color-primary-container);
  --ds-background-selected-hovered: var(--md-sys-color-secondary-container);
  --ds-background-selected-pressed: var(--md-sys-color-secondary-fixed);
  --ds-border-selected: var(--md-sys-color-primary);
  --ds-text-selected: var(--md-sys-color-primary);
  --ds-icon-selected: var(--md-sys-color-primary);

  /* links */
  --ds-link: var(--md-sys-color-primary);
  --ds-link-pressed: var(--md-sys-color-on-primary-fixed-variant);
  --ds-link-visited: var(--md-sys-color-moonlight);
  --ds-link-visited-pressed: var(--md-sys-color-on-moonlight-fixed-variant);

  /* danger — pulse coral doubles as the error/danger accent (see
     tokens.css's --color-danger comment) */
  --ds-text-danger: var(--md-sys-color-tertiary);
  --ds-icon-danger: var(--md-sys-color-tertiary);
  --ds-border-danger: var(--md-sys-color-tertiary);`;

// The *-bold fills + their on-brand text — same literal pulse purple/coral
// in both modes (light mode's M3 tone already lands on the literal brand
// hex; dark mode is hand-pinned to the same "-light" tint used for other
// bold-on-dark surfaces, rather than M3's auto tone-80 pastel) so a primary
// button never goes pastel. `--ds-text-inverse` is included because that's
// what Button's "primary"/"danger" appearance uses for its own label color.
const brandBoldOverridesLight = `
  --ds-background-brand-bold: var(--pulse-purple);
  --ds-background-brand-bold-hovered: var(--pulse-purple-dark);
  --ds-background-brand-bold-pressed: var(--pulse-purple-dark);
  --ds-background-selected-bold: var(--pulse-purple);
  --ds-background-selected-bold-hovered: var(--pulse-purple-dark);
  --ds-background-selected-bold-pressed: var(--pulse-purple-dark);
  --ds-background-danger-bold: var(--pulse-coral);
  --ds-background-danger-bold-hovered: color-mix(in srgb, var(--pulse-coral) 85%, black);
  --ds-background-danger-bold-pressed: color-mix(in srgb, var(--pulse-coral) 70%, black);
  --ds-text-inverse: var(--pulse-air);`;

const brandBoldOverridesDark = `
  --ds-background-brand-bold: var(--pulse-purple-light);
  --ds-background-brand-bold-hovered: color-mix(in srgb, var(--pulse-purple-light) 85%, white);
  --ds-background-brand-bold-pressed: var(--pulse-purple);
  --ds-background-selected-bold: var(--pulse-purple-light);
  --ds-background-selected-bold-hovered: color-mix(in srgb, var(--pulse-purple-light) 85%, white);
  --ds-background-selected-bold-pressed: var(--pulse-purple);
  --ds-background-danger-bold: var(--pulse-coral);
  --ds-background-danger-bold-hovered: color-mix(in srgb, var(--pulse-coral) 85%, white);
  --ds-background-danger-bold-pressed: color-mix(in srgb, var(--pulse-coral) 70%, black);
  --ds-text-inverse: var(--pulse-air);`;

const css = `/* AUTO-GENERATED by packages/theme/scripts/generate-atlaskit-theme.mjs — do not hand-edit.
 * Regenerate with \`pnpm --filter @pulse/theme generate:atlaskit-theme\` after
 * bumping @atlaskit/tokens or changing a brand seed color.
 *
 * Layered onto @atlaskit/tokens' own default theme (Atlassian's default
 * palette, pulled from the package's internal theme artifacts — see this
 * script's header comment) is a pulse brand-color override layer, aliased to
 * the M3 roles in m3-scheme.css so both token systems agree. Scoped to
 * [data-color-mode], which theme-toggle.tsx and layout.tsx's
 * THEME_INIT_SCRIPT set on <html> alongside the existing [data-theme]
 * attribute that drives m3-scheme.css.
 */
@import './m3-scheme.css';

${keyframes.join('\n')}

:root {
${staticDecls.map((d) => `  ${d}`).join('\n')}
${lightDecls.map((d) => `  ${d}`).join('\n')}
${brandOverrides}
${brandBoldOverridesLight}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-color-mode='light']) {
${darkDecls.map((d) => `    ${d}`).join('\n')}
${brandOverrides}
${brandBoldOverridesDark}
  }
}

:root[data-color-mode='dark'] {
${darkDecls.map((d) => `  ${d}`).join('\n')}
${brandOverrides}
${brandBoldOverridesDark}
}

/* Non-root variants of the two blocks above — lets a nested element (not
 * just <html>) pin itself to light or dark regardless of the page-wide
 * theme, e.g. the form-builder's Google-Forms-style "paper" surface, which
 * stays light even when the rest of the app is in dark mode. */
[data-color-mode='light'] {
${staticDecls.map((d) => `  ${d}`).join('\n')}
${lightDecls.map((d) => `  ${d}`).join('\n')}
${brandOverrides}
${brandBoldOverridesLight}
}

[data-color-mode='dark'] {
${darkDecls.map((d) => `  ${d}`).join('\n')}
${brandOverrides}
${brandBoldOverridesDark}
}
`;

writeFileSync(OUT_FILE, css);
console.log(
  `Wrote ${path.relative(process.cwd(), OUT_FILE)} (${staticDecls.length} static + ${lightDecls.length} light + ${darkDecls.length} dark @atlaskit/tokens declarations, ${keyframes.length} keyframe blocks)`,
);
