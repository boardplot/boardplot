// @vitest-environment jsdom
/**
 * An option that does nothing leaves its type, and a spec saved with it keeps
 * drawing. One old spec per route goes through the schema path and through
 * the zod-free React path: it must draw what the spec without the key draws,
 * warn, and offer a patch that applies. Without this, a removal could refuse a
 * saved chart, or a warning could offer a patch that points at nothing.
 */
import { act, createElement, type ComponentType } from 'react';
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

  it('removed from a variant set by an alias: arrow stays on a dumbbell and leaves a lollipop', () => {
    const clean = fixture('dot', 'share-shift-dumbbell');
    const { variant: _variant, ...options } = clean.options;
    const spec = (type: string, extra: object) => ({ type, data: clean.data, options: { ...options, ...extra } });
    expect(draw(spec('dumbbell', { arrow: true })).warnings.flatMap((warning) => warning.fix ?? []).map((operation) => operation.path)).not.toContain('/options/arrow');
    const single = fixture('dot', getFixtures('dot').find((candidate) => (candidate.data as { series: unknown[] }).series.length === 1)!.id);
    const lollipop = { ...single, type: 'lollipop' };
    dropsTheKey(lollipop, { ...lollipop, options: { ...lollipop.options, arrow: true } }, 'option-ignored', '/options/arrow');
  });

  it('warned by the layout: by-measure totalPosition and an encoding on no column', () => {
    const clean = { type: 'dimswitch', data: exampleData, options: { variant: 'by-measure' } };
    dropsTheKey(clean, { ...clean, options: { ...clean.options, totalPosition: 'bottom' } }, 'option-ignored', '/options/totalPosition');
    expect(dimswitch({ variant: 'by-measure', totalPosition: 'bottom' })).toContainEqual(expect.objectContaining({
      code: 'option-ignored', fix: [{ op: 'remove', path: '/options/totalPosition' }] }));
    expect(dimswitch({ variant: 'by-member', totalPosition: 'bottom' }).some((warning) => warning.field?.includes('totalPosition'))).toBe(false);
    dropsTheKey(clean, { ...clean, options: { ...clean.options, encodings: { 'a/b': 'heat' } } }, 'dimswitch-encoding-column', '/options/encodings/a~1b');
  });

  // A key the type accepts and cannot draw used to pass with ok: true and change nothing.
  it('accepted with nothing to draw: topN.threshold on a pie, focus on a dimswitch', () => {
    const pie = fixture('pie');
    const clean = { type: 'pie', data: pie.data, options: { ...pie.options, topN: { n: 3 } } };
    dropsTheKey(clean, { ...clean, options: { ...clean.options, topN: { n: 3, threshold: 50 } } }, 'option-ignored', '/options/topN/threshold');
    const ignored = dimswitch({ focus: { owner: { seriesId: 'a' } } }).filter((warning) => warning.code === 'option-ignored');
    expect(ignored).toEqual([expect.objectContaining({ fix: [{ op: 'remove', path: '/options/focus' }] })]);
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
  it('a variant in another case keeps what that variant reads', () => {
    const cases = [
      { spec: fixture('cohort', 'saas-logo-retention'), exact: 'heatmap', other: 'HEATMAP', keys: { averages: 'weighted' } },
      { spec: fixture('cohort', 'saas-logo-retention'), exact: 'pure', other: 'Pure', keys: { designatedPeriod: 1 } },
      { spec: fixture('bar', 'dcf-npv-sensitivity'), exact: 'tornado', other: 'Tornado', keys: { tornado: { low: 'high', high: 'low' } } },
    ];
    for (const { spec, exact, other, keys } of cases) {
      const size = { size: { width: 720, height: 580 } };
      const named = (variant: string) => ({ ...spec, options: { ...spec.options, ...size, ...keys, variant } });
      const drawn = draw(named(other));
      expect(drawn.svg).toBe(draw(named(exact)).svg);
      expect(drawn.warnings.filter((warning) => warning.code === 'option-ignored')).toEqual([]);
      const panel = (variant: string) => ({ type: 'grid', options: { size: { width: 720, height: 580 } }, data: { panels: [{ id: 'one', type: spec.type, data: spec.data, options: { ...spec.options, ...keys, variant } }] } });
      if (spec.type === 'bar') expect(draw(panel(other)).svg).toBe(draw(panel(exact)).svg);
    }
    const cohort = fixture('cohort', 'saas-logo-retention');
    const clean = { ...cohort, options: { ...cohort.options, variant: 'Pure' } };
    dropsTheKey(clean, { ...clean, options: { ...clean.options, averages: 'weighted' } }, 'option-ignored', '/options/averages');
  });

  it('a variant in another case in React: the raw text still runs the exhibit layout', async () => {
    const cohort = fixture('cohort', 'retention-pure-exhibit');
    const host = document.createElement('div');
    const root = createRoot(host);
    const props: object = { data: cohort.data, ...cohort.options, variant: 'HEATMAP', cohortSizeLabel: 'Old size head', size: { width: 720, height: 580 } };
    await act(async () => { root.render(createElement(CohortChart as never, props as never)); });
    await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
    expect(host.textContent?.toUpperCase()).toContain('OLD SIZE HEAD');
    act(() => root.unmount());
  });

  describe('an encoding patch never breaks a drawn chart', () => {
    const byMeasure = fixture('dimswitch', 'by-measure');
    const spec = (options: object) => ({ ...byMeasure, options: { ...byMeasure.options, size: { width: 960, height: 1000 }, ...options } });
    const encodingWarnings = (options: object) => draw(spec(options)).warnings.filter((warning) => warning.code === 'dimswitch-encoding-column');

    it('a hidden column or the last heat entry keeps the warning with no patch', () => {
      for (const [options, count] of [
        [{ figures: false, encodings: { w1: 'heat' }, columnVisibility: { w1: false } }, 1],
        [{ figures: false, encodings: { oldPeriod: 'heat' } }, 1],
        [{ figures: false, encodings: { old1: 'heat', old2: 'heat' } }, 2],
      ] as const) {
        const warnings = encodingWarnings(options);
        expect(warnings).toHaveLength(count);
        for (const warning of warnings) expect(warning.fix).toBeUndefined();
      }
    });

    it('a typo keeps the patch, and the patched spec draws clean', () => {
      const typo = spec({ encodings: { oldPeriod: 'heat' } });
      const [warning] = draw(typo).warnings.filter((candidate) => candidate.code === 'dimswitch-encoding-column');
      expect(warning!.fix).toEqual([{ op: 'remove', path: '/options/encodings/oldPeriod' }]);
      expect(patchApplies(typo, warning!.fix!)).toBe(true);
      expect(encodingWarnings({ encodings: {} })).toEqual([]);
    });

    it('label and an entry that lists columns stay live, so they get no patch', () => {
      const liveSpread = { figures: false, depth: 2, encodings: { label: { type: 'heat', columns: ['w1'] }, pp: 'heat' }, columnVisibility: {} };
      expect(encodingWarnings(liveSpread)[0]!.fix).toBeUndefined();
      const host = document.createElement('div');
      const root = createRoot(host);
      let seen: Warning[] = [];
      act(() => root.render(createElement(DimSwitchChart as never, { data: byMeasure.data, ...spec(liveSpread).options, onWarnings: (warnings: Warning[]) => { seen = warnings; } } as never)));
      expect(host.querySelectorAll('[data-encoding="heat"]')).toHaveLength(20);
      expect(seen.find((warning) => warning.code === 'dimswitch-encoding-column')!.fix).toBeUndefined();
      act(() => root.unmount());
      for (const options of [
        { encodings: { oldKey: { type: 'heat', columns: ['w1'] } } },
        { encodings: { oldKey: { type: 'heat', columns: ['w1'] } }, columnVisibility: { w1: false } },
        { encodings: { label: 'heat' } },
        { encodings: { label: { type: 'heat', scale: 'status' } } },
      ]) expect(encodingWarnings(options)[0]!.fix).toBeUndefined();
      expect(encodingWarnings({ encodings: { oldKey: { type: 'heat', columns: [] } } })[0]!.fix).toEqual([{ op: 'remove', path: '/options/encodings/oldKey' }]);
    });

    it('the offered patch leaves the drawing as it was', () => {
      for (const extra of [{}, { figures: false }]) {
        const old = spec({ ...extra, encodings: { pp: 'heat', oldKey: 'heat' } });
        const [warning] = draw(old).warnings.filter((candidate) => candidate.code === 'dimswitch-encoding-column');
        expect(warning!.fix).toEqual([{ op: 'remove', path: '/options/encodings/oldKey' }]);
        expect(draw(spec({ ...extra, encodings: { pp: 'heat' } })).svg).toBe(draw(old).svg);
      }
    });

    it('a host that shows the column again gets the encoding back', () => {
      const host = document.createElement('div');
      const root = createRoot(host);
      const base = { data: byMeasure.data, ...byMeasure.options, size: { width: 960, height: 1000 } } as object;
      const heatCells = (props: object) => {
        act(() => root.render(createElement(DimSwitchChart as never, { ...base, ...props } as never)));
        return host.querySelectorAll('[data-encoding="heat"]').length;
      };
      expect(heatCells({ columnVisibility: { w1: true } })).toBe(0);
      const shown = heatCells({ encodings: { w1: 'heat' }, columnVisibility: { w1: true } });
      expect(shown).toBeGreaterThan(0);
      expect(heatCells({ encodings: { w1: 'heat' }, columnVisibility: { w1: false } })).toBe(0);
      expect(heatCells({ encodings: { w1: 'heat' }, columnVisibility: { w1: true } })).toBe(shown);
      act(() => root.unmount());
    });
  });
});
