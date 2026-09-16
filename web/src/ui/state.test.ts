import { beforeAll, describe, expect, it } from 'vitest';
import type { AirportData } from '@/data/schema.ts';
import type { BoxAnswer } from '@/rules/amend/grade.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { ANY_SCENARIO, filterFromHash, modeFromHash } from '@/scenario/filter.ts';
import { seedFromHash } from '@/scenario/rng.ts';
import { loadAirportData } from '@/ui/session.ts';
import type { Attempt } from '@/ui/solved.ts';
import type { AppState, DraftBoxes, DraftPicks } from '@/ui/state.ts';
import {
  applyBoxAnswer,
  applyPick,
  EMPTY_BOXES,
  EMPTY_PICKS,
  newSession,
  shareLink,
  toAmendmentPicks,
  toBoxAnswers,
  toPlayerPicks,
  withBox,
  withBoxesSubmitted,
  withFilter,
  withMode,
  withRetry,
  withSubmitted,
} from '@/ui/state.ts';

const full: DraftPicks = {
  procedure: 'TRUKN2',
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'maintain',
  altitudeFeet: 10000,
  expect: 'ten_minutes',
  frequency: '120.9',
  runway: '01R',
};

/** Every box answered, one of them amended, which is what the strip needs to be submitted. */
const answeredBoxes: DraftBoxes = {
  type: { kind: 'as_filed' },
  altitude: { kind: 'amended', value: 'FL270' },
  route: { kind: 'as_filed' },
};

describe('applyPick', () => {
  it('reads the route element the player picked', () => {
    expect(applyPick(full, 'routeFix', 'SSTIK').routeFix).toBe('SSTIK');
  });

  it('reads the procedure the player assigned', () => {
    expect(applyPick(EMPTY_PICKS, 'procedure', 'SSTIK5').procedure).toBe('SSTIK5');
    expect(applyPick(full, 'procedure', '').procedure).toBeUndefined();
  });

  it('clears the altitude when the phrase speaks none', () => {
    const next = applyPick(full, 'altitudePhrase', 'climb_via');
    expect(next.altitudePhrase).toBe('climb_via');
    expect(next.altitudeFeet).toBeUndefined();
  });

  it('keeps the altitude when the phrase still speaks one', () => {
    expect(applyPick(full, 'altitudePhrase', 'climb_via_except').altitudeFeet).toBe(10000);
  });

  it('reads the altitude dropdown as feet', () => {
    expect(applyPick(EMPTY_PICKS, 'altitudeFeet', '3000').altitudeFeet).toBe(3000);
  });

  it('reads the blank option as no pick at all', () => {
    expect(applyPick(full, 'routeFix', '').routeFix).toBeUndefined();
    expect(applyPick(full, 'altitudeFeet', '').altitudeFeet).toBeUndefined();
  });

  it('ignores a value the schema does not know', () => {
    expect(applyPick(full, 'routeTemplate', 'sideways').routeTemplate).toBeUndefined();
    expect(applyPick(full, 'expect', 'eventually').expect).toBeUndefined();
  });
});

describe('toPlayerPicks', () => {
  it('refuses an untouched form', () => {
    expect(toPlayerPicks(EMPTY_PICKS)).toBeUndefined();
  });

  it('refuses a form whose route names no element', () => {
    expect(toPlayerPicks({ ...full, routeFix: undefined })).toBeUndefined();
  });

  it('refuses a form whose altitude phrase speaks feet it has not picked', () => {
    expect(toPlayerPicks({ ...full, altitudeFeet: undefined })).toBeUndefined();
  });

  it('accepts "climb via SID" without feet, and speaks none', () => {
    const picks = toPlayerPicks({ ...full, altitudePhrase: 'climb_via', altitudeFeet: undefined });
    expect(picks?.altitudePhrase).toBe('climb_via');
    expect(picks).not.toHaveProperty('altitudeFeet');
  });

  it('carries every pick through to grading, and leaves the given procedure out', () => {
    expect(toPlayerPicks(full)).toStrictEqual({
      routeTemplate: 'transition',
      routeFix: 'DEDHD',
      altitudePhrase: 'maintain',
      altitudeFeet: 10000,
      expect: 'ten_minutes',
      frequency: '120.9',
      runway: '01R',
    });
  });

  it('accepts a form with no procedure picked, which clearance mode is given', () => {
    expect(toPlayerPicks({ ...full, procedure: undefined })).toStrictEqual(toPlayerPicks(full));
  });
});

describe('toAmendmentPicks', () => {
  it('refuses a form whose procedure is still blank', () => {
    expect(toAmendmentPicks({ ...full, procedure: undefined })).toBeUndefined();
  });

  it('refuses a form still missing a CRAFT pick', () => {
    expect(toAmendmentPicks({ ...full, runway: undefined })).toBeUndefined();
  });

  it('carries the procedure beside every other pick', () => {
    expect(toAmendmentPicks(full)).toStrictEqual({ ...toPlayerPicks(full), procedure: 'TRUKN2' });
  });
});

describe('the strip answers', () => {
  it('changes the box the student answered and no other', () => {
    const answer: BoxAnswer = { kind: 'amended', value: 'B739/L' };
    const boxes = applyBoxAnswer(EMPTY_BOXES, 'type', answer);
    expect(boxes).toStrictEqual({ type: answer, altitude: undefined, route: undefined });
    expect(applyBoxAnswer(boxes, 'type', { kind: 'as_filed' }).type).toStrictEqual({
      kind: 'as_filed',
    });
  });

  it('refuses the answers while a box is unanswered', () => {
    expect(toBoxAnswers(EMPTY_BOXES)).toBeUndefined();
    expect(toBoxAnswers({ ...answeredBoxes, route: undefined })).toBeUndefined();
  });

  it('refuses a box amended to nothing but whitespace', () => {
    expect(
      toBoxAnswers({ ...answeredBoxes, route: { kind: 'amended', value: '' } }),
    ).toBeUndefined();
    expect(
      toBoxAnswers({ ...answeredBoxes, route: { kind: 'amended', value: '   ' } }),
    ).toBeUndefined();
  });

  it('carries every answer through to grading', () => {
    expect(toBoxAnswers(answeredBoxes)).toStrictEqual({
      type: { kind: 'as_filed' },
      altitude: { kind: 'amended', value: 'FL270' },
      route: { kind: 'as_filed' },
    });
  });
});

describe('revisiting a solved scenario', () => {
  const SEED = 1;
  const picks: PlayerPicks = {
    routeTemplate: 'transition',
    routeFix: 'DEDHD',
    altitudePhrase: 'maintain',
    altitudeFeet: 10_000,
    expect: 'ten_minutes',
    frequency: '120.9',
    runway: '01R',
  };
  const previous: Attempt = { kind: 'clearance', picks };
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  it('starts an already solved seed with the earlier answer and an untouched form', () => {
    const state = newSession(airport, SEED, previous, ANY_SCENARIO, 'clearance');
    expect(state.revisit).toStrictEqual(previous);
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.boxes).toStrictEqual(EMPTY_BOXES);
    expect(state.boxesSubmitted).toBe(false);
    expect(state.submitted).toBe(false);
    expect(state.filter).toStrictEqual(ANY_SCENARIO);
    expect(state.mode).toBe('clearance');
  });

  it('remembers no earlier answer for a seed nobody has solved', () => {
    expect(newSession(airport, SEED, undefined, ANY_SCENARIO, 'clearance').revisit).toBeUndefined();
  });

  it('hides the earlier answer and empties the form on a retry', () => {
    const state = withRetry(newSession(airport, SEED, previous, ANY_SCENARIO, 'clearance'));
    expect(state.revisit).toBeUndefined();
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.submitted).toBe(false);
    expect(state.seed).toBe(SEED);
  });

  it('empties a form that was just submitted', () => {
    const submitted = {
      ...newSession(airport, SEED, undefined, ANY_SCENARIO, 'clearance'),
      picks: full,
      submitted: true,
    };
    const state = withRetry(submitted);
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.submitted).toBe(false);
    expect(state.revisit).toBeUndefined();
  });

  it('empties the strip a retried amendment had answered', () => {
    const session = newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment');
    const state = withRetry({ ...session, boxes: answeredBoxes, boxesSubmitted: true });
    expect(state.boxes).toStrictEqual(EMPTY_BOXES);
    expect(state.boxesSubmitted).toBe(false);
    expect(state.mode).toBe('amendment');
  });
});

describe('withFilter', () => {
  const SEED = 1;
  const FRESH_SEED = 7;
  const night: ScenarioFilter = { time: 'night', config: { kind: 'plan', plan: 'SFOE' } };
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  it('draws a fresh scenario on the same airport under the new filter', () => {
    const started = newSession(airport, SEED, undefined, ANY_SCENARIO, 'clearance');
    const state = withFilter(started, night, FRESH_SEED, undefined);
    expect(state.filter).toStrictEqual(night);
    expect(state.seed).toBe(FRESH_SEED);
    expect(state.airport).toBe(airport);
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.submitted).toBe(false);
    expect(state.revisit).toBeUndefined();
  });

  it('draws the filtered scenario the fresh seed stands for', () => {
    const state = withFilter(
      newSession(airport, SEED, undefined, ANY_SCENARIO, 'clearance'),
      night,
      FRESH_SEED,
      undefined,
    );
    expect(state.view).toStrictEqual(
      newSession(airport, FRESH_SEED, undefined, night, 'clearance').view,
    );
  });

  it('carries over the earlier answer the caller looked up for the fresh seed', () => {
    const solved = toPlayerPicks(full);
    if (solved === undefined) throw new Error('the filled form did not read back');
    const previous: Attempt = { kind: 'clearance', picks: solved };
    const started = newSession(airport, SEED, undefined, ANY_SCENARIO, 'clearance');
    expect(withFilter(started, night, FRESH_SEED, previous).revisit).toStrictEqual(previous);
  });

  it('keeps the half of the trainer the session was running', () => {
    const started = newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment');
    expect(withFilter(started, night, FRESH_SEED, undefined).mode).toBe('amendment');
  });
});

describe('withMode', () => {
  const SEED = 1;
  const FRESH_SEED = 7;
  const night: ScenarioFilter = { time: 'night', config: { kind: 'plan', plan: 'SFOE' } };
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  it('starts the other half on the fresh seed, under the same filter', () => {
    const started = newSession(airport, SEED, undefined, night, 'clearance');
    const state = withMode(started, 'amendment', FRESH_SEED, undefined);
    expect(state.mode).toBe('amendment');
    expect(state.seed).toBe(FRESH_SEED);
    expect(state.filter).toStrictEqual(night);
    expect(state.airport).toBe(airport);
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.boxes).toStrictEqual(EMPTY_BOXES);
    expect(state.boxesSubmitted).toBe(false);
    expect(state.submitted).toBe(false);
  });

  it('carries over the earlier attempt the caller looked up for that seed and mode', () => {
    const picks = toAmendmentPicks(full);
    if (picks === undefined) throw new Error('the filled form did not read back');
    const answers = toBoxAnswers(answeredBoxes);
    if (answers === undefined) throw new Error('the answered strip did not read back');
    const previous: Attempt = { kind: 'amendment', boxes: answers, picks };
    const started = newSession(airport, SEED, undefined, ANY_SCENARIO, 'clearance');
    expect(withMode(started, 'amendment', FRESH_SEED, previous).revisit).toStrictEqual(previous);
  });
});

describe('answering the strip', () => {
  const SEED = 1;
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  /** An amendment session with every box answered but the strip not submitted yet. */
  function answered(): AppState {
    const session = newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment');
    return { ...session, boxes: answeredBoxes };
  }

  it('records one answer at a time', () => {
    const state = withBox(
      newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment'),
      'route',
      { kind: 'amended', value: 'TRUKN2 DEDHD' },
    );
    expect(state.boxes.route).toStrictEqual({ kind: 'amended', value: 'TRUKN2 DEDHD' });
    expect(state.boxes.type).toBeUndefined();
  });

  it('takes no further answer once the strip is submitted', () => {
    const submitted = withBoxesSubmitted(answered(), 'TRUKN2');
    expect(submitted.boxesSubmitted).toBe(true);
    expect(withBox(submitted, 'type', { kind: 'as_filed' })).toBe(submitted);
  });

  it('refuses to submit a strip with a box still open', () => {
    const session = newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment');
    expect(withBoxesSubmitted(session, 'TRUKN2')).toBe(session);
    const blank: AppState = {
      ...session,
      boxes: { ...answeredBoxes, route: { kind: 'amended', value: ' ' } },
    };
    expect(withBoxesSubmitted(blank, 'TRUKN2')).toBe(blank);
  });

  it('opens the form on the procedure the corrected plan files', () => {
    expect(withBoxesSubmitted(answered(), 'SSTIK5').picks.procedure).toBe('SSTIK5');
    expect(withBoxesSubmitted(answered(), undefined).picks.procedure).toBeUndefined();
  });
});

describe('withSubmitted', () => {
  const SEED = 1;
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  it('refuses a clearance form with a dropdown still blank, and takes a filled one', () => {
    const session = newSession(airport, SEED, undefined, ANY_SCENARIO, 'clearance');
    expect(withSubmitted(session).submitted).toBe(false);
    expect(withSubmitted({ ...session, picks: full }).submitted).toBe(true);
  });

  it('refuses an amendment form while the strip is still open', () => {
    const session = newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment');
    expect(withSubmitted({ ...session, picks: full }).submitted).toBe(false);
  });

  it('refuses an amendment form whose procedure is still blank', () => {
    const session = newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment');
    const state: AppState = {
      ...session,
      boxesSubmitted: true,
      picks: { ...full, procedure: undefined },
    };
    expect(withSubmitted(state).submitted).toBe(false);
  });

  it('takes an amendment form once the strip is in and the procedure is picked', () => {
    const session = newSession(airport, SEED, undefined, ANY_SCENARIO, 'amendment');
    const state: AppState = { ...session, boxesSubmitted: true, picks: full };
    expect(withSubmitted(state).submitted).toBe(true);
  });
});

describe('shareLink', () => {
  it('replaces whatever seed the URL carried', () => {
    expect(shareLink('https://leftos.dev/craft-tester/#s=zzzz', 1, ANY_SCENARIO, 'clearance')).toBe(
      'https://leftos.dev/craft-tester/#s=1',
    );
  });

  it('round-trips a seed through the hash', () => {
    const seed = 3_735_928_559;
    const link = shareLink('https://leftos.dev/craft-tester/', seed, ANY_SCENARIO, 'clearance');
    expect(seedFromHash(new URL(link).hash)).toBe(seed);
  });

  it('carries the filter the scenario was drawn under', () => {
    const filter: ScenarioFilter = { time: 'night', config: { kind: 'id', id: '28/01' } };
    const link = shareLink('https://leftos.dev/craft-tester/', 1, filter, 'clearance');
    expect(link).toBe('https://leftos.dev/craft-tester/#s=1&t=night&c=id:28%2F01');
    expect(filterFromHash(new URL(link).hash)).toStrictEqual(filter);
  });

  it('carries the half of the trainer the scenario was drawn in', () => {
    const link = shareLink('https://leftos.dev/craft-tester/', 1, ANY_SCENARIO, 'amendment');
    expect(link).toBe('https://leftos.dev/craft-tester/#s=1&m=amend');
    expect(modeFromHash(new URL(link).hash)).toBe('amendment');
  });
});
