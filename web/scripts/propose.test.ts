import { describe, expect, it } from 'vitest';
import type { AcceptedReading, ProposalView } from './propose.ts';
import { formatPendingLine, formatProposal } from './propose.ts';

/** A proposal with one of each part, so the assertions can point at exact lines. */
const clearanceView: ProposalView = {
  id: 'syn-example',
  status: 'settled',
  note: 'the rule row this exercises',
  strip: [
    ['callsign', 'UAL418'],
    ['runway', '01R'],
  ],
  outcome: {
    kind: 'clearance',
    elements: [
      {
        label: 'C cleared to',
        value: 'KSEA',
        citations: [
          { id: 'C-DEST', source: 'FAA JO 7110.65 4-3-2 a', text: 'CLEARED TO (dest)', why: null },
        ],
      },
    ],
    spoken: {
      abbreviated: 'Abbreviated form.',
      fullRoute: 'Full route form.',
      parts: [],
      fullRouteWords: '',
    },
    expected: { sidFamily: 'TRUKN', clearedTo: 'KSEA' },
  },
};

describe('formatProposal', () => {
  it('prints the id, the note, the strip, the citations, both spoken forms, and the block', () => {
    const lines = formatProposal(clearanceView).split('\n');
    expect(lines[0]).toBe('syn-example  [settled]');
    expect(lines).toContain('note: the rule row this exercises');
    expect(lines).toContain('  callsign     UAL418');
    expect(lines).toContain('  C cleared to KSEA');
    expect(lines).toContain('       C-DEST — CLEARED TO (dest)');
    expect(lines).toContain('  abbreviated: Abbreviated form.');
    expect(lines).toContain('  full route:  Full route form.');
    expect(lines).toContain('  "expected": {');
  });

  it('sorts the keys of the fixture block so it pastes into a fixture unchanged', () => {
    const block = formatProposal(clearanceView).split('FIXTURE\n')[1] ?? '';
    expect(block.indexOf('"clearedTo"')).toBeLessThan(block.indexOf('"sidFamily"'));
    expect(block).toContain('    "clearedTo": "KSEA"');
  });

  it('omits the note when the fixture has none', () => {
    const view: ProposalView = { ...clearanceView, note: undefined };
    expect(formatProposal(view)).not.toContain('note:');
  });

  it('prints the blocked elements instead of a clearance when the engine is unresolved', () => {
    const view: ProposalView = {
      ...clearanceView,
      outcome: { kind: 'unresolved', reasons: ['R.sid: no assignment rule applies'] },
    };
    const text = formatProposal(view);
    expect(text).toContain('UNRESOLVED');
    expect(text).toContain('  R.sid: no assignment rule applies');
    expect(text).not.toContain('SPOKEN');
  });
});

/** The reading the trainer also accepts for a ZOA CPS-004 3.1 type, as the proposal prints it. */
const acceptedClearance: AcceptedReading = {
  clearance: {
    kind: 'clearance',
    elements: [
      {
        label: 'R procedure',
        value: 'Nimitz Six departure (NIMI6)',
        citations: [
          { id: 'OAK-SFOW-PT-NIMI', source: 'OAK SOP 3-4', text: 'All other props', why: null },
        ],
      },
      { label: 'A altitude', value: 'maintain 3000', citations: [] },
    ],
    spoken: {
      abbreviated: 'Accepted abbreviated form.',
      fullRoute: 'Accepted full route form.',
      parts: [],
      fullRouteWords: '',
    },
    expected: { sidFamily: 'OAK', altitude: 3000 },
  },
};

describe('the accepted reading', () => {
  it('prints the elements with the abbreviated spoken form under its heading, before the block', () => {
    const text = formatProposal({ ...clearanceView, accepted: acceptedClearance });
    const lines = text.split('\n');
    expect(lines).toContain('ALSO ACCEPTED (ZOA-CPS004-SPECIAL-AIRCRAFT)');
    expect(lines).toContain('  R procedure  Nimitz Six departure (NIMI6)');
    expect(lines).toContain('       OAK-SFOW-PT-NIMI — All other props');
    expect(lines).toContain('  A altitude   maintain 3000');
    expect(lines).toContain('  abbreviated: Accepted abbreviated form.');
    expect(lines).not.toContain('  full route:  Accepted full route form.');
    const heading = text.indexOf('ALSO ACCEPTED');
    expect(heading).toBeGreaterThan(text.indexOf('SPOKEN'));
    expect(heading).toBeLessThan(text.indexOf('FIXTURE'));
  });

  it('prints the accepted boxes before the accepted elements in amendment mode', () => {
    const view: ProposalView = {
      ...clearanceView,
      outcome: {
        kind: 'amendments',
        amendments: [],
        corrected: { kind: 'unresolved', reasons: ['R.sid: no assignment rule applies'] },
        expected: {},
      },
      accepted: {
        amendments: [
          { box: 'altitude', proposed: '5000', reason: 'the SOP interim altitude', citations: [] },
        ],
        clearance: acceptedClearance.clearance,
      },
    };
    const text = formatProposal(view);
    expect(text).toContain('  altitude     5000');
    expect(text).toContain('       the SOP interim altitude');
    expect(text).toContain('  R procedure  Nimitz Six departure (NIMI6)');
    expect(text.indexOf('  altitude     5000')).toBeGreaterThan(text.indexOf('ALSO ACCEPTED'));
  });

  it('prints no section for a type without special handling', () => {
    expect(formatProposal(clearanceView)).not.toContain('ALSO ACCEPTED');
  });
});

describe('formatPendingLine', () => {
  it('lays the resolved elements out in columns', () => {
    const line = formatPendingLine({
      id: 'syn-example',
      sid: 'TRUKN2',
      route: 'DEDHD transition',
      altitude: 'climb via SID',
      frequency: '120.9 (richmond)',
      blocked: undefined,
    });
    expect(line.startsWith('syn-example ')).toBe(true);
    expect(line).toContain('TRUKN2');
    expect(line).toContain('DEDHD transition');
    expect(line.endsWith('120.9 (richmond)')).toBe(true);
  });

  it('keeps the columns apart when the engine route label overflows its column', () => {
    const line = formatPendingLine({
      id: 'syn-sfo5-v6-01r-airway',
      sid: 'SFO5',
      route: 'radar vectors to join V6',
      altitude: 'maintain 5,000',
      frequency: '135.1 (sutro)',
      blocked: undefined,
    });
    expect(line).toContain('radar vectors to join V6 maintain 5,000');
    expect(line.endsWith('135.1 (sutro)')).toBe(true);
  });

  it('prints the reason instead when the engine could not clear the plan', () => {
    const line = formatPendingLine({
      id: 'syn-example',
      sid: '',
      route: '',
      altitude: '',
      frequency: '',
      blocked: 'R.sid: no assignment rule applies',
    });
    expect(line).toContain('UNRESOLVED R.sid: no assignment rule applies');
  });
});
