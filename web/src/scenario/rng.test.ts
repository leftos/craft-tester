import { describe, expect, it } from 'vitest';
import { createRng, randomSeed, seedFromHash, seedFromString, seedToHash } from '@/scenario/rng.ts';

function draw(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe('createRng', () => {
  it('replays the same sequence for the same seed', () => {
    expect(draw(12345, 8)).toEqual(draw(12345, 8));
  });

  it('produces a different sequence for a different seed', () => {
    expect(draw(12345, 8)).not.toEqual(draw(12346, 8));
  });

  it('keeps next() inside [0, 1)', () => {
    const rng = createRng(seedFromString('next-range'));
    for (let index = 0; index < 1000; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int() inside [0, maxExclusive)', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let index = 0; index < 1000; index += 1) {
      const value = rng.int(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
  });

  it('rejects a non-positive int() bound', () => {
    expect(() => createRng(1).int(0)).toThrow(RangeError);
  });

  it('only ever picks members of the list', () => {
    const items = ['TRUKN', 'SSTIK', 'MOLEN', 'WESLA'];
    const rng = createRng(99);
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const value = rng.pick(items);
      expect(items).toContain(value);
      seen.add(value);
    }
    expect(seen.size).toBe(items.length);
  });

  it('rejects an empty pick list', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });

  it('never returns a zero-weight item', () => {
    const rng = createRng(2024);
    const items = [
      { item: 'never', weight: 0 },
      { item: 'sometimes', weight: 1 },
      { item: 'often', weight: 9 },
      { item: 'also never', weight: 0 },
    ];
    const counts = new Map<string, number>();
    for (let index = 0; index < 1000; index += 1) {
      const value = rng.weighted(items);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect(counts.get('never')).toBeUndefined();
    expect(counts.get('also never')).toBeUndefined();
    expect(counts.get('sometimes')).toBeGreaterThan(0);
    expect(counts.get('often')).toBeGreaterThan(counts.get('sometimes') ?? 0);
  });

  it('rejects a weighted list with no positive weight', () => {
    expect(() => createRng(1).weighted([{ item: 'never', weight: 0 }])).toThrow(RangeError);
  });

  it('shuffles into a permutation without touching the input', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const rng = createRng(4);
    const shuffled = rng.shuffle(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect([...shuffled].sort()).toEqual([...items].sort());
    expect(createRng(4).shuffle(items)).toEqual(shuffled);
  });
});

describe('seedFromString', () => {
  it('is stable and differs between strings', () => {
    expect(seedFromString('KSFO-1')).toBe(seedFromString('KSFO-1'));
    expect(seedFromString('KSFO-1')).not.toBe(seedFromString('KSFO-2'));
  });

  it('stays inside the unsigned 32-bit range', () => {
    const seed = seedFromString('a rather longer scenario name');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});

describe('randomSeed', () => {
  it('returns an unsigned 32-bit integer', () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});

describe('seed hashes', () => {
  it('round-trips a seed through the URL hash', () => {
    for (const seed of [0, 1, 42, 123456789, 4294967295]) {
      expect(seedFromHash(seedToHash(seed))).toBe(seed);
    }
  });

  it('writes the seed in base 36 after #s=', () => {
    expect(seedToHash(123456789)).toBe('#s=21i3v9');
  });

  it('reads a hash with or without its leading hash mark', () => {
    expect(seedFromHash('s=21i3v9')).toBe(123456789);
    expect(seedFromHash('#mode=clearance&s=21i3v9')).toBe(123456789);
  });

  it('returns null for a hash with no readable seed', () => {
    expect(seedFromHash('')).toBeNull();
    expect(seedFromHash('#mode=clearance')).toBeNull();
    expect(seedFromHash('#s=')).toBeNull();
    expect(seedFromHash('#s=NOT-BASE36')).toBeNull();
  });
});
