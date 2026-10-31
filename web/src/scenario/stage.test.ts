import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, RunwayConfig } from '@/data/schema.ts';
import type { Procedure } from '@/rules/types.ts';
import type { ConfigFilter, SessionSettings } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import {
  airportLock,
  clampSettings,
  configLock,
  firstOpenAirport,
  isOpenAt,
  runwayLock,
  sidLock,
  stageBlock,
} from '@/scenario/stage.ts';

const koak = koakJson as unknown as AirportData;
const ksfo = ksfoJson as unknown as AirportData;

/** Every airport the trainer lists, in the index's order. */
const INDEX = [
  { icao: 'KSFO', file: 'ksfo.json' },
  { icao: 'KOAK', file: 'koak.json' },
];

/** A stage id no airport file lists, as an old link may carry. */
const RETIRED_STAGE = 'S1-OAK-9';

/** A SID of one family, which is all a stage looks at. */
function sid(family: string): Procedure {
  return { kind: 'sid', id: `${family}1`, family, spoken: family };
}

/** A departure the SOP sends off on a heading with no SID. */
const HEADING: Procedure = {
  kind: 'heading',
  heading: 'runway heading',
  turn: undefined,
  spoken: 'fly runway heading',
};

/** The settings a student who took everything the trainer offers has remembered. */
function everything(config: ConfigFilter = { kind: 'any' }): SessionSettings {
  return {
    filter: { time: 'night', config },
    mode: 'amendment',
    input: 'text',
    fullRoute: true,
    gradeRunway: true,
  };
}

/** One configuration of an airport, by its id. */
function configOf(airport: AirportData, id: string): RunwayConfig {
  const config = airport.runwayConfigs.find((candidate) => candidate.id === id);
  if (config === undefined) throw new Error(`${airport.airport.icao} has no configuration ${id}`);
  return config;
}

/** Whether a configuration of an airport opens at a stage. */
function configOpen(airport: AirportData, id: string, stage: string | undefined): boolean {
  return isOpenAt(airport.training, configLock(airport.training, configOf(airport, id)), stage);
}

/** Whether a SID family of an airport opens at a stage. */
function sidOpen(family: string, stage: string | undefined): boolean {
  return isOpenAt(koak.training, sidLock(koak.training, family), stage);
}

describe('isOpenAt', () => {
  const { training } = koak;

  it('opens a thing at the stage it is locked at and at every stage after it', () => {
    expect(isOpenAt(training, 'S1-OAK-2', 'S1-OAK-1')).toBe(false);
    expect(isOpenAt(training, 'S1-OAK-2', 'S1-OAK-2')).toBe(true);
    expect(isOpenAt(training, 'S1-OAK-2', 'S1-OAK-3')).toBe(true);
    expect(isOpenAt(training, 'S1-OAK-2', 'S1-SFO-4')).toBe(true);
  });

  it('opens a thing nothing locks', () => {
    expect(isOpenAt(training, undefined, 'S1-OAK-1')).toBe(true);
  });

  it('reads no stage, and a stage the file does not list, as All topics', () => {
    expect(isOpenAt(training, 'S1-SFO-4', undefined)).toBe(true);
    expect(isOpenAt(training, 'S1-SFO-4', RETIRED_STAGE)).toBe(true);
  });
});

describe('the SID, runway and no-SID locks', () => {
  it('draws only the first three families at S1-OAK-1', () => {
    for (const family of ['OAK', 'CNDEL', 'COAST']) {
      expect(sidOpen(family, 'S1-OAK-1')).toBe(true);
    }
    expect(sidOpen('NIMI', 'S1-OAK-1')).toBe(false);
  });

  it('opens NIMI at S1-OAK-2 and leaves the other SIDs locked there', () => {
    expect(sidOpen('NIMI', 'S1-OAK-2')).toBe(true);
    expect(sidOpen('SALAD', 'S1-OAK-2')).toBe(false);
  });

  it('opens the other SIDs at S1-OAK-6', () => {
    expect(sidOpen('SALAD', 'S1-OAK-6')).toBe(true);
  });

  it('locks runway 33 until S1-OAK-6 and no other runway', () => {
    expect(isOpenAt(koak.training, runwayLock(koak.training, '33'), 'S1-OAK-2')).toBe(false);
    expect(isOpenAt(koak.training, runwayLock(koak.training, '33'), 'S1-OAK-6')).toBe(true);
    expect(runwayLock(koak.training, '28R')).toBeUndefined();
  });

  it('locks no SID at an airport that lists none', () => {
    expect(sidLock(ksfo.training, 'TRUKN')).toBeUndefined();
  });
});

describe('the configuration locks', () => {
  it('locks the east plans at KOAK until S1-OAK-6', () => {
    expect(configOpen(koak, 'SFOW', 'S1-OAK-1')).toBe(true);
    expect(configOpen(koak, 'OAKE', 'S1-OAK-5')).toBe(false);
    expect(configOpen(koak, 'SFOE', 'S1-OAK-5')).toBe(false);
    expect(configOpen(koak, 'OAKE', 'S1-OAK-6')).toBe(true);
  });

  it('keeps the plan SFOE of each airport to that airport', () => {
    expect(configOpen(ksfo, '10/10', 'S1-SFO-1')).toBe(false);
    expect(configOpen(ksfo, '10/10', 'S1-SFO-4')).toBe(true);
    expect(configOpen(koak, 'SFOE', 'S1-SFO-1')).toBe(true);
  });

  it('opens the west configurations and locks the east ones at S1-SFO-1 at KSFO', () => {
    for (const id of ['28/01', '28 RT', '28 SO', '01/01']) {
      expect(configOpen(ksfo, id, 'S1-SFO-1')).toBe(true);
    }
    for (const id of ['10/10', '19/10', '19/19']) {
      expect(configOpen(ksfo, id, 'S1-SFO-1')).toBe(false);
    }
  });

  it('prefers a row naming the configuration over a row naming its plan', () => {
    const training = {
      ...ksfo.training,
      configs: [
        { plan: 'SFOE', at: 'S1-SFO-4' },
        { id: '10/10', at: 'S1-OAK-2' },
      ],
    };
    expect(configLock(training, configOf(ksfo, '10/10'))).toBe('S1-OAK-2');
    expect(configLock(training, configOf(ksfo, '19/19'))).toBe('S1-SFO-4');
    expect(configLock(training, configOf(ksfo, '28/01'))).toBeUndefined();
  });
});

describe('the airport locks', () => {
  it('holds KSFO back until S1-SFO-1', () => {
    expect(isOpenAt(ksfo.training, airportLock(ksfo.training, 'KSFO'), 'S1-OAK-6')).toBe(false);
    expect(isOpenAt(ksfo.training, airportLock(ksfo.training, 'KSFO'), 'S1-SFO-1')).toBe(true);
  });

  it('says the same in every airport file', () => {
    expect(koak.training.airports).toEqual(ksfo.training.airports);
    expect(airportLock(koak.training, 'KSFO')).toBe('S1-SFO-1');
  });

  it('holds back no airport the file does not list', () => {
    expect(airportLock(koak.training, 'KOAK')).toBeUndefined();
  });

  it('finds the first airport of the index that is open at the stage', () => {
    expect(firstOpenAirport(INDEX, koak.training, 'S1-OAK-2')).toBe('KOAK');
    expect(firstOpenAirport(INDEX, koak.training, 'S1-SFO-1')).toBe('KSFO');
    expect(firstOpenAirport(INDEX, koak.training, undefined)).toBe('KSFO');
  });

  it('finds none where the stage opens no airport of the index', () => {
    expect(firstOpenAirport([INDEX[0]!], koak.training, 'S1-OAK-2')).toBeUndefined();
  });
});

describe('clampSettings', () => {
  it('locks everything S1-OAK-1 has not taught', () => {
    const clamped = clampSettings(everything({ kind: 'plan', plan: 'OAKE' }), koak, 'S1-OAK-1');
    expect(clamped).toEqual({
      filter: { time: 'day', config: { kind: 'any' }, stage: 'S1-OAK-1' },
      mode: 'clearance',
      input: 'text',
      fullRoute: false,
      gradeRunway: false,
    });
  });

  it('grades the runway from S1-OAK-3 on, and still locks Amend there', () => {
    const clamped = clampSettings(everything(), koak, 'S1-OAK-3');
    expect(clamped.gradeRunway).toBe(true);
    expect(clamped.mode).toBe('clearance');
    expect(clamped.fullRoute).toBe(false);
    expect(clamped.filter.time).toBe('day');
  });

  it('opens Amend and Full route at S1-OAK-5, and still draws by day', () => {
    const clamped = clampSettings(everything(), koak, 'S1-OAK-5');
    expect(clamped.mode).toBe('amendment');
    expect(clamped.fullRoute).toBe(true);
    expect(clamped.filter.time).toBe('day');
  });

  it('opens everything at KOAK at S1-OAK-6', () => {
    const remembered = everything({ kind: 'plan', plan: 'OAKE' });
    const clamped = clampSettings(remembered, koak, 'S1-OAK-6');
    expect(clamped).toEqual({
      ...remembered,
      filter: { ...remembered.filter, stage: 'S1-OAK-6' },
    });
  });

  it('keeps a value the stage leaves open', () => {
    const open: SessionSettings = {
      ...everything({ kind: 'id', id: 'SFOW' }),
      filter: { time: 'day', config: { kind: 'id', id: 'SFOW' }, destination: 'KLAX' },
    };
    const clamped = clampSettings(open, koak, 'S1-OAK-2');
    expect(clamped.filter).toEqual({ ...open.filter, stage: 'S1-OAK-2' });
  });

  it('drops a configuration id the stage has locked', () => {
    const remembered = everything({ kind: 'id', id: '10/10' });
    expect(clampSettings(remembered, ksfo, 'S1-SFO-1').filter.config).toEqual({ kind: 'any' });
  });

  it('keeps a plan with a configuration open, and drops one with none', () => {
    const west = everything({ kind: 'plan', plan: 'SFOW' });
    const east = everything({ kind: 'plan', plan: 'SFOE' });
    expect(clampSettings(west, ksfo, 'S1-SFO-1').filter.config).toEqual(west.filter.config);
    expect(clampSettings(east, ksfo, 'S1-SFO-1').filter.config).toEqual({ kind: 'any' });
  });

  it('carries the members it does not look at, a test set among them', () => {
    const set = { seed: 7, n: 5, minutes: 0, index: 2 };
    const clamped = clampSettings({ ...everything(), set, extra: 'kept' }, koak, 'S1-OAK-1');
    expect(clamped.set).toEqual(set);
    expect(clamped.extra).toBe('kept');
  });

  it('removes the stage of the filter for All topics, and changes nothing else', () => {
    const remembered = everything({ kind: 'plan', plan: 'OAKE' });
    const drawn = { ...remembered, filter: { ...remembered.filter, stage: 'S1-OAK-1' } };
    expect(clampSettings(drawn, koak, undefined)).toEqual(remembered);
  });

  it('locks nothing for a stage the file does not list', () => {
    const clamped = clampSettings(everything(), koak, RETIRED_STAGE);
    expect(clamped).toEqual({
      ...everything(),
      filter: { ...ANY_SCENARIO, time: 'night', stage: RETIRED_STAGE },
    });
  });

  it('brings a remembered Night and OAKE back once the stage is All topics', () => {
    const remembered = everything({ kind: 'plan', plan: 'OAKE' });
    const narrowed = clampSettings(remembered, koak, 'S1-OAK-2');
    expect(narrowed.filter).toEqual({ time: 'day', config: { kind: 'any' }, stage: 'S1-OAK-2' });
    expect(clampSettings(remembered, koak, undefined)).toEqual(remembered);
  });
});

describe('stageBlock', () => {
  const { training } = koak;

  it('passes a SID that is open, off a runway that is open', () => {
    expect(stageBlock(sid('CNDEL'), '28R', training, 'S1-OAK-1')).toBeUndefined();
  });

  it('names the family that is still locked', () => {
    expect(stageBlock(sid('NIMI'), '28R', training, 'S1-OAK-1')).toBe('NIMI opens at S1-OAK-2');
    expect(stageBlock(sid('NIMI'), '28R', training, 'S1-OAK-2')).toBeUndefined();
  });

  it('holds every family no row names to the other-SIDs stage', () => {
    expect(stageBlock(sid('SALAD'), '28R', training, 'S1-OAK-2')).toBe('SALAD opens at S1-OAK-6');
  });

  it('holds a departure with no SID back', () => {
    expect(stageBlock(HEADING, '28R', training, 'S1-OAK-2')).toBe(
      'a departure with no SID opens at S1-OAK-6',
    );
  });

  it('holds a runway back whatever the SID', () => {
    expect(stageBlock(sid('NIMI'), '33', training, 'S1-OAK-2')).toBe('runway 33 opens at S1-OAK-6');
  });

  it('passes the SIDs, the heading and runway 33 at S1-OAK-6', () => {
    expect(stageBlock(sid('SALAD'), '33', training, 'S1-OAK-6')).toBeUndefined();
    expect(stageBlock(HEADING, '33', training, 'S1-OAK-6')).toBeUndefined();
  });

  it('passes everything for no stage and for one the file does not list', () => {
    expect(stageBlock(HEADING, '33', training, undefined)).toBeUndefined();
    expect(stageBlock(HEADING, '33', training, RETIRED_STAGE)).toBeUndefined();
  });

  it('passes what an airport does not lock', () => {
    expect(stageBlock(HEADING, '28L', ksfo.training, 'S1-SFO-1')).toBeUndefined();
  });
});
