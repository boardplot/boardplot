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
import { callTool } from '../src/mcp/server';
import { getFixtures, getRefusalExamples } from '../src/fixtures';
import { getChartSchemas, listCharts } from '../src/core/registry';
import { retireChartSettings } from '../src/core/retired';
import { IGNORED_OPTION_KEYS, LEGEND_REFUSED, schemaRefusedKeys, valueAxisRefusal } from '../src/core/schema/capability';
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
        if (path.length === 1 && (IGNORED_OPTION_KEYS.has(dotted) || (dotted === 'legend' && LEGEND_REFUSED.includes(type)))) continue;
        if (path[0] === 'valueAxis' && ['show', 'gridlines'].includes(path[1]!) && valueAxisRefusal(type, path[1]!) !== undefined) continue;
        const options: Record<string, unknown> = {};
        setAt(options, path, true);
        // A retired key is dropped with a remove patch before the schema runs, so it never refuses.
        if (retireChartSettings(type, { options }).warnings.length > 0) continue;
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
        // A key this form has no part for is dropped before the schema runs, so its value is never read.
        if (retireChartSettings(type, { options }).warnings.length > 0) continue;
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

  // A layout refusal thrown with only a display path (rows[id].cells[col]) reached the caller with path '' and the whole spec as the received value.
  it('points a layout refusal at the authored field and its value', () => {
    const table = getFixtures('table').find((entry) => entry.id === 'table-scorecard')!;
    const rows = structuredClone((table.data as { rows: { cells: Record<string, unknown> }[] }).rows);
    rows[1]!.cells.state = 'unclear';
    const status = render({ spec: { type: 'table', data: { ...(table.data as object), rows }, options: table.options } }).body.errors as (Finding & { received?: unknown })[];
    expect(status[0]).toMatchObject({ code: 'status-value-invalid', path: '/data/rows/1/cells/state', received: { type: 'string', value: 'unclear' } });
    const diagram = getFixtures('diagram').find((entry) => entry.id === 'protected-request')!;
    const nodes = structuredClone((diagram.data as { nodes: Record<string, unknown>[] }).nodes);
    nodes[2]!.caption = 'Sent over the network';
    const caption = render({ spec: { type: 'diagram', data: { ...(diagram.data as object), nodes }, options: diagram.options } }).body.errors as Finding[];
    expect(caption[0]).toMatchObject({ code: 'invalid-membership', path: '/data/nodes/2/caption', suggest: 'use secondaryLabel' });
    // A row id can be '1': the bracket names the row with that id, never the second row.
    const idRows = [{ ...rows[0]!, id: '1', cells: { ...rows[0]!.cells, state: 'unclear' } }, { ...rows[1]!, id: 'other', cells: { ...rows[1]!.cells, state: 'on-track' } }];
    const byId = render({ spec: { type: 'table', data: { ...(table.data as object), rows: idRows }, options: table.options } }).body.errors as (Finding & { received?: unknown })[];
    expect(byId[0]).toMatchObject({ code: 'status-value-invalid', path: '/data/rows/0/cells/state', received: { type: 'string', value: 'unclear' } });
  });

  // Diagram refusals named a node or edge by id in brackets, or a list by its bare name, so the caller got an empty path or one at the chart root (/lanes).
  it('points diagram refusals at the authored node, edge or list', () => {
    const fixture = getFixtures('diagram').find((entry) => entry.id === 'protected-request')!;
    const errors = (data: Node, options: Node = {}) => render({ spec: { type: 'diagram', data: { ...(fixture.data as object), ...data }, options: { ...fixture.options, ...options } } }).body.errors as (Finding & { received?: unknown })[];
    const edges = structuredClone((fixture.data as Node).edges) as Node[];
    edges[2]!.source = { groupId: 'empty' };
    expect(errors({ edges, groups: [...(fixture.data as Node).groups, { id: 'empty', title: 'Empty' }] })[0]).toMatchObject({ path: '/data/edges/2/source', received: { type: 'object', keys: ['groupId'] } });
    // Node '1' is authored last and drawn first: the pointer names the node with that id, not the second node.
    const nodes = structuredClone((fixture.data as Node).nodes) as Node[];
    nodes.forEach((node, index) => { node.order = nodes.length - index; });
    nodes[4]!.id = '1';
    nodes[4]!.shape = { kind: 'circle' };
    for (const edge of edges) for (const end of [edge.source, edge.target]) if (end.nodeId === 'private') end.nodeId = '1';
    edges[2]!.source = { nodeId: 'checks' };
    expect(errors({ nodes, edges })[0]).toMatchObject({ code: 'invalid-membership', path: '/data/nodes/4/shape', received: { type: 'object', keys: ['kind'] } });
    expect(errors({}, { flow: 'lanes' })[0]).toMatchObject({ code: 'invalid-membership', path: '/data/lanes', received: { type: 'missing' } });
  });

  // These refusals listed only the values they refuse, and authors concluded the job could not be done: each names the setting that does it.
  it('names the existing setting that does the job in the refusal', () => {
    const dimswitch = getFixtures('dimswitch')[0]!;
    const data = structuredClone(dimswitch.data) as { periods: { kind?: string }[] };
    data.periods = data.periods.filter((period) => period.kind !== 'range');
    expect(render({ spec: { type: 'dimswitch', data, options: dimswitch.options } }).body.errors as Finding[])
      .toContainEqual(expect.objectContaining({ path: '/data/periods', suggest: expect.stringContaining('options.columnVisibility.range to false') }));
    const table = getFixtures('table').find((entry) => entry.id === 'table-scorecard')!;
    const rows = structuredClone((table.data as { rows: { cells: Record<string, unknown> }[] }).rows);
    rows[0]!.cells.state = 'unclear';
    const status = (render({ spec: { type: 'table', data: { ...(table.data as object), rows }, options: table.options } }).body.errors as Finding[])[0]!;
    expect(status.suggest).toContain("{ state: 'na' }");
    const column = getFixtures('column')[0]!;
    const rowsResult = JSON.parse(callTool('boardplot_render', { spec: { type: 'column', data: column.data, options: column.options }, rows: [{ month: 'Jan', revenue: 3 }], columns: { category: 'month', value: 'revenue' } }).text) as { errors: Finding[] };
    expect(rowsResult.errors[0])
      .toMatchObject({ path: '/columns/series', suggest: expect.stringContaining('same series name on every row') });
    expect((render({ spec: { type: 'column', data: column.data, options: column.options, theme: 'dark' } as never }).body.errors as Finding[])[0]!.suggest)
      .toMatch(/^Use bridge-dark, standard-dark or notation-dark;/);
  });

  // These refusals named a bracket path or a bare list name, so the caller got an empty path or one at the chart root (/series), and a tornado named the wrong series.
  it('points chart refusals at the authored value, item or list', () => {
    const errors = (type: string, edit: (spec: Node) => void, id?: string) => {
      const fixture = getFixtures(type).find((entry) => id === undefined || entry.id === id)!;
      const spec = structuredClone({ type, data: fixture.data, options: fixture.options ?? {} }) as Node;
      edit(spec);
      return render({ spec }).body.errors as (Finding & { received?: unknown })[];
    };
    // A { bandId, value } record in reversed band order: the pointer names the record's value.
    expect(errors('pyramid', (s) => {
      const bands = s.data.bands as Node[];
      s.data.groups[0].values = (s.data.groups[0].values as number[]).map((value, i) => ({ bandId: bands[i]!.id, value })).reverse();
      s.data.groups[0].values[1].value = -1;
    })[0]).toMatchObject({ code: 'pyramid-negative-value', path: '/data/groups/0/values/1/value', received: { type: 'number', value: -1 } });
    // The anchored item is found by its id '1', not read as index 1.
    expect(errors('gantt', (s) => {
      s.data.rows[2].items[0].id = '1';
      s.data.rows[2].items[0].anchor = { toItemId: 'nope', edge: 'end' };
    })[0]).toMatchObject({ code: 'unknown-anchor', path: '/data/rows/2/items/0/anchor/toItemId', received: { type: 'string', value: 'nope' } });
    expect(errors('pie', (s) => { s.data.series[0].values = (s.data.series[0].values as number[]).map(() => 0); })[0]).toMatchObject({ code: 'empty-data', path: '/data/series' });
    // With a reference series first, the short high case is the third authored series, not the second.
    expect(errors('bar', (s) => {
      const high = (s.data.series as Node[]).find((entry) => entry.id === 'high')!;
      high.values = (high.values as unknown[]).slice(1);
      s.data.series.unshift({ id: 'ref', label: 'Ref', role: 'reference', values: s.data.categories.map(() => 1) });
    }, 'dcf-npv-sensitivity')[0]).toMatchObject({ code: 'length-mismatch', path: '/data/series/2/values' });
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

  // Table and cohort refusals named a row by id in brackets or a list by its bare name, so the caller got an empty path or one at the chart root (/columns).
  it('points table and cohort refusals at the authored row, cohort or list', () => {
    const errors = (type: string, edit: (spec: Node) => void, id?: string) => {
      const fixture = getFixtures(type).find((entry) => id === undefined || entry.id === id)!;
      const spec = structuredClone({ type, data: fixture.data, options: fixture.options ?? {} }) as Node;
      edit(spec);
      return render({ spec }).body.errors as (Finding & { received?: unknown })[];
    };
    expect(errors('cohort', (s) => { s.data.cohorts[2].size = 5; })[0]).toMatchObject({ code: 'cohort-base-mismatch', path: '/data/cohorts/2/size', received: { type: 'number', value: 5 } });
    // Row '1' is nested fourth under the total row: the pointer walks the authored tree to it, not to rows[1].
    expect(errors('table', (s) => {
      const row = s.data.rows[0].children[3];
      row.id = '1';
      row.parentId = 'de';
    }, 'steering-monthly')[0]).toMatchObject({ code: 'parent-conflict', path: '/data/rows/0/children/3/parentId', received: { type: 'string', value: 'de' } });
    expect(errors('table', (s) => { s.data.columns.push({ id: 'again', kind: 'rowLabel', label: 'Again' }); }, 'steering-monthly')[0]).toMatchObject({ code: 'row-label-count', path: '/data/columns' });
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
    // 401 by 500 costs 250,000 (under the point budget) but its 100.25 million of categories times series times series is over the cap that stops the heap abort (300 by 700 aborted at 280,000 points).
    for (const data of [wide(1_000, 300), wide(100, 2_000), wide(401, 500)]) {
      for (const variant of ['line', 'stacked-area'] as const) {
        const { body } = render({ spec: { type: 'line', data, options: { variant } } });
        expect((body.errors as Finding[]).map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'too-many-items', path: '/data/series' }]);
      }
    }
    expect(render({ spec: { type: 'line', data: wide(1_000, 300), options: { window: { last: 10 } } } }).body.errors ?? []).toEqual([]);
    expect(render({ spec: { type: 'line', data: wide(401, 500), options: { window: { last: 5 } } } }).body.errors ?? []).toEqual([]);
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
