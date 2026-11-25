import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { applyAmendment, resolveAmendments } from '@/rules/amend/engine.ts';
import type { AmendmentResult } from '@/rules/amend/types.ts';
import type { Handling } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { isSidToken } from '@/rules/route.ts';

const koak = koakJson as unknown as AirportData;
const ksfo = ksfoJson as unknown as AirportData;

/** The fields outside NorCal TRACON the route tool's rows are transcribed for. */
const DESTINATIONS = ['KAPC', 'KSTS', 'KCCR'];

/** The types filed, with the suffixes that cover a jet, a turboprop and pistons with and without RNAV. */
const TYPES = ['B738/L', 'DH8D/L', 'BE20/A', 'SR22/G', 'SR22/A'];

/** The local times filed: day, inside the 0100-0500 window, and inside the night noise windows only. */
const TIMES = ['1400', '0200', '2300'];

/** The two sides of ZOA CPS-004 3.1 special handling a plan is read under. */
const HANDLINGS: Handling[] = ['proposed', 'accepted'];

/** The most failures one run prints. */
const MAX_REPORTED = 20;

/** The fewest route amendments the sweep must re-check for the property to say anything. */
const MIN_CHECKED = 1000;

/** One filed plan and the handling it is read under, named for a failing assertion to point at. */
type Case = { airport: AirportData; flight: Scenario; handling: Handling; label: string };

/** What one case adds to the sweep: its failures, and whether it re-checked a route amendment. */
type Verdict = { failures: string[]; checked: boolean };

/** The route boxes filed for a tail: the tail alone, and the tail behind each SID flyable off the runway. */
function routesFor(tail: string, runway: string, airport: AirportData): string[] {
  const sids = airport.sids.filter((sid) => sid.runways.includes(runway)).map((sid) => sid.id);
  return [tail, ...sids.map((sid) => `${sid} ${tail}`)];
}

/** Every plan one airport files to one destination, off every runway of every configuration. */
function casesTo(airport: AirportData, destination: string): Case[] {
  const tails = airport.routeLibrary.routes
    .filter((row) => row.destination === destination)
    .map((row) => row.tail);
  const cases: Case[] = [];
  for (const config of airport.runwayConfigs) {
    const runways = [...new Set(config.departureRunways.map((row) => row.runway))];
    for (const runway of runways) {
      for (const filed of [...new Set(tails)].flatMap((tail) => routesFor(tail, runway, airport))) {
        cases.push(
          ...TYPES.flatMap((type) =>
            TIMES.flatMap((time) =>
              HANDLINGS.map((handling) =>
                planOf(
                  airport,
                  { type, destination, config: config.id, runway, filed, time },
                  handling,
                ),
              ),
            ),
          ),
        );
      }
    }
  }
  return cases;
}

/** The plan for one combination, with its label. */
function planOf(
  airport: AirportData,
  combo: {
    type: string;
    destination: string;
    config: string;
    runway: string;
    filed: string;
    time: string;
  },
  handling: Handling,
): Case {
  const [aircraftType = '', suffix = ''] = combo.type.split('/');
  const flight: Scenario = {
    callsign: 'N1',
    aircraftType,
    equipmentSuffix: `/${suffix}`,
    destination: combo.destination,
    filedRoute: combo.filed,
    filedAltitude: 5000,
    runwayConfigId: combo.config,
    departureRunway: combo.runway,
    localTime: combo.time,
    dayOfWeek: 'tuesday',
    squawk: '1234',
  };
  const where = `${combo.config} ${combo.runway} ${combo.time} ${handling}`;
  const label = `${airport.airport.icao} ${combo.type} ${where} ${combo.destination} "${combo.filed}"`;
  return { airport, flight, handling, label };
}

/** Whether a plan's clearance issues the SID its route box begins on, as a failure line. */
function sidMismatch(item: Case, plan: Scenario, what: string): string | undefined {
  const head = plan.filedRoute.split(' ')[0] ?? '';
  if (!isSidToken(head)) return undefined;
  const cleared = resolveClearance(plan, item.airport, item.handling);
  if (!cleared.ok) return `${item.label}: the ${what} has no clearance`;
  const procedure = cleared.clearance.procedure.value;
  const issued = procedure.kind === 'sid' ? procedure.id : 'a heading';
  return issued === head
    ? undefined
    : `${item.label}: the ${what} "${plan.filedRoute}" is cleared on ${issued}`;
}

/** What is wrong with a plan whose route box should need nothing, or `undefined` where it is a fixed point. */
function fixedPointFailure(item: Case, plan: Scenario, what: string): string | undefined {
  const again = resolveAmendments(plan, item.airport, item.handling);
  if (!again.ok) {
    const gaps = again.unresolved.map((gap) => gap.reason).join('; ');
    return `${item.label}: the ${what} "${plan.filedRoute}" is unresolved: ${gaps}`;
  }
  const reroute = again.amendments.find((amendment) => amendment.box === 'route');
  if (reroute?.box === 'route') {
    return `${item.label}: the ${what} "${plan.filedRoute}" is amended again to "${reroute.proposed}"`;
  }
  return sidMismatch(item, plan, what);
}

/**
 * The plans a result says need no further route amendment: the corrected plan; for a route box paired
 * with the type box, the filed plan with that side of the pair applied instead; and the corrected
 * plan filed with the box graded correct beside the expected one.
 */
function plansToCheck(
  item: Case,
  result: Extract<AmendmentResult, { ok: true }>,
): [string, Scenario][] {
  const plans: [string, Scenario][] = [];
  const route = result.amendments.find((amendment) => amendment.box === 'route');
  if (route !== undefined) plans.push(['corrected plan', result.corrected]);
  if (route?.alternativeTo !== undefined) {
    const side = result.amendments.filter(
      (amendment) => amendment.box !== 'type' || amendment.alternativeTo === undefined,
    );
    plans.push(['paired route side', side.reduce(applyAmendment, item.flight)]);
  }
  const also = result.routeAlsoCorrect;
  if (also !== undefined)
    plans.push(['also-correct plan', { ...result.corrected, filedRoute: also }]);
  return plans;
}

/** The sweep's verdict on one case. */
function verdict(item: Case): Verdict {
  const result = resolveAmendments(item.flight, item.airport, item.handling);
  if (!result.ok) return { failures: [], checked: false };
  const failures = plansToCheck(item, result)
    .map(([what, plan]) => fixedPointFailure(item, plan, what))
    .filter((line) => line !== undefined);
  return { failures, checked: result.amendments.some((amendment) => amendment.box === 'route') };
}

describe('the route box a route tool destination is amended to', () => {
  it('is a fixed point: every plan the result names needs no route amendment and is cleared on its SID', () => {
    const cases = [koak, ksfo].flatMap((airport) =>
      DESTINATIONS.filter((icao) =>
        airport.routeLibrary.destinations.some((row) => row.icao === icao),
      ).flatMap((icao) => casesTo(airport, icao)),
    );
    const verdicts = cases.map(verdict);
    const failures = verdicts.flatMap((item) => item.failures);
    const checked = verdicts.filter((item) => item.checked).length;
    expect(checked).toBeGreaterThanOrEqual(MIN_CHECKED);
    expect(
      failures.slice(0, MAX_REPORTED),
      `${failures.length} failures over ${checked} route amendments of ${cases.length} cases`,
    ).toEqual([]);
  });
});
