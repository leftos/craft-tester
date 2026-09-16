import { describe, expect, it } from 'vitest';
import type { Scenario } from '@/data/schema.ts';
import { amendSubmitDisabled, boxInputName, boxRows, filedRows } from '@/ui/amendForm.ts';
import type { DraftBoxes } from '@/ui/state.ts';
import { EMPTY_BOXES } from '@/ui/state.ts';
import { stripRows } from '@/ui/strip.ts';

/** A filed plan with a suffix, a flight level and a route, which is one of each box to answer. */
const FILED: Scenario = {
  callsign: 'UAL313',
  aircraftType: 'B752',
  equipmentSuffix: '/L',
  destination: 'KSLC',
  filedRoute: 'SFO5 MOGEE BVL',
  filedAltitude: 33000,
  runwayConfigId: '28 RT',
  departureRunway: '28L',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '4614',
};

/** Every box answered, one of them amended, which is what the strip needs to be submitted. */
const answered: DraftBoxes = {
  type: { kind: 'as_filed' },
  altitude: { kind: 'amended', value: 'FL270' },
  route: { kind: 'as_filed' },
};

describe('boxRows', () => {
  it('offers the three boxes in strip order', () => {
    expect(boxRows(FILED, EMPTY_BOXES).map((row) => row.box)).toStrictEqual([
      'type',
      'altitude',
      'route',
    ]);
  });

  it('reads the filed value of every box as the strip writes it', () => {
    const strip = new Map(stripRows(FILED));
    for (const row of boxRows(FILED, EMPTY_BOXES)) {
      expect(row.filed, row.box).toBe(strip.get(row.label));
    }
    expect(boxRows(FILED, EMPTY_BOXES).map((row) => row.filed)).toStrictEqual([
      'B752/L',
      'FL330',
      'SFO5 MOGEE BVL',
    ]);
  });

  it('carries the answer of every box, and none where the box is unanswered', () => {
    expect(boxRows(FILED, EMPTY_BOXES).map((row) => row.answer)).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(boxRows(FILED, answered).map((row) => row.answer)).toStrictEqual([
      { kind: 'as_filed' },
      { kind: 'amended', value: 'FL270' },
      { kind: 'as_filed' },
    ]);
  });

  it('writes a type with no suffix as the bare designator', () => {
    const rows = boxRows({ ...FILED, equipmentSuffix: null }, EMPTY_BOXES);
    expect(rows[0]?.filed).toBe('B752');
  });
});

describe('filedRows', () => {
  it('prints the boxes the student does not answer, in strip order', () => {
    expect(filedRows(FILED).map(([label]) => label)).toStrictEqual([
      'callsign',
      'destination',
      'squawk',
      'time',
    ]);
  });

  it('prints the remarks box where the flight filed remarks', () => {
    const rows = filedRows({ ...FILED, remarks: 'REQ RWY 28' });
    expect(rows.map(([label]) => label)).toStrictEqual([
      'callsign',
      'destination',
      'squawk',
      'remarks',
      'time',
    ]);
    expect(new Map(rows).get('remarks')).toBe('REQ RWY 28');
  });

  it('leaves every box the student answers to the form', () => {
    const printed = new Set(filedRows(FILED).map(([label]) => label));
    for (const row of boxRows(FILED, EMPTY_BOXES)) {
      expect(printed.has(row.label), row.box).toBe(false);
    }
  });
});

describe('boxInputName', () => {
  it('names the text box of every answerable box', () => {
    expect(boxRows(FILED, EMPTY_BOXES).map((row) => boxInputName(row.box))).toStrictEqual([
      'amend-type',
      'amend-altitude',
      'amend-route',
    ]);
  });

  it('gives every box a name of its own', () => {
    const names = boxRows(FILED, EMPTY_BOXES).map((row) => boxInputName(row.box));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('amendSubmitDisabled', () => {
  it('refuses a strip nobody has answered', () => {
    expect(amendSubmitDisabled(EMPTY_BOXES)).toBe(true);
  });

  it('refuses a strip with a box still open', () => {
    expect(amendSubmitDisabled({ ...answered, route: undefined })).toBe(true);
  });

  it('refuses a box amended to nothing', () => {
    expect(amendSubmitDisabled({ ...answered, route: { kind: 'amended', value: '  ' } })).toBe(
      true,
    );
  });

  it('takes a strip with every box answered', () => {
    expect(amendSubmitDisabled(answered)).toBe(false);
  });
});
