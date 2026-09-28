// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_SCENARIO, setFromHash } from '@/scenario/filter.ts';
import { startApp } from '@/ui/app.ts';
import { loadAirportData } from '@/ui/session.ts';
import { createSolvedStore } from '@/ui/solved.ts';
import { END_TEST_QUESTION } from '@/ui/testBar.ts';
import { setStripSeed } from '@/ui/testSet.ts';

const MINUTE = 60_000;

/** The moment every test starts at, so the clock reads the same on every run. */
const START = Date.UTC(2026, 8, 28, 12, 0, 0);

/** Mounts the app on an empty page from a hash written by hand. */
async function mountHash(hash: string): Promise<Element> {
  globalThis.location.hash = hash;
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  await startApp(root);
  return root;
}

/** The button of the page that reads one word. */
function buttonNamed(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((node) => node.textContent === label);
  if (found === undefined) throw new Error(`the page has no ${label} button`);
  return found;
}

/** The submit button of one panel. */
function submitOf(root: ParentNode, panel: string): HTMLButtonElement {
  const node = root.querySelector(`${panel} button.primary`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`${panel} has no submit button`);
  return node;
}

/** The test bar, which fails the test where the page shows none. */
function testBar(root: ParentNode): HTMLElement {
  const bar = root.querySelector('.testbar[role="status"]');
  if (!(bar instanceof HTMLElement)) throw new Error('the page has no test bar');
  return bar;
}

/** What the test bar says about where the set is, e.g. `Strip 2 of 5`. */
function whereOf(root: ParentNode): string {
  return testBar(root).querySelector('.where')?.textContent ?? '';
}

/** What the test bar's clock reads. */
function clockOf(root: ParentNode): string {
  return testBar(root).querySelector('.clock')?.textContent ?? '';
}

/** The class of every progress square, in order. */
function squaresOf(root: ParentNode): string[] {
  return [...testBar(root).querySelectorAll('.dots > *')].map((node) => node.className);
}

/** Opens the Test popover, picks the count and the time by the words on them, and presses Start. */
function startTest(root: ParentNode, strips: string, time: string): void {
  const details = root.querySelector('details.test-start');
  if (!(details instanceof HTMLDetailsElement)) throw new Error('the toolbar has no Test button');
  expect(details.querySelector('summary')?.textContent).toBe('Test');
  details.open = true;
  buttonNamed(details, strips).click();
  buttonNamed(details, time).click();
  buttonNamed(details, 'Start').click();
}

/** Types a clearance into the strip on screen and submits it. */
function answerStrip(root: ParentNode): void {
  const area = root.querySelector('.panel.typed textarea');
  if (!(area instanceof HTMLTextAreaElement)) throw new Error('the strip has no typing box');
  area.value = 'cleared to the airport as filed';
  area.dispatchEvent(new Event('input'));
  submitOf(root, '.panel.typed').click();
}

/** Mounts a typed session at KSFO and starts a set on it. */
async function startedSet(strips: string, time: string): Promise<Element> {
  const root = await mountHash('#a=KSFO&i=text');
  startTest(root, strips, time);
  return root;
}

describe('a test set', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('Start opens strip 1 of N with the test bar in place of the toolbar', async () => {
    const root = await startedSet('5', '20 min');

    expect(root.querySelector('header.toolbar[aria-label="Session"]')).toBeNull();
    expect(testBar(root).getAttribute('aria-label')).toBe('Test in progress');
    expect(whereOf(root)).toBe('Strip 1 of 5');
    expect(clockOf(root)).toBe('20:00');
    expect(testBar(root).querySelector('.clock')?.getAttribute('aria-label')).toBe('Time left');
    expect(squaresOf(root)).toEqual(['now', '', '', '', '']);
    expect(buttonNamed(root, 'Skip').className).toBe('secondary');
    expect(buttonNamed(testBar(root), 'End test')).toBeDefined();
    expect(root.querySelector('[aria-label^="Copy link"]')).toBeNull();
    expect(setFromHash(globalThis.location.hash)).toMatchObject({ n: 5, minutes: 20, index: 0 });
  });

  it('ticks the clock every second without drawing the page again', async () => {
    const root = await startedSet('5', '10 min');
    const area = root.querySelector('.panel.typed textarea');

    vi.advanceTimersByTime(1000);

    expect(clockOf(root)).toBe('09:59');
    expect(root.querySelector('.panel.typed textarea')).toBe(area);
  });

  it('counts an untimed set up, as time used', async () => {
    const root = await startedSet('5', 'Untimed');

    vi.advanceTimersByTime(65_000);

    expect(clockOf(root)).toBe('01:05');
    expect(testBar(root).querySelector('.clock')?.getAttribute('aria-label')).toBe('Time used');
  });

  it('submitting a strip shows no results and moves to the next', async () => {
    const root = await startedSet('5', '20 min');

    answerStrip(root);

    expect(root.querySelector('.panel.results')).toBeNull();
    expect(root.textContent).not.toContain('Next strip');
    expect(whereOf(root)).toBe('Strip 2 of 5');
    expect(squaresOf(root)).toEqual(['done', 'now', '', '', '']);
    const storage = globalThis.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '');
    const solved = keys.filter((key) => key.startsWith('craft-tester:solved:KSFO:text:'));
    expect(solved).toHaveLength(1);
  });

  it('Skip marks the square skipped and it can be pressed to return', async () => {
    const root = await startedSet('5', '20 min');

    buttonNamed(root, 'Skip').click();

    expect(whereOf(root)).toBe('Strip 2 of 5');
    const square = root.querySelector('button[aria-label="Strip 1, skipped"]');
    expect(square).toBeInstanceOf(HTMLButtonElement);
    expect(squaresOf(root)).toEqual(['skipped', 'now', '', '', '']);
    (square as HTMLButtonElement).click();
    expect(whereOf(root)).toBe('Strip 1 of 5');
    expect(root.querySelector('.panel.revisit')).toBeNull();
  });

  it('after the last strip the set returns to the first skipped strip', async () => {
    const root = await startedSet('5', '20 min');
    buttonNamed(root, 'Skip').click();
    answerStrip(root);
    buttonNamed(root, 'Skip').click();
    answerStrip(root);

    answerStrip(root);

    expect(whereOf(root)).toBe('Strip 1 of 5');
    expect(squaresOf(root)).toEqual(['now', 'done', 'skipped', 'done', 'done']);
    answerStrip(root);
    expect(whereOf(root)).toBe('Strip 3 of 5');
    answerStrip(root);
    expect(root.querySelector('.set-summary h2')?.textContent).toBe('Test results');
  });

  it('time up opens the summary', async () => {
    const root = await startedSet('10', '10 min');
    const area = root.querySelector('.panel.typed textarea') as HTMLTextAreaElement;
    area.value = 'half typed';
    area.dispatchEvent(new Event('input'));

    vi.advanceTimersByTime(10 * MINUTE);

    expect(root.querySelector('.set-summary h2')?.textContent).toBe('Test results');
    expect(root.querySelector('.set-summary .score')?.textContent).toMatch(
      /^0 of 10 strips fully correct · 0% of elements$/,
    );
    expect(root.querySelector('.set-summary')?.textContent).toContain('Time used 10:00');
    expect(testBar(root).querySelector('.clock')?.textContent).toBe('10:00');
    expect(buttonNamedOrNull(testBar(root), 'End test')).toBeUndefined();
  });

  it('End test asks first and cancelling keeps the set', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const root = await startedSet('5', '20 min');

    buttonNamed(testBar(root), 'End test').click();

    expect(confirm).toHaveBeenCalledWith(END_TEST_QUESTION);
    expect(whereOf(root)).toBe('Strip 1 of 5');
    confirm.mockReturnValue(true);
    buttonNamed(testBar(root), 'End test').click();
    expect(root.querySelector('.set-summary')).not.toBeNull();
  });

  it('the summary shows both totals and a link per strip', async () => {
    vi.stubGlobal('confirm', () => true);
    const root = await startedSet('5', '20 min');
    answerStrip(root);
    vi.advanceTimersByTime(90_000);

    buttonNamed(testBar(root), 'End test').click();

    const summary = root.querySelector('.set-summary');
    expect(summary?.querySelector('.score')?.textContent).toMatch(
      /^[01] of 5 strips fully correct · \d+% of elements$/,
    );
    expect(summary?.textContent).toContain('Time used 01:30');
    const rows = [...(summary?.querySelectorAll('.set-rows li') ?? [])];
    expect(rows).toHaveLength(5);
    expect(rows[0]?.querySelector('.set-line')?.textContent).toMatch(/elements correct/);
    expect(rows[1]?.querySelector('.set-line')?.textContent).toBe('Unanswered');
    const links = rows.map((row) => row.querySelector('a')?.getAttribute('href') ?? '');
    expect(links.every((href) => href.startsWith('#s=') && !href.includes('x='))).toBe(true);
    expect(new Set(links).size).toBe(5);

    buttonNamed(root, 'New strip').click();
    expect(root.querySelector('.testbar')).toBeNull();
    expect(globalThis.location.hash).not.toContain('x=');
  });

  it('reloading with x= resumes at the same strip with the same clock', async () => {
    const first = await startedSet('5', '10 min');
    answerStrip(first);
    vi.advanceTimersByTime(2 * MINUTE);
    const hash = globalThis.location.hash;
    // Clearing the first page's clock resets the fake clock too, so it is set back to the reload's time.
    vi.clearAllTimers();
    vi.setSystemTime(START + 2 * MINUTE);

    const root = await mountHash(hash);

    expect(whereOf(root)).toBe('Strip 2 of 5');
    expect(clockOf(root)).toBe('08:00');
    expect(squaresOf(root)).toEqual(['done', 'now', '', '', '']);
  });

  it('amendment: answered boxes show no verdicts and no amended strip in a set', async () => {
    const root = await mountHash('#a=KSFO&m=amend&x=b.5.20.0');

    answerBoxesAsFiled(root);

    expect(root.querySelector('.panel.craft')).not.toBeNull();
    expect(root.textContent).not.toContain('Amendments');
    expect(root.textContent).not.toContain('Amended flight plan');
    expect(buttonNamedOrNull(root, 'Submit amendments')).toBeUndefined();
    expect(root.querySelectorAll('section.panel.strip')).toHaveLength(1);
  });

  it('amendment in a set shows boxes and clearance on one screen with one Submit', async () => {
    const root = await mountHash('#a=KSFO&m=amend&x=b.5.20.0');

    const work = root.querySelector('section.work');
    if (!(work instanceof HTMLElement)) throw new Error('the page has no work column');
    expect(work.firstElementChild?.matches('.panel.amend')).toBe(true);
    expect(work.querySelector('.panel.craft')).not.toBeNull();
    const primaries = [...work.querySelectorAll('button.primary')].map((node) => node.textContent);
    expect(primaries).toEqual(['Submit clearance']);
    const skips = [...work.querySelectorAll('button')].filter(
      (node) => node.textContent === 'Skip',
    );
    expect(skips).toHaveLength(1);
    expect(root.querySelectorAll('section.panel.strip')).toHaveLength(1);
  });

  it('amendment in a set grades boxes and clearance from one submit and moves to the next strip with no results', async () => {
    vi.stubGlobal('confirm', () => true);
    const root = await mountHash('#a=KSFO&m=amend&i=text&x=b.5.20.0');
    const area = root.querySelector('.panel.typed textarea') as HTMLTextAreaElement;
    area.value = 'cleared to the airport as filed';
    area.dispatchEvent(new Event('input'));

    submitOf(root, '.panel.typed').click();
    expect(whereOf(root)).toBe('Strip 1 of 5');
    answerBoxesAsFiled(root);
    submitOf(root, '.panel.typed').click();

    expect(whereOf(root)).toBe('Strip 2 of 5');
    expect(squaresOf(root)).toEqual(['done', 'now', '', '', '']);
    expect(root.querySelector('.panel.results')).toBeNull();
    expect(root.textContent).not.toContain('Amended flight plan');
    expect(root.querySelector('.panel.amend')).not.toBeNull();
    buttonNamed(testBar(root), 'End test').click();
    const line = root.querySelector('.set-summary .set-rows li .set-line')?.textContent;
    expect(line).toMatch(/of 3 flight plan checks \/ amendments correct, .*CRAFT clearance/);
  });

  it('amendment in a set keeps Submit disabled while a box is open', async () => {
    const root = await mountHash('#a=KSFO&m=amend&i=text&x=b.5.20.0');
    const area = root.querySelector('.panel.typed textarea') as HTMLTextAreaElement;
    const submit = submitOf(root, '.panel.typed');
    area.value = 'cleared to the airport as filed';
    area.dispatchEvent(new Event('input'));

    expect(submit.disabled).toBe(true);
    answerBoxesAsFiled(root);
    expect(submitOf(root, '.panel.typed')).toBe(submit);
    expect(submit.disabled).toBe(false);
  });

  it('the summary grades answered strips when storage throws', async () => {
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal('localStorage', throwingStorage());
    const root = await startedSet('5', '20 min');
    answerStrip(root);

    buttonNamed(testBar(root), 'End test').click();

    const rows = [...root.querySelectorAll('.set-summary .set-rows li .set-line')];
    expect(rows[0]?.textContent).toMatch(/elements correct/);
    expect(rows[1]?.textContent).toBe('Unanswered');
  });

  it('a set strip already solved does not open as revisit', async () => {
    const airport = await loadAirportData('KSFO');
    const settings = { filter: ANY_SCENARIO, mode: 'clearance' as const, input: 'text' as const };
    const { seed } = setStripSeed(airport, 10, 0, { ...settings, fullRoute: false });
    const store = createSolvedStore(globalThis.localStorage);
    store.save('KSFO', seed, { kind: 'clearance', input: 'text', text: 'as filed' }, false);

    const root = await mountHash('#a=KSFO&i=text&x=a.5.20.0');

    expect(whereOf(root)).toBe('Strip 1 of 5');
    expect(root.querySelector('.panel.revisit')).toBeNull();
    expect(root.querySelector('.panel.typed textarea')).not.toBeNull();
  });
});

/** Answers every strip box of the amendment on screen as filed. */
function answerBoxesAsFiled(root: ParentNode): void {
  for (const select of root.querySelectorAll('.amend-box select')) {
    (select as HTMLSelectElement).value = 'as_filed';
    select.dispatchEvent(new Event('change'));
  }
}

/** A storage that throws on every access, as a browser in private mode may. */
function throwingStorage(): Storage {
  const refuse = (): never => {
    throw new Error('storage is unavailable');
  };
  return {
    length: 0,
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
    key: refuse,
    clear: refuse,
  };
}

/** The button of an element that reads one word, or `undefined` where it has none. */
function buttonNamedOrNull(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((node) => node.textContent === label);
}
