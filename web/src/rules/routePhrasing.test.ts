import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Sid } from '@/data/schema.ts';
import { phraseRoute } from '@/rules/routePhrasing.ts';

const ksfo = ksfoJson as unknown as AirportData;

function sid(id: string): Sid {
  const found = ksfo.sids.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${id} is not in the data`);
  return found;
}

const spokenVectorTransitions: AirportData = {
  ...ksfo,
  phraseology: { ...ksfo.phraseology, vectorHybridTransitionsSpoken: true },
};

describe('phraseRoute', () => {
  it('speaks a published enroute transition as a transition', () => {
    const result = phraseRoute(sid('TRUKN2'), 'DEDHD', ksfo);
    expect(result.value).toEqual({ template: 'transition', fix: 'DEDHD' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-TRANSITION']);
  });

  it('speaks a radar-vector SID as radar vectors to the exit fix', () => {
    const result = phraseRoute(sid('SFO5'), 'RBL', ksfo);
    expect(result.value).toEqual({ template: 'radar_vectors_fix', fix: 'RBL' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-RV-SID']);
  });

  it('speaks a vector-hybrid SID as its own phrasing while the toggle is off', () => {
    const result = phraseRoute(sid('GAPP7'), 'OAK', ksfo);
    expect(result.value).toEqual({ template: 'radar_vectors_fix', fix: 'OAK' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-RV-SID']);
  });

  it('speaks a vector-hybrid transition as a transition once the toggle is on', () => {
    const result = phraseRoute(sid('GAPP7'), 'OAK', spokenVectorTransitions);
    expect(result.value).toEqual({ template: 'transition', fix: 'OAK' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-TRANSITION']);
  });

  it('leaves a vector-hybrid fix that is not one of its transitions on its own phrasing', () => {
    const result = phraseRoute(sid('GAPP7'), 'DEDHD', spokenVectorTransitions);
    expect(result.value).toEqual({ template: 'radar_vectors_fix', fix: 'DEDHD' });
  });

  it('says "as filed" for a pilot-nav SID whose exit fix is not a transition', () => {
    const result = phraseRoute({ ...sid('TRUKN2'), baseFix: 'TRUKN' }, 'TRUKN', ksfo);
    expect(result.value).toEqual({ template: 'as_filed' });
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-AS-FILED']);
  });

  it('does not speak a transition the chart does not publish as one', () => {
    const quiet = {
      ...sid('TRUKN2'),
      transitions: sid('TRUKN2').transitions.map((transition) => ({
        ...transition,
        spokenAsTransition: false,
      })),
    };
    expect(phraseRoute(quiet, 'DEDHD', ksfo).value).toEqual({ template: 'as_filed' });
  });
});
