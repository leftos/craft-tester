import { describe, expect, it } from 'vitest';
import { checkedInAirports } from '@/data/checkedIn.ts';
import type { AirportData, Fixture } from '@/data/schema.ts';
import { FixtureSchema } from '@/data/schema.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { speakClearance } from '@/rules/speak.ts';
import type { SpeakClearanceInput, SpokenClearance } from '@/rules/speak.ts';
import { gradeText } from '@/rules/text/grade.ts';
import type { TextGrade } from '@/rules/text/grade.ts';
import type { ClearanceElement, ResolvedClearance, RuleCitation, Verdict } from '@/rules/types.ts';
// spokenFor is the one place the reading's input is assembled from a scenario and its clearance.
import { spokenFor } from '@/ui/session.ts';

/** Every checked-in airport, keyed by ICAO, so a fixture is graded against the field it names. */
const airports = new Map<string, AirportData>(
  checkedInAirports().map((entry) => [entry.icao, entry.data]),
);

function airportOf(icao: string): AirportData {
  const data = airports.get(icao);
  if (data === undefined) {
    throw new Error(`${icao} is not an airport data/airports.json lists`);
  }
  return data;
}

const ksfo = airportOf('KSFO');

/**
 * Every checked-in fixture, loaded by a relative glob.
 *
 * The `@data` alias points at `data/`, and a glob that walks out of it (`@data/../fixtures`) is not
 * a path Vite's glob resolver accepts, so the pattern is relative to this file instead.
 */
const documents = import.meta.glob<unknown>('../../../../fixtures/**/*.json', {
  eager: true,
  import: 'default',
});

const settledClearances: Fixture[] = Object.values(documents)
  .map((json) => FixtureSchema.safeParse(json))
  .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
  .filter((fixture) => fixture.mode === 'clearance' && fixture.status === 'settled');

/** The elements a typed clearance is graded on, in the order `gradeText` returns them. */
const ELEMENTS: readonly ClearanceElement[] = [
  'C',
  'R.sid',
  'R.route',
  'A.phrase',
  'A.expect',
  'F',
  'T',
  'RWY',
];

/** The grades as `element verdict` lines, in the order they came. */
function verdictsOf(grades: readonly TextGrade[]): string[] {
  return grades.map((grade) => `${grade.element} ${grade.verdict}`);
}

/** All eight elements `correct`, but for the ones named. */
function verdictsWith(changes: Partial<Record<ClearanceElement, Verdict>> = {}): string[] {
  return ELEMENTS.map((element) => `${element} ${changes[element] ?? 'correct'}`);
}

function gradeOf(grades: readonly TextGrade[], element: ClearanceElement): TextGrade {
  const found = grades.find((grade) => grade.element === element);
  if (found === undefined) throw new Error(`no grade for ${element}`);
  return found;
}

function idsOf(grade: TextGrade): string[] {
  return grade.citations.map((citation) => citation.id);
}

/** The text with one stretch replaced, failing where the stretch is not there to replace. */
function edited(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`"${from}" is not in "${text}"`);
  return text.replace(from, to);
}

/** A settled clearance fixture resolved and spoken for real. */
type RealReading = {
  fixture: Fixture;
  airport: AirportData;
  clearance: ResolvedClearance;
  spoken: SpokenClearance;
};

function realReading(fixture: Fixture): RealReading {
  const airport = airportOf(fixture.airport);
  const result = resolveClearance(fixture.scenario, airport);
  if (!result.ok) throw new Error(`${fixture.id}: the engine resolves no clearance`);
  const spoken = spokenFor(fixture.scenario, fixture.scenario, result.clearance, airport);
  return { fixture, airport, clearance: result.clearance, spoken };
}

function settledReading(id: string): RealReading {
  const fixture = settledClearances.find((candidate) => candidate.id === id);
  if (fixture === undefined) throw new Error(`${id} is not a settled clearance fixture`);
  return realReading(fixture);
}

/** The elements whose verdict is not the one wanted, each with what was said and expected. */
function misgraded(
  grades: readonly TextGrade[],
  changes: Partial<Record<ClearanceElement, Verdict>>,
): string[] {
  const wanted = verdictsWith(changes);
  const lines = grades
    .filter((grade, index) => `${grade.element} ${grade.verdict}` !== wanted[index])
    .map(
      (grade) =>
        `${grade.element} ${grade.verdict}: said "${grade.actualLabel}", expected "${grade.expectedLabel}"`,
    );
  return grades.length === ELEMENTS.length ? lines : [...lines, `${grades.length} grades`];
}

/** The labels a grade reads where nothing was heard for its element. */
const NOTHING_HEARD: readonly string[] = ['(not heard)', 'no expect clause'];

/**
 * The grades whose said runs do not read back as their label: runs that do not join to it, or runs
 * present where nothing was heard, or missing where something was.
 */
function unjoinedSaid(grades: readonly TextGrade[]): string[] {
  return grades.flatMap((grade) => {
    const joined = grade.said.map((run) => run.text).join('');
    const heard = !NOTHING_HEARD.includes(grade.actualLabel);
    const reads = heard ? joined === grade.actualLabel : grade.said.length === 0;
    return reads ? [] : [`${grade.element}: said "${joined}", label "${grade.actualLabel}"`];
  });
}

/** What grading one fixture's own readings gets wrong. */
function corpusProblems(fixture: Fixture): string[] {
  const { airport, clearance, spoken } = realReading(fixture);
  const abbreviated = gradeText(spoken.abbreviated, spoken, clearance, airport);
  const problems = [...misgraded(abbreviated, {}), ...unjoinedSaid(abbreviated)].map(
    (line) => `${fixture.id} "${spoken.abbreviated}": ${line}`,
  );
  if (spoken.fullRoute === spoken.abbreviated) return problems;
  const full = gradeText(spoken.fullRoute, spoken, clearance, airport);
  const fullProblems = [...misgraded(full, { 'R.route': 'acceptable' }), ...unjoinedSaid(full)];
  if (!idsOf(gradeOf(full, 'R.route')).includes('R-FULL-ROUTE')) {
    fullProblems.push('R.route does not cite R-FULL-ROUTE');
  }
  return [
    ...problems,
    ...fullProblems.map((line) => `${fixture.id} "${spoken.fullRoute}": ${line}`),
  ];
}

const telephony = { UAL: 'United' };

const fixSpoken = { CCR: 'Concord VOR', RBL: 'Red Bluff VOR' };

/** A row a hand-built clearance cites, which only has to be told apart from the tier rows. */
function row(id: string): RuleCitation {
  return { id, source: 'grade.test.ts', text: id };
}

type ClearanceParts = {
  procedure?: ResolvedClearance['procedure']['value'];
  route?: ResolvedClearance['route']['value'];
  altitude?: ResolvedClearance['altitude']['value'];
  redundantExpect?: ResolvedClearance['redundantExpect']['value'];
};

function clearance(parts: ClearanceParts = {}): ResolvedClearance {
  const redundantExpect = parts.redundantExpect ?? null;
  return {
    clearedTo: { value: 'KSEA', citations: [row('OWN-C')] },
    runway: { value: '01R', citations: [row('OWN-RWY')] },
    procedure: {
      value: parts.procedure ?? {
        kind: 'sid',
        id: 'TRUKN2',
        family: 'TRUKN',
        spoken: 'Trukn Two',
      },
      citations: [row('OWN-SID')],
    },
    route: {
      value: parts.route ?? { template: 'transition', fix: 'DEDHD' },
      citations: [row('OWN-ROUTE')],
    },
    altitude: {
      value: parts.altitude ?? { phrase: 'climb_via' },
      citations: [row('OWN-ALTITUDE')],
    },
    expect: { value: null, citations: [row('OWN-EXPECT')] },
    redundantExpect: {
      value: redundantExpect,
      citations: redundantExpect === null ? [] : [row('OWN-REDUNDANT')],
    },
    frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [row('OWN-F')] },
  };
}

/** The speak input; `originalRoute` follows the filed route. */
function input(overrides: Partial<SpeakClearanceInput> = {}): SpeakClearanceInput {
  const filedRoute = overrides.filedRoute ?? 'TRUKN2 DEDHD RBL HAWKZ7';
  return {
    callsign: 'UAL320',
    clearance: clearance(),
    destinationSpoken: 'Seattle',
    filedRoute,
    originalRoute: filedRoute,
    airportFaa: 'SFO',
    squawk: '3342',
    telephony,
    fixSpoken,
    sidTransitions: [{ fix: 'DEDHD', spoken: 'Dedhd' }],
    ...overrides,
  };
}

/** The abbreviated reading of a hand-built clearance. */
function readingOf(speakInput: SpeakClearanceInput = input()): string {
  return speakClearance(speakInput).abbreviated;
}

/** A text graded against a hand-built clearance, at KSFO. */
function graded(text: string, speakInput: SpeakClearanceInput = input()): TextGrade[] {
  return gradeText(text, speakClearance(speakInput), speakInput.clearance, ksfo);
}

const STRAY_EXPECT = 'Expect flight level three four zero one zero minutes after departure. ';

describe('gradeText', () => {
  it("grades the engine's own reading correct in every element, for every settled clearance fixture", () => {
    expect(settledClearances.length).toBeGreaterThan(0);
    expect(settledClearances.flatMap((fixture) => corpusProblems(fixture))).toEqual([]);
  });

  it('grades a clearance typed in figures and identifiers correct', () => {
    const {
      fixture,
      airport,
      clearance: resolved,
      spoken,
    } = settledReading('syn-trukn2-dedhd-01r-2801');
    expect(resolved.expect.value).toBeNull();
    expect(resolved.redundantExpect.value).toEqual({ kind: 'filed', feet: 34000, minutes: 10 });
    const typed =
      'UAL418, cleared to KSEA airport, TRUKN2 departure, DEDHD transition, then as filed. ' +
      `Climb via SID. Departure frequency 120.9, squawk ${fixture.scenario.squawk}. Expect runway 1R.`;
    expect(verdictsOf(gradeText(typed, spoken, resolved, airport))).toEqual(verdictsWith());

    const withExpect = edited(
      typed,
      'Climb via SID. ',
      'Climb via SID. Expect FL340 10 minutes after departure. ',
    );
    const grades = gradeText(withExpect, spoken, resolved, airport);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ 'A.expect': 'acceptable' }));
    expect(idsOf(gradeOf(grades, 'A.expect'))).toEqual(
      resolved.redundantExpect.citations.map((citation) => citation.id),
    );
    expect(idsOf(gradeOf(grades, 'A.expect'))).toContain('A-EXPECT-REDUNDANT');
  });

  it('marks filler acceptable on the element it sits in', () => {
    const climb = edited(readingOf(), 'Climb via SID', 'Climb via the SID');
    const climbGrades = graded(climb);
    expect(verdictsOf(climbGrades)).toEqual(verdictsWith({ 'A.phrase': 'acceptable' }));
    const altitude = gradeOf(climbGrades, 'A.phrase');
    expect(idsOf(altitude)).toEqual(['OWN-ALTITUDE', 'S-FILLER']);
    expect(altitude.said).toEqual([
      { text: 'Climb via ', kind: 'said' },
      { text: 'the', kind: 'filler' },
      { text: ' SID', kind: 'said' },
    ]);

    const frequency = edited(
      readingOf(),
      'Departure frequency one two zero point niner',
      'Your departure frequency will be one two zero point niner',
    );
    const frequencyGrades = graded(frequency);
    expect(verdictsOf(frequencyGrades)).toEqual(verdictsWith({ F: 'acceptable' }));
    expect(
      gradeOf(frequencyGrades, 'F')
        .said.filter((run) => run.kind === 'filler')
        .map((run) => run.text),
    ).toEqual(['Your', 'will be']);
  });

  it('takes the facility word after a bare fix as right', () => {
    const speakInput = input({
      clearance: clearance({
        procedure: { kind: 'sid', id: 'MOLEN9', family: 'MOLEN', spoken: 'Molen Nine' },
        route: { template: 'as_filed', fix: 'CCR' },
      }),
      filedRoute: 'MOLEN9 CCR RBL',
      sidTransitions: [],
    });
    const text = edited(
      readingOf(speakInput),
      'Concord, then as filed',
      'Concord VOR, then as filed',
    );
    const grades = graded(text, speakInput);
    expect(verdictsOf(grades)).toEqual(verdictsWith());
    expect(idsOf(gradeOf(grades, 'R.route'))).toEqual(['OWN-ROUTE', 'R-FACILITY-WORD']);
    expect(gradeOf(grades, 'R.route').actualLabel).toBe('Concord VOR, then as filed');
  });

  it('grades "nine" for a digit wrong, and a procedure\'s own Nine right', () => {
    const text = edited(readingOf(), 'one two zero point niner', 'one two zero point nine');
    const grades = graded(text);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ F: 'wrong' }));
    expect(idsOf(gradeOf(grades, 'F'))).toEqual(['OWN-F', 'S-NINER']);

    // No settled clearance fixture flies COAST9 (the ZOA notice route-builds it onto CNDEL5), so the
    // procedure whose chart name says "Nine" is the MOLEN NINE.
    const { airport, clearance: resolved, spoken } = settledReading('syn-molen9-molen-28l');
    expect(spoken.abbreviated).toContain('Molen Nine departure');
    const molen = gradeText(spoken.abbreviated, spoken, resolved, airport);
    expect(gradeOf(molen, 'R.sid').verdict).toBe('correct');
  });

  it('grades the group form only as a restatement', () => {
    const speakInput = input({
      clearance: clearance({ altitude: { phrase: 'maintain', feet: 10000 } }),
    });
    const reading = readingOf(speakInput);
    const group = graded(edited(reading, 'one zero thousand', 'ten thousand'), speakInput);
    expect(verdictsOf(group)).toEqual(verdictsWith({ 'A.phrase': 'wrong' }));
    expect(idsOf(gradeOf(group, 'A.phrase'))).toEqual(['OWN-ALTITUDE', 'S-GROUP-FORM']);

    for (const restated of ['one zero thousand ten thousand', 'one zero ten thousand']) {
      const grades = graded(edited(reading, 'one zero thousand', restated), speakInput);
      expect(verdictsOf(grades)).toEqual(verdictsWith({ 'A.phrase': 'acceptable' }));
      expect(idsOf(gradeOf(grades, 'A.phrase'))).toEqual(['OWN-ALTITUDE', 'S-GROUP-FORM']);
    }
  });

  it('shows a restatement in the element it restates', () => {
    const speakInput = input({
      clearance: clearance({ altitude: { phrase: 'maintain', feet: 10000 } }),
    });
    const text = edited(
      readingOf(speakInput),
      'one zero thousand',
      'one zero thousand ten thousand',
    );
    expect(gradeOf(graded(text, speakInput), 'A.phrase').actualLabel).toContain('ten thousand');
  });

  it('marks an element read out of order wrong and leaves the rest right', () => {
    const text = edited(
      readingOf(),
      'Departure frequency one two zero point niner, squawk three three four two.',
      'Squawk three three four two, departure frequency one two zero point niner.',
    );
    const grades = graded(text);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ T: 'wrong' }));
    expect(idsOf(gradeOf(grades, 'T'))).toEqual(['S-ORDER']);
    expect(gradeOf(grades, 'T').actualLabel).toBe('Squawk three three four two');
  });

  it('marks an element said before the clearance limit out of order', () => {
    const reading = edited(readingOf(), ', squawk three three four two', '');
    const text = `Squawk three three four two, ${reading}`;
    const grades = graded(text);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ T: 'wrong' }));
    expect(idsOf(gradeOf(grades, 'T'))).toEqual(['S-ORDER']);
    expect(gradeOf(grades, 'T').actualLabel).toBe('Squawk three three four two');
    expect(gradeOf(grades, 'C').verdict).toBe('correct');
  });

  it('said runs join back to the label', () => {
    const text = edited(
      readingOf(),
      'Climb via SID. Departure frequency one two zero point niner, squawk three three four two.',
      'Climb via, squawk three three four two, SID. Departure frequency one two zero point niner.',
    );
    const grades = graded(text);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ T: 'wrong' }));
    const altitude = gradeOf(grades, 'A.phrase');
    expect(altitude.said.some((run) => run.kind === 'break')).toBe(true);
    expect(altitude.said).toEqual([
      { text: 'Climb via', kind: 'said' },
      { text: ' … ', kind: 'break' },
      { text: 'SID', kind: 'said' },
    ]);
    expect(unjoinedSaid(grades)).toEqual([]);

    const noSquawk = graded(edited(readingOf(), ', squawk three three four two', ''));
    expect(gradeOf(noSquawk, 'T').said).toEqual([]);
    expect(unjoinedSaid(noSquawk)).toEqual([]);
  });

  it('marks a missing required word, a missing element and a wrong value wrong without touching the neighbours', () => {
    const limit = graded(edited(readingOf(), 'cleared to Seattle airport', 'cleared to Seattle'));
    expect(verdictsOf(limit)).toEqual(verdictsWith({ C: 'wrong' }));
    expect(idsOf(gradeOf(limit, 'C'))).toEqual(['OWN-C']);

    const noSquawk = graded(edited(readingOf(), ', squawk three three four two', ''));
    expect(verdictsOf(noSquawk)).toEqual(verdictsWith({ T: 'wrong' }));
    expect(gradeOf(noSquawk, 'T').actualLabel).toBe('(not heard)');

    const frequency = graded(edited(readingOf(), 'one two zero point niner', '120.8'));
    expect(verdictsOf(frequency)).toEqual(verdictsWith({ F: 'wrong' }));
    expect(gradeOf(frequency, 'F').actualLabel).toBe('Departure frequency 120.8');
  });

  it('accepts "then as filed" where the route is read to its end', () => {
    const speakInput = input({
      clearance: clearance({ route: { template: 'as_filed', fix: 'TRUKN' } }),
      filedRoute: 'TRUKN2 TRUKN',
    });
    const reading = readingOf(speakInput);
    expect(reading).toContain('Trukn Two departure, Trukn, direct.');
    const grades = graded(edited(reading, 'Trukn, direct.', 'Trukn, then as filed.'), speakInput);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ 'R.route': 'acceptable' }));
    expect(idsOf(gradeOf(grades, 'R.route'))).toEqual(['OWN-ROUTE', 'R-THEN-AS-FILED-END']);
  });

  /** A flight cleared on the runway heading, radar vectors direct, as an `RH RV` TEC route issues. */
  const vectorsDirect = input({
    clearance: clearance({
      procedure: {
        kind: 'heading',
        heading: 'runway heading',
        turn: undefined,
        spoken: 'fly runway heading',
      },
      route: { template: 'radar_vectors_direct' },
      altitude: { phrase: 'maintain', feet: 5000 },
    }),
    filedRoute: 'RH RV',
  });

  it('grades "radar vectors direct" correct on a vectors-direct clearance', () => {
    const reading = readingOf(vectorsDirect);
    expect(reading).toContain('via fly runway heading, radar vectors direct.');
    const grades = graded(reading, vectorsDirect);
    expect(verdictsOf(grades)).toEqual(verdictsWith());
    expect(idsOf(gradeOf(grades, 'R.route'))).toEqual(['OWN-ROUTE']);
  });

  it('does not take the "direct" of radar vectors direct for the closing "direct" of a route read to its end', () => {
    const reading = readingOf(vectorsDirect);
    const said = edited(reading, 'radar vectors direct.', 'radar vectors, then as filed.');
    const route = gradeOf(graded(said, vectorsDirect), 'R.route');
    expect(['correct', 'acceptable']).not.toContain(route.verdict);
    expect(idsOf(route)).not.toContain('R-THEN-AS-FILED-END');
  });

  it('grades the expect clause the chart already publishes acceptable, and a clause nobody wants wrong', () => {
    const redundant = input({
      clearance: clearance({ redundantExpect: { kind: 'filed', feet: 34000, minutes: 10 } }),
    });
    const said = edited(readingOf(redundant), 'Climb via SID. ', `Climb via SID. ${STRAY_EXPECT}`);
    const redundantGrades = graded(said, redundant);
    expect(verdictsOf(redundantGrades)).toEqual(verdictsWith({ 'A.expect': 'acceptable' }));
    expect(idsOf(gradeOf(redundantGrades, 'A.expect'))).toEqual(['OWN-REDUNDANT']);

    const stray = edited(readingOf(), 'Climb via SID. ', `Climb via SID. ${STRAY_EXPECT}`);
    const strayGrades = graded(stray);
    expect(verdictsOf(strayGrades)).toEqual(verdictsWith({ 'A.expect': 'wrong' }));
    const clause = gradeOf(strayGrades, 'A.expect');
    expect(idsOf(clause)).toEqual(['OWN-EXPECT']);
    expect(clause.expectedLabel).toBe('no expect clause');
    expect(clause.actualLabel).toBe(
      'Expect flight level three four zero one zero minutes after departure',
    );
  });

  it('ignores the callsign whether it is said or not', () => {
    const reading = readingOf();
    const plain = graded(reading);
    expect(verdictsOf(plain)).toEqual(verdictsWith());
    expect(gradeOf(plain, 'A.expect').actualLabel).toBe('no expect clause');
    expect(verdictsOf(graded(edited(reading, 'United three twenty, cleared', 'Cleared')))).toEqual(
      verdictsWith(),
    );
    expect(verdictsOf(graded(edited(reading, 'United three twenty', 'UAL320')))).toEqual(
      verdictsWith(),
    );
  });

  it('hears nothing in a text that matches nothing', () => {
    const grades = graded('hello there');
    expect(verdictsOf(grades)).toEqual(
      verdictsWith(
        Object.fromEntries(
          ELEMENTS.filter((element) => element !== 'A.expect').map((element) => [element, 'wrong']),
        ),
      ),
    );
    expect(
      grades.filter((grade) => grade.element !== 'A.expect').map((grade) => grade.actualLabel),
    ).toEqual(Array.from({ length: ELEMENTS.length - 1 }, () => '(not heard)'));
  });

  it('cites only its own rows on an element a wrong value spoils', () => {
    const text = edited(
      readingOf(),
      'Departure frequency one two zero point niner',
      'Your departure frequency one two zero point eight',
    );
    const grades = graded(text);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ F: 'wrong' }));
    expect(idsOf(gradeOf(grades, 'F'))).toEqual(['OWN-F']);
  });
});

/** A settled KOAK practice reading, typed against its own airport, its SID, name and squawk in it. */
const FDX_PRACTICE = 'ws-koak-phraseology-practice-1a-fdx354';

/** The practice reading as typed, with one stretch of it edited. */
function fdxGraded(edit: (reading: string) => string): TextGrade[] {
  const { airport, clearance: resolved, spoken } = settledReading(FDX_PRACTICE);
  return gradeText(edit(spoken.abbreviated), spoken, resolved, airport);
}

/** The misspellings these tests type: a row that spelt one would have the matcher read it as typed. */
const MISSPELLINGS: readonly string[] = ['depature', 'sqawk', 'sacremento'];

/** The elements whose citations quote the spelling row. */
function spellingCiters(grades: readonly TextGrade[]): string[] {
  return grades
    .filter((grade) => idsOf(grade).includes('S-SPELLING'))
    .map((grade) => grade.element);
}

describe('gradeText on a word typed a letter or two away from the reading', () => {
  it('a misspelt fixed word is the word, citing S-SPELLING', () => {
    const grades = fdxGraded((reading) => edited(reading, ' departure,', ' depature,'));
    expect(misgraded(grades, {})).toEqual([]);
    expect(spellingCiters(grades)).toEqual(['R.sid']);
  });

  it('a misspelt squawk anchor is the word', () => {
    const grades = fdxGraded((reading) => edited(reading, 'squawk', 'sqawk'));
    expect(misgraded(grades, {})).toEqual([]);
    expect(spellingCiters(grades)).toEqual(['T']);
  });

  it('a misspelt name is the name', () => {
    const grades = fdxGraded((reading) => edited(reading, 'Seattle', 'Seatle'));
    expect(misgraded(grades, {})).toEqual([]);
    expect(spellingCiters(grades)).toEqual(['C']);
  });

  it('a word too far from the reading is still a miss', () => {
    const grades = fdxGraded((reading) => edited(reading, 'squawk', 'sqwk'));
    expect(verdictsOf(grades)).toEqual(verdictsWith({ T: 'wrong' }));
    expect(spellingCiters(grades)).toEqual([]);
  });

  it('a misspelt number word is not guessed at', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'squawk three three four two', 'squawk thre three four two'),
    );
    expect(gradeOf(grades, 'T').verdict).toBe('wrong');
  });

  it('a reading typed exactly cites no spelling row', () => {
    const grades = fdxGraded((reading) => reading);
    expect(misgraded(grades, {})).toEqual([]);
    expect(spellingCiters(grades)).toEqual([]);
  });

  it("the spelling row's own text does not shield a misspelling", () => {
    const spelt = [...airports].flatMap(([icao, data]) =>
      data.phraseologyRules.flatMap((rule) => {
        const words = new Set(rule.text.toLowerCase().match(/[a-z]+/gu) ?? []);
        return MISSPELLINGS.filter((word) => words.has(word)).map(
          (word) => `${icao} ${rule.id}: "${word}"`,
        );
      }),
    );
    expect(spelt).toEqual([]);
  });
});

/** What the expected runs of one grade get wrong: how they join, how they alternate, what they mark. */
function expectedProblems(grades: readonly TextGrade[]): string[] {
  return grades.flatMap((grade) => {
    const runs = grade.expected;
    const problems: string[] = [];
    const joined = runs.map((run) => run.text).join('');
    if (joined !== grade.expectedLabel) {
      problems.push(`joins to "${joined}", label "${grade.expectedLabel}"`);
    }
    if (runs.some((run) => run.text === '')) problems.push('has an empty run');
    if (runs.some((run, index) => index > 0 && run.missed === runs[index - 1]?.missed)) {
      problems.push('has two neighbouring runs alike');
    }
    if (grade.verdict !== 'wrong' && runs.some((run) => run.missed)) {
      problems.push(`marks a word on a grade that is ${grade.verdict}`);
    }
    return problems.map((line) => `${grade.element}: ${line}`);
  });
}

/** The expected runs of one fixture's own abbreviated and full readings. */
function expectedCorpusProblems(fixture: Fixture): string[] {
  const { airport, clearance, spoken } = realReading(fixture);
  const readings = [
    spoken.abbreviated,
    ...(spoken.fullRoute === spoken.abbreviated ? [] : [spoken.fullRoute]),
  ];
  return readings.flatMap((reading) =>
    expectedProblems(gradeText(reading, spoken, clearance, airport)).map(
      (line) => `${fixture.id} "${reading}": ${line}`,
    ),
  );
}

describe('the expected words of a typed grade', () => {
  it('marks the anchor word the student never said', () => {
    const grades = fdxGraded((reading) => edited(reading, 'squawk', 'sqwk'));
    expect(gradeOf(grades, 'T').expected).toEqual([
      { text: 'squawk', missed: true },
      { text: ' three three four two', missed: false },
    ]);
  });

  it('marks the value the student said another value for', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'squawk three three four two', 'squawk three three four one'),
    );
    expect(gradeOf(grades, 'T').expected).toEqual([
      { text: 'squawk ', missed: false },
      { text: 'three three four two', missed: true },
    ]);
  });

  it('merges the words of a closing clause left out into one mark', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'radar vectors Dedhd, then as filed', 'radar vectors Dedhd'),
    );
    expect(gradeOf(grades, 'R.route').expected).toEqual([
      { text: 'radar vectors Dedhd, ', missed: false },
      { text: 'then as filed', missed: true },
    ]);
  });

  it('marks nothing on an element nothing was heard for', () => {
    const grades = fdxGraded((reading) => edited(reading, ', squawk three three four two', ''));
    const squawk = gradeOf(grades, 'T');
    expect(squawk.verdict).toBe('wrong');
    expect(squawk.expected).toEqual([{ text: 'squawk three three four two', missed: false }]);
  });

  it('marks nothing on a reading typed exactly', () => {
    const grades = fdxGraded((reading) => reading);
    expect(grades.map((grade) => grade.expected)).toEqual(
      grades.map((grade) => [{ text: grade.expectedLabel, missed: false }]),
    );
  });

  it('joins, alternates and marks nothing over every settled reading', () => {
    expect(settledClearances.length).toBeGreaterThan(0);
    expect(settledClearances.flatMap((fixture) => expectedCorpusProblems(fixture))).toEqual([]);
  });
});
