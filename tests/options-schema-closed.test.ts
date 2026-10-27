/** The published options schema refuses the keys render refuses. */
import { expect, it } from 'vitest';
import '../src/core/charts';
import { describeSchema } from '../src/core/discovery';
import { listCharts } from '../src/core/registry';

/** Paths of the objects that would take any key. */
function openObjects(node: unknown, path = ''): string[] {
  if (Array.isArray(node)) return node.flatMap((child, index) => openObjects(child, `${path}/${index}`));
  if (node === null || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  const open = record.type === 'object' && record.additionalProperties === undefined ? [path] : [];
  return [...open, ...Object.entries(record).flatMap(([key, child]) => openObjects(child, `${path}/${key}`))];
}

it('closes the options root and every nested options object', () => {
  const bar = describeSchema('bar', 'options').schema as unknown as { additionalProperties?: unknown; properties: { valueAxis: { additionalProperties?: unknown } } };
  expect(bar.additionalProperties).toBe(false);
  expect(bar.properties.valueAxis.additionalProperties).toBe(false);
  for (const { type } of listCharts()) expect(openObjects(describeSchema(type, 'options').schema), type).toEqual([]);
});
