import { describe, expect, it } from 'vitest';
import airportsIndex from '@data/airports.json';
import ksfoJson from '@data/ksfo.json';
import { parseAirport, parseAirportsIndex } from '@/data/load.ts';

describe('parseAirport', () => {
  it('parses the generated KSFO data under the schema', () => {
    const airport = parseAirport(ksfoJson);
    expect(airport.airport.icao).toBe('KSFO');
    expect(airport.sids.length).toBeGreaterThan(0);
    expect(airport.assignmentRules.length).toBeGreaterThan(0);
    expect(airport.altitudeRules.length).toBeGreaterThan(0);
  });

  it('names the field that does not match the schema', () => {
    expect(() => parseAirport({ ...ksfoJson, sids: 'not an array' })).toThrow(/sids/);
  });

  it('rejects a document that is not an object at all', () => {
    expect(() => parseAirport(null)).toThrow(/airport data does not match the schema/);
  });
});

describe('parseAirportsIndex', () => {
  it('parses the checked-in index', () => {
    expect(parseAirportsIndex(airportsIndex)).toContainEqual({ icao: 'KSFO', file: 'ksfo.json' });
  });

  it('rejects an entry with no file', () => {
    expect(() => parseAirportsIndex([{ icao: 'KSFO' }])).toThrow(/file/);
  });
});
