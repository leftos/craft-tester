// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AirportData } from '@/data/schema.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import type { HomeProps, HomeTestRow } from '@/ui/home.ts';
import { homeTestRows, renderHome } from '@/ui/home.ts';
import type { HomeChoices } from '@/ui/preferences.ts';
import { loadAirportData } from '@/ui/session.ts';
import type { SetListing, SetRecord } from '@/ui/testSet.ts';

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 8, 12);
const LINK_BASE = 'https://example.test/craft-tester/';

const CHOICES: HomeChoices = {
  icao: 'KOAK',
  mode: 'amendment',
  format: 'test',
  n: 10,
  minutes: 20,
};

let koak: AirportData;

beforeAll(async () => {
  koak = await loadAirportData('KOAK');
});

/** Home's props on KOAK, amend, a test of 10 strips in 20 minutes, picked from dropdowns. */
function props(overrides: Partial<HomeProps> = {}): HomeProps {
  return {
    airports: [
      { icao: 'KSFO', spoken: 'San Francisco' },
      { icao: 'KOAK', spoken: 'Oakland' },
    ],
    airport: koak,
    choices: CHOICES,
    answer: 'pick',
    filter: ANY_SCENARIO,
    tests: [],
    resume: undefined,
    offerTour: false,
    linkBase: LINK_BASE,
    onChoices: vi.fn(),
    onAnswer: vi.fn(),
    onFilter: vi.fn(),
    onDismissTour: vi.fn(),
    copy: vi.fn(),
    ...overrides,
  };
}

/** The one element a selector finds, failing the test where there is none. */
function find<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (node === null) throw new Error(`nothing matches ${selector}`);
  return node;
}

/** The Start link. */
function startLink(page: HTMLElement): HTMLAnchorElement {
  return find<HTMLAnchorElement>(page, 'a.button.primary.big');
}

describe('renderHome', () => {
  it('links Start to the test the choices describe, shows the link and copies it', () => {
    const copy = vi.fn();
    const page = renderHome(props({ copy }));
    const start = startLink(page);
    expect(start.getAttribute('href')).toBe('#/KOAK/amend/test/10x20');
    expect(start.textContent).toBe('Start test');
    const full = `${LINK_BASE}#/KOAK/amend/test/10x20`;
    expect(find(page, 'code.home-link').textContent).toBe(full);
    const button = [...page.querySelectorAll('button')].find(
      (node) => node.textContent === 'Copy link',
    );
    button?.click();
    expect(copy).toHaveBeenCalledWith(full);
  });

  it('carries typed answers and the time filter in the link', () => {
    const page = renderHome(props({ answer: 'type', filter: { ...ANY_SCENARIO, time: 'night' } }));
    expect(startLink(page).getAttribute('href')).toBe('#/KOAK/amend/test/10x20?t=night&i=text');
  });

  it('offers no strips or time for practice, and links Start to practice', () => {
    const page = renderHome(props({ choices: { ...CHOICES, format: 'practice' } }));
    expect(page.querySelector('[aria-label="Strips"]')).toBeNull();
    expect(page.querySelector('[aria-label="Time limit"]')).toBeNull();
    expect(startLink(page).getAttribute('href')).toBe('#/KOAK/amend/practice');
    expect(startLink(page).textContent).toBe('Start practice');
  });

  it('offers strips and time for a test', () => {
    const page = renderHome(props());
    expect(page.querySelector('[role="radiogroup"][aria-label="Strips"]')).not.toBeNull();
    expect(page.querySelector('[role="radiogroup"][aria-label="Time limit"]')).not.toBeNull();
  });

  it('links "Take the tour" in its bar to the tutorial', () => {
    const page = renderHome(props());
    const link = [...page.querySelectorAll('header.home-bar a')].find(
      (node) => node.textContent === 'Take the tour',
    );
    expect(link?.getAttribute('href')).toBe('#/tutorial');
  });

  it('offers the tour while it has not been seen, with the link that takes it', () => {
    const page = renderHome(props({ offerTour: true }));
    const card = find(page, '.home-tour-card');
    expect(card.textContent).toContain('New here?');
    const take = [...card.querySelectorAll('a')].find(
      (node) => node.textContent === 'Take the tour',
    );
    expect(take?.getAttribute('href')).toBe('#/tutorial');
    expect([...card.querySelectorAll('button')].map((node) => node.textContent)).toContain(
      'Not now',
    );
  });

  it('offers no tour card once the tour was seen', () => {
    expect(renderHome(props()).querySelector('.home-tour-card')).toBeNull();
  });

  it('takes the tour card out of the page when it is refused, calling back once', () => {
    const onDismissTour = vi.fn();
    const page = renderHome(props({ offerTour: true, onDismissTour }));
    const notNow = [...page.querySelectorAll('button')].find(
      (node) => node.textContent === 'Not now',
    );
    notNow?.click();
    expect(onDismissTour).toHaveBeenCalledTimes(1);
    expect(page.querySelector('.home-tour-card')).toBeNull();
  });

  it('marks the Test card of Format as the tour anchor, whichever format is chosen', () => {
    for (const format of ['test', 'practice'] as const) {
      const page = renderHome(props({ choices: { ...CHOICES, format } }));
      const anchors = [...page.querySelectorAll('[data-tour="home-test"]')];
      expect(anchors.map((node) => node.getAttribute('data-focus-key'))).toEqual(['Format:test']);
    }
  });

  it('picks another airport, keeping every other choice', () => {
    const onChoices = vi.fn();
    const page = renderHome(props({ onChoices }));
    find<HTMLButtonElement>(page, '[data-focus-key="Airport:KSFO"]').click();
    expect(onChoices).toHaveBeenCalledWith({ ...CHOICES, icao: 'KSFO' });
  });

  it('picks practice', () => {
    const onChoices = vi.fn();
    const page = renderHome(props({ onChoices }));
    find<HTMLButtonElement>(page, '[data-focus-key="Format:practice"]').click();
    expect(onChoices).toHaveBeenCalledWith({ ...CHOICES, format: 'practice' });
  });

  it('marks exactly the chosen card of each group', () => {
    const page = renderHome(props());
    const checked = (label: string): string[] =>
      [...page.querySelectorAll(`[aria-label="${label}"] .card[aria-checked="true"]`)].map(
        (node) => node.getAttribute('data-focus-key') ?? '',
      );
    expect(checked('Airport')).toEqual(['Airport:KOAK']);
    expect(checked('Mode')).toEqual(['Mode:amendment']);
    expect(checked('Format')).toEqual(['Format:test']);
  });

  it('offers the unfinished test back only when there is one', () => {
    const resume: HomeTestRow = {
      title: 'KSFO · Clearance · 10 strips, 20 min',
      status: '3 of 10 answered · 12:31 left',
      action: 'Continue',
      href: '#/KSFO/clearance/test/k3f9',
    };
    const page = renderHome(props({ resume }));
    const banner = find(page, '.home-resume');
    expect(banner.textContent).toContain(resume.title);
    expect(banner.textContent).toContain(resume.status);
    expect(find(banner, 'a').getAttribute('href')).toBe(resume.href);
    expect(renderHome(props()).querySelector('.home-resume')).toBeNull();
  });

  it('lists the tests only when there are some', () => {
    const row: HomeTestRow = {
      title: 'KOAK · Amend · 5 strips, untimed',
      status: '8 Oct',
      action: 'Results',
      href: '#/KOAK/amend/test/a',
    };
    const page = renderHome(props({ tests: [row] }));
    const link = find(page, '.home-tests li a');
    expect(link.textContent).toBe('Results');
    expect(link.getAttribute('href')).toBe(row.href);
    expect(renderHome(props()).querySelector('.home-tests')).toBeNull();
  });
});

describe('homeTestRows', () => {
  const record: SetRecord = {
    startedAt: START,
    minutes: 20,
    n: 10,
    icao: 'KOAK',
    mode: 'amendment',
    input: 'dropdowns',
    fullRoute: false,
    filter: ANY_SCENARIO,
    answered: [0, 1, 2],
    skipped: [],
    ended: false,
    endedAt: undefined,
  };

  /** One listing of the record above, with its members overridden. */
  function listing(overrides: Partial<SetRecord> = {}, setSeed = 42): SetListing {
    return { setSeed, record: { ...record, ...overrides } };
  }

  it('reads an unfinished timed set as how far it got and Continue', () => {
    const [row] = homeTestRows([listing()], START + 5 * MINUTE, () => undefined);
    expect(row).toEqual({
      title: 'KOAK · Amend · 10 strips, 20 min',
      status: '3 of 10 answered · 15:00 left',
      action: 'Continue',
      href: '#/KOAK/amend/test/16',
    });
  });

  it('reads an ended set as its day and score and Results', () => {
    const ended = listing({ ended: true, endedAt: START + 10 * MINUTE });
    const [row] = homeTestRows([ended], START + 60 * MINUTE, () => '91%');
    expect(row?.status).toBe('Oct 8 · 91%');
    expect(row?.action).toBe('Results');
  });

  it('reads a timed set past its deadline as Results, though it was never ended', () => {
    const [row] = homeTestRows([listing()], START + 21 * MINUTE, () => undefined);
    expect(row?.action).toBe('Results');
    expect(row?.status).toBe('Oct 8');
  });

  it('lists ten rows at most', () => {
    const listings = Array.from({ length: 12 }, (_, index) => listing({}, index));
    expect(homeTestRows(listings, START, () => undefined)).toHaveLength(10);
  });
});
