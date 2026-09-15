import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { AirportDataSchema, FixtureSchema } from '#src/data/schema.ts';

const outputDir = new URL('../../data/schema/', import.meta.url);

/**
 * Recursively sorts every object key so the exported JSON Schema has a stable diff.
 *
 * Uses code-unit order rather than `localeCompare` so the output does not depend on the
 * machine's locale.
 *
 * @param value - Any JSON-representable value.
 * @returns The same value with object keys in ascending code-unit order.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
  }
  return value;
}

/**
 * Renders a JSON Schema as the bytes that get checked in.
 *
 * @param schema - The JSON Schema object produced by `z.toJSONSchema`.
 * @returns Sorted, two-space-indented JSON with a trailing newline.
 */
function serialize(schema: unknown): string {
  return `${JSON.stringify(sortKeys(schema), null, 2)}\n`;
}

await mkdir(outputDir, { recursive: true });

const targets = [
  { file: 'airport.schema.json', schema: z.toJSONSchema(AirportDataSchema) },
  { file: 'fixture.schema.json', schema: z.toJSONSchema(FixtureSchema) },
];

for (const target of targets) {
  const path = new URL(target.file, outputDir);
  await writeFile(path, serialize(target.schema), 'utf8');
  console.log(`wrote ${target.file}`);
}
