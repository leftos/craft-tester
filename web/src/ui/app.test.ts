// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputKind, Mode, SessionSettings } from '@/scenario/filter.ts';
import { ANY_SCENARIO, hashFor } from '@/scenario/filter.ts';
import { procedureOf } from '@/ui/amendPanels.ts';
import { clearancePickGrades, startApp, toolbarHiddenAfter } from '@/ui/app.ts';
import type { BoxAnswers } from '@/rules/amend/grade.ts';
import { headingPick } from '@/rules/grade.ts';
import type { PlayerPicks, ResolvedClearance } from '@/rules/types.ts';
import { selectOf, textAreaOf, textOf } from '@/ui/dom.ts';
import { buildScenario, clearedPlan, loadAirportData, spokenFor } from '@/ui/session.ts';
import { browserSolvedStore } from '@/ui/solved.ts';
import { picksProcedure, shareLink } from '@/ui/state.ts';
import { browserSetStore, setStripSeed } from '@/ui/testSet.ts';
import { CLEARANCE_TOUR, TOUR_STEPS_VERSION } from '@/ui/tourSteps.ts';

/**
 * The airport load one test holds open, so a link followed while the page is still loading has a
 * route to overtake.
 */
const heldLoad = vi.hoisted(() => {
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let refuse: ((reason: Error) => void) | undefined;
  let asked = false;
  return {
    /** Holds the next airport load, until `release` or `fail`; later loads run meanwhile. */
    hold(): void {
      asked = false;
      gate = new Promise<void>((resolve, reject) => {
        open = () => {
          resolve();
        };
        refuse = reject;
      });
    },
    /** Fails the held load, and lets every later one run. */
    fail(reason: Error): void {
      gate = undefined;
      refuse?.(reason);
      open = undefined;
      refuse = undefined;
    },
    /** Whether a load has reached the held gate. */
    asked(): boolean {
      return asked;
    },
    /** Lets the held load, and every later one, run. */
    release(): void {
      gate = undefined;
      open?.();
      open = undefined;
    },
    /** Waits at the gate while one is held, for the first load to reach it only. */
    async pass(): Promise<void> {
      const waiting = gate;
      if (waiting === undefined || asked) return;
      asked = true;
      await waiting;
    },
  };
});

vi.mock('@/ui/session.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/session.ts')>();
  return {
    ...actual,
    loadAirportData: async (icao: string) => {
      await heldLoad.pass();
      return actual.loadAirportData(icao);
    },
  };
});

/** A KSFO seed the amendment engine draws a plan to correct from. */
const AMENDMENT_SEED = 7;

/**
 * A KSFO seed whose plan the engine fixes in the type box, with a route amendment as the other side
 * of the pair: a B788 filed /U on SAHEY4, which the engine corrects to /L and a student may instead
 * put on GAPP7.
 */
const ALTERNATIVE_SEED = 593;

/** A KSFO seed clearance mode draws a clean clearance from. */
const CLEARANCE_SEED = 1;

/**
 * Mounts the app on an empty page at one seed, in the half of the trainer and the input kind the
 * hash names; the dropdowns leave the input kind out of the hash, as every link to them does.
 */
async function mountApp(seed: number, mode: Mode, input: InputKind): Promise<Element> {
  return mountSession(seed, {
    filter: ANY_SCENARIO,
    mode,
    input,
    fullRoute: false,
    gradeRunway: true,
  });
}

/** Mounts the app on an empty page at one seed, from the settings a link carries. */
async function mountSession(seed: number, settings: SessionSettings): Promise<Element> {
  return mountHash(hashFor('KSFO', seed, settings));
}

/** Mounts the app on an empty page from a hash written by hand. */
async function mountHash(hash: string): Promise<Element> {
  globalThis.location.hash = hash;
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  await startApp(root);
  return root;
}

/**
 * Waits for a check to pass. The bound is a hang guard: `vi.waitFor`'s default of a second is a limit
 * a passing run has to beat, and a first airport load on a loaded machine can take longer.
 */
function settled(check: () => void): Promise<void> {
  return vi.waitFor(check, { timeout: 180_000 });
}

/** One labelled control of the page, found by the label the student reads. */
function field(root: ParentNode, label: string): HTMLElement {
  const found = [...root.querySelectorAll('label.field')].find(
    (node) => node.querySelector('.field-label')?.textContent === label,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`the page has no ${label} control`);
  return found;
}

/** One box of the amend form, which holds its answer dropdown and the value it amends to. */
function boxOf(root: ParentNode, box: string): HTMLElement {
  const node = root.querySelector(`.amend-box.${box}`);
  if (!(node instanceof HTMLElement)) throw new Error(`the page has no ${box} box`);
  return node;
}

/** The answer dropdown of one box of the amend form. */
function answerOf(root: ParentNode, box: string): HTMLSelectElement {
  return selectOf(boxOf(root, box));
}

/** The text box one box of the amend form writes a new value in. */
function valueOf(root: ParentNode, box: string): HTMLInputElement {
  return textOf(field(boxOf(root, box), 'new value'));
}

/** The submit button of one panel. */
function submitOf(root: ParentNode, panel: string): HTMLButtonElement {
  const node = root.querySelector(`${panel} button.primary`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`${panel} has no submit button`);
  return node;
}

/** A segmented control of the toolbar, found by the name a screen reader reads it by. */
function segmentGroup(root: ParentNode, group: string): HTMLElement {
  const found = [...root.querySelectorAll('[role="radiogroup"]')].find(
    (node) => node.getAttribute('aria-label') === group,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`the page has no ${group} switch`);
  return found;
}

/** One option of a segmented control of the toolbar, found by its group and the word on it. */
function segment(root: ParentNode, group: string, option: string): HTMLButtonElement {
  const found = [...segmentGroup(root, group).querySelectorAll('button[role="radio"]')].find(
    (node) => node.textContent === option,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${group} offers no ${option}`);
  return found;
}

/** The word on the option a segmented control of the toolbar has chosen. */
function chosen(root: ParentNode, group: string): string {
  const node = segmentGroup(root, group).querySelector('[aria-checked="true"]');
  return node?.textContent ?? '';
}

/** Picks one choice of a dropdown, the way the browser reports a choice the student made. */
function choose(node: HTMLSelectElement, value: string): void {
  node.value = value;
  node.dispatchEvent(new Event('change'));
}

/** The first choice a dropdown offers after its blank one. */
function firstChoice(node: HTMLSelectElement): string {
  const option = node.options[1];
  if (option === undefined) throw new Error('the dropdown offers nothing to pick');
  return option.value;
}

/** The typing box the clearance is typed into. */
function clearanceBox(root: ParentNode): HTMLTextAreaElement {
  return textAreaOf(field(root, 'clearance'));
}

/** Types into a box, the way the browser reports what the box now holds. */
function typeInto(node: HTMLTextAreaElement, text: string): void {
  node.value = text;
  node.dispatchEvent(new Event('input'));
}

/** Presses Enter in a box. */
function pressEnter(node: HTMLTextAreaElement): void {
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
}

/** The button of the page that reads one word. */
function buttonNamed(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((node) => node.textContent === label);
  if (found === undefined) throw new Error(`the page has no ${label} button`);
  return found;
}

/** The seed part of a hash, e.g. `s=21i3v9`. */
function seedPartOf(hash: string): string | undefined {
  return hash.split(/[#&]/).find((part) => part.startsWith('s='));
}

/** The strip panel the page titles with one heading. */
function stripTitled(root: ParentNode, heading: string): HTMLElement {
  const found = [...root.querySelectorAll('section.panel.strip')].find(
    (node) => node.querySelector('h2')?.textContent === heading,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`the page has no ${heading} strip`);
  return found;
}

/** The remarks cell of a strip, empty where the strip prints none. */
function remarksOf(strip: ParentNode): string {
  return strip.querySelector('.strip-remarks')?.textContent ?? '';
}

/**
 * A KSFO clearance seed whose route reads two ways, with the reading spoken on frequency.
 *
 * Most plans read the same either way — a route the SID covers to its end has nothing left to hand
 * over as filed — so the seed the full route clearance is checked on is the first one that does
 * differ rather than a number written down here.
 */
async function twoWaySeed(): Promise<{ seed: number; abbreviated: string }> {
  const airport = await loadAirportData('KSFO');
  for (let seed = 1; seed <= 60; seed += 1) {
    const view = buildScenario(airport, seed, ANY_SCENARIO, 'clearance');
    if (view.kind !== 'clearance') continue;
    const spoken = spokenFor(view.generated, view.generated, view.clearance, airport);
    if (spoken.fullRoute !== spoken.abbreviated) return { seed, abbreviated: spoken.abbreviated };
  }
  throw new Error('no KSFO clearance seed up to 60 reads its route two ways');
}

/** The remark a route handed over as filed leaves on a clearance the student reads in full. */
const FRC_REMARK = '"then as filed" said on a full route clearance — read the route to its end';

/** The strip left exactly as filed, which is what `clearTheStrip` answers. */
const AS_FILED: BoxAnswers = {
  type: { kind: 'as_filed' },
  altitude: { kind: 'as_filed' },
  route: { kind: 'as_filed' },
};

/**
 * A KSFO amendment seed whose plan, cleared as filed, reads its route two ways, with the reading
 * spoken on frequency.
 */
async function twoWayAmendment(): Promise<{ seed: number; abbreviated: string }> {
  const airport = await loadAirportData('KSFO');
  for (let seed = 1; seed <= 60; seed += 1) {
    const view = buildScenario(airport, seed, ANY_SCENARIO, 'amendment');
    if (view.kind !== 'amendment') continue;
    const cleared = clearedPlan(view, AS_FILED, airport);
    const spoken = spokenFor(cleared.plan, view.drawn.filed, cleared.clearance, airport);
    if (spoken.fullRoute !== spoken.abbreviated) return { seed, abbreviated: spoken.abbreviated };
  }
  throw new Error('no KSFO amendment seed up to 60 reads its route two ways');
}

/** Answers every box as filed and submits the strip, which opens the form on the corrected plan. */
function clearTheStrip(root: Element): void {
  for (const box of ['type', 'altitude', 'route']) choose(answerOf(root, box), 'as_filed');
  submitOf(root, '.panel.amend').click();
}

/**
 * Runs before every other test in the file, so no airport of the index has been loaded yet when the
 * first route is held open.
 */
describe('the first route', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem(TOUR_SEEN_KEY, 'true');
  });

  afterEach(() => {
    heldLoad.release();
    vi.restoreAllMocks();
  });

  // First in the file: a failed load is not cached, and the tutorial loads KOAK alone, so KSFO is
  // still unloaded for the next test's held load.
  it('keeps the page a newer link opened when the first strip fails to load', async () => {
    globalThis.location.hash = '#s=1&a=KSFO';
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    heldLoad.hold();

    const started = startApp(root);
    await settled(() => {
      expect(heldLoad.asked()).toBe(true);
    });

    followLink('#/tutorial');
    heldLoad.fail(new Error('the airport file did not load'));
    await expect(started).resolves.toBeUndefined();

    await settled(() => {
      expect(root.textContent).toContain('SWA1740');
    });
    expect(root.textContent).not.toContain("couldn't load");
  });

  it('opens the link followed while the first strip is still loading, and keeps its hash', async () => {
    globalThis.location.hash = '#s=1&a=KSFO';
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    heldLoad.hold();

    const started = startApp(root);
    await settled(() => {
      expect(heldLoad.asked()).toBe(true);
    });

    followLink('#/');
    heldLoad.release();
    await started;

    await settled(() => {
      expect(root.querySelector('.home-page')).not.toBeNull();
    });
    expect(globalThis.location.hash).toBe('#/');
  });
});

describe('the mounted page', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says a strip could not be loaded, without the engine reason behind it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = await mountHash('#s=1&a=KOAK&d=KXXX');
    expect(root.textContent).toContain("Couldn't load a strip");
    expect(root.textContent).not.toContain('KXXX');
    expect(root.textContent).not.toContain('route library');
  });

  it('keeps the text box the student is typing in', async () => {
    const root = await mountApp(AMENDMENT_SEED, 'amendment', 'dropdowns');
    choose(answerOf(root, 'route'), 'amended');
    const input = valueOf(root, 'route');
    expect(input.disabled).toBe(false);
    input.focus();

    input.value = 'TRUKN2 DEDHD';
    input.dispatchEvent(new Event('input'));

    expect(valueOf(root, 'route')).toBe(input);
    expect(input.value).toBe('TRUKN2 DEDHD');
    expect(document.activeElement).toBe(input);
  });

  it('writes an answer into the box it was made in', async () => {
    const root = await mountApp(AMENDMENT_SEED, 'amendment', 'dropdowns');
    const answer = answerOf(root, 'route');
    const input = valueOf(root, 'route');
    expect(input.disabled).toBe(true);

    choose(answer, 'amended');

    expect(answerOf(root, 'route')).toBe(answer);
    expect(input.disabled).toBe(false);
    expect(input.value.length).toBeGreaterThan(0);
    expect(submitOf(root, '.panel.amend').disabled).toBe(true);
  });

  it('builds the panels again when the strip is submitted', async () => {
    const root = await mountApp(AMENDMENT_SEED, 'amendment', 'dropdowns');
    const amend = root.querySelector('.panel.amend');
    expect(amend).not.toBeNull();
    expect(root.querySelector('.panel.craft')).toBeNull();

    clearTheStrip(root);

    expect(root.querySelector('.panel.amend')).toBeNull();
    expect(root.querySelector('.panel.craft')).not.toBeNull();
  });

  it('writes a pick into the dropdowns the form already built', async () => {
    const root = await mountApp(AMENDMENT_SEED, 'amendment', 'dropdowns');
    clearTheStrip(root);
    const shape = selectOf(field(root, 'route phrase'));
    const element = selectOf(field(root, 'fix or airway'));
    expect(element.disabled).toBe(true);
    const template = firstChoice(shape);

    choose(shape, template);

    expect(selectOf(field(root, 'route phrase'))).toBe(shape);
    expect(shape.value).toBe(template);
    expect(element.disabled).toBe(false);
  });

  it('switches to typing on the same seed and remembers it', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    const seedPart = seedPartOf(globalThis.location.hash);
    expect(seedPart).toBeDefined();
    expect(globalThis.location.hash).not.toContain('i=text');

    segment(root, 'Answer by', 'Type').click();

    expect(seedPartOf(globalThis.location.hash)).toBe(seedPart);
    expect(globalThis.location.hash).toContain('i=text');
    expect(root.querySelector('.panel.craft')).toBeNull();
    expect(clearanceBox(root)).toBeInstanceOf(HTMLTextAreaElement);
    expect(globalThis.localStorage.getItem('craft-tester:input')).toBe('"text"');

    const again = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    expect(clearanceBox(again)).toBeInstanceOf(HTMLTextAreaElement);
    expect(again.querySelector('.panel.craft')).toBeNull();
  });

  it('grades a typed clearance element by element', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'text');
    expect(submitOf(root, '.panel.typed').disabled).toBe(true);
    typeInto(clearanceBox(root), 'cleared to');
    expect(submitOf(root, '.panel.typed').disabled).toBe(false);

    pressEnter(clearanceBox(root));

    expect(root.querySelectorAll('.panel.results .verdict')).toHaveLength(8);
    const reading = root.querySelector('.panel.results .reveal .spoken')?.textContent ?? '';
    expect(reading.length).toBeGreaterThan(0);

    buttonNamed(root, 'Try this strip again').click();
    typeInto(clearanceBox(root), reading);
    pressEnter(clearanceBox(root));

    const score = root.querySelector('.panel.results .score')?.textContent ?? '';
    expect(score.startsWith('8/8')).toBe(true);
  });

  it('switches to Full route, answering by typing, and remembers it', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    expect(globalThis.location.hash).not.toContain('r=full');
    expect(chosen(root, 'Answer by')).toBe('Pick');

    segment(root, 'Answer by', 'Full route').click();

    expect(globalThis.location.hash).toContain('i=text&r=full');
    expect(chosen(root, 'Answer by')).toBe('Full route');
    expect(clearanceBox(root)).toBeInstanceOf(HTMLTextAreaElement);
    expect(globalThis.localStorage.getItem('craft-tester:full-route')).toBe('true');
    expect(globalThis.localStorage.getItem('craft-tester:input')).toBe('"text"');
  });

  it('lets go of the full route when the answer goes back to Pick', async () => {
    const root = await mountSession(CLEARANCE_SEED, {
      filter: ANY_SCENARIO,
      mode: 'clearance',
      input: 'text',
      fullRoute: true,
      gradeRunway: true,
    });
    expect(chosen(root, 'Answer by')).toBe('Full route');

    segment(root, 'Answer by', 'Pick').click();

    expect(globalThis.location.hash).not.toContain('r=full');
    expect(globalThis.location.hash).not.toContain('i=text');
    expect(chosen(root, 'Answer by')).toBe('Pick');
    expect(root.querySelector('.panel.craft')).not.toBeNull();
    expect(globalThis.localStorage.getItem('craft-tester:full-route')).toBe('false');
    expect(globalThis.localStorage.getItem('craft-tester:input')).toBe('"dropdowns"');
  });

  it('keeps what was typed when Full route goes back to Type', async () => {
    const root = await mountSession(CLEARANCE_SEED, {
      filter: ANY_SCENARIO,
      mode: 'clearance',
      input: 'text',
      fullRoute: true,
      gradeRunway: true,
    });
    typeInto(clearanceBox(root), 'cleared to');

    segment(root, 'Answer by', 'Type').click();

    expect(chosen(root, 'Answer by')).toBe('Type');
    expect(globalThis.location.hash).toContain('i=text');
    expect(globalThis.location.hash).not.toContain('r=full');
    expect(clearanceBox(root).value).toBe('cleared to');
    expect(globalThis.localStorage.getItem('craft-tester:full-route')).toBe('false');
    expect(globalThis.localStorage.getItem('craft-tester:input')).toBe('"text"');
  });

  it('moves the answer with the arrow keys and keeps the focus on the switch', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    segment(root, 'Answer by', 'Pick').focus();

    segment(root, 'Answer by', 'Pick').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );

    expect(chosen(root, 'Answer by')).toBe('Type');
    expect(clearanceBox(root)).toBeInstanceOf(HTMLTextAreaElement);
    expect(document.activeElement).toBe(segment(root, 'Answer by', 'Type'));
  });

  it('opens on Full route, typed, from a link that carries r=full', async () => {
    const root = await mountHash(`#s=${CLEARANCE_SEED}&a=KSFO&r=full`);

    expect(chosen(root, 'Answer by')).toBe('Full route');
    expect(clearanceBox(root)).toBeInstanceOf(HTMLTextAreaElement);
    expect(globalThis.location.hash).toContain('i=text&r=full');
  });

  it('shows FRC on the strip while the answer is Full route', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'text');
    expect(remarksOf(stripTitled(root, 'Flight plan'))).not.toContain('FRC');

    segment(root, 'Answer by', 'Full route').click();
    expect(remarksOf(stripTitled(root, 'Flight plan')).startsWith('FRC')).toBe(true);

    segment(root, 'Answer by', 'Pick').click();
    expect(remarksOf(stripTitled(root, 'Flight plan'))).not.toContain('FRC');
  });

  it('counts the filters set on the Filters button', async () => {
    const plain = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    expect(plain.querySelector('details.filters summary')?.textContent).toBe('Filters');
    expect(plain.querySelector('details.filters .count')).toBeNull();

    const night = { time: 'night', config: { kind: 'any' } } as const;
    const one = await mountSession(CLEARANCE_SEED, {
      filter: night,
      mode: 'clearance',
      input: 'dropdowns',
      fullRoute: false,
      gradeRunway: true,
    });
    expect(one.querySelector('details.filters .count')?.textContent).toBe('1');

    const both = await mountSession(CLEARANCE_SEED, {
      filter: { time: 'day', config: { kind: 'plan', plan: 'West' } },
      mode: 'clearance',
      input: 'dropdowns',
      fullRoute: false,
      gradeRunway: true,
    });
    expect(both.querySelector('details.filters .count')?.textContent).toBe('2');
    expect(both.querySelector('details.filters .filters-popover select')).not.toBeNull();
  });

  it('copies the link to the strip on screen', async () => {
    const writeText = vi.spyOn(globalThis.navigator.clipboard, 'writeText').mockResolvedValue();
    const settings = {
      filter: ANY_SCENARIO,
      mode: 'clearance',
      input: 'dropdowns',
      fullRoute: false,
      gradeRunway: true,
    } as const;
    const root = await mountSession(CLEARANCE_SEED, settings);
    const expected = shareLink(globalThis.location.href, 'KSFO', CLEARANCE_SEED, settings);

    const copy = root.querySelector(
      'section.panel.strip button[aria-label="Copy link to this strip"]',
    );
    if (!(copy instanceof HTMLButtonElement)) throw new Error('the strip has no copy-link button');
    copy.click();

    await settled(() => {
      expect(root.querySelector('.copy-status')?.textContent).toBe('Copied');
    });
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(stripTitled(root, 'Flight plan')).toBeInstanceOf(HTMLElement);
  });

  it('shows the link to copy by hand where the clipboard refuses it', async () => {
    vi.spyOn(globalThis.navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    const expected = shareLink(globalThis.location.href, 'KSFO', CLEARANCE_SEED, {
      filter: ANY_SCENARIO,
      mode: 'clearance',
      input: 'dropdowns',
      fullRoute: false,
      gradeRunway: true,
    });

    root.querySelector<HTMLButtonElement>('button[aria-label="Copy link to this strip"]')?.click();

    await settled(() => {
      expect(root.querySelector<HTMLInputElement>('.copy-link input')?.value).toBe(expected);
    });
    expect(root.querySelector<HTMLInputElement>('.copy-link input')?.readOnly).toBe(true);
  });

  it('shows FRC on every strip of an amendment while the answer is Full route', async () => {
    const root = await mountSession(AMENDMENT_SEED, {
      filter: ANY_SCENARIO,
      mode: 'amendment',
      input: 'text',
      fullRoute: true,
      gradeRunway: true,
    });
    expect(remarksOf(stripTitled(root, 'Flight plan')).startsWith('FRC')).toBe(true);

    clearTheStrip(root);

    expect(remarksOf(stripTitled(root, 'Flight plan as filed')).startsWith('FRC')).toBe(true);
    expect(remarksOf(stripTitled(root, 'Amended flight plan')).startsWith('FRC')).toBe(true);
  });

  it('grades the abbreviated reading wrong on Full route', async () => {
    const { seed, abbreviated } = await twoWaySeed();
    const root = await mountSession(seed, {
      filter: ANY_SCENARIO,
      mode: 'clearance',
      input: 'text',
      fullRoute: true,
      gradeRunway: true,
    });

    typeInto(clearanceBox(root), abbreviated);
    pressEnter(clearanceBox(root));

    const results = root.querySelector('.panel.results')?.textContent ?? '';
    expect(results).toContain(FRC_REMARK);
    expect(results).toContain('R-FRC');
  });

  it('grades a typed amendment against the full route on Full route', async () => {
    const { seed, abbreviated } = await twoWayAmendment();
    const root = await mountApp(seed, 'amendment', 'text');

    segment(root, 'Answer by', 'Full route').click();
    clearTheStrip(root);
    typeInto(clearanceBox(root), abbreviated);
    pressEnter(clearanceBox(root));

    const results = root.querySelector('.panel.results')?.textContent ?? '';
    expect(results, `seed ${seed}: ${abbreviated}`).toContain(FRC_REMARK);
    expect(results).toContain('R-FRC');
  });

  it('opens a typed link on Type even where this browser remembers full route', async () => {
    globalThis.localStorage.setItem('craft-tester:full-route', 'true');

    const root = await mountHash(`#s=${CLEARANCE_SEED}&a=KSFO&i=text`);

    expect(chosen(root, 'Answer by')).toBe('Type');
    expect(globalThis.location.hash).not.toContain('r=full');
  });

  it('opens a bare link on Full route where this browser remembers typed answers and full route', async () => {
    globalThis.localStorage.setItem('craft-tester:input', '"text"');
    globalThis.localStorage.setItem('craft-tester:full-route', 'true');

    const root = await mountHash(`#s=${CLEARANCE_SEED}&a=KSFO`);

    expect(chosen(root, 'Answer by')).toBe('Full route');
    expect(globalThis.location.hash).toContain('r=full');
  });

  it('shows a full route attempt back on revisit, graded against the full route', async () => {
    const { seed, abbreviated } = await twoWaySeed();
    const settings = {
      filter: ANY_SCENARIO,
      mode: 'clearance',
      input: 'text',
      fullRoute: true,
      gradeRunway: true,
    } as const;
    const root = await mountSession(seed, settings);
    typeInto(clearanceBox(root), abbreviated);
    pressEnter(clearanceBox(root));

    const again = await mountSession(seed, settings);
    const revisit = again.querySelector('.panel.results.revisit');
    expect(revisit).not.toBeNull();
    expect(revisit?.textContent ?? '').toContain(FRC_REMARK);

    const unticked = await mountSession(seed, { ...settings, fullRoute: false });
    expect(unticked.querySelector('.panel.results.revisit')).toBeNull();
  });

  it('keeps the typing box the student is typing in', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'text');
    const area = clearanceBox(root);
    area.focus();

    typeInto(area, 'cleared to San');

    expect(clearanceBox(root)).toBe(area);
    expect(area.value).toBe('cleared to San');
    expect(document.activeElement).toBe(area);
  });

  it('does not submit a blank typing box', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'text');
    for (const text of ['', '   ']) {
      typeInto(clearanceBox(root), text);
      pressEnter(clearanceBox(root));
      expect(root.querySelector('.panel.typed')).not.toBeNull();
      expect(root.querySelector('.panel.results')).toBeNull();
    }
  });

  it('reads the corrected plan by typing after the strip', async () => {
    const root = await mountApp(AMENDMENT_SEED, 'amendment', 'text');
    clearTheStrip(root);
    const area = clearanceBox(root);
    expect(root.querySelector('.panel.craft')).toBeNull();

    typeInto(area, 'cleared to');
    pressEnter(area);

    expect(root.querySelectorAll('.panel.results .verdict')).toHaveLength(11);
  });

  it('clears the plan the student corrected when an alternative box was fixed', async () => {
    const airport = await loadAirportData('KSFO');
    const view = buildScenario(airport, ALTERNATIVE_SEED, ANY_SCENARIO, 'amendment');
    if (view.kind !== 'amendment') throw new Error(`seed ${ALTERNATIVE_SEED} drew no amendment`);
    const { filed, result } = view.drawn;
    const route = result.amendments.find(
      (amendment) => amendment.box === 'route' && amendment.alternativeTo === 'type',
    );
    if (route?.box !== 'route') throw new Error('the seed raises no route alternative to the type');
    expect(result.corrected.equipmentSuffix).not.toBe(filed.equipmentSuffix);
    expect(result.corrected.filedRoute).toBe(filed.filedRoute);
    const procedure = procedureOf({ ...filed, filedRoute: route.proposed }, airport);
    expect(procedure).toBeDefined();
    expect(procedure).not.toBe(procedureOf(result.corrected, airport));

    const root = await mountApp(ALTERNATIVE_SEED, 'amendment', 'dropdowns');
    choose(answerOf(root, 'type'), 'as_filed');
    choose(answerOf(root, 'altitude'), 'as_filed');
    choose(answerOf(root, 'route'), 'amended');
    const input = valueOf(root, 'route');
    input.value = route.proposed;
    input.dispatchEvent(new Event('input'));
    submitOf(root, '.panel.amend').click();

    const amended = stripTitled(root, 'Amended flight plan');
    const equipment = amended.querySelector('.strip-cell.c1.r2')?.textContent ?? '';
    expect(equipment.endsWith(`${filed.aircraftType}${filed.equipmentSuffix ?? ''}`)).toBe(true);
    const routeText = [...amended.querySelectorAll('.strip-route-line')]
      .map((line) => line.textContent)
      .join(' ');
    expect(routeText).toContain(route.proposed);
    expect(selectOf(field(root, 'procedure')).value).toBe(procedure);
  });
});

/** A KOAK clearance-mode strip the SOP clears off on heading 270 with no DP. */
const NO_DP_SEED = 2;

/** A KOAK clearance-mode strip whose clearance assigns a SID. */
const SID_SEED = 1;

/** The clean clearance clearance mode draws at one KOAK seed. */
async function koakClearance(seed: number): Promise<ResolvedClearance> {
  const airport = await loadAirportData('KOAK');
  const view = buildScenario(airport, seed, ANY_SCENARIO, 'clearance');
  if (view.kind !== 'clearance') throw new Error(`KOAK seed ${String(seed)} draws no clearance`);
  return view.clearance;
}

/** CRAFT picks whose verdicts the procedure tests do not read. */
const somePicks: PlayerPicks = {
  routeTemplate: 'radar_vectors_direct',
  altitudePhrase: 'climb_via',
  expect: 'none',
  frequency: '120.9',
  runway: '30',
};

describe('the procedure pick of a clearance with no DP', () => {
  it('grades the heading the clearance names correct and a SID wrong, ahead of the route', async () => {
    const airport = await loadAirportData('KOAK');
    const clearance = await koakClearance(NO_DP_SEED);
    const sid = airport.sids[0]?.id ?? '';
    const right = clearancePickGrades(
      { ...somePicks, procedure: headingPick(270) },
      clearance,
      airport,
      picksProcedure(clearance),
      true,
    );
    const wrong = clearancePickGrades(
      { ...somePicks, procedure: sid },
      clearance,
      airport,
      picksProcedure(clearance),
      true,
    );
    expect(right.map((grade) => grade.element)).toStrictEqual([
      'R.sid',
      'R.route',
      'A.phrase',
      'A.expect',
      'F',
      'RWY',
    ]);
    expect(right[0]?.verdict).toBe('correct');
    expect(wrong[0]?.verdict).toBe('wrong');
  });

  it('grades an attempt stored without a procedure pick as a wrong procedure', async () => {
    const airport = await loadAirportData('KOAK');
    const clearance = await koakClearance(NO_DP_SEED);
    const grades = clearancePickGrades(
      somePicks,
      clearance,
      airport,
      picksProcedure(clearance),
      true,
    );
    expect(grades[0]).toMatchObject({ element: 'R.sid', verdict: 'wrong' });
  });

  it('grades no procedure on a strip whose clearance assigns a SID', async () => {
    const airport = await loadAirportData('KOAK');
    const clearance = await koakClearance(SID_SEED);
    const grades = clearancePickGrades(
      somePicks,
      clearance,
      airport,
      picksProcedure(clearance),
      true,
    );
    expect(grades.map((grade) => grade.element)).not.toContain('R.sid');
    expect(grades).toHaveLength(5);
  });

  it('drops the runway grade from a strip that does not grade the runway', async () => {
    const airport = await loadAirportData('KOAK');
    for (const seed of [NO_DP_SEED, SID_SEED]) {
      const clearance = await koakClearance(seed);
      const picks = { ...somePicks, procedure: headingPick(270) };
      const procedurePicked = picksProcedure(clearance);
      const graded = clearancePickGrades(picks, clearance, airport, procedurePicked, true);
      const notGraded = clearancePickGrades(picks, clearance, airport, procedurePicked, false);
      expect(graded.map((grade) => grade.element)).toContain('RWY');
      expect(notGraded.map((grade) => grade.element)).not.toContain('RWY');
      expect(notGraded).toHaveLength(graded.length - 1);
      expect(notGraded).toStrictEqual(graded.filter((grade) => grade.element !== 'RWY'));
    }
  });

  it('shows six graded rows, the procedure among them, once the strip is submitted', async () => {
    globalThis.localStorage.clear();
    const settings = { filter: ANY_SCENARIO, mode: 'clearance', input: 'dropdowns' } as const;
    const root = await mountHash(
      hashFor('KOAK', NO_DP_SEED, { ...settings, fullRoute: false, gradeRunway: true }),
    );
    const labels = [
      'route phrase',
      'fix or airway',
      'altitude phrase',
      'altitude',
      'expect clause',
    ];
    for (const label of [...labels, 'departure frequency', 'runway']) {
      const select = selectOf(field(root, label));
      if (!select.disabled) choose(select, firstChoice(select));
    }
    expect(submitOf(root, '.panel.craft').disabled).toBe(true);

    choose(selectOf(field(root, 'procedure')), headingPick(270));
    expect(submitOf(root, '.panel.craft').disabled).toBe(false);
    submitOf(root, '.panel.craft').click();

    const verdicts = [...root.querySelectorAll('.panel.results .verdict')];
    expect(verdicts).toHaveLength(6);
    expect(verdicts[0]?.querySelector('.name')?.textContent).toBe('procedure');
    const score = root.querySelector('.panel.results .score')?.textContent ?? '';
    expect(score).toMatch(/^\d½?\/6correct$/);
  });

  it('shows an attempt stored without the procedure back with the procedure graded wrong', async () => {
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem(
      `craft-tester:solved:KOAK:${String(NO_DP_SEED)}`,
      JSON.stringify(somePicks),
    );
    const settings = { filter: ANY_SCENARIO, mode: 'clearance', input: 'dropdowns' } as const;
    const root = await mountHash(
      hashFor('KOAK', NO_DP_SEED, { ...settings, fullRoute: false, gradeRunway: true }),
    );

    const verdicts = [...root.querySelectorAll('.verdict')];
    expect(verdicts).toHaveLength(6);
    expect(verdicts[0]?.querySelector('.name')?.textContent).toBe('procedure');
  });
});

/** The headings of the strips one region of the page holds, in page order. */
function stripHeadings(region: ParentNode): string[] {
  return [...region.querySelectorAll('section.panel.strip h2')].map((node) => node.textContent);
}

/** One region of the page: the rail, its pinned group, or the work column. */
function region(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`the page has no ${selector}`);
  return node;
}

describe('the rail and the work column', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('puts the strip and the ATIS in the pinned rail and the form in the work column', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    const rail = region(root, 'main.layout > aside.rail');
    const pin = region(rail, '.rail-pin');
    const work = region(root, 'main.layout > section.work');

    expect(stripHeadings(pin)).toEqual(['Flight plan']);
    expect(pin.querySelector('.panel.atis')).not.toBeNull();
    expect(rail.children).toHaveLength(1);
    expect(work.querySelector('.panel.craft')).not.toBeNull();
    expect(rail.querySelector('.panel.craft')).toBeNull();
    expect(stripHeadings(work)).toEqual([]);
  });

  it('keeps the results in the work column and the strip in the rail', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'text');
    typeInto(clearanceBox(root), 'cleared to');
    pressEnter(clearanceBox(root));

    const rail = region(root, 'aside.rail');
    const work = region(root, 'section.work');
    expect(work.querySelector('.panel.results')).not.toBeNull();
    expect(rail.querySelector('.panel.results')).toBeNull();
    expect(stripHeadings(region(rail, '.rail-pin'))).toEqual(['Flight plan']);
  });

  it('pins the filed strip while amending and the amended strip once it exists', async () => {
    const root = await mountApp(AMENDMENT_SEED, 'amendment', 'text');
    const amending = region(root, 'aside.rail');
    expect(stripHeadings(region(amending, '.rail-pin'))).toEqual(['Flight plan']);
    expect(region(root, 'section.work').querySelector('.panel.amend')).not.toBeNull();
    expect(amending.querySelector('.panel.amend')).toBeNull();

    clearTheStrip(root);

    const clearing = region(root, 'aside.rail');
    const pin = region(clearing, '.rail-pin');
    expect(stripHeadings(clearing)).toEqual(['Flight plan as filed', 'Amended flight plan']);
    expect(stripHeadings(pin)).toEqual(['Amended flight plan']);
    expect(pin.querySelector('.panel.atis')).not.toBeNull();
    const verdicts = clearing.querySelector('.panel.results');
    expect(verdicts).not.toBeNull();
    expect(pin.contains(verdicts)).toBe(false);
    expect(region(root, 'section.work').querySelector('.panel.typed')).not.toBeNull();

    typeInto(clearanceBox(root), 'cleared to');
    pressEnter(clearanceBox(root));

    const results = region(root, 'aside.rail');
    expect(stripHeadings(region(results, '.rail-pin'))).toEqual(['Amended flight plan']);
    expect(stripHeadings(results)).toEqual(['Flight plan as filed', 'Amended flight plan']);
    expect(results.querySelector('.panel.results')).toBeNull();
    expect(region(root, 'section.work').querySelector('.panel.results')).not.toBeNull();
  });
});

/** One card of a home card group, found by its group and the value it reads back. */
function homeCard(root: ParentNode, group: string, value: string): HTMLElement {
  const found = root.querySelector(`[data-focus-key="${group}:${value}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`home offers no ${value} under ${group}`);
  return found;
}

/** Whether a home card is the one chosen in its group. */
function cardChecked(root: ParentNode, group: string, value: string): string | null {
  return homeCard(root, group, value).getAttribute('aria-checked');
}

/** The `href` of the first link a selector finds, or `null` where it finds none. */
function hrefAt(root: ParentNode, selector: string): string | null {
  return root.querySelector(selector)?.getAttribute('href') ?? null;
}

/** Where the test bar says the set is, e.g. "Strip 1 of 5". */
function setWhere(root: ParentNode): string {
  return root.querySelector('.testbar .where')?.textContent ?? '';
}

/** The set seed of the hash's `x=` part, in base 36. */
function setSeedOf(hash: string): string {
  const seed = /[#&]x=([0-9a-z]+)\./.exec(hash)?.[1];
  if (seed === undefined) throw new Error(`the hash ${hash} names no test set`);
  return seed;
}

/** Sets the hash and tells the page, the way a link the student follows does. */
function followLink(hash: string): void {
  globalThis.location.hash = hash;
  globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** The key the tour being seen is remembered under. */
const TOUR_SEEN_KEY = 'craft-tester:tour-seen';

/** The key the step a tour part was left on is stored under. */
const TOUR_PROGRESS_KEY = 'craft-tester:tour-progress';

/** The key the remembered way of answering, dropdowns or typing, is stored under. */
const INPUT_KEY = 'craft-tester:input';

/** The key the remembered full route choice is stored under. */
const FULL_ROUTE_KEY = 'craft-tester:full-route';

/** Presses Escape on the page, where the tour listens for it. */
function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
}

/** The tour's card, which lives in the document's body, outside the app's root. */
function tourCard(): HTMLElement {
  const card = document.querySelector('.tour-card');
  if (!(card instanceof HTMLElement)) throw new Error('no tour is running');
  return card;
}

/** The step the tour's card is on, e.g. `4 of 11`. */
function tourCount(): string {
  return tourCard().querySelector('.tour-count')?.textContent ?? '';
}

/** The page element that carries one tour anchor. */
function anchored(root: ParentNode, anchor: string): HTMLElement {
  const node = root.querySelector(`[data-tour="${anchor}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`the page has no ${anchor} anchor`);
  return node;
}

/** Every key the browser's storage holds. */
function storedKeys(): string[] {
  const storage = globalThis.localStorage;
  return Array.from({ length: storage.length }, (_, at) => storage.key(at) ?? '');
}

/** The text of the strip the page shows, its callsign among it. */
function stripText(root: ParentNode): string {
  return root.querySelector('section.panel.strip')?.textContent ?? '';
}

describe('routing', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem(TOUR_SEEN_KEY, 'true');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens home on an empty hash, offering practice at the first airport', async () => {
    const root = await mountHash('');
    expect(root.querySelector('.home-page')).not.toBeNull();
    expect(hrefAt(root, '.home-start a.button')).toBe('#/KSFO/clearance/practice');
    expect(cardChecked(root, 'Airport', 'KSFO')).toBe('true');
  });

  it('opens practice from its link and writes the strip link over it', async () => {
    const root = await mountHash('#/KOAK/amend/practice');
    expect(root.querySelector('section.panel.strip')).not.toBeNull();
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&m=amend$/);
  });

  it('starts a new test from its link', async () => {
    const root = await mountHash('#/KSFO/clearance/test/5x0');
    expect(root.querySelector('.testbar')).not.toBeNull();
    expect(setWhere(root)).toBe('Strip 1 of 5');
    expect(globalThis.location.hash).toMatch(/&x=[0-9a-z]+\.5\.0\.0$/);
  });

  it('continues a stored test from its link', async () => {
    await mountHash('#/KSFO/clearance/test/5x0');
    const seed = setSeedOf(globalThis.location.hash);

    const root = await mountHash(`#/KSFO/clearance/test/${seed}`);

    expect(root.querySelector('.testbar')).not.toBeNull();
    expect(setWhere(root)).toBe('Strip 1 of 5');
    expect(setSeedOf(globalThis.location.hash)).toBe(seed);
  });

  it('opens home on a link to a test this browser does not hold', async () => {
    const root = await mountHash('#/KSFO/clearance/test/zzz');
    expect(root.querySelector('.home-page')).not.toBeNull();
    expect(globalThis.location.hash).toBe('#/');
  });

  it('opens home on a practice link to an airport the index does not list', async () => {
    const root = await mountHash('#/ZZZZ/clearance/practice');
    expect(root.querySelector('.home-page')).not.toBeNull();
  });

  it('follows a hash change to practice and back home', async () => {
    const root = await mountHash('#/');
    expect(root.querySelector('.home-page')).not.toBeNull();

    followLink('#/KSFO/clearance/practice');
    await settled(() => {
      expect(root.querySelector('section.panel.strip')).not.toBeNull();
    });

    followLink('#/');
    await settled(() => {
      expect(root.querySelector('.home-page')).not.toBeNull();
    });
  });

  it('remembers the airport chosen on home', async () => {
    const root = await mountHash('');
    homeCard(root, 'Airport', 'KOAK').click();

    const again = await mountHash('');

    expect(cardChecked(again, 'Airport', 'KOAK')).toBe('true');
  });

  it('remembers the airport and mode a practice link opened', async () => {
    await mountHash('#/KOAK/amend/practice');

    const root = await mountHash('');

    expect(cardChecked(root, 'Airport', 'KOAK')).toBe('true');
    expect(cardChecked(root, 'Mode', 'amendment')).toBe('true');
  });

  it('offers an unfinished test back on home', async () => {
    await mountHash('#/KSFO/clearance/test/5x0');
    const seed = setSeedOf(globalThis.location.hash);

    const root = await mountHash('');

    expect(root.querySelector('.home-resume')?.textContent).toContain('Unfinished test');
    expect(hrefAt(root, '.home-resume a')).toBe(`#/KSFO/clearance/test/${seed}`);
  });

  it('shows a finished set the score of the attempt it was resubmitted with', async () => {
    const settings: SessionSettings = {
      filter: ANY_SCENARIO,
      mode: 'clearance',
      input: 'text',
      fullRoute: false,
      gradeRunway: true,
    };
    const setSeed = 100;
    const airport = await loadAirportData('KSFO');
    const { seed } = setStripSeed(airport, setSeed, 0, settings);
    const strip = await mountHash(hashFor('KSFO', seed, settings));
    typeInto(clearanceBox(strip), 'cleared to');
    pressEnter(clearanceBox(strip));
    const reading = strip.querySelector('.panel.results .reveal .spoken')?.textContent ?? '';
    expect(reading.length).toBeGreaterThan(0);

    const startedAt = Date.now();
    browserSetStore().save(setSeed, {
      startedAt,
      minutes: 0,
      n: 1,
      icao: 'KSFO',
      mode: 'clearance',
      input: 'text',
      fullRoute: false,
      gradeRunway: true,
      filter: ANY_SCENARIO,
      answered: [0],
      skipped: [],
      ended: true,
      endedAt: startedAt,
    });

    const home = await mountHash('');
    expect(home.textContent).toContain('0 of 1 strips fully correct · 13%');

    browserSolvedStore().save(
      'KSFO',
      seed,
      { kind: 'clearance', input: 'text', text: reading },
      false,
      true,
    );

    const again = await mountHash('');
    expect(again.textContent).toContain('1 of 1 strips fully correct · 100%');
  });

  it('offers Continue for an unfinished set older than the ten newest', async () => {
    const store = browserSetStore();
    const startedAt = Date.now();
    const finished = (at: number) => ({
      startedAt: at,
      minutes: 0,
      n: 1,
      icao: 'KSFO',
      mode: 'clearance' as const,
      input: 'dropdowns' as const,
      fullRoute: false,
      gradeRunway: true,
      filter: ANY_SCENARIO,
      answered: [0],
      skipped: [],
      ended: true,
      endedAt: at,
    });
    store.save(50, { ...finished(startedAt), answered: [], ended: false, endedAt: undefined });
    for (let index = 1; index <= 10; index += 1) {
      store.save(50 + index, finished(startedAt + index * 1000));
    }

    const root = await mountHash('');

    expect(root.querySelectorAll('.home-tests li')).toHaveLength(10);
    expect(root.querySelector('.home-resume')?.textContent).toContain('Unfinished test');
    expect(hrefAt(root, '.home-resume a')).toBe('#/KSFO/clearance/test/1e');
  });

  it('links the toolbar brand to home', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    expect(hrefAt(root, '.toolbar .brand a')).toBe('#/');
  });

  it('remembers the mode the toolbar switched to for home', async () => {
    const root = await mountApp(CLEARANCE_SEED, 'clearance', 'dropdowns');
    segment(root, 'Mode', 'Amend').click();

    const home = await mountHash('');

    expect(cardChecked(home, 'Mode', 'amendment')).toBe('true');
  });

  it('opens an old strip link as it always has', async () => {
    const root = await mountHash('#s=1&a=KSFO');
    expect(root.querySelector('section.panel.strip')).not.toBeNull();
    expect(globalThis.location.hash).toBe('#s=1&a=KSFO');
  });

  it('asks the runway on the tour even where this browser chose not to grade it', async () => {
    globalThis.localStorage.setItem('craft-tester:runway-grading', 'false');
    const root = await mountHash('#/tutorial');
    expect(selectOf(field(root, 'runway')).disabled).toBe(false);
    expect(anchored(root, 'runway')).toBeDefined();
  });

  it('offers no Runway select on the tour, where a strip page offers one', async () => {
    const runwaySelects = (root: Element): number =>
      [...root.querySelectorAll('.filters-popover .field-label')].filter(
        (node) => node.textContent === 'Runway',
      ).length;
    const tour = await mountHash('#/tutorial');
    expect(tour.querySelector('.filters-popover')).not.toBeNull();
    expect(runwaySelects(tour)).toBe(0);
    expect(selectOf(field(tour, 'runway')).disabled).toBe(false);
    const strip = await mountHash('#s=1&a=KSFO');
    expect(runwaySelects(strip)).toBe(1);
  });

  it('opens a strip link with rwy=off without the runway row, whatever this browser chose', async () => {
    globalThis.localStorage.setItem('craft-tester:runway-grading', 'true');
    const root = await mountHash('#s=1&a=KSFO&rwy=off');
    expect(root.querySelector('.panel.craft')).not.toBeNull();
    expect(root.querySelector('.panel.craft [data-tour="runway"]')).toBeNull();
    expect(globalThis.location.hash).toBe('#s=1&a=KSFO&rwy=off');
  });

  it('stops grading the runway from Filters, remembering it and writing rwy=off', async () => {
    globalThis.localStorage.removeItem('craft-tester:runway-grading');
    const root = await mountHash('#s=1&a=KSFO');
    expect(root.querySelector('.panel.craft [data-tour="runway"]')).not.toBeNull();
    expect(root.querySelector('details.filters .count')).toBeNull();
    const popover = root.querySelector('.filters-popover');
    if (popover === null) throw new Error('the page has no Filters popover');
    choose(selectOf(field(popover, 'Runway')), 'off');
    expect(globalThis.location.hash).toBe('#s=1&a=KSFO&rwy=off');
    expect(globalThis.localStorage.getItem('craft-tester:runway-grading')).toBe('false');
    expect(root.querySelector('.panel.craft [data-tour="runway"]')).toBeNull();
    expect(root.querySelector('details.filters .count')?.textContent).toBe('1');
    choose(selectOf(field(root, 'Runway')), 'graded');
    expect(globalThis.location.hash).toBe('#s=1&a=KSFO');
    expect(root.querySelector('.panel.craft [data-tour="runway"]')).not.toBeNull();
  });

  it('opens the clearance part of the tour on SWA1740', async () => {
    const root = await mountHash('#/tutorial');
    expect(stripText(root)).toContain('SWA1740');
    expect(tourCount()).toBe('1 of 11');
  });

  it('walks the clearance part to the results without writing a strip link or an attempt', async () => {
    const replace = vi.spyOn(globalThis.history, 'replaceState');
    const root = await mountHash('#/tutorial');
    expect(root.querySelector('.copy-link')).toBeNull();
    for (const [at, step] of CLEARANCE_TOUR.entries()) {
      expect(tourCount()).toBe(`${at + 1} of ${CLEARANCE_TOUR.length}`);
      const advance = step.advance;
      if (advance === 'submit') anchored(root, 'submit').click();
      else if (advance !== 'next' && 'pick' in advance) {
        choose(selectOf(anchored(root, advance.pick)), advance.value);
      } else if (at < CLEARANCE_TOUR.length - 1) buttonNamed(tourCard(), 'Next').click();
      expect(globalThis.location.hash).toBe('#/tutorial');
    }
    expect(anchored(root, 'results')).toBeDefined();
    buttonNamed(tourCard(), 'Finish').click();
    expect(document.querySelector('.tour-card')).toBeNull();
    expect(globalThis.location.hash).toBe('#/');
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
    expect(replace.mock.calls.some((call) => String(call[2]).includes('s='))).toBe(false);
    expect(storedKeys().filter((key) => key.startsWith('craft-tester:solved'))).toEqual([]);
    expect(storedKeys()).not.toContain(INPUT_KEY);
    expect(storedKeys()).not.toContain(FULL_ROUTE_KEY);
  });

  it('offers neither the next strip nor another try on the results of the tour', async () => {
    const progress = { version: TOUR_STEPS_VERSION, part: 'clearance', step: 10 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    const root = await mountHash('#/tutorial');
    const labels = [...anchored(root, 'results').querySelectorAll('button')].map(
      (node) => node.textContent,
    );
    expect(labels).not.toContain('Next strip');
    expect(labels).not.toContain('Try this strip again');
  });

  it('takes the page out of reach once a part ends, until the next page opens', async () => {
    const root = await mountHash('#/tutorial');
    buttonNamed(tourCard(), 'Skip tour').click();
    expect(root.hasAttribute('inert')).toBe(true);
    followLink('#/');
    await settled(() => {
      expect(root.querySelector('.home-page')).not.toBeNull();
    });
    expect(root.hasAttribute('inert')).toBe(false);
  });

  it('remembers the tour as seen, forgets its progress and opens home on Escape', async () => {
    globalThis.localStorage.removeItem(TOUR_SEEN_KEY);
    await mountHash('#/tutorial');
    buttonNamed(tourCard(), 'Next').click();
    pressEscape();
    expect(document.querySelector('.tour-card')).toBeNull();
    expect(globalThis.location.hash).toBe('#/');
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
    expect(globalThis.localStorage.getItem(TOUR_PROGRESS_KEY)).toBeNull();
  });

  it('shows "amend to" as wrong at once on a box the step keeps as filed', async () => {
    const root = await mountHash('#/tutorial/amend');
    buttonNamed(tourCard(), 'Next').click();
    choose(answerOf(root, 'type'), 'amended');
    expect(tourCount()).toBe('2 of 6');
    const wrong = tourCard().querySelector('.tour-wrong')?.textContent ?? '';
    expect(wrong).toContain('amend to');
    expect(wrong).toContain('correct as filed');
  });

  it('starts no tour of home once the way to home is overtaken by another link', async () => {
    const progress = { version: TOUR_STEPS_VERSION, part: 'amend', step: 5 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    const root = await mountHash('#/tutorial/amend');
    buttonNamed(tourCard(), 'Next: test yourself').click();
    followLink('#/');
    followLink('#s=1&a=KSFO');
    await settled(() => {
      expect(root.querySelector('section.panel.strip')).not.toBeNull();
    });
    followLink('#/');
    await settled(() => {
      expect(root.querySelector('.home-page')).not.toBeNull();
    });
    expect(document.querySelector('.tour-card')).toBeNull();
  });

  it('keeps the route step and shows what is wrong with a wrong pick', async () => {
    const root = await mountHash('#/tutorial');
    for (let next = 0; next < 3; next += 1) buttonNamed(tourCard(), 'Next').click();
    const template = selectOf(anchored(root, 'routeTemplate'));
    const wrong = [...template.options].find(
      (option) => !['', 'transition'].includes(option.value),
    );
    if (wrong === undefined) throw new Error('the route template offers nothing wrong to pick');
    choose(template, wrong.value);
    expect(tourCount()).toBe('4 of 11');
    expect(tourCard().querySelector('.tour-wrong')?.textContent).toContain(wrong.textContent);
  });

  it('remembers the tour as seen and forgets its progress on Skip', async () => {
    globalThis.localStorage.removeItem(TOUR_SEEN_KEY);
    await mountHash('#/tutorial');
    buttonNamed(tourCard(), 'Next').click();
    expect(globalThis.localStorage.getItem(TOUR_PROGRESS_KEY)).not.toBeNull();
    buttonNamed(tourCard(), 'Skip tour').click();
    expect(document.querySelector('.tour-card')).toBeNull();
    expect(globalThis.location.hash).toBe('#/');
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
    expect(globalThis.localStorage.getItem(TOUR_PROGRESS_KEY)).toBeNull();
  });

  it('offers the tour on home on a first visit, without opening it', async () => {
    globalThis.localStorage.clear();
    const root = await mountHash('');
    expect(root.querySelector('.home-page')).not.toBeNull();
    expect(['', '#/']).toContain(globalThis.location.hash);
    expect(root.querySelector('.home-tour-card')).not.toBeNull();
    expect(document.querySelector('.tour-card')).toBeNull();
  });

  it('offers no tour card on home once the tour was seen', async () => {
    const root = await mountHash('');
    expect(root.querySelector('.home-page')).not.toBeNull();
    expect(root.querySelector('.home-tour-card')).toBeNull();
  });

  it('remembers the tour as seen when the card is refused', async () => {
    globalThis.localStorage.clear();
    const root = await mountHash('');
    buttonNamed(root, 'Not now').click();
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
    expect(root.querySelector('.home-tour-card')).toBeNull();
  });

  it('takes the tour off the page when a link leaves its part', async () => {
    globalThis.localStorage.removeItem(TOUR_SEEN_KEY);
    const root = await mountHash('#/tutorial');
    followLink('#s=1&a=KSFO');
    await settled(() => {
      expect(stripText(root)).not.toContain('SWA1740');
    });
    expect(document.body.querySelector('.tour')).toBeNull();
    const hash = globalThis.location.hash;
    pressEscape();
    expect(globalThis.location.hash).toBe(hash);
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBeNull();
  });

  it('offers no tour card on home once a part of the tour was finished', async () => {
    globalThis.localStorage.removeItem(TOUR_SEEN_KEY);
    const root = await mountHash('#/tutorial');
    buttonNamed(tourCard(), 'Skip tour').click();
    await settled(() => {
      expect(root.querySelector('.home-page')).not.toBeNull();
    });
    expect(root.querySelector('.home-tour-card')).toBeNull();
  });

  it('starts a part from its first step on progress stored for the other part', async () => {
    const progress = { version: TOUR_STEPS_VERSION, part: 'amend', step: 3 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    await mountHash('#/tutorial');
    expect(tourCount()).toBe(`1 of ${CLEARANCE_TOUR.length}`);
  });

  it('opens the last step on a stored step past the end of the part', async () => {
    const progress = { version: TOUR_STEPS_VERSION, part: 'clearance', step: 99 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    await mountHash('#/tutorial');
    expect(tourCount()).toBe(`${CLEARANCE_TOUR.length} of ${CLEARANCE_TOUR.length}`);
  });

  it('opens the Amend part on JSX201 and walks its boxes to the clearance form', async () => {
    const root = await mountHash('#/tutorial/amend');
    expect(stripText(root)).toContain('JSX201');
    expect(tourCount()).toBe('1 of 6');
    buttonNamed(tourCard(), 'Next').click();
    for (const [at, box] of ['type', 'altitude', 'route'].entries()) {
      choose(answerOf(root, box), 'as_filed');
      expect(tourCount()).toBe(`${at + 3} of 6`);
    }
    anchored(root, 'boxes-submit').click();
    expect(tourCount()).toBe('6 of 6');
    expect(anchored(root, 'procedure')).toBeDefined();
    expect(anchored(root, 'routeTemplate')).toBeDefined();
    expect(globalThis.location.hash).toBe('#/tutorial/amend');
  });

  it('moves on from the clearance part to the Amend part', async () => {
    const progress = { version: TOUR_STEPS_VERSION, part: 'clearance', step: 10 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    globalThis.localStorage.removeItem(TOUR_SEEN_KEY);
    const root = await mountHash('#/tutorial');
    expect(tourCount()).toBe('11 of 11');
    expect(anchored(root, 'results')).toBeDefined();
    buttonNamed(tourCard(), 'Next: amending a flight plan').click();
    expect(globalThis.location.hash).toBe('#/tutorial/amend');
    expect(globalThis.localStorage.getItem(TOUR_PROGRESS_KEY)).toBeNull();
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBeNull();
  });

  it('moves on from the Amend part to the tour of home, whose Finish marks the tour seen', async () => {
    const progress = { version: TOUR_STEPS_VERSION, part: 'amend', step: 5 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    globalThis.localStorage.removeItem(TOUR_SEEN_KEY);
    const root = await mountHash('#/tutorial/amend');
    expect(tourCount()).toBe('6 of 6');
    expect(anchored(root, 'procedure')).toBeDefined();
    buttonNamed(tourCard(), 'Next: test yourself').click();
    expect(globalThis.location.hash).toBe('#/');
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
    expect(globalThis.localStorage.getItem(TOUR_PROGRESS_KEY)).toBeNull();
    followLink('#/');
    await settled(() => {
      expect(root.querySelector('.home-page')).not.toBeNull();
      expect(tourCount()).toBe('1 of 1');
    });
    const spot = document.querySelector('.tour-spot');
    expect(spot?.getAttribute('data-anchor')).toBe('home-test');
    buttonNamed(tourCard(), 'Finish').click();
    expect(document.querySelector('.tour-card')).toBeNull();
    expect(globalThis.localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
  });

  it('resumes the clearance part on the stored step, with the picks before it made', async () => {
    const progress = { version: TOUR_STEPS_VERSION, part: 'clearance', step: 5 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    const root = await mountHash('#/tutorial');
    expect(tourCount()).toBe('6 of 11');
    expect(selectOf(anchored(root, 'routeTemplate')).value).toBe('transition');
    expect(selectOf(anchored(root, 'routeFix')).value).toBe('SUSEY');
  });

  it('starts the part over on progress stored against another version of the steps', async () => {
    const progress = { version: TOUR_STEPS_VERSION + 1, part: 'clearance', step: 5 };
    globalThis.localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
    await mountHash('#/tutorial');
    expect(tourCount()).toBe('1 of 11');
  });
});

describe("the viewer's training stage", () => {
  const STAGE_KEY = 'craft-tester:training-stage';

  /** Remembers a stage for this browser, as the Training row will. */
  function viewerAt(stage: string): void {
    globalThis.localStorage.setItem(STAGE_KEY, JSON.stringify(stage));
  }

  /** Presses the toolbar's New strip. */
  function pressNewStrip(root: ParentNode): void {
    const found = [...root.querySelectorAll('button')].find(
      (node) => node.textContent === 'New strip',
    );
    if (found === undefined) throw new Error('the page has no New strip');
    found.click();
  }

  /** The text of the strip on screen. */
  function stripText(root: ParentNode): string {
    return root.querySelector('section.panel.strip')?.textContent ?? '';
  }

  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem(TOUR_SEEN_KEY, 'true');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws New strip under the viewer's stage", async () => {
    viewerAt('S1-OAK-2');
    const root = await mountHash('#s=1&a=KOAK');
    pressNewStrip(root);
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&t=day&st=S1-OAK-2&rwy=off$/);
  });

  it("opens a strip link as written, whatever the viewer's stage", async () => {
    const link = '#s=1&a=KOAK&t=day&st=S1-OAK-1';
    const asDrawn = stripText(await mountHash(link));
    expect(asDrawn).not.toBe('');
    viewerAt('S1-OAK-6');
    const root = await mountHash(link);
    expect(stripText(root)).toBe(asDrawn);
    expect(globalThis.location.hash).toBe(link);
    pressNewStrip(root);
    expect(globalThis.location.hash).toContain('&st=S1-OAK-6');
  });

  it("drops the stage of a link from an All-topics viewer's New strip", async () => {
    const root = await mountHash('#s=1&a=KOAK&t=day&st=S1-OAK-1');
    pressNewStrip(root);
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&t=day$/);
  });

  it('clamps a practice link with no stage of its own', async () => {
    viewerAt('S1-OAK-2');
    await mountHash('#/KOAK/amend/practice');
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&t=day&st=S1-OAK-2&rwy=off$/);
  });

  it('opens a practice link with a stage of its own as written', async () => {
    viewerAt('S1-OAK-2');
    await mountHash('#/KOAK/clearance/practice?st=S1-OAK-5');
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&st=S1-OAK-5$/);
  });

  it("lands New strip on the first open airport when the page's is still locked", async () => {
    viewerAt('S1-OAK-2');
    const root = await mountHash('#s=1&a=KSFO');
    pressNewStrip(root);
    await vi.waitFor(() => {
      expect(globalThis.location.hash).toMatch(/&a=KOAK&t=day&st=S1-OAK-2&rwy=off$/);
    });
  });

  it('stays at an open airport the index does not list first', async () => {
    viewerAt('S1-SFO-4');
    const root = await mountHash('#s=1&a=KOAK');
    pressNewStrip(root);
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&st=S1-SFO-4$/);
  });

  it('keeps the remembered Night through a filter change at a clamped time', async () => {
    const night = { time: 'night', config: { kind: 'any' } };
    globalThis.localStorage.setItem('craft-tester:filter:KOAK', JSON.stringify(night));
    viewerAt('S1-OAK-2');
    const root = await mountHash('#/KOAK/clearance/practice');
    choose(selectOf(field(root, 'runway configuration')), 'plan:SFOW');
    expect(globalThis.location.hash).toContain('&t=day&c=plan:SFOW&st=S1-OAK-2');
    const stored = globalThis.localStorage.getItem('craft-tester:filter:KOAK') ?? 'null';
    expect(JSON.parse(stored)).toEqual({ time: 'night', config: { kind: 'plan', plan: 'SFOW' } });
  });

  it("keeps home's airport and mode while a stage narrows the page", async () => {
    const home = { icao: 'KSFO', mode: 'amendment', format: 'test', n: 5, minutes: 0 };
    globalThis.localStorage.setItem('craft-tester:home', JSON.stringify(home));
    viewerAt('S1-OAK-2');
    await mountHash('#/KOAK/clearance/practice');
    const stored = globalThis.localStorage.getItem('craft-tester:home') ?? 'null';
    expect(JSON.parse(stored)).toEqual({ ...home, format: 'practice' });
  });

  /** What this browser remembers for home. */
  function storedHome(): unknown {
    return JSON.parse(globalThis.localStorage.getItem('craft-tester:home') ?? 'null');
  }

  /** Presses Start in the toolbar's Test popover. */
  function pressStart(root: ParentNode): void {
    const found = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Start');
    if (found === undefined) throw new Error('the page has no Start');
    found.click();
  }

  /** Picks an airport on the toolbar's switch. */
  function switchTo(root: ParentNode, icao: string): void {
    const select = root.querySelector('select.airport');
    if (!(select instanceof HTMLSelectElement)) throw new Error('the page has no airport switch');
    choose(select, icao);
  }

  it('moves a practice link with no stage off a locked airport', async () => {
    viewerAt('S1-OAK-2');
    await mountHash('#/KSFO/clearance/practice');
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&t=day&st=S1-OAK-2&rwy=off$/);
    expect(storedHome()).toMatchObject({ icao: 'KOAK', format: 'practice' });
  });

  it("drops the locked airport's configuration from the link it moves", async () => {
    viewerAt('S1-OAK-2');
    const root = await mountHash('#/KSFO/clearance/practice?c=id:28%2F01');
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KOAK&t=day&st=S1-OAK-2&rwy=off$/);
    expect(root.querySelector('section.panel.strip')).not.toBeNull();
  });

  it('moves a new test link with no stage off a locked airport', async () => {
    viewerAt('S1-OAK-2');
    const root = await mountHash('#/KSFO/clearance/test/5x0');
    const { hash } = globalThis.location;
    expect(hash).toMatch(/&a=KOAK&t=day&st=S1-OAK-2&rwy=off&x=[0-9a-z]+\.5\.0\.0$/);
    expect(setWhere(root)).toBe('Strip 1 of 5');
    const record = globalThis.localStorage.getItem(`craft-tester:set:${setSeedOf(hash)}`);
    expect(JSON.parse(record ?? 'null')).toMatchObject({ icao: 'KOAK', n: 5, minutes: 0 });
    expect(storedHome()).toMatchObject({ icao: 'KOAK', format: 'test', n: 5, minutes: 0 });
  });

  it('opens a link with a stage of its own at its own airport', async () => {
    viewerAt('S1-OAK-2');
    await mountHash('#/KSFO/clearance/practice?st=S1-OAK-2');
    expect(globalThis.location.hash).toMatch(/^#s=[0-9a-z]+&a=KSFO&st=S1-OAK-2$/);
  });

  it("starts a test at the first open airport when the page's is still locked", async () => {
    viewerAt('S1-OAK-2');
    const root = await mountHash('#s=1&a=KSFO&t=night&m=amend');
    pressStart(root);
    await vi.waitFor(() => {
      expect(globalThis.location.hash).toMatch(
        /&a=KOAK&t=day&st=S1-OAK-2&rwy=off&x=[0-9a-z]+\.\d+\.\d+\.0$/,
      );
    });
    expect(root.querySelector('.testbar')).not.toBeNull();
    expect(storedHome()).toMatchObject({ icao: 'KOAK', mode: 'clearance', format: 'test' });
  });

  it('clamps a test started at an open airport', async () => {
    viewerAt('S1-OAK-2');
    const root = await mountHash('#s=1&a=KOAK&t=night&m=amend');
    pressStart(root);
    expect(globalThis.location.hash).toMatch(
      /&a=KOAK&t=day&st=S1-OAK-2&rwy=off&x=[0-9a-z]+\.\d+\.\d+\.0$/,
    );
    expect(root.querySelector('.testbar')).not.toBeNull();
  });

  it('saves a whole filter change at All topics, as it always has', async () => {
    const day = { time: 'day', config: { kind: 'any' } };
    globalThis.localStorage.setItem('craft-tester:filter:KOAK', JSON.stringify(day));
    const root = await mountHash('#s=1&a=KOAK&t=night');
    choose(selectOf(field(root, 'runway configuration')), 'plan:SFOW');
    const stored = globalThis.localStorage.getItem('craft-tester:filter:KOAK') ?? 'null';
    expect(JSON.parse(stored)).toEqual({ time: 'night', config: { kind: 'plan', plan: 'SFOW' } });
  });

  it("draws under the viewer's stage after the toolbar's airport switch", async () => {
    viewerAt('S1-OAK-2');
    const root = await mountHash('#s=1&a=KSFO&t=night&m=amend');
    switchTo(root, 'KOAK');
    await vi.waitFor(() => {
      expect(globalThis.location.hash).toMatch(/^#s=1&a=KOAK&t=day&st=S1-OAK-2&rwy=off$/);
    });
  });

  it("drops the stage of a link from an All-topics viewer's airport switch", async () => {
    const root = await mountHash('#s=1&a=KOAK&t=day&st=S1-OAK-1');
    switchTo(root, 'KSFO');
    await vi.waitFor(() => {
      expect(globalThis.location.hash).toBe('#s=1&a=KSFO&t=day');
    });
  });

  it('keeps home clear of a locked airport or mode a link opens as written', async () => {
    const home = { icao: 'KOAK', mode: 'clearance', format: 'practice', n: 5, minutes: 0 };
    globalThis.localStorage.setItem('craft-tester:home', JSON.stringify(home));
    viewerAt('S1-OAK-2');
    await mountHash('#/KSFO/clearance/practice?st=S1-OAK-1');
    expect(storedHome()).toMatchObject({ icao: 'KOAK' });
    await mountHash('#/KOAK/amend/practice?st=S1-OAK-6');
    expect(storedHome()).toMatchObject({ mode: 'clearance' });
  });

  it('updates home with a mode the stage has opened', async () => {
    const home = { icao: 'KOAK', mode: 'clearance', format: 'practice', n: 5, minutes: 0 };
    globalThis.localStorage.setItem('craft-tester:home', JSON.stringify(home));
    viewerAt('S1-SFO-4');
    const root = await mountHash('#s=1&a=KOAK');
    segment(root, 'Mode', 'Amend').click();
    expect(storedHome()).toEqual({ ...home, mode: 'amendment' });
  });

  it('updates home with the airport when the stored one is open', async () => {
    const home = { icao: 'KSFO', mode: 'clearance', format: 'practice', n: 5, minutes: 0 };
    globalThis.localStorage.setItem('craft-tester:home', JSON.stringify(home));
    viewerAt('S1-SFO-1');
    await mountHash('#/KOAK/clearance/practice');
    expect(storedHome()).toEqual({ ...home, icao: 'KOAK' });
  });
});

describe('toolbarHiddenAfter', () => {
  it('hides the toolbar on a scroll down past the threshold', () => {
    expect(toolbarHiddenAfter(100, 400, 8)).toBe(true);
  });

  it('brings it back on a scroll up past the threshold', () => {
    expect(toolbarHiddenAfter(400, 300, 8)).toBe(false);
  });

  it('leaves it as it is on a move shorter than the threshold', () => {
    expect(toolbarHiddenAfter(400, 405, 8)).toBeUndefined();
    expect(toolbarHiddenAfter(400, 393, 8)).toBeUndefined();
  });

  it('shows it at the top of the page whatever the direction', () => {
    expect(toolbarHiddenAfter(0, 5, 8)).toBe(false);
    expect(toolbarHiddenAfter(3, 8, 8)).toBe(false);
  });
});
