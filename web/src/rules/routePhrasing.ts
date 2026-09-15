import type { AirportData, RouteTemplate, Sid } from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { isAirwayToken } from '@/rules/route.ts';
import type { Cited } from '@/rules/types.ts';

/** The phraseology row each route shape is spoken under. */
const TEMPLATE_RULE: Record<RouteTemplate, string> = {
  transition: 'R-TRANSITION',
  radar_vectors_fix: 'R-RV-SID',
  radar_vectors_airway: 'R-RV-AIRWAY',
  as_filed: 'R-AS-FILED',
};

/**
 * The route shape for a flight that leaves the terminal on an airway rather than on a fix.
 *
 * Only a SID that ends in vectors can put the flight on an airway, so the phrase is "radar vectors
 * to join (airway)"; a pilot-nav SID flies to its own fixes and never reaches this shape.
 */
function airwayTemplate(sid: Sid): RouteTemplate {
  const vectored = sid.kind === 'radar_vectors' || sid.kind === 'vector_hybrid';
  return vectored ? 'radar_vectors_airway' : 'as_filed';
}

/** Picks the route shape: published transition, radar vectors to the fix, or plain "as filed". */
function routeTemplate(sid: Sid, exitFix: string, vectorTransitionsSpoken: boolean): RouteTemplate {
  const transition = sid.transitions.find((entry) => entry.fix === exitFix);
  if (transition?.kind === 'enroute' && transition.spokenAsTransition) return 'transition';
  if (sid.kind === 'radar_vectors') return 'radar_vectors_fix';
  if (sid.kind !== 'vector_hybrid') return 'as_filed';
  return vectorTransitionsSpoken && transition?.kind === 'vector'
    ? 'transition'
    : sid.routePhrasing;
}

/**
 * Phrases the route element of the clearance for a SID and the element the flight leaves on.
 *
 * Every shape names what the flight leaves the terminal on, "as filed" included: a fix that is no
 * published transition is still spoken, bare, before "then as filed".
 *
 * @param sid The selected SID.
 * @param exitElement The fix, or the airway, the flight leaves the terminal on.
 * @param airport The airport data, for the phraseology toggles and the quotable rows.
 * @returns The route shape and the element it speaks, with the phraseology row that decided it.
 */
export function phraseRoute(
  sid: Sid,
  exitElement: string,
  airport: AirportData,
): Cited<{ template: RouteTemplate; fix?: string }> {
  const template = isAirwayToken(exitElement)
    ? airwayTemplate(sid)
    : routeTemplate(sid, exitElement, airport.phraseology.vectorHybridTransitionsSpoken);
  return {
    value: { template, fix: exitElement },
    citations: citePhraseology(airport, TEMPLATE_RULE[template]),
  };
}
