import { describe, expect, it } from 'vitest';
import type { Sid } from '@/data/schema.ts';
import { grade } from '@/rules/grade.ts';
import type { PlayerPicks, ResolvedClearance, RuleCitation } from '@/rules/types.ts';

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
  departureRunway: '01R',
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
  clearedTo: 'KSEA',
  sidId: 'TRUKN2',
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'climb_via_except',
  altitudeFeet: 10000,
  expect: 'ten_minutes',
  frequency: '120.9',
};

const allOk = [true, true, true, true, true, true];

const cases: { name: string; picks: PlayerPicks; ok: boolean[] }[] = [
  { name: 'a fully correct entry', picks: correct, ok: allOk },
  {
    name: 'the wrong destination',
    picks: { ...correct, clearedTo: 'KPDX' },
    ok: [false, true, true, true, true, true],
  },
  {
    name: 'a SID from another family',
    picks: { ...correct, sidId: 'SFO5' },
    ok: [true, false, true, true, true, true],
  },
  {
    name: 'a SID id that is not published',
    picks: { ...correct, sidId: 'TRUKN9' },
    ok: [true, false, true, true, true, true],
  },
  {
    name: 'the wrong route template',
    picks: { ...correct, routeTemplate: 'as_filed' },
    ok: [true, true, false, true, true, true],
  },
  {
    name: 'the right template with the wrong transition fix',
    picks: { ...correct, routeFix: 'SSTIK' },
    ok: [true, true, false, true, true, true],
  },
  {
    name: 'the wrong altitude phrase',
    picks: { ...correct, altitudePhrase: 'maintain' },
    ok: [true, true, true, false, true, true],
  },
  {
    name: 'the right phrase with the wrong feet',
    picks: { ...correct, altitudeFeet: 5000 },
    ok: [true, true, true, false, true, true],
  },
  {
    name: 'the wrong expect delay',
    picks: { ...correct, expect: 'three_minutes' },
    ok: [true, true, true, true, false, true],
  },
  {
    name: 'no expect clause where one is due',
    picks: { ...correct, expect: 'none' },
    ok: [true, true, true, true, false, true],
  },
  {
    name: 'the wrong frequency',
    picks: { ...correct, frequency: '135.65' },
    ok: [true, true, true, true, true, false],
  },
];

describe('grade', () => {
  it('returns the six CRAFT elements in order', () => {
    expect(grade(correct, expected, sids).map((entry) => entry.element)).toEqual([
      'C',
      'R.sid',
      'R.route',
      'A.phrase',
      'A.expect',
      'F',
    ]);
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
    const [, sid] = grade(correct, staleVersion, sids);
    expect(sid?.ok).toBe(true);
    expect(sid?.actualLabel).toBe('TRUKN TWO (RNAV)');
    expect(sid?.expectedLabel).toBe('TRUKN1');
  });

  it('names an unpublished SID id as unknown', () => {
    const [, sid] = grade({ ...correct, sidId: 'TRUKN9' }, expected, sids);
    expect(sid?.actualLabel).toBe('unknown SID');
    expect(sid?.expectedLabel).toBe('TRUKN TWO (RNAV)');
  });

  it('ignores the fix on an as-filed route', () => {
    const asFiled: ResolvedClearance = {
      ...expected,
      route: { value: { template: 'as_filed' }, citations: [] },
    };
    const [, , route] = grade({ ...correct, routeTemplate: 'as_filed' }, asFiled, sids);
    expect(route?.ok).toBe(true);
    expect(route?.expectedLabel).toBe('then as filed');
    expect(route?.actualLabel).toBe('then as filed');
  });

  it('ignores the feet on a plain climb via SID', () => {
    const climbVia: ResolvedClearance = {
      ...expected,
      altitude: { value: { phrase: 'climb_via' }, citations: [altitudeCitation] },
    };
    const [, , , altitude] = grade({ ...correct, altitudePhrase: 'climb_via' }, climbVia, sids);
    expect(altitude?.ok).toBe(true);
    expect(altitude?.expectedLabel).toBe('climb via SID');
  });

  it('accepts a missing expect clause where none is due', () => {
    const noExpect: ResolvedClearance = {
      ...expected,
      expect: { value: null, citations: [] },
    };
    const [, , , , clause] = grade({ ...correct, expect: 'none' }, noExpect, sids);
    expect(clause?.ok).toBe(true);
    expect(clause?.expectedLabel).toBe('no expect altitude');
    expect(clause?.actualLabel).toBe('no expect altitude');
  });

  it('labels every element the way the results view reads them', () => {
    const wrong: PlayerPicks = {
      ...correct,
      clearedTo: 'KPDX',
      sidId: 'SFO5',
      routeTemplate: 'radar_vectors_fix',
      routeFix: 'RBL',
      altitudePhrase: 'maintain',
      altitudeFeet: 3000,
      expect: 'three_minutes',
      frequency: '135.65',
    };
    expect(
      grade(wrong, expected, sids).map((entry) => [entry.expectedLabel, entry.actualLabel]),
    ).toEqual([
      ['KSEA', 'KPDX'],
      ['TRUKN TWO (RNAV)', 'SAN FRANCISCO FIVE'],
      ['DEDHD transition', 'radar vectors RBL'],
      ['climb via SID except maintain 10,000', 'maintain 3,000'],
      [
        'expect filed altitude 10 minutes after departure',
        'expect filed altitude 3 minutes after departure',
      ],
      ['120.9', '135.65'],
    ]);
  });

  it('carries the citations of the expected element', () => {
    expect(grade(correct, expected, sids).map((entry) => entry.citations)).toEqual([
      [],
      [assignmentCitation],
      [],
      [altitudeCitation],
      [altitudeCitation],
      [assignmentCitation],
    ]);
  });
});
