import { describe, expect, it } from 'vitest';
import { checkedInAirports } from '@/data/checkedIn.ts';

describe('checkedInAirports', () => {
  it('finds the data file of every airport in the index', () => {
    expect(checkedInAirports().length).toBeGreaterThan(0);
  });

  it('parses each file as the airport the index says it holds', () => {
    const mismatched = checkedInAirports()
      .filter((entry) => entry.data.airport.icao !== entry.icao)
      .map((entry) => `${entry.icao}: file holds ${entry.data.airport.icao}`);
    expect(mismatched).toEqual([]);
  });

  it('lists each airport once', () => {
    const icaos = checkedInAirports().map((entry) => entry.icao);
    expect(icaos).toEqual([...new Set(icaos)]);
  });
});
