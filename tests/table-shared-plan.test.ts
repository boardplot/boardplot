import { describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, planResolvedRequest, resolveChartRequest } from '../src/core/request';
import { renderSvg } from '../src/core/svg/renderSvg';
import { withEngineNotes } from '../src/core/notes';
import { layoutTable, layoutTableCard, prepareTableExecutor } from '../src/core/charts/table/layout';
import * as tableResolution from '../src/core/charts/table/resolve';
import { ENGINE_NOTES, SOFT_LABEL_CAP, LABEL_WRAP_FLOOR } from '../src/core/charts/table/tracks';
import { FIXED_SIZE_PROBE, WIDTH_PROBE } from '../src/core/sizing';
import { PLAN_ONLY, materializeLayout } from '../src/core/layoutPlan';
import * as tablePlans from '../src/core/layoutPlan';
import * as tableWidths from '../src/core/charts/table/widths';
import * as dimensionCompiler from '../src/core/charts/dimswitch/compile';
import * as tableFitPolicy from '../src/core/charts/table/fitPolicy';
import type { TableData, TableOptions } from '../src/core/types/table';
import type { DimSwitchData, DimSwitchDerived, DimSwitchOptions } from '../src/core/charts/dimswitch/types';
import type { Geometry } from '../src/core/types/scene';
import { defaultMeasurer, type TextMeasurer } from '../src/core/text';
import { resolveTheme } from '../src/core/theme';

const fixture = getFixtures('table').find((entry) => entry.id === 'steering-monthly')!;

function draw(data: object, width: number): string {
  const request = resolveChartRequest({ type: 'table', data, options: { ...fixture.options, size: { width } } } as Parameters<typeof resolveChartRequest>[0]);
  return renderSvg(layoutResolvedRequest(request) as Geometry, request.theme);
}

// The type class changes at 1080 px while the plot width stays 1023, so a plan shared across that edge draws the wrong fonts.
describe('table width plan shared on one data object', () => {
  // A caller may edit its returned cells and fonts without changing later charts that share measured tracks.
  it('keeps returned cells and fonts separate from shared preparation', () => {
    const data = structuredClone(fixture.data) as object;
    const request = resolveChartRequest({ type: 'table', data, options: { ...fixture.options, size: { width: 1200 } } } as Parameters<typeof resolveChartRequest>[0]);
    const result = layoutResolvedRequest(request) as Geometry;
    const expected = renderSvg(result, request.theme);
    const text = result.scene.find(node => node.t === 'text');
    if (text?.t === 'text') text.font.size += 20;
    const table = result.derived.table as import('../src/core/types/table').TableDerived['table'];
    const cell = Object.values(table.rows[0]!.cells)[0]!;
    const displayed = cell.displayed;
    cell.displayed = 'Changed by caller';
    const next = layoutResolvedRequest(request) as Geometry;
    expect(renderSvg(next, request.theme)).toBe(expected);
    expect(Object.values((next.derived.table as import('../src/core/types/table').TableDerived['table']).rows[0]!.cells)[0]!.displayed).toBe(displayed);
  });

  // A React host lays out again on stable data at every render, and it must not pay for the fit ladder each time.
  it('serves a repeat layout on stable data without measuring', () => {
    let calls = 0;
    const measure: TextMeasurer = (text, font) => { calls++; return defaultMeasurer(text, font); };
    const request = resolveChartRequest({ type: 'table', data: structuredClone(fixture.data), options: { ...fixture.options, measure, size: { width: 878 } } } as Parameters<typeof resolveChartRequest>[0]);
    const first = renderSvg(layoutResolvedRequest(request) as Geometry, request.theme);
    expect(calls).toBeGreaterThan(0);
    calls = 0;
    expect(renderSvg(layoutResolvedRequest(request) as Geometry, request.theme)).toBe(first);
    expect(calls).toBe(0);
  });

  it.each([[1079, 1087], [1087, 1079]])('draws %i then %i as fresh draws', (first, second) => {
    const shared = structuredClone(fixture.data) as object;
    draw(shared, first);
    expect(draw(shared, second)).toBe(draw(structuredClone(fixture.data) as object, second));
  });
});

// Sizing candidates must not draw, and a caller's edited scene must not corrupt the memoized plan.
it('defers drawing and returns an isolated result from the same numeric plan', () => {
  const data = structuredClone(fixture.data) as TableData;
  const options = { ...fixture.options, size: { width: 878 }, [PLAN_ONLY]: true } as TableOptions;
  const plan = layoutTableCard(data, options);
  expect(plan.scene).toEqual([]);
  const first = materializeLayout(plan);
  const expected = JSON.stringify(first);
  const text = first.scene.find(node => node.t === 'text')!;
  if (text.t === 'text') { text.font.size = 999; text.lines.push('Changed line'); }
  first.marks.rows[0]!.h = 999;
  first.scene.length = 0;
  first.derived.table.rows[0]!.label = 'changed';
  const repeated = layoutTableCard(data, options);
  expect(repeated.scene).toEqual([]);
  expect(JSON.stringify(materializeLayout(repeated))).toBe(expected);
});

// A host's scene-free sizing must accept and refuse the same sizes as a full render.
it.each([878, 200])('keeps sizing and refusal advice without drawing at %i px', (width) => {
  const request = resolveChartRequest({ type: 'table', data: structuredClone(fixture.data), options: { ...fixture.options, size: { width }, belowMinimum: 'refuse' } } as Parameters<typeof resolveChartRequest>[0]);
  const planned = planResolvedRequest(request);
  const full = layoutResolvedRequest(request);
  expect(planned.refused).toBe(full.refused);
  expect(planned.size).toEqual(full.size);
  expect(planned.sizing).toEqual(full.sizing);
  if (planned.refused && full.refused) {
    expect(planned.warnings).toEqual(full.warnings);
  } else if (!planned.refused) expect(planned.scene).toEqual([]);
  const expected = JSON.stringify(planned);
  planned.size.width = -1;
  planned.warnings.length = 0;
  expect(JSON.stringify(planResolvedRequest(request))).toBe(expected);
});

// Input versions must notice data edits and theme override replacements between synchronous requests.
it('invalidates plans after in-place data changes and theme override replacements', () => {
  const data: TableData = { columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }], rows: [{ id: 'a', label: 'A', cells: { v: 1 } }] };
  const theme = { overrides: { type: { label: { size: 13 } } } };
  const options = { size: { width: 878 }, theme };
  layoutTableCard(data, options);
  data.rows[0]!.label = 'A longer label';
  data.rows[0]!.cells!.v = 123456;
  expect(JSON.stringify(layoutTableCard(data, options))).toBe(JSON.stringify(layoutTableCard(structuredClone(data), { ...options, theme: structuredClone(theme) })));
  theme.overrides = { type: { label: { size: 15 } } };
  expect(JSON.stringify(layoutTableCard(data, options))).toBe(JSON.stringify(layoutTableCard(structuredClone(data), { ...options, theme: structuredClone(theme) })));
});

// Request preparation creates equal theme wrappers. A repeat must retain the selected numeric plan and its scene.
it('reuses the selected plan across repeated resolved requests', () => {
  const request = resolveChartRequest({ type: 'table', data: structuredClone(fixture.data),
    options: { ...fixture.options, theme: { preset: 'bridge' }, size: { width: 878 } } } as Parameters<typeof resolveChartRequest>[0]);
  const expected = JSON.stringify(layoutResolvedRequest(request));
  const plans = vi.spyOn(tablePlans, 'deferLayout');
  const widths = vi.spyOn(tableWidths, 'tableWidths');
  try {
    expect(JSON.stringify(layoutResolvedRequest(request))).toBe(expected);
    expect(plans.mock.calls.length).toBe(0);
    expect(widths.mock.calls.length).toBe(0);
  } finally {
    plans.mockRestore();
    widths.mockRestore();
  }
});

// Private compiled models must not hide source edits or leak through mutable public results.
it('keeps dimension table source edits and returned compiled data isolated', () => {
  const entry = getFixtures('dimswitch')[0]!;
  const data = structuredClone(entry.data) as DimSwitchData;
  const options: DimSwitchOptions = { ...entry.options, theme: { preset: 'bridge' }, size: { width: 878 },
    columnOverrides: { label: { label: 'Metric' } } };
  const render = (source = data, settings = options) => {
    const result = layoutResolvedRequest(resolveChartRequest({ type: 'dimswitch', data: source, options: settings }));
    expect(result.refused).not.toBe(true);
    return result as unknown as Geometry<object, DimSwitchDerived>;
  };
  const first = render();
  const expected = JSON.stringify(first);
  first.scene.length = 0;
  first.derived.table.rows[0]!.label = 'Changed result';
  first.derived.compiled.data.rows[0]!.label = 'Changed compiled row';
  first.derived.compiled.data.columns[0]!.label = 'Changed compiled column';
  expect(JSON.stringify(render())).toBe(expected);

  const sums = data.facts[0]!.sums;
  const field = Object.keys(sums).find(key => typeof sums[key] === 'number')!;
  sums[field] = (sums[field] as number) + 17;
  const changedData = JSON.stringify(render());
  expect(changedData).not.toBe(expected);
  expect(changedData).toBe(JSON.stringify(render(structuredClone(data), structuredClone(options))));
  options.columnOverrides!.label!.label = 'Revised metric';
  const changedOptions = JSON.stringify(render());
  expect(changedOptions).not.toBe(changedData);
  expect(changedOptions).toBe(JSON.stringify(render(structuredClone(data), structuredClone(options))));

  const plans = vi.spyOn(tablePlans, 'deferLayout');
  const widths = vi.spyOn(tableWidths, 'tableWidths');
  try {
    expect(JSON.stringify(render())).toBe(changedOptions);
    expect(plans).not.toHaveBeenCalled();
    expect(widths).not.toHaveBeenCalled();
  } finally {
    plans.mockRestore();
    widths.mockRestore();
  }
});

// Ordinary rendering promises a verified width, while measurement still finds the exact floor.
it('returns a safe width-only table repair without requiring exact minimum advice', () => {
  const spec = { type: 'table', data: structuredClone(fixture.data),
    options: { ...fixture.options, size: { width: 200 }, belowMinimum: 'refuse' as const } };
  const request = resolveChartRequest(spec as Parameters<typeof resolveChartRequest>[0]);
  const result = layoutResolvedRequest(request);
  expect(result.refused).toBe(true);
  const warning = result.warnings.find(w => w.code === 'size-below-floor')!;
  expect(warning.message).toContain('verified width');
  const fix = warning.fix?.find(f => f.path === '/options/size');
  expect(fix && 'value' in fix).toBeTruthy();
  const size = (fix as { value: { width: number } }).value;
  expect(Object.keys(size)).toEqual(['width']);
  const repaired = layoutResolvedRequest(resolveChartRequest({ ...spec, options: { ...spec.options, size } } as Parameters<typeof resolveChartRequest>[0]));
  expect(repaired.refused).not.toBe(true);
  expect(repaired.warnings.filter(w => w.severity === 'error')).toEqual([]);
});

// View and fitting flags must reuse the data model while keeping their own drawn result.
it('reuses table resolution across inline visibility and layout flags', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'v', kind: 'value' }],
    rows: [{ id: 'a', label: 'A', cells: { v: 100 } },
      { id: 'change', parentId: 'a', label: 'Change', inline: true, inlineGroup: 'change', cells: { v: 2 } }],
  };
  const options: TableOptions = { theme: { preset: 'bridge' }, size: { width: 878 } };
  layoutTable(data, options);
  const resolve = vi.spyOn(tableResolution, 'resolveTable');
  try {
    for (const extra of [{ inlineVisibility: { change: false } }, { [FIXED_SIZE_PROBE]: true },
      { [ENGINE_NOTES]: ['The reporting period is incomplete.'] }, { [SOFT_LABEL_CAP]: true }, { [LABEL_WRAP_FLOOR]: true }]) {
      resolve.mockClear();
      const actual = layoutTable(data, { ...options, ...extra });
      expect(resolve).not.toHaveBeenCalled();
      expect(JSON.stringify(actual)).toBe(JSON.stringify(layoutTable(structuredClone(data), { ...options, ...extra })));
    }
  } finally {
    resolve.mockRestore();
  }
});

// A note's metadata sits on a hidden symbol: copied as a visible key, two equal results compare as different.
it('keeps hidden symbol keys hidden on a copied result', () => {
  const hidden = Symbol('hidden');
  const copy = tablePlans.copyPlannedValue({ note: Object.defineProperty({ text: 'a' }, hidden, { value: { kind: 'b' }, configurable: true }) });
  expect(Object.getOwnPropertyDescriptor(copy.note, hidden)?.enumerable).toBe(false);
  expect((copy.note as unknown as Record<symbol, unknown>)[hidden]).toEqual({ kind: 'b' });
});

// A cache hit copied a Map's values but kept its key objects, so a lookup with the copied object missed.
it('finds a Map entry and a Set member by the copied object after a cache hit', () => {
  const plot = { x: 1 };
  const copy = tablePlans.copyPlannedValue({ plot, members: new Set([plot]), byPlot: new Map([[plot, 'a']]) });
  expect(copy.plot).not.toBe(plot);
  expect([copy.members.has(copy.plot), copy.byPlot.get(copy.plot)]).toEqual([true, 'a']);
});

// A visibility change reuses the private data while returning the current options and exact property shape.
it.each([undefined, 'Effect'])('reuses dimension forms with current inline visibility and effect label %s', (effectLabel) => {
  const entry = getFixtures('dimswitch')[0]!;
  const data = structuredClone(entry.data) as DimSwitchData;
  if (effectLabel === undefined) delete data.effectLabel;
  else data.effectLabel = effectLabel;
  const base: DimSwitchOptions = { ...entry.options, theme: { preset: 'bridge' }, variant: 'by-member', depth: 3, splits: true };
  delete base.inlineVisibility;
  const render = (source: DimSwitchData, options: DimSwitchOptions) => {
    const result = layoutResolvedRequest(resolveChartRequest({ type: 'dimswitch', data: source, options }));
    expect(result.refused).not.toBe(true);
    return result as unknown as Geometry<object, DimSwitchDerived>;
  };
  const compile = vi.spyOn(dimensionCompiler, 'compileDimSwitch');
  const resolve = vi.spyOn(tableResolution, 'resolveTable');
  const variants: Pick<DimSwitchOptions, 'inlineVisibility'>[] = [{}, { inlineVisibility: { change: false } }, { inlineVisibility: undefined },
    { inlineVisibility: { change: true } }, {}, { inlineVisibility: { change: false, effect: true } }];
  try {
    for (const [index, visibility] of variants.entries()) {
      // Different widths force outer layout work even when undefined equals an absent option there.
      const options: DimSwitchOptions = index === 5
        ? { ...visibility, ...base, size: { width: 3000 + index } }
        : { ...base, size: { width: 3000 + index }, ...visibility };
      compile.mockClear();
      resolve.mockClear();
      const actual = render(data, options);
      if (index > 0) { expect(compile).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); }
      const current = actual.derived.compiled.options;
      const fresh = render(structuredClone(data), structuredClone(options));
      expect(Object.hasOwn(current, 'inlineVisibility')).toBe(Object.hasOwn(fresh.derived.compiled.options, 'inlineVisibility'));
      expect(current.inlineVisibility).toStrictEqual(fresh.derived.compiled.options.inlineVisibility);
      const left = JSON.stringify(actual), right = JSON.stringify(fresh);
      const mismatch = [...left].findIndex((character, at) => character !== right[at]);
      expect(left === right, JSON.stringify({ index, effectLabel, mismatch, actual: left.slice(mismatch - 50, mismatch + 180), fresh: right.slice(mismatch - 50, mismatch + 180) })).toBe(true);
      if (current.inlineVisibility) current.inlineVisibility.change = !current.inlineVisibility.change;
      expect(JSON.stringify(render(data, options)) === JSON.stringify(fresh), 'The next result stays isolated from edited returned options').toBe(true);
    }
    const noteOptions: DimSwitchOptions = { ...base, size: { width: 3000 }, inlineVisibility: { change: false }, notes: { show: ['disclosure'] } };
    const shown = render(data, noteOptions);
    noteOptions.notes!.show = ['method'];
    const hidden = render(data, noteOptions);
    expect(hidden.frame.noteList?.find(note => note.text === 'Week 2 to date')?.kind).toBe('disclosure');
    expect(JSON.stringify(hidden.frame)).not.toBe(JSON.stringify(shown.frame));
    expect(JSON.stringify(hidden) === JSON.stringify(render(structuredClone(data), structuredClone(noteOptions))), 'Caller note edits match a fresh render').toBe(true);
  } finally {
    compile.mockRestore();
    resolve.mockRestore();
  }
});

// A kept dimension form must not change a note from disclosure to method when one data object renders at a second width.
it('keeps note kinds when one dimension data object renders at a second width', () => {
  const entry = getFixtures('dimswitch').find(fixture => fixture.id === 'by-member')!;
  const noteKinds = (data: DimSwitchData, width: number) => {
    const result = layoutResolvedRequest(resolveChartRequest({ type: 'dimswitch', data, options: { ...entry.options, size: { width } } }));
    return (result as unknown as Geometry).frame.noteList?.map(note => [note.text, note.kind]);
  };
  const data = structuredClone(entry.data) as DimSwitchData;
  noteKinds(data, 332);
  const fresh = noteKinds(structuredClone(entry.data) as DimSwitchData, 878);
  expect(fresh?.length).toBeGreaterThan(0);
  expect(noteKinds(data, 878)).toEqual(fresh);
});

// A retained executor must not reuse old footer, canvas or refusal metadata when only the frame changes.
it('settles each frame of a prepared table exactly as a fresh executor', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel', width: 180 }, { id: 'status', kind: 'status', label: 'Status', width: 74, labels: { pending: 'Waiting for a detailed review', 'at-risk': 'Waiting for a different review' } },
      { id: 'value', kind: 'value', label: 'Value', width: 110 }],
    rows: [{ id: 'a', label: 'A long row label that can wrap', cells: { status: 'pending', value: 123456 } },
      { id: 'b', label: 'Another row', cells: { status: 'at-risk', value: 234567 } }],
  };
  const executor = prepareTableExecutor(data);
  const theme = { preset: 'bridge' as const };
  for (const size of [{ width: 332 }, { width: 878, height: 140 }, { width: 878, height: 500 }, { width: 332, height: 320 }, undefined]) {
    const options: TableOptions = { theme, size, source: 'Reported values', footnotes: ['A source note'], notes: { show: ['note', 'disclosure'] }, cellPadX: 3 };
    const actual = executor.runCard(options);
    const fresh = layoutTableCard(structuredClone(data), options);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(fresh));
  }
});

// A shared table view must keep disclosure notes typed correctly in a later request's fresh note scope.
it('replays disclosure metadata for retained executors and equal cloned inputs', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'value', kind: 'value', label: 'Value' }],
    rows: [{ id: 'a', label: 'A', cells: { value: { state: 'suppressed' } } }],
  };
  const retained = prepareTableExecutor(data);
  const render = (executor: ReturnType<typeof prepareTableExecutor>, height: number) => withEngineNotes(() =>
    executor.run({ size: { width: 878, height }, notes: { show: ['disclosure'] } }), true);
  const first = render(retained, 200);
  const notes = first.frame.noteList!.map(({ text, kind }) => ({ text, kind }));
  expect(notes).toEqual([{ text: tableResolution.suppressedFootnote(), kind: 'disclosure' }]);
  // Different heights require a fresh frame while the numeric view is unchanged.
  expect(render(retained, 201).frame.noteList!.map(({ text, kind }) => ({ text, kind }))).toEqual(notes);
  const cloned = prepareTableExecutor(structuredClone(data));
  expect(render(cloned, 202).frame.noteList!.map(({ text, kind }) => ({ text, kind }))).toEqual(notes);
});

// A host retry at an already checked width must reuse its fit without losing the scene or caller isolation.
it('retains a complete table fit across a repair probe and fresh equal input', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'value', kind: 'value' }],
    rows: [{ id: 'a', label: 'Retained repair', cells: { value: 17 } }],
  };
  const options: TableOptions = { size: { width: 878 }, theme: { preset: 'bridge' }, source: 'Original source' };
  const planned = layoutTableCard(data, { ...options, [PLAN_ONLY]: true, [WIDTH_PROBE]: 'table' } as TableOptions);
  const fits = vi.spyOn(tableFitPolicy, 'executeTableFit');
  try {
    const drawn = layoutTableCard(structuredClone(data), structuredClone(options));
    expect(fits).not.toHaveBeenCalled();
    expect(drawn.scene.length).toBeGreaterThan(0);
    expect(JSON.stringify(drawn)).toBe(JSON.stringify(materializeLayout(planned)));
    const expected = JSON.stringify(drawn);
    drawn.derived.table.rows[0]!.label = 'Changed returned row';
    drawn.scene.length = 0;
    expect(JSON.stringify(layoutTableCard(structuredClone(data), structuredClone(options)))).toBe(expected);
  } finally { fits.mockRestore(); }
});

// A sizing result can be drawn later, after the original data and nested options have changed.
it('keeps retained numeric plans independent of later caller edits', () => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'value', kind: 'value' }],
    rows: [{ id: 'a', label: 'Owned input', cells: { value: 23 } }],
  };
  const options: TableOptions = { size: { width: 900 }, theme: { preset: 'bridge' }, a11y: { title: true } };
  const originalData = structuredClone(data);
  const originalOptions = structuredClone(options);
  const planned = layoutTable(data, { ...options, [PLAN_ONLY]: true } as TableOptions);
  data.rows[0]!.label = 'Changed input';
  data.rows[0]!.cells!.value = 900;
  options.a11y!.title = false;
  const owned = materializeLayout(planned);
  expect(owned.derived.table.rows[0]!.label).toBe('Owned input');
  expect(JSON.stringify(owned)).toBe(JSON.stringify(layoutTable(originalData, originalOptions)));
  expect(JSON.stringify(layoutTable(data, options))).not.toBe(JSON.stringify(owned));
});

// Copying a resolved theme must not turn its responsive type sizes into authored fixed sizes.
it.each([332, 1234])('keeps owned-theme footer type at %i px', (width) => {
  const data: TableData = {
    columns: [{ id: 'label', kind: 'rowLabel' }, { id: 'value', kind: 'value' }],
    rows: [{ id: 'a', label: 'Theme ownership', cells: { value: 31 } }],
  };
  const options: TableOptions = { size: { width }, title: 'Owned theme footer', source: 'Reported figures', footnotes: ['One source note'] };
  const direct = layoutTable(data, { ...options, theme: 'bridge' });
  const owned = layoutTable(structuredClone(data), { ...options, theme: { preset: 'bridge', overrides: resolveTheme('bridge') } });
  expect(JSON.stringify(owned)).toBe(JSON.stringify(direct));
});
