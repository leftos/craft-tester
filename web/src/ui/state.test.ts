import { beforeAll, describe, expect, it } from 'vitest';
import type { AirportData } from '@/data/schema.ts';
import type { BoxAnswer } from '@/rules/amend/grade.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { Mode, ScenarioFilter, SessionSettings } from '@/scenario/filter.ts';
import {
  airportFromHash,
  ANY_SCENARIO,
  filterFromHash,
  fullRouteFromHash,
  inputKindFromHash,
  modeFromHash,
} from '@/scenario/filter.ts';
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
  phaseOf,
  routeReadingOf,
  shareLink,
  toAmendmentAnswer,
  toAmendmentPicks,
  toBoxAnswers,
  toClearanceAnswer,
  toPlayerPicks,
  viewKey,
  withBox,
  withBoxesSubmitted,
  withFilter,
  withFullRoute,
  withInputKind,
  withMode,
  withPick,
  withRetry,
  withSubmitted,
  withText,
} from '@/ui/state.ts';

/** The settings of a session answered with the dropdowns. */
function dropdowns(filter: ScenarioFilter, mode: Mode): SessionSettings {
  return { filter, mode, input: 'dropdowns', fullRoute: false };
}

/** The settings of a session answered by typing the clearance out. */
function typed(filter: ScenarioFilter, mode: Mode): SessionSettings {
  return { filter, mode, input: 'text', fullRoute: false };
}

/** The settings of a session typed out and held to the full route. */
function fullRoute(filter: ScenarioFilter, mode: Mode): SessionSettings {
  return { filter, mode, input: 'text', fullRoute: true };
}

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
  const previous: Attempt = { kind: 'clearance', input: 'dropdowns', picks };
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  it('starts an already solved seed with the earlier answer and an untouched form', () => {
    const state = newSession(airport, SEED, previous, dropdowns(ANY_SCENARIO, 'clearance'));
    expect(state.revisit).toStrictEqual(previous);
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.boxes).toStrictEqual(EMPTY_BOXES);
    expect(state.boxesSubmitted).toBe(false);
    expect(state.submitted).toBe(false);
    expect(state.filter).toStrictEqual(ANY_SCENARIO);
    expect(state.mode).toBe('clearance');
  });

  it('remembers no earlier answer for a seed nobody has solved', () => {
    expect(
      newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance')).revisit,
    ).toBeUndefined();
  });

  it('hides the earlier answer and empties the form on a retry', () => {
    const state = withRetry(
      newSession(airport, SEED, previous, dropdowns(ANY_SCENARIO, 'clearance')),
    );
    expect(state.revisit).toBeUndefined();
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.submitted).toBe(false);
    expect(state.seed).toBe(SEED);
  });

  it('empties a form that was just submitted', () => {
    const submitted = {
      ...newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance')),
      picks: full,
      submitted: true,
    };
    const state = withRetry(submitted);
    expect(state.picks).toStrictEqual(EMPTY_PICKS);
    expect(state.submitted).toBe(false);
    expect(state.revisit).toBeUndefined();
  });

  it('empties the strip a retried amendment had answered', () => {
    const session = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment'));
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
    const started = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
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
      newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance')),
      night,
      FRESH_SEED,
      undefined,
    );
    expect(state.view).toStrictEqual(
      newSession(airport, FRESH_SEED, undefined, dropdowns(night, 'clearance')).view,
    );
  });

  it('carries over the earlier answer the caller looked up for the fresh seed', () => {
    const solved = toPlayerPicks(full);
    if (solved === undefined) throw new Error('the filled form did not read back');
    const previous: Attempt = { kind: 'clearance', input: 'dropdowns', picks: solved };
    const started = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
    expect(withFilter(started, night, FRESH_SEED, previous).revisit).toStrictEqual(previous);
  });

  it('keeps the half of the trainer the session was running', () => {
    const started = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment'));
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
    const started = newSession(airport, SEED, undefined, dropdowns(night, 'clearance'));
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

  it('draws the scenario the half it starts trains on', () => {
    const started = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
    expect(started.view.kind).toBe('clearance');
    expect(withMode(started, 'amendment', FRESH_SEED, undefined).view.kind).toBe('amendment');
  });

  it('carries over the earlier attempt the caller looked up for that seed and mode', () => {
    const picks = toAmendmentPicks(full);
    if (picks === undefined) throw new Error('the filled form did not read back');
    const answers = toBoxAnswers(answeredBoxes);
    if (answers === undefined) throw new Error('the answered strip did not read back');
    const previous: Attempt = { kind: 'amendment', boxes: answers, input: 'dropdowns', picks };
    const started = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
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
    const session = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment'));
    return { ...session, boxes: answeredBoxes };
  }

  it('records one answer at a time', () => {
    const state = withBox(
      newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment')),
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
    const session = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment'));
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
    const session = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
    expect(withSubmitted(session).submitted).toBe(false);
    expect(withSubmitted({ ...session, picks: full }).submitted).toBe(true);
  });

  it('refuses an amendment form while the strip is still open', () => {
    const session = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment'));
    expect(withSubmitted({ ...session, picks: full }).submitted).toBe(false);
  });

  it('refuses an amendment form whose procedure is still blank', () => {
    const session = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment'));
    const state: AppState = {
      ...session,
      boxesSubmitted: true,
      picks: { ...full, procedure: undefined },
    };
    expect(withSubmitted(state).submitted).toBe(false);
  });

  it('takes an amendment form once the strip is in and the procedure is picked', () => {
    const session = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'amendment'));
    const state: AppState = { ...session, boxesSubmitted: true, picks: full };
    expect(withSubmitted(state).submitted).toBe(true);
  });
});

describe('viewKey', () => {
  const CLEARANCE_SEED = 1;
  const AMENDMENT_SEED = 7;
  const FRESH_SEED = 11;
  const night: ScenarioFilter = { time: 'night', config: { kind: 'plan', plan: 'SFOE' } };
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  /** A clearance session on a seed the engine clears, which is the form the student fills. */
  function clearing(): AppState {
    const session = newSession(
      airport,
      CLEARANCE_SEED,
      undefined,
      dropdowns(ANY_SCENARIO, 'clearance'),
    );
    expect(session.view.kind).toBe('clearance');
    return session;
  }

  /** An amendment session on a seed the engine amends, which opens on the strip's boxes. */
  function amending(): AppState {
    const session = newSession(
      airport,
      AMENDMENT_SEED,
      undefined,
      dropdowns(ANY_SCENARIO, 'amendment'),
    );
    expect(session.view.kind).toBe('amendment');
    return session;
  }

  it('does not change while the student fills the form', () => {
    const session = clearing();
    const picked = withPick(session, 'runway', '01R');
    expect(viewKey(picked)).toBe(viewKey(session));
    expect(viewKey(withPick(picked, 'frequency', '120.9'))).toBe(viewKey(session));
  });

  it('does not change while the student types in a box', () => {
    const session = amending();
    const typed = withBox(session, 'route', { kind: 'amended', value: 'TRUKN2 DEDHD' });
    expect(viewKey(typed)).toBe(viewKey(session));
    const again = withBox(typed, 'route', { kind: 'amended', value: 'TRUKN2 DEDHD Q1' });
    expect(viewKey(again)).toBe(viewKey(session));
  });

  it('changes when the strip is submitted', () => {
    const answered: AppState = { ...amending(), boxes: answeredBoxes };
    const submitted = withBoxesSubmitted(answered, 'TRUKN2');
    expect(submitted.boxesSubmitted).toBe(true);
    expect(viewKey(submitted)).not.toBe(viewKey(answered));
  });

  it('changes when the form is submitted', () => {
    const filled: AppState = { ...clearing(), picks: full };
    const submitted = withSubmitted(filled);
    expect(submitted.submitted).toBe(true);
    expect(viewKey(submitted)).not.toBe(viewKey(filled));
  });

  it('changes with the filter, with the mode, and with a fresh scenario', () => {
    const session = clearing();
    expect(viewKey(withFilter(session, night, FRESH_SEED, undefined))).not.toBe(viewKey(session));
    expect(viewKey(withMode(session, 'amendment', FRESH_SEED, undefined))).not.toBe(
      viewKey(session),
    );
    const fresh = newSession(airport, FRESH_SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
    expect(viewKey(fresh)).not.toBe(viewKey(session));
  });

  it('differs between a typed answer and a full route one', () => {
    const session = newSession(
      airport,
      CLEARANCE_SEED,
      undefined,
      typed(ANY_SCENARIO, 'clearance'),
    );
    const ticked = withFullRoute(session, true, undefined);
    expect(viewKey(ticked)).not.toBe(viewKey(session));
    expect(viewKey(withFullRoute(ticked, false, undefined))).toBe(viewKey(session));
  });
});

describe('shareLink', () => {
  it('replaces whatever seed the URL carried', () => {
    expect(
      shareLink(
        'https://leftos.dev/craft-tester/#s=zzzz',
        'KSFO',
        1,
        dropdowns(ANY_SCENARIO, 'clearance'),
      ),
    ).toBe('https://leftos.dev/craft-tester/#s=1&a=KSFO');
  });

  it('round-trips a seed through the hash', () => {
    const seed = 3_735_928_559;
    const link = shareLink(
      'https://leftos.dev/craft-tester/',
      'KSFO',
      seed,
      dropdowns(ANY_SCENARIO, 'clearance'),
    );
    expect(seedFromHash(new URL(link).hash)).toBe(seed);
  });

  it('carries the airport the scenario was drawn at', () => {
    const link = shareLink(
      'https://leftos.dev/craft-tester/',
      'KOAK',
      1,
      dropdowns(ANY_SCENARIO, 'amendment'),
    );
    expect(link).toBe('https://leftos.dev/craft-tester/#s=1&a=KOAK&m=amend');
    expect(airportFromHash(new URL(link).hash)).toBe('KOAK');
  });

  it('carries the filter the scenario was drawn under', () => {
    const filter: ScenarioFilter = { time: 'night', config: { kind: 'id', id: '28/01' } };
    const link = shareLink(
      'https://leftos.dev/craft-tester/',
      'KSFO',
      1,
      dropdowns(filter, 'clearance'),
    );
    expect(link).toBe('https://leftos.dev/craft-tester/#s=1&a=KSFO&t=night&c=id:28%2F01');
    expect(filterFromHash(new URL(link).hash)).toStrictEqual(filter);
  });

  it('carries the half of the trainer the scenario was drawn in', () => {
    const link = shareLink(
      'https://leftos.dev/craft-tester/',
      'KSFO',
      1,
      dropdowns(ANY_SCENARIO, 'amendment'),
    );
    expect(link).toBe('https://leftos.dev/craft-tester/#s=1&a=KSFO&m=amend');
    expect(modeFromHash(new URL(link).hash)).toBe('amendment');
  });

  it('carries typed answers, in either half of the trainer', () => {
    const link = shareLink(
      'https://leftos.dev/craft-tester/',
      'KSFO',
      1,
      typed(ANY_SCENARIO, 'clearance'),
    );
    expect(link).toBe('https://leftos.dev/craft-tester/#s=1&a=KSFO&i=text');
    expect(inputKindFromHash(new URL(link).hash)).toBe('text');
    expect(
      shareLink('https://leftos.dev/craft-tester/', 'KSFO', 1, typed(ANY_SCENARIO, 'amendment')),
    ).toBe('https://leftos.dev/craft-tester/#s=1&a=KSFO&m=amend&i=text');
  });

  it('carries the full route clearance, in either half of the trainer', () => {
    const link = shareLink(
      'https://leftos.dev/craft-tester/',
      'KSFO',
      1,
      fullRoute(ANY_SCENARIO, 'clearance'),
    );
    expect(link).toBe('https://leftos.dev/craft-tester/#s=1&a=KSFO&i=text&r=full');
    expect(fullRouteFromHash(new URL(link).hash)).toBe(true);
    expect(
      shareLink(
        'https://leftos.dev/craft-tester/',
        'KSFO',
        1,
        fullRoute(ANY_SCENARIO, 'amendment'),
      ),
    ).toBe('https://leftos.dev/craft-tester/#s=1&a=KSFO&m=amend&i=text&r=full');
  });
});

describe('answering by typing the clearance out', () => {
  const CLEARANCE_SEED = 1;
  const AMENDMENT_SEED = 7;
  const TYPED = 'cleared to Portland airport via the TRUKN2 departure';
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  /** A clearance session on a seed the engine clears, answered in the given input kind. */
  function clearance(input: SessionSettings['input']): AppState {
    const settings = { filter: ANY_SCENARIO, mode: 'clearance', input, fullRoute: false } as const;
    const session = newSession(airport, CLEARANCE_SEED, undefined, settings);
    expect(session.view.kind).toBe('clearance');
    return session;
  }

  /** A typed amendment session on a seed the engine amends, with every box answered. */
  function amendment(): AppState {
    const session = newSession(
      airport,
      AMENDMENT_SEED,
      undefined,
      typed(ANY_SCENARIO, 'amendment'),
    );
    expect(session.view.kind).toBe('amendment');
    return { ...session, boxes: answeredBoxes };
  }

  it('starts a session with nothing typed, in the input kind it was asked for', () => {
    const session = clearance('text');
    expect(session.input).toBe('text');
    expect(session.text).toBe('');
    expect(clearance('dropdowns').input).toBe('dropdowns');
  });

  it('has no answer while nothing but whitespace is typed', () => {
    const session = clearance('text');
    expect(toClearanceAnswer(session)).toBeUndefined();
    expect(toClearanceAnswer(withText(session, '   \n\t '))).toBeUndefined();
    expect(toAmendmentAnswer(withText(session, ' '))).toBeUndefined();
  });

  it('answers with the text exactly as typed once there is more than whitespace', () => {
    const text = `  ${TYPED}  `;
    const session = withText(clearance('text'), text);
    expect(toClearanceAnswer(session)).toStrictEqual({ input: 'text', text });
    expect(toAmendmentAnswer(session)).toStrictEqual({ input: 'text', text });
  });

  it('answers with the picks when the session is answered with the dropdowns', () => {
    const session = clearance('dropdowns');
    expect(toClearanceAnswer(withText(session, TYPED))).toBeUndefined();
    const picked: AppState = { ...session, picks: full };
    expect(toClearanceAnswer(picked)).toStrictEqual({
      input: 'dropdowns',
      picks: toPlayerPicks(full),
    });
    expect(toAmendmentAnswer(picked)).toStrictEqual({
      input: 'dropdowns',
      picks: toAmendmentPicks(full),
    });
    const noProcedure: AppState = { ...picked, picks: { ...full, procedure: undefined } };
    expect(toAmendmentAnswer(noProcedure)).toBeUndefined();
  });

  it('refuses a blank typed clearance and reaches the results once one is typed', () => {
    const session = clearance('text');
    expect(withSubmitted(session)).toBe(session);
    const blank = withText(session, '  ');
    expect(withSubmitted(blank)).toBe(blank);
    const submitted = withSubmitted(withText(session, TYPED));
    expect(submitted.submitted).toBe(true);
    expect(phaseOf(submitted)).toBe('clearance-results');
  });

  it('reaches the amendment results once the strip is in and a clearance is typed', () => {
    const typing = withText(amendment(), TYPED);
    expect(withSubmitted(typing)).toBe(typing);
    const cleared = withBoxesSubmitted(typing, undefined);
    expect(phaseOf(cleared)).toBe('clearing');
    const submitted = withSubmitted(cleared);
    expect(submitted.submitted).toBe(true);
    expect(phaseOf(submitted)).toBe('amendment-results');
  });

  it('takes no further typing once the clearance is submitted', () => {
    const submitted = withSubmitted(withText(clearance('text'), TYPED));
    expect(withText(submitted, 'something else')).toBe(submitted);
  });

  it('empties the typing box on a retry', () => {
    const submitted = withSubmitted(withText(clearance('text'), TYPED));
    const retried = withRetry(submitted);
    expect(retried.text).toBe('');
    expect(retried.submitted).toBe(false);
    expect(retried.input).toBe('text');
  });

  it('ticking full route from the dropdowns switches to typed answers', () => {
    const picked = clearance('dropdowns');
    expect(picked.fullRoute).toBe(false);
    const ticked = withFullRoute(picked, true, undefined);
    expect(ticked.fullRoute).toBe(true);
    expect(ticked.input).toBe('text');
    expect(ticked.seed).toBe(picked.seed);
    expect(ticked.view).toBe(picked.view);
    expect(ticked.text).toBe('');
    expect(ticked.submitted).toBe(false);
    expect(ticked.revisit).toBeUndefined();
  });

  it('switching to the dropdowns unticks full route', () => {
    const ticked = withFullRoute(clearance('text'), true, undefined);
    const picked = withInputKind(ticked, 'dropdowns', undefined);
    expect(picked.input).toBe('dropdowns');
    expect(picked.fullRoute).toBe(false);
    expect(withInputKind(picked, 'text', undefined).fullRoute).toBe(false);
  });

  it('keeps the text typed so far when full route is toggled', () => {
    const typing = withText(clearance('text'), TYPED);
    const ticked = withFullRoute(typing, true, undefined);
    expect(ticked.text).toBe(TYPED);
    expect(ticked.fullRoute).toBe(true);
    const unticked = withFullRoute(ticked, false, undefined);
    expect(unticked.text).toBe(TYPED);
    expect(unticked.fullRoute).toBe(false);
  });

  it('reads a ticked full route as the full reading, and anything else as the abbreviated one', () => {
    const typing = clearance('text');
    expect(routeReadingOf(typing)).toBe('abbreviated');
    expect(routeReadingOf(withFullRoute(typing, true, undefined))).toBe('full');
    expect(routeReadingOf(clearance('dropdowns'))).toBe('abbreviated');
  });
});

describe('withInputKind', () => {
  const CLEARANCE_SEED = 1;
  const AMENDMENT_SEED = 7;
  const TYPED = 'cleared to Portland airport';
  let airport: AirportData;

  beforeAll(async () => {
    airport = await loadAirportData('KSFO');
  });

  /** A picked amendment session with the strip submitted and the clearance form half filled. */
  function clearing(): AppState {
    const session = newSession(
      airport,
      AMENDMENT_SEED,
      undefined,
      dropdowns(ANY_SCENARIO, 'amendment'),
    );
    expect(session.view.kind).toBe('amendment');
    const submitted = withBoxesSubmitted({ ...session, boxes: answeredBoxes }, 'TRUKN2');
    return withPick(submitted, 'runway', '01R');
  }

  it('keeps the seed and the scenario, and starts the clearance answer again', () => {
    const before = clearing();
    const after = withInputKind(before, 'text', undefined);
    expect(after.input).toBe('text');
    expect(after.seed).toBe(before.seed);
    expect(after.view).toBe(before.view);
    expect(after.airport).toBe(before.airport);
    expect(after.filter).toBe(before.filter);
    expect(after.mode).toBe('amendment');
    expect(after.picks).toStrictEqual({ ...EMPTY_PICKS, procedure: 'TRUKN2' });
    expect(after.text).toBe('');
    expect(after.submitted).toBe(false);
  });

  it('clears the typed clearance and a submission when switching back to the dropdowns', () => {
    const typedSession = newSession(
      airport,
      CLEARANCE_SEED,
      undefined,
      typed(ANY_SCENARIO, 'clearance'),
    );
    const submitted = withSubmitted(withText(typedSession, TYPED));
    expect(submitted.submitted).toBe(true);
    const after = withInputKind(submitted, 'dropdowns', undefined);
    expect(after.input).toBe('dropdowns');
    expect(after.text).toBe('');
    expect(after.submitted).toBe(false);
    expect(phaseOf(after)).toBe('clearance-form');
  });

  it('carries the strip answers over where no attempt is remembered', () => {
    const after = withInputKind(clearing(), 'text', undefined);
    expect(after.boxes).toStrictEqual(answeredBoxes);
    expect(after.boxesSubmitted).toBe(true);
    expect(after.revisit).toBeUndefined();
    expect(phaseOf(after)).toBe('clearing');
  });

  it('keeps the procedure the submitted strip picked where the strip carries over', () => {
    const typedOver = withInputKind(clearing(), 'text', undefined);
    const back = withInputKind(typedOver, 'dropdowns', undefined);
    expect(back.picks).toStrictEqual({ ...EMPTY_PICKS, procedure: 'TRUKN2' });
  });

  it('clears the procedure pick where a remembered attempt is shown back', () => {
    const answers = toBoxAnswers(answeredBoxes);
    if (answers === undefined) throw new Error('the answered strip did not read back');
    const previous: Attempt = { kind: 'amendment', boxes: answers, input: 'text', text: TYPED };
    const after = withInputKind(clearing(), 'text', previous);
    expect(after.picks.procedure).toBeUndefined();
    expect(after.picks).toStrictEqual(EMPTY_PICKS);
  });

  it('starts the strip again and shows a remembered amendment attempt back', () => {
    const answers = toBoxAnswers(answeredBoxes);
    if (answers === undefined) throw new Error('the answered strip did not read back');
    const previous: Attempt = { kind: 'amendment', boxes: answers, input: 'text', text: TYPED };
    const after = withInputKind(clearing(), 'text', previous);
    expect(after.revisit).toStrictEqual(previous);
    expect(after.boxes).toStrictEqual(EMPTY_BOXES);
    expect(after.boxesSubmitted).toBe(false);
    expect(phaseOf(after)).toBe('amendment-revisit');
  });

  it('shows a remembered clearance attempt back', () => {
    const session = newSession(
      airport,
      CLEARANCE_SEED,
      undefined,
      dropdowns(ANY_SCENARIO, 'clearance'),
    );
    const previous: Attempt = { kind: 'clearance', input: 'text', text: TYPED };
    const after = withInputKind(withPick(session, 'runway', '01R'), 'text', previous);
    expect(after.revisit).toStrictEqual(previous);
    expect(after.picks).toStrictEqual(EMPTY_PICKS);
    expect(phaseOf(after)).toBe('clearance-revisit');
  });

  it('puts the two input kinds on one seed on different panel sets', () => {
    const before = clearing();
    const after = withInputKind(before, 'text', undefined);
    expect(phaseOf(after)).toBe(phaseOf(before));
    expect(viewKey(after)).not.toBe(viewKey(before));
    expect(viewKey(withInputKind(after, 'dropdowns', undefined))).toBe(viewKey(before));
  });
});
