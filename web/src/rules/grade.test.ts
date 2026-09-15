import { describe, expect, it } from 'vitest';
import type { Sid } from '@/data/schema.ts';
import { grade } from '@/rules/grade.ts';
import type { PlayerPicks, ResolvedClearance, RuleCitation } from '@/rules/types.ts';
import { NO_SID } from '@/rules/types.ts';

const assignmentCitation: RuleCitation = {
  id: 'SFOW-N-TRUKN-01',
  source: 'SFO ATCT SOP 2-2 a',
  text: 'Northbound, runway 01, T/J -> TRUKN#',
};

const altitudeCitation: RuleCitation = {
  id: 'SFOW-J-10000',
  source: 'SFO ATCT SOP 2-2 c ii',
  text: 'SFOW: all others, runways 01/28, J -> 10,000 or CVS x 10,000',
};

const runwayCitation: RuleCitation = {
  id: 'RWY-DIRECTION',
  source: 'S1-SFO-0 CBT, Runway Assignment: 28/01 1L or 1R?',
  text: 'The departure runway follows the first turn: right turn (northbound SIDs) 1R',
};

const trukn2: Sid = {
  id: 'TRUKN2',
  family: 'TRUKN',
  chartName: 'TRUKN TWO (RNAV)',
  spoken: 'Trukn Two',
  kind: 'rnav_pilot_nav',
  rnavRequired: true,
  runways: ['01R'],
  transitions: [{ fix: 'DEDHD', spoken: 'Dedhd', kind: 'enroute', spokenAsTransition: true }],
  topAltitude: { kind: 'published', feet: 19000 },
  chartExpectFiledAltitudeMinutes: null,
  hasCrossingRestrictions: true,
  restrictions: [],
  climbViaEligible: true,
  routePhrasing: 'transition',
  chartFrequencies: [{ frequency: '120.9' }],
  chart: { pdfUrl: 'https://charts.aviationapi.com/TRUKN2.PDF' },
};

const sfo5: Sid = {
  id: 'SFO5',
  family: 'SFO',
  chartName: 'SAN FRANCISCO FIVE',
  spoken: 'San Francisco Five',
  kind: 'radar_vectors',
  rnavRequired: false,
  runways: ['01L', '01R'],
  transitions: [{ fix: 'RBL', spoken: 'Red Bluff', kind: 'vector', spokenAsTransition: false }],
  topAltitude: { kind: 'none' },
  chartExpectFiledAltitudeMinutes: null,
  hasCrossingRestrictions: false,
  restrictions: [],
  climbViaEligible: false,
  routePhrasing: 'radar_vectors_fix',
  chartFrequencies: [],
  chart: { pdfUrl: 'https://charts.aviationapi.com/SFO5.PDF' },
};

const sids: readonly Sid[] = [trukn2, sfo5];

const expected: ResolvedClearance = {
  clearedTo: { value: 'KSEA', citations: [] },
  runway: { value: '01R', citations: [runwayCitation] },
  sid: {
    value: { id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' },
    citations: [assignmentCitation],
  },
  route: { value: { template: 'transition', fix: 'DEDHD' }, citations: [] },
  altitude: {
    value: { phrase: 'climb_via_except', feet: 10000 },
    citations: [altitudeCitation],
  },
  expect: { value: { feet: 35000, minutes: 10 }, citations: [altitudeCitation] },
  frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [assignmentCitation] },
};

const correct: PlayerPicks = {
  sidId: 'TRUKN2',
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'climb_via_except',
  altitudeFeet: 10000,
  expect: 'ten_minutes',
  frequency: '120.9',
  runway: '01R',
};

const allOk = [true, true, true, true, true, true];

const cases: { name: string; picks: PlayerPicks; ok: boolean[] }[] = [
  { name: 'a fully correct entry', picks: correct, ok: allOk },
  {
    name: 'a SID from another family',
    picks: { ...correct, sidId: 'SFO5' },
    ok: [false, true, true, true, true, true],
  },
  {
    name: 'a SID id that is not published',
    picks: { ...correct, sidId: 'TRUKN9' },
    ok: [false, true, true, true, true, true],
  },
  {
    name: 'the wrong route template',
    picks: { ...correct, routeTemplate: 'as_filed' },
    ok: [true, false, true, true, true, true],
  },
  {
    name: 'the right template with the wrong transition fix',
    picks: { ...correct, routeFix: 'SSTIK' },
    ok: [true, false, true, true, true, true],
  },
  {
    name: 'the wrong altitude phrase',
    picks: { ...correct, altitudePhrase: 'maintain' },
    ok: [true, true, false, true, true, true],
  },
  {
    name: 'the right phrase with the wrong feet',
    picks: { ...correct, altitudeFeet: 5000 },
    ok: [true, true, false, true, true, true],
  },
  {
    name: 'the wrong expect delay',
    picks: { ...correct, expect: 'three_minutes' },
    ok: [true, true, true, false, true, true],
  },
  {
    name: 'no expect clause where one is due',
    picks: { ...correct, expect: 'none' },
    ok: [true, true, true, false, true, true],
  },
  {
    name: 'the wrong frequency',
    picks: { ...correct, frequency: '135.65' },
    ok: [true, true, true, true, false, true],
  },
  {
    name: 'the other runway of the pair',
    picks: { ...correct, runway: '01L' },
    ok: [true, true, true, true, true, false],
  },
];

describe('grade', () => {
  it('returns the six CRAFT elements in order, with the runway last', () => {
    expect(grade(correct, expected, sids).map((entry) => entry.element)).toEqual([
      'R.sid',
      'R.route',
      'A.phrase',
      'A.expect',
      'F',
      'RWY',
    ]);
  });

  it('grades the runway pick against the runway the engine explained', () => {
    const [runway] = grade(correct, expected, sids).slice(-1);
    expect(runway?.ok).toBe(true);
    expect(runway?.expectedLabel).toBe('01R');
    expect(runway?.actualLabel).toBe('01R');
    expect(runway?.citations).toEqual([runwayCitation]);
    const [wrong] = grade({ ...correct, runway: '28L' }, expected, sids).slice(-1);
    expect(wrong?.ok).toBe(false);
    expect(wrong?.expectedLabel).toBe('01R');
    expect(wrong?.actualLabel).toBe('28L');
  });

  it.each(cases)('marks $name', ({ picks, ok }) => {
    expect(grade(picks, expected, sids).map((entry) => entry.ok)).toEqual(ok);
  });

  it('accepts another version of the same SID family', () => {
    const staleVersion: ResolvedClearance = {
      ...expected,
      sid: {
        value: { id: 'TRUKN1', family: 'TRUKN', spoken: 'Trukn One' },
        citations: [assignmentCitation],
      },
    };
    const [sid] = grade(correct, staleVersion, sids);
    expect(sid?.ok).toBe(true);
    expect(sid?.actualLabel).toBe('TRUKN TWO (RNAV)');
    expect(sid?.expectedLabel).toBe('TRUKN1');
  });

  it('names an unpublished SID id as unknown', () => {
    const [sid] = grade({ ...correct, sidId: 'TRUKN9' }, expected, sids);
    expect(sid?.actualLabel).toBe('unknown SID');
    expect(sid?.expectedLabel).toBe('TRUKN TWO (RNAV)');
  });

  it('labels the no-SID pick as no SID', () => {
    const [sid] = grade({ ...correct, sidId: NO_SID }, expected, sids);
    expect(sid?.actualLabel).toBe('no SID');
    expect(sid?.ok).toBe(false);
  });

  it('grades an as-filed route on the fix it hands over on', () => {
    const asFiled: ResolvedClearance = {
      ...expected,
      route: { value: { template: 'as_filed', fix: 'TRUKN' }, citations: [] },
    };
    const picks: PlayerPicks = { ...correct, routeTemplate: 'as_filed', routeFix: 'TRUKN' };
    const [, route] = grade(picks, asFiled, sids);
    expect(route?.ok).toBe(true);
    expect(route?.expectedLabel).toBe('TRUKN, then as filed');
    const [, wrongFix] = grade({ ...picks, routeFix: 'DEDHD' }, asFiled, sids);
    expect(wrongFix?.ok).toBe(false);
    expect(wrongFix?.actualLabel).toBe('DEDHD, then as filed');
  });

  it('grades an airway route on the airway the vectors join', () => {
    const airway: ResolvedClearance = {
      ...expected,
      route: { value: { template: 'radar_vectors_airway', fix: 'V6' }, citations: [] },
    };
    const picks: PlayerPicks = {
      ...correct,
      routeTemplate: 'radar_vectors_airway',
      routeFix: 'V6',
    };
    const [, route] = grade(picks, airway, sids);
    expect(route?.ok).toBe(true);
    expect(route?.expectedLabel).toBe('radar vectors to join V6');
    const [, wrongAirway] = grade({ ...picks, routeFix: 'V244' }, airway, sids);
    expect(wrongAirway?.ok).toBe(false);
    expect(wrongAirway?.actualLabel).toBe('radar vectors to join V244');
  });

  it('ignores the feet on a plain climb via SID', () => {
    const climbVia: ResolvedClearance = {
      ...expected,
      altitude: { value: { phrase: 'climb_via' }, citations: [altitudeCitation] },
    };
    const [, , altitude] = grade({ ...correct, altitudePhrase: 'climb_via' }, climbVia, sids);
    expect(altitude?.ok).toBe(true);
    expect(altitude?.expectedLabel).toBe('climb via SID');
  });

  it('accepts a missing expect clause where none is due', () => {
    const noExpect: ResolvedClearance = {
      ...expected,
      expect: { value: null, citations: [] },
    };
    const [, , , clause] = grade({ ...correct, expect: 'none' }, noExpect, sids);
    expect(clause?.ok).toBe(true);
    expect(clause?.expectedLabel).toBe('no expect altitude');
    expect(clause?.actualLabel).toBe('no expect altitude');
  });

  it('labels every element the way the results view reads them', () => {
    const wrong: PlayerPicks = {
      ...correct,
      sidId: 'SFO5',
      routeTemplate: 'radar_vectors_fix',
      routeFix: 'RBL',
      altitudePhrase: 'maintain',
      altitudeFeet: 3000,
      expect: 'three_minutes',
      frequency: '135.65',
      runway: '28L',
    };
    expect(
      grade(wrong, expected, sids).map((entry) => [entry.expectedLabel, entry.actualLabel]),
    ).toEqual([
      ['TRUKN TWO (RNAV)', 'SAN FRANCISCO FIVE'],
      ['DEDHD transition', 'radar vectors RBL'],
      ['climb via SID except maintain 10,000', 'maintain 3,000'],
      [
        'expect filed altitude 10 minutes after departure',
        'expect filed altitude 3 minutes after departure',
      ],
      ['120.9', '135.65'],
      ['01R', '28L'],
    ]);
  });

  it('carries the citations of the expected element', () => {
    expect(grade(correct, expected, sids).map((entry) => entry.citations)).toEqual([
      [assignmentCitation],
      [],
      [altitudeCitation],
      [altitudeCitation],
      [assignmentCitation],
      [runwayCitation],
    ]);
  });
});
