import type { AirportData, RouteTemplate, Sid } from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import type { Cited } from '@/rules/types.ts';

/** The phraseology row each route shape is spoken under. */
const TEMPLATE_RULE: Record<RouteTemplate, string> = {
  transition: 'R-TRANSITION',
  radar_vectors_fix: 'R-RV-SID',
  as_filed: 'R-AS-FILED',
};

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
 * Phrases the route element of the clearance for a SID and the fix the flight leaves on.
 *
 * @param sid The selected SID.
 * @param exitFix The fix the flight leaves the terminal on.
 * @param airport The airport data, for the phraseology toggles and the quotable rows.
 * @returns The route shape and the fix it speaks, with the phraseology row that decided it.
 */
export function phraseRoute(
  sid: Sid,
  exitFix: string,
  airport: AirportData,
): Cited<{ template: RouteTemplate; fix?: string }> {
  const template = routeTemplate(sid, exitFix, airport.phraseology.vectorHybridTransitionsSpoken);
  return {
    value: template === 'as_filed' ? { template } : { template, fix: exitFix },
    citations: citePhraseology(airport, TEMPLATE_RULE[template]),
  };
}
