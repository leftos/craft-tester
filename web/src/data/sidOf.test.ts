import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import type { AirportData } from '@/data/schema.ts';
import { sidOf } from '@/data/sidOf.ts';

const koak = koakJson as unknown as AirportData;

describe('sidOf', () => {
  it('finds the SID of a family at its current version', () => {
    const oak = sidOf(koak, 'OAK');
    expect(oak.family).toBe('OAK');
    expect(oak.id).toMatch(/^OAK\d$/);
  });

  it('throws for a family the airport does not publish', () => {
    expect(() => sidOf(koak, 'TRUKN')).toThrow(
      "TRUKN: no SID of that family in this airport's data",
    );
  });
});
