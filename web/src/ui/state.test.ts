import { describe, expect, it } from 'vitest';
import { seedFromHash } from '@/scenario/rng.ts';
import type { DraftPicks } from '@/ui/state.ts';
import { applyPick, EMPTY_PICKS, shareLink, toPlayerPicks } from '@/ui/state.ts';

const full: DraftPicks = {
  clearedTo: 'KLAX',
  sidId: 'TRUKN2',
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'maintain',
  altitudeFeet: 10000,
  expect: 'ten_minutes',
  frequency: '120.9',
};

describe('applyPick', () => {
  it('clears the route element when the procedure changes, because its transitions change', () => {
    const next = applyPick(full, 'sidId', 'GAPP7');
    expect(next.sidId).toBe('GAPP7');
    expect(next.routeFix).toBeUndefined();
  });

  it('clears the altitude when the phrase speaks none', () => {
    const next = applyPick(full, 'altitudePhrase', 'climb_via');
    expect(next.altitudePhrase).toBe('climb_via');
    expect(next.altitudeFeet).toBeUndefined();
  });

  it('keeps the altitude when the phrase still speaks one', () => {
    expect(applyPick(full, 'altitudePhrase', 'climb_via_except').altitudeFeet).toBe(10000);
  });

  it('reads the altitude dropdown as feet', () => {
    expect(applyPick(EMPTY_PICKS, 'altitudeFeet', '3000').altitudeFeet).toBe(3000);
  });

  it('reads the blank option as no pick at all', () => {
    expect(applyPick(full, 'clearedTo', '').clearedTo).toBeUndefined();
    expect(applyPick(full, 'altitudeFeet', '').altitudeFeet).toBeUndefined();
  });

  it('ignores a value the schema does not know', () => {
    expect(applyPick(full, 'routeTemplate', 'sideways').routeTemplate).toBeUndefined();
    expect(applyPick(full, 'expect', 'eventually').expect).toBeUndefined();
  });
});

describe('toPlayerPicks', () => {
  it('refuses an untouched form', () => {
    expect(toPlayerPicks(EMPTY_PICKS)).toBeUndefined();
  });

  it('refuses a form whose route names no element', () => {
    expect(toPlayerPicks({ ...full, routeFix: undefined })).toBeUndefined();
  });

  it('refuses a form whose altitude phrase speaks feet it has not picked', () => {
    expect(toPlayerPicks({ ...full, altitudeFeet: undefined })).toBeUndefined();
  });

  it('accepts "climb via SID" without feet, and speaks none', () => {
    const picks = toPlayerPicks({ ...full, altitudePhrase: 'climb_via', altitudeFeet: undefined });
    expect(picks?.altitudePhrase).toBe('climb_via');
    expect(picks).not.toHaveProperty('altitudeFeet');
  });

  it('carries every pick through to grading', () => {
    expect(toPlayerPicks(full)).toStrictEqual({
      clearedTo: 'KLAX',
      sidId: 'TRUKN2',
      routeTemplate: 'transition',
      routeFix: 'DEDHD',
      altitudePhrase: 'maintain',
      altitudeFeet: 10000,
      expect: 'ten_minutes',
      frequency: '120.9',
    });
  });
});

describe('shareLink', () => {
  it('replaces whatever seed the URL carried', () => {
    expect(shareLink('https://leftos.dev/craft-tester/#s=zzzz', 1)).toBe(
      'https://leftos.dev/craft-tester/#s=1',
    );
  });

  it('round-trips a seed through the hash', () => {
    const seed = 3_735_928_559;
    const link = shareLink('https://leftos.dev/craft-tester/', seed);
    expect(seedFromHash(new URL(link).hash)).toBe(seed);
  });
});
