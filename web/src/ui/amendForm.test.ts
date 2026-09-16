import { describe, expect, it } from 'vitest';
import type { Scenario } from '@/data/schema.ts';
import { amendSubmitDisabled, boxRows } from '@/ui/amendForm.ts';
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
      '33,000',
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
