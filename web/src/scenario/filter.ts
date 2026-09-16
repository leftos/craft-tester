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

/** The hash part amendment mode writes; clearance mode writes none, so its links are unchanged. */
const AMENDMENT_PART = 'm=amend';

/** Which runway configurations a scenario may be drawn in: all of them, one plan, or exactly one. */
export type ConfigFilter =
  | { kind: 'any' }
  | { kind: 'plan'; plan: string }
  | { kind: 'id'; id: string };

/** What the player has narrowed the draw to; it rides in the URL hash beside the seed. */
export type ScenarioFilter = { time: TimeFilter; config: ConfigFilter };

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
 * A filter member that narrows nothing writes no part at all, so an unfiltered scenario shares the
 * same hash it always did.
 *
 * @param seed The seed the link restores.
 * @param filter The filter the draw ran under.
 * @param mode The half of the trainer the session runs; clearance mode writes no part at all.
 * @returns The hash, e.g. `#s=21i3v9&t=night&c=id:28%2F01&m=amend`.
 */
export function hashFor(seed: number, filter: ScenarioFilter, mode: Mode): string {
  const parts = [seedToHash(seed).slice(1)];
  if (filter.time !== 'either') parts.push(`t=${filter.time}`);
  const config = configParam(filter.config);
  if (config !== undefined) parts.push(`c=${config}`);
  if (mode === 'amendment') parts.push(AMENDMENT_PART);
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
 * Reads the filter back out of a URL hash.
 *
 * A value this app does not know narrows nothing rather than failing the load, so an old or
 * hand-edited link still opens on a scenario.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns The filter the hash asks for; every unreadable member falls back to `ANY_SCENARIO`'s.
 */
export function filterFromHash(hash: string): ScenarioFilter {
  return { time: timeOf(valueOf(hash, 't')), config: configOf(valueOf(hash, 'c')) };
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
 * Whether a hash asks for a filter at all, which a hash of nothing but a seed does not.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns True when the hash carries a `t=` or a `c=` part, whatever it says.
 */
export function hasFilterParams(hash: string): boolean {
  return partsOf(hash).some((part) => part.startsWith('t=') || part.startsWith('c='));
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
