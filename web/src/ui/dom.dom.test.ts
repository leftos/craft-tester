// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { SegmentSpec, SelectSpec } from '@/ui/dom.ts';
import { segmentedControl, selectControl, selectOf } from '@/ui/dom.ts';

/** A dropdown of two choices, `a` and `b`, that reads `value` as first rendered. */
function specWith(value: string | undefined): SelectSpec {
  return {
    label: 'Choice',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
    value,
    disabled: false,
    placeholder: '(pick one)',
  };
}

describe('selectControl', () => {
  it('reads back the value it was built with', () => {
    const field = selectControl(specWith('b'), () => {});
    expect(selectOf(field).value).toBe('b');
  });

  it('reads back no pick when built without a value', () => {
    const field = selectControl(specWith(undefined), () => {});
    expect(selectOf(field).value).toBe('');
  });

  it('shows a locked option disabled, with the stage that opens it', () => {
    const spec: SelectSpec = {
      ...specWith('a'),
      options: [
        { value: 'a', label: 'Day' },
        { value: 'b', label: 'Night', locked: 'S1-OAK-6' },
      ],
    };
    const options = [...selectOf(selectControl(spec, () => {})).options];
    expect(options.map((option) => [option.textContent, option.disabled])).toStrictEqual([
      ['(pick one)', false],
      ['Day', false],
      ['Night (at S1-OAK-6)', true],
    ]);
  });

  it('disables the placeholder where the spec locks it', () => {
    const spec: SelectSpec = { ...specWith('a'), placeholderLocked: true };
    expect(selectOf(selectControl(spec, () => {})).options[0]?.disabled).toBe(true);
  });

  it('writes no lock into the markup of a dropdown with nothing locked', () => {
    const field = selectControl(specWith('a'), () => {});
    expect(field.querySelectorAll('option[disabled]')).toHaveLength(0);
  });
});

/** A segmented control of three choices, `a`, `b` and `c`, mounted on the page, and what it reported. */
function mountedSegments(value: string): { group: HTMLElement; changes: string[] } {
  const changes: string[] = [];
  const spec: SegmentSpec = {
    label: 'Letter',
    options: ['a', 'b', 'c'].map((letter) => ({
      value: letter,
      label: letter.toUpperCase(),
      title: '',
    })),
    value,
  };
  const group = segmentedControl(spec, (next) => changes.push(next));
  document.body.replaceChildren(group);
  return { group, changes };
}

/** A segmented control of Pick, Type and Full route, with the choices named locked. */
function lockedSegments(
  value: string,
  locked: readonly string[],
): { group: HTMLElement; changes: string[] } {
  const changes: string[] = [];
  const options = [
    { value: 'pick', label: 'Pick', title: 'Pick it' },
    { value: 'type', label: 'Type', title: 'Type it' },
    { value: 'full', label: 'Full route', title: 'Read it all' },
  ].map((option) => (locked.includes(option.value) ? { ...option, locked: 'S1-OAK-5' } : option));
  const spec: SegmentSpec = { label: 'Answer by', options, value };
  const group = segmentedControl(spec, (next) => changes.push(next));
  document.body.replaceChildren(group);
  return { group, changes };
}

/** The buttons of a segmented control, in order. */
function radiosOf(group: HTMLElement): HTMLButtonElement[] {
  return [...group.querySelectorAll('button')];
}

/** The aria-checked of every button of a segmented control, in order. */
function checkedOf(group: HTMLElement): (string | null)[] {
  return radiosOf(group).map((radio) => radio.getAttribute('aria-checked'));
}

/** Presses a key on a segmented control, the way the browser reports it. */
function press(group: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  radiosOf(group)[0]?.dispatchEvent(event);
  return event;
}

describe('segmentedControl', () => {
  it('is a named radio group with only the chosen button checked and tabbable', () => {
    const { group } = mountedSegments('b');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Letter');
    expect(radiosOf(group).map((radio) => radio.getAttribute('role'))).toStrictEqual([
      'radio',
      'radio',
      'radio',
    ]);
    expect(checkedOf(group)).toStrictEqual(['false', 'true', 'false']);
    expect(radiosOf(group).map((radio) => radio.tabIndex)).toStrictEqual([-1, 0, -1]);
  });

  it('moves the choice with the arrow keys, wrapping at the ends, and focuses it', () => {
    const { group, changes } = mountedSegments('c');

    const right = press(group, 'ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(checkedOf(group)).toStrictEqual(['true', 'false', 'false']);
    expect(document.activeElement).toBe(radiosOf(group)[0]);

    press(group, 'ArrowLeft');
    press(group, 'ArrowUp');
    press(group, 'ArrowDown');

    expect(changes).toStrictEqual(['a', 'c', 'b', 'c']);
    expect(checkedOf(group)).toStrictEqual(['false', 'false', 'true']);
  });

  it('leaves every other key to the browser', () => {
    const { group, changes } = mountedSegments('a');
    const tab = press(group, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(changes).toStrictEqual([]);
  });

  it('reports a click on another button and ignores one on the chosen button', () => {
    const { group, changes } = mountedSegments('a');
    radiosOf(group)[0]?.click();
    radiosOf(group)[2]?.click();
    expect(changes).toStrictEqual(['c']);
    expect(checkedOf(group)).toStrictEqual(['false', 'false', 'true']);
  });

  it('shows a locked choice disabled, with the stage that opens it', () => {
    const { group } = lockedSegments('pick', ['full']);
    const full = radiosOf(group)[2];
    expect(full?.disabled).toBe(true);
    expect(full?.classList.contains('locked')).toBe(true);
    expect(full?.textContent).toBe('🔒 Full route');
    expect(full?.querySelector('span.lock-glyph')?.textContent).toBe('🔒 ');
    expect(full?.title).toBe('at S1-OAK-5');
    expect(full?.getAttribute('aria-label')).toBe('Full route, at S1-OAK-5');
  });

  it('does nothing on a click on a locked choice', () => {
    const { group, changes } = lockedSegments('pick', ['full']);
    radiosOf(group)[2]?.click();
    expect(changes).toStrictEqual([]);
    expect(checkedOf(group)).toStrictEqual(['true', 'false', 'false']);
  });

  it('steps the arrow keys over a locked choice', () => {
    const { group, changes } = lockedSegments('type', ['full']);
    press(group, 'ArrowRight');
    expect(changes).toStrictEqual(['pick']);
    press(group, 'ArrowLeft');
    expect(changes).toStrictEqual(['pick', 'type']);
  });

  it('does nothing on an arrow key where no other choice is open', () => {
    const { group, changes } = lockedSegments('pick', ['type', 'full']);
    press(group, 'ArrowRight');
    press(group, 'ArrowLeft');
    expect(changes).toStrictEqual([]);
  });

  it('keeps the group in the tab order when the choice shown is locked', () => {
    const { group } = lockedSegments('full', ['full']);
    expect(radiosOf(group).map((radio) => radio.tabIndex)).toStrictEqual([0, -1, -1]);
  });

  it('writes no lock into the markup of a control with nothing locked', () => {
    const { group } = mountedSegments('a');
    const first = radiosOf(group)[0];
    expect(first?.disabled).toBe(false);
    expect(first?.className).toBe('');
    expect(first?.textContent).toBe('A');
    expect(first?.hasAttribute('aria-label')).toBe(false);
    expect(first?.hasAttribute('title')).toBe(false);
  });
});
