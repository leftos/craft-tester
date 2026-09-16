import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import type { ResolvedClearance } from '@/rules/types.ts';
import type { CraftGroup } from '@/ui/craftForm.ts';
import { craftGroups, submitDisabled } from '@/ui/craftForm.ts';
import type { DraftPicks } from '@/ui/state.ts';
import { EMPTY_PICKS } from '@/ui/state.ts';

const ksfo = ksfoJson as unknown as AirportData;

const scenario: Scenario = {
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

const clearance: ResolvedClearance = {
  clearedTo: { value: 'KSEA', citations: [] },
  runway: { value: '01R', citations: [] },
  sid: { value: { id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' }, citations: [] },
  route: { value: { template: 'transition', fix: 'DEDHD' }, citations: [] },
  altitude: { value: { phrase: 'climb_via_except', feet: 10000 }, citations: [] },
  expect: { value: { feet: 34000, minutes: 10, amended: false }, citations: [] },
  redundantExpect: { value: null, citations: [] },
  frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [] },
};

const full: DraftPicks = {
  procedure: 'TRUKN2',
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'climb_via_except',
  altitudeFeet: 10000,
  expect: 'ten_minutes',
  frequency: '120.9',
  runway: '01R',
};

/** The row the procedure sits in, which is the second of the form either way. */
function procedureRowOf(picks: DraftPicks, procedure: 'given' | 'picked'): CraftGroup {
  const row = craftGroups(scenario, ksfo, clearance, picks, procedure)[1];
  if (row === undefined) throw new Error('the form has no procedure row');
  return row;
}

describe('craftGroups', () => {
  it('shows the resolved procedure as a given row on a clean clearance', () => {
    const row = procedureRowOf(EMPTY_PICKS, 'given');
    expect(row).toStrictEqual({
      kind: 'given',
      heading: 'R — procedure',
      value: 'TRUKN TWO (RNAV)',
    });
  });

  it('offers the procedure as a graded pick on a corrected plan', () => {
    const row = procedureRowOf(EMPTY_PICKS, 'picked');
    if (row.kind !== 'picked') throw new Error('the procedure row is not a picked row');
    expect(row.element).toBe('R.sid');
    expect(row.fields.map((field) => field.key)).toStrictEqual(['procedure']);
    expect(row.fields[0]?.label).toBe('procedure');
    expect(row.fields[0]?.disabled).toBe(false);
  });

  it('lists every procedure the airport publishes, named as its chart names it', () => {
    const row = procedureRowOf(EMPTY_PICKS, 'picked');
    if (row.kind !== 'picked') throw new Error('the procedure row is not a picked row');
    expect(row.fields[0]?.options).toStrictEqual(
      ksfo.sids.map((sid) => ({ value: sid.id, label: sid.chartName })),
    );
  });

  it('reads the procedure the student has picked back into the dropdown', () => {
    const blank = procedureRowOf(EMPTY_PICKS, 'picked');
    const picked = procedureRowOf({ ...EMPTY_PICKS, procedure: 'SSTIK5' }, 'picked');
    if (blank.kind !== 'picked' || picked.kind !== 'picked') {
      throw new Error('the procedure row is not a picked row');
    }
    expect(blank.fields[0]?.value).toBeUndefined();
    expect(picked.fields[0]?.value).toBe('SSTIK5');
  });

  it('leaves every other row of the form where it was', () => {
    const given = craftGroups(scenario, ksfo, clearance, full, 'given');
    const picked = craftGroups(scenario, ksfo, clearance, full, 'picked');
    expect(picked.length).toBe(given.length);
    expect(picked.filter((_, index) => index !== 1)).toStrictEqual(
      given.filter((_, index) => index !== 1),
    );
  });
});

describe('submitDisabled', () => {
  it('takes a filled clearance form whose procedure was never picked', () => {
    expect(submitDisabled({ ...full, procedure: undefined }, 'given')).toBe(false);
  });

  it('holds a corrected plan back until the procedure is picked', () => {
    expect(submitDisabled({ ...full, procedure: undefined }, 'picked')).toBe(true);
    expect(submitDisabled(full, 'picked')).toBe(false);
  });

  it('holds either form back while a CRAFT dropdown is blank', () => {
    expect(submitDisabled({ ...full, runway: undefined }, 'given')).toBe(true);
    expect(submitDisabled({ ...full, runway: undefined }, 'picked')).toBe(true);
  });
});
