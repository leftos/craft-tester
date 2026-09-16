import { describe, expect, it } from 'vitest';
import type { RunwayConfig } from '@/data/schema.ts';
import type { Mode, ScenarioFilter, TimeFilter } from '@/scenario/filter.ts';
import {
  ANY_SCENARIO,
  filterFromHash,
  hasFilterParams,
  hashFor,
  matchesConfig,
  modeFromHash,
} from '@/scenario/filter.ts';
import { seedFromHash } from '@/scenario/rng.ts';

/** A runway configuration with nothing in it but the id and the plan the filter reads. */
function config(id: string, plan: string): RunwayConfig {
  return {
    id,
    source: 'SOP 2-1',
    name: id,
    plan,
    trainingWeight: 1,
    arrivalRunways: [],
    departureRunways: [],
  };
}

const TIMES: readonly TimeFilter[] = ['either', 'day', 'night'];

const CONFIGS: readonly ScenarioFilter['config'][] = [
  { kind: 'any' },
  { kind: 'plan', plan: 'SFOW' },
  { kind: 'plan', plan: 'SFOE' },
  { kind: 'id', id: '28/01' },
  { kind: 'id', id: '28 RT' },
];

describe('hashFor', () => {
  it('writes nothing but the seed when the filter narrows nothing', () => {
    expect(hashFor(1, ANY_SCENARIO, 'clearance')).toBe('#s=1');
    expect(hashFor(123_456_789, ANY_SCENARIO, 'clearance')).toBe('#s=21i3v9');
  });

  it('names the time and the configuration the draw was narrowed to', () => {
    expect(hashFor(1, { time: 'night', config: { kind: 'any' } }, 'clearance')).toBe(
      '#s=1&t=night',
    );
    expect(
      hashFor(1, { time: 'either', config: { kind: 'plan', plan: 'SFOE' } }, 'clearance'),
    ).toBe('#s=1&c=plan:SFOE');
    expect(hashFor(1, { time: 'day', config: { kind: 'id', id: '28/01' } }, 'clearance')).toBe(
      '#s=1&t=day&c=id:28%2F01',
    );
  });

  it('round-trips every combination of time and configuration', () => {
    for (const time of TIMES) {
      for (const configFilter of CONFIGS) {
        const filter: ScenarioFilter = { time, config: configFilter };
        const hash = hashFor(42, filter, 'clearance');
        expect(filterFromHash(hash), JSON.stringify(filter)).toStrictEqual(filter);
      }
    }
  });

  it('round-trips a configuration id that carries a slash or a space', () => {
    for (const id of ['28/01', '28 RT', '19/10']) {
      const filter: ScenarioFilter = { time: 'night', config: { kind: 'id', id } };
      const hash = hashFor(7, filter, 'clearance');
      expect(hash).not.toContain(' ');
      expect(filterFromHash(hash)).toStrictEqual(filter);
    }
  });

  it('leaves the seed readable beside the filter parts', () => {
    expect(seedFromHash('#s=1&t=night&c=id:28%2F01')).toBe(1);
    const filter: ScenarioFilter = { time: 'day', config: { kind: 'id', id: '28 RT' } };
    expect(seedFromHash(hashFor(123_456_789, filter, 'clearance'))).toBe(123_456_789);
  });
});

describe('the mode in the hash', () => {
  const MODES: readonly Mode[] = ['clearance', 'amendment'];
  const night: ScenarioFilter = { time: 'night', config: { kind: 'id', id: '28/01' } };

  it('writes no part at all for clearance mode', () => {
    expect(hashFor(1, ANY_SCENARIO, 'clearance')).toBe('#s=1');
    expect(hashFor(1, night, 'clearance')).toBe('#s=1&t=night&c=id:28%2F01');
  });

  it('names amendment mode after the filter parts', () => {
    expect(hashFor(1, ANY_SCENARIO, 'amendment')).toBe('#s=1&m=amend');
    expect(hashFor(1, night, 'amendment')).toBe('#s=1&t=night&c=id:28%2F01&m=amend');
  });

  it('round-trips every mode, and the seed and the filter beside it', () => {
    for (const mode of MODES) {
      const hash = hashFor(123_456_789, night, mode);
      expect(modeFromHash(hash), hash).toBe(mode);
      expect(seedFromHash(hash)).toBe(123_456_789);
      expect(filterFromHash(hash)).toStrictEqual(night);
    }
  });

  it('reads a hash that names no mode, or one it does not know, as clearance', () => {
    expect(modeFromHash('')).toBe('clearance');
    expect(modeFromHash('#s=1')).toBe('clearance');
    expect(modeFromHash('#s=1&m=')).toBe('clearance');
    expect(modeFromHash('#s=1&m=strips')).toBe('clearance');
    expect(modeFromHash('s=1&m=amend')).toBe('amendment');
  });

  it('leaves the mode out of the filter parts', () => {
    expect(hasFilterParams('#s=1&m=amend')).toBe(false);
    expect(filterFromHash('#s=1&m=amend')).toStrictEqual(ANY_SCENARIO);
  });
});

describe('the forced destination', () => {
  it('writes the d= part after the configuration and before the mode', () => {
    expect(hashFor(1, { ...ANY_SCENARIO, destination: 'KLVK' }, 'clearance')).toBe('#s=1&d=KLVK');
    expect(
      hashFor(
        1,
        { time: 'night', config: { kind: 'id', id: '28/01' }, destination: 'KLVK' },
        'amendment',
      ),
    ).toBe('#s=1&t=night&c=id:28%2F01&d=KLVK&m=amend');
  });

  it('reads the code back upper-cased', () => {
    expect(filterFromHash('#s=1&d=klvk')).toStrictEqual({ ...ANY_SCENARIO, destination: 'KLVK' });
    expect(filterFromHash('#s=1&d=KSMF')).toStrictEqual({ ...ANY_SCENARIO, destination: 'KSMF' });
    expect(filterFromHash('#s=1&d=OAK')).toStrictEqual({ ...ANY_SCENARIO, destination: 'OAK' });
  });

  it('narrows nothing for a value that cannot be an ICAO code', () => {
    expect(filterFromHash('#s=1&d=')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&d=%E0%A4%A')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&d=KLVKX')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&d=KL')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&d=K-LVK')).toStrictEqual(ANY_SCENARIO);
  });

  it('is a filter part like the ones the dropdowns write', () => {
    expect(hasFilterParams('#s=1&d=KLVK')).toBe(true);
    expect(hasFilterParams('#s=1&d=')).toBe(true);
  });

  it('round-trips beside the members the dropdowns narrow', () => {
    for (const destination of ['KLVK', 'KSMF', 'OAK']) {
      const filter: ScenarioFilter = {
        time: 'day',
        config: { kind: 'plan', plan: 'SFOW' },
        destination,
      };
      expect(filterFromHash(hashFor(9, filter, 'clearance')), destination).toStrictEqual(filter);
    }
  });
});

describe('filterFromHash', () => {
  it('reads a hash that carries no filter parts as the unfiltered draw', () => {
    expect(filterFromHash('')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('s=1')).toStrictEqual(ANY_SCENARIO);
  });

  it('falls back to the unfiltered member for a value it does not know', () => {
    expect(filterFromHash('#s=1&t=dusk')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&t=')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&c=28/01')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&c=id:')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&c=plan:')).toStrictEqual(ANY_SCENARIO);
    expect(filterFromHash('#s=1&c=id:%E0%A4%A')).toStrictEqual(ANY_SCENARIO);
  });

  it('reads one member even when the other is malformed', () => {
    expect(filterFromHash('#s=1&t=night&c=nonsense')).toStrictEqual({
      time: 'night',
      config: { kind: 'any' },
    });
    expect(filterFromHash('#t=noon&c=plan:SFOW')).toStrictEqual({
      time: 'either',
      config: { kind: 'plan', plan: 'SFOW' },
    });
  });
});

describe('hasFilterParams', () => {
  it('is false for an empty hash and for a hash of nothing but a seed', () => {
    expect(hasFilterParams('')).toBe(false);
    expect(hasFilterParams('#s=1')).toBe(false);
    expect(hasFilterParams('#mode=clearance&s=1')).toBe(false);
  });

  it('is true for a hash that asks for a filter, readable or not', () => {
    expect(hasFilterParams('#s=1&t=day')).toBe(true);
    expect(hasFilterParams('#s=1&c=plan:SFOW')).toBe(true);
    expect(hasFilterParams('#s=1&t=dusk')).toBe(true);
  });
});

describe('matchesConfig', () => {
  const west = config('28/01', 'SFOW');
  const east = config('19/10', 'SFOE');

  it('admits every configuration when it narrows nothing', () => {
    expect(matchesConfig({ kind: 'any' }, west)).toBe(true);
    expect(matchesConfig({ kind: 'any' }, east)).toBe(true);
  });

  it('admits only the configurations of the plan it names', () => {
    expect(matchesConfig({ kind: 'plan', plan: 'SFOW' }, west)).toBe(true);
    expect(matchesConfig({ kind: 'plan', plan: 'SFOW' }, east)).toBe(false);
  });

  it('admits only the configuration whose id it names', () => {
    expect(matchesConfig({ kind: 'id', id: '28/01' }, west)).toBe(true);
    expect(matchesConfig({ kind: 'id', id: '28/01' }, east)).toBe(false);
    expect(matchesConfig({ kind: 'id', id: '28 RT' }, west)).toBe(false);
  });
});
