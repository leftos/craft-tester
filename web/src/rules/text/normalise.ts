import type { AirportData } from '@/data/schema.ts';
import { TEEN_WORDS, TENS_WORDS, UNIT_WORDS } from '@/rules/speak.ts';

/** How a number was given: typed as figures, said digit by digit, or said in group form. */
export type NumberForm = 'figures' | 'digits' | 'group';

/**
 * One unit of normalised text, with the character span of the original text it came from.
 *
 * A number records how it was said: its form, whether a digit nine was said "nine", and whether its
 * digits were restated in group form right after them (`one zero ten thousand`), which reads as the
 * digits alone.
 */
export type SpokenToken =
  | { kind: 'word'; text: string; start: number; end: number }
  | {
      kind: 'number';
      value: string;
      form: NumberForm;
      saidNine: boolean;
      restated: boolean;
      start: number;
      end: number;
    };

/** Identifier (as typed in capitals) to the words it is spoken as. */
export type Lexicon = Readonly<Record<string, string>>;

/** A character span of the original text, end exclusive. */
type Span = { start: number; end: number };

/** A stretch of the original text that whitespace, a boundary or a split hyphen delimits. */
type Piece = Span & { text: string };

/** What splitting the text yields: a piece, or a boundary that ends any number run. */
type Item = ({ kind: 'piece' } & Piece) | { kind: 'boundary' };

/** How one character acts when the text is split into pieces. */
type CharacterRole = 'space' | 'boundary' | 'split' | 'keep';

/** What one piece of a number run means to it. */
type NumberWord =
  | { kind: 'figures'; value: string }
  | { kind: 'digit'; digit: string; saidNine: boolean }
  | { kind: 'teen' | 'tens'; value: string }
  | { kind: 'thousand' | 'hundred' | 'point' };

/** A piece that belongs in a number run, and what it means there. */
type NumberPiece = { word: NumberWord; piece: Piece };

/** The tokens read from the text at one place, and the index of the next item to read. */
type Reading = { tokens: SpokenToken[]; next: number };

/** Words read in order: the digits they append, and what the words they were said in tell. */
type Concatenation = {
  text: string;
  saidNine: boolean;
  group: boolean;
  elements: number;
  restated: boolean;
};

/**
 * A run read as a number: its value, whether a digit nine was said "nine", any group word, and
 * whether its digits were restated in group form.
 */
type RunValue = { value: string; saidNine: boolean; group: boolean; restated: boolean };

/** A piece made of two parts one pattern matches, and the tokens those parts read as. */
type Shape = { pattern: RegExp; read: (head: Piece, tail: Piece) => SpokenToken[] };

/** Characters that end a number run and yield no token. */
const BOUNDARY_CHARACTERS: ReadonlySet<string> = new Set([
  ',',
  ';',
  ':',
  '!',
  '?',
  '(',
  ')',
  '"',
  '.',
]);

/** The boundary characters that stay inside a piece of figures when a digit sits either side. */
const FIGURE_SEPARATORS: ReadonlySet<string> = new Set([',', '.']);

/** The ICAO pronunciations of the digits, per FAA JO 7110.65 2-4-16 TBL 2-4-1. */
const ICAO_DIGIT_WORDS: Readonly<Record<string, string>> = {
  wun: '1',
  too: '2',
  tree: '3',
  fower: '4',
  fife: '5',
  ait: '8',
  niner: '9',
};

/** Every digit word, plain or ICAO, to the digit it is. */
const DIGIT_BY_WORD: ReadonlyMap<string, string> = new Map([
  ...UNIT_WORDS.map((word, digit): [string, string] => [word, String(digit)]),
  ...Object.entries(ICAO_DIGIT_WORDS),
]);

/** Every group word, `ten` through `nineteen` and `twenty` through `ninety`, to its value. */
const GROUP_BY_WORD: ReadonlyMap<string, NumberWord> = new Map([
  ...TEEN_WORDS.map((word, index): [string, NumberWord] => [
    word,
    { kind: 'teen', value: String(10 + index) },
  ]),
  ...TENS_WORDS.flatMap((word, tens): [string, NumberWord][] =>
    word === '' ? [] : [[word, { kind: 'tens', value: `${tens}0` }]],
  ),
]);

/** The multipliers and the decimal. */
const OPERATOR_BY_WORD: ReadonlyMap<string, NumberWord> = new Map<string, NumberWord>([
  ['thousand', { kind: 'thousand' }],
  ['hundred', { kind: 'hundred' }],
  ['point', { kind: 'point' }],
  ['decimal', { kind: 'point' }],
]);

/** Figures with a comma between each group of three digits, e.g. `10,000`. */
const GROUPED_FIGURES = /^\d{1,3}(?:,\d{3})+$/;

/** Digits with an optional decimal part, e.g. `0412` or `120.9`, typed or read from words. */
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;

/** Digits with no decimal part, which is all a multiplier takes. */
const WHOLE_NUMBER = /^\d+$/;

/** An identifier typed in capitals: letters and optional trailing digits, e.g. `SAC` or `SFO5`. */
const CAPITALISED_IDENTIFIER = /^[A-Z]+\d*$/;

/** The shortest piece looked up in the lexicon. */
const MIN_IDENTIFIER_LENGTH = 2;

/** A flight level is three digits, so a digit-word run after "flight level" closes on the third. */
const FLIGHT_LEVEL_DIGITS = 3;

/** The fewest digit words a restatement opens on: one digit then a group word is a group number. */
const MIN_RESTATED_DIGITS = 2;

/** The word each runway side letter reads as. */
const RUNWAY_SIDE_WORDS: Readonly<Record<string, string>> = {
  l: 'left',
  r: 'right',
  c: 'center',
};

/** The word each airway letter reads as. */
const AIRWAY_WORDS: Readonly<Record<string, string>> = {
  j: 'jay',
  v: 'victor',
  q: 'queue',
  t: 'tango',
};

/** The piece shapes read as words and a number, checked in order after a lexicon miss. */
const SHAPES: readonly Shape[] = [
  {
    pattern: /^(fl)(\d{2,3})$/i,
    read: (head, tail) => [...flightLevelWords(head), figuresToken(tail)],
  },
  {
    pattern: /^(\d{1,2})([lrc])$/i,
    read: (head, tail) => [figuresToken(head), letterWord(RUNWAY_SIDE_WORDS, tail)],
  },
  {
    pattern: /^([jvqt])(\d{1,3})$/i,
    read: (head, tail) => [letterWord(AIRWAY_WORDS, head), figuresToken(tail)],
  },
  {
    pattern: /^([a-z]{2,5})(\d)$/i,
    read: (head, tail) => [wordToken(head.text, head), figuresToken(tail)],
  },
];

function wordToken(text: string, span: Span): SpokenToken {
  return { kind: 'word', text: text.toLowerCase(), start: span.start, end: span.end };
}

function figuresToken(piece: Piece): SpokenToken {
  return {
    kind: 'number',
    value: piece.text.replaceAll(',', ''),
    form: 'figures',
    saidNine: false,
    restated: false,
    start: piece.start,
    end: piece.end,
  };
}

function flightLevelWords(span: Span): SpokenToken[] {
  return [wordToken('flight', span), wordToken('level', span)];
}

/** The word a single letter reads as, from a table keyed by the lower-case letter. */
function letterWord(words: Readonly<Record<string, string>>, piece: Piece): SpokenToken {
  return wordToken(words[piece.text.toLowerCase()] ?? piece.text, piece);
}

function isFigures(text: string): boolean {
  return GROUPED_FIGURES.test(text) || PLAIN_NUMBER.test(text);
}

function isDigitAt(text: string, index: number): boolean {
  return /\d/.test(text.charAt(index));
}

function isLetterAt(text: string, index: number): boolean {
  return /[a-z]/i.test(text.charAt(index));
}

/** Whether the characters either side of `index` both pass `test`. */
function isBetween(
  text: string,
  index: number,
  test: (text: string, index: number) => boolean,
): boolean {
  return test(text, index - 1) && test(text, index + 1);
}

function characterRole(text: string, index: number): CharacterRole {
  const character = text.charAt(index);
  if (/\s/.test(character)) return 'space';
  if (FIGURE_SEPARATORS.has(character) && isBetween(text, index, isDigitAt)) return 'keep';
  if (BOUNDARY_CHARACTERS.has(character)) return 'boundary';
  if (character === '-' && isBetween(text, index, isLetterAt)) return 'split';
  return 'keep';
}

/**
 * Splits the text into pieces and boundaries.
 *
 * Whitespace separates pieces; a boundary character ends one and is kept as a boundary, except a
 * comma or dot between two digits, which stays inside the figures; a hyphen between two letters
 * splits its word in two.
 */
function splitText(text: string): Item[] {
  const items: Item[] = [];
  let start: number | undefined;
  for (let index = 0; index <= text.length; index += 1) {
    const role = index === text.length ? 'space' : characterRole(text, index);
    if (role === 'keep') {
      start ??= index;
      continue;
    }
    if (start !== undefined) {
      items.push({ kind: 'piece', text: text.slice(start, index), start, end: index });
    }
    start = undefined;
    if (role === 'boundary') items.push({ kind: 'boundary' });
  }
  return items;
}

/** The words a piece is spoken as, when it is a capitalised identifier the lexicon holds. */
function spokenIdentifier(text: string, lexicon: Lexicon): string | undefined {
  if (text.length < MIN_IDENTIFIER_LENGTH || !CAPITALISED_IDENTIFIER.test(text)) return undefined;
  return Object.hasOwn(lexicon, text) ? lexicon[text] : undefined;
}

/** A capitalised identifier's spoken words, every token spanning the whole identifier. */
function expandIdentifier(piece: Piece, lexicon: Lexicon): SpokenToken[] | undefined {
  const spoken = spokenIdentifier(piece.text, lexicon);
  if (spoken === undefined) return undefined;
  return normaliseSpoken(spoken, {}).map((token) => ({
    ...token,
    start: piece.start,
    end: piece.end,
  }));
}

/** The two parts of a piece a two-group pattern matches whole, each with its own span. */
function splitMatch(piece: Piece, pattern: RegExp): [Piece, Piece] | undefined {
  const match = pattern.exec(piece.text);
  const head = match?.[1];
  const tail = match?.[2];
  if (head === undefined || tail === undefined) return undefined;
  const middle = piece.start + head.length;
  return [
    { text: head, start: piece.start, end: middle },
    { text: tail, start: middle, end: piece.end },
  ];
}

/** The tokens of a shaped piece, or of `fl` typed apart from the figures that follow it. */
function readShaped(piece: Piece, next: Item | undefined): SpokenToken[] | undefined {
  if (piece.text.toLowerCase() === 'fl' && next?.kind === 'piece' && isFigures(next.text)) {
    return flightLevelWords(piece);
  }
  for (const shape of SHAPES) {
    const parts = splitMatch(piece, shape.pattern);
    if (parts !== undefined) return shape.read(...parts);
  }
  return undefined;
}

function numberWordOf(text: string): NumberWord | undefined {
  if (isFigures(text)) return { kind: 'figures', value: text.replaceAll(',', '') };
  const lower = text.toLowerCase();
  const digit = DIGIT_BY_WORD.get(lower);
  if (digit !== undefined) return { kind: 'digit', digit, saidNine: lower === 'nine' };
  return GROUP_BY_WORD.get(lower) ?? OPERATOR_BY_WORD.get(lower);
}

/** The item at `index` as a piece of a number run, or undefined where a run cannot go on. */
function numberPieceAt(
  items: readonly Item[],
  index: number,
  lexicon: Lexicon,
): NumberPiece | undefined {
  const item = items[index];
  if (item === undefined || item.kind === 'boundary') return undefined;
  if (spokenIdentifier(item.text, lexicon) !== undefined) return undefined;
  const word = numberWordOf(item.text);
  return word === undefined ? undefined : { word, piece: item };
}

function lowerPieceText(item: Item | undefined): string | undefined {
  return item?.kind === 'piece' ? item.text.toLowerCase() : undefined;
}

/** Whether the two pieces right before `index` are the words "flight level". */
function followsFlightLevel(items: readonly Item[], index: number): boolean {
  return (
    lowerPieceText(items[index - 2]) === 'flight' && lowerPieceText(items[index - 1]) === 'level'
  );
}

function isMultiplier(piece: NumberPiece | undefined): boolean {
  const kind = piece?.word.kind;
  return kind === 'thousand' || kind === 'hundred';
}

/** Whether the piece is a digit one through nine that completes the tens word right before it. */
function isUnit(pieces: readonly NumberPiece[], index: number): boolean {
  const word = pieces[index]?.word;
  return word?.kind === 'digit' && word.digit !== '0' && pieces[index - 1]?.word.kind === 'tens';
}

function standsAsDigit(pieces: readonly NumberPiece[], index: number): boolean {
  return pieces[index]?.word.kind === 'digit' && !isUnit(pieces, index);
}

/** How many pieces one digit word, or one group with its unit, takes from `index`. */
function elementSize(pieces: readonly NumberPiece[], index: number): number {
  const kind = pieces[index]?.word.kind;
  if (kind === 'digit' || kind === 'teen') return 1;
  if (kind !== 'tens') return 0;
  return isUnit(pieces, index + 1) ? 2 : 1;
}

/** How many pieces a digit or group value and the `hundred` right after it take, or 0. */
function hundredsLength(pieces: readonly NumberPiece[], index: number): number {
  const size = elementSize(pieces, index);
  return size > 0 && pieces[index + size]?.word.kind === 'hundred' ? size + 1 : 0;
}

/** Where a run with a multiplier at `index` ends: after `hundred`, or after `thousand`'s hundreds. */
function multiplierEnd(pieces: readonly NumberPiece[], index: number): number {
  if (pieces[index]?.word.kind === 'hundred') return index + 1;
  return index + 1 + hundredsLength(pieces, index + 1);
}

/** How many pieces a run opening on figures takes: the figures and any multiplier after them. */
function figuresRunLength(pieces: readonly NumberPiece[]): number {
  return isMultiplier(pieces[1]) ? multiplierEnd(pieces, 1) : 1;
}

/**
 * How many pieces a run opening on a word takes.
 *
 * Figures open a run of their own, a multiplier closes the run once its hundreds are read, and
 * after "flight level" the run closes on its third digit word.
 */
function wordRunLength(pieces: readonly NumberPiece[], flightLevel: boolean): number {
  let digits = 0;
  for (const [index, { word }] of pieces.entries()) {
    if (flightLevel && digits === FLIGHT_LEVEL_DIGITS) return index;
    if (word.kind === 'figures') return index;
    if (isMultiplier(pieces[index])) return multiplierEnd(pieces, index);
    if (standsAsDigit(pieces, index)) digits += 1;
  }
  return pieces.length;
}

function runLength(pieces: readonly NumberPiece[], flightLevel: boolean): number {
  return pieces[0]?.word.kind === 'figures'
    ? figuresRunLength(pieces)
    : wordRunLength(pieces, flightLevel);
}

function append(sum: Concatenation, word: NumberWord): void {
  switch (word.kind) {
    case 'digit':
      sum.text += word.digit;
      sum.saidNine ||= word.saidNine;
      sum.elements += 1;
      return;
    case 'teen':
    case 'tens':
      sum.text += word.value;
      sum.group = true;
      sum.elements += 1;
      return;
    case 'figures':
      sum.text += word.value;
      sum.elements += 1;
      return;
    case 'point':
      sum.text += '.';
      return;
    case 'thousand':
    case 'hundred':
      return;
  }
}

/**
 * Reads pieces in order, each appending its digits: `two forty-four` is `244`, `fourteen twenty`
 * is `1420`. A unit digit completes the tens word before it, so it never counts as said "nine".
 */
function concatenate(pieces: readonly NumberPiece[]): Concatenation {
  const sum: Concatenation = {
    text: '',
    saidNine: false,
    group: false,
    elements: 0,
    restated: false,
  };
  for (const [index, { word }] of pieces.entries()) {
    if (word.kind === 'digit' && isUnit(pieces, index)) {
      sum.text = `${sum.text.slice(0, -1)}${word.digit}`;
      continue;
    }
    append(sum, word);
  }
  return sum;
}

function isGroupWord(piece: NumberPiece): boolean {
  const kind = piece.word.kind;
  return kind === 'teen' || kind === 'tens';
}

/**
 * The body of a run read as a restatement: digit words, then a group form that reads to the same
 * digits, e.g. `one zero ten` or `four two one five forty-two fifteen`.
 *
 * The digits are split off from two words upward, and the first split whose rest holds a group word
 * and reads back to the digits wins. The restated body is one value, said digit by digit, and only
 * the digits tell whether a nine was said "nine".
 */
function readRestatement(body: readonly NumberPiece[]): Concatenation | undefined {
  for (let split = MIN_RESTATED_DIGITS; split < body.length; split += 1) {
    const head = body.slice(0, split);
    if (!head.every((piece) => piece.word.kind === 'digit')) return undefined;
    const tail = body.slice(split);
    const digits = concatenate(head);
    if (tail.some(isGroupWord) && concatenate(tail).text === digits.text) {
      return { ...digits, elements: 1, restated: true };
    }
  }
  return undefined;
}

/** A run's body read as a restatement where it is one, and word by word otherwise. */
function readBody(body: readonly NumberPiece[]): Concatenation {
  return readRestatement(body) ?? concatenate(body);
}

function readPlain(sum: Concatenation): RunValue | undefined {
  if (!PLAIN_NUMBER.test(sum.text)) return undefined;
  return { value: sum.text, saidNine: sum.saidNine, group: sum.group, restated: sum.restated };
}

/** A run that ends on `hundred` with no `thousand`: one digit or group value times 100. */
function readHundreds(body: Concatenation): RunValue | undefined {
  if (body.elements !== 1 || !WHOLE_NUMBER.test(body.text)) return undefined;
  return {
    value: String(BigInt(body.text) * 100n),
    saidNine: body.saidNine,
    group: body.group,
    restated: body.restated,
  };
}

/** A run with `thousand`: what it held times 1000, plus any hundreds said after it. */
function readThousands(body: Concatenation, hundreds: Concatenation): RunValue | undefined {
  if (!WHOLE_NUMBER.test(body.text)) return undefined;
  const extra = hundreds.text === '' ? 0n : BigInt(hundreds.text) * 100n;
  return {
    value: String(BigInt(body.text) * 1000n + extra),
    saidNine: body.saidNine || hundreds.saidNine,
    group: body.group || hundreds.group,
    restated: body.restated,
  };
}

/**
 * The value of one run, or undefined when it cannot form a number.
 *
 * The body, every piece before the first multiplier or the whole run where it has none, reads as a
 * restatement where it is one; a multiplier after it applies to the value it reads to.
 */
function readRun(run: readonly NumberPiece[]): RunValue | undefined {
  const at = run.findIndex((piece) => isMultiplier(piece));
  if (at < 0) return readPlain(readBody(run));
  const body = readBody(run.slice(0, at));
  if (run[at]?.word.kind === 'hundred') return readHundreds(body);
  return readThousands(body, concatenate(run.slice(at + 1, -1)));
}

function formOf(first: NumberPiece, value: RunValue): NumberForm {
  if (first.word.kind === 'figures') return 'figures';
  return value.group ? 'group' : 'digits';
}

/** One run as a number token spanning its pieces, or as one word per piece when it cannot parse. */
function runTokens(run: readonly NumberPiece[]): SpokenToken[] {
  const first = run[0];
  const last = run.at(-1);
  const value = readRun(run);
  if (value === undefined || first === undefined || last === undefined) {
    return run.map(({ piece }) => wordToken(piece.text, piece));
  }
  return [
    {
      kind: 'number',
      value: value.value,
      form: formOf(first, value),
      saidNine: value.saidNine,
      restated: value.restated,
      start: first.piece.start,
      end: last.piece.end,
    },
  ];
}

/** Every run of a stretch of consecutive number pieces, in order. */
function readStretch(stretch: readonly NumberPiece[], flightLevel: boolean): SpokenToken[] {
  const tokens: SpokenToken[] = [];
  let rest = stretch;
  let capped = flightLevel;
  while (rest.length > 0) {
    const length = runLength(rest, capped);
    tokens.push(...runTokens(rest.slice(0, length)));
    rest = rest.slice(length);
    capped = false;
  }
  return tokens;
}

function readNumberStretch(items: readonly Item[], index: number, lexicon: Lexicon): Reading {
  const stretch: NumberPiece[] = [];
  let next = index;
  let found = numberPieceAt(items, next, lexicon);
  while (found !== undefined) {
    stretch.push(found);
    next += 1;
    found = numberPieceAt(items, next, lexicon);
  }
  return { tokens: readStretch(stretch, followsFlightLevel(items, index)), next };
}

function readItem(items: readonly Item[], index: number, lexicon: Lexicon): Reading {
  const item = items[index];
  if (item === undefined || item.kind === 'boundary') return { tokens: [], next: index + 1 };
  const single = expandIdentifier(item, lexicon) ?? readShaped(item, items[index + 1]);
  if (single !== undefined) return { tokens: single, next: index + 1 };
  if (numberWordOf(item.text) !== undefined) return readNumberStretch(items, index, lexicon);
  return { tokens: [wordToken(item.text, item)], next: index + 1 };
}

/**
 * The identifiers a student may type in capitals, and the words each is spoken as.
 *
 * Merges the airport's spoken fixes and navaids, then its SIDs by id, then its route-library
 * destinations by ICAO code. Where two maps share a key the later one wins: a SID over a fix, and a
 * destination over both.
 *
 * @param airport The airport data.
 * @returns Identifier to spoken words.
 */
export function lexiconFor(airport: AirportData): Lexicon {
  return {
    ...airport.fixSpoken,
    ...Object.fromEntries(airport.sids.map((sid) => [sid.id, sid.spoken])),
    ...Object.fromEntries(
      airport.routeLibrary.destinations.map((destination) => [
        destination.icao,
        destination.spoken,
      ]),
    ),
  };
}

/**
 * Normalises a clearance as typed or as read, so both sides compare token by token.
 *
 * Whitespace, punctuation and a hyphen between letters split the text into pieces. A piece typed in
 * capitals that the lexicon holds becomes its spoken words; a shaped piece (`FL320`, `28L`, `V244`,
 * `HAWKZ7`) becomes its words and its number; a stretch of figures and number words becomes number
 * tokens, each recording how it was said, and digits followed by their own group form (`one zero ten
 * thousand`) read as one restated number; anything else is a lower-case word. A stretch that cannot
 * form a number stays as words. Each token spans the original text it came from.
 *
 * @param text The clearance text, typed or spoken.
 * @param lexicon Identifier to spoken words, from `lexiconFor`.
 * @returns The tokens, in text order.
 */
export function normaliseSpoken(text: string, lexicon: Lexicon): SpokenToken[] {
  const items = splitText(text);
  const tokens: SpokenToken[] = [];
  let index = 0;
  while (index < items.length) {
    const reading = readItem(items, index, lexicon);
    tokens.push(...reading.tokens);
    index = reading.next;
  }
  return tokens;
}
