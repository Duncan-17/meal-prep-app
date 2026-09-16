/**
 * Chart colours.
 *
 * These are not picked by eye. They come from a validated categorical palette
 * and were re-checked as a four-slot subset in both modes:
 *
 *   light — worst adjacent CVD ΔE 9.1, normal-vision ΔE 22.9  (targets 8 / 15)
 *   dark  — worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.8
 *
 * Light-mode aqua and yellow fall below 3:1 against the page, which carries an
 * obligation rather than a veto: the chart ships **direct labels and a table
 * view**, so colour never carries meaning alone. Keep both if you touch this.
 *
 * Slots are assigned in fixed order and never cycled. A fifth series folds into
 * the table rather than inventing a hue — a generated one is indistinguishable
 * under colour-vision deficiency and breaks every check above.
 */

export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const;

/** Hard cap. Past this, fold into the table view — never generate a hue. */
export const MAX_SERIES = SERIES_LIGHT.length;

/**
 * Status colours, deliberately distinct from the series slots so a state never
 * impersonates a series. Always paired with a word — never colour alone.
 */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export function seriesColor(index: number, dark: boolean): string {
  const palette = dark ? SERIES_DARK : SERIES_LIGHT;
  // Clamp rather than wrap: cycling would give two series the same colour.
  return palette[Math.min(index, palette.length - 1)] ?? palette[0];
}

/** Whether the viewer is currently in dark mode, for chart colours. */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
