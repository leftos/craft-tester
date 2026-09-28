// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import type { StripMarks } from '@/ui/strip.ts';
import { fitStrip, renderStrip, stripScale } from '@/ui/strip.ts';

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

  it('prints the paper inside the holder, with the nine annotation boxes marked for a phone', () => {
    const panel = renderStrip(FILED, ksfo, 1, 'Flight plan', AS_FILED);
    expect(panel.querySelector('.strip-holder > .strip-paper > .strip-grid')).not.toBeNull();
    expect(panel.querySelectorAll('.strip-grid > .strip-annotation')).toHaveLength(9);
    expect(panel.querySelector('.strip-head h2')?.textContent).toBe('Flight plan');
  });
});

/** Gives an element the laid-out size a browser would, which happy-dom does not compute. */
function laidOut(node: HTMLElement, sizes: Record<string, number>): void {
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(node, key, { configurable: true, value });
  }
}

describe('fitStrip', () => {
  it('scales the paper by the container width over the grid width it is laid out at', () => {
    const wrapper = document.createElement('div');
    const grid = document.createElement('div');
    wrapper.append(grid);
    // A phone: 360 px for the paper, whose annotation columns are hidden (438 px plus the border).
    laidOut(wrapper, { clientWidth: 360 });
    laidOut(grid, { offsetWidth: 440, offsetHeight: 76 });

    fitStrip(wrapper, grid);

    const scale = 360 / 440;
    expect(grid.style.transform).toBe(`scale(${scale})`);
    expect(Number.parseFloat(wrapper.style.height)).toBeCloseTo(76 * scale, 6);
  });

  it('prints the full paper at 1:1 where the container is wider than it', () => {
    const wrapper = document.createElement('div');
    const grid = document.createElement('div');
    laidOut(wrapper, { clientWidth: 552 });
    laidOut(grid, { offsetWidth: 537, offsetHeight: 76 });

    fitStrip(wrapper, grid);

    expect(grid.style.transform).toBe('scale(1)');
    expect(wrapper.style.height).toBe('76px');
  });
});

describe('stripScale', () => {
  it('is larger on the narrower phone paper than on the full one, and never above 1', () => {
    expect(stripScale(360, 440)).toBeCloseTo(0.818, 3);
    expect(stripScale(360, 537)).toBeCloseTo(0.67, 2);
    expect(stripScale(600, 537)).toBe(1);
  });
});
