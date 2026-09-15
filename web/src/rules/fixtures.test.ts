import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, ExpectedClearance, Fixture } from '@/data/schema.ts';
import { FixtureSchema } from '@/data/schema.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { toExpectedClearance } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;

/**
 * Every checked-in fixture, loaded by a relative glob.
 *
 * The `@data` alias points at `data/`, and a glob that walks out of it (`@data/../fixtures`) is not
 * a path Vite's glob resolver accepts, so the pattern is relative to this file instead.
 */
const documents = import.meta.glob<unknown>('../../../fixtures/**/*.json', {
  eager: true,
  import: 'default',
});

/** One fixture file and what the schema made of it. */
type LoadedFixture = {
  path: string;
  parsed: ReturnType<typeof FixtureSchema.safeParse>;
};

const loaded: LoadedFixture[] = Object.entries(documents)
  .sort(([left], [right]) => (left < right ? -1 : 1))
  .map(([path, json]) => ({ path, parsed: FixtureSchema.safeParse(json) }));

const fixtures: Fixture[] = loaded
  .map((entry) => (entry.parsed.success ? entry.parsed.data : undefined))
  .filter((fixture) => fixture !== undefined);

/** Whether a fixture expects a full clearance rather than a list of amendments. */
function expectsClearance(fixture: Fixture): fixture is Fixture & { expected: ExpectedClearance } {
  return fixture.expected !== undefined && 'clearedTo' in fixture.expected;
}

/** The expectation without its optional spoken form, which the engine does not produce. */
function comparable(expected: ExpectedClearance): ExpectedClearance {
  const copy: ExpectedClearance = { ...expected };
  delete copy.spoken;
  return copy;
}

/** What the engine makes of a fixture: the clearance in fixture shape, or why it is blocked. */
function engineResult(fixture: Fixture): ExpectedClearance | string {
  const result = resolveClearance(fixture.scenario, ksfo);
  return result.ok
    ? toExpectedClearance(result.clearance)
    : result.unresolved.map((item) => `${item.element}: ${item.reason}`).join('; ');
}

/** One line per `element + reason`, with how many plans hit it and one that did. */
function formatGroups(groups: ReadonlyMap<string, { count: number; example: string }>): string {
  return [...groups.entries()]
    .sort(([, left], [, right]) => right.count - left.count)
    .map(
      ([key, group]) =>
        `  ${String(group.count).padStart(3)}  ${key}\n         e.g. ${group.example}`,
    )
    .join('\n');
}

describe('fixtures', () => {
  it('loads every fixture file', () => {
    expect(loaded.length).toBeGreaterThan(0);
  });

  it('validates every fixture against the schema', () => {
    const invalid = loaded
      .filter((entry) => !entry.parsed.success)
      .map(
        (entry) => `${entry.path}: ${entry.parsed.error?.issues.map((i) => i.message).join(', ')}`,
      );
    expect(invalid).toEqual([]);
  });

  it('carries only airports the suite has data for', () => {
    const unknown = fixtures.filter((fixture) => fixture.airport !== 'KSFO').map((f) => f.id);
    expect(unknown).toEqual([]);
  });

  it('reports what the engine makes of the plans with no clearance expectation', () => {
    const plans = fixtures.filter((fixture) => !expectsClearance(fixture));
    const groups = new Map<string, { count: number; example: string }>();
    let resolved = 0;
    for (const fixture of plans) {
      const result = resolveClearance(fixture.scenario, ksfo);
      if (result.ok) {
        resolved += 1;
        continue;
      }
      for (const item of result.unresolved) {
        const key = `${item.element} | ${item.reason}`;
        const group = groups.get(key);
        if (group === undefined) groups.set(key, { count: 1, example: fixture.id });
        else group.count += 1;
      }
    }
    console.info(
      [
        `fixture plans with no clearance expectation: ${resolved} of ${plans.length} resolved,`,
        `${groups.size} unresolved groups (count, element, reason, example):`,
        formatGroups(groups),
      ].join('\n'),
    );
    expect(plans.length).toBeGreaterThan(0);
  });
});

describe('settled fixtures', () => {
  for (const fixture of fixtures.filter(
    (entry) => expectsClearance(entry) && entry.status === 'settled',
  )) {
    if (!expectsClearance(fixture)) continue;
    it(`${fixture.id} is the clearance the engine resolves`, () => {
      expect(engineResult(fixture)).toEqual(comparable(fixture.expected));
    });
  }
});

describe('pending fixtures', () => {
  for (const fixture of fixtures.filter(
    (entry) => expectsClearance(entry) && entry.status === 'pending',
  )) {
    if (!expectsClearance(fixture)) continue;
    it(`${fixture.id} still disagrees with the engine`, () => {
      const actual = engineResult(fixture);
      const agrees =
        typeof actual !== 'string' && isDeepStrictEqual(actual, comparable(fixture.expected));
      expect(
        agrees,
        `pending fixture ${fixture.id} now matches the engine; confirm it with the user and promote it to settled`,
      ).toBe(false);
    });
  }
});
