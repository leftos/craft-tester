import { describe, expect, it } from 'vitest';
import { checkedInAirports } from '@/data/checkedIn.ts';
import type { AirportData, Fixture } from '@/data/schema.ts';
import { FixtureSchema } from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { speakClearance } from '@/rules/speak.ts';
import type { SpeakClearanceInput, SpokenClearance } from '@/rules/speak.ts';
import { gradeText } from '@/rules/text/grade.ts';
import type { RouteReading, TextGrade } from '@/rules/text/grade.ts';
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

/** Every fixture the glob loads and the schema parses, whatever mode it is written for. */
const parsedFixtures: Fixture[] = Object.values(documents)
  .map((json) => FixtureSchema.safeParse(json))
  .flatMap((parsed) => (parsed.success ? [parsed.data] : []));

const settledClearances: Fixture[] = parsedFixtures.filter(
  (fixture) => fixture.mode === 'clearance' && fixture.status === 'settled',
);

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

/** A fixture of any mode, by id, resolved and spoken for real. */
function fixtureReading(id: string): RealReading {
  const fixture = parsedFixtures.find((candidate) => candidate.id === id);
  if (fixture === undefined) throw new Error(`${id} is not a fixture under fixtures/`);
  return realReading(fixture);
}

/** The abbreviated reading with one element's words cut out of it, however they are capitalised. */
function readingWithout(reading: RealReading, element: ClearanceElement): string {
  const { abbreviated, parts } = reading.spoken;
  const words = parts.find((part) => part.element === element)?.words;
  if (words === undefined) throw new Error(`${reading.fixture.id}: the reading has no ${element}`);
  const at = abbreviated.toLowerCase().indexOf(words.toLowerCase());
  if (at === -1) throw new Error(`${reading.fixture.id}: "${words}" is not in "${abbreviated}"`);
  return abbreviated.slice(0, at) + abbreviated.slice(at + words.length);
}

/** A text graded against a fixture's own reading and clearance. */
function gradedAgainst(reading: RealReading, text: string): TextGrade[] {
  return gradeText(text, reading.spoken, reading.clearance, reading.airport, 'abbreviated');
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
  const abbreviated = gradeText(spoken.abbreviated, spoken, clearance, airport, 'abbreviated');
  const problems = [...misgraded(abbreviated, {}), ...unjoinedSaid(abbreviated)].map(
    (line) => `${fixture.id} "${spoken.abbreviated}": ${line}`,
  );
  if (spoken.fullRoute === spoken.abbreviated) return problems;
  const full = gradeText(spoken.fullRoute, spoken, clearance, airport, 'abbreviated');
  const fullProblems = [...misgraded(full, { 'R.route': 'acceptable' }), ...unjoinedSaid(full)];
  if (!idsOf(gradeOf(full, 'R.route')).includes('R-FULL-ROUTE')) {
    fullProblems.push('R.route does not cite R-FULL-ROUTE');
  }
  return [
    ...problems,
    ...fullProblems.map((line) => `${fixture.id} "${spoken.fullRoute}": ${line}`),
  ];
}

/** What holding one fixture's own readings to the full route gets wrong. */
function fullRouteProblems(fixture: Fixture): string[] {
  const { airport, clearance, spoken } = realReading(fixture);
  const full = gradeText(spoken.fullRoute, spoken, clearance, airport, 'full');
  const problems = [...misgraded(full, {}), ...unjoinedSaid(full)].map(
    (line) => `${fixture.id} "${spoken.fullRoute}": ${line}`,
  );
  if (spoken.fullRoute === spoken.abbreviated) return problems;
  const abbreviated = gradeText(spoken.abbreviated, spoken, clearance, airport, 'full');
  const shortProblems = [
    ...misgraded(abbreviated, { 'R.route': 'wrong' }),
    ...unjoinedSaid(abbreviated),
  ];
  if (!idsOf(gradeOf(abbreviated, 'R.route')).includes('R-FRC')) {
    shortProblems.push('R.route does not cite R-FRC');
  }
  return [
    ...problems,
    ...shortProblems.map((line) => `${fixture.id} "${spoken.abbreviated}": ${line}`),
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

/** A text graded against a hand-built clearance, at KSFO, under the reading it is held to. */
function gradedAs(
  text: string,
  routeReading: RouteReading,
  speakInput: SpeakClearanceInput = input(),
): TextGrade[] {
  return gradeText(text, speakClearance(speakInput), speakInput.clearance, ksfo, routeReading);
}

/** A text graded against a hand-built clearance, at KSFO. */
function graded(text: string, speakInput: SpeakClearanceInput = input()): TextGrade[] {
  return gradedAs(text, 'abbreviated', speakInput);
}

const STRAY_EXPECT = 'Expect flight level three four zero one zero minutes after departure. ';

describe('gradeText', () => {
  it("grades the engine's own reading correct in every element, for every settled clearance fixture", () => {
    expect(settledClearances.length).toBeGreaterThan(0);
    expect(settledClearances.flatMap((fixture) => corpusProblems(fixture))).toEqual([]);
  });

  it('reads every settled fixture in full as right, and its shorter reading as R-FRC', () => {
    expect(settledClearances.length).toBeGreaterThan(0);
    expect(settledClearances.flatMap((fixture) => fullRouteProblems(fixture))).toEqual([]);
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
    expect(verdictsOf(gradeText(typed, spoken, resolved, airport, 'abbreviated'))).toEqual(
      verdictsWith(),
    );

    const withExpect = edited(
      typed,
      'Climb via SID. ',
      'Climb via SID. Expect FL340 10 minutes after departure. ',
    );
    const grades = gradeText(withExpect, spoken, resolved, airport, 'abbreviated');
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
    const molen = gradeText(spoken.abbreviated, spoken, resolved, airport, 'abbreviated');
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
  return gradeText(edit(spoken.abbreviated), spoken, resolved, airport, 'abbreviated');
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

describe('gradeText on an identifier typed in place of the words it is spoken as', () => {
  it('reads a procedure identifier in lower case as the procedure', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'Oakland Six departure', 'oak6 departure'),
    );
    expect(misgraded(grades, {})).toEqual([]);
  });

  it('reads a procedure identifier in capitals as the procedure', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'Oakland Six departure', 'OAK6 departure'),
    );
    expect(misgraded(grades, {})).toEqual([]);
  });

  it('reads a destination code in lower case as the destination', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'Seattle-Tacoma International airport', 'ksea airport'),
    );
    expect(misgraded(grades, {})).toEqual([]);
  });

  it('reads a word the reading itself says as typed, not as the identifier it spells', () => {
    const { airport, clearance: resolved, spoken } = settledReading(FDX_PRACTICE);
    const spelling: AirportData = {
      ...airport,
      fixSpoken: { ...airport.fixSpoken, VIA: 'Viaduct VOR' },
    };
    expect(spoken.abbreviated).toContain(' via ');
    expect(
      misgraded(gradeText(spoken.abbreviated, spoken, resolved, spelling, 'abbreviated'), {}),
    ).toEqual([]);
  });
});

/** A settled KSFO reading vectored to a navaid its route names in full. */
const SAC_VECTORS = 'syn-gapp7-sac-28l-nonrnav-jet';

/** The route grades of one reading typed as read, and of the same reading with a stretch spelt. */
function speltRoute(id: string, name: string, spelt: string): [TextGrade, TextGrade] {
  const reading = settledReading(id);
  const asRead = gradedAgainst(reading, reading.spoken.abbreviated);
  const typed = gradedAgainst(reading, edited(reading.spoken.abbreviated, name, spelt));
  expect(misgraded(typed, {})).toEqual([]);
  return [gradeOf(typed, 'R.route'), gradeOf(asRead, 'R.route')];
}

describe('gradeText on an identifier spelt in the phonetic alphabet', () => {
  it('reads a navaid spelt letter by letter as the navaid', () => {
    const [spelt, asRead] = speltRoute(SAC_VECTORS, 'Sacramento VOR', 'sierra alpha charlie');
    expect(spelt.remarks).toEqual([]);
    expect(idsOf(spelt)).toEqual(idsOf(asRead));
  });

  it('reads a five-letter fix spelt letter by letter as the fix', () => {
    const [spelt, asRead] = speltRoute(FDX_PRACTICE, 'Dedhd', 'delta echo delta hotel delta');
    expect(spelt.remarks).toEqual([]);
    expect(idsOf(spelt)).toEqual(idsOf(asRead));
  });
});

/** The practice reading with the field named another way, in place of the name the reading reads. */
function namedGraded(name: string): TextGrade[] {
  return fdxGraded((reading) => edited(reading, 'Seattle-Tacoma International', name));
}

/** The rows the clearance limit cites when the reading is typed as read. */
function limitCitations(): string[] {
  return idsOf(
    gradeOf(
      fdxGraded((reading) => reading),
      'C',
    ),
  );
}

describe('gradeText on a field named by another name its row lists', () => {
  it('the name the reading reads is the name', () => {
    const grades = fdxGraded((reading) => reading);
    expect(misgraded(grades, {})).toEqual([]);
    expect(gradeOf(grades, 'C').remarks).toEqual([]);
    expect(limitCitations().length).toBeGreaterThan(0);
  });

  it.each(['Seattle', 'Seattle-Tacoma', 'Sea-Tac', 'sea-tac'])(
    'the field named "%s" is the field itself',
    (name) => {
      const grades = namedGraded(name);
      expect(misgraded(grades, {})).toEqual([]);
      const limit = gradeOf(grades, 'C');
      expect(limit.remarks).toEqual([]);
      expect(idsOf(limit)).toEqual(limitCitations());
    },
  );

  it('a word no name of the row holds is filler beside the name it does hold', () => {
    const grades = namedGraded('the Seattle metro');
    expect(misgraded(grades, { C: 'acceptable' })).toEqual([]);
    const limit = gradeOf(grades, 'C');
    expect(idsOf(limit)).toEqual([...limitCitations(), 'S-FILLER']);
    expect(limit.remarks).toEqual(['extra words: the, metro']);
  });

  it('another field is the wrong field', () => {
    expect(misgraded(namedGraded('Portland'), { C: 'wrong' })).toEqual([]);
  });

  it('a name typed a letter away from one the row lists is that name', () => {
    const grades = namedGraded('Seatle');
    expect(misgraded(grades, {})).toEqual([]);
    expect(spellingCiters(grades)).toEqual(['C']);
  });
});

/** A hand-built reading whose squawk carries a leading zero, so its digits can be typed in pieces. */
const leadingZeroSquawk = input({ squawk: '0062' });

/** The leading-zero reading with the squawk it reads typed another way. */
function squawkGraded(said: string): TextGrade[] {
  return graded(
    edited(readingOf(leadingZeroSquawk), 'squawk zero zero six two', said),
    leadingZeroSquawk,
  );
}

describe('gradeText on a number typed in pieces', () => {
  it('reads the pieces of a squawk as the one number they spell', () => {
    const grades = squawkGraded('sqawk 00 six two');
    expect(misgraded(grades, {})).toEqual([]);
    const squawk = gradeOf(grades, 'T');
    expect(idsOf(squawk)).toEqual(['S-SPELLING']);
    expect(squawk.remarks).toEqual([]);
  });

  it.each(['squawk 00 62', 'squawk 0 0 six two'])('reads "%s" as the squawk', (said) => {
    expect(misgraded(squawkGraded(said), {})).toEqual([]);
  });

  it('holds a squawk whose pieces end in a group form to what a group form alone reads as', () => {
    const joined = gradeOf(squawkGraded('squawk 00 sixty-two'), 'T');
    const whole = gradeOf(
      graded(edited(readingOf(), 'squawk three three four two', 'squawk thirty-three forty-two')),
      'T',
    );
    expect(whole.verdict).toBe('wrong');
    expect(joined.verdict).toBe(whole.verdict);
    expect(idsOf(joined)).toEqual(idsOf(whole));
    expect(joined.remarks).toEqual(whole.remarks);
  });

  it('joins nothing where the pieces spell no number the reading says', () => {
    const tenThousand = input({
      clearance: clearance({ redundantExpect: { kind: 'filed', feet: 10000, minutes: 10 } }),
    });
    const said = edited(
      readingOf(tenThousand),
      'Climb via SID. ',
      'Climb via SID. Expect 10000 one zero minutes after departure. ',
    );
    const grades = graded(said, tenThousand);
    expect(verdictsOf(grades)).toEqual(verdictsWith({ 'A.expect': 'acceptable' }));
    expect(idsOf(gradeOf(grades, 'A.expect'))).toEqual(['OWN-REDUNDANT']);
  });
});

/** The practice reading with the field typed as its code and the procedure as its identifier. */
function codedGraded(limit: string): TextGrade[] {
  return fdxGraded((reading) =>
    edited(
      edited(reading, 'cleared to Seattle-Tacoma International airport', limit),
      'Oakland Six departure',
      'oak6 depature',
    ),
  );
}

describe('gradeText on a field typed as its code', () => {
  it('names the word left out and nothing else', () => {
    const grades = codedGraded('cleared to ksea');
    expect(misgraded(grades, { C: 'wrong' })).toEqual([]);
    expect(gradeOf(grades, 'C').remarks).toEqual(['missed: "airport"']);
    expect(spellingCiters(grades)).toEqual(['R.sid']);
  });

  it('grades the code with the word said correct', () => {
    const grades = codedGraded('cleared to ksea airport');
    expect(misgraded(grades, {})).toEqual([]);
    expect(spellingCiters(grades)).toEqual(['R.sid']);
  });
});

/** A settled KOAK practice reading whose route is radar vectors to join an airway. */
const AIRWAY_PRACTICE = 'ws-koak-phraseology-practice-2-n436ms';

describe('gradeText on the airway a clearance is vectored to join', () => {
  it('grades the joined airway said with its word correct', () => {
    const reading = settledReading(AIRWAY_PRACTICE);
    expect(reading.spoken.abbreviated).toContain('radar vectors to join Victor six airway');
    const grades = gradedAgainst(reading, reading.spoken.abbreviated);
    expect(misgraded(grades, {})).toEqual([]);
    expect(gradeOf(grades, 'R.route').remarks).toEqual([]);
  });

  it('misses the word "airway" left off the joined airway', () => {
    const reading = settledReading(AIRWAY_PRACTICE);
    const grades = gradedAgainst(
      reading,
      edited(reading.spoken.abbreviated, 'Victor six airway', 'Victor six'),
    );
    expect(misgraded(grades, { 'R.route': 'wrong' })).toEqual([]);
    expect(gradeOf(grades, 'R.route').remarks).toEqual(['missed: "airway"']);
  });

  it('keeps the word said after an airway that connects two fixes filler', () => {
    const connecting = input({ filedRoute: 'TRUKN2 DEDHD V6 RBL' });
    const full = speakClearance(connecting).fullRoute;
    expect(full).toContain('Dedhd transition, Victor six, Red Bluff VOR');
    const grades = graded(edited(full, 'Victor six,', 'Victor six airway,'), connecting);
    expect(misgraded(grades, { 'R.route': 'acceptable' })).toEqual([]);
    expect(idsOf(gradeOf(grades, 'R.route'))).toContain('S-FILLER');
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
    expectedProblems(gradeText(reading, spoken, clearance, airport, 'abbreviated')).map(
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

/** The runs of one grade the results row marks, as `kind:text` lines, in the order they read. */
function markedRuns(grade: TextGrade): string[] {
  return grade.said
    .filter((run) => run.kind !== 'said' && run.kind !== 'break')
    .map((run) => `${run.kind}:${run.text}`);
}

/** Every reading of a fixture the corpus grades: as it is read on frequency, and the route in full. */
function corpusGrades(fixture: Fixture): { reading: string; grades: TextGrade[] }[] {
  const { airport, clearance, spoken } = realReading(fixture);
  const readings = [
    spoken.abbreviated,
    ...(spoken.fullRoute === spoken.abbreviated ? [] : [spoken.fullRoute]),
  ];
  return readings.map((reading) => ({
    reading,
    grades: gradeText(reading, spoken, clearance, airport, 'abbreviated'),
  }));
}

/** What every settled clearance fixture's own readings get wrong, each line naming its fixture. */
function corpusProblemsOf(problems: (grades: readonly TextGrade[]) => string[]): string[] {
  return settledClearances.flatMap((fixture) =>
    corpusGrades(fixture).flatMap(({ reading, grades }) =>
      problems(grades).map((line) => `${fixture.id} "${reading}": ${line}`),
    ),
  );
}

/** The grades that mark a stretch of the typed text, or remark on an element graded correct. */
function markProblems(grades: readonly TextGrade[]): string[] {
  return grades.flatMap((grade) => [
    ...markedRuns(grade).map((run) => `${grade.element} marks ${run}`),
    ...(grade.verdict === 'correct' && grade.remarks.length > 0
      ? [`${grade.element} remarks "${grade.remarks.join(', ')}"`]
      : []),
  ]);
}

/** The grades that are not correct and say nothing about why. */
function silentProblems(grades: readonly TextGrade[]): string[] {
  return grades
    .filter((grade) => grade.verdict !== 'correct' && grade.remarks.length === 0)
    .map((grade) => `${grade.element} is ${grade.verdict} and remarks nothing`);
}

describe('the marks and the remarks of a typed grade', () => {
  it('marks a wrong value in what was typed and says which value it was', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'squawk three three four two', 'squawk 6201'),
    );
    const squawk = gradeOf(grades, 'T');
    expect(squawk.said).toEqual([
      { text: 'squawk ', kind: 'said' },
      { text: '6201', kind: 'wrong' },
    ]);
    expect(squawk.remarks).toEqual(['wrong value: said "6201", expected "three three four two"']);
  });

  it('marks a near-miss spelling with the word it reads as, and remarks nothing', () => {
    const grades = fdxGraded((reading) => edited(reading, ' departure,', ' depature,'));
    const sid = gradeOf(grades, 'R.sid');
    expect(sid.verdict).toBe('correct');
    expect(sid.said).toEqual([
      { text: 'Oakland Six ', kind: 'said' },
      { text: 'depature', kind: 'spelling', readAs: 'departure' },
    ]);
    expect(sid.remarks).toEqual([]);
  });

  it('marks the whole number said with "nine" and says to say niner', () => {
    const grades = fdxGraded((reading) => edited(reading, 'point niner', 'point nine'));
    const frequency = gradeOf(grades, 'F');
    expect(markedRuns(frequency)).toEqual(['wrong:one two zero point nine']);
    expect(frequency.remarks).toEqual(['say niner, not nine']);
  });

  it('marks a number said in group form alone and says to say the digits', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'flight level one niner zero', 'flight level one ninety'),
    );
    const altitude = gradeOf(grades, 'A.phrase');
    expect(markedRuns(altitude)).toEqual(['wrong:one ninety']);
    expect(altitude.remarks).toEqual(['group form alone — say the digits']);
  });

  it('marks an element said before its place as misplaced', () => {
    const grades = fdxGraded((reading) =>
      edited(
        edited(reading, ', squawk three three four two', ''),
        'cleared to',
        'squawk three three four two, cleared to',
      ),
    );
    const squawk = gradeOf(grades, 'T');
    expect(squawk.said).toEqual([{ text: 'squawk three three four two', kind: 'misplaced' }]);
    expect(squawk.remarks).toEqual(['out of CRAFT order']);
  });

  it('leaves filler marked as filler and lists the extra words', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'cleared to Seattle', 'cleared to the Seattle'),
    );
    const limit = gradeOf(grades, 'C');
    expect(limit.verdict).toBe('acceptable');
    expect(limit.said).toEqual([
      { text: 'cleared to ', kind: 'said' },
      { text: 'the', kind: 'filler' },
      { text: ' Seattle-Tacoma International airport', kind: 'said' },
    ]);
    expect(limit.remarks).toEqual(['extra words: the']);
  });

  it('marks nothing and remarks nothing on the reading typed exactly', () => {
    const grades = fdxGraded((reading) => reading);
    expect(grades.flatMap(markedRuns)).toEqual([]);
    expect(grades.flatMap((grade) => grade.remarks)).toEqual([]);
  });

  it('names the words of the reading never said', () => {
    const grades = fdxGraded((reading) =>
      edited(reading, 'radar vectors Dedhd, then as filed', 'radar vectors Dedhd'),
    );
    expect(gradeOf(grades, 'R.route').remarks).toEqual(['missed: "then as filed"']);
  });

  it('says an element left out was not heard', () => {
    const grades = fdxGraded((reading) => edited(reading, ', squawk three three four two', ''));
    expect(gradeOf(grades, 'T').remarks).toEqual(['not heard']);
  });

  it('names both the word never said and the word the reading does not have', () => {
    const grades = fdxGraded((reading) => edited(reading, 'squawk', 'sqwk'));
    expect(gradeOf(grades, 'T').remarks).toEqual([
      'missed: "squawk"',
      'not in the reading: "sqwk"',
    ]);
  });

  it('says the route was read in full where the shorter reading would have done', () => {
    const { airport, clearance, spoken } = settledReading(FDX_PRACTICE);
    expect(spoken.fullRoute).not.toBe(spoken.abbreviated);
    const grades = gradeText(spoken.fullRoute, spoken, clearance, airport, 'abbreviated');
    const route = gradeOf(grades, 'R.route');
    expect(route.verdict).toBe('acceptable');
    expect(route.remarks).toEqual(['the route read in full — the shorter reading is enough']);
  });

  it('a reading typed as read has no marks', () => {
    expect(settledClearances.length).toBeGreaterThan(0);
    expect(corpusProblemsOf(markProblems)).toEqual([]);
  });

  it('a grade that is not correct says why', () => {
    expect(settledClearances.length).toBeGreaterThan(0);
    expect(corpusProblemsOf(silentProblems)).toEqual([]);
  });
});

/** The remark a route handed over as filed leaves on a clearance read in full. */
const FRC_REMARK = '"then as filed" said on a full route clearance — read the route to its end';

/** The practice reading graded against itself, under the reading the student is held to. */
function fdxReading(text: (spoken: SpokenClearance) => string, reading: RouteReading): TextGrade[] {
  const { airport, clearance: resolved, spoken } = settledReading(FDX_PRACTICE);
  return gradeText(text(spoken), spoken, resolved, airport, reading);
}

/** The full route's words with everything from its last element on handed over as filed. */
function handedOver(words: string): string {
  const units = words.split(', ').filter((unit) => unit !== 'direct');
  return [...units.slice(0, -1), 'then as filed'].join(', ');
}

/** The "direct" that leads a route unit to the fix it names. */
const DIRECT_PREFIX = /^direct /u;

/** One unit of the full route between the departure phrase and its close, and the fix it names. */
function midRouteUnit(words: string): { unit: string; fix: string } {
  const unit = words.split(', ')[1];
  if (unit === undefined) throw new Error(`"${words}" reads as one element`);
  return { unit, fix: unit.replace(DIRECT_PREFIX, '') };
}

/** The grades without the row a full route clearance always cites, to line the two readings up. */
function withoutFrc(grades: readonly TextGrade[]): TextGrade[] {
  return grades.map((grade) => ({
    ...grade,
    citations: grade.citations.filter((citation) => citation.id !== 'R-FRC'),
  }));
}

/** The words a grade was held to that the student never said. */
function missedWords(grade: TextGrade): string {
  return grade.expected
    .filter((run) => run.missed)
    .map((run) => run.text)
    .join(' ');
}

describe('a full route clearance', () => {
  it('reads the full route as fully right, with no remark', () => {
    const { spoken } = settledReading(FDX_PRACTICE);
    expect(spoken.fullRoute).not.toBe(spoken.abbreviated);
    const route = gradeOf(
      fdxReading((reading) => reading.fullRoute, 'full'),
      'R.route',
    );
    expect(route.verdict).toBe('correct');
    expect(route.remarks).toEqual([]);
    expect(idsOf(route)).not.toContain('R-FULL-ROUTE');
    expect(idsOf(route)).toContain('R-FRC');
  });

  it('grades the abbreviated reading wrong and cites R-FRC', () => {
    const { spoken } = settledReading(FDX_PRACTICE);
    const route = gradeOf(
      fdxReading((reading) => reading.abbreviated, 'full'),
      'R.route',
    );
    expect(route.verdict).toBe('wrong');
    expect(idsOf(route)).toContain('R-FRC');
    expect(idsOf(route)).not.toContain('R-FULL-ROUTE');
    expect(route.remarks).toEqual([FRC_REMARK]);
    expect(route.expected.map((run) => run.text).join('')).toBe(spoken.fullRouteWords);
  });

  it('grades "then as filed" at the route\'s end wrong on a full route clearance', () => {
    const speakInput = input({
      clearance: clearance({ route: { template: 'as_filed', fix: 'TRUKN' } }),
      filedRoute: 'TRUKN2 TRUKN',
    });
    const said = edited(readingOf(speakInput), 'Trukn, direct.', 'Trukn, then as filed.');
    const route = gradeOf(gradedAs(said, 'full', speakInput), 'R.route');
    expect(route.verdict).toBe('wrong');
    expect(idsOf(route)).toContain('R-FRC');
    expect(idsOf(route)).not.toContain('R-THEN-AS-FILED-END');
    expect(route.remarks).toEqual([FRC_REMARK]);
  });

  it('leaves every other element as it grades on the abbreviated reading', () => {
    const full = fdxReading((reading) => reading.fullRoute, 'full');
    const abbreviated = fdxReading((reading) => reading.abbreviated, 'abbreviated');
    const others = (grades: readonly TextGrade[]): TextGrade[] =>
      grades.filter((grade) => grade.element !== 'R.route');
    expect(others(full)).toEqual(others(abbreviated));
  });

  it('still accepts the full route where the student is held to the abbreviated reading', () => {
    const route = gradeOf(
      fdxReading((reading) => reading.fullRoute, 'abbreviated'),
      'R.route',
    );
    expect(route.verdict).toBe('acceptable');
    expect(idsOf(route)).toContain('R-FULL-ROUTE');
    expect(route.remarks).toEqual(['the route read in full — the shorter reading is enough']);
  });

  it('cites R-FRC when the handover is typed with a word missing', () => {
    const route = gradeOf(
      fdxReading((reading) => edited(reading.abbreviated, 'then as filed', 'as filed'), 'full'),
      'R.route',
    );
    expect(route.verdict).toBe('wrong');
    expect(idsOf(route)).toContain('R-FRC');
    expect(route.remarks).toContain(FRC_REMARK);
  });

  it('grades "then as filed" said after a complete full reading wrong', () => {
    const route = gradeOf(
      fdxReading(
        (reading) =>
          edited(
            reading.fullRoute,
            reading.fullRouteWords,
            `${reading.fullRouteWords}, then as filed`,
          ),
        'full',
      ),
      'R.route',
    );
    expect(route.verdict).toBe('wrong');
    expect(idsOf(route)).toContain('R-FRC');
    expect(route.remarks).toContain(FRC_REMARK);
  });

  it('cites R-FRC on a partial reading that ends on "then as filed"', () => {
    const route = gradeOf(
      fdxReading(
        (reading) =>
          edited(reading.fullRoute, reading.fullRouteWords, handedOver(reading.fullRouteWords)),
        'full',
      ),
      'R.route',
    );
    expect(route.verdict).toBe('wrong');
    expect(idsOf(route)).toContain('R-FRC');
    expect(route.remarks).toContain(FRC_REMARK);
    expect(route.remarks.length).toBeGreaterThan(1);
  });

  it('leaves a full reading with a dropped fix to its missed words, with no FRC remark', () => {
    const { spoken } = settledReading(FDX_PRACTICE);
    const { unit, fix } = midRouteUnit(spoken.fullRouteWords);
    const route = gradeOf(
      fdxReading((reading) => edited(reading.fullRoute, `${unit}, `, ''), 'full'),
      'R.route',
    );
    expect(route.verdict).toBe('wrong');
    expect(route.remarks).not.toContain(FRC_REMARK);
    expect(idsOf(route)).toContain('R-FRC');
    expect(missedWords(route)).toContain(fix);
  });

  it('gives a tie between the two readings to the full route', () => {
    const reading = settledReading(FDX_PRACTICE);
    const said = readingWithout(reading, 'R.route');
    const route = gradeOf(
      gradeText(said, reading.spoken, reading.clearance, reading.airport, 'full'),
      'R.route',
    );
    expect(route.verdict).toBe('wrong');
    expect(route.actualLabel).toBe('(not heard)');
    expect(route.remarks).toEqual(['not heard']);
    expect(route.expectedLabel).toBe(reading.spoken.fullRouteWords);
  });

  it('cites R-FRC and never R-THEN-AS-FILED on a full route clearance', () => {
    const { airport, clearance: resolved, spoken } = settledReading(FDX_PRACTICE);
    const asFiled: ResolvedClearance = {
      ...resolved,
      route: {
        ...resolved.route,
        citations: [...resolved.route.citations, ...citePhraseology(airport, 'R-THEN-AS-FILED')],
      },
    };
    const full = gradeOf(gradeText(spoken.fullRoute, spoken, asFiled, airport, 'full'), 'R.route');
    expect(idsOf(full)).toContain('R-FRC');
    expect(idsOf(full)).not.toContain('R-THEN-AS-FILED');
    const abbreviated = gradeOf(
      gradeText(spoken.abbreviated, spoken, asFiled, airport, 'abbreviated'),
      'R.route',
    );
    expect(idsOf(abbreviated)).toContain('R-THEN-AS-FILED');
    expect(idsOf(abbreviated)).not.toContain('R-FRC');
  });

  it('holds a route with nothing after its transition to the same words either way', () => {
    const speakInput = input({ filedRoute: 'TRUKN2 DEDHD' });
    const spoken = speakClearance(speakInput);
    expect(spoken.fullRoute).toBe(spoken.abbreviated);
    const grades = gradedAs(spoken.abbreviated, 'full', speakInput);
    expect(gradeOf(grades, 'R.route').verdict).toBe('correct');
    expect(idsOf(gradeOf(grades, 'R.route'))).toContain('R-FRC');
    expect(withoutFrc(grades)).toEqual(gradedAs(spoken.abbreviated, 'abbreviated', speakInput));
  });
});

/** The settled fixtures whose expect clause ends on the word the frequency opens with. */
const AFTER_DEPARTURE_READINGS: readonly string[] = [
  'syn-koak-rnav-elements-b738w-klas',
  'ws-koak-amendment-practice-2-fdx3875',
  'ws-koak-amendment-practice-2-jsx203',
  'ws-koak-amendment-practice-2-n858ee',
];

/** The one of those readings the word-level tests type against. */
const RNAV_ELEMENTS = 'syn-koak-rnav-elements-b738w-klas';

describe('gradeText where the expect clause ends on the word the frequency opens with', () => {
  it.each(AFTER_DEPARTURE_READINGS)(
    'an expect clause left out costs the expect clause alone (%s)',
    (id) => {
      const reading = fixtureReading(id);
      const grades = gradedAgainst(reading, readingWithout(reading, 'A.expect'));
      expect(misgraded(grades, { 'A.expect': 'wrong' })).toEqual([]);
      expect(gradeOf(grades, 'A.expect').actualLabel.toLowerCase()).not.toContain('departure');
    },
  );

  it('the departure frequency keeps its own words when the expect clause is said', () => {
    const reading = fixtureReading(RNAV_ELEMENTS);
    const grades = gradedAgainst(reading, reading.spoken.abbreviated);
    expect(misgraded(grades, {})).toEqual([]);
    expect(gradeOf(grades, 'F').actualLabel).toMatch(/^Departure frequency/u);
  });

  it('adjacent words stay with their element', () => {
    const reading = fixtureReading(RNAV_ELEMENTS);
    const typed = edited(
      readingWithout(reading, 'A.expect'),
      'Departure frequency',
      'departure frequency',
    );
    expect(gradeOf(gradedAgainst(reading, typed), 'F').verdict).toBe('correct');
  });
});
