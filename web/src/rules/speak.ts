import type { NonDpHeading } from '@/data/schema.ts';
import { isAirwayToken, routeFromExitFix } from '@/rules/route.ts';
import type { ExpectClause, ResolvedClearance, Turn } from '@/rules/types.ts';

/** A heading is read as three digits, so a two-digit heading is spoken with a leading zero. */
const HEADING_DIGITS = 3;

/** How ATC speaks each digit; `9` is "niner" so it cannot be heard as "five". */
const DIGIT_WORDS: Readonly<Record<string, string>> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'niner',
};

/** The ICAO phonetic alphabet, used for registrations and for unknown airline codes. */
const PHONETIC_LETTERS: Readonly<Record<string, string>> = {
  A: 'alpha',
  B: 'bravo',
  C: 'charlie',
  D: 'delta',
  E: 'echo',
  F: 'foxtrot',
  G: 'golf',
  H: 'hotel',
  I: 'india',
  J: 'juliett',
  K: 'kilo',
  L: 'lima',
  M: 'mike',
  N: 'november',
  O: 'oscar',
  P: 'papa',
  Q: 'quebec',
  R: 'romeo',
  S: 'sierra',
  T: 'tango',
  U: 'uniform',
  V: 'victor',
  W: 'whiskey',
  X: 'xray',
  Y: 'yankee',
  Z: 'zulu',
};

/** Airway letters that are not spoken phonetically: "Victor 6", "Jay 5", "Queue 2". */
const AIRWAY_LETTERS: Readonly<Record<string, string>> = { J: 'Jay', V: 'Victor', Q: 'Queue' };

/** A published procedure as filed: a name and one version digit, e.g. `HAWKZ8`. */
const STAR_TOKEN = /^[A-Z]{3,5}\d$/;

/** The facility word a navaid's spoken name ends in, which a procedure named after it drops. */
const FACILITY_WORD = / (?:VOR|NDB|TACAN|DME)$/;

/** A runway designator as written: one or two digits and an optional side letter. */
const RUNWAY_DESIGNATOR = /^(\d{1,2})([LRC]?)$/;

/** The word each parallel-runway side letter is spoken as. */
const RUNWAY_SIDES: Readonly<Record<string, string>> = { L: 'left', R: 'right', C: 'center' };

/** The English word for each digit, indexed by the digit, as a grouped number speaks it. */
export const UNIT_WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

/** The English words for ten through nineteen, indexed by the value less ten. */
export const TEEN_WORDS: readonly string[] = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

/** The English words for the tens, indexed by the tens digit; below twenty there is none. */
export const TENS_WORDS: readonly string[] = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function wordAt(table: readonly string[], index: number): string {
  return table[index] ?? '';
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Speaks every character phonetically: letters from the ICAO alphabet, digits as digit words. */
function speakCharacters(text: string): string {
  return [...text]
    .map((character) => {
      const upper = character.toUpperCase();
      return PHONETIC_LETTERS[upper] ?? DIGIT_WORDS[character] ?? character;
    })
    .join(' ');
}

/** Speaks a one- or two-digit group as an English number word, e.g. `59` as "fifty-nine". */
function groupWord(digits: string): string {
  const value = Number(digits);
  if (value < 10) return wordAt(UNIT_WORDS, value);
  if (value < 20) return wordAt(TEEN_WORDS, value - 10);
  const units = value % 10;
  const tens = wordAt(TENS_WORDS, Math.floor(value / 10));
  return units === 0 ? tens : `${tens}-${wordAt(UNIT_WORDS, units)}`;
}

/**
 * Speaks a flight or airway number in the grouped form controllers use.
 *
 * The last two digits form one group: `1859` is "eighteen fifty-nine", `100` is "one hundred", and
 * a zero tens digit is spoken as a digit, so `1005` is "ten zero five". Numbers longer than four
 * digits fall back to individual digits.
 *
 * @param digits The number as written on the strip.
 * @returns The spoken form, in lower case.
 */
function speakNumberGroups(digits: string): string {
  if (digits.length > 4) return speakDigits(digits);
  if (digits.length <= 2) return groupWord(digits);
  const head = groupWord(digits.slice(0, -2));
  const pair = digits.slice(-2);
  if (pair === '00') return `${head} hundred`;
  if (pair.startsWith('0')) return `${head} zero ${wordAt(UNIT_WORDS, Number(pair.slice(1)))}`;
  return `${head} ${groupWord(pair)}`;
}

/**
 * Speaks each character of a digit string, e.g. a squawk or one side of a frequency.
 *
 * @param text The digits to speak; characters that are not digits pass through unchanged.
 * @returns The digit words, separated by spaces.
 */
export function speakDigits(text: string): string {
  return [...text].map((character) => DIGIT_WORDS[character] ?? character).join(' ');
}

/**
 * Speaks an altitude the way a clearance does.
 *
 * Below 18,000 feet the thousands and hundreds are spoken as such ("three thousand five hundred",
 * "one zero thousand"); at or above 18,000 feet it becomes a flight level with individual digits.
 *
 * @param feet The altitude in feet.
 * @returns The spoken altitude, in lower case.
 */
export function speakAltitude(feet: number): string {
  if (feet >= 18000) return `flight level ${speakDigits(String(Math.round(feet / 100)))}`;
  const thousands = Math.floor(feet / 1000);
  const hundreds = Math.floor((feet % 1000) / 100);
  const parts: string[] = [];
  if (thousands > 0) parts.push(`${speakDigits(String(thousands))} thousand`);
  if (hundreds > 0) parts.push(`${speakDigits(String(hundreds))} hundred`);
  return parts.length > 0 ? parts.join(' ') : 'zero';
}

/**
 * Speaks a radio frequency, e.g. `120.9` as "one two zero point niner".
 *
 * @param frequency The frequency as written in the data, megahertz with a decimal point.
 * @returns The spoken frequency, in lower case.
 */
export function speakFrequency(frequency: string): string {
  return frequency
    .split('.')
    .map((part) => speakDigits(part))
    .join(' point ');
}

/**
 * Speaks a runway designator, e.g. `01R` as "one right".
 *
 * Per FAA JO 7110.65 2-4-17 the designator is spoken digit by digit with a leading zero dropped,
 * and the side letter becomes a word: `28L` is "two eight left", `19L` is "one niner left", `10C`
 * is "one zero center", and a designator with no side letter is the digits alone.
 *
 * @param runway The runway designator as written in the data.
 * @returns The spoken designator in lower case; a designator this cannot parse is returned as is.
 */
export function speakRunway(runway: string): string {
  const parsed = RUNWAY_DESIGNATOR.exec(runway);
  const digits = parsed?.[1];
  if (digits === undefined) return runway;
  const spoken = speakDigits(
    digits.length === 2 && digits.startsWith('0') ? digits.slice(1) : digits,
  );
  const side = RUNWAY_SIDES[parsed?.[2] ?? ''];
  return side === undefined ? spoken : `${spoken} ${side}`;
}

/**
 * Speaks a callsign.
 *
 * A three-letter airline code with a telephony entry becomes the telephony name plus the flight
 * number in grouped form ("United three twenty"); trailing letters force the digits to be spoken
 * individually ("Southwest one two three four alpha"). Anything else, including registrations, is
 * spoken character by character ("November four eight three kilo alpha").
 *
 * @param callsign The callsign as filed.
 * @param telephony Airline code to telephony name, from the airport data.
 * @returns The spoken callsign, capitalized.
 */
export function speakCallsign(
  callsign: string,
  telephony: Readonly<Record<string, string>>,
): string {
  const parsed = /^([A-Z]{3})(\d+)([A-Z]*)$/.exec(callsign);
  const code = parsed?.[1];
  const digits = parsed?.[2];
  const suffix = parsed?.[3] ?? '';
  const name = code === undefined ? undefined : telephony[code];
  if (name === undefined || digits === undefined) return capitalizeFirst(speakCharacters(callsign));
  const number =
    suffix.length > 0
      ? `${speakDigits(digits)} ${speakCharacters(suffix)}`
      : speakNumberGroups(digits);
  return capitalizeFirst(`${name} ${number}`);
}

/**
 * Speaks a fix or navaid.
 *
 * A navaid with a spoken name in the data uses that name, a five-letter fix is spoken as a word,
 * and anything else is spelled out phonetically.
 *
 * @param fix The fix identifier as written in the route.
 * @param fixSpoken Identifier to spoken name, from the airport data.
 * @returns The spoken fix.
 */
export function speakFix(fix: string, fixSpoken: Readonly<Record<string, string>>): string {
  const mapped = fixSpoken[fix];
  if (mapped !== undefined) return mapped;
  if (/^[A-Z]{5}$/.test(fix)) return capitalizeWord(fix);
  return speakCharacters(fix);
}

/**
 * Speaks one token of a filed route.
 *
 * Airways are a letter plus a grouped number ("Victor two forty-four"); a token of two or more
 * letters ending in a digit is a STAR ("Hawkz Eight arrival"); everything else is a fix.
 *
 * @param token The route token as filed.
 * @param fixSpoken Identifier to spoken name, from the airport data.
 * @returns The spoken token.
 */
export function speakRouteToken(
  token: string,
  fixSpoken: Readonly<Record<string, string>>,
): string {
  const airway = /^([A-Z])(\d{1,3})$/.exec(token);
  const airwayLetter = airway?.[1];
  const airwayNumber = airway?.[2];
  if (airwayLetter !== undefined && airwayNumber !== undefined) {
    const spokenLetter =
      AIRWAY_LETTERS[airwayLetter] ?? capitalizeWord(speakCharacters(airwayLetter));
    return `${spokenLetter} ${speakNumberGroups(airwayNumber)}`;
  }
  const star = /^([A-Z]{2,})(\d+)$/.exec(token);
  const starName = star?.[1];
  const starNumber = star?.[2];
  if (starName !== undefined && starNumber !== undefined) {
    return `${speakProcedureName(starName, fixSpoken)} ${capitalizeFirst(speakNumberGroups(starNumber))} arrival`;
  }
  return speakFix(token, fixSpoken);
}

/** Drops the facility word a navaid's spoken name ends in: "Concord VOR" becomes "Concord". */
function stripFacilityWord(name: string): string {
  return name.replace(FACILITY_WORD, '');
}

/**
 * Speaks the name of a published procedure.
 *
 * A procedure named after a navaid drops the navaid's facility word: the BVL2 arrival is
 * "Bonneville Two arrival", although the navaid it is named after is spoken "Bonneville VOR".
 *
 * @param name The procedure name without its version digit, e.g. `BVL`.
 * @param fixSpoken Identifier to spoken name, from the airport data.
 * @returns The spoken procedure name.
 */
function speakProcedureName(name: string, fixSpoken: Readonly<Record<string, string>>): string {
  return stripFacilityWord(speakFix(name, fixSpoken));
}

/**
 * Everything the spoken clearance needs beyond the resolved clearance itself.
 *
 * `airportFaa` is the departure airport's own navaid identifier, which the full-route reading needs
 * to find the exit fix the same way the engine does. `filedRoute` is the route the clearance is read
 * for, which on an amended plan is the corrected route; `originalRoute` is the route the pilot filed,
 * which is what "as filed" refers to and equals `filedRoute` where nothing was amended.
 * `sidTransitions` are the transitions of the issued procedure, which name their fix the way the
 * chart publishes it.
 */
export type SpeakClearanceInput = {
  callsign: string;
  clearance: ResolvedClearance;
  destinationSpoken: string;
  filedRoute: string;
  originalRoute: string;
  airportFaa: string;
  squawk: string;
  telephony: Readonly<Record<string, string>>;
  fixSpoken: Readonly<Record<string, string>>;
  sidTransitions: readonly { fix: string; spoken: string }[];
};

/** A CRAFT element of the spoken reading. */
export type SpokenElement =
  | 'callsign'
  | 'C'
  | 'R.sid'
  | 'R.route'
  | 'A.phrase'
  | 'A.expect'
  | 'F'
  | 'T'
  | 'RWY';

/** One element of the reading and the words it is spoken as, before capitals and full stops. */
export type SpokenPart = { element: SpokenElement; words: string };

/**
 * The clearance as read on frequency, and the same clearance with the filed route spelled out.
 *
 * `parts` is the abbreviated reading element by element, in spoken order. `fullRouteWords` is the
 * route element of the full-route reading, which is the abbreviated route's words where the two
 * readings are the same text and empty where the reading speaks no route.
 */
export type SpokenClearance = {
  abbreviated: string;
  fullRoute: string;
  parts: SpokenPart[];
  fullRouteWords: string;
};

/** The elements each sentence of the reading is made of, one list per sentence, in spoken order. */
const SENTENCE_ELEMENTS: readonly (readonly SpokenElement[])[] = [
  ['callsign', 'C', 'R.sid', 'R.route'],
  ['A.phrase'],
  ['A.expect'],
  ['F', 'T'],
  ['RWY'],
];

function altitudeSentence(clearance: ResolvedClearance): string {
  const { phrase, feet } = clearance.altitude.value;
  if (phrase === 'climb_via') return 'climb via SID';
  const spokenFeet = feet === undefined ? '' : ` ${speakAltitude(feet)}`;
  return phrase === 'maintain'
    ? `maintain${spokenFeet}`
    : `climb via SID except maintain${spokenFeet}`;
}

/**
 * Speaks one expect clause the way the reading does.
 *
 * A `filed` clause reads "expect (altitude) (minutes) minutes after departure", an `amended` one
 * opens on "expect amended" instead, and a `final` clause reads "(altitude) will be your final".
 *
 * @param clause The expect clause to speak.
 * @returns The spoken clause, in lower case.
 */
export function speakExpect(clause: ExpectClause): string {
  if (clause.kind === 'final') return `${speakAltitude(clause.feet)} will be your final`;
  const minutes = speakDigits(String(clause.minutes));
  const opening = clause.kind === 'amended' ? 'expect amended' : 'expect';
  return `${opening} ${speakAltitude(clause.feet)} ${minutes} minutes after departure`;
}

/**
 * The route after the element the SID phrase has already spoken.
 *
 * That element is the transition fix, the fix the vectors go to, the SID's base fix, or the airway
 * the vectors join, and it is always the first token the route leaves the terminal on, so dropping
 * it needs no case analysis.
 */
function afterExitElement(route: readonly string[]): string[] {
  return route.slice(1);
}

/** How many tokens the two routes share at their tails, counted from the last token back. */
function commonSuffixLength(amended: readonly string[], original: readonly string[]): number {
  let shared = 0;
  while (
    shared < amended.length &&
    shared < original.length &&
    amended[amended.length - 1 - shared] === original[original.length - 1 - shared]
  ) {
    shared += 1;
  }
  return shared;
}

/**
 * The token of an amended route that "then as filed" may be spoken after.
 *
 * The two routes run identically from the join onwards, so everything read up to it is the
 * amendment and everything after it is the route the pilot already has. The join is the first token
 * of the longest suffix the two share, and it has to be a fix: an airway is the way to the next fix
 * rather than a point the flight is cleared to, so a shared suffix that opens on one joins at the
 * fix that follows. A suffix reaching the exit element joins there whatever that element is, airway
 * included, because the route phrase of the clearance has already spoken it.
 *
 * @param amended The route being cleared, from its exit element on and without its procedure token.
 * @param original The route the pilot filed, read the same way.
 * @returns The index in `amended` of the join, or undefined when the two share no tail, or when no
 *   fix follows the airways the shared tail opens on.
 */
export function asFiledJoin(
  amended: readonly string[],
  original: readonly string[],
): number | undefined {
  const shared = commonSuffixLength(amended, original);
  if (shared === 0) return undefined;
  let index = amended.length - shared;
  if (index === 0) return 0;
  while (index < amended.length && isAirwayToken(amended[index] ?? '')) index += 1;
  return index < amended.length ? index : undefined;
}

/**
 * One unit of the route reading, and how many tokens it consumed.
 *
 * An airway takes the fix that follows it along, a comma between them for pacing ("Victor two
 * forty-four, Altam"; user steer 2026-09-17), a final procedure is read as an arrival, and a fix no
 * airway precedes is flown direct, with no comma after the word.
 */
function routeUnit(
  tokens: readonly string[],
  index: number,
  fixSpoken: Readonly<Record<string, string>>,
): { unit: string; consumed: number } {
  const token = tokens[index] ?? '';
  const next = tokens[index + 1];
  if (isAirwayToken(token)) {
    const airway = speakRouteToken(token, fixSpoken);
    return next === undefined
      ? { unit: airway, consumed: 1 }
      : { unit: `${airway}, ${speakFix(next, fixSpoken)}`, consumed: 2 };
  }
  if (index === tokens.length - 1 && STAR_TOKEN.test(token)) {
    return { unit: speakRouteToken(token, fixSpoken), consumed: 1 };
  }
  return { unit: `direct ${speakFix(token, fixSpoken)}`, consumed: 1 };
}

/** The units the tokens read as, one per fix or airway-and-fix pair, and nothing to close them. */
function routeUnitList(
  tokens: readonly string[],
  fixSpoken: Readonly<Record<string, string>>,
): string[] {
  const units: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const { unit, consumed } = routeUnit(tokens, index, fixSpoken);
    units.push(unit);
    index += consumed;
  }
  return units;
}

/**
 * How a route reading closes.
 *
 * A route that does not end on a published arrival ends "direct", which is the clearance to the
 * destination airport, so a route with nothing after the exit fix reads "direct" alone. A reading
 * that stops part way through the route, to hand the rest over as filed, closes on neither.
 */
function closingUnits(tokens: readonly string[]): string[] {
  const last = tokens[tokens.length - 1];
  return last === undefined || !STAR_TOKEN.test(last) ? ['direct'] : [];
}

/** The transition fix as the issued procedure publishes it, which carries no facility word. */
function speakTransition(input: SpeakClearanceInput, fix: string): string {
  const published = input.sidTransitions.find((transition) => transition.fix === fix);
  return published?.spoken ?? speakFix(fix, input.fixSpoken);
}

/**
 * A fix spoken bare, the way an "as filed" clearance names the fix the SID hands over on.
 *
 * The chart's own name wins where the SID publishes the fix as a transition; otherwise the navaid
 * name is spoken without its facility word, so the base fix of the TRUKN TWO is "Trukn" and a
 * navaid left on is "Concord", not "Concord VOR".
 */
function speakBareFix(input: SpeakClearanceInput, fix: string): string {
  return stripFacilityWord(speakTransition(input, fix));
}

/** The phrase that names what the flight leaves the terminal on, one per route shape. */
function routeElementPhrase(input: SpeakClearanceInput, fix: string): string {
  const { template } = input.clearance.route.value;
  if (template === 'transition') return `${speakTransition(input, fix)} transition`;
  if (template === 'radar_vectors_fix') return `radar vectors ${speakFix(fix, input.fixSpoken)}`;
  if (template === 'radar_vectors_airway') {
    return `radar vectors to join ${speakRouteToken(fix, input.fixSpoken)}`;
  }
  return speakBareFix(input, fix);
}

/** The heading a clearance with no DP goes out on, its degrees spoken digit by digit. */
function headingPhrase(heading: NonDpHeading, turn: Turn): string {
  if (heading === 'runway heading') return 'fly runway heading';
  const degrees = speakDigits(String(heading).padStart(HEADING_DIGITS, '0'));
  return turn === undefined ? `fly heading ${degrees}` : `turn ${turn} heading ${degrees}`;
}

/**
 * The procedure as the clearance names it.
 *
 * A SID is named and followed by "departure"; a clearance issued without one introduces the heading
 * with "via", as the OAK ATCT SOP 2-1 c phraseology reads it.
 */
function procedurePhrase(clearance: ResolvedClearance): string {
  const procedure = clearance.procedure.value;
  if (procedure.kind === 'sid') return `${procedure.spoken} departure`;
  return `via ${headingPhrase(procedure.heading, procedure.turn)}`;
}

/** The route element's words: the phrase the flight leaves the terminal on, then the route after it. */
function routeWords(input: SpeakClearanceInput, routeTail: readonly string[]): string {
  const fix = input.clearance.route.value.fix;
  const exitElement = fix === undefined ? [] : [routeElementPhrase(input, fix)];
  return [...exitElement, ...routeTail].join(', ');
}

/** The part for an element the reading leaves out when it has no words. */
function optionalPart(element: SpokenElement, words: string): SpokenPart[] {
  return words === '' ? [] : [{ element, words }];
}

/** The abbreviated reading, element by element, in spoken order. */
function spokenParts(input: SpeakClearanceInput, route: string): SpokenPart[] {
  const { clearance } = input;
  const frequency = speakFrequency(clearance.frequency.value.value);
  const expect = clearance.expect.value;
  return [
    { element: 'callsign', words: speakCallsign(input.callsign, input.telephony) },
    { element: 'C', words: `cleared to ${input.destinationSpoken} airport` },
    { element: 'R.sid', words: procedurePhrase(clearance) },
    ...optionalPart('R.route', route),
    { element: 'A.phrase', words: altitudeSentence(clearance) },
    ...optionalPart('A.expect', expect === null ? '' : speakExpect(expect)),
    { element: 'F', words: `departure frequency ${frequency}` },
    { element: 'T', words: `squawk ${speakDigits(input.squawk)}` },
    { element: 'RWY', words: `expect runway ${speakRunway(clearance.runway.value)}` },
  ];
}

/**
 * Rebuilds the flat reading from its parts.
 *
 * The callsign, clearance limit, procedure and route are one sentence; the altitude and the expect
 * clause are a sentence each; the frequency and the squawk share one; the runway closes the reading.
 * Each sentence opens on a capital and ends on a full stop, and a sentence none of whose elements
 * is among the parts is left out.
 *
 * @param parts The elements of the reading, in spoken order.
 * @returns The reading as it is shown.
 */
export function joinSpoken(parts: readonly SpokenPart[]): string {
  return SENTENCE_ELEMENTS.map((elements) =>
    parts
      .filter((part) => elements.includes(part.element))
      .map((part) => part.words)
      .join(', '),
  )
    .filter((sentence) => sentence.length > 0)
    .map((sentence) => `${capitalizeFirst(sentence)}.`)
    .join(' ');
}

/**
 * The reading of everything after the element the SID phrase already spoke, with nothing closing it.
 *
 * A clearance that joined an airway has spoken the airway but not the fix it leads to, and that fix
 * is not flown direct, so it is read bare; the ordinary grammar takes over from the next token.
 */
function openRouteUnits(input: SpeakClearanceInput, tokens: readonly string[]): string[] {
  const [first, ...rest] = tokens;
  if (input.clearance.route.value.template !== 'radar_vectors_airway' || first === undefined) {
    return routeUnitList(tokens, input.fixSpoken);
  }
  return [speakFix(first, input.fixSpoken), ...routeUnitList(rest, input.fixSpoken)];
}

/** The full-route reading: every unit after the element the SID phrase spoke, and its close. */
function fullRouteUnits(input: SpeakClearanceInput, tokens: readonly string[]): string[] {
  return [...openRouteUnits(input, tokens), ...closingUnits(tokens)];
}

/**
 * The tail of the abbreviated reading, or undefined where the route has to be read in full.
 *
 * The route is handed over as filed from the join onwards, so the reading names every element up to
 * it and then says "then as filed". A join at the exit element leaves nothing to read, because the
 * route phrase has spoken it already. A route the pilot's own route joins nowhere, and one whose
 * join is its last element, have nothing to hand over, and are read to the end instead.
 */
function abbreviatedTail(
  input: SpeakClearanceInput,
  route: readonly string[],
): string[] | undefined {
  const original = routeFromExitFix(input.originalRoute, input.airportFaa);
  const join = asFiledJoin(route, original);
  if (join === undefined || join >= route.length - 1) return undefined;
  if (join === 0) return ['then as filed'];
  return [...openRouteUnits(input, afterExitElement(route).slice(0, join)), 'then as filed'];
}

/**
 * Renders a resolved clearance as it is read on frequency.
 *
 * `abbreviated` hands the route over as filed where it can; `fullRoute` reads every element of the
 * route after the exit fix instead, which is what the reveal shows after grading. Neither form
 * repeats the filed procedure token or the exit fix, because the SID phrase has already spoken both.
 * A route the pilot filed the whole of is handed over at the exit fix, an amended one at the element
 * the two routes run together from, and a route with nothing left to hand over is read in full, so
 * the two forms are then the same text. Both forms close on the departure runway, after the squawk.
 *
 * `parts` holds the abbreviated reading element by element, so a reading can be lined up with the
 * CRAFT element each stretch of it speaks; `fullRouteWords` is the route element the full-route
 * reading puts in its place. Both flat forms are `joinSpoken` of those parts.
 *
 * @param input The clearance plus the scenario facts the phraseology needs.
 * @returns Both spoken forms of the clearance, the parts of the abbreviated one, and the full-route
 *   reading's route words.
 */
export function speakClearance(input: SpeakClearanceInput): SpokenClearance {
  const route = routeFromExitFix(input.filedRoute, input.airportFaa);
  const full = fullRouteUnits(input, afterExitElement(route));
  const parts = spokenParts(input, routeWords(input, abbreviatedTail(input, route) ?? full));
  const fullRouteWords = routeWords(input, full);
  const fullRouteParts = parts.map((part) =>
    part.element === 'R.route' ? { ...part, words: fullRouteWords } : part,
  );
  return {
    abbreviated: joinSpoken(parts),
    fullRoute: joinSpoken(fullRouteParts),
    parts,
    fullRouteWords,
  };
}
