/**
 * @pulse/theme — typed brand tokens.
 * Mirrors tokens.css for non-CSS consumers (chart configs, emails, PDFs).
 */

export const palette = {
  primary: {
    air: '#ffffff',
    purple: '#4f008c',
    coral: '#ff375e',
  },
  secondary: {
    silver: '#8e9aa0',
    silverLight: '#dddfe2',
    moonLight: '#a54ee1',
    purpleDark: '#3a1066',
    purpleLight: '#7333a3',
    onyx: '#1d252d',
  },
  /** Charts & graphs only (plus core-brand iconography). */
  tertiary: {
    sun: '#ffdd40',
    sunset: '#ff6a39',
    oasis: '#00c48c',
    sea: '#1dced8',
  },
} as const;

/**
 * Ordered categorical series for charts. Assign in this fixed order, never
 * cycled; >6 series folds into "Other".
 *
 * Accessibility (validated 2026-07 against white surface): CVD separation
 * passes (worst adjacent ΔE 23), but oasis/sea/sunset sit below 3:1 contrast
 * — charts using them MUST ship direct labels + a legend + 2px mark gaps
 * (never color alone). `sun` (#ffdd40, 1.3:1) is excluded from the series;
 * use it only as an outlined fill accent.
 */
export const chartSeries = [
  palette.primary.purple,
  palette.primary.coral,
  palette.tertiary.oasis,
  palette.tertiary.sunset,
  palette.tertiary.sea,
  palette.secondary.moonLight,
] as const;

export const typography = {
  fontFamily: "Arial, 'Helvetica Neue', sans-serif",
  weights: { thin: 100, light: 300, regular: 400, medium: 500, bold: 700, extrabold: 800 },
  /**
   * Brand rules:
   * - headlines start lowercase (product names keep their casing)
   * - light/regular/medium for headlines & body
   * - bold/extrabold only for highlights, numbers, percentages, one-word headlines
   * - no italics outside Latin-grammar exceptions in body copy
   */
} as const;

export type Palette = typeof palette;
