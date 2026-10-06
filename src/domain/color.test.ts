import { describe, expect, it } from 'vitest';

import {
  SIMILARITY_THRESHOLD,
  SUGGESTED_SWATCHES,
  findSimilarColor,
  isValidHex,
  normalizeHex,
  parseHex,
  perceptualDistance,
  readableTextColor,
  rgbToOklab,
  swatchForName,
  suggestUnusedSwatch,
} from '@/domain/color';

describe('hex parsing', () => {
  it('accepts long and short form, with or without #', () => {
    expect(normalizeHex('#C2564A')).toBe('#c2564a');
    expect(normalizeHex('c2564a')).toBe('#c2564a');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
  });

  it('trims whitespace', () => {
    expect(normalizeHex('  #c2564a  ')).toBe('#c2564a');
  });

  it('rejects anything else', () => {
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('rebeccapurple')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(isValidHex('#gggggg')).toBe(false);
  });

  it('parses channels into 0..1', () => {
    expect(parseHex('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHex('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('rgbToOklab', () => {
  // Reference values from Björn Ottosson's published sRGB → OKLab conversion.
  it('maps white to L=1 with no chroma', () => {
    const white = rgbToOklab({ r: 1, g: 1, b: 1 });
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.a).toBeCloseTo(0, 3);
    expect(white.b).toBeCloseTo(0, 3);
  });

  it('maps black to L=0', () => {
    const black = rgbToOklab({ r: 0, g: 0, b: 0 });
    expect(black.L).toBeCloseTo(0, 5);
  });

  it('puts mid grey near L=0.6, not L=0.5 — lightness is perceptual', () => {
    const grey = rgbToOklab({ r: 0.5, g: 0.5, b: 0.5 });
    expect(grey.L).toBeGreaterThan(0.5);
    expect(grey.L).toBeLessThan(0.7);
    expect(grey.a).toBeCloseTo(0, 3);
  });
});

describe('perceptualDistance', () => {
  it('is zero for the same colour', () => {
    expect(perceptualDistance('#c2564a', '#C2564A')).toBeCloseTo(0, 10);
  });

  it('is symmetric', () => {
    const forward = perceptualDistance('#c2564a', '#4a7fb5');
    const backward = perceptualDistance('#4a7fb5', '#c2564a');
    expect(forward).toBeCloseTo(backward ?? -1, 10);
  });

  it('separates red from blue by a lot', () => {
    expect(perceptualDistance('#ff0000', '#0000ff')).toBeGreaterThan(0.4);
  });

  it('keeps two similar greens close, where RGB distance would mislead', () => {
    // Numerically far apart in RGB (55/255 on one channel), perceptually near.
    const distance = perceptualDistance('#00ff00', '#00c800');
    expect(distance).not.toBeNull();
    expect(distance!).toBeLessThan(0.2);
  });

  it('returns null for an invalid colour rather than a wrong number', () => {
    expect(perceptualDistance('nope', '#c2564a')).toBeNull();
    expect(perceptualDistance('#c2564a', 'nope')).toBeNull();
  });
});

describe('suggested swatches', () => {
  it('offers twelve, as specified', () => {
    expect(SUGGESTED_SWATCHES).toHaveLength(12);
  });

  it('are all valid normalised hex', () => {
    for (const swatch of SUGGESTED_SWATCHES) {
      expect(normalizeHex(swatch)).toBe(swatch);
    }
  });

  // The palette's whole job: pick any two and they must not be confusable.
  it('are mutually distinct above the similarity threshold', () => {
    const tooClose: string[] = [];
    for (let i = 0; i < SUGGESTED_SWATCHES.length; i++) {
      for (let j = i + 1; j < SUGGESTED_SWATCHES.length; j++) {
        const a = SUGGESTED_SWATCHES[i]!;
        const b = SUGGESTED_SWATCHES[j]!;
        const distance = perceptualDistance(a, b) ?? 0;
        if (distance < SIMILARITY_THRESHOLD) {
          tooClose.push(`${a} vs ${b} = ${distance.toFixed(3)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });
});

describe('findSimilarColor', () => {
  const existing = [
    { name: 'Chicken Thighs', color: '#c2564a' },
    { name: 'Guacamole', color: '#6f9a52' },
  ];

  it('flags a near-identical colour and names the clash', () => {
    const hit = findSimilarColor('#c35a4e', existing);
    expect(hit?.name).toBe('Chicken Thighs');
  });

  it('returns null for a clearly different colour', () => {
    expect(findSimilarColor('#4a7fb5', existing)).toBeNull();
  });

  it('returns the NEAREST clash when several are close', () => {
    const crowded = [
      { name: 'Far', color: '#c06a5e' },
      { name: 'Near', color: '#c2564b' },
    ];
    expect(findSimilarColor('#c2564a', crowded)?.name).toBe('Near');
  });

  it('ignores entries with an unparseable colour', () => {
    expect(findSimilarColor('#c2564a', [{ name: 'Broken', color: 'nope' }])).toBeNull();
  });

  it('is empty-safe', () => {
    expect(findSimilarColor('#c2564a', [])).toBeNull();
  });
});

describe('readableTextColor', () => {
  it('puts dark text on light backgrounds and vice versa', () => {
    expect(readableTextColor('#ffffff')).toBe('#000000');
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#c2564a')).toBe('#ffffff');
  });

  it('falls back to black for an invalid colour', () => {
    expect(readableTextColor('nope')).toBe('#000000');
  });
});

describe('suggestUnusedSwatch', () => {
  it('returns the first swatch when nothing is used', () => {
    expect(suggestUnusedSwatch([])).toBe(SUGGESTED_SWATCHES[0]);
  });

  it('skips swatches already taken', () => {
    const used = [SUGGESTED_SWATCHES[0]!, SUGGESTED_SWATCHES[1]!];
    expect(suggestUnusedSwatch(used)).toBe(SUGGESTED_SWATCHES[2]);
  });

  it('is case-insensitive about what counts as taken', () => {
    expect(suggestUnusedSwatch([SUGGESTED_SWATCHES[0]!.toUpperCase()])).toBe(SUGGESTED_SWATCHES[1]);
  });

  it('still returns something when every swatch is taken', () => {
    const result = suggestUnusedSwatch([...SUGGESTED_SWATCHES]);
    expect(SUGGESTED_SWATCHES).toContain(result);
  });
});

describe('swatchForName', () => {
  it('gives the same food the same colour every time, ignoring case and spaces', () => {
    expect(swatchForName('Eggs')).toBe(swatchForName('  eggs '));
  });

  it('always picks one of the validated swatches', () => {
    for (const name of ['Eggs', 'Steak', 'Rice', 'Yeo Valley kefir drink', '']) {
      expect(SUGGESTED_SWATCHES).toContain(swatchForName(name));
    }
  });

  it('spreads different foods across the palette', () => {
    const names = ['eggs', 'steak', 'rice', 'oats', 'milk', 'apple', 'tuna', 'bread'];
    expect(new Set(names.map(swatchForName)).size).toBeGreaterThan(4);
  });
});
