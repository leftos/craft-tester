import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import type { Box } from '@/rules/amend/grade.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { isSidToken } from '@/rules/route.ts';
import type { AmendmentScenario, FaultKind } from '@/scenario/amend.ts';
import {
  FAULT_BOXES,
  drawAmendmentScenario,
  droppedTransition,
  generateAmendmentScenario,
} from '@/scenario/amend.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
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

/** The night draws off the 01s, the hour and the configuration the runway-heading flights live in. */
const HEADING_FILTER: ScenarioFilter = { time: 'night', config: { kind: 'id', id: '01/01' } };

/** The seeds the runway-heading draws are measured over. */
const HEADING_SEEDS = Array.from({ length: 200 }, (_value, index) => index);

const headingDrawn = HEADING_SEEDS.map((seed) =>
  generateAmendmentScenario(createRng(seed), ksfo, HEADING_FILTER),
);

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

/**
 * The draws whose corrected plan the engine would amend again, named with the seed that drew them.
 *
 * Nothing is left to amend on a plan every box of which was judged against the plan the strip will
 * read, so a draw that still raises a box is one whose boxes disagree with its own clearance.
 */
function amendedAgain(entries: readonly AmendmentScenario[], seeds: readonly number[]): string[] {
  return entries.flatMap((entry, index) => {
    const again = resolveAmendments(entry.result.corrected, ksfo);
    if (again.ok && again.amendments.length === 0) return [];
    const left = again.ok
      ? again.amendments.map((amendment) => amendment.box).join('+')
      : again.unresolved.map((gap) => gap.element).join('+');
    return [`seed ${seeds[index]}: ${label(entry)} => still ${left}`];
  });
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

/** The first draw across the seeds that carries one fault kind and nothing else. */
function onlyFault(kind: FaultKind): AmendmentScenario {
  const entry = drawn.find((row) => row.faults.length === 1 && row.faults[0] === kind);
  if (entry === undefined) {
    throw new Error(`no draw across ${SEEDS.length} seeds carries the ${kind} fault alone`);
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

/** The tokens of a route box, without the empty strings a doubled space would produce. */
function tokensIn(filedRoute: string): string[] {
  return filedRoute.split(' ').filter((token) => token.length > 0);
}

/** A hand-built plan, for driving one injector at a route the seeds do not draw. */
function plan(overrides: Partial<Scenario>): Scenario {
  return {
    callsign: 'UAL1',
    aircraftType: 'B738',
    equipmentSuffix: '/L',
    destination: 'KSEA',
    filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ8',
    filedAltitude: 34000,
    runwayConfigId: '28/01',
    departureRunway: '01R',
    localTime: '1400',
    dayOfWeek: 'tuesday',
    squawk: '1234',
    ...overrides,
  };
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

  it('leaves nothing to amend on the corrected plan', () => {
    expect(amendedAgain(drawn, SEEDS)).toEqual([]);
  });

  it('leaves nothing to amend on the corrected plan of a night draw off the 01s', () => {
    expect(amendedAgain(headingDrawn, HEADING_SEEDS)).toEqual([]);
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

  it('files a route with the transition after the procedure dropped', () => {
    const entry = firstWith('dropped_transition');
    const filed = tokensOf(entry);
    const corrected = tokensIn(entry.result.corrected.filedRoute);
    const restored = corrected[1];
    expect(restored, label(entry)).toBeDefined();
    expect(filed, label(entry)).not.toContain(restored);
    expect(amendmentFor(entry, 'route'), label(entry)).toBeDefined();
    expect(
      corrected.filter((_token, index) => index !== 1),
      label(entry),
    ).toEqual(filed);
    const family = headOf(entry).slice(0, -1);
    const forced = ksfo.assignmentRules.some(
      (row) => row.sidFamily === family && row.when?.forcedTransition === restored,
    );
    const connects = ksfo.routeConnections.some(
      (row) => row.from === restored && row.to === filed[1],
    );
    expect(forced || connects, label(entry)).toBe(true);
  });

  it('drops nothing where the second token is neither forced nor a connecting fix', () => {
    expect(droppedTransition(plan({ filedRoute: 'TRUKN2 DEDHD ENI' }), ksfo)).toBeUndefined();
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
    expect(suffix?.transponderModeC, label(entry)).toBe(true);
    expect(entry.filed.filedAltitude, label(entry)).toBeGreaterThanOrEqual(29000);
    expect(entry.filed.filedAltitude, label(entry)).toBeLessThanOrEqual(41000);
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

  it('files a suffix that reports no altitude, which the type box alone answers', () => {
    const entry = onlyFault('no_mode_c');
    const suffix = ksfo.equipmentSuffixes.find((row) => row.suffix === entry.filed.equipmentSuffix);
    expect(suffix, label(entry)).toBeDefined();
    expect(suffix?.transponderModeC, label(entry)).toBe(false);
    expect(raisedBoxes(entry), label(entry)).toEqual(['type']);
    expect(proposalFor(entry, 'type'), label(entry)).toMatch(
      new RegExp(`^${entry.filed.aircraftType}/[A-Z]$`),
    );
    expect(amendmentFor(entry, 'type')?.reason, label(entry)).toContain('Mode C');
  });

  it('files a non-RNAV suffix against an RNAV procedure', () => {
    const entry = firstWith('rnav_clash');
    const suffix = ksfo.equipmentSuffixes.find((row) => row.suffix === entry.filed.equipmentSuffix);
    expect(suffix?.rnav, label(entry)).toBe(false);
    expect(suffix?.transponderModeC, label(entry)).toBe(true);
    const sid = ksfo.sids.find((row) => row.id === headOf(entry));
    expect(sid?.rnavRequired, label(entry)).toBe(true);
    expect(proposalFor(entry, 'type'), label(entry)).toBeDefined();
    expect(proposalFor(entry, 'route'), label(entry)).toBeDefined();
  });
});
