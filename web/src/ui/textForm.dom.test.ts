// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextForm, TextFormProps } from '@/ui/textForm.ts';
import { renderTextForm } from '@/ui/textForm.ts';

/** What the handlers of one rendered box were called with. */
type Calls = { typed: string[]; submits: number };

/** Renders the box on some text, recording every call its handlers receive. */
function rendered(text: string): { form: TextForm; calls: Calls; props: TextFormProps } {
  const calls: Calls = { typed: [], submits: 0 };
  const props: TextFormProps = {
    text,
    onText: (value) => {
      calls.typed.push(value);
    },
    onSubmit: () => {
      calls.submits += 1;
    },
  };
  return { form: renderTextForm(props), calls, props };
}

/** The typing box of a rendered form. */
function areaOf(form: TextForm): HTMLTextAreaElement {
  const area = form.node.querySelector('textarea');
  if (area === null) throw new Error('the form has no typing box');
  return area;
}

/** The submit button of a rendered form. */
function submitOf(form: TextForm): HTMLButtonElement {
  const node = form.node.querySelector('button.primary');
  if (!(node instanceof HTMLButtonElement)) throw new Error('the form has no submit button');
  return node;
}

/** Presses Enter in the box, with or without Shift, and says whether the newline was prevented. */
function pressEnter(area: HTMLTextAreaElement, shiftKey: boolean): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey, cancelable: true });
  area.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('the typing box', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports every keystroke with what the box now holds', () => {
    const { form, calls } = rendered('');
    const area = areaOf(form);
    area.value = 'cleared to';
    area.dispatchEvent(new Event('input'));
    expect(calls.typed).toStrictEqual(['cleared to']);
  });

  it('submits on Enter instead of writing a newline', () => {
    const { form, calls } = rendered('cleared to');
    expect(pressEnter(areaOf(form), false)).toBe(true);
    expect(calls.submits).toBe(1);
  });

  it('submits on Shift+Enter too', () => {
    const { form, calls } = rendered('cleared to');
    expect(pressEnter(areaOf(form), true)).toBe(true);
    expect(calls.submits).toBe(1);
  });

  it('disables submit while the box holds nothing but whitespace', () => {
    expect(submitOf(rendered('').form).disabled).toBe(true);
    expect(submitOf(rendered('   ').form).disabled).toBe(true);
    expect(submitOf(rendered('cleared to').form).disabled).toBe(false);
  });

  it('follows the text through a sync', () => {
    const { form, props } = rendered('');
    form.sync({ ...props, text: 'cleared to' });
    expect(submitOf(form).disabled).toBe(false);
    form.sync({ ...props, text: '  ' });
    expect(submitOf(form).disabled).toBe(true);
  });

  it('keeps the same box through a sync and leaves an unchanged value alone', () => {
    const { form, props } = rendered('');
    const area = areaOf(form);
    area.value = 'cleared to';
    const write = vi.spyOn(HTMLTextAreaElement.prototype, 'value', 'set');

    form.sync({ ...props, text: 'cleared to' });

    expect(areaOf(form)).toBe(area);
    expect(area.value).toBe('cleared to');
    expect(write).not.toHaveBeenCalled();

    form.sync({ ...props, text: 'cleared to Portland' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(area.value).toBe('cleared to Portland');
  });
});
