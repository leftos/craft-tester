import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData } from '@/data/schema.ts';
import type { Box } from '@/rules/amend/grade.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { isSidToken } from '@/rules/route.ts';
import type { AmendmentScenario, FaultKind } from '@/scenario/amend.ts';
import { FAULT_BOXES, drawAmendmentScenario, generateAmendmentScenario } from '@/scenario/amend.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import { createRng } from '@/scenario/rng.ts';

const ksfo = ksfoJson as unknown as AirportData;

/** The seeds the mix assertions are measured over; every one of them must draw a scenario. */
const SEEDS = Array.from({ length: 1000 }, (_value, index) => index + 1);

/** The module's own attempt cap, which the attempt counter must not outrun. */
const MAX_ATTEMPTS = 50;

/** The share of draws that must be correct as filed, low and high. */
const CLEAN_SHARE = { low: 0.12, high: 0.28 };

const drawn = SEEDS.map((seed) => generateAmendmentScenario(createRng(seed), ksfo, ANY_SCENARIO));

/** Every fault kind, read back from the box table the module exports. */
const FAULT_KINDS = Object.keys(FAULT_BOXES) as FaultKind[];

/** One line naming a draw, for a failing assertion to point at. */
function label(entry: AmendmentScenario): string {
  const faults = entry.faults.length === 0 ? 'no fault' : entry.faults.join('+');
  const boxes = entry.result.amendments.map((amendment) => amendment.box).join('+');
  return [
    `${entry.filed.callsign} ${entry.filed.aircraftType}${entry.filed.equipmentSuffix ?? ''}`,
    `${entry.filed.filedAltitude} "${entry.filed.filedRoute}" ${entry.filed.destination}`,
    `${faults} -> ${boxes.length === 0 ? 'no amendment' : boxes}`,
  ].join(' | ');
}

/** The boxes the engine raised an amendment for. */
function raisedBoxes(entry: AmendmentScenario): Box[] {
  return [...new Set(entry.result.amendments.map((amendment) => amendment.box))].sort();
}

/** The boxes the injected faults meant to make wrong. */
function intendedBoxes(entry: AmendmentScenario): Box[] {
  return [...new Set(entry.faults.flatMap((kind) => [...FAULT_BOXES[kind]]))].sort();
}

/** The amendment the engine raised for one box, where it raised one. */
function amendmentFor(entry: AmendmentScenario, box: Box): ResolvedAmendment | undefined {
  return entry.result.amendments.find((amendment) => amendment.box === box);
}

/** The value the engine proposes for the type or the route box, where it proposes one. */
function proposalFor(entry: AmendmentScenario, box: Box): string | undefined {
  const amendment = amendmentFor(entry, box);
  return amendment === undefined || amendment.box === 'altitude' ? undefined : amendment.proposed;
}

/** The first draw across the seeds that carries one fault kind. */
function firstWith(kind: FaultKind): AmendmentScenario {
  const entry = drawn.find((row) => row.faults.includes(kind));
  if (entry === undefined) {
    throw new Error(`no draw across ${SEEDS.length} seeds carries the ${kind} fault`);
  }
  return entry;
}

/** The tokens of a draw's route box. */
function tokensOf(entry: AmendmentScenario): string[] {
  return entry.filed.filedRoute.split(' ').filter((token) => token.length > 0);
}

/** The procedure token the route box files, which every fault but `no_sid` leaves in place. */
function headOf(entry: AmendmentScenario): string {
  return tokensOf(entry)[0] ?? '';
}

/** How many draws one seed threw away before the generator accepted one. */
function attemptsFor(seed: number): number {
  const rng = createRng(seed);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (!('rejected' in drawAmendmentScenario(rng, ksfo, ANY_SCENARIO))) return attempt;
  }
  throw new Error(`seed ${seed} drew nothing in ${MAX_ATTEMPTS} attempts`);
}

describe('generateAmendmentScenario', () => {
  it('draws a scenario for every seed', () => {
    expect(drawn).toHaveLength(SEEDS.length);
  });

  it('amends exactly the boxes the injected faults meant', () => {
    const mismatched = drawn
      .filter((entry) => raisedBoxes(entry).join('+') !== intendedBoxes(entry).join('+'))
      .map(label);
    expect(mismatched).toEqual([]);
  });

  it('never amends more than two boxes', () => {
    const overfull = drawn.filter((entry) => raisedBoxes(entry).length > 2).map(label);
    expect(overfull).toEqual([]);
  });

  it('leaves a plan drawn without faults correct as filed', () => {
    const clean = drawn.filter((entry) => entry.faults.length === 0);
    expect(clean.length).toBeGreaterThan(0);
    const amended = clean.filter((entry) => entry.result.amendments.length > 0).map(label);
    expect(amended).toEqual([]);
    for (const entry of clean) expect(entry.result.corrected).toEqual(entry.filed);
  });

  it('draws about a fifth of the plans correct as filed, and the rest with one or two faults', () => {
    const counts = drawn.map((entry) => entry.faults.length);
    const share = counts.filter((count) => count === 0).length / counts.length;
    expect(share).toBeGreaterThanOrEqual(CLEAN_SHARE.low);
    expect(share).toBeLessThanOrEqual(CLEAN_SHARE.high);
    expect(counts).toContain(1);
    expect(counts).toContain(2);
  });

  it('draws every fault kind across the seeds', () => {
    const seen = new Set(drawn.flatMap((entry) => entry.faults));
    expect(FAULT_KINDS.filter((kind) => !seen.has(kind))).toEqual([]);
  });

  it('draws the same scenario from the same seed', () => {
    expect(generateAmendmentScenario(createRng(42), ksfo, ANY_SCENARIO)).toEqual(
      generateAmendmentScenario(createRng(42), ksfo, ANY_SCENARIO),
    );
  });

  it('draws the RNAV clash alone, with its two boxes marked as alternatives', () => {
    const clashes = drawn.filter((entry) => entry.faults.includes('rnav_clash'));
    expect(clashes.length).toBeGreaterThan(0);
    for (const entry of clashes) {
      expect(entry.faults, label(entry)).toEqual(['rnav_clash']);
      expect(amendmentFor(entry, 'type')?.alternativeTo, label(entry)).toBe('route');
      expect(amendmentFor(entry, 'route')?.alternativeTo, label(entry)).toBe('type');
    }
  });

  it('reports the fault mix and how many draws it took', () => {
    const attempts = SEEDS.map(attemptsFor);
    const average = attempts.reduce((sum, count) => sum + count, 0) / attempts.length;
    const shares = FAULT_KINDS.map((kind) => {
      const share = drawn.filter((entry) => entry.faults.includes(kind)).length / drawn.length;
      return `${kind} ${(share * 100).toFixed(1)}%`;
    });
    const clean = drawn.filter((entry) => entry.faults.length === 0).length / drawn.length;
    console.log(
      `amendment draws: ${average.toFixed(2)} attempts per accepted draw; ` +
        `correct as filed ${(clean * 100).toFixed(1)}%; ${shares.join(', ')}`,
    );
    expect(average).toBeGreaterThanOrEqual(1);
    expect(average).toBeLessThan(MAX_ATTEMPTS);
  });
});

describe('fault injection', () => {
  it('files a stale version of a published procedure', () => {
    const entry = firstWith('stale_sid');
    const head = headOf(entry);
    expect(isSidToken(head), label(entry)).toBe(true);
    expect(ksfo.sids.map((sid) => sid.id)).not.toContain(head);
    expect(ksfo.sids.map((sid) => sid.family)).toContain(head.slice(0, -1));
    expect(proposalFor(entry, 'route'), label(entry)).toBeDefined();
  });

  it('files a published procedure of another family', () => {
    const entry = firstWith('other_sid');
    const head = headOf(entry);
    const sid = ksfo.sids.find((row) => row.id === head);
    expect(sid, label(entry)).toBeDefined();
    const suffix = ksfo.equipmentSuffixes.find((row) => row.suffix === entry.filed.equipmentSuffix);
    if (suffix?.rnav !== true) expect(sid?.rnavRequired, label(entry)).toBe(false);
    expect(proposalFor(entry, 'route'), label(entry)).not.toBe(entry.filed.filedRoute);
  });

  it('files no procedure at all', () => {
    const entry = firstWith('no_sid');
    expect(isSidToken(headOf(entry)), label(entry)).toBe(false);
    expect(proposalFor(entry, 'route'), label(entry)).toBeDefined();
  });

  it('files the route of another destination to a TEC destination', () => {
    const entry = firstWith('wrong_tec_route');
    const destination = ksfo.routeLibrary.destinations.find(
      (row) => row.icao === entry.filed.destination,
    );
    expect(destination?.nct, label(entry)).toBe(true);
    const tec = ksfo.tecRoutes.filter(
      (row) => row.kind === 'tec' && row.destination === entry.filed.destination,
    );
    expect(tec.length, label(entry)).toBeGreaterThan(0);
    const tail = tokensOf(entry).slice(1).join(' ');
    const filedTail = ksfo.routeLibrary.routes.filter((row) => row.tail === tail);
    expect(filedTail.length, label(entry)).toBeGreaterThan(0);
    expect(
      filedTail.some((row) => row.destination !== entry.filed.destination),
      label(entry),
    ).toBe(true);
  });

  it('files an altitude on the wrong half of the parity table', () => {
    const entry = firstWith('parity_flip');
    const filedForDestination = ksfo.routeLibrary.routes
      .filter((row) => row.destination === entry.filed.destination)
      .flatMap((row) => row.altitudes);
    expect(filedForDestination, label(entry)).toContain(entry.filed.filedAltitude - 1000);
    expect(amendmentFor(entry, 'altitude'), label(entry)).toBeDefined();
  });

  it('files a suffix without RVSM approval inside the band', () => {
    const entry = firstWith('non_rvsm_in_band');
    const suffix = ksfo.equipmentSuffixes.find((row) => row.suffix === entry.filed.equipmentSuffix);
    expect(suffix?.rvsm, label(entry)).toBe(false);
    expect(suffix?.rnav, label(entry)).toBe(true);
    expect(entry.filed.filedAltitude, label(entry)).toBeGreaterThanOrEqual(29000);
    expect(entry.filed.filedAltitude, label(entry)).toBeLessThanOrEqual(41000);
    expect(amendmentFor(entry, 'altitude'), label(entry)).toBeDefined();
  });

  it('files an altitude above the service ceiling of the type', () => {
    const entry = firstWith('above_ceiling');
    const fleet = ksfo.routeLibrary.fleet.find((row) => row.type === entry.filed.aircraftType);
    expect(fleet, label(entry)).toBeDefined();
    expect(entry.filed.filedAltitude, label(entry)).toBe((fleet?.ceilingFeet ?? 0) + 1000);
    expect(amendmentFor(entry, 'altitude'), label(entry)).toBeDefined();
  });

  it('files no equipment suffix', () => {
    const entry = firstWith('missing_suffix');
    expect(entry.filed.equipmentSuffix, label(entry)).toBeNull();
    expect(proposalFor(entry, 'type'), label(entry)).toMatch(
      new RegExp(`^${entry.filed.aircraftType}/[A-Z]$`),
    );
  });

  it('files a suffix the equipment table does not hold', () => {
    const entry = firstWith('unknown_suffix');
    const { equipmentSuffix } = entry.filed;
    expect(equipmentSuffix, label(entry)).toMatch(/^\/[A-Z]$/);
    expect(ksfo.equipmentSuffixes.map((row) => row.suffix)).not.toContain(equipmentSuffix);
    expect(proposalFor(entry, 'type'), label(entry)).toMatch(
      new RegExp(`^${entry.filed.aircraftType}/[A-Z]$`),
    );
  });

  it('files a non-RNAV suffix against an RNAV procedure', () => {
    const entry = firstWith('rnav_clash');
    const suffix = ksfo.equipmentSuffixes.find((row) => row.suffix === entry.filed.equipmentSuffix);
    expect(suffix?.rnav, label(entry)).toBe(false);
    const sid = ksfo.sids.find((row) => row.id === headOf(entry));
    expect(sid?.rnavRequired, label(entry)).toBe(true);
    expect(proposalFor(entry, 'type'), label(entry)).toBeDefined();
    expect(proposalFor(entry, 'route'), label(entry)).toBeDefined();
  });
});
