import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Destination } from '@/data/schema.ts';
import { magneticCourse, trueCourse } from '@/rules/amend/course.ts';

const ksfo = ksfoJson as unknown as AirportData;

function destination(icao: string): Destination {
  const found = ksfo.routeLibrary.destinations.find((entry) => entry.icao === icao);
  if (found === undefined) throw new Error(`${icao} is not in the route library`);
  return found;
}

describe('trueCourse', () => {
  it('is 090 to a point due east on the equator', () => {
    expect(trueCourse({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 6);
  });

  it('wraps a negative bearing into [0, 360)', () => {
    expect(trueCourse({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBeCloseTo(270, 6);
  });
});

describe('magneticCourse', () => {
  it('is northwesterly to Seattle, which is nearly due north of a field with 14 degrees east', () => {
    const course = magneticCourse(ksfo.airport, destination('KSEA'));
    expect(course).toBeGreaterThan(340);
    expect(course).toBeLessThan(352);
  });

  it('is northeasterly to Salt Lake City', () => {
    const course = magneticCourse(ksfo.airport, destination('KSLC'));
    expect(course).toBeGreaterThan(45);
    expect(course).toBeLessThan(60);
  });

  it('is southeasterly to Los Angeles', () => {
    const course = magneticCourse(ksfo.airport, destination('KLAX'));
    expect(course).toBeGreaterThan(118);
    expect(course).toBeLessThan(128);
  });
});
