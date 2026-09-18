// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { InputKind, Mode } from '@/scenario/filter.ts';
import { ANY_SCENARIO, hashFor } from '@/scenario/filter.ts';
import { startApp } from '@/ui/app.ts';
import { selectOf, textAreaOf, textOf } from '@/ui/dom.ts';

/** A KSFO seed the amendment engine draws a plan to correct from. */
const AMENDMENT_SEED = 7;

/** A KSFO seed clearance mode draws a clean clearance from. */
const CLEARANCE_SEED = 1;

/**
 * Mounts the app on an empty page at one seed, in the half of the trainer and the input kind the
 * hash names; the dropdowns leave the input kind out of the hash, as every link to them does.
 */
async function mountApp(seed: number, mode: Mode, input: InputKind): Promise<Element> {
  globalThis.location.hash = hashFor('KSFO', seed, { filter: ANY_SCENARIO, mode, input });
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

/** Answers every box as filed and submits the strip, which opens the form on the corrected plan. */
function clearTheStrip(root: Element): void {
  for (const box of ['type', 'altitude', 'route']) choose(answerOf(root, box), 'as_filed');
  submitOf(root, '.panel.amend').click();
}

describe('the mounted page', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
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

    choose(selectOf(field(root, 'answer')), 'text');

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

    buttonNamed(root, 'Retry').click();
    typeInto(clearanceBox(root), reading);
    pressEnter(clearanceBox(root));

    const score = root.querySelector('.panel.results .score')?.textContent ?? '';
    expect(score.startsWith('8 of 8 elements correct')).toBe(true);
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
});
