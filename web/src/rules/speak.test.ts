import { describe, expect, it } from 'vitest';
import {
  speakAltitude,
  speakCallsign,
  speakClearance,
  speakDigits,
  speakFix,
  speakFrequency,
  speakRouteToken,
} from '@/rules/speak.ts';
import type { SpeakClearanceInput } from '@/rules/speak.ts';
import type { ResolvedClearance } from '@/rules/types.ts';

const telephony = { UAL: 'United', SWA: 'Southwest', DAL: 'Delta', CKK: 'Cargo King' };

const fixSpoken = {
  ENI: 'Mendocino',
  RBL: 'Red Bluff',
  CCR: 'Concord',
  OSI: 'Woodside',
  OAK: 'Oakland',
  SAC: 'Sacramento',
};

describe('speakAltitude', () => {
  it.each([
    [3000, 'three thousand'],
    [5000, 'five thousand'],
    [9000, 'niner thousand'],
    [10000, 'one zero thousand'],
    [11000, 'one one thousand'],
    [17000, 'one seven thousand'],
    [3500, 'three thousand five hundred'],
    [1500, 'one thousand five hundred'],
    [18000, 'flight level one eight zero'],
    [19000, 'flight level one niner zero'],
    [32000, 'flight level three two zero'],
  ])('speaks %i as "%s"', (feet, spoken) => {
    expect(speakAltitude(feet)).toBe(spoken);
  });
});

describe('speakDigits', () => {
  it.each([
    ['3342', 'three three four two'],
    ['0987', 'zero niner eight seven'],
    ['7', 'seven'],
  ])('speaks %s as "%s"', (digits, spoken) => {
    expect(speakDigits(digits)).toBe(spoken);
  });
});

describe('speakFrequency', () => {
  it.each([
    ['120.9', 'one two zero point niner'],
    ['135.1', 'one three five point one'],
    ['118.85', 'one one eight point eight five'],
  ])('speaks %s as "%s"', (frequency, spoken) => {
    expect(speakFrequency(frequency)).toBe(spoken);
  });
});

describe('speakCallsign', () => {
  it.each([
    ['UAL320', 'United three twenty'],
    ['SWA1859', 'Southwest eighteen fifty-nine'],
    ['DAL653', 'Delta six fifty-three'],
    ['CKK25', 'Cargo King twenty-five'],
    ['UAL1005', 'United ten zero five'],
    ['UAL100', 'United one hundred'],
    ['UAL7', 'United seven'],
    ['SWA1234A', 'Southwest one two three four alpha'],
    ['N483KA', 'November four eight three kilo alpha'],
    ['XYZ123', 'Xray yankee zulu one two three'],
  ])('speaks %s as "%s"', (callsign, spoken) => {
    expect(speakCallsign(callsign, telephony)).toBe(spoken);
  });
});

describe('speakFix', () => {
  it.each([
    ['ENI', 'Mendocino'],
    ['RBL', 'Red Bluff'],
    ['DEDHD', 'Dedhd'],
    ['SSTIK', 'Sstik'],
    ['ILA', 'india lima alpha'],
  ])('speaks %s as "%s"', (fix, spoken) => {
    expect(speakFix(fix, fixSpoken)).toBe(spoken);
  });
});

describe('speakRouteToken', () => {
  it.each([
    ['J70', 'Jay seventy'],
    ['V244', 'Victor two forty-four'],
    ['Q124', 'Q one twenty-four'],
    ['T575', 'Tango five seventy-five'],
    ['B932', 'Bravo nine thirty-two'],
    ['HAWKZ7', 'Hawkz Seven arrival'],
    ['CCR2', 'Concord Two arrival'],
    ['DEDHD', 'Dedhd'],
    ['ENI', 'Mendocino'],
  ])('speaks %s as "%s"', (token, spoken) => {
    expect(speakRouteToken(token, fixSpoken)).toBe(spoken);
  });
});

type ClearanceParts = {
  sid?: ResolvedClearance['sid']['value'];
  route?: ResolvedClearance['route']['value'];
  altitude?: ResolvedClearance['altitude']['value'];
  expect?: ResolvedClearance['expect']['value'];
};

function clearance(parts: ClearanceParts = {}): ResolvedClearance {
  return {
    clearedTo: { value: 'KSEA', citations: [] },
    departureRunway: '01R',
    sid: {
      value: parts.sid ?? { id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' },
      citations: [],
    },
    route: { value: parts.route ?? { template: 'transition', fix: 'DEDHD' }, citations: [] },
    altitude: { value: parts.altitude ?? { phrase: 'climb_via' }, citations: [] },
    expect: { value: parts.expect ?? null, citations: [] },
    frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [] },
  };
}

function input(overrides: Partial<SpeakClearanceInput> = {}): SpeakClearanceInput {
  return {
    callsign: 'UAL320',
    clearance: clearance(),
    destinationSpoken: 'Seattle',
    filedRoute: 'TRUKN2 DEDHD HAWKZ7 J70',
    airportFaa: 'SFO',
    squawk: '3342',
    telephony,
    fixSpoken,
    ...overrides,
  };
}

const closing =
  'Climb via SID. Departure frequency one two zero point niner, squawk three three four two.';

describe('speakClearance', () => {
  it('reads the abbreviated clearance the way clearance delivery does', () => {
    expect(speakClearance(input()).abbreviated).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Dedhd transition, ' +
        'then as filed. Climb via SID. Departure frequency one two zero point niner, ' +
        'squawk three three four two.',
    );
  });

  it('reads the filed route in place of "then as filed"', () => {
    expect(speakClearance(input()).fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Dedhd transition, ' +
        'Hawkz Seven arrival, Jay seventy. Climb via SID. ' +
        'Departure frequency one two zero point niner, squawk three three four two.',
    );
  });

  it('speaks radar vectors to the fix for a radar-vector SID', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          sid: { id: 'SFO5', family: 'SFO', spoken: 'San Francisco Five' },
          route: { template: 'radar_vectors_fix', fix: 'RBL' },
        }),
        filedRoute: 'SFO5 RBL J5 OED',
      }),
    );
    expect(spoken.abbreviated).toContain(
      'San Francisco Five departure, radar vectors Red Bluff, then as filed.',
    );
    expect(spoken.fullRoute).toContain(
      'San Francisco Five departure, radar vectors Red Bluff, Jay five, oscar echo delta.',
    );
  });

  it('speaks an as-filed route with no transition', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({ route: { template: 'as_filed' } }),
        filedRoute: 'TRUKN2 J70',
      }),
    );
    expect(spoken.abbreviated).toContain('Trukn Two departure, then as filed.');
    expect(spoken.fullRoute).toContain('Trukn Two departure. Climb via SID.');
  });

  it('speaks a climb via SID except maintain', () => {
    const spoken = speakClearance(
      input({ clearance: clearance({ altitude: { phrase: 'climb_via_except', feet: 10000 } }) }),
    );
    expect(spoken.abbreviated).toContain('Climb via SID except maintain one zero thousand.');
  });

  it('speaks a plain maintain', () => {
    const spoken = speakClearance(
      input({ clearance: clearance({ altitude: { phrase: 'maintain', feet: 3000 } }) }),
    );
    expect(spoken.abbreviated).toContain('Maintain three thousand.');
  });

  it('speaks the expect clause after the altitude', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          altitude: { phrase: 'climb_via_except', feet: 10000 },
          expect: { feet: 32000, minutes: 10 },
        }),
      }),
    );
    expect(spoken.abbreviated).toContain(
      'Climb via SID except maintain one zero thousand. ' +
        'Expect flight level three two zero one zero minutes after departure. ' +
        'Departure frequency one two zero point niner, squawk three three four two.',
    );
  });

  it('speaks a non-standard three minute expect below the flight levels', () => {
    const spoken = speakClearance(
      input({ clearance: clearance({ expect: { feet: 17000, minutes: 3 } }) }),
    );
    expect(spoken.abbreviated).toContain(
      'Expect one seven thousand three minutes after departure.',
    );
  });

  it('drops a stale SID version from the full route', () => {
    const spoken = speakClearance(input({ filedRoute: 'TRUKN1 DEDHD J70' }));
    expect(spoken.fullRoute).toContain('Trukn Two departure, Dedhd transition, Jay seventy.');
  });

  it('neither spells the filed procedure nor repeats the transition fix', () => {
    const spoken = speakClearance(input({ filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ7' }));
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Dedhd transition, ' +
        `Red Bluff, lima mike tango, Hawkz Seven arrival. ${closing}`,
    );
  });

  it('reads a radar-vector route from after the fix the vectors go to', () => {
    const spoken = speakClearance(
      input({
        callsign: 'N483KA',
        clearance: clearance({
          sid: { id: 'SFO5', family: 'SFO', spoken: 'San Francisco Five' },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
        }),
        filedRoute: 'GAPP7 OAK V244 ALTAM V392 SAC V6 SWR TRUCK',
      }),
    );
    expect(spoken.fullRoute).toBe(
      'November four eight three kilo alpha, cleared to Seattle airport, ' +
        'San Francisco Five departure, radar vectors Oakland, Victor two forty-four, Altam, ' +
        `Victor three ninety-two, Sacramento, Victor six, sierra whiskey romeo, Truck. ${closing}`,
    );
  });

  it('does not repeat the base fix of an as-filed clearance', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({ route: { template: 'as_filed' } }),
        filedRoute: 'TRUKN2 TRUKN CCR CCR2',
      }),
    );
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Concord, ' +
        `Concord Two arrival. ${closing}`,
    );
  });

  it('reads the abbreviated clearance when the transition fix ends the filed route', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          sid: { id: 'WESLA5', family: 'WESLA', spoken: 'Wesla Five' },
          route: { template: 'transition', fix: 'NTELL' },
        }),
        filedRoute: 'WESLA5 NTELL',
      }),
    );
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Wesla Five departure, ' +
        `Ntell transition. ${closing}`,
    );
    expect(spoken.fullRoute).toBe(spoken.abbreviated.replace(', then as filed', ''));
  });

  it('keeps a registration callsign phonetic', () => {
    expect(speakClearance(input({ callsign: 'N483KA' })).abbreviated).toContain(
      'November four eight three kilo alpha, cleared to Seattle airport,',
    );
  });
});
