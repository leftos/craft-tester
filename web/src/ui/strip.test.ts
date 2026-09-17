import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { routeLines, stripFields } from '@/ui/strip.ts';

const ksfo = ksfoJson as unknown as AirportData;

/** A filed plan with a suffix, a short route and no remarks, which fills every printed cell. */
const FILED: Scenario = {
  callsign: 'UAL313',
  aircraftType: 'B738',
  equipmentSuffix: '/L',
  destination: 'KLAS',
  filedRoute: 'SSTIK4 SNS',
  filedAltitude: 29000,
  runwayConfigId: '28 RT',
  departureRunway: '28L',
  localTime: '1246',
  dayOfWeek: 'tuesday',
  squawk: '4614',
};

/** A route long enough to need every line of the route cell. */
const LONG_ROUTE = 'SSTIK4 SNS PXN AVE EHF PMD CIVET4 DOTSS HAKMN TRIXI KEGGS BAYST';

/** The same airport with one fleet type stripped of the FAA category, as an unlisted type reads. */
function withoutCwt(airport: AirportData, type: string): AirportData {
  const fleet = airport.routeLibrary.fleet.map((entry) => {
    if (entry.type !== type) return entry;
    const unlisted = { ...entry };
    delete unlisted.cwt;
    return unlisted;
  });
  return { ...airport, routeLibrary: { ...airport.routeLibrary, fleet } };
}

describe('stripFields', () => {
  it('prints the FAA wake category of the type ahead of it', () => {
    expect(stripFields({ ...FILED, aircraftType: 'B77L' }, ksfo, 1).equipment).toBe('B/B77L/L');
    expect(stripFields(FILED, ksfo, 1).equipment).toBe('F/B738/L');
    expect(stripFields({ ...FILED, aircraftType: 'C172' }, ksfo, 1).equipment).toBe('I/C172/L');
  });

  it('prints no prefix for a type the FAA table does not list', () => {
    expect(stripFields(FILED, withoutCwt(ksfo, 'B738'), 1).equipment).toBe('B738/L');
  });

  it('prints a type filed without a suffix as the category and the bare designator', () => {
    expect(stripFields({ ...FILED, equipmentSuffix: null }, ksfo, 1).equipment).toBe('F/B738');
  });

  it('prints the requested altitude in hundreds of feet, three digits', () => {
    expect(stripFields({ ...FILED, filedAltitude: 9000 }, ksfo, 1).altitude).toBe('090');
    expect(stripFields({ ...FILED, filedAltitude: 17000 }, ksfo, 1).altitude).toBe('170');
    expect(stripFields({ ...FILED, filedAltitude: 29000 }, ksfo, 1).altitude).toBe('290');
  });

  it('prints the proposed departure time with its P', () => {
    expect(stripFields(FILED, ksfo, 1).proposed).toBe('P1246');
  });

  it('prints the beacon code and the departure with the destination', () => {
    const fields = stripFields(FILED, ksfo, 1);
    expect(fields.beacon).toBe('4614');
    expect(fields.depDest).toBe('KSFO KLAS');
  });

  it('derives a three-digit CID from the seed, the same one every time', () => {
    expect(stripFields(FILED, ksfo, 0).cid).toBe('100');
    expect(stripFields(FILED, ksfo, 5).cid).toBe('105');
    expect(stripFields(FILED, ksfo, 1234).cid).toBe('434');
    expect(stripFields(FILED, ksfo, 1234).cid).toBe(stripFields(FILED, ksfo, 1234).cid);
    for (const seed of [0, 1, 899, 900, 5723]) {
      expect(stripFields(FILED, ksfo, seed).cid, String(seed)).toMatch(/^\d{3}$/);
    }
  });

  it('draws the same barcode for a callsign every time, and another for another callsign', () => {
    const bars = stripFields(FILED, ksfo, 1).barcodeBars;
    expect(bars).toStrictEqual(stripFields(FILED, ksfo, 7).barcodeBars);
    expect(bars).not.toStrictEqual(
      stripFields({ ...FILED, callsign: 'SWA22' }, ksfo, 1).barcodeBars,
    );
  });

  it('draws a barcode of at least one bar and never more than 64', () => {
    for (const callsign of ['UAL313', 'SWA22', 'N172SP', 'FDX1234']) {
      const bars = stripFields({ ...FILED, callsign }, ksfo, 1).barcodeBars;
      expect(bars.length, callsign).toBeGreaterThan(0);
      expect(bars.length, callsign).toBeLessThanOrEqual(64);
    }
  });

  it('prints the route between the departure and the destination', () => {
    const fields = stripFields(FILED, ksfo, 1);
    expect(fields.routeLines).toStrictEqual(['KSFO SSTIK4 SNS KLAS']);
  });

  it('keeps the route to three lines, or two where the flight filed remarks', () => {
    const long = { ...FILED, filedRoute: LONG_ROUTE };
    expect(stripFields(long, ksfo, 1).routeLines.length).toBe(3);
    const withRemarks = stripFields({ ...long, remarks: 'REQ RWY 28' }, ksfo, 1);
    expect(withRemarks.routeLines.length).toBe(2);
    expect(withRemarks.remarks).toBe('REQ RWY 28');
  });

  it('prints no remarks where the flight filed none, or filed them empty', () => {
    expect(stripFields(FILED, ksfo, 1).remarks).toBeUndefined();
    expect(stripFields({ ...FILED, remarks: '' }, ksfo, 1).remarks).toBeUndefined();
  });

  it('prints the amendment number only on a strip that carries one', () => {
    expect(stripFields(FILED, ksfo, 1).revision).toBeUndefined();
    expect(stripFields(FILED, ksfo, 1, 1).revision).toBe(1);
  });
});

describe('routeLines', () => {
  it('prints a short route on one line', () => {
    expect(routeLines('KSFO', ['SSTIK4', 'SNS'], 'KLAX', 40, 3)).toStrictEqual([
      'KSFO SSTIK4 SNS KLAX',
    ]);
  });

  it('wraps a longer route across the lines of the cell', () => {
    expect(
      routeLines('KSFO', ['OSI', 'SAC', 'MOD', 'LIN', 'AVE', 'BURDE'], 'KLAX', 14, 3),
    ).toStrictEqual(['KSFO OSI SAC', 'MOD LIN AVE', 'BURDE KLAX']);
  });

  it('drops tokens from the tail of the body, with a *** in their place', () => {
    expect(
      routeLines('KSFO', ['OSI', 'SAC', 'MOD', 'LIN', 'AVE', 'BURDE'], 'KLAX', 14, 2),
    ).toStrictEqual(['KSFO OSI SAC', 'MOD *** KLAX']);
  });

  it('falls back to the departure and the destination alone', () => {
    expect(routeLines('KSFO', ['AAAAAAAAAA', 'BBBBBBBBBB'], 'KLAX', 13, 1)).toStrictEqual([
      'KSFO *** KLAX',
    ]);
  });

  it('prints a route with nothing filed between the airports', () => {
    expect(routeLines('KSFO', [], 'KLAX', 20, 3)).toStrictEqual(['KSFO KLAX']);
  });
});
