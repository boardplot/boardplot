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
import { render } from '../src/cli/render';
import { callTool } from '../src/mcp/server';
import { beginSpecParse } from '../src/react/specValidation';
import { parseDocumentInput } from '../src/core/doc/document';
import { validateChartInput } from '../src/core/doc/chartValidation';
import { getFixtures } from '../src/fixtures';
import { getChartDefinition, listCharts } from '../src/core/registry';
import { LABEL_KINDS } from '../src/core/schema/capability';
import { wordUnknownKeys } from '../src/core/schema/unknownKeyWords';
import type { OptionKeyTree } from '../src/core/schema/unknownKeys';
import { parseJsonPointer, patchApplies, readJsonPointer, type JsonPatchOperation } from '../src/core/diagnostics/jsonPatch';

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

function applyFix<T>(input: T, fix: JsonPatchOperation[]): T {
  expect(patchApplies(input, fix)).toBe(true);
  const result = structuredClone(input);
  for (const operation of fix) {
    const segments = parseJsonPointer(operation.path);
    const parent = segments.slice(0, -1).reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], result) as Record<string, unknown>;
    const key = segments.at(-1)!;
    if (operation.op === 'remove') delete parent[key];
    else if (operation.op === 'add') parent[key] = structuredClone(operation.value);
    else throw new Error(`Unexpected patch operation: ${operation.op}`);
  }
  return result;
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
    const spec = { type: 'combo', data: fixture.data, options: { ...fixture.options, width: 600 } };
    const moved = (finding: Finding) => finding.code === 'unknown-option' && finding.suggest === "Remove 'width' here and set options.size.width instead.";
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
  // A spec saved before a rename must keep drawing; a typo beside the retired names must still refuse.
  it('draws a renamed preset and option value as their successors with a rewrite fix, and still refuses a typo', () => {
    const fixture = getFixtures('table')[0]!;
    const { variant: _variant, ...options } = fixture.options as Record<string, unknown>;
    const spec = { type: 'table', data: fixture.data, options: { ...options, preset: 'plain', theme: 'ibcs' } };
    const path = join(directory, 'retired.json');
    writeFileSync(path, JSON.stringify(spec));
    const output: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
    const code = main(['render', path, '--format', 'svg', '--out', join(directory, 'retired')]);
    log.mockRestore();
    const mcp = JSON.parse(callTool('boardplot_render', { spec }).text) as { ok: boolean; warnings: (Finding & { fix?: unknown })[] };
    const cli = JSON.parse(output.join('\n').slice(output.join('\n').indexOf('{'))) as typeof mcp;
    expect(code, 'CLI').toBe(0);
    expect(reactErrors(spec), 'React spec path').toEqual([]);
    for (const result of [cli, mcp]) {
      expect(result.ok).toBe(true);
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'option-deprecated',
        fix: [{ op: 'remove', path: '/options/preset' }, { op: 'add', path: '/options/variant', value: 'hierarchy' }] }));
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'option-deprecated',
        fix: [{ op: 'test', path: '/options/theme', value: 'ibcs' }, { op: 'replace', path: '/options/theme', value: 'notation' }] }));
    }
    const typo = { ...spec, options: { ...spec.options, presett: 'plain' } };
    expect(cliErrors(typo).errors).toContainEqual(expect.objectContaining({ code: 'unknown-option', path: '/options/presett' }));
  });
  // `tile` named a11y (it holds a11y.title) and no refusal carried a patch, so an agent could not repair a one-letter typo.
  it('names the option a typo is closest to by its own name, and patches only the one key within one edit', () => {
    const data = getFixtures('column')[0]!.data;
    const fix = (options: object, key: string) => cliErrors({ type: 'column', data, options }).errors.find((finding) => finding.path === `/options/${key}`) as Finding & { fix?: JsonPatchOperation[] };
    for (const [typo, name] of [['tile', 'title'], ['Title', 'title'], ['tilte', 'title']] as const) {
      const options = { [typo]: 'Revenue' };
      const finding = fix(options, typo);
      expect(finding.message, typo).toContain(`try: ${name}`);
      expect(finding.fix, typo).toEqual([{ op: 'remove', path: `/options/${typo}` }, { op: 'add', path: `/options/${name}`, value: 'Revenue' }]);
      expect(patchApplies({ type: 'column', data, options }, finding.fix!), typo).toBe(true);
    }
    // A key that names only a word below an option gets the hint and no patch; so does a typo whose target the author already set.
    expect(fix({ valueAxis: { show: true }, gridlines: true }, 'gridlines').fix).toBeUndefined();
    expect(fix({ title: 'A', tile: 'B' }, 'tile').fix).toBeUndefined();
    // The per-type React entry names the key and offers no patch, as it cannot check the value against the schema.
    const tree: OptionKeyTree = { a11y: { title: 0 }, title: 0 };
    expect(wordUnknownKeys([{ path: ['tile'], node: tree }], tree)[0]).toMatchObject({ suggest: "Rename 'tile' to 'title'." });
    expect(wordUnknownKeys([{ path: ['tile'], node: tree }], tree)[0]).not.toHaveProperty('fix');
  });
  // xTitle is one edit from title: its patch moved an axis title into the chart title, unread by an agent that applies fixes.
  it('sends axis-title keys of other libraries to axisTitles, never to title', () => {
    const errors = (type: string, options: object) => cliErrors({ type, data: getFixtures(type)[0]!.data, options }).errors as (Finding & { fix?: unknown })[];
    const column = errors('column', { xTitle: 'Year', yAxisTitle: 'Revenue', yLabel: 'EUR' });
    expect(column.map((finding) => [finding.message, finding.fix])).toEqual([
      ["unknown option 'xTitle' — it is axisTitles", undefined],
      ["unknown option 'yAxisTitle' — it is axisTitles", undefined],
      ["unknown option 'yLabel' — it is axisTitles", undefined],
    ]);
    expect(errors('scatter', { xTitle: 'Price' })[0]).toMatchObject({ suggest: "Remove 'xTitle' here and set options.axisTitles.x instead." });
    // A type without axis titles names no near key at all.
    expect(errors('pie', { xTitle: 'Year' })[0]).toMatchObject({ message: "unknown option 'xTitle'", suggest: "Remove 'xTitle'; this key is not supported here." });
    const tree: OptionKeyTree = { title: 0, axisTitles: { x: 0, y: 0 } };
    expect(wordUnknownKeys([{ path: ['yTitle'], node: tree }], tree)[0]).toMatchObject({ suggest: "Remove 'yTitle' here and set options.axisTitles.y instead." });
  });
  // A patch that renames a nested key onto a boolean option but keeps the string 'yes' leaves the chart refused.
  it('patches a nested typo only when the renamed key takes the authored value', () => {
    const data = getFixtures('column')[0]!.data;
    const fix = (valueAxis: object) => cliErrors({ type: 'column', data, options: { valueAxis } }).errors.find((finding) => finding.path === '/options/valueAxis/gridlinez') as Finding & { fix?: JsonPatchOperation[] };
    expect(fix({ gridlinez: true }).fix).toEqual([{ op: 'remove', path: '/options/valueAxis/gridlinez' }, { op: 'add', path: '/options/valueAxis/gridlines', value: true }]);
    expect(fix({ gridlinez: 'yes' }).fix).toBeUndefined();
  });
  // Two typos of one option would both add the same member, and the second add overwrites the first authored value.
  it('withholds the patch when two keys in one object are typos of the same option', () => {
    const data = getFixtures('column')[0]!.data;
    const errors = cliErrors({ type: 'column', data, options: { tile: 'First', Title: 'Second' } }).errors;
    for (const key of ['tile', 'Title']) {
      const finding = errors.find((error) => error.path === `/options/${key}`) as Finding & { fix?: JsonPatchOperation[] };
      expect(finding.message, key).toContain('try: title');
      expect(finding.fix, key).toBeUndefined();
    }
  });
  // A retired-setting fix that does not apply (an add under a missing parent) leaves an agent with no way to clean the spec.
  it('gives every retired setting a fix that applies, also under a missing parent and in a repeat template', () => {
    const combo = getFixtures('combo').find(fixture => fixture.id === 'margin-line-own-scale')!;
    const grid = getFixtures('grid').find(fixture => fixture.id === 'repeat-regions')!;
    const template = (grid.data as { template: { options?: object } }).template;
    const specs = [
      { type: 'combo', data: combo.data, options: { ...combo.options, labels: { growth: true } } },
      { type: 'grid', data: { ...grid.data as object, template: { ...template, options: { ...template.options, strings: { highlight: 'Old' } } } }, options: grid.options },
    ];
    for (const spec of specs) {
      const result = JSON.parse(callTool('boardplot_render', { spec }).text) as { ok: boolean; warnings: { code: string; fix?: JsonPatchOperation[] }[] };
      expect(result.ok, spec.type).toBe(true);
      const retired = result.warnings.filter(warning => warning.code === 'option-deprecated');
      expect(retired, spec.type).toHaveLength(1);
      for (const warning of retired) expect(patchApplies(spec, warning.fix!), JSON.stringify(warning.fix)).toBe(true);
    }
  });
  // A key a sibling type reads (labels.valueLine on column) was refused on line with only "Remove", not the setting that works here.
  it('names the setting that does the job where a sibling type reads the refused key', () => {
    const line = getFixtures('line')[0]!;
    const spec = { type: 'line', data: line.data, options: { ...line.options, labels: { valueLine: false }, annotations: [{ kind: 'valueLine', value: 'mean' }] } };
    const refusal = cliErrors(spec).errors.find(entry => entry.path === '/options/labels/valueLine') as Finding & { fix?: JsonPatchOperation[] };
    expect(refusal.suggest).toBe("Remove 'labels.valueLine' and set label: false on each { kind: 'valueLine' } annotation.");
    expect(refusal.fix).toEqual([{ op: 'remove', path: '/options/labels/valueLine' }, { op: 'add', path: '/options/annotations/0/label', value: false }]);
    expect(JSON.parse(callTool('boardplot_render', { spec: applyFix(spec, refusal.fix!) }).text).ok).toBe(true);
    expect(reactErrors(spec)).toContainEqual(expect.objectContaining({ suggest: refusal.suggest }));
    // The root list replaces options.annotations in the request, so the patch must hide the label there.
    const rooted = { type: 'line', data: line.data, options: { ...line.options, labels: { valueLine: false } }, annotations: [{ kind: 'valueLine', value: 'mean' }] };
    const rootFix = (cliErrors(rooted).errors.find(entry => entry.path === '/options/labels/valueLine') as { fix?: JsonPatchOperation[] }).fix!;
    expect(rootFix).toEqual([{ op: 'remove', path: '/options/labels/valueLine' }, { op: 'add', path: '/annotations/0/label', value: false }]);
    const drawn = JSON.parse(callTool('boardplot_render', { spec: applyFix(rooted, rootFix), return: ['svg'] }).text);
    expect(drawn.ok).toBe(true);
    expect(drawn.svg).not.toMatch(/Average/);
    const stack = getFixtures('grid').find(entry => entry.id === 'metric-stack-volume')!;
    const categories = structuredClone((stack.data as { categories: Record<string, unknown>[] }).categories);
    categories[0]!.footnote = 'Partial month';
    const footnote = cliErrors({ type: 'grid', data: { ...(stack.data as object), categories }, options: stack.options }).errors[0]!;
    expect(footnote).toMatchObject({ path: '/data/categories/0/footnote' });
    expect(footnote.suggest).toContain('options.footnotes');
  });
  // showValues: true answered "Rename to labels", and labels: true is refused too, so an agent looped.
  it('renames only when the near option takes the authored value', () => {
    const fixture = getFixtures('column')[0]!;
    const suggestFor = (showValues: boolean) => cliErrors({ type: 'column', data: fixture.data, options: { ...fixture.options, showValues } }).errors[0]!.suggest;
    expect(suggestFor(false)).toBe("Rename 'showValues' to 'labels'.");
    expect(suggestFor(true)).toMatch(/^Remove 'showValues': without it the chart prints its default labels\. Set labels to false/);
  });
});

describe('unknown data keys', () => {
  // An agent that applies the old advice deletes the observations or the labels.
  it('renames data keys only when their values fit and keeps the data in the rendered chart', () => {
    const cases: { spec: object; renames: [string, string, unknown][] }[] = [
      { spec: { type: 'box', data: { groups: [{ id: 'n', label: 'North', values: [4, 5, 6, 7, 8, 10] }] } },
        renames: [['/data/groups/0/values', '/data/groups/0/observations', [4, 5, 6, 7, 8, 10]]] },
      { spec: { type: 'histogram', data: { values: [1, 2, 2, 3, 3, 4] } },
        renames: [['/data/values', '/data/observations', [1, 2, 2, 3, 3, 4]]] },
      { spec: { type: 'bar', data: { categories: ['North'], series: [{ id: 'r', values: [90], color: '#1F77B4' }] } },
        renames: [['/data/series/0/color', '/data/series/0/fill', '#1F77B4']] },
      { spec: { version: 1, charts: [{ name: 'revenue', type: 'bar', data: {
        categories: [{ id: 'n', name: 'North' }, { id: 's', name: 'South' }],
        series: [{ id: 'r', name: 'Revenue', values: [90, 120] }],
      } }] }, renames: [
        ['/charts/0/data/categories/0/name', '/charts/0/data/categories/0/label', 'North'],
        ['/charts/0/data/categories/1/name', '/charts/0/data/categories/1/label', 'South'],
        ['/charts/0/data/series/0/name', '/charts/0/data/series/0/label', 'Revenue'],
      ] },
      { spec: { type: 'bar', data: { categories: ['North'], series: [{ id: 'r', labell: 'Revenue', values: [90] }] } },
        renames: [['/data/series/0/labell', '/data/series/0/label', 'Revenue']] },
    ];
    const findings = (spec: object) => (render({ spec }).body.errors ?? []) as (Finding & { fix?: JsonPatchOperation[] })[];
    for (const { spec, renames } of cases) {
      let repaired = spec;
      for (const [oldPath, newPath, value] of renames) {
        const finding = findings(repaired).find(entry => entry.path === oldPath)!;
        const target = parseJsonPointer(newPath).at(-1)!;
        expect(finding.suggest, oldPath).toContain(`to '${target}'`);
        expect(finding.message, oldPath).toContain(`try: ${target}`);
        expect(finding.fix, oldPath).toBeDefined();
        repaired = applyFix(repaired, finding.fix!);
        expect(readJsonPointer(repaired, newPath)).toEqual({ found: true, value });
        expect(readJsonPointer(repaired, oldPath)).toEqual({ found: false });
      }
      expect(render({ spec: repaired, return: ['svg'] }).body.ok, JSON.stringify(repaired)).toBe(true);
      if ('type' in spec && spec.type === 'box') {
        expect(readJsonPointer(repaired, '/data/groups/0/label')).toEqual({ found: true, value: 'North' });
      }
    }

    const bar = (series: object) => ({ type: 'bar', data: { categories: ['a'], series: [{ id: 's', values: [1], ...series }] } });
    const existing = findings(bar({ name: 'Old', label: 'New' })).find(entry => entry.path === '/data/series/0/name')!;
    expect(existing.suggest).toBe("'name' is not read; 'label' is already set. Remove 'name' only if it repeats the value.");
    expect(existing.fix).toBeUndefined();
    const incompatible = findings(bar({ name: ['North'] })).find(entry => entry.path === '/data/series/0/name')!;
    expect(incompatible.suggest).not.toContain("to 'label'");
    expect(incompatible.suggest).not.toContain('Remove');
    expect(incompatible.fix).toBeUndefined();
    const competing = findings(bar({ color: '#123456', colour: '#654321' }));
    expect(competing.filter(entry => /\/colou?r$/.test(entry.path ?? '')).map(entry => entry.fix)).toEqual([undefined, undefined]);

    const input = { type: 'box', data: { groups: [{ id: 'n', values: [1, 2, 3, 4] }] } };
    const { doc, envelope } = parseDocumentInput(input);
    const chart = doc.charts[0]!;
    (chart.data as { groups: { values: number[] }[] }).groups[0]!.values = [5, 6, 7, 8];
    validateChartInput(doc, chart, envelope);
    expect(envelope.errors.find(entry => entry.path?.endsWith('/groups/0/values'))?.fix).toBeUndefined();
  });

  // A flat item list must become chart data without losing item labels or values.
  it('moves a flat item list into categories and series only when the result is valid', () => {
    const spec = { type: 'pie', data: { items: [{ id: 'a', label: 'A', value: 60 }, { id: 'b', label: 'B', value: 40 }] } };
    const finding = ((render({ spec }).body.errors ?? []) as (Finding & { fix?: JsonPatchOperation[] })[])
      .find(entry => entry.path === '/data/items')!;
    expect(finding.suggest).toBe("This chart's data takes categories and series. Move each item's id and label to data.categories[] and its value to data.series[0].values.");
    expect(finding.fix).toBeDefined();
    const repaired = applyFix(spec, finding.fix!);
    expect(readJsonPointer(repaired, '/data/categories')).toEqual({ found: true, value: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    expect(readJsonPointer(repaired, '/data/series')).toEqual({ found: true, value: [{ id: 'value', values: [60, 40] }] });
    const drawing = render({ spec: repaired, return: ['svg'] }).body;
    expect(drawing.ok).toBe(true);
    expect(drawing.svg).toMatch(/>[^<]*60(?:\D|<)/);
    expect(drawing.svg).toMatch(/>[^<]*40(?:\D|<)/);

    const duplicate = { type: 'pie', data: { items: [{ id: 'a', value: 60 }, { id: 'a', value: 40 }] } };
    const duplicateFinding = ((render({ spec: duplicate }).body.errors ?? []) as (Finding & { fix?: JsonPatchOperation[] })[])
      .find(entry => entry.path === '/data/items')!;
    expect(duplicateFinding.fix).toBeUndefined();
    const extra = { type: 'pie', data: { items: [{ id: 'a', value: 60, extra: 1 }] } };
    const extraFinding = ((render({ spec: extra }).body.errors ?? []) as (Finding & { fix?: JsonPatchOperation[] })[])
      .find(entry => entry.path === '/data/items')!;
    expect(extraFinding.suggest).not.toContain('Remove');
    expect(extraFinding.fix).toBeUndefined();
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
