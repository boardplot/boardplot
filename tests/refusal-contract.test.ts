/**
 * a refusal names the way out. Every key a published
 * options schema refuses, every refusal example, and every object or value
 * list an option expects answers with what a valid input needs, so the
 * caller does not need another discovery call before correcting it.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '../src/core/charts';
import { render } from '../src/cli/render';
import { getFixtures, getRefusalExamples } from '../src/fixtures';
import { getChartSchemas, listCharts } from '../src/core/registry';
import { schemaRefusedKeys } from '../src/core/schema/capability';
import { SparklineChart } from '../src/react/charts/sparkline';

type Node = Record<string, any>;
type Finding = { code: string; path: string; displayPath?: string; message: string; suggest?: string; expected?: Node };

/** The sentences a diagnostic falls back to when nothing names the change. */
const FALLBACKS = [
  /^Remove this field; it is not accepted at this position\.$/,
  /^Check which options '[a-z]+' takes and send one of those\.$/,
  /^Take the shape from the '[a-z]+' example and replace the values\.$/,
  /^Remove '[^']+'; this object does not take it\.$/,
];

const TYPES = listCharts().map(({ type }) => type);

function optionSchema(type: string): Node {
  return z.toJSONSchema(getChartSchemas(type)!.optionsSchema as z.ZodType, { io: 'input' }) as Node;
}

const isRefused = (node: Node) => node.not !== undefined && Object.keys(node.not).length === 0;
const branches = (node: Node): Node[] => [node, ...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])];

/** The schema nodes at an option path, through every union branch. */
function nodesAt(root: Node, path: readonly string[]): Node[] {
  let nodes = [root];
  for (const segment of path) {
    nodes = nodes.flatMap(branches).flatMap((node) => {
      const child = node.properties?.[segment] ?? (typeof node.additionalProperties === 'object' ? node.additionalProperties : undefined);
      return child ? [child] : [];
    });
  }
  return nodes;
}

/** Every option path the published schema refuses by name. */
function refusedPaths(node: Node, prefix: string[] = []): string[][] {
  return branches(node).flatMap((branch) => Object.entries(branch.properties ?? {}).flatMap(([key, child]) =>
    isRefused(child as Node) ? [[...prefix, key]] : refusedPaths(child as Node, [...prefix, key])));
}

function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = target;
  for (const segment of path.slice(0, -1)) node = (node[segment] ??= {}) as Record<string, unknown>;
  node[path.at(-1)!] = value;
}

/** Every JSON value a message prints after 'example '. */
function examples(message: string): unknown[] {
  return [...message.matchAll(/example (?=[{[])/g)].map((match) => {
    const start = match.index! + match[0].length;
    let depth = 0;
    let quoted = false;
    for (let index = start; index < message.length; index++) {
      const char = message[index]!;
      if (quoted) {
        if (char === '\\') index++;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
      } else if (char === '{' || char === '[') {
        depth++;
      } else if ((char === '}' || char === ']') && --depth === 0) {
        return JSON.parse(message.slice(start, index + 1));
      }
    }
    throw new Error(`unbalanced example in: ${message}`);
  });
}

function cliErrors(type: string, options: Record<string, unknown>, data = getFixtures(type)[0]!.data): Finding[] {
  const { body } = render({ spec: { type, data, options } });
  return (body.errors ?? []) as Finding[];
}

describe('refusal contract', () => {
  it('names a way out for every key a published schema or capability table refuses', () => {
    const failures: string[] = [];
    for (const type of TYPES) {
      const schema = optionSchema(type);
      const tables = schemaRefusedKeys(type);
      const paths = new Map<string, string[]>();
      for (const path of [...refusedPaths(schema), ...tables.options.map((key) => [key]), ...tables.valueAxis.map((key) => ['valueAxis', key])]) {
        paths.set(path.join('.'), path);
      }
      for (const [dotted, path] of paths) {
        const options: Record<string, unknown> = {};
        setAt(options, path, true);
        const error = cliErrors(type, options).find((candidate) => candidate.path === `/options/${path.join('/')}`);
        const suggest = error?.suggest ?? '';
        const where = `${type} ${dotted}: ${suggest || error?.message || 'no error'}`;
        if (!error || FALLBACKS.some((fallback) => fallback.test(suggest)) || !new RegExp(`\\b${dotted.replaceAll('.', '\\.')}\\b`).test(suggest)) {
          failures.push(where);
          continue;
        }
        // A way out: four words or more after the remove, and every type and
        // option it names exists where it says.
        const named = [...suggest.matchAll(/'([a-z]+)'/g)].map((match) => match[1]!).filter((name) => TYPES.includes(name));
        const wayOut = suggest.slice(suggest.indexOf(';') + 1).trim();
        const stale = [...suggest.matchAll(/options\.([A-Za-z.]*[A-Za-z])/g)].map((match) => match[1]!)
          .filter((option) => option !== dotted && ![type, ...named].some((owner) =>
            nodesAt(optionSchema(owner), option.split('.')).some((node) => !isRefused(node))));
        if (wayOut.split(/\s+/).length < 4 || stale.length > 0) failures.push(`${where} (stale: ${stale.join(', ')})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('answers every refusal example with allowed values, a minimum or a concrete suggest', () => {
    const failures: string[] = [];
    for (const type of TYPES) {
      for (const fixture of getRefusalExamples(type)) {
        const { body } = render({ spec: {
          type, data: fixture.data,
          ...(fixture.options ? { options: fixture.options } : {}),
          ...(fixture.annotations ? { annotations: fixture.annotations } : {}),
        } });
        const { code, path } = fixture.refuses!;
        const error = ((body.errors ?? []) as Finding[])
          .find((candidate) => candidate.code === code && (path === undefined || candidate.displayPath === path));
        const concrete = error?.suggest !== undefined && !FALLBACKS.some((fallback) => fallback.test(error.suggest!));
        if (!error?.expected?.values?.length && error?.expected?.minimum === undefined && !concrete) {
          failures.push(`${type}/${fixture.id}: ${error?.suggest ?? 'no suggest'}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('lists the fields of every expected object, a union of objects branch by branch, and every value list, with examples that pass', () => {
    const failures: string[] = [];
    for (const type of TYPES) {
      // Objects, unions of objects and value lists reachable through plain
      // objects, each sent a wrong value on its own: the CLI prints ten errors at most.
      const targets: { path: string[]; node: Node; shapes?: Node[] }[] = [];
      const visit = (node: Node, path: string[]) => {
        for (const [key, child] of Object.entries(node.properties ?? {}) as [string, Node][]) {
          const branches = ((child.anyOf ?? child.oneOf ?? []) as Node[]).filter((branch) => branch.type !== 'null');
          if (child.type === 'object' && child.properties && !child.anyOf) {
            targets.push({ path: [...path, key], node: child, shapes: [child] });
            visit(child, [...path, key]);
          } else if (branches.length > 1 && branches.every((branch) => branch.type === 'object' && branch.properties)) {
            targets.push({ path: [...path, key], node: child, shapes: branches });
          } else if (Array.isArray(child.enum) && child.enum.every((value: unknown) => typeof value === 'string')) {
            targets.push({ path: [...path, key], node: child });
          }
        }
      };
      visit(optionSchema(type), []);
      for (const { path, node, shapes } of targets) {
        const options: Record<string, unknown> = {};
        // A number, not true: true was once a valid bartable cascade and now draws as its variant.
        setAt(options, path, shapes ? 1 : 'not-a-listed-value');
        const message = cliErrors(type, options).find((error) => error.path === `/options/${path.join('/')}`)?.message.replace(`options.${path.join('.')}: `, '') ?? 'no error';
        const where = `${type} ${path.join('.')}: ${message}`;
        if (!shapes) {
          if (node.enum.some((value: string) => !message.includes(value))) failures.push(where);
          continue;
        }
        // One section per branch, each naming its own fields; never one merged shape.
        const union = shapes.length > 1;
        const sections = union ? message.split(/ \[\d+\] /).slice(1) : [message];
        if (!message.startsWith(union ? `expected one of ${shapes.length} objects: [1] ` : 'expected an object with') || sections.length !== shapes.length) {
          failures.push(where);
          continue;
        }
        shapes.forEach((shape, index) => {
          const section = sections[index]!;
          const required = section.match(/required ([^;]*)/)?.[1] ?? '';
          const missing = Object.entries(shape.properties as Record<string, Node>).filter(([key, child]) => !isRefused(child) && (
            !section.includes(`${key} (`)
            || (shape.required?.includes(key) && !required.includes(`${key} (`))
            || (child.enum ?? []).some((value: unknown) => !section.includes(`'${String(value)}'`))));
          if (missing.length > 0) failures.push(`${where} (branch ${index + 1} misses ${missing.map(([key]) => key).join(', ')})`);
        });
        // Every printed example passes the schema. Layout may still refuse
        // one against the data (a break outside the domain, a series id).
        for (const example of examples(message)) {
          const sent: Record<string, unknown> = {};
          setAt(sent, path, example);
          const parsed = (getChartSchemas(type)!.optionsSchema as z.ZodType).safeParse(sent);
          const refused = parsed.error?.issues.find((issue) => path.every((segment, index) => issue.path[index] === segment));
          if (refused) failures.push(`${where} (example ${JSON.stringify(example)} refused: ${refused.message})`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('names a broken value-axis break in full', () => {
    const errors = cliErrors('waterfall', { valueAxis: { break: true } });
    expect(errors[0]!.message).toBe(
      'options.valueAxis.break: expected an object with required from (number), to (number); optional style (\'straight\'); break requires from < to; example {"from":0,"to":1}; got boolean true',
    );
    const style = cliErrors('waterfall', { valueAxis: { break: { from: 0, to: 1, style: 'zigzag' } } })[0]!;
    expect(style.message).toContain('"straight"');
    expect(style.message).not.toContain('wiggle');
  });

  it('points a reversed slope at the bump chart', () => {
    const [error] = cliErrors('slope', { valueAxis: { reverse: true } });
    expect(error!.suggest).toBe("Remove 'valueAxis.reverse'; for ranks with 1 on top, draw type 'line' with options.variant 'bump' and options.bump.direction 'lowerIsBetter'; to flip a numeric scale, draw type 'line' with options.valueAxis.reverse.");
    expect(error!.message).toContain("type 'line' with variant 'bump'");
  });

  // A 0.29 px CAGR leg deficit added 3 px of band, so 960 x 259 refused while 258 and 260 drew.
  it('draws the bridge at every height from its floor up', () => {
    const fixture = getFixtures('waterfall').find((entry) => entry.id === 'ebit-bridge')!;
    for (const height of [258, 259, 260]) {
      const { body } = render({ spec: { type: 'waterfall', data: fixture.data, annotations: fixture.annotations, options: { ...fixture.options, size: { width: 960, height } } } });
      expect(body.errors ?? []).toEqual([]);
    }
  });

  it('draws a bare 176 by 56 sparkline in the CLI and in React', () => {
    const data = { values: [96, 98, 101, 104, 103, 107] };
    const size = { width: 176, height: 56 };
    expect(render({ spec: { type: 'sparkline', data, options: { size } } }).exit).toBe(0);
    const html = renderToStaticMarkup(createElement(SparklineChart, { data, size }));
    expect(html).toContain('<svg');
    expect(html).not.toContain('data-bp-refused');
  });

  // A 150,000-category column ran for more than 15 minutes; above the item budget it must refuse at once and name the fix.
  it('refuses a column above the item budget before layout', () => {
    const n = 150_000;
    const data = { categories: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `Item ${i}` })), series: [{ id: 's', label: 'Revenue', values: Array.from({ length: n }, (_, i) => i % 97) }] };
    const started = performance.now();
    const { body } = render({ spec: { type: 'column', data, options: { size: { width: 800 } } } });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect((body.errors as Finding[]).map(({ code, path, suggest }) => ({ code, path, line: suggest?.includes('line') }))).toEqual([{ code: 'too-many-items', path: '/data/categories', line: true }]);
  });

  // A line of 1,999 categories by 200 series (about 400,000 points) ran the CLI and the MCP server out of memory, and 100 categories by 2,000 series took 11 s and 2 GB because the series cost more than their points; above the budget both must refuse at once, and a window.last that draws less must still draw.
  it('refuses a line or area above the point and series budget and draws the same data under window.last', () => {
    const wide = (length: number, count: number) => {
      const categories = Array.from({ length }, (_, i) => `c${i}`);
      return { categories, series: Array.from({ length: count }, (_, k) => ({ id: `s${k}`, values: categories.map((_, i) => (i * (k + 1)) % 97) })) };
    };
    // 300 by 700 costs 280,000 (under the point budget) but still aborted with a heap error, so categories times series times series is bounded too.
    for (const data of [wide(1_000, 300), wide(100, 2_000), wide(300, 700), wide(200, 1_000)]) {
      for (const variant of ['line', 'stacked-area'] as const) {
        const { body } = render({ spec: { type: 'line', data, options: { variant } } });
        expect((body.errors as Finding[]).map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'too-many-items', path: '/data/series' }]);
      }
    }
    expect(render({ spec: { type: 'line', data: wide(1_000, 300), options: { window: { last: 100 } } } }).body.errors ?? []).toEqual([]);
    expect(render({ spec: { type: 'line', data: wide(300, 700), options: { window: { last: 100 } } } }).body.errors ?? []).toEqual([]);
  });

  // A combo of 10 categories by 1,000 series did not finish in 150 s with only 10,000 points, and 1,000 by 101 ran out of memory; it must refuse at once, and a window.last that draws less must still draw.
  it('refuses a combo above its point and series budget and draws the same data under window.last', () => {
    const wide = (length: number, count: number) => {
      const categories = Array.from({ length }, (_, i) => `c${i}`);
      return { categories, series: Array.from({ length: count }, (_, k) => ({ id: `s${k}`, ...(k > 0 ? { kind: 'line' } : {}), values: categories.map((_, i) => (i * (k + 1)) % 97) })) };
    };
    for (const data of [wide(10, 1_000), wide(300, 70)]) {
      const { body } = render({ spec: { type: 'combo', data } });
      expect((body.errors as Finding[]).map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'too-many-items', path: '/data/series' }]);
    }
    expect(render({ spec: { type: 'combo', data: wide(300, 70), options: { window: { last: 20 } } } }).body.errors ?? []).toEqual([]);
  });

  // The budget must not refuse long lists that the chart itself cuts to a few drawn items.
  it('draws a long list that topN, its threshold, window.last or the Pareto tail fold reduces', () => {
    const n = 2_001;
    const categories = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `Item ${i}` }));
    const series = [{ id: 's', label: 'Revenue', values: Array.from({ length: n }, (_, i) => 1 + (i % 97)) }];
    const items = categories.map((category, i) => ({ ...category, value: i === 0 ? 100_000 : 1 }));
    const specs = [
      { type: 'column', data: { categories, series }, options: { topN: { n: 7, rest: true } } },
      { type: 'column', data: { categories, series }, options: { topN: { n: 2_000, rest: false } } },
      { type: 'bar', data: { categories, series: [{ ...series[0]!, values: categories.map((_, i) => (i === 0 ? 1_000 : 1)) }] }, options: { topN: { n: 3_000, threshold: 500 } } },
      { type: 'column', data: { categories, series }, options: { window: { last: 7 } } },
      { type: 'combo', data: { categories, series }, options: { viewDomain: { x: ['c10', 'c16'] } } },
      { type: 'pareto', data: { items }, options: {} },
    ];
    for (const spec of specs) expect(render({ spec }).body.errors ?? [], spec.type).toEqual([]);
  });
});
