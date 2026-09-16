import { readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AirportData, Fixture, Scenario } from '#src/data/schema.ts';
import type { ResolvedAmendment } from '#src/rules/amend/types.ts';
import type { SpokenClearance } from '#src/rules/speak.ts';
import type { EngineResult, ResolvedClearance, RuleCitation } from '#src/rules/types.ts';

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

/** One amended strip box as the proposal prints it. */
export type ProposalAmendment = {
  box: string;
  proposed: string;
  reason: string;
  citations: readonly RuleCitation[];
};

/** The clearance half of an outcome, which amendment mode also prints for the corrected plan. */
export type ProposalClearance = {
  kind: 'clearance';
  elements: readonly ProposalElement[];
  spoken: SpokenClearance;
  expected: unknown;
};

/** The elements an engine could not resolve, with the reason each was blocked for. */
export type ProposalUnresolved = { kind: 'unresolved'; reasons: readonly string[] };

/**
 * What the engine made of a fixture: a clearance to propose, the boxes to amend, or the elements
 * that blocked it.
 *
 * An amendment outcome carries the clearance the corrected plan gets, which is the second half of
 * the exercise: amend the strip, then read the clearance for the plan as amended.
 */
export type ProposalOutcome =
  | ProposalClearance
  | ProposalUnresolved
  | {
      kind: 'amendments';
      amendments: readonly ProposalAmendment[];
      corrected: ProposalClearance | ProposalUnresolved;
      expected: unknown;
    };

/** Everything one proposal prints. */
export type ProposalView = {
  id: string;
  status: string;
  note: string | undefined;
  strip: readonly (readonly [string, string])[];
  outcome: ProposalOutcome;
};

/**
 * One line of the `--pending` table.
 *
 * `amendments` is set for an amendment-mode fixture, one entry per amended box, and is empty when
 * the plan is right as filed; the clearance columns are what a clearance-mode fixture fills.
 */
export type PendingRow = {
  id: string;
  sid: string;
  route: string;
  altitude: string;
  frequency: string;
  blocked: string | undefined;
  amendments?: readonly string[];
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

/** The CRAFT elements with their citations, and both spoken forms. */
function clearanceLines(outcome: ProposalClearance): string[] {
  const lines = ['', 'CRAFT'];
  for (const element of outcome.elements) {
    lines.push(`  ${element.label.padEnd(12)} ${element.value}`);
    for (const citation of element.citations)
      lines.push(`       ${citation.id} — ${citation.text}`);
  }
  lines.push(
    '',
    'SPOKEN',
    `  abbreviated: ${outcome.spoken.abbreviated}`,
    `  full route:  ${outcome.spoken.fullRoute}`,
  );
  return lines;
}

/** The elements that blocked an engine, one per line. */
function unresolvedLines(reasons: readonly string[]): string[] {
  return ['', 'UNRESOLVED', ...reasons.map((reason) => `  ${reason}`)];
}

/** The amended boxes, then the clearance the corrected plan gets. */
function amendmentLines(
  amendments: readonly ProposalAmendment[],
  corrected: ProposalClearance | ProposalUnresolved,
): string[] {
  const lines = ['', 'AMENDMENTS'];
  if (amendments.length === 0) lines.push('  none — the plan is correct as filed');
  for (const amendment of amendments) {
    lines.push(`  ${amendment.box.padEnd(12)} ${amendment.proposed}`);
    lines.push(`       ${amendment.reason}`);
    for (const citation of amendment.citations)
      lines.push(`       ${citation.id} — ${citation.text}`);
  }
  lines.push('', 'clearance for the corrected plan');
  const clearance =
    corrected.kind === 'unresolved'
      ? unresolvedLines(corrected.reasons)
      : clearanceLines(corrected);
  return [...lines, ...clearance];
}

/** Everything a proposal prints below the strip, which depends on what the engine made of it. */
function outcomeLines(outcome: ProposalOutcome): string[] {
  if (outcome.kind === 'unresolved') return unresolvedLines(outcome.reasons);
  if (outcome.kind === 'amendments') {
    return [
      ...amendmentLines(outcome.amendments, outcome.corrected),
      '',
      'FIXTURE',
      expectedBlock(outcome.expected),
    ];
  }
  return [...clearanceLines(outcome), '', 'FIXTURE', expectedBlock(outcome.expected)];
}

/**
 * Renders one proposal: the strip, then what the engine made of the plan — the CRAFT elements with
 * their citations and the spoken clearance, or the boxes to amend and the clearance the corrected
 * plan gets — and the fixture block.
 *
 * @param view The prepared proposal.
 * @returns The text the script prints, without a trailing newline.
 */
export function formatProposal(view: ProposalView): string {
  const lines = [`${view.id}  [${view.status}]`];
  if (view.note !== undefined) lines.push(`note: ${view.note}`);
  lines.push('', 'STRIP');
  for (const [label, value] of view.strip) lines.push(`  ${label.padEnd(12)} ${value}`);
  return [...lines, ...outcomeLines(view.outcome)].join('\n');
}

/** Renders one row of the `--pending` table. */
export function formatPendingLine(row: PendingRow): string {
  if (row.blocked !== undefined) return `${row.id.padEnd(38)} UNRESOLVED ${row.blocked}`;
  if (row.amendments !== undefined) {
    const boxes = row.amendments.length === 0 ? 'as filed' : row.amendments.join('  ');
    return `${row.id.padEnd(38)} ${boxes}`;
  }
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
  const rnav =
    airport.equipmentSuffixes.find((row) => row.suffix === scenario.equipmentSuffix)?.rnav ?? false;
  const type = `${scenario.aircraftType}${scenario.equipmentSuffix ?? ''}`;
  return [
    ['callsign', scenario.callsign],
    ['type', `${type} (${rnav ? 'RNAV' : 'non-RNAV'})`],
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

/**
 * The expect clause as the proposal reads it, naming the clause the chart publishes where the
 * clearance drops it for that reason, because speaking that one is acceptable rather than wrong.
 *
 * @param clearance The clearance the engine resolved.
 * @returns The line the `A expect` element reads.
 */
function expectValue(clearance: ResolvedClearance): string {
  const expect = clearance.expect.value;
  if (expect !== null) return `expect ${expect.feet} ${expect.minutes} minutes after departure`;
  const redundant = clearance.redundantExpect.value;
  if (redundant === null) return 'none';
  return `none (chart publishes ${redundant.minutes} minutes; speaking it is acceptable)`;
}

/** The CRAFT elements of a resolved clearance, each with the rows that decided it. */
function craftElements(clearance: ResolvedClearance, runtime: Runtime): ProposalElement[] {
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
      value: expectValue(clearance),
      citations: clearance.expect.citations,
    },
    {
      label: 'F frequency',
      value: `${clearance.frequency.value.value} (${clearance.frequency.value.sectorId})`,
      citations: clearance.frequency.citations,
    },
    {
      label: 'RWY runway',
      value: clearance.runway.value,
      citations: clearance.runway.citations,
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
  const [schema, load, engine, types, speak, grade, amend, amendTypes] = await Promise.all([
    import('#src/data/schema.ts'),
    import('#src/data/load.ts'),
    import('#src/rules/engine.ts'),
    import('#src/rules/types.ts'),
    import('#src/rules/speak.ts'),
    import('#src/rules/grade.ts'),
    import('#src/rules/amend/engine.ts'),
    import('#src/rules/amend/types.ts'),
  ]);
  return { ...schema, ...load, ...engine, ...types, ...speak, ...grade, ...amend, ...amendTypes };
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

/**
 * Shapes what the clearance engine made of a plan for printing.
 *
 * @param result What the engine answered for the plan.
 * @param scenario The plan the clearance is read for, which in amendment mode is the corrected plan.
 * @param original The plan as the pilot filed it, which is what "as filed" hands the route over to.
 * @param airport The airport data.
 * @param runtime The app modules the script speaks the clearance with.
 * @returns The clearance as the proposal prints it, or the elements that blocked it.
 */
function clearanceOutcome(
  result: EngineResult,
  scenario: Scenario,
  original: Scenario,
  airport: AirportData,
  runtime: Runtime,
): ProposalClearance | ProposalUnresolved {
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
      callsign: scenario.callsign,
      clearance,
      destinationSpoken: destinationSpoken(scenario.destination, airport),
      filedRoute: scenario.filedRoute,
      originalRoute: original.filedRoute,
      airportFaa: airport.airport.faa,
      squawk: scenario.squawk,
      telephony: airport.routeLibrary.telephony,
      fixSpoken: airport.fixSpoken,
      sidTransitions:
        airport.sids.find((sid) => sid.id === clearance.sid.value.id)?.transitions ?? [],
    }),
    expected: runtime.toExpectedClearance(clearance),
  };
}

/** The value an amended box takes, which for the altitude box is a number of feet. */
function proposedValue(amendment: ResolvedAmendment): string {
  return amendment.box === 'altitude' ? String(amendment.proposedFeet) : amendment.proposed;
}

/**
 * Runs the amendment engine over a plan, and the clearance engine over the corrected plan.
 *
 * The corrected plan's clearance is resolved the way the app resolves it, which is what carries the
 * amended expect clause and the rule an amended route is read under.
 */
function amendmentOutcome(
  scenario: Scenario,
  airport: AirportData,
  runtime: Runtime,
): ProposalOutcome {
  const result = runtime.resolveAmendments(scenario, airport);
  if (!result.ok) {
    return {
      kind: 'unresolved',
      reasons: result.unresolved.map((item) => `${item.element}: ${item.reason}`),
    };
  }
  return {
    kind: 'amendments',
    amendments: result.amendments.map((amendment) => ({
      box: amendment.box,
      proposed: proposedValue(amendment),
      reason: amendment.reason,
      citations: amendment.citations,
    })),
    corrected: clearanceOutcome(
      runtime.resolveAmendedClearance(scenario, result.corrected, airport),
      result.corrected,
      scenario,
      airport,
      runtime,
    ),
    expected: runtime.toExpectedAmendments(result),
  };
}

/** Runs the engine the fixture's mode names over it, and shapes the result for printing. */
function outcomeOf(fixture: Fixture, airport: AirportData, runtime: Runtime): ProposalOutcome {
  const { scenario } = fixture;
  if (fixture.mode === 'amendment') return amendmentOutcome(scenario, airport, runtime);
  return clearanceOutcome(
    runtime.resolveClearance(scenario, airport),
    scenario,
    scenario,
    airport,
    runtime,
  );
}

/** Builds the `--pending` row for one fixture. */
function pendingRow(fixture: Fixture, outcome: ProposalOutcome): PendingRow {
  const empty = { id: fixture.id, sid: '', route: '', altitude: '', frequency: '' };
  if (outcome.kind === 'unresolved') {
    return { ...empty, blocked: outcome.reasons.join('; ') };
  }
  if (outcome.kind === 'amendments') {
    return {
      ...empty,
      blocked: undefined,
      amendments: outcome.amendments.map((amendment) => `${amendment.box}=${amendment.proposed}`),
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
