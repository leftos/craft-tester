import type { AirportData } from '@/data/schema.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { settingsQuery } from '@/scenario/filter.ts';
import type { AnswerChoice } from '@/ui/answerChoice.ts';
import { ANSWER_OPTIONS } from '@/ui/answerChoice.ts';
import { button, el, segmentedControl } from '@/ui/dom.ts';
import { filterControls } from '@/ui/filterControls.ts';
import type { HomeChoices } from '@/ui/preferences.ts';
import type { PageRoute } from '@/ui/router.ts';
import { hrefOf } from '@/ui/router.ts';
import { MINUTE_OPTIONS, SIZE_OPTIONS } from '@/ui/testBar.ts';
import type { SetListing } from '@/ui/testSet.ts';
import { formatClock } from '@/ui/testSet.ts';
import type { TourAnchor } from '@/ui/tour.ts';

/** One airport home offers: its ICAO code and its spoken name, e.g. "Oakland". */
export type AirportCard = { icao: string; spoken: string };

/** One row of "Your tests": what the set was, how far it got, and the link that opens it. */
export type HomeTestRow = {
  title: string;
  status: string;
  action: 'Continue' | 'Results';
  href: string;
};

/** Everything home renders from, and what its controls call back into. */
export type HomeProps = {
  airports: readonly AirportCard[];
  /** The data of the airport chosen, which the configuration dropdown offers from. */
  airport: AirportData;
  choices: HomeChoices;
  answer: AnswerChoice;
  filter: ScenarioFilter;
  /** The sets this browser remembers, newest first. */
  tests: readonly HomeTestRow[];
  /** The newest unfinished set, or `undefined` when there is none. */
  resume: HomeTestRow | undefined;
  /** The page URL without its hash, which the shown link is written against. */
  linkBase: string;
  onChoices: (choices: HomeChoices) => void;
  onAnswer: (answer: AnswerChoice) => void;
  onFilter: (filter: ScenarioFilter) => void;
  copy: (text: string) => void;
};

/**
 * One card of a card group: the value it reads back, its heading, the line under it, and the tour
 * anchor it carries where a tour step points at it.
 */
type CardOption = { value: string; title: string; detail: string; anchor?: TourAnchor };

/** The most rows "Your tests" lists. */
const MAX_TEST_ROWS = 10;

/** Milliseconds in a minute. */
const MINUTE_MS = 60_000;

/** The line home opens with. */
const LEAD =
  'Practise IFR clearance delivery for Bay Area departures, graded against the ZOA SOPs.';

/** The two halves of the trainer, as home's cards offer them. */
const MODE_CARDS: readonly (CardOption & { value: HomeChoices['mode'] })[] = [
  { value: 'clearance', title: 'Clearance', detail: 'Read a plan that is already right' },
  { value: 'amendment', title: 'Amend', detail: 'Fix the strip, then clear it' },
];

/** Practice or a test, as home's cards offer them. */
const FORMAT_CARDS: readonly (CardOption & { value: HomeChoices['format'] })[] = [
  { value: 'practice', title: 'Practice', detail: 'One strip at a time, results after each' },
  {
    value: 'test',
    title: 'Test',
    detail: 'A set of strips, graded at the end',
    anchor: 'home-test',
  },
];

/**
 * A group of cards of which exactly one is chosen, read by a screen reader as a radio group under
 * the label. Each card carries the same `data-focus-key` a segmented control's button does, so a
 * page drawn again can put the focus back on it; picking the card already chosen calls nothing.
 */
function cardChoice(
  label: string,
  options: readonly CardOption[],
  value: string,
  onPick: (value: string) => void,
): HTMLElement {
  const group = el('div', 'cards');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const card = el('button', 'card');
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(option.value === value));
    card.setAttribute('data-focus-key', `${label}:${option.value}`);
    if (option.anchor !== undefined) card.dataset['tour'] = option.anchor;
    card.append(el('strong', '', option.title), el('span', 'card-detail', option.detail));
    card.addEventListener('click', () => {
      if (option.value !== value) onPick(option.value);
    });
    group.append(card);
  }
  return group;
}

/** One row of the choice grid: the word that names it, then its control. */
function gridRow(label: string, control: HTMLElement): HTMLElement[] {
  return [el('div', 'home-label', label), control];
}

/** The Format cards, with the test's Strips and Time under them while Test is chosen. */
function formatRow(props: HomeProps): HTMLElement {
  const { choices, onChoices } = props;
  const cell = el('div');
  cell.append(
    cardChoice('Format', FORMAT_CARDS, choices.format, (raw) => {
      onChoices({ ...choices, format: raw === 'practice' ? 'practice' : 'test' });
    }),
  );
  if (choices.format !== 'test') return cell;
  const sub = el('div', 'home-sub');
  const strips = segmentedControl(
    { label: 'Strips', options: SIZE_OPTIONS, value: String(choices.n) },
    (raw) => {
      onChoices({ ...choices, n: Number(raw) });
    },
  );
  const time = segmentedControl(
    { label: 'Time', options: MINUTE_OPTIONS, value: String(choices.minutes) },
    (raw) => {
      onChoices({ ...choices, minutes: Number(raw) });
    },
  );
  sub.append(el('span', '', 'Strips'), strips, el('span', '', 'Time'), time);
  cell.append(sub);
  return cell;
}

/** Answer by, with More options beside it holding the time and configuration filters. */
function answerRow(props: HomeProps): HTMLElement {
  const cell = el('div', 'home-answer');
  const answer = segmentedControl(
    { label: 'Answer by', options: ANSWER_OPTIONS, value: props.answer },
    (raw) => {
      props.onAnswer(ANSWER_OPTIONS.find((option) => option.value === raw)?.value ?? 'pick');
    },
  );
  const more = el('details', 'home-more');
  const filters = el('div', 'home-filters');
  filters.append(...filterControls(props.filter, props.airport, props.onFilter));
  more.append(el('summary', '', 'More options'), filters);
  cell.append(answer, more);
  return cell;
}

/** The grid of choices: Airport, Mode, Format, then Answer by. */
function choiceGrid(props: HomeProps): HTMLElement {
  const { choices, onChoices } = props;
  const airports = props.airports.map((airport) => ({
    value: airport.icao,
    title: airport.icao,
    detail: airport.spoken,
  }));
  const grid = el('div', 'home-grid');
  grid.append(
    ...gridRow(
      'Airport',
      cardChoice('Airport', airports, choices.icao, (icao) => {
        onChoices({ ...choices, icao });
      }),
    ),
    ...gridRow(
      'Mode',
      cardChoice('Mode', MODE_CARDS, choices.mode, (raw) => {
        onChoices({ ...choices, mode: raw === 'amendment' ? 'amendment' : 'clearance' });
      }),
    ),
    ...gridRow('Format', formatRow(props)),
    ...gridRow('Answer by', answerRow(props)),
  );
  return grid;
}

/** The link Start opens, from the choices and the settings; home never forces a destination. */
function startHref(props: HomeProps): string {
  const { time, config } = props.filter;
  const query = settingsQuery({
    filter: { time, config },
    input: props.answer === 'pick' ? 'dropdowns' : 'text',
    fullRoute: props.answer === 'full',
  });
  return hrefOf(startRoute(props.choices, query));
}

/** Start, the whole link it opens, and Copy link. */
function startRow(props: HomeProps): HTMLElement {
  const href = startHref(props);
  const link = props.linkBase + href;
  const row = el('div', 'home-start');
  const label = props.choices.format === 'practice' ? 'Start practice' : 'Start test';
  const start = el('a', 'button primary big', label);
  start.href = href;
  row.append(
    start,
    el('code', 'home-link', link),
    button('Copy link', 'secondary', () => {
      props.copy(link);
    }),
  );
  return row;
}

/** The banner that offers the newest unfinished set back. */
function resumeBanner(resume: HomeTestRow): HTMLElement {
  const banner = el('div', 'home-resume');
  const action = el('a', 'button primary', 'Continue');
  action.href = resume.href;
  banner.append(
    el('strong', '', 'Unfinished test'),
    el('span', '', resume.title),
    el('span', 'home-resume-status', resume.status),
    action,
  );
  return banner;
}

/** "Your tests": one row per remembered set, with the link that continues it or shows its results. */
function testList(tests: readonly HomeTestRow[]): HTMLElement {
  const section = el('section', 'home-tests');
  const list = el('ul');
  for (const test of tests) {
    const item = el('li');
    const action = el('a', '', test.action);
    action.href = test.href;
    item.append(
      el('span', 'home-test-title', test.title),
      el('span', 'muted', test.status),
      action,
    );
    list.append(item);
  }
  section.append(el('h2', '', 'Your tests'), list);
  return section;
}

/**
 * Renders home: the header with its link to the tour, the lead line, the unfinished set if there
 * is one, the choices, Start with the link it opens, and the sets this browser remembers.
 *
 * Nothing here holds state: every control calls back with the whole new value, and the caller draws
 * home again from it.
 *
 * @param props What home shows and what its controls call back into.
 * @returns The page, its header bar and its main column.
 */
export function renderHome(props: HomeProps): HTMLElement {
  const page = el('div', 'home-page');
  const bar = el('header', 'toolbar home-bar');
  const tour = el('a', 'home-tour', 'Take the tour');
  tour.href = hrefOf({ kind: 'tutorial', part: 'clearance' });
  bar.append(el('h1', 'brand', 'CRAFT trainer'), el('span', 'toolbar-spacer'), tour);
  const main = el('main', 'home');
  main.append(el('p', 'home-lead', LEAD));
  if (props.resume !== undefined) main.append(resumeBanner(props.resume));
  main.append(choiceGrid(props), startRow(props));
  if (props.tests.length > 0) main.append(testList(props.tests));
  page.append(bar, main);
  return page;
}

/** The moment a timed set runs out, or `undefined` for an untimed one. */
function deadlineOf(listing: SetListing): number | undefined {
  const { minutes, startedAt } = listing.record;
  return minutes === 0 ? undefined : startedAt + minutes * MINUTE_MS;
}

/** What a set was: the airport, the mode, the strip count and the time limit. */
function testTitle(listing: SetListing): string {
  const { icao, mode, n, minutes } = listing.record;
  const length = minutes === 0 ? 'untimed' : `${minutes} min`;
  return `${icao} · ${mode === 'amendment' ? 'Amend' : 'Clearance'} · ${n} strips, ${length}`;
}

/** How far an unfinished set got, and its time left when it is timed. */
function unfinishedStatus(listing: SetListing, now: number): string {
  const { answered, n } = listing.record;
  const deadline = deadlineOf(listing);
  const left = deadline === undefined ? '' : ` · ${formatClock(deadline - now)} left`;
  return `${answered.length} of ${n} answered${left}`;
}

/** The day a finished set ended, or started where it never ended, and its score where there is one. */
function finishedStatus(listing: SetListing, score: string | undefined): string {
  const { endedAt, startedAt } = listing.record;
  const date = new Date(endedAt ?? startedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  return score === undefined ? date : `${date} · ${score}`;
}

/** Whether a set is still running: not ended, strips left, and time left when it is timed. */
function isUnfinished(listing: SetListing, now: number): boolean {
  const { ended, answered, n } = listing.record;
  const deadline = deadlineOf(listing);
  return !ended && answered.length < n && (deadline === undefined || now < deadline);
}

/** One unfinished set as the row Continue offers it. */
function continueRow(listing: SetListing, now: number): HomeTestRow {
  const { icao, mode } = listing.record;
  return {
    title: testTitle(listing),
    status: unfinishedStatus(listing, now),
    action: 'Continue',
    href: hrefOf({ kind: 'continueTest', icao, mode, setSeed: listing.setSeed }),
  };
}

/** One set as a row of "Your tests". */
function testRow(
  listing: SetListing,
  now: number,
  scoreOf: (listing: SetListing) => string | undefined,
): HomeTestRow {
  if (isUnfinished(listing, now)) return continueRow(listing, now);
  const { icao, mode } = listing.record;
  return {
    title: testTitle(listing),
    status: finishedStatus(listing, scoreOf(listing)),
    action: 'Results',
    href: hrefOf({ kind: 'continueTest', icao, mode, setSeed: listing.setSeed }),
  };
}

/**
 * The rows of "Your tests", from the sets this browser remembers.
 *
 * A set is unfinished while it is not ended, has strips left, and, when timed, has time left; it
 * reads how far it got and Continue. Every other set reads the day it ended, its score where there is
 * one, and Results.
 *
 * @param listings The remembered sets, newest first.
 * @param now The time now, in epoch milliseconds.
 * @param scoreOf The score line of a finished set, or `undefined` where there is none to show.
 * @returns At most ten rows, in the order of the listings.
 */
export function homeTestRows(
  listings: readonly SetListing[],
  now: number,
  scoreOf: (listing: SetListing) => string | undefined,
): HomeTestRow[] {
  return listings.slice(0, MAX_TEST_ROWS).map((listing) => testRow(listing, now, scoreOf));
}

/**
 * The row Continue offers: the newest unfinished set of every one this browser remembers, which the
 * rows "Your tests" lists may stop short of.
 *
 * @param listings The remembered sets, newest first.
 * @param now The time now, in epoch milliseconds.
 * @returns The unfinished set's row, or `undefined` where every set is finished.
 */
export function continueTestRow(
  listings: readonly SetListing[],
  now: number,
): HomeTestRow | undefined {
  const unfinished = listings.find((listing) => isUnfinished(listing, now));
  return unfinished === undefined ? undefined : continueRow(unfinished, now);
}

/**
 * The route Start opens from home's choices: practice, or a new test of the chosen size and time.
 *
 * @param choices The airport, the mode, the format, and the test's size and time.
 * @param query The settings to carry after the path's `?`, or `''`.
 * @returns The practice or new test route.
 */
export function startRoute(choices: HomeChoices, query: string): PageRoute {
  const { icao, mode, n, minutes } = choices;
  return choices.format === 'practice'
    ? { kind: 'practice', icao, mode, query }
    : { kind: 'newTest', icao, mode, n, minutes, query };
}
