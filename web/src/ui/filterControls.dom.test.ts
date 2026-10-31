// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AirportData } from '@/data/schema.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import { selectOf } from '@/ui/dom.ts';
import { filterControls, runwayGradingControl, stageControl } from '@/ui/filterControls.ts';
import { loadAirportData } from '@/ui/session.ts';

const STAGE = 'S1-OAK-2';

let koak: AirportData;

beforeAll(async () => {
  koak = await loadAirportData('KOAK');
});

/** The dropdown of a control the test expects to exist. */
function dropdown(control: HTMLElement | undefined): HTMLSelectElement {
  if (control === undefined) throw new Error('the control is missing');
  return selectOf(control);
}

/** The option of a dropdown that reads back a value. */
function optionOf(select: HTMLSelectElement, value: string): HTMLOptionElement {
  const found = [...select.options].find((option) => option.value === value);
  if (found === undefined) throw new Error(`the dropdown offers no ${value}`);
  return found;
}

/** Every option of a dropdown as its text and whether it is disabled, past its placeholder. */
function offered(select: HTMLSelectElement): [string | null, boolean][] {
  return [...select.options]
    .filter((option) => option.value !== '')
    .map((option) => [option.textContent, option.disabled]);
}

describe('filterControls', () => {
  it('locks Either and Night while night is closed', () => {
    const [time] = filterControls(ANY_SCENARIO, koak, vi.fn(), STAGE);
    expect(offered(dropdown(time))).toStrictEqual([
      ['Either (at S1-OAK-6)', true],
      ['Day', false],
      ['Night (at S1-OAK-6)', true],
    ]);
  });

  it('locks the blank Time choice, which reads as Either, while night is closed', () => {
    const [closed] = filterControls(ANY_SCENARIO, koak, vi.fn(), 'S1-OAK-1');
    expect(optionOf(dropdown(closed), '').disabled).toBe(true);
    const [open] = filterControls(ANY_SCENARIO, koak, vi.fn(), 'S1-OAK-6');
    expect(optionOf(dropdown(open), '').disabled).toBe(false);
  });

  it('locks the configurations and plans the stage has not opened', () => {
    const [, config] = filterControls(ANY_SCENARIO, koak, vi.fn(), STAGE);
    const select = dropdown(config);
    expect(optionOf(select, 'any').disabled).toBe(false);
    expect(optionOf(select, 'plan:SFOW').disabled).toBe(false);
    expect(optionOf(select, 'id:SFOW').disabled).toBe(false);
    for (const value of ['plan:OAKE', 'plan:SFOE', 'id:OAKE', 'id:SFOE']) {
      expect(optionOf(select, value).disabled).toBe(true);
      expect(optionOf(select, value).textContent).toMatch(/ \(at S1-OAK-6\)$/);
    }
  });

  it('locks nothing at All topics, or at a stage past every lock', () => {
    for (const stage of [undefined, 'S1-OAK-6']) {
      const controls = filterControls(ANY_SCENARIO, koak, vi.fn(), stage);
      const disabled = controls.flatMap((control) => [
        ...control.querySelectorAll('option[disabled]'),
      ]);
      expect(disabled).toHaveLength(0);
    }
  });
});

describe('runwayGradingControl', () => {
  it('locks Graded and shows Not graded while the runway is closed', () => {
    const select = dropdown(runwayGradingControl(false, vi.fn(), 'S1-OAK-3'));
    expect(select.value).toBe('off');
    expect(optionOf(select, 'graded').disabled).toBe(true);
    expect(optionOf(select, 'graded').textContent).toBe('Graded (at S1-OAK-3)');
    expect(optionOf(select, 'off').disabled).toBe(false);
  });

  it("shows the page's grading under a lock, with Graded still locked", () => {
    const select = dropdown(runwayGradingControl(true, vi.fn(), 'S1-OAK-3'));
    expect(select.value).toBe('graded');
    expect(optionOf(select, 'graded').disabled).toBe(true);
  });

  it('locks the blank choice, which reads as Graded, under a lock', () => {
    const locked = dropdown(runwayGradingControl(false, vi.fn(), 'S1-OAK-3'));
    expect(optionOf(locked, '').disabled).toBe(true);
    const open = dropdown(runwayGradingControl(false, vi.fn(), undefined));
    expect(optionOf(open, '').disabled).toBe(false);
  });

  it('offers both choices with no lock', () => {
    const select = dropdown(runwayGradingControl(true, vi.fn(), undefined));
    expect(select.value).toBe('graded');
    expect(optionOf(select, 'graded').disabled).toBe(false);
  });
});

describe('stageControl', () => {
  it('lists All topics, then every stage of the course, with the stage chosen', () => {
    const select = dropdown(stageControl(koak.training, STAGE, vi.fn()));
    expect(select.value).toBe(STAGE);
    expect(select.selectedOptions[0]?.textContent).toBe('S1-OAK-2 Clean Clearances');
    const texts = [...select.options].map((option) => option.textContent);
    expect(texts).toHaveLength(8);
    expect(texts[0]).toBe('All topics');
    expect(texts.slice(1)).toStrictEqual(
      koak.training.stages.map((stage) => `${stage.id} ${stage.title}`),
    );
  });

  it('reads All topics back as no stage, and a stage back as its id', () => {
    const onChange = vi.fn();
    const select = dropdown(stageControl(koak.training, STAGE, onChange));
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    select.value = 'S1-OAK-5';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith('S1-OAK-5');
  });

  it('names its dropdown for the focus a page drawn again restores', () => {
    const select = dropdown(stageControl(koak.training, STAGE, vi.fn()));
    expect(select.getAttribute('data-focus-key')).toBe('Training');
  });

  it('shows All topics for a stage the list lacks', () => {
    const select = dropdown(stageControl(koak.training, 'S1-OLD-9', vi.fn()));
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]?.textContent).toBe('All topics');
  });
});
