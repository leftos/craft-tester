import { describe, expect, it } from 'vitest';
import { checkedInAirports } from '@/data/checkedIn.ts';
import type { AirportData, Fixture } from '@/data/schema.ts';
import { FixtureSchema } from '@/data/schema.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { TEEN_WORDS, TENS_WORDS, UNIT_WORDS } from '@/rules/speak.ts';
import { lexiconFor, normaliseSpoken } from '@/rules/text/normalise.ts';
import type { SpokenToken } from '@/rules/text/normalise.ts';
// spokenFor is the one place the reading's input is assembled from a scenario and its clearance.
import { spokenFor } from '@/ui/session.ts';

/**
 * A token short enough to assert on: `w:flight`, `n:320/figures`, `n:120.9/digits!9`, and
 * `n:10000/digits+r` for a restated number.
 */
function compact(token: SpokenToken): string {
  if (token.kind === 'word') return `w:${token.text}`;
  return `n:${token.value}/${token.form}${token.saidNine ? '!9' : ''}${token.restated ? '+r' : ''}`;
}

/** The text normalised with an empty lexicon, each token compacted. */
function read(text: string): string[] {
  return normaliseSpoken(text, {}).map(compact);
}

describe('normaliseSpoken', () => {
  it('reads a typed flight level as the words and its number', () => {
    expect(read('FL320')).toEqual(['w:flight', 'w:level', 'n:320/figures']);
    expect(read('FL 320')).toEqual(['w:flight', 'w:level', 'n:320/figures']);
  });

  it('reads a spoken flight level, ICAO digits included', () => {
    expect(read('flight level tree two zero')).toEqual(['w:flight', 'w:level', 'n:320/digits']);
  });

  it('reads a frequency typed and spoken', () => {
    expect(read('120.9')).toEqual(['n:120.9/figures']);
    expect(read('one two zero point niner')).toEqual(['n:120.9/digits']);
    expect(read('one two zero point nine')).toEqual(['n:120.9/digits!9']);
  });

  it('reads altitudes in digit and group form', () => {
    expect(read('one zero thousand')).toEqual(['n:10000/digits']);
    expect(read('ten thousand')).toEqual(['n:10000/group']);
    expect(read('10,000')).toEqual(['n:10000/figures']);
    expect(read('three thousand five hundred')).toEqual(['n:3500/digits']);
    expect(read('one seven thousand niner hundred')).toEqual(['n:17900/digits']);
  });

  it('keeps the leading zeros of a squawk', () => {
    expect(read('zero four one two')).toEqual(['n:0412/digits']);
    expect(read('0412')).toEqual(['n:0412/figures']);
  });

  it('reads an airway typed and spoken', () => {
    expect(read('V244')).toEqual(['w:victor', 'n:244/figures']);
    expect(read('Victor two forty-four')).toEqual(['w:victor', 'n:244/group']);
    expect(read('Q174')).toEqual(['w:queue', 'n:174/figures']);
  });

  it('reads a runway typed and spoken', () => {
    expect(read('28L')).toEqual(['n:28/figures', 'w:left']);
    expect(read('one right')).toEqual(['n:1/digits', 'w:right']);
  });

  it('splits a procedure identifier into its name and number', () => {
    expect(read('HAWKZ7')).toEqual(['w:hawkz', 'n:7/figures']);
  });

  it('expands an identifier the lexicon holds, however it is capitalised', () => {
    const lexicon = { SAC: 'Sacramento VOR', KSEA: 'Seattle' };
    for (const typed of ['SAC', 'sac', 'Sac']) {
      const tokens = normaliseSpoken(typed, lexicon);
      expect(tokens.map(compact)).toEqual(['w:sacramento', 'w:vor']);
      expect(tokens.map(({ start, end }) => [start, end])).toEqual([
        [0, 3],
        [0, 3],
      ]);
    }
  });

  it('expands a procedure identifier in lower case, and splits one the lexicon misses', () => {
    const lexicon = { NIMI6: 'Nimitz Six' };
    const spoken = ['w:nimitz', 'n:6/digits'];
    expect(normaliseSpoken('NIMI6', lexicon).map(compact)).toEqual(spoken);
    expect(normaliseSpoken('nimi6', lexicon).map(compact)).toEqual(spoken);
    expect(normaliseSpoken('Nimi6', lexicon).map(compact)).toEqual(spoken);
    expect(normaliseSpoken('hawkz7', lexicon).map(compact)).toEqual(['w:hawkz', 'n:7/figures']);
  });

  it('reads a number word as a number even where the lexicon holds it', () => {
    const lexicon = { TEN: 'Tenville VOR' };
    expect(normaliseSpoken('one zero ten thousand', lexicon).map(compact)).toEqual([
      'n:10000/digits+r',
    ]);
    expect(normaliseSpoken('ten thousand', lexicon).map(compact)).toEqual(['n:10000/group']);
  });

  it('ends a number run at punctuation', () => {
    const numbers = read('one two zero point niner, squawk one two three four').filter((token) =>
      token.startsWith('n:'),
    );
    expect(numbers).toEqual(['n:120.9/digits', 'n:1234/digits']);
  });

  it('marks the span a spoken number came from', () => {
    const text = 'departure frequency one two zero point niner';
    const number = normaliseSpoken(text, {}).find((token) => token.kind === 'number');
    expect(number === undefined ? undefined : text.slice(number.start, number.end)).toBe(
      'one two zero point niner',
    );
  });

  it('leaves a run it cannot parse as words', () => {
    expect(read('one point two point three')).toEqual([
      'w:one',
      'w:point',
      'w:two',
      'w:point',
      'w:three',
    ]);
    expect(read('a thousand')).toEqual(['w:a', 'w:thousand']);
    expect(read('one two hundred')).toEqual(['w:one', 'w:two', 'w:hundred']);
  });

  it('reads a four-digit flight number in group form', () => {
    expect(read('fourteen twenty')).toEqual(['n:1420/group']);
    expect(read('twenty-one zero four')).toEqual(['n:2104/group']);
    expect(read('eleven eighty-nine')).toEqual(['n:1189/group']);
  });

  it("splits an expect clause's altitude from its minutes", () => {
    expect(read('one zero thousand one zero minutes')).toEqual([
      'n:10000/digits',
      'n:10/digits',
      'w:minutes',
    ]);
    expect(read('flight level three five zero one zero minutes')).toEqual([
      'w:flight',
      'w:level',
      'n:350/digits',
      'n:10/digits',
      'w:minutes',
    ]);
    expect(read('expect 10,000 10 minutes')).toEqual([
      'w:expect',
      'n:10000/figures',
      'n:10/figures',
      'w:minutes',
    ]);
  });

  it('reads the digits then their group form as one restated number', () => {
    expect(read('one zero ten thousand')).toEqual(['n:10000/digits+r']);
    expect(read('one one eleven thousand')).toEqual(['n:11000/digits+r']);
    expect(read('one zero ten')).toEqual(['n:10/digits+r']);
    expect(read('four two one five forty-two fifteen')).toEqual(['n:4215/digits+r']);
    expect(read('two eight zero two eighty')).toEqual(['n:280/digits+r']);
    expect(read('two five twenty-five hundred')).toEqual(['n:2500/digits+r']);
  });

  it('leaves a run that is more than digits and their group form as it was', () => {
    expect(read('five one zero ten')).toEqual(['n:51010/group']);
    expect(read('one zero ten five')).toEqual(['n:10105/group']);
    expect(read('one zero ten one one eleven')).toEqual(['n:10101111/group']);
    expect(read('two forty-four')).toEqual(['n:244/group']);
    expect(read('one two twenty')).toEqual(['n:1220/group']);
    expect(read('flight level three five zero three fifty')).toEqual([
      'w:flight',
      'w:level',
      'n:350/digits',
      'n:350/group',
    ]);
  });
});

describe('normaliseSpoken on an identifier spelt in the phonetic alphabet', () => {
  it('reads a spelt navaid identifier as the navaid, whatever its case', () => {
    const lexicon = { SAU: 'Sausalito VOR' };
    for (const typed of ['sierra alpha uniform', 'Sierra Alpha Uniform']) {
      const tokens = normaliseSpoken(typed, lexicon);
      expect(tokens.map(compact)).toEqual(['w:sausalito', 'w:vor']);
      expect(tokens.map(({ start, end }) => [start, end])).toEqual([
        [0, typed.length],
        [0, typed.length],
      ]);
    }
  });

  it('reads both spellings of alfa and juliett', () => {
    const lexicon = { SAU: 'Sausalito VOR', SJC: 'San Jose' };
    const sausalito = ['w:sausalito', 'w:vor'];
    const sanJose = ['w:san', 'w:jose'];
    expect(normaliseSpoken('sierra alfa uniform', lexicon).map(compact)).toEqual(sausalito);
    expect(normaliseSpoken('sierra alpha uniform', lexicon).map(compact)).toEqual(sausalito);
    expect(normaliseSpoken('sierra juliett charlie', lexicon).map(compact)).toEqual(sanJose);
    expect(normaliseSpoken('sierra juliet charlie', lexicon).map(compact)).toEqual(sanJose);
  });

  it('takes the longest run the lexicon holds and leaves the airway after it', () => {
    const lexicon = { SAC: 'Sacramento VOR' };
    expect(normaliseSpoken('sierra alpha charlie victor six', lexicon).map(compact)).toEqual([
      'w:sacramento',
      'w:vor',
      'w:victor',
      'n:6/digits',
    ]);
  });

  it('reads five letters the lexicon misses as the fix they spell', () => {
    const typed = 'delta echo delta hotel delta';
    const tokens = normaliseSpoken(typed, {});
    expect(tokens.map(compact)).toEqual(['w:dedhd']);
    expect(tokens.map(({ start, end }) => [start, end])).toEqual([[0, typed.length]]);
  });

  it('spells the first five letters and leaves the airway after them', () => {
    expect(read('delta echo delta hotel delta victor six')).toEqual([
      'w:dedhd',
      'w:victor',
      'n:6/digits',
    ]);
  });

  it('leaves one phonetic word alone, so an airway is its word and its number', () => {
    expect(read('victor six')).toEqual(['w:victor', 'n:6/digits']);
    expect(read('tango two ten')).toEqual(['w:tango', 'n:210/group']);
  });

  it('leaves a short run that spells nothing as the words themselves', () => {
    expect(read('mike oscar')).toEqual(['w:mike', 'w:oscar']);
  });

  it('ends the run at a comma', () => {
    const lexicon = { SAU: 'Sausalito VOR' };
    expect(normaliseSpoken('sierra alpha, uniform', lexicon).map(compact)).toEqual([
      'w:sierra',
      'w:alpha',
      'w:uniform',
    ]);
  });
});

/** Every checked-in airport, keyed by ICAO, so a fixture is read against the field it names. */
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

describe('lexiconFor', () => {
  it('builds the lexicon from fixes, SIDs and destinations', () => {
    const ksfo = airportOf('KSFO');
    const lexicon = lexiconFor(ksfo);
    const gap = ksfo.sids.find((sid) => sid.family === 'GAPP');
    expect(lexicon['OSI']).toBe('Woodside VOR');
    expect(gap?.spoken).toMatch(/^Gap /);
    expect(lexicon[gap?.id ?? '']).toBe(gap?.spoken);
    expect(lexicon['KSEA']).toBe('Seattle-Tacoma International');
  });
});

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

/** Every word a number run consumes, which a normalised reading must never leave as a word. */
const NUMBER_WORDS: ReadonlySet<string> = new Set([
  ...UNIT_WORDS,
  ...TEEN_WORDS,
  ...TENS_WORDS.filter((word) => word !== ''),
  'wun',
  'too',
  'tree',
  'fower',
  'fife',
  'ait',
  'niner',
  'thousand',
  'hundred',
]);

/** What one fixture's normalised reading misses: leftover number words, the squawk, the frequency. */
function readingProblems(fixture: Fixture): string[] {
  const airport = airportOf(fixture.airport);
  const result = resolveClearance(fixture.scenario, airport);
  if (!result.ok) return [`${fixture.id}: the engine resolves no clearance to read`];
  const spoken = spokenFor(fixture.scenario, fixture.scenario, result.clearance, airport);
  const lexicon = lexiconFor(airport);
  expect(() => normaliseSpoken(spoken.fullRoute, lexicon)).not.toThrow();
  const tokens = normaliseSpoken(spoken.abbreviated, lexicon);
  const values = new Set(tokens.flatMap((token) => (token.kind === 'number' ? [token.value] : [])));
  const leftovers = tokens.flatMap((token) =>
    token.kind === 'word' && NUMBER_WORDS.has(token.text) ? [token.text] : [],
  );
  const frequency = result.clearance.frequency.value.value;
  const problems: string[] = [];
  if (leftovers.length > 0) problems.push(`left as words: ${leftovers.join(' ')}`);
  if (!values.has(fixture.scenario.squawk)) problems.push(`no squawk ${fixture.scenario.squawk}`);
  if (!values.has(frequency)) problems.push(`no frequency ${frequency}`);
  return problems.map((problem) => `${fixture.id}: ${problem} in "${spoken.abbreviated}"`);
}

describe('normaliseSpoken over the fixture corpus', () => {
  it("reads every settled clearance fixture's own reading back to its numbers", () => {
    expect(settledClearances.length).toBeGreaterThan(0);
    expect(settledClearances.flatMap((fixture) => readingProblems(fixture))).toEqual([]);
  });
});
