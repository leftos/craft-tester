import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Arrival } from '@/data/schema.ts';
import type { ArrivalSource, ArrivalTarget } from '@/rules/routeBuild.ts';
import { buildRoute, buildToArrival } from '@/rules/routeBuild.ts';
import type { UnservedSid } from '@/rules/sidSelection.ts';

const koak = koakJson as unknown as AirportData;
const ksfo = ksfoJson as unknown as AirportData;

/** An arrival of the destination, written out rather than looked up, to keep the case readable. */
function arrival(id: string, transitions: string[]): Arrival {
  return { id, family: id.slice(0, -1), rnav: true, transitions };
}

/** The entry fixes of one arrival as targets, in the order the caller lists them. */
function targetsOf(row: Arrival): ArrivalTarget[] {
  return row.transitions.map((transition) => ({ transition, arrival: row }));
}

/** A fix the flight already filed, as a source the search may leave the box at. */
function boxSource(index: number, fix: string): ArrivalSource {
  return { kind: 'box', index, fix };
}

/**
 * One candidate row of the assignment table: a published SID and a row that forces no transition.
 *
 * `NIITE4` and `TRUKN2` both publish a `DEDHD` transition and `DEDHD` connects onward to `RBL`, so
 * either of them can be built onto a route that leaves the terminal at `RBL`; which one the build
 * takes is the scope's answer alone.
 */
function candidate(sidId: string, ruleId: string): UnservedSid {
  const sid = ksfo.sids.find((row) => row.id === sidId);
  const row = ksfo.assignmentRules.find((rule) => rule.id === ruleId);
  if (sid === undefined || row === undefined) throw new Error(`no ${sidId} on ${ruleId}`);
  return { sid, row };
}

describe('buildRoute scope', () => {
  const niite = candidate('NIITE4', 'SFOW-NOISE-N-NIITE');
  const trukn = candidate('TRUKN2', 'SFOW-N-TRUKN-01');
  const tokens = ['RBL', 'J1', 'OED'];
  const filedTrukn = { kind: 'filed', family: 'TRUKN' } as const;

  it('builds the candidate the table puts above the filed family', () => {
    const built = buildRoute(tokens, [niite, trukn], filedTrukn, ksfo);
    expect(built?.sid.id).toBe('NIITE4');
    expect(built?.start.fix).toBe('DEDHD');
  });

  it('builds the filed family where the table puts it first', () => {
    const built = buildRoute(tokens, [trukn, niite], filedTrukn, ksfo);
    expect(built?.sid.id).toBe('TRUKN2');
  });

  it('builds nothing where the candidates hold no row of the filed family', () => {
    expect(buildRoute(tokens, [niite], filedTrukn, ksfo)).toBeUndefined();
  });
});

describe('buildToArrival', () => {
  it('takes a source that already stands on an entry fix, crossing nothing', () => {
    const sadde = arrival('SADDE8', ['AVE', 'DERBB']);
    const route = buildToArrival([boxSource(1, 'AVE')], targetsOf(sadde), koak);
    expect(route?.target.transition).toBe('AVE');
    expect(route?.chain).toEqual([]);
    expect(route?.connections).toEqual([]);
    expect(route?.source).toEqual(boxSource(1, 'AVE'));
  });

  it('prefers the earlier target over the earlier source where both are one connection away', () => {
    const targets = [
      { transition: 'BURGL', arrival: arrival('IRNMN2', ['BURGL']) },
      { transition: 'TILLT', arrival: arrival('LEGOZ4', ['TILLT']) },
    ];
    const sources = [boxSource(1, 'YYUNG'), boxSource(2, 'EBAYE')];
    const route = buildToArrival(sources, targets, koak);
    expect(route?.target.arrival.id).toBe('IRNMN2');
    expect(route?.source).toEqual(boxSource(2, 'EBAYE'));
    expect(route?.connections.map((row) => row.id)).toEqual(['CONN-EBAYE-BURGL']);
  });

  it('takes the fewest connections even where a later source reaches the earlier target', () => {
    const targets = [
      { transition: 'BURGL', arrival: arrival('IRNMN2', ['BURGL']) },
      { transition: 'TILLT', arrival: arrival('LEGOZ4', ['TILLT']) },
    ];
    const route = buildToArrival([boxSource(1, 'YYUNG'), boxSource(2, 'SUSEY')], targets, koak);
    expect(route?.target.arrival.id).toBe('LEGOZ4');
    expect(route?.chain).toEqual([]);
    expect(route?.connections.map((row) => row.id)).toEqual(['CONN-YYUNG-TILLT']);
  });

  it('carries the fixes between the source and the entry fix as the chain', () => {
    const route = buildToArrival(
      [boxSource(1, 'KAYEX')],
      targetsOf(arrival('TESTT1', ['EHF'])),
      koak,
    );
    expect(route?.chain).toEqual(['LOSHN']);
    expect(route?.connections.map((row) => row.id)).toEqual(['CONN-KAYEX-LOSHN', 'CONN-LOSHN-EHF']);
    expect(route?.strength).toBe('usually');
  });

  it('reaches nothing when no source connects onward to a target', () => {
    const route = buildToArrival(
      [boxSource(1, 'OSI')],
      targetsOf(arrival('TESTT1', ['ZZZZZ'])),
      koak,
    );
    expect(route).toBeUndefined();
  });
});
