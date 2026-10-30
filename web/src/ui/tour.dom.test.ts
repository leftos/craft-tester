// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY } from '@/ui/dom.ts';
import type { TourDriver, TourEnd, TourOptions, TourStep } from '@/ui/tour.ts';
import { startTour } from '@/ui/tour.ts';

/** Three steps over the fake page: a plain one, a pick, and a submit. */
const STEPS: readonly TourStep[] = [
  { anchor: 'strip', title: 'The strip', body: 'Read the strip first.', advance: 'next' },
  {
    anchor: 'routeTemplate',
    title: 'The route',
    body: 'Pick how the route reads.',
    advance: { pick: 'routeTemplate', value: 'as_filed' },
  },
  { anchor: 'submit', title: 'Submit', body: 'Send the clearance.', advance: 'submit' },
];

/** Three plain steps, each moved on by Next. */
const NEXTS: readonly TourStep[] = [
  { anchor: 'strip', title: 'One', body: 'First.', advance: 'next' },
  { anchor: 'routeTemplate', title: 'Two', body: 'Second.', advance: 'next' },
  { anchor: 'submit', title: 'Three', body: 'Third.', advance: 'next' },
];

/** A box step, then a plain one to land on. */
const BOXES: readonly TourStep[] = [
  {
    anchor: 'box-route',
    title: 'The route box',
    body: 'Amend the route.',
    advance: { box: 'route', answer: { kind: 'amended', value: 'SUNOL V25 SAC' } },
  },
  { anchor: 'strip', title: 'Done', body: 'That is the box.', advance: 'next' },
];

/** A submit step, then the step the page moves on to. */
const SUBMITS: readonly TourStep[] = [
  { anchor: 'submit', title: 'Submit', body: 'Send the clearance.', advance: 'submit' },
  { anchor: 'strip', title: 'Results', body: 'Here is how it went.', advance: 'next' },
];

/** What the tour's callbacks were called with. */
type Calls = { steps: number[]; ends: TourEnd[] };

let driver: TourDriver | undefined;

/** Builds a small page with the anchors the steps name, and a button outside them. */
function fakePage(): void {
  document.body.replaceChildren();
  const page = document.createElement('main');
  const strip = document.createElement('div');
  strip.dataset['tour'] = 'strip';
  const select = document.createElement('select');
  select.dataset['tour'] = 'routeTemplate';
  const submit = document.createElement('button');
  submit.dataset['tour'] = 'submit';
  submit.textContent = 'Submit clearance';
  const box = document.createElement('div');
  box.dataset['tour'] = 'box-route';
  const before = document.createElement('button');
  before.id = 'before';
  before.textContent = 'Before';
  page.append(strip, select, submit, box, before);
  document.body.append(page);
}

/** Starts a tour on the given steps, recording every call its callbacks receive. */
function started(steps: readonly TourStep[], from = 0): { tour: TourDriver; calls: Calls } {
  const calls: Calls = { steps: [], ends: [] };
  const options: TourOptions = {
    steps,
    from,
    onStep: (index) => {
      calls.steps.push(index);
    },
    onEnd: (end) => {
      calls.ends.push(end);
    },
  };
  driver = startTour(options);
  return { tour: driver, calls };
}

/** The tour's card. */
function card(): HTMLElement {
  const node = document.querySelector('.tour-card');
  if (!(node instanceof HTMLElement)) throw new Error('the tour shows no card');
  return node;
}

/** The card's buttons, by their text. */
function cardButtons(): string[] {
  return [...card().querySelectorAll('button')].map((node) => node.textContent);
}

/** Presses the card's button with this text. */
function press(text: string): void {
  const node = [...card().querySelectorAll('button')].find((each) => each.textContent === text);
  if (node === undefined) throw new Error(`the card has no ${text} button`);
  node.click();
}

/** The "n of N" caption of the card. */
function caption(): string {
  return card().querySelector('.tour-count')?.textContent ?? '';
}

/** Every node the tour draws, wherever it sits. */
function tourNodes(): number {
  return document.querySelectorAll('.tour, .tour-spot, .tour-shield, .tour-card').length;
}

describe('the coach-mark tour', () => {
  beforeEach(() => {
    fakePage();
  });

  afterEach(() => {
    driver?.stop();
    driver = undefined;
    vi.restoreAllMocks();
  });

  it('opens on the step it is given, as a focused dialog', () => {
    const { calls } = started(STEPS, 1);
    expect(calls.steps).toStrictEqual([1]);
    expect(card().getAttribute('role')).toBe('dialog');
    expect(card().getAttribute('aria-label')).toBe('The route');
    expect(caption()).toBe('2 of 3');
    expect(document.activeElement).toBe(card());
  });

  it('moves on with Next and back with Back, with no Back on the first step', () => {
    const { calls } = started(NEXTS);
    expect(cardButtons()).not.toContain('Back');
    press('Next');
    expect(caption()).toBe('2 of 3');
    expect(calls.steps).toStrictEqual([0, 1]);
    press('Back');
    expect(caption()).toBe('1 of 3');
    expect(calls.steps).toStrictEqual([0, 1, 0]);
  });

  it('finishes on the last step and takes everything off the page', () => {
    const { calls } = started(NEXTS, 2);
    expect(cardButtons()).not.toContain('Next');
    press('Finish');
    expect(calls.ends).toStrictEqual(['finish']);
    expect(tourNodes()).toBe(0);
  });

  it('skips on Skip, and on Escape', () => {
    const skipped = started(NEXTS);
    press('Skip');
    expect(skipped.calls.ends).toStrictEqual(['skip']);
    expect(tourNodes()).toBe(0);

    const escaped = started(NEXTS);
    document
      .querySelector('[data-tour="strip"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(escaped.calls.ends).toStrictEqual(['skip']);
    expect(tourNodes()).toBe(0);
  });

  it('moves on from a pick step only on the right value, and shows a wrong one', () => {
    const { tour, calls } = started(STEPS, 1);
    expect(cardButtons()).not.toContain('Next');
    expect(card().querySelector('.wait')?.textContent).toBe('Waiting for your pick…');

    tour.picked('altitudePhrase', 'as_filed', null);
    expect(caption()).toBe('2 of 3');

    tour.picked('routeTemplate', 'direct', {
      said: 'via SUNOL then as filed',
      expected: 'via TRUKN then as filed',
      citations: ['SOP 4-2: routes leave as filed'],
    });
    expect(caption()).toBe('2 of 3');
    expect(calls.steps).toStrictEqual([1]);
    expect(card().querySelector('.wrong')?.textContent).toBe('SUNOL');
    expect(card().querySelector('.missed')?.textContent).toBe('TRUKN');
    expect(card().textContent).toContain('SOP 4-2: routes leave as filed');

    tour.picked('routeTemplate', 'as_filed', null);
    expect(caption()).toBe('3 of 3');
    expect(calls.steps).toStrictEqual([1, 2]);
    expect(card().querySelector('.wrong')).toBeNull();
  });

  it('moves on from a box step only on the right answer, and shows a wrong one', () => {
    const { tour, calls } = started(BOXES);
    tour.boxed(
      'route',
      { kind: 'as_filed' },
      {
        said: 'SUNOL V27 SAC',
        expected: 'SUNOL V25 SAC',
        citations: ['TEC: SUNOL V25'],
      },
    );
    expect(caption()).toBe('1 of 2');
    expect(card().querySelector('.wrong')?.textContent).toBe('V27');
    expect(card().querySelector('.missed')?.textContent).toBe('V25');

    tour.boxed('type', { kind: 'amended', value: 'SUNOL V25 SAC' }, null);
    expect(caption()).toBe('1 of 2');

    tour.boxed(
      'route',
      { kind: 'amended', value: 'SUNOL V27 SAC' },
      { said: 'SUNOL V27 SAC', expected: 'SUNOL V25 SAC', citations: [] },
    );
    expect(caption()).toBe('1 of 2');
    expect(card().querySelector('.wrong')?.textContent).toBe('V27');

    tour.boxed('route', { kind: 'amended', value: 'SUNOL V25 SAC' }, null);
    expect(caption()).toBe('2 of 2');
    expect(calls.steps).toStrictEqual([0, 1]);
  });

  it('moves on from a submit step on submitted, and ignores picks there', () => {
    const { tour, calls } = started(STEPS, 2);
    tour.picked('routeTemplate', 'as_filed', null);
    expect(calls.ends).toStrictEqual([]);
    expect(caption()).toBe('3 of 3');
    tour.submitted();
    expect(calls.ends).toStrictEqual(['finish']);
  });

  it('shields the page around a found anchor, and wholly while the anchor is missing', () => {
    started(NEXTS);
    expect(document.querySelectorAll('.tour-shield')).toHaveLength(4);
    expect(document.querySelector('.tour-spot')).not.toBeNull();
    expect(card().classList.contains('centred')).toBe(false);
    driver?.stop();

    const strip = document.querySelector('[data-tour="strip"]');
    strip?.remove();
    const { tour } = started(NEXTS);
    expect(document.querySelectorAll('.tour-shield')).toHaveLength(1);
    expect(document.querySelector('.tour-spot')).toBeNull();
    expect(card().classList.contains('centred')).toBe(true);
    expect(cardButtons()).toContain('Skip');

    if (strip !== null) document.querySelector('main')?.prepend(strip);
    tour.refresh();
    expect(document.querySelectorAll('.tour-shield')).toHaveLength(4);
    expect(card().classList.contains('centred')).toBe(false);
  });

  it('finds the anchor again on refresh after the page replaced it', () => {
    const { tour } = started(NEXTS);
    const old = document.querySelector('[data-tour="strip"]');
    old?.remove();
    tour.refresh();
    expect(document.querySelector('.tour-spot')).toBeNull();

    const fresh = document.createElement('div');
    fresh.dataset['tour'] = 'strip';
    const scroll = vi.spyOn(fresh, 'scrollIntoView');
    document.querySelector('main')?.prepend(fresh);
    tour.refresh();
    expect(document.querySelector('.tour-spot')?.getAttribute('data-anchor')).toBe('strip');
    expect(document.querySelectorAll('.tour-shield')).toHaveLength(4);
    expect(scroll).toHaveBeenCalledTimes(1);
    tour.refresh();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('stops without calling onEnd', () => {
    const { tour, calls } = started(NEXTS);
    tour.stop();
    expect(calls.ends).toStrictEqual([]);
    expect(tourNodes()).toBe(0);
  });

  it('gives focus back to what had it before the tour', () => {
    const before = document.querySelector<HTMLButtonElement>('#before');
    before?.focus();
    started(NEXTS);
    expect(document.activeElement).not.toBe(before);
    press('Skip');
    expect(document.activeElement).toBe(before);
  });

  it('shows Next on a pick step already done, going back to it', () => {
    const { tour, calls } = started(STEPS, 1);
    tour.picked('routeTemplate', 'as_filed', null);
    expect(caption()).toBe('3 of 3');
    press('Back');
    expect(caption()).toBe('2 of 3');
    expect(card().querySelector('.wait')).toBeNull();
    press('Next');
    expect(caption()).toBe('3 of 3');
    expect(calls.steps).toStrictEqual([1, 2, 1, 2]);
  });

  it('offers no Back on the step after a submit', () => {
    const { tour } = started(SUBMITS);
    tour.submitted();
    expect(caption()).toBe('2 of 2');
    expect(cardButtons()).not.toContain('Back');
  });

  it('takes itself off the page when onStep throws on the first step', () => {
    const ends: TourEnd[] = [];
    const options: TourOptions = {
      steps: NEXTS,
      from: 0,
      onStep: () => {
        throw new Error('storage is full');
      },
      onEnd: (end) => {
        ends.push(end);
      },
    };
    const docAdded = vi.spyOn(document, 'addEventListener');
    const docRemoved = vi.spyOn(document, 'removeEventListener');
    const winAdded = vi.spyOn(globalThis, 'addEventListener');
    const winRemoved = vi.spyOn(globalThis, 'removeEventListener');
    expect(() => startTour(options)).toThrow('storage is full');
    expect(tourNodes()).toBe(0);
    expect(ends).toStrictEqual([]);
    for (const [added, removed] of [
      [docAdded, docRemoved],
      [winAdded, winRemoved],
    ] as const) {
      expect(added.mock.calls.length).toBeGreaterThan(0);
      for (const [type, handler] of added.mock.calls) {
        const undone = removed.mock.calls.some(([t, h]) => t === type && h === handler);
        expect(undone, `the ${type} listener stays`).toBe(true);
      }
    }
  });

  it('keeps one card frame across steps, described by its live body', () => {
    started(NEXTS);
    const body = card().querySelector('.tour-body');
    expect(body?.getAttribute('aria-live')).toBe('polite');
    expect(body?.id).not.toBe('');
    expect(card().getAttribute('aria-describedby')).toBe(body?.id);
    press('Next');
    expect(card().querySelector('.tour-body')).toBe(body);
  });

  it('cycles Tab between the anchor control and the card buttons', () => {
    vi.spyOn(HTMLSelectElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 10, 120, 30),
    );
    started(NEXTS, 1);
    const select = document.querySelector('[data-tour="routeTemplate"]');
    const buttons = [...card().querySelectorAll('button')];
    const last = buttons.at(-1);
    last?.focus();
    last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement).toBe(select);
    select?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(last);
  });

  it('sends focus that lands outside the anchor and the card back to the card', () => {
    started(NEXTS);
    document.querySelector<HTMLButtonElement>('#before')?.focus();
    expect(document.activeElement).toBe(card());
  });

  it('lays the card out for a phone where the phone query matches', () => {
    vi.spyOn(globalThis, 'matchMedia').mockImplementation(
      (query) => ({ matches: query === PHONE_QUERY, media: query }) as MediaQueryList,
    );
    started(NEXTS);
    expect(card().classList.contains('phone')).toBe(true);
  });

  it('lays the card out for a wide screen where the phone query does not match', () => {
    vi.spyOn(globalThis, 'matchMedia').mockImplementation(
      (query) => ({ matches: false, media: query }) as MediaQueryList,
    );
    started(NEXTS);
    expect(card().classList.contains('phone')).toBe(false);
  });

  it('waits again on a finished pick step once a wrong value is picked there', () => {
    const { tour } = started(STEPS, 1);
    tour.picked('routeTemplate', 'as_filed', null);
    press('Back');
    expect(cardButtons()).toContain('Next');
    tour.picked('routeTemplate', 'direct', {
      said: 'via SUNOL then as filed',
      expected: 'via TRUKN then as filed',
      citations: [],
    });
    expect(cardButtons()).not.toContain('Next');
    expect(card().querySelector('.wait')?.textContent).toBe('Waiting for your pick…');
    tour.picked('routeTemplate', 'as_filed', null);
    expect(caption()).toBe('3 of 3');
  });
});
