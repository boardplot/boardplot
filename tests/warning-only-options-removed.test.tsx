// @vitest-environment jsdom
/**
 * An option whose only effect was a warning that it does nothing leaves its type or variant, and a saved spec
 * keeps its drawing. Without this, a removal could change or refuse a chart that draws today, or a patch could.
 */
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { render } from '../src/cli/render';
import '../src/core/charts';
import { parseJsonPointer, patchApplies, type JsonPatchOperation } from '../src/core/diagnostics/jsonPatch';
import { BarChart } from '../src/react/charts/bar';
import { ColumnChart } from '../src/react/charts/column';
import { getFixtures } from '../src/fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Warning = { code: string; fix?: JsonPatchOperation[] };
const draw = (spec: object) => {
  const { exit, body } = render({ spec, return: ['svg'] }) as { exit: number; body: { svg: string; warnings?: Warning[] } };
  expect(exit).toBe(0);
  return { svg: body.svg.replace(/(id="|url\(#|aria-describedby="|href="#)[^")]*/g, '$1'), warnings: body.warnings ?? [] };
};
const fixture = (type: string, id: string) => {
  const found = getFixtures(type).find((candidate) => candidate.id === id)!;
  return { type, data: found.data, options: found.options as Record<string, unknown> };
};
const withOptions = <S extends { options: object }>(spec: S, extra: object) => ({ ...spec, options: { ...spec.options, ...extra } });

/** The spec with one remove operation applied. */
function removed(spec: object, operation: JsonPatchOperation): object {
  const copy = structuredClone(spec) as Record<string, unknown>;
  const steps = parseJsonPointer(operation.path);
  const parent = steps.slice(0, -1).reduce<Record<string, unknown>>((node, step) => node[step] as Record<string, unknown>, copy);
  delete parent[steps.at(-1)!];
  return copy;
}

/** Draws what the clean spec draws, warns `code` with a patch on `path`, and the patch keeps the bytes. */
function dropsTheKey(clean: object, old: object, code: string, path: string) {
  const without = draw(clean);
  const drawn = draw(old);
  expect(drawn.svg).toBe(without.svg);
  const warning = drawn.warnings.find((candidate) => candidate.code === code && candidate.fix?.some((operation) => operation.path === path));
  expect(warning, `${code} with a patch on ${path}`).toBeDefined();
  expect(patchApplies(old, warning!.fix!)).toBe(true);
  expect(draw(warning!.fix!.reduce(removed, old)).svg).toBe(without.svg);
}

/** Mounts a React entry, which links no zod, and returns the warnings of a chart that drew. */
function mountedWarnings(Chart: ComponentType<object>, props: object): Warning[] {
  const host = document.createElement('div');
  const root = createRoot(host);
  const seen: Warning[][] = [];
  const all = { ...props, size: { width: 800, height: 500 }, onWarnings: (warnings: Warning[]) => seen.push(warnings) };
  act(() => root.render(<Chart {...all} />));
  act(() => root.unmount());
  return seen.at(-1) ?? [];
}

const grouped = withOptions(fixture('column', 'grouped-twelve-slide'), { variant: 'grouped' });

describe('a warning-only option leaves an old spec drawing', () => {
  it('removed from the type: box, dot and pareto', () => {
    const box = fixture('box', getFixtures('box')[0]!.id);
    dropsTheKey(box, withOptions(box, { valueAxis: { ...(box.options.valueAxis as object), reverse: true } }), 'option-deprecated', '/options/valueAxis/reverse');
    const pareto = fixture('pareto', 'revenue-concentration');
    dropsTheKey(pareto, withOptions(pareto, { highlight: ['x'] }), 'option-deprecated', '/options/highlight');
    const dot = fixture('dot', getFixtures('dot').find((candidate) => (candidate.options as { variant?: string }).variant === undefined)!.id);
    dropsTheKey(withOptions(dot, { topN: { n: 2 } }), withOptions(dot, { topN: { n: 2, rest: true, restLabel: 'Old' } }), 'option-deprecated', '/options/topN/rest');
  });

  it('removed from a variant: an omitted bar variant is grouped, and tornado keeps baseValue', () => {
    const bar = fixture('bar', 'margin-by-brand');
    const { variant: _variant, ...options } = bar.options;
    const clean = { ...bar, options };
    dropsTheKey(clean, withOptions(clean, { baseValue: 100 }), 'option-ignored', '/options/baseValue');
    expect(mountedWarnings(BarChart as never, { data: bar.data, ...options, connectors: true })).toContainEqual(expect.objectContaining({
      code: 'option-ignored', fix: [{ op: 'remove', path: '/options/connectors' }] }));
    const tornado = fixture('bar', 'dcf-npv-sensitivity');
    expect(draw(tornado).warnings.some((warning) => warning.code === 'option-ignored')).toBe(false);
  });

  it('a variant in another case removes nothing in React', () => {
    const bar = fixture('bar', 'dcf-npv-sensitivity');
    const warnings = mountedWarnings(BarChart as never, { data: bar.data, ...bar.options, variant: 'Tornado', connectors: true });
    expect(warnings.some((warning) => warning.code === 'option-ignored')).toBe(false);
  });

  it('annotations on a tornado, at the root, in a grid panel and in a repeat template', () => {
    const tornado = fixture('bar', 'dcf-npv-sensitivity');
    const note = [{ kind: 'note', at: 'x', text: 'Old note' }];
    dropsTheKey(tornado, { ...tornado, annotations: note }, 'option-ignored', '/annotations');
    dropsTheKey(tornado, withOptions(tornado, { annotations: note }), 'option-ignored', '/options/annotations');
    // A host that always passes a list must not get a warning for an empty one.
    expect(draw({ ...tornado, annotations: [] }).warnings.some((warning) => warning.code === 'option-ignored')).toBe(false);
    const panel = { id: 'one', ...tornado };
    const explicit = (extra: object) => ({ type: 'grid', options: { size: { width: 720, height: 580 } }, data: { panels: [{ ...panel, ...extra }] } });
    dropsTheKey(explicit({}), explicit({ annotations: note }), 'option-ignored', '/data/panels/0/annotations');
    const repeated = (extra: object) => ({ type: 'grid', options: { size: { width: 720, height: 1000 } }, data: {
      repeat: { dimension: 'region', values: ['EU', 'UK'] },
      template: { id: '$region', type: 'bar', options: tornado.options, data: { bySlice: { EU: tornado.data, UK: tornado.data } }, ...extra },
    } });
    dropsTheKey(repeated({}), repeated({ annotations: note }), 'option-ignored', '/data/template/annotations');
  });

  it('valueAxis.percent makes a grouped column stacked100, so its connectors stay', () => {
    const percent = withOptions(grouped, { valueAxis: { percent: true }, connectors: true, size: { width: 960 } });
    expect(draw(percent).warnings.some((warning) => warning.code === 'connectors-ignored')).toBe(false);
    expect(draw(percent).svg).not.toBe(draw(withOptions(percent, { connectors: false })).svg);
  });

  describe('a grouped column keeps its key where the key changes the drawing', () => {
    const narrow = withOptions(grouped, { size: { width: 320 } });
    const wide = withOptions(grouped, { size: { width: 960 } });

    it('the warning offers a patch that keeps the bytes', () => {
      for (const [key, value, code] of [['connectors', true, 'connectors-ignored'], ['ribbons', true, 'ribbons-ignored'], ['shareLabels', {}, 'share-labels-ignored'], ['grandTotalLabels', true, 'grand-total-ignored'], ['netLine', { seriesId: 'x' }, 'net-line-ignored']] as const) {
        dropsTheKey(wide, withOptions(wide, { [key]: value }), code, `/options/${key}`);
      }
      expect(mountedWarnings(ColumnChart as never, { data: grouped.data, ...grouped.options, connectors: true })).toContainEqual(expect.objectContaining({
        code: 'connectors-ignored', fix: [{ op: 'remove', path: '/options/connectors' }] }));
    });

    it('a key that stops the step to bars stays, with no patch', () => {
      const clean = draw(narrow);
      expect(clean.warnings.some((warning) => warning.code === 'column-stepped-to-bar')).toBe(true);
      const old = draw(withOptions(narrow, { connectors: true }));
      expect(old.svg).not.toBe(clean.svg);
      expect(old.warnings.find((warning) => warning.code === 'connectors-ignored')!.fix).toBeUndefined();
    });

    it('seriesLabels with legend none brings the key back, so it has no patch', () => {
      const labelled = withOptions(wide, { legend: 'none', seriesLabels: { at: 'right-edge' } });
      expect(draw(labelled).svg).not.toBe(draw(withOptions(wide, { legend: 'none' })).svg);
      expect(draw(labelled).warnings.find((warning) => warning.code === 'series-labels-ignored')!.fix).toBeUndefined();
      dropsTheKey(wide, withOptions(wide, { seriesLabels: { at: 'right-edge' } }), 'series-labels-ignored', '/options/seriesLabels');
    });
  });

  it('warned by the layout: bump bounds and a topN on a range bar', () => {
    const line = getFixtures('line').find((candidate) => (candidate.options as { variant?: string }).variant === 'bump')!;
    const bump = { type: 'line', data: line.data, options: line.options as Record<string, unknown> };
    const axis = bump.options.valueAxis as object | undefined;
    dropsTheKey(bump, withOptions(bump, { valueAxis: { ...axis, max: 9 } }), 'bump-axis-option-ignored', '/options/valueAxis/max');
    const tornado = fixture('bar', 'dcf-npv-sensitivity');
    dropsTheKey(tornado, withOptions(tornado, { topN: { n: 2 } }), 'tornado-topn-ignored', '/options/topN');
    const many = Array.from({ length: 2001 }, (_, index) => ({ id: `c${index}` }));
    const series = (tornado.data as { series: { values: unknown[] }[] }).series.map((item) => ({ ...item, values: many.map((_, index) => item.values[index % item.values.length]) }));
    const crowded = withOptions({ ...tornado, data: { ...(tornado.data as object), categories: many, series } }, { topN: { n: 5 }, size: { width: 900 } });
    const warning = draw(crowded).warnings.find((candidate) => candidate.code === 'tornado-topn-ignored');
    expect(warning!.fix).toBeUndefined();
  });
});
