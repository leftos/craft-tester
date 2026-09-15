import { routeFromExitFix } from '@/rules/route.ts';
import type { ResolvedClearance } from '@/rules/types.ts';

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

/** Airway letters that are not spoken phonetically. */
const AIRWAY_LETTERS: Readonly<Record<string, string>> = { J: 'Jay', V: 'Victor', Q: 'Q' };

/** An airway as filed: one letter and up to three digits, e.g. `V244`. */
const AIRWAY_TOKEN = /^[A-Z]\d{1,3}$/;

/** A published procedure as filed: a name and one version digit, e.g. `HAWKZ7`. */
const STAR_TOKEN = /^[A-Z]{3,5}\d$/;

/** The facility word a navaid's spoken name ends in, which a procedure named after it drops. */
const FACILITY_WORD = / (?:VOR|NDB|TACAN|DME)$/;

const UNIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const TEEN_WORDS = [
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

const TENS_WORDS = [
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
 * letters ending in a digit is a STAR ("Hawkz Seven arrival"); everything else is a fix.
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
 * A procedure named after a navaid drops the navaid's facility word: the CCR2 arrival is "Concord
 * Two arrival", although the navaid it is named after is spoken "Concord VOR".
 *
 * @param name The procedure name without its version digit, e.g. `CCR`.
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
 * to find the exit fix the same way the engine does. `sidTransitions` are the transitions of the
 * issued procedure, which name their fix the way the chart publishes it.
 */
export type SpeakClearanceInput = {
  callsign: string;
  clearance: ResolvedClearance;
  destinationSpoken: string;
  filedRoute: string;
  airportFaa: string;
  squawk: string;
  telephony: Readonly<Record<string, string>>;
  fixSpoken: Readonly<Record<string, string>>;
  sidTransitions: readonly { fix: string; spoken: string }[];
};

/** The clearance as read on frequency, and the same clearance with the filed route spelled out. */
export type SpokenClearance = {
  abbreviated: string;
  fullRoute: string;
};

function altitudeSentence(clearance: ResolvedClearance): string {
  const { phrase, feet } = clearance.altitude.value;
  if (phrase === 'climb_via') return 'climb via SID';
  const spokenFeet = feet === undefined ? '' : ` ${speakAltitude(feet)}`;
  return phrase === 'maintain'
    ? `maintain${spokenFeet}`
    : `climb via SID except maintain${spokenFeet}`;
}

function expectSentence(clearance: ResolvedClearance): string {
  const expect = clearance.expect.value;
  if (expect === null) return '';
  const minutes = speakDigits(String(expect.minutes));
  return `expect ${speakAltitude(expect.feet)} ${minutes} minutes after departure`;
}

function radioSentence(input: SpeakClearanceInput): string {
  const frequency = speakFrequency(input.clearance.frequency.value.value);
  return `departure frequency ${frequency}, squawk ${speakDigits(input.squawk)}`;
}

/**
 * The filed route after the element the SID phrase has already spoken.
 *
 * That element is the transition fix, the fix the vectors go to, the SID's base fix, or the airway
 * the vectors join, and it is always the first token the route leaves the terminal on, so dropping
 * it needs no case analysis.
 */
function routeAfterExitFix(input: SpeakClearanceInput): string[] {
  return routeFromExitFix(input.filedRoute, input.airportFaa).slice(1);
}

/**
 * One unit of the route reading, and how many tokens it consumed.
 *
 * An airway takes the fix that follows it along ("Victor two forty-four Altam"), a final procedure
 * is read as an arrival, and a fix no airway precedes is flown direct.
 */
function routeUnit(
  tokens: readonly string[],
  index: number,
  fixSpoken: Readonly<Record<string, string>>,
): { unit: string; consumed: number } {
  const token = tokens[index] ?? '';
  const next = tokens[index + 1];
  if (AIRWAY_TOKEN.test(token)) {
    const airway = speakRouteToken(token, fixSpoken);
    return next === undefined
      ? { unit: airway, consumed: 1 }
      : { unit: `${airway} ${speakFix(next, fixSpoken)}`, consumed: 2 };
  }
  if (index === tokens.length - 1 && STAR_TOKEN.test(token)) {
    return { unit: speakRouteToken(token, fixSpoken), consumed: 1 };
  }
  return { unit: `direct ${speakFix(token, fixSpoken)}`, consumed: 1 };
}

/**
 * The route after the exit fix as it is read on frequency.
 *
 * A route that does not end on a published arrival ends "direct", which is the clearance to the
 * destination airport, so a route with nothing after the exit fix reads "direct" alone.
 */
function routeUnits(
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
  const last = tokens[tokens.length - 1];
  if (last === undefined || !STAR_TOKEN.test(last)) units.push('direct');
  return units;
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

function clearedSentence(input: SpeakClearanceInput, routeTail: readonly string[]): string {
  const callsign = speakCallsign(input.callsign, input.telephony);
  const parts = [
    `${callsign}, cleared to ${input.destinationSpoken} airport`,
    `${input.clearance.sid.value.spoken} departure`,
  ];
  const fix = input.clearance.route.value.fix;
  if (fix !== undefined) parts.push(routeElementPhrase(input, fix));
  return [...parts, ...routeTail].join(', ');
}

function joinSentences(parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part) => `${capitalizeFirst(part)}.`)
    .join(' ');
}

/**
 * The full-route reading of everything after the element the SID phrase already spoke.
 *
 * A clearance that joined an airway has spoken the airway but not the fix it leads to, and that fix
 * is not flown direct, so it is read bare; the ordinary grammar takes over from the next token.
 */
function fullRouteUnits(input: SpeakClearanceInput, tokens: readonly string[]): string[] {
  const [first, ...rest] = tokens;
  if (input.clearance.route.value.template !== 'radar_vectors_airway' || first === undefined) {
    return routeUnits(tokens, input.fixSpoken);
  }
  return [speakFix(first, input.fixSpoken), ...routeUnits(rest, input.fixSpoken)];
}

/**
 * Renders a resolved clearance as it is read on frequency.
 *
 * `abbreviated` says "then as filed"; `fullRoute` reads the filed route after the exit fix instead,
 * which is what the reveal shows after grading. Neither form repeats the filed procedure token or
 * the exit fix, because the SID phrase has already spoken both. A route with nothing after the exit
 * fix has nothing to file, so both forms end "direct" instead.
 *
 * @param input The clearance plus the scenario facts the phraseology needs.
 * @returns Both spoken forms of the clearance.
 */
export function speakClearance(input: SpeakClearanceInput): SpokenClearance {
  const tail = [
    altitudeSentence(input.clearance),
    expectSentence(input.clearance),
    radioSentence(input),
  ];
  const tokens = routeAfterExitFix(input);
  const abbreviatedTail = tokens.length === 0 ? ['direct'] : ['then as filed'];
  return {
    abbreviated: joinSentences([clearedSentence(input, abbreviatedTail), ...tail]),
    fullRoute: joinSentences([clearedSentence(input, fullRouteUnits(input, tokens)), ...tail]),
  };
}
