import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { isSidToken } from '@/rules/route.ts';

const koak = koakJson as unknown as AirportData;
const ksfo = ksfoJson as unknown as AirportData;

/** The fields outside NorCal TRACON the route tool's rows are transcribed for. */
const DESTINATIONS = ['KAPC', 'KSTS', 'KCCR'];

/** The types filed, with the suffixes that cover a jet, a turboprop and pistons with and without RNAV. */
const TYPES = ['B738/L', 'DH8D/L', 'BE20/A', 'SR22/G', 'SR22/A'];

/** The most failures one run prints. */
const MAX_REPORTED = 20;

/** One filed plan, named for a failing assertion to point at. */
type Case = { airport: AirportData; flight: Scenario; label: string };

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
          ...TYPES.map((type) =>
            planOf(airport, { type, destination, config: config.id, runway, filed }),
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
  combo: { type: string; destination: string; config: string; runway: string; filed: string },
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
    localTime: '1400',
    dayOfWeek: 'tuesday',
    squawk: '1234',
  };
  const label = `${airport.airport.icao} ${combo.type} ${combo.config} ${combo.runway} ${combo.destination} "${combo.filed}"`;
  return { airport, flight, label };
}

/** Whether the corrected plan's clearance issues the SID its route box begins on, as a failure line. */
function sidMismatch(item: Case, corrected: Scenario): string | undefined {
  const head = corrected.filedRoute.split(' ')[0] ?? '';
  if (!isSidToken(head)) return undefined;
  const cleared = resolveClearance(corrected, item.airport, 'proposed');
  if (!cleared.ok) return `${item.label}: the corrected plan has no clearance`;
  const procedure = cleared.clearance.procedure.value;
  const issued = procedure.kind === 'sid' ? procedure.id : 'a heading';
  return issued === head
    ? undefined
    : `${item.label}: corrected box "${corrected.filedRoute}" but the clearance issues ${issued}`;
}

/** What is wrong with the plan a route amendment leaves, or `undefined` where it is a fixed point. */
function failure(item: Case): string | undefined {
  const result = resolveAmendments(item.flight, item.airport, 'proposed');
  if (!result.ok || !result.amendments.some((amendment) => amendment.box === 'route'))
    return undefined;
  const again = resolveAmendments(result.corrected, item.airport, 'proposed');
  if (!again.ok) {
    const gaps = again.unresolved.map((gap) => gap.reason).join('; ');
    return `${item.label}: the corrected plan "${result.corrected.filedRoute}" is unresolved: ${gaps}`;
  }
  const reroute = again.amendments.find((amendment) => amendment.box === 'route');
  if (reroute?.box === 'route') {
    return `${item.label}: the corrected plan "${result.corrected.filedRoute}" is amended again to "${reroute.proposed}"`;
  }
  return sidMismatch(item, result.corrected);
}

describe('the route box a route tool destination is amended to', () => {
  it('is a fixed point: the corrected plan needs no route amendment and is cleared on its SID', () => {
    const cases = [koak, ksfo].flatMap((airport) =>
      DESTINATIONS.filter((icao) =>
        airport.routeLibrary.destinations.some((row) => row.icao === icao),
      ).flatMap((icao) => casesTo(airport, icao)),
    );
    expect(cases.length).toBeGreaterThan(0);
    const failures = cases.map(failure).filter((line) => line !== undefined);
    expect(
      failures.slice(0, MAX_REPORTED),
      `${failures.length} of ${cases.length} cases fail`,
    ).toEqual([]);
  });
});
