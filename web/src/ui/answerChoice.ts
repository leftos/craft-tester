import type { Training } from '@/data/schema.ts';
import type { SegmentOption } from '@/ui/dom.ts';
import { stagedOption } from '@/ui/filterControls.ts';

/**
 * How the clearance is answered, as the toolbar and home offer it: picked from dropdowns, typed, or
 * typed and held to the route read to its end.
 */
export type AnswerChoice = 'pick' | 'type' | 'full';

/** One way to answer the clearance, as the toolbar and home offer it. */
type AnswerOption = SegmentOption & { value: AnswerChoice };

/** The three ways to answer the clearance, in the order the toolbar offers them. */
export const ANSWER_OPTIONS: readonly AnswerOption[] = [
  {
    value: 'pick',
    label: 'Pick',
    title: 'Pick each part of the clearance from dropdowns',
  },
  { value: 'type', label: 'Type', title: 'Type the clearance as spoken' },
  {
    value: 'full',
    label: 'Full route',
    title: 'Type it with the route read in full, as on a full route clearance (FRC)',
  },
];

/**
 * The ways to answer the clearance as a viewer's stage offers them.
 *
 * @param training The airport's training section.
 * @param stage The viewer's stage.
 * @returns The three choices, with Full route locked until the stage opens it.
 */
export function answerOptions(training: Training, stage: string | undefined): AnswerOption[] {
  const at = training.course.fullRoute;
  return ANSWER_OPTIONS.map((option) =>
    option.value === 'full' ? stagedOption(option, training, at, stage) : option,
  );
}
