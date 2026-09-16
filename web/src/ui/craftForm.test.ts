import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { HEADING_PROCEDURE_PICK } from '@/rules/grade.ts';
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
  procedure: {
    value: { kind: 'sid', id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' },
    citations: [],
  },
  route: { value: { template: 'transition', fix: 'DEDHD' }, citations: [] },
  altitude: { value: { phrase: 'climb_via_except', feet: 10000 }, citations: [] },
  expect: { value: { kind: 'filed', feet: 34000, minutes: 10 }, citations: [] },
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
    expect(row.fields[0]?.options).toStrictEqual([
      ...ksfo.sids.map((sid) => ({ value: sid.id, label: sid.chartName })),
      { value: 'runway heading', label: 'fly runway heading (no DP)' },
    ]);
  });

  it('offers the runway heading last, for the plans the SOP sends off without a procedure', () => {
    const row = procedureRowOf(EMPTY_PICKS, 'picked');
    if (row.kind !== 'picked') throw new Error('the procedure row is not a picked row');
    expect(row.fields[0]?.options.at(-1)).toStrictEqual({
      value: HEADING_PROCEDURE_PICK,
      label: 'fly runway heading (no DP)',
    });
  });

  it('shows the runway heading in the given row of a clearance issued without a procedure', () => {
    const onTheHeading: ResolvedClearance = {
      ...clearance,
      procedure: {
        value: {
          kind: 'heading',
          heading: 'runway heading',
          turn: undefined,
          spoken: 'fly runway heading',
        },
        citations: [],
      },
    };
    const row = craftGroups(scenario, ksfo, onTheHeading, EMPTY_PICKS, 'given')[1];
    expect(row).toStrictEqual({
      kind: 'given',
      heading: 'R — procedure',
      value: 'fly runway heading (no DP)',
    });
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

describe('the expect row', () => {
  /** The labels of the expect dropdown, in the order the form offers them. */
  function expectLabels(plan: Scenario, resolved: ResolvedClearance): string[] {
    const row = craftGroups(plan, ksfo, resolved, full, 'given')[4];
    if (row?.kind !== 'picked') throw new Error('the expect row is not a picked row');
    return (row.fields[0]?.options ?? []).map((option) => option.label);
  }

  it('names the altitude on the strip in the final choice', () => {
    expect(expectLabels(scenario, clearance)).toContain('34,000 will be your final');
  });

  it('names the amended altitude where the altitude box was amended', () => {
    const amended: ResolvedClearance = {
      ...clearance,
      expect: { value: { kind: 'amended', feet: 32000, minutes: 10 }, citations: [] },
    };
    const labels = expectLabels({ ...scenario, filedAltitude: 32000 }, amended);
    expect(labels).toContain('32,000 will be your final');
    expect(labels).toContain('expect amended altitude 10 minutes after departure');
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

  it('takes the runway heading as the procedure pick of a corrected plan', () => {
    expect(submitDisabled({ ...full, procedure: HEADING_PROCEDURE_PICK }, 'picked')).toBe(false);
  });

  it('holds either form back while a CRAFT dropdown is blank', () => {
    expect(submitDisabled({ ...full, runway: undefined }, 'given')).toBe(true);
    expect(submitDisabled({ ...full, runway: undefined }, 'picked')).toBe(true);
  });
});
