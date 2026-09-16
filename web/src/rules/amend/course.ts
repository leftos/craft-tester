import type { AirportIdentity, Destination } from '@/data/schema.ts';

/** A point on the globe, which is what both the airport row and a destination row carry. */
type Point = { lat: number; lon: number };

const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * Normalises a bearing into the `[0, 360)` range clearances are read in.
 *
 * @param degrees A bearing in degrees, which may be negative or past 360.
 * @returns The same bearing between 0 inclusive and 360 exclusive.
 */
function normalise(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The initial great-circle course from one point to another, in true degrees.
 *
 * This is the course the direction-of-flight rule is read against: the bearing the aircraft leaves
 * on, not the rhumb line, which is what 14 CFR 91.179 means by the course "to be flown".
 *
 * @param from The point the flight leaves, normally the departure airport.
 * @param to The point it is bound for, normally the destination airport.
 * @returns The initial true course in degrees, between 0 inclusive and 360 exclusive.
 */
export function trueCourse(from: Point, to: Point): number {
  const fromLat = from.lat / DEGREES_PER_RADIAN;
  const toLat = to.lat / DEGREES_PER_RADIAN;
  const deltaLon = (to.lon - from.lon) / DEGREES_PER_RADIAN;
  const east = Math.sin(deltaLon) * Math.cos(toLat);
  const north =
    Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return normalise(Math.atan2(east, north) * DEGREES_PER_RADIAN);
}

/**
 * The initial magnetic course from the airport to a destination.
 *
 * The airport's magnetic variation is east positive, and an easterly variation puts the magnetic
 * course that many degrees below the true one, so the variation is subtracted.
 *
 * @param airport The airport identity row, which carries the field's position and variation.
 * @param destination The destination row, which carries its position.
 * @returns The initial magnetic course in degrees, between 0 inclusive and 360 exclusive.
 */
export function magneticCourse(airport: AirportIdentity, destination: Destination): number {
  return normalise(trueCourse(airport, destination) - airport.magneticVariation);
}
