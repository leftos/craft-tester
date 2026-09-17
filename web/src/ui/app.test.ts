// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Mode } from '@/scenario/filter.ts';
import { ANY_SCENARIO, hashFor } from '@/scenario/filter.ts';
import { startApp } from '@/ui/app.ts';
import { selectOf, textOf } from '@/ui/dom.ts';

/** A KSFO seed the amendment engine draws a plan to correct from. */
const AMENDMENT_SEED = 7;

/** Mounts the app on an empty page at one seed, in the half of the trainer the hash names. */
async function mountApp(seed: number, mode: Mode): Promise<Element> {
  globalThis.location.hash = hashFor('KSFO', seed, ANY_SCENARIO, mode);
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
    const root = await mountApp(AMENDMENT_SEED, 'amendment');
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
    const root = await mountApp(AMENDMENT_SEED, 'amendment');
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
    const root = await mountApp(AMENDMENT_SEED, 'amendment');
    const amend = root.querySelector('.panel.amend');
    expect(amend).not.toBeNull();
    expect(root.querySelector('.panel.craft')).toBeNull();

    clearTheStrip(root);

    expect(root.querySelector('.panel.amend')).toBeNull();
    expect(root.querySelector('.panel.craft')).not.toBeNull();
  });

  it('writes a pick into the dropdowns the form already built', async () => {
    const root = await mountApp(AMENDMENT_SEED, 'amendment');
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
});
