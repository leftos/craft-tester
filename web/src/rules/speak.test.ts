import { describe, expect, it } from 'vitest';
import {
  asFiledJoin,
  joinSpoken,
  speakAltitude,
  speakCallsign,
  speakClearance,
  speakDigits,
  speakExpect,
  speakFix,
  speakFrequency,
  speakRouteToken,
  speakRunway,
} from '@/rules/speak.ts';
import type { SpeakClearanceInput } from '@/rules/speak.ts';
import type { ResolvedClearance } from '@/rules/types.ts';

const telephony = { UAL: 'United', SWA: 'Southwest', DAL: 'Delta', CKK: 'Cargo King' };

const fixSpoken = {
  ENI: 'Mendocino VOR',
  RBL: 'Red Bluff VOR',
  CCR: 'Concord VOR',
  OSI: 'Woodside VOR',
  OAK: 'Oakland VOR',
  SAC: 'Sacramento VOR',
  SWR: 'Palisades VOR',
  LMT: 'Klamath Falls VOR',
  OED: 'Rogue Valley VOR',
  LAX: 'Los Angeles VOR',
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

describe('speakExpect', () => {
  it('speaks each kind of expect clause the way the reading does', () => {
    expect(speakExpect({ kind: 'filed', feet: 34000, minutes: 10 })).toBe(
      'expect flight level three four zero one zero minutes after departure',
    );
    expect(speakExpect({ kind: 'amended', feet: 34000, minutes: 10 })).toBe(
      'expect amended flight level three four zero one zero minutes after departure',
    );
    expect(speakExpect({ kind: 'final', feet: 17000 })).toBe(
      'one seven thousand will be your final',
    );
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

describe('speakRunway', () => {
  it.each([
    ['01R', 'one right'],
    ['01L', 'one left'],
    ['28L', 'two eight left'],
    ['10R', 'one zero right'],
    ['19L', 'one niner left'],
    ['10C', 'one zero center'],
    ['28', 'two eight'],
    ['XYZ', 'XYZ'],
  ])('speaks %s as "%s"', (runway, spoken) => {
    expect(speakRunway(runway)).toBe(spoken);
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
    ['ENI', 'Mendocino VOR'],
    ['RBL', 'Red Bluff VOR'],
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
    ['J501', 'Jay five zero one'],
    ['V6', 'Victor six'],
    ['V244', 'Victor two forty-four'],
    ['Q124', 'Queue one twenty-four'],
    ['Q174', 'Queue one seventy-four'],
    ['T575', 'Tango five seventy-five'],
    ['B932', 'Bravo nine thirty-two'],
    ['HAWKZ7', 'Hawkz Seven arrival'],
    ['CCR2', 'Concord Two arrival'],
    ['DEDHD', 'Dedhd'],
    ['ENI', 'Mendocino VOR'],
  ])('speaks %s as "%s"', (token, spoken) => {
    expect(speakRouteToken(token, fixSpoken)).toBe(spoken);
  });
});

type ClearanceParts = {
  procedure?: ResolvedClearance['procedure']['value'];
  route?: ResolvedClearance['route']['value'];
  altitude?: ResolvedClearance['altitude']['value'];
  expect?: ResolvedClearance['expect']['value'];
};

function clearance(parts: ClearanceParts = {}): ResolvedClearance {
  return {
    clearedTo: { value: 'KSEA', citations: [] },
    runway: { value: '01R', citations: [] },
    procedure: {
      value: parts.procedure ?? {
        kind: 'sid',
        id: 'TRUKN2',
        family: 'TRUKN',
        spoken: 'Trukn Two',
      },
      citations: [],
    },
    route: { value: parts.route ?? { template: 'transition', fix: 'DEDHD' }, citations: [] },
    altitude: { value: parts.altitude ?? { phrase: 'climb_via' }, citations: [] },
    expect: { value: parts.expect ?? null, citations: [] },
    redundantExpect: { value: null, citations: [] },
    frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [] },
  };
}

/** The speak input; `originalRoute` follows the filed route unless a test amends the plan. */
function input(overrides: Partial<SpeakClearanceInput> = {}): SpeakClearanceInput {
  const filedRoute = overrides.filedRoute ?? 'TRUKN2 DEDHD RBL HAWKZ7';
  return {
    callsign: 'UAL320',
    clearance: clearance(),
    destinationSpoken: 'Seattle',
    filedRoute,
    originalRoute: filedRoute,
    airportFaa: 'SFO',
    squawk: '3342',
    telephony,
    fixSpoken,
    sidTransitions: [{ fix: 'DEDHD', spoken: 'Dedhd' }],
    ...overrides,
  };
}

const closing =
  'Climb via SID. Departure frequency one two zero point niner, squawk three three four two. ' +
  'Expect runway one right.';

describe('asFiledJoin', () => {
  it('joins at the exit element when the two routes are the same', () => {
    expect(asFiledJoin(['DEDHD', 'RBL', 'HAWKZ7'], ['DEDHD', 'RBL', 'HAWKZ7'])).toBe(0);
  });

  it('joins at the fix the two routes run together from', () => {
    expect(asFiledJoin(['OAK', 'V6', 'SAC'], ['SGD', 'SAC'])).toBe(2);
  });

  it('joins at the fix after the airway a shared tail opens on', () => {
    expect(
      asFiledJoin(['OAK', 'V6', 'SAC', 'V23', 'YUBBA'], ['SGD', 'V6', 'SAC', 'V23', 'YUBBA']),
    ).toBe(2);
  });

  it('joins nowhere when the shared tail is an airway with no fix after it', () => {
    expect(asFiledJoin(['OAK', 'V6'], ['SGD', 'V6'])).toBeUndefined();
  });

  it('joins nowhere when the two routes share no tail', () => {
    expect(asFiledJoin(['OAK', 'SAC'], ['PXN', 'AVE'])).toBeUndefined();
  });

  it('joins nowhere when the amended route has nothing after the procedure', () => {
    expect(asFiledJoin([], ['SGD', 'SAC'])).toBeUndefined();
  });
});

describe('speakClearance', () => {
  it('reads the abbreviated clearance the way clearance delivery does', () => {
    expect(speakClearance(input()).abbreviated).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Dedhd transition, ' +
        'then as filed. Climb via SID. Departure frequency one two zero point niner, ' +
        'squawk three three four two. Expect runway one right.',
    );
  });

  it('reads the filed route in place of "then as filed"', () => {
    expect(speakClearance(input()).fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Dedhd transition, ' +
        'direct Red Bluff VOR, Hawkz Seven arrival. Climb via SID. ' +
        'Departure frequency one two zero point niner, squawk three three four two. ' +
        'Expect runway one right.',
    );
  });

  it('ends both forms with the departure runway', () => {
    const spoken = speakClearance(input());
    expect(spoken.abbreviated).toMatch(/squawk three three four two\. Expect runway one right\.$/);
    expect(spoken.fullRoute).toMatch(/squawk three three four two\. Expect runway one right\.$/);
  });

  it('speaks a transition by its published name and a vectored navaid by its facility', () => {
    const vectored = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'MOLEN9', family: 'MOLEN', spoken: 'Molen Nine' },
          route: { template: 'radar_vectors_fix', fix: 'ENI' },
        }),
        filedRoute: 'MOLEN9 ENI',
        sidTransitions: [{ fix: 'ENI', spoken: 'Mendocino' }],
      }),
    );
    const transitioned = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'MOLEN9', family: 'MOLEN', spoken: 'Molen Nine' },
          route: { template: 'transition', fix: 'ENI' },
        }),
        filedRoute: 'MOLEN9 ENI',
        sidTransitions: [{ fix: 'ENI', spoken: 'Mendocino' }],
      }),
    );
    expect(vectored.fullRoute).toContain(
      'Molen Nine departure, radar vectors Mendocino VOR, direct.',
    );
    expect(transitioned.fullRoute).toContain('Molen Nine departure, Mendocino transition, direct.');
  });

  it('speaks radar vectors to the fix for a radar-vector SID', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'SFO5', family: 'SFO', spoken: 'San Francisco Five' },
          route: { template: 'radar_vectors_fix', fix: 'RBL' },
        }),
        filedRoute: 'SFO5 RBL J5 OED',
      }),
    );
    expect(spoken.abbreviated).toContain(
      'San Francisco Five departure, radar vectors Red Bluff VOR, then as filed.',
    );
    expect(spoken.fullRoute).toContain(
      'San Francisco Five departure, radar vectors Red Bluff VOR, Jay five, Rogue Valley VOR, direct.',
    );
  });

  it('speaks a clearance with no DP as the runway heading and vectors to the first fix', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: {
            kind: 'heading',
            heading: 'runway heading',
            turn: undefined,
            spoken: 'fly runway heading',
          },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
          altitude: { phrase: 'maintain', feet: 5000 },
          expect: { kind: 'filed', feet: 9000, minutes: 10 },
        }),
        callsign: 'N172SP',
        destinationSpoken: 'Yuba County',
        filedRoute: 'OAK V6 SAC',
        sidTransitions: [],
      }),
    );
    expect(spoken.abbreviated).toBe(
      'November one seven two sierra papa, cleared to Yuba County airport, via fly runway heading, ' +
        'radar vectors Oakland VOR, then as filed. Maintain five thousand. ' +
        'Expect niner thousand one zero minutes after departure. ' +
        'Departure frequency one two zero point niner, squawk three three four two. ' +
        'Expect runway one right.',
    );
    expect(spoken.fullRoute).toContain(
      'via fly runway heading, radar vectors Oakland VOR, Victor six, Sacramento VOR, direct.',
    );
  });

  /** The reading of a clearance the SOP sends off on the heading its row names. */
  function headingReading(heading: number, turn: 'left' | 'right' | undefined, spoken: string) {
    return speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'heading', heading, turn, spoken },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
          altitude: { phrase: 'maintain', feet: 5000 },
          expect: { kind: 'filed', feet: 9000, minutes: 10 },
        }),
        callsign: 'N172SP',
        destinationSpoken: 'Yuba County',
        filedRoute: 'OAK V6 SAC',
        sidTransitions: [],
      }),
    );
  }

  it('speaks a numbered heading with its turn and its digits one by one', () => {
    const spoken = headingReading(270, 'left', 'turn left heading 270');
    expect(spoken.abbreviated).toContain(
      'cleared to Yuba County airport, via turn left heading two seven zero, radar vectors Oakland VOR, then as filed.',
    );
  });

  it('speaks a heading on the runway bearing without a turn', () => {
    const spoken = headingReading(284, undefined, 'fly heading 284');
    expect(spoken.abbreviated).toContain(
      'cleared to Yuba County airport, via fly heading two eight four, radar vectors Oakland VOR, then as filed.',
    );
  });

  it('speaks an as-filed route with nothing after the fix it hands over on', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({ route: { template: 'as_filed', fix: 'TRUKN' } }),
        filedRoute: 'TRUKN2 TRUKN',
      }),
    );
    expect(spoken.abbreviated).toContain('Trukn Two departure, Trukn, direct.');
    expect(spoken.fullRoute).toContain('Trukn Two departure, Trukn, direct. Climb via SID.');
  });

  it('drops the facility word from a navaid an as-filed route hands over on', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'MOLEN9', family: 'MOLEN', spoken: 'Molen Nine' },
          route: { template: 'as_filed', fix: 'CCR' },
        }),
        filedRoute: 'MOLEN9 CCR RBL',
        sidTransitions: [],
      }),
    );
    expect(spoken.abbreviated).toContain('Molen Nine departure, Concord, then as filed.');
    expect(spoken.fullRoute).toContain('Molen Nine departure, Concord, direct Red Bluff VOR,');
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
          expect: { kind: 'filed', feet: 32000, minutes: 10 },
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
      input({ clearance: clearance({ expect: { kind: 'filed', feet: 17000, minutes: 3 } }) }),
    );
    expect(spoken.abbreviated).toContain(
      'Expect one seven thousand three minutes after departure.',
    );
  });

  it('speaks an amended expect clause as the amended altitude', () => {
    const spoken = speakClearance(
      input({ clearance: clearance({ expect: { kind: 'amended', feet: 27000, minutes: 10 } }) }),
    );
    expect(spoken.abbreviated).toContain(
      'Expect amended flight level two seven zero one zero minutes after departure.',
    );
  });

  it('speaks the final-altitude reading in place of the expect clause', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          altitude: { phrase: 'climb_via_except', feet: 9000 },
          expect: { kind: 'final', feet: 9000 },
        }),
      }),
    );
    expect(spoken.abbreviated).toContain(
      'Climb via SID except maintain niner thousand. Niner thousand will be your final.',
    );
  });

  it('drops a stale SID version from the full route', () => {
    const spoken = speakClearance(input({ filedRoute: 'TRUKN1 DEDHD J70' }));
    expect(spoken.fullRoute).toContain(
      'Trukn Two departure, Dedhd transition, Jay seventy, direct.',
    );
  });

  it('neither spells the filed procedure nor repeats the transition fix', () => {
    const spoken = speakClearance(input({ filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ7' }));
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Dedhd transition, ' +
        `direct Red Bluff VOR, direct Klamath Falls VOR, Hawkz Seven arrival. ${closing}`,
    );
  });

  it('reads a radar-vector route from after the fix the vectors go to', () => {
    const spoken = speakClearance(
      input({
        callsign: 'N483KA',
        clearance: clearance({
          procedure: { kind: 'sid', id: 'SFO5', family: 'SFO', spoken: 'San Francisco Five' },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
        }),
        filedRoute: 'GAPP7 OAK V244 ALTAM V392 SAC V6 SWR TRUCK',
      }),
    );
    expect(spoken.fullRoute).toBe(
      'November four eight three kilo alpha, cleared to Seattle airport, ' +
        'San Francisco Five departure, radar vectors Oakland VOR, Victor two forty-four, Altam, ' +
        `Victor three ninety-two, Sacramento VOR, Victor six, Palisades VOR, direct Truck, direct. ${closing}`,
    );
  });

  it('names the base fix of an as-filed clearance once, and not again in the route', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({ route: { template: 'as_filed', fix: 'TRUKN' } }),
        filedRoute: 'TRUKN2 TRUKN CCR CCR2',
      }),
    );
    expect(spoken.abbreviated).toContain('Trukn Two departure, Trukn, then as filed.');
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Trukn Two departure, Trukn, ' +
        `direct Concord VOR, Concord Two arrival. ${closing}`,
    );
  });

  it('speaks radar vectors to join an airway and reads the fix it leads to bare', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'SFO5', family: 'SFO', spoken: 'San Francisco Five' },
          route: { template: 'radar_vectors_airway', fix: 'V6' },
        }),
        filedRoute: 'SFO4 V6 SAC DEDHD',
      }),
    );
    expect(spoken.abbreviated).toContain(
      'San Francisco Five departure, radar vectors to join Victor six, then as filed.',
    );
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, San Francisco Five departure, ' +
        `radar vectors to join Victor six, Sacramento VOR, direct Dedhd, direct. ${closing}`,
    );
  });

  it('ends an airway clearance with a bare direct when the airway leads to the last fix', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'SFO5', family: 'SFO', spoken: 'San Francisco Five' },
          route: { template: 'radar_vectors_airway', fix: 'V6' },
        }),
        filedRoute: 'SFO4 V6 SAC',
      }),
    );
    expect(spoken.fullRoute).toContain(
      'San Francisco Five departure, radar vectors to join Victor six, Sacramento VOR, direct.',
    );
  });

  it('reads a vectored fix, a direct fix and a final arrival as one unit each', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'OAK6', family: 'OAK', spoken: 'Oak Six' },
          route: { template: 'radar_vectors_fix', fix: 'SAC' },
        }),
        filedRoute: 'OAK6 SAC DEDHD FILMR2',
      }),
    );
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Oak Six departure, ' +
        `radar vectors Sacramento VOR, direct Dedhd, Filmr Two arrival. ${closing}`,
    );
  });

  it('ends a route that does not finish on an arrival with a bare direct', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'OAK6', family: 'OAK', spoken: 'Oak Six' },
          route: { template: 'radar_vectors_fix', fix: 'SAC' },
        }),
        filedRoute: 'OAK6 SAC DEDHD',
      }),
    );
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Oak Six departure, ' +
        `radar vectors Sacramento VOR, direct Dedhd, direct. ${closing}`,
    );
  });

  it('abbreviates a route with nothing after the exit fix as direct', () => {
    const spoken = speakClearance(
      input({
        callsign: 'N172SP',
        clearance: clearance({
          procedure: { kind: 'sid', id: 'GAPP7', family: 'GAPP', spoken: 'Gap Seven' },
          route: { template: 'radar_vectors_fix', fix: 'EUGEN' },
        }),
        filedRoute: 'GAPP7 EUGEN',
      }),
    );
    expect(spoken.abbreviated).toContain('Gap Seven departure, radar vectors Eugen, direct.');
    expect(spoken.fullRoute).toBe(spoken.abbreviated);
  });

  it('reads the abbreviated clearance when the transition fix ends the filed route', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'WESLA5', family: 'WESLA', spoken: 'Wesla Five' },
          route: { template: 'transition', fix: 'NTELL' },
        }),
        filedRoute: 'WESLA5 NTELL',
      }),
    );
    expect(spoken.fullRoute).toBe(
      'United three twenty, cleared to Seattle airport, Wesla Five departure, ' +
        `Ntell transition, direct. ${closing}`,
    );
    expect(spoken.fullRoute).toBe(spoken.abbreviated);
  });

  it('reads an amended route in full where the pilot has nothing left to fly as filed', () => {
    const spoken = speakClearance(
      input({
        callsign: 'N172SP',
        clearance: clearance({
          procedure: { kind: 'sid', id: 'GAPP7', family: 'GAPP', spoken: 'Gap Seven' },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
        }),
        filedRoute: 'GAPP7 OAK V6 SAC',
        originalRoute: 'SGD SAC',
      }),
    );
    expect(spoken.abbreviated).toContain(
      'Gap Seven departure, radar vectors Oakland VOR, Victor six, Sacramento VOR, direct.',
    );
    expect(spoken.fullRoute).toBe(spoken.abbreviated);
  });

  it('hands an amended procedure over as filed at the transition the two routes share', () => {
    const spoken = speakClearance(
      input({
        callsign: 'N483KA',
        clearance: clearance({
          procedure: { kind: 'sid', id: 'SSTIK5', family: 'SSTIK', spoken: 'Sstik Five' },
          route: { template: 'transition', fix: 'NTELL' },
        }),
        filedRoute: 'SSTIK5 NTELL Q162 ESSAA BTY SUNST4',
        originalRoute: 'WESLA5 NTELL Q162 ESSAA BTY SUNST4',
        sidTransitions: [{ fix: 'NTELL', spoken: 'Ntell' }],
      }),
    );
    expect(spoken.abbreviated).toContain('Sstik Five departure, Ntell transition, then as filed.');
  });

  it('reads an amended route out to the fix it rejoins the filed one at', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'GAPP7', family: 'GAPP', spoken: 'Gap Seven' },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
        }),
        filedRoute: 'GAPP7 OAK V6 SAC V23 YUBBA',
        originalRoute: 'GAPP7 SGD V6 SAC V23 YUBBA',
      }),
    );
    expect(spoken.abbreviated).toContain(
      'Gap Seven departure, radar vectors Oakland VOR, Victor six, Sacramento VOR, then as filed.',
    );
    expect(spoken.fullRoute).toContain(
      'Gap Seven departure, radar vectors Oakland VOR, Victor six, Sacramento VOR, ' +
        'Victor twenty-three, Yubba, direct.',
    );
  });

  it('reads a built route out to the fix it joins the filed route at', () => {
    const issued = clearance({
      procedure: { kind: 'sid', id: 'CNDEL5', family: 'CNDEL', spoken: 'Candle Five' },
      route: { template: 'transition', fix: 'YYUNG' },
    });
    const spoken = speakClearance(
      input({
        callsign: 'SWA344',
        clearance: {
          ...issued,
          runway: { value: '30', citations: [] },
          frequency: { value: { value: '135.1', sectorId: 'sutro' }, citations: [] },
        },
        destinationSpoken: 'San Diego',
        filedRoute: 'CNDEL5 YYUNG LAX COMIX2',
        originalRoute: 'COAST9 MCKEY LAX COMIX2',
        airportFaa: 'OAK',
        squawk: '3331',
        sidTransitions: [{ fix: 'YYUNG', spoken: 'Yyung' }],
      }),
    );
    expect(spoken.abbreviated).toBe(
      'Southwest three forty-four, cleared to San Diego airport, Candle Five departure, ' +
        'Yyung transition, direct Los Angeles VOR, then as filed. Climb via SID. ' +
        'Departure frequency one three five point one, squawk three three three one. ' +
        'Expect runway three zero.',
    );
    expect(spoken.fullRoute).toContain(
      'Candle Five departure, Yyung transition, direct Los Angeles VOR, Comix Two arrival.',
    );
  });

  it('keeps a registration callsign phonetic', () => {
    expect(speakClearance(input({ callsign: 'N483KA' })).abbreviated).toContain(
      'November four eight three kilo alpha, cleared to Seattle airport,',
    );
  });
});

describe('speakClearance parts', () => {
  it('reads the clearance as its parts, in CRAFT order', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: {
            kind: 'heading',
            heading: 'runway heading',
            turn: undefined,
            spoken: 'fly runway heading',
          },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
          altitude: { phrase: 'maintain', feet: 5000 },
          expect: { kind: 'filed', feet: 9000, minutes: 10 },
        }),
        callsign: 'N172SP',
        destinationSpoken: 'Yuba County',
        filedRoute: 'OAK V6 SAC',
        sidTransitions: [],
      }),
    );
    expect(spoken.parts).toEqual([
      { element: 'callsign', words: 'November one seven two sierra papa' },
      { element: 'C', words: 'cleared to Yuba County airport' },
      { element: 'R.sid', words: 'via fly runway heading' },
      { element: 'R.route', words: 'radar vectors Oakland VOR, then as filed' },
      { element: 'A.phrase', words: 'maintain five thousand' },
      { element: 'A.expect', words: 'expect niner thousand one zero minutes after departure' },
      { element: 'F', words: 'departure frequency one two zero point niner' },
      { element: 'T', words: 'squawk three three four two' },
      { element: 'RWY', words: 'expect runway one right' },
    ]);
  });

  it('carries the full-route words where the amended route is handed over as filed', () => {
    const spoken = speakClearance(
      input({
        clearance: clearance({
          procedure: { kind: 'sid', id: 'GAPP7', family: 'GAPP', spoken: 'Gap Seven' },
          route: { template: 'radar_vectors_fix', fix: 'OAK' },
        }),
        filedRoute: 'GAPP7 OAK V6 SAC V23 YUBBA',
        originalRoute: 'GAPP7 SGD V6 SAC V23 YUBBA',
      }),
    );
    const route = spoken.parts.find((part) => part.element === 'R.route');
    expect(route?.words).toBe(
      'radar vectors Oakland VOR, Victor six, Sacramento VOR, then as filed',
    );
    expect(spoken.fullRouteWords).toBe(
      'radar vectors Oakland VOR, Victor six, Sacramento VOR, Victor twenty-three, Yubba, direct',
    );
    const fullParts = spoken.parts.map((part) =>
      part.element === 'R.route' ? { ...part, words: spoken.fullRouteWords } : part,
    );
    expect(spoken.fullRoute).toBe(joinSpoken(fullParts));
  });

  it('leaves out the expect part where no expect clause is spoken', () => {
    const spoken = speakClearance(input());
    expect(spoken.parts.map((part) => part.element)).not.toContain('A.expect');
    expect(joinSpoken(spoken.parts)).toBe(spoken.abbreviated);
  });
});
