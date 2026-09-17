import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import type { AirportData, Arrival } from '@/data/schema.ts';
import type { ArrivalSource, ArrivalTarget } from '@/rules/routeBuild.ts';
import { buildToArrival } from '@/rules/routeBuild.ts';

const koak = koakJson as unknown as AirportData;

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
