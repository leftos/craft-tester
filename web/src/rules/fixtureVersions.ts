import type { AirportData, Fixture } from '@/data/schema.ts';

/** One stamped SID and the version the airport publishes today. */
type Rewrite = {
  from: { id: string; spoken: string };
  to: { id: string; spoken: string };
};

/** Escapes a literal for use inside a regular expression. */
function escaped(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces each stamped id and spoken name in one string with its current form. */
function rewriteText(text: string, rewrites: readonly Rewrite[]): string {
  let result = text;
  for (const { from, to } of rewrites) {
    const id = new RegExp(`(?<![A-Z0-9])${escaped(from.id)}(?![A-Z0-9])`, 'g');
    const spoken = new RegExp(`\\b${escaped(from.spoken)}\\b`, 'g');
    result = result.replace(id, to.id).replace(spoken, to.spoken);
  }
  return result;
}

/** Rewrites every string inside a JSON-shaped value, leaving its structure as it is. */
function rewriteDeep<T>(value: T, rewrites: readonly Rewrite[]): T {
  if (typeof value === 'string') return rewriteText(value, rewrites) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => rewriteDeep(item, rewrites)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteDeep(item, rewrites)]),
    ) as T;
  }
  return value;
}

/** The stamped families whose published version has moved on since the fixture was written. */
function rewritesOf(fixture: Fixture, airport: AirportData): Rewrite[] {
  const rewrites: Rewrite[] = [];
  for (const [family, stamped] of Object.entries(fixture.sidVersions ?? {})) {
    const current = airport.sids.find((sid) => sid.family === family);
    if (current === undefined) {
      throw new Error(
        `fixture ${fixture.id} stamps SID family ${family}, which ${fixture.airport} no longer publishes`,
      );
    }
    if (current.id === stamped.id) continue;
    rewrites.push({ from: stamped, to: { id: current.id, spoken: current.spoken } });
  }
  return rewrites;
}

/**
 * A fixture with every SID it stamps moved to the version the airport publishes today.
 *
 * A fixture records the SID versions it was written against in `sidVersions`; an AIRAC cycle that
 * reissues one of those procedures would otherwise break every fixture naming it. The stamped id
 * (as a whole token) and spoken name (as a whole phrase) are rewritten in the filed route, the
 * remarks and every string of `expected`. A token of another version, such as a deliberately stale
 * filing, is not the stamped id and is left alone.
 *
 * @param fixture The fixture as written; it is not changed.
 * @param airport The data of the airport the fixture is filed at.
 * @returns A new fixture, or an equal copy when nothing moved.
 * @throws Error When a stamped family is no longer published at the airport.
 */
export function withCurrentVersions(fixture: Fixture, airport: AirportData): Fixture {
  const rewrites = rewritesOf(fixture, airport);
  const scenario = {
    ...fixture.scenario,
    filedRoute: rewriteText(fixture.scenario.filedRoute, rewrites),
  };
  if (fixture.scenario.remarks !== undefined) {
    scenario.remarks = rewriteText(fixture.scenario.remarks, rewrites);
  }
  const mapped: Fixture = { ...fixture, scenario };
  if (fixture.expected !== undefined) mapped.expected = rewriteDeep(fixture.expected, rewrites);
  return mapped;
}
