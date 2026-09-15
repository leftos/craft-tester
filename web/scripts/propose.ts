import { readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AirportData, Fixture, Scenario } from '#src/data/schema.ts';
import type { SpokenClearance } from '#src/rules/speak.ts';
import type { ResolvedClearance, RuleCitation } from '#src/rules/types.ts';

/** The repository root, two levels above this script. */
const repoRoot = new URL('../../', import.meta.url);

/** Where the app's own modules live, for the import hook below. */
const srcDirectory = fileURLToPath(new URL('../src/', import.meta.url));

/** One CRAFT element as the proposal prints it. */
export type ProposalElement = {
  label: string;
  value: string;
  citations: readonly RuleCitation[];
};

/** What the engine made of a fixture: a clearance to propose, or the elements that blocked it. */
export type ProposalOutcome =
  | {
      kind: 'clearance';
      elements: readonly ProposalElement[];
      spoken: SpokenClearance;
      expected: unknown;
    }
  | { kind: 'unresolved'; reasons: readonly string[] };

/** Everything one proposal prints. */
export type ProposalView = {
  id: string;
  status: string;
  note: string | undefined;
  strip: readonly (readonly [string, string])[];
  outcome: ProposalOutcome;
};

/** One line of the `--pending` table. */
export type PendingRow = {
  id: string;
  sid: string;
  route: string;
  altitude: string;
  frequency: string;
  blocked: string | undefined;
};

/** Recursively sorts object keys so a pasted `expected` block matches the checked-in fixtures. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

/** Renders the engine's clearance as the `"expected": {…}` block a fixture pastes in. */
function expectedBlock(expected: unknown): string {
  const json = JSON.stringify(sortKeys(expected), null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');
  return `  "expected": ${json}`;
}

/**
 * Renders one proposal: the strip, the CRAFT elements with their citations, the spoken clearance,
 * and the fixture block.
 *
 * @param view The prepared proposal.
 * @returns The text the script prints, without a trailing newline.
 */
export function formatProposal(view: ProposalView): string {
  const lines = [`${view.id}  [${view.status}]`];
  if (view.note !== undefined) lines.push(`note: ${view.note}`);
  lines.push('', 'STRIP');
  for (const [label, value] of view.strip) lines.push(`  ${label.padEnd(12)} ${value}`);
  if (view.outcome.kind === 'unresolved') {
    lines.push('', 'UNRESOLVED');
    for (const reason of view.outcome.reasons) lines.push(`  ${reason}`);
    return lines.join('\n');
  }
  lines.push('', 'CRAFT');
  for (const element of view.outcome.elements) {
    lines.push(`  ${element.label.padEnd(12)} ${element.value}`);
    for (const citation of element.citations)
      lines.push(`       ${citation.id} — ${citation.text}`);
  }
  lines.push(
    '',
    'SPOKEN',
    `  abbreviated: ${view.outcome.spoken.abbreviated}`,
    `  full route:  ${view.outcome.spoken.fullRoute}`,
    '',
    'FIXTURE',
    expectedBlock(view.outcome.expected),
  );
  return lines.join('\n');
}

/** Renders one row of the `--pending` table. */
export function formatPendingLine(row: PendingRow): string {
  if (row.blocked !== undefined) return `${row.id.padEnd(38)} UNRESOLVED ${row.blocked}`;
  return [
    row.id.padEnd(38),
    row.sid.padEnd(7),
    row.route.padEnd(22),
    row.altitude.padEnd(36),
    row.frequency,
  ].join(' ');
}

/** The altitude element as it is spoken, e.g. "climb via SID except maintain 3000". */
function altitudePhrase(altitude: ResolvedClearance['altitude']['value']): string {
  if (altitude.phrase === 'climb_via') return 'climb via SID';
  const feet = altitude.feet ?? 0;
  return altitude.phrase === 'maintain'
    ? `maintain ${feet}`
    : `climb via SID except maintain ${feet}`;
}

/** The notices in force for a scenario, and whether they came from the scenario or the defaults. */
function noticeLine(scenario: Scenario, airport: AirportData): string {
  const source = scenario.activeNotices === undefined ? 'defaults' : 'scenario';
  const active =
    scenario.activeNotices ??
    airport.notices.filter((notice) => notice.defaultActive).map((notice) => notice.id);
  return active.length === 0 ? `none (${source})` : `${active.join(', ')} (${source})`;
}

/** The strip as label/value pairs. */
function stripLines(scenario: Scenario, airport: AirportData): (readonly [string, string])[] {
  const config = airport.runwayConfigs.find((row) => row.id === scenario.runwayConfigId);
  return [
    ['callsign', scenario.callsign],
    ['type', `${scenario.aircraftType} (${scenario.rnavCapable ? 'RNAV' : 'non-RNAV'})`],
    ['destination', scenario.destination],
    ['filed route', scenario.filedRoute],
    ['altitude', String(scenario.filedAltitude)],
    ['config', config === undefined ? scenario.runwayConfigId : `${config.id} — ${config.name}`],
    ['runway', scenario.departureRunway],
    ['time', `${scenario.localTime} ${scenario.dayOfWeek}`],
    ['squawk', scenario.squawk],
    ['notices', noticeLine(scenario, airport)],
  ];
}

/** The CRAFT elements of a resolved clearance, each with the rows that decided it. */
function craftElements(clearance: ResolvedClearance, runtime: Runtime): ProposalElement[] {
  const expect = clearance.expect.value;
  return [
    {
      label: 'C cleared to',
      value: clearance.clearedTo.value,
      citations: clearance.clearedTo.citations,
    },
    {
      label: 'R procedure',
      value: `${clearance.sid.value.spoken} departure (${clearance.sid.value.id})`,
      citations: clearance.sid.citations,
    },
    {
      label: 'R route',
      value: runtime.routeLabel(clearance.route.value),
      citations: clearance.route.citations,
    },
    {
      label: 'A altitude',
      value: altitudePhrase(clearance.altitude.value),
      citations: clearance.altitude.citations,
    },
    {
      label: 'A expect',
      value:
        expect === null
          ? 'none'
          : `expect ${expect.feet} ${expect.minutes} minutes after departure`,
      citations: clearance.expect.citations,
    },
    {
      label: 'F frequency',
      value: `${clearance.frequency.value.value} (${clearance.frequency.value.sectorId})`,
      citations: clearance.frequency.citations,
    },
  ];
}

/** Maps a leading `@/` specifier onto the app's source directory, which node cannot resolve. */
function registerAliasHook(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
      return nextResolve(pathToFileURL(`${srcDirectory}${specifier.slice(2)}`).href, context);
    },
  });
}

/** The app modules, imported after the alias hook is in place. */
async function loadRuntime() {
  const [schema, load, engine, types, speak, grade] = await Promise.all([
    import('#src/data/schema.ts'),
    import('#src/data/load.ts'),
    import('#src/rules/engine.ts'),
    import('#src/rules/types.ts'),
    import('#src/rules/speak.ts'),
    import('#src/rules/grade.ts'),
  ]);
  return { ...schema, ...load, ...engine, ...types, ...speak, ...grade };
}

/** Everything the CLI half needs from the app. */
type Runtime = Awaited<ReturnType<typeof loadRuntime>>;

/** Reads and parses one JSON file under the repository root. */
function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, repoRoot)), 'utf8'));
}

/** Loads the airport data the fixture's airport names, via the checked-in index. */
function loadAirportData(icao: string, runtime: Runtime): AirportData {
  const index = runtime.parseAirportsIndex(readJson('data/airports.json'));
  const entry = index.find((candidate) => candidate.icao === icao);
  if (entry === undefined) {
    throw new Error(`airport ${icao} is not in data/airports.json`);
  }
  return runtime.parseAirport(readJson(`data/${entry.file}`));
}

/** Every fixture under `fixtures/`, with the path it came from. */
function loadFixtures(runtime: Runtime): { path: string; fixture: Fixture }[] {
  const directory = fileURLToPath(new URL('fixtures/', repoRoot));
  return readdirSync(directory, { recursive: true })
    .map((entry) => String(entry).replaceAll('\\', '/'))
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => ({
      path: `fixtures/${entry}`,
      fixture: runtime.FixtureSchema.parse(readJson(`fixtures/${entry}`)),
    }));
}

/** The spoken name of a destination, falling back to its identifier. */
function destinationSpoken(icao: string, airport: AirportData): string {
  return airport.routeLibrary.destinations.find((row) => row.icao === icao)?.spoken ?? icao;
}

/** Runs the engine over a fixture and shapes the result for printing. */
function outcomeOf(fixture: Fixture, airport: AirportData, runtime: Runtime): ProposalOutcome {
  const result = runtime.resolveClearance(fixture.scenario, airport);
  if (!result.ok) {
    return {
      kind: 'unresolved',
      reasons: result.unresolved.map((item) => `${item.element}: ${item.reason}`),
    };
  }
  const { clearance } = result;
  return {
    kind: 'clearance',
    elements: craftElements(clearance, runtime),
    spoken: runtime.speakClearance({
      callsign: fixture.scenario.callsign,
      clearance,
      destinationSpoken: destinationSpoken(fixture.scenario.destination, airport),
      filedRoute: fixture.scenario.filedRoute,
      airportFaa: airport.airport.faa,
      squawk: fixture.scenario.squawk,
      telephony: airport.routeLibrary.telephony,
      fixSpoken: airport.fixSpoken,
      sidTransitions:
        airport.sids.find((sid) => sid.id === clearance.sid.value.id)?.transitions ?? [],
    }),
    expected: runtime.toExpectedClearance(clearance),
  };
}

/** Builds the `--pending` row for one fixture. */
function pendingRow(fixture: Fixture, outcome: ProposalOutcome): PendingRow {
  if (outcome.kind === 'unresolved') {
    return {
      id: fixture.id,
      sid: '',
      route: '',
      altitude: '',
      frequency: '',
      blocked: outcome.reasons.join('; '),
    };
  }
  const value = (label: string): string =>
    outcome.elements.find((element) => element.label === label)?.value ?? '';
  return {
    id: fixture.id,
    sid: value('R procedure').replace(/^.*\((\w+)\)$/, '$1'),
    route: value('R route'),
    altitude: value('A altitude'),
    frequency: value('F frequency'),
    blocked: undefined,
  };
}

/** Prints one fixture's proposal. */
function printProposal(entry: { path: string; fixture: Fixture }, runtime: Runtime): void {
  const airport = loadAirportData(entry.fixture.airport, runtime);
  console.log(
    formatProposal({
      id: entry.fixture.id,
      status: entry.fixture.status,
      note: entry.fixture.source.note,
      strip: stripLines(entry.fixture.scenario, airport),
      outcome: outcomeOf(entry.fixture, airport, runtime),
    }),
  );
}

/** Prints one line per pending fixture, so a batch review fits on a screen. */
function printPending(entries: readonly { fixture: Fixture }[], runtime: Runtime): void {
  const airports = new Map<string, AirportData>();
  const pending = entries.filter((entry) => entry.fixture.status === 'pending');
  for (const entry of pending) {
    const icao = entry.fixture.airport;
    const airport = airports.get(icao) ?? loadAirportData(icao, runtime);
    airports.set(icao, airport);
    console.log(
      formatPendingLine(pendingRow(entry.fixture, outcomeOf(entry.fixture, airport, runtime))),
    );
  }
  console.log(`${pending.length} pending fixtures`);
}

/** Finds a fixture by its id, its file name, or a path to it. */
function findFixture(
  entries: readonly { path: string; fixture: Fixture }[],
  target: string,
): { path: string; fixture: Fixture } | undefined {
  const wanted = target.replaceAll('\\', '/');
  return entries.find(
    (entry) =>
      entry.fixture.id === wanted ||
      entry.path === wanted ||
      entry.path.endsWith(`/${wanted}`) ||
      entry.path.endsWith(`/${wanted}.json`),
  );
}

/** Runs the CLI: one proposal, or the pending table. */
async function main(argv: readonly string[]): Promise<number> {
  const target = argv[0];
  if (target === undefined) {
    console.error('usage: node scripts/propose.ts <fixture-id-or-path> | --pending');
    return 1;
  }
  const runtime = await loadRuntime();
  const entries = loadFixtures(runtime);
  if (target === '--pending') {
    printPending(entries, runtime);
    return 0;
  }
  const entry = findFixture(entries, target);
  if (entry === undefined) {
    console.error(`no fixture matches "${target}"; ${entries.length} fixtures were scanned`);
    return 1;
  }
  printProposal(entry, runtime);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
  registerAliasHook();
  process.exitCode = await main(process.argv.slice(2));
}
