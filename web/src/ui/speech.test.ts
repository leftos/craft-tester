import { describe, expect, it } from 'vitest';
import { pickVoice, type VoiceLike } from '@/ui/speech.ts';

/** A voice as the browser lists it, written the short way a table of them reads. */
function voice(name: string, lang: string): VoiceLike {
  return { name, lang };
}

const DAVID = voice('Microsoft David - English (United States)', 'en-US');
const ZIRA = voice('Microsoft Zira - English (United States)', 'en-US');
const DAVID_DESKTOP = voice('Microsoft David Desktop - English (United States)', 'en-US');
const ARIA_NATURAL = voice('Microsoft Aria (Natural) - English (United States)', 'en-US');
const NATASHA_ONLINE = voice('Microsoft Natasha Online (Natural) - English (Australia)', 'en-AU');
const RYAN_NATURAL = voice('Microsoft Ryan (Natural) - English (United Kingdom)', 'en-GB');

describe('pickVoice', () => {
  it('takes the OneCore voice over the Desktop and Natural ones, wherever it sits in the list', () => {
    expect(pickVoice([ARIA_NATURAL, DAVID_DESKTOP, DAVID])).toBe(DAVID);
    expect(pickVoice([DAVID, DAVID_DESKTOP, ARIA_NATURAL])).toBe(DAVID);
    expect(pickVoice([DAVID_DESKTOP, ARIA_NATURAL, ZIRA])).toBe(ZIRA);
  });

  it('skips the online and natural voices while a plain local one is listed', () => {
    const plain = voice('eSpeak English (America)', 'en-US');
    const online = voice('Microsoft Ava Online (Natural) - English (United States)', 'en-US');
    expect(pickVoice([online, ARIA_NATURAL, plain])).toBe(plain);
  });

  it('ignores the voices of another English, even listed ahead of the American ones', () => {
    expect(pickVoice([NATASHA_ONLINE, RYAN_NATURAL, DAVID])).toBe(DAVID);
    expect(
      pickVoice([voice('Microsoft Mark - English (United Kingdom)', 'en-GB')]),
    ).toBeUndefined();
    expect(pickVoice([voice('Microsoft Neerja - English (India)', 'en-IN')])).toBeUndefined();
  });

  it('leaves the choice to the browser where no voice is listed', () => {
    expect(pickVoice([])).toBeUndefined();
  });

  it('leaves the choice to the browser where every American voice is a natural one', () => {
    expect(pickVoice([ARIA_NATURAL, NATASHA_ONLINE, RYAN_NATURAL])).toBeUndefined();
  });

  it('reads the language tag whatever its case', () => {
    const lower = voice('Microsoft Mark - English (United States)', 'en-us');
    expect(pickVoice([ARIA_NATURAL, lower])).toBe(lower);
    const upper = voice('Microsoft Mark - English (United States)', 'EN-US');
    expect(pickVoice([ARIA_NATURAL, upper])).toBe(upper);
  });
});
