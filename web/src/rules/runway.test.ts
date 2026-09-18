import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AircraftClass, AirportData, Direction, Scenario } from '@/data/schema.ts';
import { airlineOf, explainRunway } from '@/rules/runway.ts';

const ksfo = ksfoJson as unknown as AirportData;
const koak = koakJson as unknown as AirportData;

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

const PROP_CLASSES: AircraftClass[] = ['P', 'T'];

/** KSFO with the 28L row of 28/01 turned into the prop default for the airline PCM. */
function withPcmOff28L(): AirportData {
  return {
    ...ksfo,
    runwayConfigs: ksfo.runwayConfigs.map((config) =>
      config.id !== '28/01'
        ? config
        : {
            ...config,
            departureRunways: config.departureRunways.map((row) =>
              row.runway !== '28L'
                ? row
                : {
                    ...row,
                    classes: PROP_CLASSES,
                    defaultForAirlines: ['PCM'],
                    defaultForGroups: [],
                    onRequestFor: [],
                  },
            ),
          },
    ),
    phraseologyRules: [
      ...ksfo.phraseologyRules,
      {
        id: 'RWY-AIRLINE-DEFAULT',
        source: 'OAK ATCT SOP 2-1',
        text: 'an airline whose ramp is on the other side of the field departs the runway it parks on',
      },
    ],
  };
}

/** KSFO with a 30 added to 28/01 that the group holding the jets and the Dash 8 departs by default. */
function withDash8Off30(): AirportData {
  return {
    ...ksfo,
    aircraftGroups: { jets_and_dh8d: { classes: ['J'], types: ['DH8D'] } },
    runwayConfigs: ksfo.runwayConfigs.map((config) =>
      config.id !== '28/01'
        ? config
        : {
            ...config,
            departureRunways: [
              ...config.departureRunways,
              {
                runway: '30',
                classes: PROP_CLASSES,
                defaultForAirlines: [],
                defaultForGroups: ['jets_and_dh8d'],
                defaultForClasses: [],
                onRequestFor: [],
              },
            ],
          },
    ),
    phraseologyRules: [
      ...ksfo.phraseologyRules,
      {
        id: 'RWY-GROUP-DEFAULT',
        source: 'OAK ATCT SOP 3-4',
        text: 'the turboprops the SOP groups with the jets depart the runway the jets do',
      },
    ],
  };
}

describe('airlineOf', () => {
  it('reads the ICAO code off an airline callsign', () => {
    expect(airlineOf('PCM7679')).toBe('PCM');
  });

  it('reads no code off a registration', () => {
    expect(airlineOf('N483KA')).toBeUndefined();
  });
});

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

  it('cites the airline default ahead of the class default for a defaulted airline', () => {
    const cited = explainRunway(
      scenario({ callsign: 'PCM7679', aircraftType: 'B350', departureRunway: '28L' }),
      withPcmOff28L(),
      'T',
      'north',
    );
    expect(cited.citations.map((citation) => citation.id)).toEqual([
      '28/01',
      'RWY-AIRLINE-DEFAULT',
    ]);
  });

  it('cites the class default for a prop of another airline in the same configuration', () => {
    const cited = explainRunway(
      scenario({ callsign: 'SKW1234', aircraftType: 'B350', departureRunway: '28R' }),
      withPcmOff28L(),
      'T',
      'north',
    );
    expect(cited.citations.map((citation) => citation.id)).toEqual(['28/01', 'RWY-CLASS-DEFAULT']);
  });

  it('cites the group default for a type the group adds outside its classes', () => {
    const cited = explainRunway(
      scenario({ callsign: 'QXE2451', aircraftType: 'DH8D', departureRunway: '30' }),
      withDash8Off30(),
      'T',
      'north',
    );
    expect(cited.citations.map((citation) => citation.id)).toEqual(['28/01', 'RWY-GROUP-DEFAULT']);
  });

  it('cites the class default for a prop outside the group in the same configuration', () => {
    const cited = explainRunway(
      scenario({ callsign: 'SKW1234', aircraftType: 'B350', departureRunway: '28R' }),
      withDash8Off30(),
      'T',
      'north',
    );
    expect(cited.citations.map((citation) => citation.id)).toEqual(['28/01', 'RWY-CLASS-DEFAULT']);
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

describe('explainRunway for a flight its TEC route decides the runway of', () => {
  /** The mechanism the explanation cites, after the configuration. */
  function mechanism(flight: Scenario, airport: AirportData, direction: Direction): string {
    const aircraftClass = airport.aircraftClasses[flight.aircraftType];
    if (aircraftClass === undefined) throw new Error(`${flight.aircraftType} has no class`);
    return explainRunway(flight, airport, aircraftClass, direction).citations.at(-1)?.id ?? '';
  }

  /** A KOAK SFOW prop to KMRY, whose TEC route begins on NUEVO#, which 33 does not publish. */
  function kmryProp(departureRunway: string): Scenario {
    return scenario({
      callsign: 'N172SP',
      aircraftType: 'C172',
      equipmentSuffix: '/G',
      destination: 'KMRY',
      filedRoute: 'NUEVO8 EUGEN',
      filedAltitude: 7000,
      runwayConfigId: 'SFOW',
      departureRunway,
    });
  }

  it('cites RWY-TEC for the TBM9 to KSMF the draw moves off the 28R class default to 01R', () => {
    const flight = scenario({
      callsign: 'N436MS',
      aircraftType: 'TBM9',
      destination: 'KSMF',
      filedRoute: 'TRUKN2 TRUKN FEVTA FEVTA1',
      filedAltitude: 10000,
      departureRunway: '01R',
    });
    expect(mechanism(flight, ksfo, 'north')).toBe('RWY-TEC');
  });

  it('keeps RWY-CLASS-DEFAULT for a flight on its class default whose TEC route is usable there', () => {
    expect(mechanism(kmryProp('28R'), koak, 'south')).toBe('RWY-CLASS-DEFAULT');
  });

  it('cites RWY-DIRECTION for the 01/01 jet to KSMF on 01R, the runway its northbound turn takes', () => {
    const flight = scenario({
      destination: 'KSMF',
      filedRoute: 'TRUKN2 TRUKN FEVTA FEVTA1',
      filedAltitude: 10000,
      runwayConfigId: '01/01',
      departureRunway: '01R',
    });
    expect(mechanism(flight, ksfo, 'north')).toBe('RWY-DIRECTION');
  });

  it('cites RWY-TEC for a runway only the TEC route explains, another listed runway having no row', () => {
    expect(mechanism(kmryProp('28L'), koak, 'south')).toBe('RWY-TEC');
  });
});
