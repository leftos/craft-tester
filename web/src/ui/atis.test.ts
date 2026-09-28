import { beforeAll, describe, expect, it } from 'vitest';
import type { AirportData, RunwayConfig, Scenario } from '@/data/schema.ts';
import { advertisedRunways, atisSummary } from '@/ui/atis.ts';
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
      trainingWeight: 1,
      arrivalRunways: ['28L', '28R'],
      departureRunways: [
        {
          runway: '01L',
          classes: ['J'],
          defaultForAirlines: [],
          defaultForGroups: [],
          defaultForClasses: [],
          onRequestFor: [],
        },
        {
          runway: '01R',
          classes: ['P', 'T'],
          defaultForAirlines: [],
          defaultForGroups: [],
          defaultForClasses: ['P', 'T'],
          onRequestFor: [],
        },
        {
          runway: '28L',
          classes: ['J'],
          defaultForAirlines: [],
          defaultForGroups: [],
          defaultForClasses: [],
          onRequestFor: ['cargo'],
        },
        {
          runway: '01L',
          classes: ['P', 'T'],
          defaultForAirlines: [],
          defaultForGroups: [],
          defaultForClasses: [],
          onRequestFor: [],
        },
      ],
    };
    expect(advertisedRunways(config)).toEqual(['01L']);
  });

  it('leaves out an airline default, which is no more in normal use than a class default', () => {
    const config: RunwayConfig = {
      id: 'TEST',
      source: 'test data',
      name: 'test configuration',
      plan: 'SFOW',
      trainingWeight: 1,
      arrivalRunways: ['28L', '28R'],
      departureRunways: [
        {
          runway: '28R',
          classes: ['P', 'T'],
          defaultForAirlines: [],
          defaultForGroups: [],
          defaultForClasses: [],
          onRequestFor: [],
        },
        {
          runway: '28L',
          classes: ['P', 'T'],
          defaultForAirlines: ['PCM'],
          defaultForGroups: [],
          defaultForClasses: [],
          onRequestFor: [],
        },
      ],
    };
    expect(advertisedRunways(config)).toEqual(['28R']);
  });

  it('leaves out a group default, which is no more in normal use than a class default', () => {
    const config: RunwayConfig = {
      id: 'TEST',
      source: 'test data',
      name: 'test configuration',
      plan: 'SFOW',
      trainingWeight: 1,
      arrivalRunways: ['28L', '28R'],
      departureRunways: [
        {
          runway: '28R',
          classes: ['P', 'T'],
          defaultForAirlines: [],
          defaultForGroups: [],
          defaultForClasses: [],
          onRequestFor: [],
        },
        {
          runway: '30',
          classes: ['P', 'T'],
          defaultForAirlines: [],
          defaultForGroups: ['jets_and_dh8d'],
          defaultForClasses: [],
          onRequestFor: [],
        },
      ],
    };
    expect(advertisedRunways(config)).toEqual(['28R']);
  });
});

/** A KSFO plan in 28/01 on a Tuesday afternoon, which names no notices of its own. */
const PLAN: Scenario = {
  callsign: 'UAL313',
  aircraftType: 'B738',
  equipmentSuffix: '/L',
  destination: 'KLAS',
  filedRoute: 'SSTIK4 SNS',
  filedAltitude: 29000,
  runwayConfigId: '28/01',
  departureRunway: '01L',
  localTime: '1246',
  dayOfWeek: 'tuesday',
  squawk: '4614',
};

describe('atisSummary', () => {
  it('reads the configuration, the runways in normal use, the time and the advisories', () => {
    expect(atisSummary(PLAN, airport)).toEqual([
      '28/01',
      'Dep 01L 01R',
      '1246L Tuesday',
      '1 advisory',
    ]);
  });

  it('counts no advisories where the plan cancels the defaults', () => {
    expect(atisSummary({ ...PLAN, activeNotices: [] }, airport).at(-1)).toBe('No advisories');
  });

  it('counts several advisories in the plural', () => {
    const [notice] = airport.notices;
    if (notice === undefined) throw new Error('KSFO has no notices');
    const two = { ...airport, notices: [notice, { ...notice, id: 'SECOND' }] };
    expect(atisSummary(PLAN, two).at(-1)).toBe('2 advisories');
  });

  it('keeps the id of a configuration the data does not list, with no runways', () => {
    const summary = atisSummary({ ...PLAN, runwayConfigId: 'NONE' }, airport);
    expect(summary.slice(0, 2)).toEqual(['NONE', 'Dep —']);
  });
});
