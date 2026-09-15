import { beforeAll, describe, expect, it } from 'vitest';
import type { AirportData, RunwayConfig } from '@/data/schema.ts';
import { advertisedRunways } from '@/ui/atis.ts';
import { loadAirportData } from '@/ui/session.ts';

let airport: AirportData;

/** The configuration of that id in the bundled KSFO data, or a failure naming the id. */
function configOf(id: string): RunwayConfig {
  const config = airport.runwayConfigs.find((row) => row.id === id);
  if (config === undefined) throw new Error(`KSFO has no runway configuration ${id}`);
  return config;
}

beforeAll(async () => {
  airport = await loadAirportData('KSFO');
});

describe('advertisedRunways', () => {
  it('advertises the 01s in 28/01, whose 28s are on request or the prop default', () => {
    expect(advertisedRunways(configOf('28/01'))).toEqual(['01L', '01R']);
  });

  it('advertises the rows of 28 SO that carry neither a request nor a default flag', () => {
    const config = configOf('28 SO');
    const inNormalUse = config.departureRunways
      .filter((row) => row.onRequestFor.length === 0 && row.defaultForClasses.length === 0)
      .map((row) => row.runway);
    expect(advertisedRunways(config)).toEqual(inNormalUse);
    expect(advertisedRunways(config)).toEqual(['28L', '28R']);
  });

  it('leaves out a class default and an on-request runway, and names a runway once', () => {
    const config: RunwayConfig = {
      id: 'TEST',
      source: 'test data',
      name: 'test configuration',
      plan: 'SFOW',
      arrivalRunways: ['28L', '28R'],
      departureRunways: [
        { runway: '01L', classes: ['J'], defaultForClasses: [], onRequestFor: [] },
        { runway: '01R', classes: ['P', 'T'], defaultForClasses: ['P', 'T'], onRequestFor: [] },
        { runway: '28L', classes: ['J'], defaultForClasses: [], onRequestFor: ['cargo'] },
        { runway: '01L', classes: ['P', 'T'], defaultForClasses: [], onRequestFor: [] },
      ],
    };
    expect(advertisedRunways(config)).toEqual(['01L']);
  });
});
