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
    return `${speakFix(starName, fixSpoken)} ${capitalizeFirst(speakNumberGroups(starNumber))} arrival`;
  }
  return speakFix(token, fixSpoken);
}

/** Everything the spoken clearance needs beyond the resolved clearance itself. */
export type SpeakClearanceInput = {
  callsign: string;
  clearance: ResolvedClearance;
  destinationSpoken: string;
  filedRoute: string;
  squawk: string;
  telephony: Readonly<Record<string, string>>;
  fixSpoken: Readonly<Record<string, string>>;
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

function isSidToken(token: string, sid: ResolvedClearance['sid']['value']): boolean {
  if (token === sid.id) return true;
  return /^([A-Z]+)\d*$/.exec(token)?.[1] === sid.family;
}

/** The filed route after the SID token and, on a transition clearance, the transition fix. */
function fullRouteParts(input: SpeakClearanceInput): string[] {
  const route = input.clearance.route.value;
  let rest = input.filedRoute
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const first = rest[0];
  if (first !== undefined && isSidToken(first, input.clearance.sid.value)) rest = rest.slice(1);
  if (route.template === 'transition' && route.fix !== undefined && rest[0] === route.fix) {
    rest = rest.slice(1);
  }
  return rest.map((token) => speakRouteToken(token, input.fixSpoken));
}

function clearedSentence(input: SpeakClearanceInput, routeTail: readonly string[]): string {
  const route = input.clearance.route.value;
  const callsign = speakCallsign(input.callsign, input.telephony);
  const parts = [
    `${callsign}, cleared to ${input.destinationSpoken} airport`,
    `${input.clearance.sid.value.spoken} departure`,
  ];
  const fix = route.fix;
  if (fix !== undefined && route.template === 'transition') {
    parts.push(`${speakFix(fix, input.fixSpoken)} transition`);
  }
  if (fix !== undefined && route.template === 'radar_vectors_fix') {
    parts.push(`radar vectors ${speakFix(fix, input.fixSpoken)}`);
  }
  return [...parts, ...routeTail].join(', ');
}

function joinSentences(parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part) => `${capitalizeFirst(part)}.`)
    .join(' ');
}

/**
 * Renders a resolved clearance as it is read on frequency.
 *
 * `abbreviated` says "then as filed"; `fullRoute` reads the filed route instead, which is what the
 * reveal shows after grading.
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
  return {
    abbreviated: joinSentences([clearedSentence(input, ['then as filed']), ...tail]),
    fullRoute: joinSentences([clearedSentence(input, fullRouteParts(input)), ...tail]),
  };
}
