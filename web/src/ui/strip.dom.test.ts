// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import type { StripMarks } from '@/ui/strip.ts';
import { renderStrip } from '@/ui/strip.ts';

const ksfo = ksfoJson as unknown as AirportData;

/** A filed plan with a short route, which the paper strip prints whole. */
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

/** A strip as filed: no amendment number, and no full route clearance. */
const AS_FILED: StripMarks = { revision: undefined, frc: false };

/** A route longer than the route cell prints, which the strip trims behind a `***`. */
const LONG_ROUTE = 'SSTIK4 SNS PXN AVE EHF PMD CIVET4 DOTSS HAKMN TRIXI KEGGS BAYST';

/** The text of one element of the rendered panel, or `undefined` where it drew none. */
function textOf(panel: HTMLElement, selector: string): string | undefined {
  return panel.querySelector(selector)?.textContent ?? undefined;
}

describe('renderStrip', () => {
  it('prints the RTE line under a trimmed strip and none under a whole one', () => {
    const trimmed = renderStrip(
      { ...FILED, filedRoute: LONG_ROUTE },
      ksfo,
      1,
      'Flight plan',
      AS_FILED,
    );
    expect(textOf(trimmed, '.strip-route')).toContain('***');
    expect(textOf(trimmed, '.strip-full-route-label')).toBe('RTE');
    expect(trimmed.querySelector('.strip-full-route-label')?.getAttribute('title')).toBe(
      'Full route',
    );
    expect(textOf(trimmed, '.strip-full-route-text')).toBe(LONG_ROUTE);

    const whole = renderStrip(FILED, ksfo, 1, 'Flight plan', AS_FILED);
    expect(textOf(whole, '.strip-route')).not.toContain('***');
    expect(whole.querySelector('.strip-full-route')).toBeNull();
  });
});
