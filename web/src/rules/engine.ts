import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAltitude } from '@/rules/altitude.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import { classify } from '@/rules/classify.ts';
import { resolveFrequency } from '@/rules/frequency.ts';
import { flightDirection, parseFiledRoute } from '@/rules/route.ts';
import { phraseRoute } from '@/rules/routePhrasing.ts';
import { explainRunway } from '@/rules/runway.ts';
import { selectSid } from '@/rules/sidSelection.ts';
import type { EngineResult, Unresolved } from '@/rules/types.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

/** Wraps one blocked element as the engine's failure result. */
function blocked(reason: Unresolved): EngineResult {
  return { ok: false, unresolved: [reason] };
}

/**
 * Resolves the clearance for a scenario: classify, parse the route, select the SID, phrase the
 * route, resolve the altitude, read the departure frequency off the assignment row, and explain the
 * runway the flight departs from.
 *
 * Every element carries the data rows that decided it, including the operational notice that took
 * a SID out of use where one changed the outcome.
 *
 * @param scenario The filed flight plan and the conditions it is cleared under.
 * @param airport The airport data.
 * @returns The resolved clearance, or the element that blocked it with the reason.
 */
export function resolveClearance(scenario: Scenario, airport: AirportData): EngineResult {
  const ctx = classify(scenario, airport);
  if (isUnresolved(ctx)) return blocked(ctx);
  const route = parseFiledRoute(scenario.filedRoute, airport);
  if (isUnresolved(route)) return blocked(route);
  const direction = flightDirection(route, airport);
  const selection = selectSid(ctx, route.exitElement, direction, scenario, airport);
  if (isUnresolved(selection)) return blocked(selection);
  const altitude = resolveAltitude(ctx, selection.sid, scenario, airport);
  if (isUnresolved(altitude)) return blocked(altitude);
  const frequency = resolveFrequency(selection.row, airport);
  if (isUnresolved(frequency)) return blocked(frequency);
  const { sid } = selection;
  return {
    ok: true,
    clearance: {
      clearedTo: {
        value: scenario.destination,
        citations: citePhraseology(airport, 'C-DEST'),
      },
      runway: explainRunway(scenario, airport, ctx.aircraftClass, direction),
      sid: {
        value: { id: sid.id, family: sid.family, spoken: sid.spoken },
        citations: [toCitation(selection.row), ...selection.notices.map(toCitation)],
      },
      route: phraseRoute(sid, route.exitElement, airport),
      altitude: altitude.altitude,
      expect: altitude.expect,
      redundantExpect: altitude.redundantExpect,
      frequency,
    },
  };
}
