import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AircraftClass, AirportData, Direction, Scenario } from '@/data/schema.ts';
import { explainRunway } from '@/rules/runway.ts';

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

type Case = {
  name: string;
  configId: string;
  aircraftClass: AircraftClass;
  runway: string;
  direction: Direction | undefined;
  ruleId: string;
};

const CASES: Case[] = [
  {
    name: 'the class the configuration defaults to a runway',
    configId: '28/01',
    aircraftClass: 'T',
    runway: '28R',
    direction: undefined,
    ruleId: 'RWY-CLASS-DEFAULT',
  },
  {
    name: 'a jet on the runway 28/01 issues only on request',
    configId: '28/01',
    aircraftClass: 'J',
    runway: '28L',
    direction: 'north',
    ruleId: 'RWY-ON-REQUEST',
  },
  {
    name: 'a northbound jet on the 01s',
    configId: '28/01',
    aircraftClass: 'J',
    runway: '01R',
    direction: 'north',
    ruleId: 'RWY-DIRECTION',
  },
  {
    name: 'a southbound jet on the 01s',
    configId: '28/01',
    aircraftClass: 'J',
    runway: '01L',
    direction: 'south',
    ruleId: 'RWY-DIRECTION',
  },
  {
    name: 'a northbound jet on the 28s of 28 RT',
    configId: '28 RT',
    aircraftClass: 'J',
    runway: '28L',
    direction: 'north',
    ruleId: 'RWY-DIRECTION',
  },
  {
    name: 'a prop with no gate direction to split the family by',
    configId: '01/01',
    aircraftClass: 'P',
    runway: '01L',
    direction: undefined,
    ruleId: 'RWY-FIRST',
  },
];

describe('explainRunway on the generated KSFO data', () => {
  it.each(CASES)(
    'cites the configuration and the mechanism for $name',
    ({ configId, aircraftClass, runway, direction, ruleId }) => {
      const cited = explainRunway(
        scenario({ runwayConfigId: configId, departureRunway: runway }),
        ksfo,
        aircraftClass,
        direction,
      );
      expect(cited.value).toBe(runway);
      expect(cited.citations.map((citation) => citation.id)).toEqual([configId, ruleId]);
    },
  );

  it('quotes the configuration by its SOP name and source', () => {
    const [config] = explainRunway(scenario({}), ksfo, 'J', 'north').citations;
    expect(config).toStrictEqual({
      id: '28/01',
      source: 'SFO ATCT SOP 1-7',
      text: 'Landing runways 28, departing runways 01',
    });
  });

  it('quotes the mechanism row the data carries', () => {
    const citations = explainRunway(
      scenario({ departureRunway: '28R' }),
      ksfo,
      'T',
      undefined,
    ).citations;
    const mechanism = citations.at(-1);
    expect(mechanism?.id).toBe('RWY-CLASS-DEFAULT');
    expect(mechanism?.text.length).toBeGreaterThan(0);
    expect(mechanism?.source.length).toBeGreaterThan(0);
  });

  it('cites the mechanism alone when the configuration is not in the data', () => {
    const cited = explainRunway(
      scenario({ runwayConfigId: '14/14', departureRunway: '14L' }),
      ksfo,
      'J',
      'north',
    );
    expect(cited.value).toBe('14L');
    expect(cited.citations.map((citation) => citation.id)).toEqual(['RWY-FIRST']);
  });
});
