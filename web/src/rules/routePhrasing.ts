import type { AirportData, RouteTemplate, Sid } from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { isAirwayToken } from '@/rules/route.ts';
import type { Cited, SelectedProcedure } from '@/rules/types.ts';

/** The phraseology row each route shape is spoken under. */
const TEMPLATE_RULE: Record<RouteTemplate, string> = {
  transition: 'R-TRANSITION',
  radar_vectors_fix: 'R-RV-SID',
  radar_vectors_airway: 'R-RV-AIRWAY',
  radar_vectors_direct: 'R-RV-DIRECT',
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
 * The shape a clearance with no DP takes: the one the airport publishes for a flight without one.
 *
 * A flight leaving the terminal on an airway takes the airway shape whatever put it on vectors, so
 * a clearance on the runway heading joins the airway exactly as a radar-vector SID does.
 */
function templateFor(
  procedure: SelectedProcedure,
  exitElement: string,
  airport: AirportData,
): RouteTemplate {
  if (procedure.kind === 'heading') {
    return isAirwayToken(exitElement) ? 'radar_vectors_airway' : airport.noSid.phrasing;
  }
  const { sid } = procedure;
  return isAirwayToken(exitElement)
    ? airwayTemplate(sid)
    : routeTemplate(sid, exitElement, airport.phraseology.vectorHybridTransitionsSpoken);
}

/**
 * The phraseology row a shape is spoken under, which a flight on the runway heading names for itself.
 *
 * The radar-vector shape is read under the row that says a flight without a procedure flies the
 * runway heading, rather than under the one whose text vectors a flight off a SID. The airway shape
 * is spoken the same way off a SID and off the heading, so it keeps its own row either way.
 */
function ruleFor(procedure: SelectedProcedure, template: RouteTemplate): string {
  if (procedure.kind === 'heading' && template === 'radar_vectors_fix') return 'R-HEADING';
  return TEMPLATE_RULE[template];
}

/**
 * Phrases the route element of the clearance for a procedure and the element the flight leaves on.
 *
 * Every shape names what the flight leaves the terminal on, "as filed" included: a fix that is no
 * published transition is still spoken, bare, before "then as filed". A flight cleared on the
 * runway heading has no chart to phrase from, so it takes the shape the airport's `noSid` row
 * publishes for a departure without a procedure, cited to the runway-heading row rather than to the
 * radar-vector SID row, or the airway shape where it leaves on an airway.
 *
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @param exitElement The fix, or the airway, the flight leaves the terminal on.
 * @param airport The airport data, for the phraseology toggles and the quotable rows.
 * @returns The route shape and the element it speaks, with the phraseology row that decided it.
 */
export function phraseRoute(
  procedure: SelectedProcedure,
  exitElement: string,
  airport: AirportData,
): Cited<{ template: RouteTemplate; fix?: string }> {
  const template = templateFor(procedure, exitElement, airport);
  return {
    value: { template, fix: exitElement },
    citations: citePhraseology(airport, ruleFor(procedure, template)),
  };
}

/**
 * Phrases the route element of a route that names nothing after its departure.
 *
 * A TEC route that ends in `RV`, and a radar-vector SID filed with nothing after the airport navaid,
 * leave the flight no fix to be vectored to: it is vectored straight to the destination, "radar
 * vectors direct", whatever the procedure or heading it departs on. The shape names no element.
 *
 * @param airport The airport data, for the quotable row.
 * @returns The route shape, with the phraseology row that decided it.
 */
export function phraseVectorsDirect(
  airport: AirportData,
): Cited<{ template: RouteTemplate; fix?: string }> {
  const template: RouteTemplate = 'radar_vectors_direct';
  return { value: { template }, citations: citePhraseology(airport, TEMPLATE_RULE[template]) };
}
