import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { generateScenario } from '@/scenario/generate.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import { createRng } from '@/scenario/rng.ts';
import { stripRows } from '@/ui/strip.ts';

const ksfo = ksfoJson as unknown as AirportData;
const drawn = generateScenario(createRng(3), ksfo, ANY_SCENARIO);

/** The drawn scenario with the given remarks filed, or with the remarks box left empty. */
function withRemarks(remarks: string | undefined): Scenario {
  const scenario = { ...drawn };
  delete scenario.remarks;
  return { ...scenario, ...(remarks === undefined ? {} : { remarks }) };
}

/** The labels of the strip boxes, in the order the strip prints them. */
function labelsOf(scenario: Scenario): string[] {
  return stripRows(scenario).map(([label]) => label);
}

/** The value the strip prints in one of its boxes. */
function valueOf(scenario: Scenario, label: string): string | undefined {
  return new Map(stripRows(scenario)).get(label);
}

describe('stripRows', () => {
  it('prints the filed remarks between the beacon code and the time', () => {
    const rows = stripRows(withRemarks('REQ RWY 28'));
    expect(rows.map(([label]) => label)).toEqual([
      'callsign',
      'type',
      'destination',
      'altitude',
      'route',
      'squawk',
      'remarks',
      'time',
    ]);
    expect(new Map(rows).get('remarks')).toBe('REQ RWY 28');
  });

  it('leaves the remarks box out when the flight filed none', () => {
    expect(labelsOf(withRemarks(undefined))).not.toContain('remarks');
  });

  it('leaves the remarks box out when the filed remarks are empty', () => {
    expect(labelsOf(withRemarks(''))).not.toContain('remarks');
  });

  it('prints an altitude at or above 18,000 as a flight level and a lower one in feet', () => {
    expect(valueOf({ ...drawn, filedAltitude: 37000 }, 'altitude')).toBe('FL370');
    expect(valueOf({ ...drawn, filedAltitude: 5000 }, 'altitude')).toBe('5,000');
  });
});
