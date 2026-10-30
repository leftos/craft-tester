import type { SegmentOption } from '@/ui/dom.ts';

/**
 * How the clearance is answered, as the toolbar and home offer it: picked from dropdowns, typed, or
 * typed and held to the route read to its end.
 */
export type AnswerChoice = 'pick' | 'type' | 'full';

/** The three ways to answer the clearance, in the order the toolbar offers them. */
export const ANSWER_OPTIONS: readonly (SegmentOption & { value: AnswerChoice })[] = [
  { value: 'pick', label: 'Pick', title: 'Pick each element from dropdowns' },
  { value: 'type', label: 'Type', title: 'Type the clearance as spoken' },
  {
    value: 'full',
    label: 'Full route',
    title: 'Type it with the route read in full, as on a full route clearance (FRC)',
  },
];
