/**
 * One rule for unknown option keys on every type. zod strips an
 * unknown key from a plain object without a word, so `{ notAThing: 1 }` on a
 * column drew the default while diagram and creative refused the same key.
 * Every registered type now refuses an invented top-level key, and an
 * invented key inside each object option its fixtures author, with
 * unknown-option and a suggestion that names a close key or removes the key. CLI, MCP and
 * the React spec path share the check (validateChartInput); the top-level
 * key is sent through all three.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { main } from '../src/cli/main';
import { callTool } from '../src/mcp/server';
import { beginSpecParse } from '../src/react/specValidation';
import { getFixtures } from '../src/fixtures';
import { getChartDefinition, listCharts } from '../src/core/registry';
import { LABEL_KINDS } from '../src/core/schema/capability';
import { wordUnknownKeys } from '../src/core/schema/unknownKeyWords';
import type { OptionKeyTree } from '../src/core/schema/unknownKeys';

const INVENTED = 'zzInvented';
const NAMES_A_KEY = /^(Rename '[^']+' to '[^']+'\.|Remove '[^']+'; this key is not supported here\.)$/;

interface Finding { code: string; path?: string; suggest?: string; message: string }

function reactErrors(spec: object): Finding[] {
  // The CLI import registers every schema, so the React spec parse finishes without loading any.
  try {
    beginSpecParse(spec).finish();
    return [];
  } catch (error) {
    return (error as { errors?: Finding[] }).errors ?? [];
  }
}

const directory = mkdtempSync(join(tmpdir(), 'boardplot-unknown-option-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function cliErrors(spec: object): { code: number; errors: Finding[] } {
  const path = join(directory, 'spec.json');
  writeFileSync(path, JSON.stringify(spec));
  const output: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
  const code = main(['render', path]);
  log.mockRestore();
  return { code, errors: (JSON.parse(output.join('\n')) as { errors: Finding[] }).errors };
}

const types = listCharts().map((chart) => chart.type);

describe('unknown option keys are refused on every type', () => {
  it('refuses averageMarker on line with the supported mean annotation in the fix', () => {
    const fixture = getFixtures('line').find(fixture => fixture.id === 'multiline-arr-endpoint-cagr')!;
    const spec = { type: 'line', data: fixture.data, options: { ...fixture.options, averageMarker: true } };
    const suggest = "Remove 'averageMarker'; add { kind: 'valueLine', value: 'mean' } to annotations instead.";
    for (const finding of [cliErrors(spec).errors, reactErrors(spec)]) {
      expect(finding).toContainEqual(expect.objectContaining({ code: 'unknown-option', suggest }));
    }
    const tree: OptionKeyTree = { annotations: 0, categoryAxis: { crossesBetween: 0 } };
    expect(wordUnknownKeys([{ path: ['averageMarker'], node: tree }], tree)[0]!.suggest).toBe(suggest);
    const other: OptionKeyTree = { annotations: 0 };
    expect(wordUnknownKeys([{ path: ['averageMarker'], node: other }], other)[0]!.suggest).not.toContain('valueLine');
  });
  // options.width answered "Rename 'width' to 'embed'"; embed changes no geometry, size.width does.
  it('points options.width at options.size.width', () => {
    const tree: OptionKeyTree = { embed: { width: 0 }, size: { width: 0, height: 0 } };
    expect(wordUnknownKeys([{ path: ['width'], node: tree }], tree)[0]!.suggest).toBe("Remove 'width' here and set options.size.width instead.");
  });
  it.each(types)('%s refuses an invented top-level key through CLI, MCP and the React spec path', (type) => {
    const fixture = getFixtures(type)[0]!;
    const spec = { type, data: fixture.data, options: { ...fixture.options, [INVENTED]: 1 } };
    const isRefusal = (finding: Finding) =>
      finding.code === 'unknown-option' && finding.path?.endsWith(`/options/${INVENTED}`) && NAMES_A_KEY.test(finding.suggest ?? '');

    expect(reactErrors(spec).some(isRefusal), 'React spec path').toBe(true);
    const mcp = JSON.parse(callTool('boardplot_render', { spec }).text) as { ok: boolean; errors: Finding[] };
    expect(mcp.ok, 'MCP').toBe(false);
    expect(mcp.errors.some(isRefusal), 'MCP').toBe(true);
    const cli = cliErrors(spec);
    expect(cli.code, 'CLI').toBe(1);
    expect(cli.errors.some(isRefusal), 'CLI').toBe(true);
  });

  it('refuses an invented key inside every object option the fixtures author', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const type of types) {
      const schema = z.toJSONSchema(getChartDefinition(type)!.optionsSchema as never, { io: 'input' }) as Node;
      const seen = new Set<string>();
      for (const fixture of getFixtures(type)) {
        for (const path of objectPaths(fixture.options, schema)) {
          const shape = path.map((segment) => (typeof segment === 'number' ? '*' : segment)).join('.');
          if (seen.has(shape)) continue;
          seen.add(shape);
          checked++;
          const options = structuredClone(fixture.options) as Record<string, unknown>;
          (path.reduce<unknown>((node, segment) => (node as Record<string | number, unknown>)[segment], options) as Record<string, unknown>)[INVENTED] = 1;
          const pointer = `/options/${[...path, INVENTED].join('/')}`;
          const refused = reactErrors({ type, data: fixture.data, options, ...(fixture.annotations ? { annotations: fixture.annotations } : {}) })
            .some((finding) => finding.code === 'unknown-option' && finding.path?.endsWith(pointer) && NAMES_A_KEY.test(finding.suggest ?? ''));
          if (!refused) failures.push(`${type} options.${shape}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(150);
  });

  it.each(types)('%s refuses an invented label kind', (type) => {
    // A fixture that takes a labels map at all; a type or preset that refuses labels refuses this too.
    const fixture = getFixtures(type).find((entry) => reactErrors({ type, data: entry.data, options: { ...entry.options, labels: {} } }).length === 0)
      ?? getFixtures(type)[0]!;
    const errors = reactErrors({ type, data: fixture.data, options: { ...fixture.options, labels: { [INVENTED]: true } } });
    expect(errors.length, 'refused').toBeGreaterThan(0);
    // A type with a labels map names the kinds it takes.
    if (type in LABEL_KINDS) {
      expect(errors.some((finding) => finding.code === 'unknown-option' && finding.path?.endsWith(`/options/labels/${INVENTED}`)
        && NAMES_A_KEY.test(finding.suggest ?? ''))).toBe(true);
    }
  });

  it('refuses a nested key in a repeat template whose options carry the slice placeholder', () => {
    const slice = { categories: ['a', 'b'], series: [{ id: 's', values: [1, 2] }] };
    const repeat = (options: object) => ({ type: 'grid', data: {
      repeat: { dimension: 'mode', values: ['grouped'] },
      template: { type: 'column', data: { bySlice: { grouped: slice } }, options },
    } });
    for (const [options, path, nearest] of [
      [{ variant: '$mode', valueAxis: { show: true, gridlinez: true } }, 'valueAxis/gridlinez', 'gridlines'],
      [{ variant: '$mode', locale: { decimla: ',' } }, 'locale/decimla', 'decimal'],
      [{ variant: 'grouped', valueAxis: { show: true, gridlinez: true } }, 'valueAxis/gridlinez', 'gridlines'],
    ] as const) {
      expect(reactErrors(repeat(options)), JSON.stringify(options)).toContainEqual(expect.objectContaining({
        code: 'unknown-option', path: `/data/template/options/${path}`, suggest: expect.stringContaining(`'${nearest}'`),
      }));
    }
  });

  it('names the real place of a moved key instead of the nearest key', () => {
    const fixture = getFixtures('combo')[0]!;
    const spec = { type: 'combo', data: fixture.data, options: { ...fixture.options, labels: { growth: true } } };
    const moved = (finding: Finding) => finding.code === 'unknown-option' && finding.suggest === "Remove 'growth' here and set options.dualAxis.growth instead.";
    expect(cliErrors(spec).errors.some(moved), 'CLI').toBe(true);
    expect(reactErrors(spec).some(moved), 'React spec path').toBe(true);
    // The per-type React entry words its key walk with the type's tree.
    const labels: OptionKeyTree = { grandTotal: 0 };
    const tree: OptionKeyTree = { labels, dualAxis: { growth: 0 } };
    expect(wordUnknownKeys([{ path: ['labels', 'growth'], node: labels }], tree)[0]).toMatchObject({
      message: "unknown option 'labels.growth' — it is dualAxis.growth", suggest: "Remove 'growth' here and set options.dualAxis.growth instead.",
    });
    // A type without dualAxis keeps the nearest-key hint.
    expect(wordUnknownKeys([{ path: ['labels', 'growth'], node: labels }], { labels })[0]!.suggest)
      .toBe("Remove 'growth'; this key is not supported here.");
  });
  // showValues: true answered "Rename to labels", and labels: true is refused too, so an agent looped.
  it('renames only when the near option takes the authored value', () => {
    const fixture = getFixtures('column')[0]!;
    const suggestFor = (showValues: boolean) => cliErrors({ type: 'column', data: fixture.data, options: { ...fixture.options, showValues } }).errors[0]!.suggest;
    expect(suggestFor(false)).toBe("Rename 'showValues' to 'labels'.");
    expect(suggestFor(true)).toMatch(/^Remove 'showValues': without it the chart prints its default labels\. Set labels to false/);
  });
});

interface Node {
  properties?: Record<string, Node>;
  additionalProperties?: unknown;
  anyOf?: Node[];
  oneOf?: Node[];
  allOf?: Node[];
  items?: Node;
}

/** The schema branches that describe the value at `path`. */
function branchesAt(schema: Node, path: readonly (string | number)[]): Node[] {
  const expand = (node: Node): Node[] => [node, ...[...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])].flatMap(expand)];
  let nodes = expand(schema);
  for (const segment of path) {
    nodes = nodes.flatMap((node) => {
      const next = typeof segment === 'number' ? node.items : node.properties?.[segment];
      return next ? expand(next) : [];
    });
  }
  return nodes;
}

/**
 * Paths of the authored objects with a fixed key set: an object branch with
 * properties, and no branch that is a record (a map keyed by ids or label
 * kinds takes any key by design).
 */
function objectPaths(value: unknown, schema: Node, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((item, index) => objectPaths(item, schema, [...path, index]));
  if (value === null || typeof value !== 'object') return [];
  const branches = branchesAt(schema, path);
  const fixed = path.length > 0 && branches.some((node) => node.properties)
    && !branches.some((node) => typeof node.additionalProperties === 'object');
  return [
    ...(fixed ? [path] : []),
    ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, schema, [...path, key])),
  ];
}
