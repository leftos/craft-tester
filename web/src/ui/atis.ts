import type { AirportData, Notice, RunwayConfig, Scenario } from '@/data/schema.ts';
import { el, rowList } from '@/ui/dom.ts';
import { timeLabel } from '@/ui/labels.ts';

/**
 * The operational notices in force for a scenario.
 *
 * A scenario that names no notices takes the ones the data marks as active by default, which is
 * what the engine does when it resolves the clearance.
 *
 * @param scenario The scenario, which may cancel the defaults by naming its own notices.
 * @param airport The airport data.
 * @returns The notices in force, in the order the data lists them.
 */
export function activeNotices(scenario: Scenario, airport: AirportData): Notice[] {
  const active = scenario.activeNotices;
  if (active === undefined) return airport.notices.filter((notice) => notice.defaultActive);
  return airport.notices.filter((notice) => active.includes(notice.id));
}

/**
 * The runways a configuration departs in normal use, which is what its ATIS advertises.
 *
 * A runway a class, an aircraft group or an airline departs by default, and one issued only to the
 * flights that ask for it, are all outside normal use: in 28/01 the ATIS advertises 1L and 1R, while 28R belongs to
 * the props it is the default for and the 28s belong to the oceanic, Far East and cargo flights
 * that request them. The exact runway a flight departs stays out of the ATIS, because picking it is
 * the student's job.
 *
 * @param config The runway configuration in force.
 * @returns The distinct runways in normal use, in the order the data lists them.
 */
export function advertisedRunways(config: RunwayConfig): string[] {
  const runways: string[] = [];
  for (const assignment of config.departureRunways) {
    if (
      assignment.onRequestFor.length > 0 ||
      assignment.defaultForClasses.length > 0 ||
      assignment.defaultForAirlines.length > 0 ||
      assignment.defaultForGroups.length > 0
    ) {
      continue;
    }
    if (!runways.includes(assignment.runway)) runways.push(assignment.runway);
  }
  return runways;
}

/**
 * The lines of the ATIS panel: the configuration, the runways in normal use, and the local time.
 *
 * @param scenario The scenario the ATIS describes.
 * @param airport The airport data, for the configuration's published name and departure runways.
 * @returns The label and value of every line.
 */
export function atisRows(
  scenario: Scenario,
  airport: AirportData,
): readonly (readonly [string, string])[] {
  const config = airport.runwayConfigs.find((row) => row.id === scenario.runwayConfigId);
  return [
    [
      'configuration',
      config === undefined ? scenario.runwayConfigId : `${config.id} — ${config.name}`,
    ],
    ['departing', config === undefined ? '—' : advertisedRunways(config).join(', ')],
    ['local time', timeLabel(scenario.localTime, scenario.dayOfWeek)],
  ];
}

/** The notices in force, as a list, or the line that says there are none. */
function noticeList(notices: readonly Notice[]): HTMLElement {
  if (notices.length === 0) return el('p', 'notice-none', 'No advisories in force.');
  const list = el('ul', 'notices');
  for (const notice of notices) {
    const item = el('li');
    item.append(el('span', 'notice-id', notice.id), el('span', 'notice-text', notice.text));
    list.append(item);
  }
  return list;
}

/** How many advisories are in force, in words: `No advisories`, `1 advisory`, `3 advisories`. */
function advisoryCount(count: number): string {
  if (count === 0) return 'No advisories';
  return count === 1 ? '1 advisory' : `${count} advisories`;
}

/**
 * The parts of the one-line ATIS summary a phone shows under the pinned strip: the configuration
 * id, the runways in normal use, the local time and how many advisories are in force.
 *
 * @param scenario The scenario the ATIS describes.
 * @param airport The airport data.
 * @returns The parts, in the order the line prints them, e.g.
 *   `['28 RT', 'Dep 28L 28R', '1246L Tuesday', '1 advisory']`.
 */
export function atisSummary(scenario: Scenario, airport: AirportData): string[] {
  const config = airport.runwayConfigs.find((row) => row.id === scenario.runwayConfigId);
  const departing = config === undefined ? '—' : advertisedRunways(config).join(' ');
  return [
    scenario.runwayConfigId,
    `Dep ${departing}`,
    timeLabel(scenario.localTime, scenario.dayOfWeek),
    advisoryCount(activeNotices(scenario, airport).length),
  ];
}

/** Whether the page is as wide as the desktop layout, where the ATIS opens in full. */
function wideScreen(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return true;
  return globalThis.matchMedia('(min-width: 900px)').matches;
}

/**
 * Renders the ATIS panel: one `<details>` whose summary is the one-line ATIS and whose body is the
 * full ATIS.
 *
 * It opens on a desktop, where the stylesheet hides the summary line, and stays closed on a phone,
 * where the summary line is all that shows under the pinned strip until it is tapped.
 *
 * @param scenario The scenario the ATIS describes.
 * @param airport The airport data.
 * @returns The ATIS panel.
 */
export function renderAtis(scenario: Scenario, airport: AirportData): HTMLElement {
  const panel = el('section', 'panel atis');
  const details = el('details', 'atis-details');
  details.open = wideScreen();
  const summary = el('summary', 'atis-summary');
  summary.append(el('b', '', 'ATIS'));
  for (const part of atisSummary(scenario, airport)) summary.append(el('span', '', part));
  details.append(
    summary,
    el('h2', '', 'ATIS'),
    rowList('atis-rows', atisRows(scenario, airport)),
    noticeList(activeNotices(scenario, airport)),
  );
  panel.append(details);
  return panel;
}
