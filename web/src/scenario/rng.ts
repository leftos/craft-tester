/** One weighted candidate for `Rng.weighted`. */
export type Weighted<T> = {
  item: T;
  weight: number;
};

/** A seeded pseudo-random source; the same seed always yields the same sequence. */
export type Rng = {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly Weighted<T>[]): T;
  shuffle<T>(items: readonly T[]): T[];
};

const UINT32 = 0x1_0000_0000;

/**
 * Creates a mulberry32 generator.
 *
 * @param seed Any 32-bit seed; `seedFromString` and `randomSeed` produce suitable ones.
 * @returns A generator whose sequence is fixed by the seed.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };

  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(`int() needs a positive integer bound, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError('pick() needs a non-empty list');
    const chosen = items[int(items.length)];
    if (chosen === undefined) throw new RangeError('pick() drew an empty slot');
    return chosen;
  };

  const weighted = <T>(items: readonly Weighted<T>[]): T => {
    const candidates = items.filter((candidate) => candidate.weight > 0);
    const last = candidates.at(-1);
    if (last === undefined) throw new RangeError('weighted() needs one item of positive weight');
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let threshold = next() * total;
    for (const candidate of candidates) {
      threshold -= candidate.weight;
      if (threshold < 0) return candidate.item;
    }
    return last.item;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = int(index + 1);
      const here = copy[index];
      const there = copy[swap];
      if (here === undefined || there === undefined) continue;
      copy[index] = there;
      copy[swap] = here;
    }
    return copy;
  };

  return { next, int, pick, weighted, shuffle };
}

/**
 * Hashes a string into a 32-bit seed with FNV-1a, so a named scenario is reproducible.
 *
 * @param text The string to hash.
 * @returns An unsigned 32-bit seed.
 */
export function seedFromString(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Draws a fresh seed for a scenario the player has not asked to reproduce.
 *
 * @returns An unsigned 32-bit seed from the platform CSPRNG.
 */
export function randomSeed(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] ?? 0;
}

/**
 * Renders a seed as the URL hash that shares a scenario.
 *
 * @param seed The seed to share.
 * @returns The hash, e.g. `#s=21i3v9`.
 */
export function seedToHash(seed: number): string {
  return `#s=${(seed >>> 0).toString(36)}`;
}

/**
 * Reads a seed back out of a URL hash.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns The seed, or `null` when the hash carries no readable seed.
 */
export function seedFromHash(hash: string): number | null {
  const query = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of query.split('&')) {
    if (!part.startsWith('s=')) continue;
    const value = part.slice(2);
    if (!/^[0-9a-z]+$/.test(value)) return null;
    const seed = Number.parseInt(value, 36);
    return Number.isSafeInteger(seed) && seed >= 0 && seed < UINT32 ? seed : null;
  }
  return null;
}
