import { describe, expect, it } from 'vitest';
import type { ProposalView } from './propose.ts';
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
        citations: [{ id: 'C-DEST', source: 'FAA JO 7110.65 4-3-2 a', text: 'CLEARED TO (dest)' }],
      },
    ],
    spoken: { abbreviated: 'Abbreviated form.', fullRoute: 'Full route form.' },
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
