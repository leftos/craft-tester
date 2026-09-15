import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, NoiseWindow, Scenario } from '@/data/schema.ts';
import { classify, isNoiseWindowActive } from '@/rules/classify.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

const BASE: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  rnavCapable: true,
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

  it('blocks the SID element on an aircraft type with no class', () => {
    const result = classify(scenario({ aircraftType: 'XXXX' }), ksfo);
    expect(result).toEqual({ element: 'R.sid', reason: expect.stringContaining('XXXX') });
  });

  it('blocks the SID element on a runway configuration the data does not have', () => {
    const result = classify(scenario({ runwayConfigId: '13/31' }), ksfo);
    expect(result).toEqual({ element: 'R.sid', reason: expect.stringContaining('13/31') });
  });
});
