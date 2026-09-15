/**
 * Colour handling for Component identity.
 *
 * The calendar identifies a Component by its colour alone, so two Components
 * that look alike make the week unreadable. Free choice is kept (PLAN.md §1.1)
 * — the app warns, never blocks.
 *
 * Distance is measured in **OKLab**, not RGB. RGB distance is badly wrong
 * perceptually: #00ff00 and #00c800 are far apart numerically but read as the
 * same green, while two dark colours can be numerically close and obviously
 * different. OKLab is built so Euclidean distance ≈ perceived difference.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

/**
 * Below this, two colours are close enough to confuse at the size of a
 * calendar mark. Chosen so the twelve suggested swatches are all mutually
 * distinct — a test pins that.
 */
export const SIMILARITY_THRESHOLD = 0.12;

/**
 * Suggested palette.
 *
 * Every pair is at least `SIMILARITY_THRESHOLD` apart in OKLab — picking two
 * swatches can never produce a similarity warning. The margin is deliberately
 * slim (the closest pair, cocoa/slate, sits at 0.122 against a 0.12 threshold):
 * twelve mutually distinct colours that still look like food is a tight fit,
 * and a first hand-picked attempt had pairs as close as 0.078. The test in
 * `color.test.ts` is the guard — adjust a swatch and it will tell you.
 */
export const SUGGESTED_SWATCHES: readonly string[] = [
  '#c0392b', // brick
  '#e8912e', // amber
  '#c5cf3c', // mustard
  '#5fb03c', // green
  '#0f7a4a', // pine
  '#2fb0a6', // teal
  '#4184cc', // steel
  '#3a2fb0', // indigo
  '#ad55cc', // orchid
  '#db4f8c', // rose
  '#6b4526', // cocoa
  '#4a5a75', // slate
];

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHex(hex: string): boolean {
  return HEX_PATTERN.test(hex.trim());
}

/** Always `#rrggbb`, lowercase, so stored values compare as strings. */
export function normalizeHex(hex: string): string | null {
  const match = HEX_PATTERN.exec(hex.trim());
  const body = match?.[1];
  if (body === undefined) return null;

  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body;

  return `#${full.toLowerCase()}`;
}

export function parseHex(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (normalized === null) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16) / 255,
    g: Number.parseInt(normalized.slice(3, 5), 16) / 255,
    b: Number.parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

/** Undo the sRGB transfer function — OKLab needs light-linear values. */
function gammaToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Björn Ottosson's sRGB → OKLab. */
export function rgbToOklab(rgb: Rgb): Oklab {
  const r = gammaToLinear(rgb.r);
  const g = gammaToLinear(rgb.g);
  const b = gammaToLinear(rgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  // Cube root, not square — this is the nonlinearity that makes the space
  // perceptually uniform.
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/**
 * Perceptual distance between two hex colours, or null if either is invalid.
 * Roughly: < 0.05 nearly identical, ~0.12 confusable, > 0.3 clearly different.
 */
export function perceptualDistance(hexA: string, hexB: string): number | null {
  const rgbA = parseHex(hexA);
  const rgbB = parseHex(hexB);
  if (rgbA === null || rgbB === null) return null;

  const a = rgbToOklab(rgbA);
  const b = rgbToOklab(rgbB);

  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

export interface ColorNeighbour {
  name: string;
  color: string;
  distance: number;
}

/**
 * The most confusable existing Component, or null if the colour is distinct.
 * Advisory only — the UI shows a note and still saves.
 */
export function findSimilarColor(
  hex: string,
  existing: ReadonlyArray<{ name: string; color: string }>,
  threshold: number = SIMILARITY_THRESHOLD,
): ColorNeighbour | null {
  let nearest: ColorNeighbour | null = null;

  for (const candidate of existing) {
    const distance = perceptualDistance(hex, candidate.color);
    if (distance === null) continue;
    if (distance >= threshold) continue;
    if (nearest === null || distance < nearest.distance) {
      nearest = { name: candidate.name, color: candidate.color, distance };
    }
  }

  return nearest;
}

/**
 * Black or white, whichever stays readable on `hex`.
 * OKLab's L is already perceptual lightness, so this is just a threshold.
 */
export function readableTextColor(hex: string): string {
  const rgb = parseHex(hex);
  if (rgb === null) return '#000000';
  return rgbToOklab(rgb).L > 0.62 ? '#000000' : '#ffffff';
}

/** A swatch not already in use, for defaulting a new Component's colour. */
export function suggestUnusedSwatch(used: readonly string[]): string {
  const taken = new Set(used.map((hex) => normalizeHex(hex)).filter((hex) => hex !== null));

  for (const swatch of SUGGESTED_SWATCHES) {
    if (!taken.has(swatch)) return swatch;
  }

  // All twelve taken — fall back to the one furthest from everything in use.
  let best = SUGGESTED_SWATCHES[0] ?? '#71787f';
  let bestDistance = -1;
  for (const swatch of SUGGESTED_SWATCHES) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const hex of used) {
      const distance = perceptualDistance(swatch, hex);
      if (distance !== null && distance < nearest) nearest = distance;
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = swatch;
    }
  }
  return best;
}
