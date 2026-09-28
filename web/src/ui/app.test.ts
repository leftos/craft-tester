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
import { picksProcedure, shareLink } from '@/ui/state.ts';

/** A KSFO seed the amendment engine draws a plan to correct from. */
const AMENDMENT_SEED = 7;

/**
 * A KSFO seed whose plan the engine fixes in the type box, with a route amendment as the other side
 * of the pair: a GL5T filed /U on SAHEY4, which the engine corrects to /L and a student may instead
 * put on GAPP7.
 */
const ALTERNATIVE_SEED = 107;

/** A KSFO seed clearance mode draws a clean clearance from. */
const CLEARANCE_SEED = 1;

/**
 * Mounts the app on an empty page at one seed, in the half of the trainer and the input kind the
 * hash names; the dropdowns leave the input kind out of the hash, as every link to them does.
 */
async function mountApp(seed: number, mode: Mode, input: InputKind): Promise<Element> {
  return mountSession(seed, { filter: ANY_SCENARIO, mode, input, fullRoute: false });
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

describe('the mounted page', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    const shape = selectOf(field(root, 'shape'));
    const element = selectOf(field(root, 'fix or airway'));
    expect(element.disabled).toBe(true);
    const template = firstChoice(shape);

    choose(shape, template);

    expect(selectOf(field(root, 'shape'))).toBe(shape);
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
    });
    expect(one.querySelector('details.filters .count')?.textContent).toBe('1');

    const both = await mountSession(CLEARANCE_SEED, {
      filter: { time: 'day', config: { kind: 'plan', plan: 'West' } },
      mode: 'clearance',
      input: 'dropdowns',
      fullRoute: false,
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
    } as const;
    const root = await mountSession(CLEARANCE_SEED, settings);
    const expected = shareLink(globalThis.location.href, 'KSFO', CLEARANCE_SEED, settings);

    const copy = root.querySelector(
      'section.panel.strip button[aria-label="Copy link to this strip"]',
    );
    if (!(copy instanceof HTMLButtonElement)) throw new Error('the strip has no copy-link button');
    copy.click();

    await vi.waitFor(() => {
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
    });

    root.querySelector<HTMLButtonElement>('button[aria-label="Copy link to this strip"]')?.click();

    await vi.waitFor(() => {
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
    );
    const wrong = clearancePickGrades(
      { ...somePicks, procedure: sid },
      clearance,
      airport,
      picksProcedure(clearance),
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
    const grades = clearancePickGrades(somePicks, clearance, airport, picksProcedure(clearance));
    expect(grades[0]).toMatchObject({ element: 'R.sid', verdict: 'wrong' });
  });

  it('grades no procedure on a strip whose clearance assigns a SID', async () => {
    const airport = await loadAirportData('KOAK');
    const clearance = await koakClearance(SID_SEED);
    const grades = clearancePickGrades(somePicks, clearance, airport, picksProcedure(clearance));
    expect(grades.map((grade) => grade.element)).not.toContain('R.sid');
    expect(grades).toHaveLength(5);
  });

  it('shows six graded rows, the procedure among them, once the strip is submitted', async () => {
    globalThis.localStorage.clear();
    const settings = { filter: ANY_SCENARIO, mode: 'clearance', input: 'dropdowns' } as const;
    const root = await mountHash(hashFor('KOAK', NO_DP_SEED, { ...settings, fullRoute: false }));
    const labels = ['shape', 'fix or airway', 'phrase', 'altitude', 'expect clause'];
    for (const label of [...labels, 'departure frequency', 'expect runway']) {
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
    const root = await mountHash(hashFor('KOAK', NO_DP_SEED, { ...settings, fullRoute: false }));

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
