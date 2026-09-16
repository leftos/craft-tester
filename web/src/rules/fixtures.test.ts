import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type {
  AirportData,
  Amendment,
  ExpectedAmendments,
  ExpectedClearance,
  Fixture,
} from '@/data/schema.ts';
import { FixtureSchema } from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import { toExpectedAmendments } from '@/rules/amend/types.ts';
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

/**
 * Whether a fixture expects a list of amendments rather than a full clearance.
 *
 * An empty list is an expectation like any other: the plan is right as filed.
 */
function expectsAmendments(
  fixture: Fixture,
): fixture is Fixture & { expected: ExpectedAmendments } {
  return fixture.expected !== undefined && 'amendments' in fixture.expected;
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

/** What the amendment engine makes of a fixture: the amendments in fixture shape, or the gaps. */
function amendmentResult(fixture: Fixture): ExpectedAmendments | string {
  const result = resolveAmendments(fixture.scenario, ksfo);
  return result.ok
    ? toExpectedAmendments(result)
    : result.unresolved.map((item) => `${item.element}: ${item.reason}`).join('; ');
}

/** How many plans hit one `element + reason`, and the first plan that did. */
type UnresolvedGroups = Map<string, { count: number; example: string }>;

/** Counts one blocked element against its group. */
function addGroup(groups: UnresolvedGroups, key: string, example: string): void {
  const group = groups.get(key);
  if (group === undefined) groups.set(key, { count: 1, example });
  else group.count += 1;
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

/** The clearance-mode plans whose clearance the user has not confirmed yet. */
const clearancePlans = fixtures.filter(
  (fixture) => fixture.mode === 'clearance' && !expectsClearance(fixture),
);

/** The amendment-mode plans whose amendments the user has not confirmed yet. */
const amendmentPlans = fixtures.filter(
  (fixture) => fixture.mode === 'amendment' && !expectsAmendments(fixture),
);

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

  // A report over no plans of its mode is skipped, not failed.
  it.skipIf(clearancePlans.length === 0)(
    'reports what the engine makes of the plans with no clearance expectation',
    () => {
      const groups: UnresolvedGroups = new Map();
      let resolved = 0;
      for (const fixture of clearancePlans) {
        const result = resolveClearance(fixture.scenario, ksfo);
        if (result.ok) {
          resolved += 1;
          continue;
        }
        for (const item of result.unresolved) {
          addGroup(groups, `${item.element} | ${item.reason}`, fixture.id);
        }
      }
      console.info(
        [
          `fixture plans with no clearance expectation: ${resolved} of ${clearancePlans.length} resolved,`,
          `${groups.size} unresolved groups (count, element, reason, example):`,
          formatGroups(groups),
        ].join('\n'),
      );
      expect(clearancePlans.length).toBeGreaterThan(0);
    },
  );

  // A report over no plans of its mode is skipped, not failed.
  it.skipIf(amendmentPlans.length === 0)(
    'reports what the engine makes of the plans with no amendment expectation',
    () => {
      const groups: UnresolvedGroups = new Map();
      const boxes = new Map<Amendment['box'], number>();
      let resolved = 0;
      let clean = 0;
      for (const fixture of amendmentPlans) {
        const result = resolveAmendments(fixture.scenario, ksfo);
        if (!result.ok) {
          for (const item of result.unresolved) {
            addGroup(groups, `${item.element} | ${item.reason}`, fixture.id);
          }
          continue;
        }
        resolved += 1;
        if (result.amendments.length === 0) clean += 1;
        for (const amendment of result.amendments) {
          boxes.set(amendment.box, (boxes.get(amendment.box) ?? 0) + 1);
        }
      }
      const histogram = [...boxes.entries()].map(([box, count]) => `${box} ${count}`).join(', ');
      console.info(
        [
          `fixture plans with no amendment expectation: ${resolved} of ${amendmentPlans.length} resolved,`,
          `${clean} of those need no amendment; boxes amended: ${histogram === '' ? 'none' : histogram};`,
          `${groups.size} unresolved groups (count, element, reason, example):`,
          formatGroups(groups),
        ].join('\n'),
      );
      expect(amendmentPlans.length).toBeGreaterThan(0);
    },
  );
});

const settledFixtures = fixtures.filter(
  (entry) => expectsClearance(entry) && entry.status === 'settled',
);
const pendingFixtures = fixtures.filter(
  (entry) => expectsClearance(entry) && entry.status === 'pending',
);

// A suite with no fixtures of its status is skipped, not failed.
describe.skipIf(settledFixtures.length === 0)('settled fixtures', () => {
  for (const fixture of settledFixtures) {
    if (!expectsClearance(fixture)) continue;
    it(`${fixture.id} is the clearance the engine resolves`, () => {
      expect(engineResult(fixture)).toEqual(comparable(fixture.expected));
    });
  }
});

// A suite with no fixtures of its status is skipped, not failed.
describe.skipIf(pendingFixtures.length === 0)('pending fixtures', () => {
  for (const fixture of pendingFixtures) {
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

const settledAmendments = fixtures.filter(
  (entry) => expectsAmendments(entry) && entry.status === 'settled',
);
const pendingAmendments = fixtures.filter(
  (entry) => expectsAmendments(entry) && entry.status === 'pending',
);

// A suite with no fixtures of its status is skipped, not failed.
describe.skipIf(settledAmendments.length === 0)('settled amendment fixtures', () => {
  for (const fixture of settledAmendments) {
    if (!expectsAmendments(fixture)) continue;
    it(`${fixture.id} is the amendment set the engine resolves`, () => {
      expect(amendmentResult(fixture)).toEqual(fixture.expected);
    });
  }
});

// A suite with no fixtures of its status is skipped, not failed.
describe.skipIf(pendingAmendments.length === 0)('pending amendment fixtures', () => {
  for (const fixture of pendingAmendments) {
    if (!expectsAmendments(fixture)) continue;
    it(`${fixture.id} still disagrees with the engine`, () => {
      const actual = amendmentResult(fixture);
      const agrees = typeof actual !== 'string' && isDeepStrictEqual(actual, fixture.expected);
      expect(
        agrees,
        `pending fixture ${fixture.id} now matches the engine; confirm it with the user and promote it to settled`,
      ).toBe(false);
    });
  }
});
