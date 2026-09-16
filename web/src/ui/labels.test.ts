import { describe, expect, it } from 'vitest';
import type { ClearanceElement } from '@/rules/types.ts';
import { aircraftLabel, dayLabel, elementLabel, timeLabel } from '@/ui/labels.ts';

describe('elementLabel', () => {
  it('names every element and every strip box', () => {
    const elements: ClearanceElement[] = [
      'R.sid',
      'R.route',
      'A.phrase',
      'A.expect',
      'F',
      'RWY',
      'BOX.type',
      'BOX.altitude',
      'BOX.route',
    ];
    expect(elements.map((element) => elementLabel(element))).toStrictEqual([
      'R — procedure',
      'R — route',
      'A — altitude',
      'A — expect',
      'F — frequency',
      'expect runway',
      'strip — type',
      'strip — altitude',
      'strip — route',
    ]);
  });
});

describe('strip labels', () => {
  it('capitalizes the day', () => {
    expect(dayLabel('sunday')).toBe('Sunday');
  });

  it('writes the local time with its day', () => {
    expect(timeLabel('2215', 'saturday')).toBe('2215L Saturday');
  });

  it('writes the type with the suffix the data already punctuates', () => {
    expect(aircraftLabel('B738', '/L')).toBe('B738/L');
  });
});
