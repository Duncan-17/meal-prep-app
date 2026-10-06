import { describe, expect, it } from 'vitest';

import { contributionsFor, placeSegments } from '@/domain/contributions';

const steak = { label: 'Steak', color: '#c0392b', nutrients: { protein_g: 42, fat_g: 20 } };
const eggs = { label: 'Eggs', color: '#e8912e', nutrients: { protein_g: 12, fat_g: 10 } };
const rice = { label: 'Rice', color: '#c5cf3c', nutrients: { carbs_g: 45 } };

describe('contributionsFor', () => {
  it('splits a total by the food it came from — the steak-and-eggs example', () => {
    expect(contributionsFor([steak, eggs, rice], 'protein_g')).toEqual([
      { label: 'Steak', color: '#c0392b', amount: 42 },
      { label: 'Eggs', color: '#e8912e', amount: 12 },
    ]);
  });

  it('merges the same food eaten twice into one segment', () => {
    expect(contributionsFor([eggs, steak, eggs], 'protein_g')).toEqual([
      { label: 'Eggs', color: '#e8912e', amount: 24 },
      { label: 'Steak', color: '#c0392b', amount: 42 },
    ]);
  });

  it('leaves out foods with no data rather than drawing a zero', () => {
    expect(contributionsFor([rice], 'protein_g')).toEqual([]);
  });

  it('keeps colourless (pre-colour) items, colourless', () => {
    const old = { label: 'Item', nutrients: { protein_g: 5 } };
    expect(contributionsFor([old], 'protein_g')).toEqual([
      { label: 'Item', color: undefined, amount: 5 },
    ]);
  });

  it('sums derived totals from their parts', () => {
    const salmon = { label: 'Salmon', nutrients: { ala: 0.1, dha: 1.1 } };
    expect(
      contributionsFor([salmon], 'omega3', { omega3: ['ala', 'epa', 'dha'] })[0]?.amount,
    ).toBeCloseTo(1.2);
  });
});

describe('placeSegments', () => {
  const segments = [
    { label: 'Steak', color: '#c0392b', amount: 42 },
    { label: 'Eggs', color: '#e8912e', amount: 12 },
  ];

  it('lays segments end to end as fractions of the goal', () => {
    const placed = placeSegments(segments, 150);
    expect(placed.map((p) => [p.start, p.length])).toEqual([
      [0, 0.28],
      [0.28, 0.08],
    ]);
  });

  it('clips at the goal and drops anything wholly past it', () => {
    const placed = placeSegments([...segments, { label: 'More', color: '#000', amount: 10 }], 50);
    expect(placed).toHaveLength(2);
    expect(placed[1]?.length).toBeCloseTo(8 / 50);
    expect(placed.reduce((sum, p) => sum + p.length, 0)).toBeCloseTo(1);
  });

  it('draws nothing with no goal', () => {
    expect(placeSegments(segments, 0)).toEqual([]);
  });
});
