// @vitest-environment jsdom
/**
 * An option that does nothing leaves its type, and a spec saved with it keeps
 * drawing. One old spec per route goes through the schema path and through
 * the zod-free React path: it must draw what the spec without the key draws,
 * warn, and offer a patch that applies. Without this, a removal could refuse a
 * saved chart, or a warning could offer a patch that points at nothing.
 */
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { render } from '../src/cli/render';
import '../src/core/charts';
import { exampleData } from '../src/core/charts/dimswitch/example';
import { patchApplies, type JsonPatchOperation } from '../src/core/diagnostics/jsonPatch';
import { CohortChart } from '../src/react/charts/cohort';
import { DimSwitchChart } from '../src/react/DimSwitchChart';
import { getFixtures } from '../src/fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Warning = { code: string; path?: string; field?: (string | number)[]; fix?: JsonPatchOperation[] };
const draw = (spec: object) => {
  const { exit, body } = render({ spec, return: ['svg'] }) as { exit: number; body: { svg: string; warnings?: Warning[] } };
  expect(exit).toBe(0);
  return { svg: body.svg.replace(/(id="|url\(#|aria-describedby="|href="#)[^")]*/g, '$1'), warnings: body.warnings ?? [] };
};
const fixture = (type: string, id?: string) => {
  const found = getFixtures(type).find((candidate) => id === undefined || candidate.id === id)!;
  return { type, data: found.data, options: found.options as Record<string, unknown> };
};

/** The old spec draws what the spec without the key draws, warns `code` on `path`, and its patch leaves the clean spec. */
function dropsTheKey(clean: object, old: object, code: string, path: string) {
  const without = draw(clean);
  const drawn = draw(old);
  expect(drawn.svg).toBe(without.svg);
  const warning = drawn.warnings.find((candidate) => candidate.code === code && candidate.fix?.some((operation) => operation.path === path));
  expect(warning, `${code} with a patch on ${path}`).toBeDefined();
  expect(patchApplies(old, warning!.fix!)).toBe(true);
}

/** Mounts a React entry, which links no zod, and returns the warnings of a chart that drew. */
function mountedWarnings(Chart: ComponentType<object>, props: object): Warning[] {
  const host = document.createElement('div');
  const root = createRoot(host);
  const seen: Warning[][] = [];
  const all = { ...props, size: { width: 800, height: 500 }, onWarnings: (warnings: Warning[]) => seen.push(warnings) };
  act(() => root.render(<Chart {...all} />));
  expect(host.textContent).not.toContain('Details');
  act(() => root.unmount());
  return seen.at(-1) ?? [];
}
const dimswitch = (props: object) => mountedWarnings(DimSwitchChart as never, { data: exampleData, depth: 1, ...props });

describe('a removed option keeps an old spec drawing', () => {
  it('removed from the type: dimswitch group heads', () => {
    const clean = { type: 'dimswitch', data: exampleData, options: { title: 'Old spec' } };
    dropsTheKey(clean, { ...clean, options: { ...clean.options, groupRule: 'label' } }, 'option-deprecated', '/options/groupRule');
    expect(dimswitch({ groupAlign: 'left', variant: 'by-measure' })).toContainEqual(expect.objectContaining({
      code: 'option-deprecated', fix: [{ op: 'remove', path: '/options/groupAlign' }] }));
  });

  it('removed from a variant: an omitted cohort variant is the heatmap', () => {
    const clean = fixture('cohort', 'saas-logo-retention');
    const old = { ...clean, options: { ...clean.options, exhibitLabel: 'Old label', designatedPeriod: 2 } as Record<string, unknown> };
    expect(old.options.variant).toBeUndefined();
    dropsTheKey(clean, old, 'option-ignored', '/options/exhibitLabel');
    expect(mountedWarnings(CohortChart as never, { data: clean.data, ...old.options })).toContainEqual(expect.objectContaining({
      code: 'option-ignored', fix: [{ op: 'remove', path: '/options/designatedPeriod' }] }));
    // Refusing false stays: it names the one variant that takes it.
    expect((render({ spec: { ...clean, options: { ...clean.options, designatedPeriod: false } }, return: ['svg'] }) as { exit: number }).exit).not.toBe(0);
  });

  it('removed from a variant set by an alias: topN.showRestCount on a dumbbell', () => {
    const clean = fixture('dot', 'share-shift-dumbbell');
    const { variant: _variant, ...options } = clean.options;
    const spec = (topN: object) => ({ type: 'dumbbell', data: clean.data, options: { ...options, topN } });
    dropsTheKey(spec({ n: 2 }), spec({ n: 2, showRestCount: true }), 'option-ignored', '/options/topN/showRestCount');
  });

  it('warned by the layout: by-measure totalPosition and an encoding on no column', () => {
    const clean = { type: 'dimswitch', data: exampleData, options: { variant: 'by-measure' } };
    dropsTheKey(clean, { ...clean, options: { ...clean.options, totalPosition: 'bottom' } }, 'option-ignored', '/options/totalPosition');
    expect(dimswitch({ variant: 'by-measure', totalPosition: 'bottom' })).toContainEqual(expect.objectContaining({
      code: 'option-ignored', fix: [{ op: 'remove', path: '/options/totalPosition' }] }));
    expect(dimswitch({ variant: 'by-member', totalPosition: 'bottom' }).some((warning) => warning.field?.includes('totalPosition'))).toBe(false);
    dropsTheKey(clean, { ...clean, options: { ...clean.options, encodings: { 'a/b': 'heat' } } }, 'dimswitch-encoding-column', '/options/encodings/a~1b');
  });

  // never in a child schema would refuse a grid that exits 0 today, because the grid checks panels against it.
  it('annotations on a grid panel and on a repeat template', () => {
    const kpi = fixture('kpi');
    const panel = { id: 'one', type: 'kpi', data: kpi.data, options: kpi.options };
    const explicit = (extra: object) => ({ type: 'grid', data: { panels: [{ ...panel, ...extra }] }, options: { size: { width: 600 } } });
    const note = [{ kind: 'note', at: 'x', text: 'Old note' }];
    dropsTheKey(explicit({}), explicit({ annotations: note }), 'option-deprecated', '/data/panels/0/annotations');
    const repeated = (extra: object) => ({ type: 'grid', options: { size: { width: 600 } }, data: {
      repeat: { dimension: 'region', values: ['EU', 'UK'] },
      template: { id: '$region', type: 'kpi', options: kpi.options, data: { bySlice: { EU: kpi.data, UK: kpi.data } }, ...extra },
    } });
    dropsTheKey(repeated({}), repeated({ annotations: note }), 'option-deprecated', '/data/template/annotations');
  });
});
