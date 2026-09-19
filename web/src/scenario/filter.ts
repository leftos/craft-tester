import type { RunwayConfig } from '@/data/schema.ts';
import { seedToHash } from '@/scenario/rng.ts';

/** Which part of the day a scenario may be set in; `either` leaves the draw to the training mix. */
export type TimeFilter = 'either' | 'day' | 'night';

/**
 * Which half of the trainer a session runs.
 *
 * `clearance` reads a plan that is already correct; `amendment` amends the strip's boxes first and
 * clears the corrected plan afterwards.
 */
export type Mode = 'clearance' | 'amendment';

/** How the student answers the clearance: by picking from the dropdowns, or by typing it out. */
export type InputKind = 'dropdowns' | 'text';

/** The hash part amendment mode writes; clearance mode writes none, so its links are unchanged. */
const AMENDMENT_PART = 'm=amend';

/** The hash part typed answers write; the dropdowns write none, so their links are unchanged. */
const TEXT_PART = 'i=text';

/** The hash part a full route clearance writes; every other link is unchanged. */
const FULL_ROUTE_PART = 'r=full';

/** Which runway configurations a scenario may be drawn in: all of them, one plan, or exactly one. */
export type ConfigFilter =
  | { kind: 'any' }
  | { kind: 'plan'; plan: string }
  | { kind: 'id'; id: string };

/**
 * What the player has narrowed the draw to; it rides in the URL hash beside the seed.
 *
 * `destination` is a testing aid rather than a player-facing choice: it forces the draw onto the
 * route library rows filed to that airport, so a destination can be drilled without drawing until
 * the generator happens to land on it. It is deliberately kept out of the dropdowns and out of the
 * remembered filter, and rides in the hash alone so a share link still reproduces the draw.
 */
export type ScenarioFilter = { time: TimeFilter; config: ConfigFilter; destination?: string };

/**
 * What a session is drawn under and answered with, which the URL hash carries beside the seed.
 *
 * `fullRoute` holds the student to the route read to its end, which only the typed grader knows, so
 * it is set only while the clearance is answered by typing it out.
 */
export type SessionSettings = {
  filter: ScenarioFilter;
  mode: Mode;
  input: InputKind;
  fullRoute: boolean;
};

/** The shape a `d=` part has to have to be read: an ICAO code, upper case. */
const DESTINATION_PATTERN = /^[A-Z0-9]{3,4}$/;

/** The shape an `a=` part has to have to be read: a four-letter ICAO code, upper case. */
const AIRPORT_PATTERN = /^[A-Z]{4}$/;

/** The filter that narrows nothing, which is what a hash without filter parts reads as. */
export const ANY_SCENARIO: ScenarioFilter = { time: 'either', config: { kind: 'any' } };

/** The hash part one configuration filter writes, or `undefined` when it narrows nothing. */
function configParam(config: ConfigFilter): string | undefined {
  if (config.kind === 'any') return undefined;
  return config.kind === 'plan'
    ? `plan:${encodeURIComponent(config.plan)}`
    : `id:${encodeURIComponent(config.id)}`;
}

/**
 * Renders the URL hash that shares a filtered scenario.
 *
 * The airport rides in an `a=` part right after the seed, so a reload or a shared link reopens the
 * airport the scenario was drawn at instead of the first one the index lists. A filter member that
 * narrows nothing writes no part at all, so an unfiltered scenario shares nothing but the seed and
 * the airport. A forced destination writes its `d=` part like any other member, so the testing aid
 * is shareable even though nothing in the UI offers it. Clearance mode and the dropdowns write no
 * part at all, so a link written before either choice existed reads the same today.
 *
 * @param icao The airport the scenario was drawn at.
 * @param seed The seed the link restores.
 * @param settings The filter the draw ran under, the half of the trainer the session runs, how the
 *   student answers the clearance, and whether they are held to the full route.
 * @returns The hash, e.g. `#s=21i3v9&a=KOAK&t=night&c=id:28%2F01&m=amend&i=text&r=full`.
 */
export function hashFor(icao: string, seed: number, settings: SessionSettings): string {
  const { filter, mode, input, fullRoute } = settings;
  const parts = [seedToHash(seed).slice(1), `a=${icao}`];
  if (filter.time !== 'either') parts.push(`t=${filter.time}`);
  const config = configParam(filter.config);
  if (config !== undefined) parts.push(`c=${config}`);
  if (filter.destination !== undefined) parts.push(`d=${filter.destination}`);
  if (mode === 'amendment') parts.push(AMENDMENT_PART);
  if (input === 'text') parts.push(TEXT_PART);
  if (input === 'text' && fullRoute) parts.push(FULL_ROUTE_PART);
  return `#${parts.join('&')}`;
}

/** The `&`-separated parts of a hash, with or without its leading `#`. */
function partsOf(hash: string): string[] {
  return (hash.startsWith('#') ? hash.slice(1) : hash).split('&');
}

/** The value of one named hash part, or `undefined` when the hash carries no such part. */
function valueOf(hash: string, name: string): string | undefined {
  const prefix = `${name}=`;
  return partsOf(hash)
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

/** Reads a percent-encoded value, treating a malformed escape as no value at all. */
function decode(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** The value behind one `c=` prefix, or `undefined` when the part carries another or an empty one. */
function prefixed(raw: string, prefix: string): string | undefined {
  if (!raw.startsWith(prefix)) return undefined;
  const value = decode(raw.slice(prefix.length));
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Reads the `t=` part, falling back to `either` for anything it does not name. */
function timeOf(raw: string | undefined): TimeFilter {
  return raw === 'day' || raw === 'night' ? raw : 'either';
}

/** Reads the `c=` part, falling back to `any` for anything it does not name. */
function configOf(raw: string | undefined): ConfigFilter {
  if (raw === undefined) return { kind: 'any' };
  const plan = prefixed(raw, 'plan:');
  if (plan !== undefined) return { kind: 'plan', plan };
  const id = prefixed(raw, 'id:');
  return id === undefined ? { kind: 'any' } : { kind: 'id', id };
}

/**
 * Reads the `d=` part, which is absent for anything that is not an ICAO code.
 *
 * The testing aid narrows the draw to one destination, so a value that cannot be one narrows
 * nothing, the way every other unreadable member does.
 */
function destinationOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = decode(raw)?.toUpperCase();
  return value !== undefined && DESTINATION_PATTERN.test(value) ? value : undefined;
}

/**
 * Reads the filter back out of a URL hash.
 *
 * A value this app does not know narrows nothing rather than failing the load, so an old or
 * hand-edited link still opens on a scenario. The `d=` part is the undocumented testing aid that
 * forces the destination; a hash without one leaves the member absent.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns The filter the hash asks for; every unreadable member falls back to `ANY_SCENARIO`'s.
 */
export function filterFromHash(hash: string): ScenarioFilter {
  const destination = destinationOf(valueOf(hash, 'd'));
  return {
    time: timeOf(valueOf(hash, 't')),
    config: configOf(valueOf(hash, 'c')),
    ...(destination === undefined ? {} : { destination }),
  };
}

/**
 * Reads the airport back out of a URL hash.
 *
 * A hash that names no airport, or names something that cannot be an ICAO code, reads as no
 * airport at all, so an old or hand-edited link still opens on the airport the app starts with.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns The ICAO code the hash names, upper-cased, or `undefined` when it names none.
 */
export function airportFromHash(hash: string): string | undefined {
  const raw = valueOf(hash, 'a');
  if (raw === undefined) return undefined;
  const value = decode(raw)?.toUpperCase();
  return value !== undefined && AIRPORT_PATTERN.test(value) ? value : undefined;
}

/**
 * Reads the mode back out of a URL hash.
 *
 * Only amendment mode names itself, so a hash without an `m=` part, and one whose value this app
 * does not know, both open in clearance mode.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns The mode the hash asks for.
 */
export function modeFromHash(hash: string): Mode {
  return valueOf(hash, 'm') === 'amend' ? 'amendment' : 'clearance';
}

/**
 * Reads the input kind back out of a URL hash.
 *
 * Only typed answers name themselves, and a hash that names no input kind, or one this app does not
 * know, leaves it to the preference this browser remembers. A full route clearance is typed out, so
 * a hash asking for one names typed answers whether or not it carries an `i=` part of its own.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns `text` for an `i=text` or an `r=full` part, or `undefined` when the hash names no input
 *   kind it knows.
 */
export function inputKindFromHash(hash: string): InputKind | undefined {
  if (fullRouteFromHash(hash)) return 'text';
  return valueOf(hash, 'i') === 'text' ? 'text' : undefined;
}

/**
 * Reads the full route clearance back out of a URL hash.
 *
 * Only a full route clearance names itself, so a hash without an `r=` part, and one whose value
 * this app does not know, both open on the reading spoken on frequency.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns True for an `r=full` part, false for anything else.
 */
export function fullRouteFromHash(hash: string): boolean {
  return valueOf(hash, 'r') === 'full';
}

/**
 * Whether a hash asks for a filter at all, which a hash of nothing but a seed does not.
 *
 * The `a=` part names the airport rather than narrowing the draw, so it is not a filter part.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns True when the hash carries a `t=`, a `c=` or a `d=` part, whatever it says.
 */
export function hasFilterParams(hash: string): boolean {
  return partsOf(hash).some(
    (part) => part.startsWith('t=') || part.startsWith('c=') || part.startsWith('d='),
  );
}

/**
 * Whether one runway configuration is in the draw under a configuration filter.
 *
 * @param filter The configuration filter.
 * @param config The configuration to test.
 * @returns True when the filter admits the configuration.
 */
export function matchesConfig(filter: ConfigFilter, config: RunwayConfig): boolean {
  if (filter.kind === 'any') return true;
  return filter.kind === 'plan' ? config.plan === filter.plan : config.id === filter.id;
}
