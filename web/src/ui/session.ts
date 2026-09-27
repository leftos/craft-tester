import airportsIndexJson from '@data/airports.json';
import type { AirportData, AirportsIndex, Scenario } from '@/data/schema.ts';
import { parseAirport, parseAirportsIndex } from '@/data/load.ts';
import { resolveAmendedClearance } from '@/rules/amend/engine.ts';
import type { BoxAnswers, BoxElementGrade } from '@/rules/amend/grade.ts';
import { boxGradeAsGrade, gradeBoxes, studentPlan } from '@/rules/amend/grade.ts';
import type { Handling } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { citeSpecialHandling, gradeBest, hasSpecialHandling } from '@/rules/handling.ts';
import { speakClearance } from '@/rules/speak.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { ResolvedClearance, Unresolved } from '@/rules/types.ts';
import type { AmendmentScenario } from '@/scenario/amend.ts';
import { generateAmendmentScenario } from '@/scenario/amend.ts';
import type { Mode, ScenarioFilter } from '@/scenario/filter.ts';
import { generateScenario } from '@/scenario/generate.ts';
import { createRng } from '@/scenario/rng.ts';

/**
 * Every generated airport file, keyed by the path Vite resolved it from.
 *
 * The app is served as static files with no `data/` directory beside them, so the airport files are
 * bundled rather than fetched: the index is imported outright and each airport file is a chunk that
 * loads when the player picks that airport.
 */
const airportFiles = import.meta.glob<{ default: unknown }>([
  '@data/*.json',
  '!@data/airports.json',
]);

/**
 * What one seed produced: a clearance to grade, a plan to amend and then clear, or the reasons the
 * engine could not issue one.
 *
 * An amendment view carries the drawn plan with the amendments the engine raised for it, and the
 * clearance read for the corrected plan.
 */
export type ScenarioView =
  | { kind: 'clearance'; generated: Scenario; clearance: ResolvedClearance }
  | { kind: 'amendment'; drawn: AmendmentScenario; clearance: ResolvedClearance }
  | { kind: 'unresolved'; reasons: string[] };

/**
 * The airports the app can load, from the checked-in index.
 *
 * @returns The index of `data/airports.json`, validated against the schema.
 */
export function listAirports(): AirportsIndex {
  return parseAirportsIndex(airportsIndexJson);
}

/**
 * Loads one airport's generated data out of the bundle.
 *
 * @param icao The airport's ICAO identifier, e.g. `KSFO`.
 * @returns The validated airport data.
 * @throws Error When the index has no such airport, or its file was not bundled with the app.
 */
export async function loadAirportData(icao: string): Promise<AirportData> {
  const index = listAirports();
  const entry = index.find((candidate) => candidate.icao === icao);
  if (entry === undefined) {
    const known = index.map((candidate) => candidate.icao).join(', ');
    throw new Error(`airport ${icao} is not in airports.json; it lists ${known}`);
  }
  const path = Object.keys(airportFiles).find((key) => key.endsWith(`/${entry.file}`));
  const loader = path === undefined ? undefined : airportFiles[path];
  if (loader === undefined) {
    throw new Error(`data file ${entry.file} was not bundled with the app`);
  }
  return parseAirport((await loader()).default);
}

/** Renders a thrown value as the line the unresolved panel shows. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the elements an engine result answered none of as the lines the unresolved panel shows. */
function unresolvedView(unresolved: readonly Unresolved[]): ScenarioView {
  return {
    kind: 'unresolved',
    reasons: unresolved.map((item) => `${item.element}: ${item.reason}`),
  };
}

/**
 * The plan an amendment session clears once the strip is submitted, the clearance read for it, the
 * ZOA CPS-004 3.1 handling both were read under, and the box verdicts that decided that handling.
 */
export type ClearedPlan = {
  plan: Scenario;
  clearance: ResolvedClearance;
  handling: Handling;
  boxes: BoxElementGrade[];
};

/** A session that draws a plan to amend and then clear. */
type AmendmentView = Extract<ScenarioView, { kind: 'amendment' }>;

/** The plans already cleared for each amendment session, keyed by the box answers they came from. */
const clearedPlans = new WeakMap<AmendmentView, Map<string, ClearedPlan>>();

/** Joins the elements an engine result could not answer into one line for the console. */
function reasonsOf(unresolved: readonly Unresolved[]): string {
  return unresolved.map((item) => `${item.element}: ${item.reason}`).join('; ');
}

/**
 * The engine's own corrected plan and its clearance under a handling, which the session clears when
 * the student's plan does not resolve. The accepted corrected plan that does not resolve either falls
 * back to the proposed one, whose clearance the view already carries.
 */
function correctedPlan(
  view: AmendmentView,
  corrected: Scenario,
  handling: Handling,
  airport: AirportData,
): Pick<ClearedPlan, 'plan' | 'clearance' | 'handling'> {
  const proposed = { plan: view.drawn.result.corrected, clearance: view.clearance };
  if (handling === 'proposed') return { ...proposed, handling };
  const result = resolveAmendedClearance(view.drawn.filed, corrected, airport, handling);
  if (result.ok) return { plan: corrected, clearance: result.clearance, handling };
  console.warn(
    `the corrected plan did not resolve under the accepted handling (${reasonsOf(result.unresolved)}); ` +
      'clearing the proposed corrected plan instead',
  );
  return { ...proposed, handling: 'proposed' };
}

/** Resolves the plan the student clears, with no cache in front of it. */
function resolveClearedPlan(
  view: AmendmentView,
  answers: BoxAnswers,
  airport: AirportData,
): ClearedPlan {
  const { drawn } = view;
  const decided = gradeBest(
    drawn.result,
    drawn.acceptedResult,
    (result) => gradeBoxes(answers, result, drawn.filed, airport).map(boxGradeAsGrade),
    citeSpecialHandling(drawn.filed, airport),
  );
  const { handling, grades: boxes } = decided;
  const plan = studentPlan(answers, decided.resolved, drawn.filed, airport);
  const result = resolveAmendedClearance(drawn.filed, plan, airport, handling);
  if (result.ok) return { plan, clearance: result.clearance, handling, boxes };
  console.warn(
    `the student's corrected plan did not resolve (${reasonsOf(result.unresolved)}); clearing the ` +
      "engine's corrected plan instead",
  );
  return { ...correctedPlan(view, decided.resolved.corrected, handling, airport), boxes };
}

/**
 * The plan the student clears after the strip, and the clearance the engine reads for it.
 *
 * The boxes are graded against the amendments under both sides of ZOA CPS-004 3.1 special handling
 * (`gradeBest`), and the handling they are right under is fixed for the rest of the session: the plan
 * is corrected, and its clearance read, under that handling alone, so the clearance is never graded
 * against the other one. The plan is the filed plan with every box the student got right as they
 * wrote it and every other box as the engine corrected it, so the strip and the answer key agree and
 * a wrong box never compounds into the clearance. Where that plan does not resolve, the session
 * clears the engine's corrected plan instead and says so on the console.
 *
 * The result is cached per view and answers, so clearing the same answers again returns the same
 * object without resolving or warning again. The airport is not part of the key, because a view is
 * only ever built for, and cleared with, one airport.
 *
 * @param view The amendment session, with the plan as filed and the engine's corrections.
 * @param answers What the student answered for every box.
 * @param airport The airport data.
 * @returns The plan to clear and its clearance.
 */
export function clearedPlan(
  view: AmendmentView,
  answers: BoxAnswers,
  airport: AirportData,
): ClearedPlan {
  let byAnswers = clearedPlans.get(view);
  if (byAnswers === undefined) {
    byAnswers = new Map();
    clearedPlans.set(view, byAnswers);
  }
  const key = JSON.stringify([answers.type, answers.altitude, answers.route]);
  const cached = byAnswers.get(key);
  if (cached !== undefined) return cached;
  const cleared = resolveClearedPlan(view, answers, airport);
  byAnswers.set(key, cleared);
  return cleared;
}

/** Draws a plan that is already correct, and the clearance the SOP issues for it. */
function buildClearanceView(
  airport: AirportData,
  seed: number,
  filter: ScenarioFilter,
): ScenarioView {
  let generated: Scenario;
  try {
    generated = generateScenario(createRng(seed), airport, filter);
  } catch (error) {
    return { kind: 'unresolved', reasons: [reasonOf(error)] };
  }
  const result = resolveClearance(generated, airport, 'proposed');
  if (!result.ok) return unresolvedView(result.unresolved);
  return { kind: 'clearance', generated, clearance: result.clearance };
}

/**
 * The clearance a drawn plan earns under the accepted ZOA CPS-004 3.1 handling, which a clearance
 * answer is also graded against.
 *
 * @param scenario The drawn plan.
 * @param airport The airport data.
 * @returns The clearance, or null for a type CPS-004 3.1 does not list, and for a plan the accepted
 *   handling cannot resolve, which is then graded against the proposed clearance alone.
 */
export function acceptedClearance(
  scenario: Scenario,
  airport: AirportData,
): ResolvedClearance | null {
  if (!hasSpecialHandling(scenario, airport)) return null;
  const result = resolveClearance(scenario, airport, 'accepted');
  return result.ok ? result.clearance : null;
}

/** Draws a plan that needs amending, and the clearance read for it once it is corrected. */
function buildAmendmentView(
  airport: AirportData,
  seed: number,
  filter: ScenarioFilter,
): ScenarioView {
  let drawn: AmendmentScenario;
  try {
    drawn = generateAmendmentScenario(createRng(seed), airport, filter);
  } catch (error) {
    return { kind: 'unresolved', reasons: [reasonOf(error)] };
  }
  const result = resolveAmendedClearance(drawn.filed, drawn.result.corrected, airport, 'proposed');
  if (!result.ok) return unresolvedView(result.unresolved);
  return { kind: 'amendment', drawn, clearance: result.clearance };
}

/**
 * Draws the scenario one seed stands for and resolves the clearance the SOP issues for it.
 *
 * Clearance mode draws a plan that is already correct; amendment mode draws one with faults in it,
 * and the clearance it resolves is the one read for the plan the controller corrects it into.
 *
 * @param airport The airport data the scenario is drawn from.
 * @param seed The scenario seed, which the URL hash carries.
 * @param filter The time of day and runway configurations the draw is narrowed to.
 * @param mode Which half the session trains.
 * @returns The scenario with its clearance, or the reasons no clearance could be issued.
 */
export function buildScenario(
  airport: AirportData,
  seed: number,
  filter: ScenarioFilter,
  mode: Mode,
): ScenarioView {
  if (mode === 'amendment') return buildAmendmentView(airport, seed, filter);
  return buildClearanceView(airport, seed, filter);
}

/** The spoken name of a destination, falling back to its identifier. */
function destinationSpoken(icao: string, airport: AirportData): string {
  return airport.routeLibrary.destinations.find((row) => row.icao === icao)?.spoken ?? icao;
}

/** The transitions of the issued procedure; a clearance flown on the runway heading has none. */
function sidTransitionsOf(
  clearance: ResolvedClearance,
  airport: AirportData,
): readonly { fix: string; spoken: string }[] {
  const procedure = clearance.procedure.value;
  if (procedure.kind !== 'sid') return [];
  return airport.sids.find((sid) => sid.id === procedure.id)?.transitions ?? [];
}

/**
 * Reads a resolved clearance the way the reveal speaks it, abbreviated and with the full route.
 *
 * A clearance the engine built a route for is read for that route rather than for the plan: the
 * flight is issued a SID the plan never filed, and the reading hands the route over as filed at the
 * fix the built route and the filed one run together from.
 *
 * @param scenario The flight plan the clearance answers, which in amendment mode is the corrected
 *   plan rather than the one the pilot filed.
 * @param original The plan as the pilot filed it, which is what "as filed" hands the route over to.
 * @param clearance The clearance the engine resolved for it.
 * @param airport The airport data, for the telephony, the spoken fixes, and the SID's transitions.
 * @returns Both spoken forms of the clearance.
 */
export function spokenFor(
  scenario: Scenario,
  original: Scenario,
  clearance: ResolvedClearance,
  airport: AirportData,
): SpokenClearance {
  return speakClearance({
    callsign: scenario.callsign,
    clearance,
    destinationSpoken: destinationSpoken(scenario.destination, airport),
    filedRoute: clearance.route.value.builtRoute ?? scenario.filedRoute,
    originalRoute: original.filedRoute,
    airportFaa: airport.airport.faa,
    squawk: scenario.squawk,
    telephony: airport.routeLibrary.telephony,
    fixSpoken: airport.fixSpoken,
    sidTransitions: sidTransitionsOf(clearance, airport),
  });
}
