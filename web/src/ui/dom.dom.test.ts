// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { SelectSpec } from '@/ui/dom.ts';
import { selectControl, selectOf } from '@/ui/dom.ts';

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
});
