import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { headingPick } from '@/rules/grade.ts';
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
      { value: 'heading:runway', label: 'fly runway heading (no DP)' },
    ]);
  });

  it('offers the runway heading last, for the plans the SOP sends off without a procedure', () => {
    const row = procedureRowOf(EMPTY_PICKS, 'picked');
    if (row.kind !== 'picked') throw new Error('the procedure row is not a picked row');
    expect(row.fields[0]?.options.at(-1)).toStrictEqual({
      value: headingPick('runway heading'),
      label: 'fly runway heading (no DP)',
    });
  });

  it('offers every heading its rules name once, the runway heading first then the degrees', () => {
    const headingRule = ksfo.assignmentRules.find((rule) => rule.nonDpHeading !== undefined);
    if (headingRule === undefined) throw new Error('KSFO has no heading rule to spread');
    const airport: AirportData = {
      ...ksfo,
      assignmentRules: [
        ...ksfo.assignmentRules,
        { ...headingRule, id: 'TEST-315', nonDpHeading: 315 },
        { ...headingRule, id: 'TEST-270', nonDpHeading: 270 },
        { ...headingRule, id: 'TEST-270-AGAIN', nonDpHeading: 270 },
      ],
    };
    const row = craftGroups(scenario, airport, clearance, EMPTY_PICKS, 'picked')[1];
    if (row?.kind !== 'picked') throw new Error('the procedure row is not a picked row');
    expect(row.fields[0]?.options.slice(-3)).toStrictEqual([
      { value: 'heading:runway', label: 'fly runway heading (no DP)' },
      { value: 'heading:270', label: 'heading 270 (no DP)' },
      { value: 'heading:315', label: 'heading 315 (no DP)' },
    ]);
    expect(row.fields[0]?.options).toHaveLength(airport.sids.length + 3);
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

  it('names the altitude on the strip in the final choice, as a flight level above 18,000', () => {
    expect(expectLabels(scenario, clearance)).toContain('FL340 will be your final');
    const low: ResolvedClearance = {
      ...clearance,
      expect: { value: { kind: 'final', feet: 9000 }, citations: [] },
    };
    expect(expectLabels({ ...scenario, filedAltitude: 9000 }, low)).toContain(
      '9,000 will be your final',
    );
  });

  it('names the amended altitude where the altitude box was amended', () => {
    const amended: ResolvedClearance = {
      ...clearance,
      expect: { value: { kind: 'amended', feet: 32000, minutes: 10 }, citations: [] },
    };
    const labels = expectLabels({ ...scenario, filedAltitude: 32000 }, amended);
    expect(labels).toContain('FL320 will be your final');
    expect(labels).toContain('expect amended altitude 10 minutes after departure');
  });
});

describe('the altitude row', () => {
  it('labels every altitude at or above 18,000 as a flight level and the rest in feet', () => {
    const row = craftGroups(scenario, ksfo, clearance, full, 'given')[3];
    if (row?.kind !== 'picked') throw new Error('the altitude row is not a picked row');
    const options = row.fields[1]?.options ?? [];
    expect(options.map((option) => option.value)).toContain('34000');
    expect(options.map((option) => option.value)).toContain('10000');
    for (const option of options) {
      const feet = Number(option.value);
      expect(option.label).toBe(feet < 18000 ? feet.toLocaleString('en-US') : `FL${feet / 100}`);
    }
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
    expect(submitDisabled({ ...full, procedure: headingPick('runway heading') }, 'picked')).toBe(
      false,
    );
  });

  it('holds either form back while a CRAFT dropdown is blank', () => {
    expect(submitDisabled({ ...full, runway: undefined }, 'given')).toBe(true);
    expect(submitDisabled({ ...full, runway: undefined }, 'picked')).toBe(true);
  });
});
