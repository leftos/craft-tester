import type { AirportData, AirportsIndex, RunwayConfig, Training } from '@/data/schema.ts';
import type { Procedure } from '@/rules/types.ts';
import type { ConfigFilter, ScenarioFilter, SessionSettings } from '@/scenario/filter.ts';

/** A stage as a viewer or a link names it: `undefined` is All topics. */
type Stage = string | undefined;

/** The settings a stage can narrow; everything else on the object passes through untouched. */
export type StagedSettings = Pick<SessionSettings, 'filter' | 'mode' | 'fullRoute' | 'gradeRunway'>;

/**
 * Whether a thing locked at one stage is open at another.
 *
 * A stage the airport file does not list reads as All topics, so an old link never fails.
 *
 * @param training The airport's training section.
 * @param at The stage the thing is locked at, or `undefined` when nothing locks it.
 * @param stage The stage asked about.
 * @returns True when the thing is open: at `at` itself and at every stage after it.
 */
export function isOpenAt(training: Training, at: string | undefined, stage: Stage): boolean {
  if (at === undefined || stage === undefined) return true;
  const ids = training.stages.map((entry) => entry.id);
  const reached = ids.indexOf(stage);
  return reached === -1 || ids.indexOf(at) <= reached;
}

/**
 * The stage a runway configuration opens at.
 *
 * @param training The airport's training section.
 * @param config The configuration.
 * @returns The `at` of the row naming its id, else of the row naming its plan, else `undefined`.
 */
export function configLock(training: Training, config: RunwayConfig): string | undefined {
  const rows = training.configs;
  const byId = rows.find((row) => 'id' in row && row.id === config.id);
  return (byId ?? rows.find((row) => 'plan' in row && row.plan === config.plan))?.at;
}

/**
 * The stage a SID family opens at.
 *
 * @param training The airport's training section.
 * @param family The SID family, e.g. `NIMI`.
 * @returns The `at` of the row naming the family, else the stage of every family no row names.
 */
export function sidLock(training: Training, family: string): string | undefined {
  return training.sids.find((row) => row.family === family)?.at ?? training.otherSids;
}

/**
 * The stage a departure runway opens at.
 *
 * @param training The airport's training section.
 * @param runway The runway, e.g. `33`.
 * @returns The `at` of the row naming the runway, or `undefined` when no row does.
 */
export function runwayLock(training: Training, runway: string): string | undefined {
  return training.runways.find((row) => row.runway === runway)?.at;
}

/**
 * The stage an airport itself opens at.
 *
 * @param training The training section of any airport: every file lists every airport.
 * @param icao The airport.
 * @returns The `at` of the row naming the airport, or `undefined` when no row does.
 */
export function airportLock(training: Training, icao: string): string | undefined {
  return training.airports.find((row) => row.airport === icao)?.at;
}

/**
 * The airport a viewer shut out of another lands on.
 *
 * @param index The airports the trainer lists.
 * @param training The training section of any airport.
 * @param stage The viewer's stage.
 * @returns The first airport of the index open at the stage, or `undefined` when none is.
 */
export function firstOpenAirport(
  index: AirportsIndex,
  training: Training,
  stage: Stage,
): string | undefined {
  return index.find((entry) => isOpenAt(training, airportLock(training, entry.icao), stage))?.icao;
}

/**
 * Whether a configuration filter leaves something to draw at a stage.
 *
 * A filter naming no configuration of the airport is not the stage's to judge: it stays as given,
 * and the draw reports it as it does with no stage.
 */
function configFilterOpen(airport: AirportData, filter: ConfigFilter, stage: Stage): boolean {
  if (filter.kind === 'any') return true;
  const named = airport.runwayConfigs.filter((config) =>
    filter.kind === 'plan' ? config.plan === filter.plan : config.id === filter.id,
  );
  return (
    named.length === 0 ||
    named.some((config) => isOpenAt(airport.training, configLock(airport.training, config), stage))
  );
}

/** A filter narrowed to a stage: the stage replaces the one it carried, and day and Any stand in. */
function stagedFilter(filter: ScenarioFilter, airport: AirportData, stage: Stage): ScenarioFilter {
  const { training } = airport;
  const { destination } = filter;
  return {
    time: isOpenAt(training, training.course.night, stage) ? filter.time : 'day',
    config: configFilterOpen(airport, filter.config, stage) ? filter.config : { kind: 'any' },
    ...(destination === undefined ? {} : { destination }),
    ...(stage === undefined ? {} : { stage }),
  };
}

/**
 * Settings narrowed to what a stage has opened, for a draw under that stage.
 *
 * Each locked value gives way to the nearest allowed one and every open value stays, so narrowing
 * the remembered settings loses nothing: they come back at a later stage or All topics. The input
 * kind is left alone, so a student who types keeps typing once Full route falls away.
 *
 * @param settings The settings to narrow.
 * @param airport The airport the draw runs at.
 * @param stage The stage, which the filter of the result carries; `undefined` removes it.
 * @returns The settings, with every member they came with.
 */
export function clampSettings<Settings extends StagedSettings>(
  settings: Settings,
  airport: AirportData,
  stage: Stage,
): Settings {
  const { course } = airport.training;
  const open = (at: string): boolean => isOpenAt(airport.training, at, stage);
  return {
    ...settings,
    filter: stagedFilter(settings.filter, airport, stage),
    mode: open(course.amendment) ? settings.mode : 'clearance',
    fullRoute: settings.fullRoute && open(course.fullRoute),
    gradeRunway: settings.gradeRunway && open(course.runway),
  };
}

/**
 * Why a clearance a draw resolved is still locked at a stage.
 *
 * The SOP engine picks the procedure, so what it picked can only be judged after the draw.
 *
 * @param procedure The cleared SID or heading.
 * @param runway The departure runway.
 * @param training The airport's training section.
 * @param stage The stage the draw runs under.
 * @returns The reason the draw has to go again, or `undefined` when everything in it is open.
 */
export function stageBlock(
  procedure: Procedure,
  runway: string,
  training: Training,
  stage: Stage,
): string | undefined {
  const isSid = procedure.kind === 'sid';
  const at = isSid ? sidLock(training, procedure.family) : training.noSid;
  if (!isOpenAt(training, at, stage)) {
    return `${isSid ? procedure.family : 'a departure with no SID'} opens at ${at ?? ''}`;
  }
  const runwayAt = runwayLock(training, runway);
  return isOpenAt(training, runwayAt, stage)
    ? undefined
    : `runway ${runway} opens at ${runwayAt ?? ''}`;
}
