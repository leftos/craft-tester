import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import { explainRunway } from '@/rules/runway.ts';

const ksfo = ksfoJson as unknown as AirportData;

/** The reason the shared R-THEN-OMITTED row states, as the results view shows it. */
const THEN_OMITTED_WHY =
  'Leaving out "then" still hands the pilot the rest of the filed route, so it is only marked down a little; the standard phrase is "then as filed".';

/** A flight whose departure runway the 28/01 configuration row settles. */
const SCENARIO: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  equipmentSuffix: '/L',
  destination: 'KSEA',
  filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ7',
  filedAltitude: 34000,
  runwayConfigId: '28/01',
  departureRunway: '01R',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '1234',
};

describe('toCitation', () => {
  it('keeps only the four fields the results view quotes', () => {
    const row = ksfo.assignmentRules[0];
    if (row === undefined) throw new Error('the data has no assignment rules');
    expect(toCitation(row)).toEqual({
      id: row.id,
      source: row.source,
      text: row.text,
      why: row.why,
    });
  });
});

describe('citePhraseology', () => {
  it('cites the rows the ids name, in the order they were asked for', () => {
    expect(citePhraseology(ksfo, 'A-CLIMB-VIA', 'A-EXPECT').map((row) => row.id)).toEqual([
      'A-CLIMB-VIA',
      'A-EXPECT',
    ]);
  });

  it('skips an id the data does not carry rather than citing a hole', () => {
    expect(citePhraseology(ksfo, 'A-NOT-A-RULE', 'C-DEST').map((row) => row.id)).toEqual([
      'C-DEST',
    ]);
  });

  it('cites nothing when asked for nothing', () => {
    expect(citePhraseology(ksfo)).toEqual([]);
  });
});

describe('the reason on a citation', () => {
  it('carries the reason the row states, and null where it states none', () => {
    expect(citePhraseology(ksfo, 'R-THEN-OMITTED')[0]?.why).toBe(THEN_OMITTED_WHY);
    expect(citePhraseology(ksfo, 'R-FRC')[0]?.why).toBeNull();
  });

  it('leaves the reason null on a hand-built citation whose row states none', () => {
    const citations = explainRunway(SCENARIO, ksfo, 'J', 'north').citations;
    expect(citations.find((citation) => citation.id === '28/01')?.why).toBeNull();
  });
});
