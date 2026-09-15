import type { AirportData, Notice, Scenario } from '@/data/schema.ts';
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
 * The lines of the ATIS panel: the configuration, the departure runway, and the local time.
 *
 * @param scenario The scenario the ATIS describes.
 * @param airport The airport data, for the configuration's published name.
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
    ['departing', scenario.departureRunway],
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

/**
 * Renders the ATIS panel.
 *
 * @param scenario The scenario the ATIS describes.
 * @param airport The airport data.
 * @returns The ATIS panel.
 */
export function renderAtis(scenario: Scenario, airport: AirportData): HTMLElement {
  const panel = el('section', 'panel atis');
  panel.append(
    el('h2', '', 'ATIS'),
    rowList('atis-rows', atisRows(scenario, airport)),
    noticeList(activeNotices(scenario, airport)),
  );
  return panel;
}
