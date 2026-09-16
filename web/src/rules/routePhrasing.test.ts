import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Sid } from '@/data/schema.ts';
import { phraseRoute } from '@/rules/routePhrasing.ts';
import type { SelectedProcedure } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;

function sid(id: string): Sid {
  const found = ksfo.sids.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${id} is not in the data`);
  return found;
}

/** The flight on a SID, as the engine hands the selection to the route phrasing. */
function on(id: string): SelectedProcedure {
  return { kind: 'sid', sid: sid(id) };
}

const spokenVectorTransitions: AirportData = {
  ...ksfo,
  phraseology: { ...ksfo.phraseology, vectorHybridTransitionsSpoken: true },
};

describe('phraseRoute', () => {
  it('speaks a published enroute transition as a transition', () => {
    const result = phraseRoute(on('TRUKN2'), 'DEDHD', ksfo);
    expect(result.value).toEqual({ template: 'transition', fix: 'DEDHD' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-TRANSITION']);
  });

  it('speaks a radar-vector SID as radar vectors to the exit fix', () => {
    const result = phraseRoute(on('SFO5'), 'RBL', ksfo);
    expect(result.value).toEqual({ template: 'radar_vectors_fix', fix: 'RBL' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-RV-SID']);
  });

  it('speaks a vector-hybrid SID as its own phrasing while the toggle is off', () => {
    const result = phraseRoute(on('GAPP7'), 'OAK', ksfo);
    expect(result.value).toEqual({ template: 'radar_vectors_fix', fix: 'OAK' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-RV-SID']);
  });

  it('speaks a vector-hybrid transition as a transition once the toggle is on', () => {
    const result = phraseRoute(on('GAPP7'), 'OAK', spokenVectorTransitions);
    expect(result.value).toEqual({ template: 'transition', fix: 'OAK' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-TRANSITION']);
  });

  it('leaves a vector-hybrid fix that is not one of its transitions on its own phrasing', () => {
    const result = phraseRoute(on('GAPP7'), 'DEDHD', spokenVectorTransitions);
    expect(result.value).toEqual({ template: 'radar_vectors_fix', fix: 'DEDHD' });
  });

  it('names the fix a pilot-nav SID hands over on before "as filed"', () => {
    const result = phraseRoute(
      { kind: 'sid', sid: { ...sid('TRUKN2'), baseFix: 'TRUKN' } },
      'TRUKN',
      ksfo,
    );
    expect(result.value).toEqual({ template: 'as_filed', fix: 'TRUKN' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-AS-FILED']);
  });

  it('does not speak a transition the chart does not publish as one', () => {
    const quiet: SelectedProcedure = {
      kind: 'sid',
      sid: {
        ...sid('TRUKN2'),
        transitions: sid('TRUKN2').transitions.map((transition) => ({
          ...transition,
          spokenAsTransition: false,
        })),
      },
    };
    expect(phraseRoute(quiet, 'DEDHD', ksfo).value).toEqual({
      template: 'as_filed',
      fix: 'DEDHD',
    });
  });

  it('joins an airway off a radar-vector SID', () => {
    const result = phraseRoute(on('SFO5'), 'V6', ksfo);
    expect(result.value).toEqual({ template: 'radar_vectors_airway', fix: 'V6' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-RV-AIRWAY']);
  });

  it('joins an airway off a vector-hybrid SID', () => {
    const result = phraseRoute(on('GAPP7'), 'J501', ksfo);
    expect(result.value).toEqual({ template: 'radar_vectors_airway', fix: 'J501' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-RV-AIRWAY']);
  });

  it('leaves a pilot-nav SID on "as filed" for an airway it cannot be vectored to', () => {
    const result = phraseRoute(on('TRUKN2'), 'V6', ksfo);
    expect(result.value).toEqual({ template: 'as_filed', fix: 'V6' });
  });
});
