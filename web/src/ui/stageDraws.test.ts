import { describe, expect, it, vi } from 'vitest';
import type { AirportData } from '@/data/schema.ts';
import type { ConfigFilter, Mode, SessionSettings } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import { airportLock, clampSettings, isOpenAt } from '@/scenario/stage.ts';
import { buildScenario, listAirports, loadAirportData } from '@/ui/session.ts';

/** The strip seeds every stage has to draw on; a set retries past a seed, New strip does not. */
const SEEDS = Array.from({ length: 30 }, (_value, index) => index + 1);

const MODES: readonly Mode[] = ['clearance', 'amendment'];

/** The settings of a student who narrowed nothing and wants everything. */
const WIDE_OPEN: SessionSettings = {
  filter: ANY_SCENARIO,
  mode: 'clearance',
  input: 'dropdowns',
  fullRoute: false,
  gradeRunway: true,
};

/** The stages an airport draws at, All topics last. */
function stagesOf(airport: AirportData): (string | undefined)[] {
  const { training } = airport;
  const lock = airportLock(training, airport.airport.icao);
  const ids = training.stages.map((stage) => stage.id);
  return [...ids.filter((stage) => isOpenAt(training, lock, stage)), undefined];
}

/** The configuration filters a student can pick at an airport: Any, each plan, each id. */
function configFiltersOf(airport: AirportData): ConfigFilter[] {
  const plans = new Set(airport.runwayConfigs.map((config) => config.plan));
  return [
    { kind: 'any' },
    ...[...plans].map((plan): ConfigFilter => ({ kind: 'plan', plan })),
    ...airport.runwayConfigs.map(({ id }): ConfigFilter => ({ kind: 'id', id })),
  ];
}

/** The filter's words in a failure line. */
function nameOf(config: ConfigFilter): string {
  if (config.kind === 'any') return 'any';
  return config.kind === 'plan' ? `plan:${config.plan}` : `id:${config.id}`;
}

/** One line per seed of a stage, mode and configuration filter that drew no strip. */
function failuresAt(
  airport: AirportData,
  stage: string | undefined,
  mode: Mode,
  config: ConfigFilter,
): string[] {
  const wanted = { ...WIDE_OPEN, mode, filter: { ...ANY_SCENARIO, config } };
  const settings = clampSettings(wanted, airport, stage);
  if (settings.mode !== mode || settings.filter.config.kind !== config.kind) return [];
  const where = `${airport.airport.icao} ${stage ?? 'All topics'} ${mode} ${nameOf(config)}`;
  return SEEDS.flatMap((seed) => {
    const view = buildScenario(airport, seed, settings.filter, mode);
    if (view.kind !== 'unresolved') return [];
    return [`${where} ${String(seed)} ${view.reasons.join('; ')}`];
  });
}

describe('the draws every stage opens', () => {
  it('draws a strip for every airport, stage, mode and seed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const airports = await Promise.all(
      listAirports().map(async (entry) => loadAirportData(entry.icao)),
    );
    const failures = airports.flatMap((airport) =>
      stagesOf(airport).flatMap((stage) =>
        MODES.flatMap((mode) =>
          configFiltersOf(airport).flatMap((config) => failuresAt(airport, stage, mode, config)),
        ),
      ),
    );
    expect(failures).toEqual([]);
  });
});
