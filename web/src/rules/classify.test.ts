import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, NoiseWindow, Scenario } from '@/data/schema.ts';
import type { Classification, RuleAudience } from '@/rules/classify.ts';
import { addresses, classify, inAnyGroup, isNoiseWindowActive } from '@/rules/classify.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

const BASE: Scenario = {
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

function scenario(overrides: Partial<Scenario>): Scenario {
  return Object.assign({ ...BASE }, overrides);
}

/**
 * KSFO defines no aircraft groups and publishes no approach categories, so the rows that address a
 * flight by group or by category are exercised against a spread of it: a group that takes the jets
 * whole and adds the DH8D, and three turboprops whose fleet rows carry category B, category C and
 * no category at all.
 */
const grouped: AirportData = {
  ...ksfo,
  aircraftClasses: { ...ksfo.aircraftClasses, DH8D: 'T', AT72: 'T', SF34: 'T' },
  aircraftGroups: { jets_and_dh8d: { classes: ['J'], types: ['DH8D'] } },
  routeLibrary: {
    ...ksfo.routeLibrary,
    fleet: [
      ...ksfo.routeLibrary.fleet,
      {
        type: 'DH8D',
        class: 'T',
        wtc: 'M',
        suffixes: ['/L'],
        airlines: ['QXE'],
        approachCategory: 'B',
      },
      {
        type: 'AT72',
        class: 'T',
        wtc: 'M',
        suffixes: ['/L'],
        airlines: ['QXE'],
        approachCategory: 'C',
      },
      { type: 'SF34', class: 'T', wtc: 'M', suffixes: ['/L'], airlines: ['QXE'] },
    ],
  },
};

/** The classification of a flight of `aircraftType` at the airport with the groups. */
function classified(aircraftType: string): Classification {
  const result = classify(scenario({ aircraftType }), grouped);
  if (isUnresolved(result)) throw new Error(result.reason);
  return result;
}

/** A row addressing the jets by class and the DH8D by group, as the OAK SOP's "J & DH8D" rows do. */
const jetsAndDh8d: RuleAudience = { id: 'OAK-J-DH8D', classes: ['J'], groups: ['jets_and_dh8d'] };

const night: NoiseWindow = { id: 'night', start: '2200', end: '0700', sundayEnd: '0800' };
const lateNight: NoiseWindow = { id: 'late_night', start: '0100', end: '0500' };

describe('isNoiseWindowActive', () => {
  it.each([
    ['2200', 'tuesday', true],
    ['2300', 'tuesday', true],
    ['0300', 'tuesday', true],
    ['0659', 'tuesday', true],
    ['0700', 'tuesday', false],
    ['1400', 'tuesday', false],
    ['0730', 'tuesday', false],
    ['0730', 'sunday', true],
    ['0800', 'sunday', false],
  ] as const)('a window that wraps midnight is %s open at %s on %s', (time, day, expected) => {
    expect(isNoiseWindowActive(night, time, day)).toBe(expected);
  });

  it.each([
    ['0100', true],
    ['0300', true],
    ['0500', false],
    ['2300', false],
  ] as const)('a window inside one day is open at %s: %s', (time, expected) => {
    expect(isNoiseWindowActive(lateNight, time, 'tuesday')).toBe(expected);
  });

  it('falls back to the weekday end when the window has no Sunday end', () => {
    expect(isNoiseWindowActive(lateNight, '0600', 'sunday')).toBe(false);
  });
});

describe('classify', () => {
  it('reads the class, plan, runway family, and config from the data', () => {
    const result = classify(scenario({}), ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.aircraftClass).toBe('J');
    expect(result.plan).toBe('SFOW');
    expect(result.runwayFamily).toBe('01');
    expect(result.config.id).toBe('28/01');
    expect(result.activeNoiseWindows).toEqual([]);
  });

  it('reports both noise windows in the small hours', () => {
    const result = classify(scenario({ localTime: '0300' }), ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.activeNoiseWindows).toEqual(['night', 'late_night']);
  });

  it('takes the notices the data marks default-active', () => {
    const result = classify(scenario({}), ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.activeNotices).toEqual(['SFO-SEGUL-OFF']);
  });

  it('lets a scenario override the active notices, including with none', () => {
    const result = classify(scenario({ activeNotices: [] }), ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.activeNotices).toEqual([]);
  });

  it.each([
    ['/L', true],
    [null, false],
    ['/Q', false],
  ] as const)('reads RNAV capability from the equipment suffix %s: %s', (suffix, expected) => {
    const result = classify(scenario({ equipmentSuffix: suffix }), ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.rnavCapable).toBe(expected);
  });

  it.each([
    ['/L', true],
    ['/G', true],
    ['/Z', false],
    ['/A', false],
    [null, false],
    ['/Q', false],
  ] as const)('reads GNSS capability from the equipment suffix %s: %s', (suffix, expected) => {
    const result = classify(scenario({ equipmentSuffix: suffix }), ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.gnssCapable).toBe(expected);
  });

  it('blocks the SID element on an aircraft type with no class', () => {
    const result = classify(scenario({ aircraftType: 'XXXX' }), ksfo);
    expect(result).toEqual({ element: 'R.sid', reason: expect.stringContaining('XXXX') });
  });

  it('blocks the SID element on a runway configuration the data does not have', () => {
    const result = classify(scenario({ runwayConfigId: '13/31' }), ksfo);
    expect(result).toEqual({ element: 'R.sid', reason: expect.stringContaining('13/31') });
  });

  it('carries the filed type designator', () => {
    const result = classify(scenario({}), ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.aircraftType).toBe('B738');
  });

  it.each([
    ['DH8D', 'B'],
    ['AT72', 'C'],
    ['SF34', undefined],
  ] as const)('reads the approach category of a %s from the fleet: %s', (type, expected) => {
    expect(classified(type).approachCategory).toBe(expected);
  });

  it('leaves the approach category unset for a type the fleet does not list', () => {
    const noFleet: AirportData = {
      ...grouped,
      routeLibrary: { ...grouped.routeLibrary, fleet: [] },
    };
    const result = classify(scenario({ aircraftType: 'DH8D' }), noFleet);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.approachCategory).toBeUndefined();
  });
});

describe('inAnyGroup', () => {
  it('holds a flight whose class a group takes whole', () => {
    expect(inAnyGroup(['jets_and_dh8d'], 'J', 'B738', grouped)).toBe(true);
  });

  it('holds a flight whose type a group adds outside its classes', () => {
    expect(inAnyGroup(['jets_and_dh8d'], 'T', 'DH8D', grouped)).toBe(true);
  });

  it('holds no flight a group names by neither class nor type', () => {
    expect(inAnyGroup(['jets_and_dh8d'], 'T', 'SF34', grouped)).toBe(false);
  });

  it('holds nothing when no group is named', () => {
    expect(inAnyGroup([], 'J', 'B738', grouped)).toBe(false);
  });

  it('throws when an id is not a group of the airport data', () => {
    expect(() => inAnyGroup(['no_such_group'], 'J', 'B738', grouped)).toThrow(/no_such_group/);
  });
});

describe('addresses', () => {
  it('addresses a flight whose class the row lists', () => {
    expect(addresses(jetsAndDh8d, classified('B738'), grouped)).toBe(true);
  });

  it('addresses a type a group adds outside the classes the row lists', () => {
    expect(addresses(jetsAndDh8d, classified('DH8D'), grouped)).toBe(true);
  });

  it('leaves a turboprop the group does not name to the rows below', () => {
    expect(addresses(jetsAndDh8d, classified('SF34'), grouped)).toBe(false);
  });

  it('addresses a flight whose class a group takes whole', () => {
    const turboprops: RuleAudience = { id: 'OAK-T', classes: [], groups: ['turboprops'] };
    const airport: AirportData = {
      ...grouped,
      aircraftGroups: { turboprops: { classes: ['T'], types: [] } },
    };
    expect(addresses(turboprops, classified('SF34'), airport)).toBe(true);
    expect(addresses(turboprops, classified('B738'), airport)).toBe(false);
  });

  it.each([
    ['DH8D', true],
    ['AT72', false],
    ['SF34', false],
  ] as const)('narrows a row to the categories it names: a %s matches %s', (type, expected) => {
    const catAb: RuleAudience = {
      id: 'OAK-CAT-AB',
      classes: ['P', 'T', 'J'],
      approachCategories: ['A', 'B'],
    };
    expect(addresses(catAb, classified(type), grouped)).toBe(expected);
  });

  it('reaches every category on a row that names none', () => {
    const anyCategory: RuleAudience = { id: 'OAK-ANY', classes: ['T'] };
    expect(addresses(anyCategory, classified('AT72'), grouped)).toBe(true);
    expect(addresses(anyCategory, classified('SF34'), grouped)).toBe(true);
  });

  it('rejects a row naming a group the airport data does not define', () => {
    const ghost: RuleAudience = { id: 'OAK-GHOST', classes: ['J'], groups: ['no_such_group'] };
    expect(() => addresses(ghost, classified('DH8D'), grouped)).toThrow(/OAK-GHOST/);
    expect(() => addresses(ghost, classified('DH8D'), grouped)).toThrow(/no_such_group/);
  });
});
