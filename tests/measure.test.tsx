import { storyView } from '../src/core/story';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import '../src/core/charts';
import '../src/core/geo/packs';
import { getFixtures, getRefusalExamples } from '../src/fixtures';
import { listCharts } from '../src/core/registry';
import { resolveSize } from '../src/core/normalize/shared';
import { defaultMeasurer } from '../src/core/text';
import { measure, measureResolvedRequest, resolveChartRequest, type ChartMeasurement } from '../src/core/request';
import { measure as publicMeasure } from '../src/index';
import { INTERACTIVE_LAYOUT } from '../src/core/footer';
import { callTool } from '../src/mcp/server';
import type { Geometry } from '../src/core/types/scene';
// @ts-expect-error The scorecard script has no declaration file.
import { applyRepair } from '../scripts/layout-scorecard.mjs';

const received = vi.hoisted(() => ({ geometry: undefined as Geometry | undefined }));
vi.mock('../src/react/SceneRenderer', () => ({
  SceneRenderer: ({ geometry }: { geometry: Geometry }) => {
    received.geometry = geometry;
    return null;
  },
}));
import { createChartComponent } from '../src/react/createChartComponent';
import { withoutSvgFooter } from '../src/react/footerFrame';

describe('shared request measurement', () => {
  // Prevents a fractional canvas width from replacing its natural height with the taller minimum-width floor.
  it('keeps the content height at a fractional width and verifies its recommended sizes', () => {
    const fixture = getFixtures('gantt').find(f => f.id === 'status-gantt')!;
    const request = { type: 'gantt', data: fixture.data, options: { ...fixture.options, size: { width: 800.25 } } };
    const result = measure(request);
    expect(result.geometry!.size.width).toBe(800.25);
    expect(result.naturalHeight).toBe(result.geometry!.sizing!.naturalHeight);
    for (const [width, height] of [[result.minWidth, result.minHeight], [800.25, result.minHeightAtWidth],
      [result.naturalWidth, result.naturalHeight], [result.comfortableWidth, result.comfortableHeight]]) {
      const pinned = measure({ ...request, options: { ...request.options, size: { width, height } } });
      expect(pinned.geometry?.size).toEqual({ width, height });
    }
  });
  // Prevents withholding a repair from exposing a floor height that still refuses to draw.
  it('keeps the drawing floor valid when no complete size patch is known', () => {
    const fixture = getFixtures('diagram').find(f => f.id === 'four-child-start-arrow')!;
    const request = { type: 'diagram', data: fixture.data, options: { ...fixture.options, size: { width: 400 } } };
    const result = measure(request);
    const size = { width: Math.max(400, result.minWidth), height: result.minHeightAtWidth };
    expect(measure({ ...request, options: { ...request.options, size } }).geometry).toBeDefined();
  });
  // Prevents an authored top-level size from overriding a repair written under options.size.
  it('repairs the size at the request location that takes precedence', () => {
    const fixture = getFixtures('line').find(f => f.id === 'recession-era-band')!;
    const request = { type: 'line', data: fixture.data, options: fixture.options, size: { width: 480, height: 150 } };
    const warning = measure(request).refused!.warnings.find(w => w.code === 'size-below-floor')!;
    const repaired = measure(applyRepair(request, warning.fix));
    expect(repaired.geometry).toBeDefined();
    expect(repaired.warnings.filter(w => w.severity !== 'info')).toEqual([]);
  });
  // Prevents width advice from stopping at a coarse bracket above a width that already draws in full.
  it('reports the first whole-pixel width that draws the two-panel bar table in full', () => {
    const fixture = getFixtures('bartable').find(f => f.id === 'impact-two-panels')!;
    const request = { type: 'bartable', data: fixture.data, options: { ...fixture.options, size: { width: 960 } } };
    const result = measure(request);
    const at = (width: number) => measure({ ...request, options: { ...request.options, belowMinimum: 'refuse', size: { width } } });
    expect(at(result.minWidth).geometry).toBeDefined();
    expect(at(result.minWidth - 1).geometry?.mode).not.toBe('full');
  });
  // Prevents a suggested bump subset from promising that its labels fit every pinned frame.
  it('leaves a bump subset to the author when its fit is not known', () => {
    const fixture = getRefusalExamples('line').find(f => f.id === 'bump-torture')!;
    const result = measure({ type: 'line', data: fixture.data, options: { ...fixture.options, size: { width: 400, height: 300 } } });
    const warning = result.refused!.warnings.find(w => w.code === 'bump-series-limit')!;
    expect(warning.suggest).toBeTruthy();
    expect(warning.fix).toBeUndefined();
  });

  // Prevents an axis change from being offered as a complete repair for a grid that also lacks room.
  it('gives category alignment guidance without an unverified grid patch', () => {
    const fixture = getRefusalExamples('grid').find(f => f.id === 'category-mismatch')!;
    const result = measure({ type: 'grid', data: fixture.data, options: { ...fixture.options, size: { width: 400, height: 300 } } });
    const warning = result.refused!.warnings.find(w => w.code === 'grid-category-mismatch')!;
    expect(warning.suggest).toBeTruthy();
    expect(warning.fix).toBeUndefined();
  });
  // Render reports its estimated plot repair and measure the verified one (core/registry.ts
  // estimatedPlotAdvice), so a plot-under-floor warning is compared by code and field only.
  const withoutPlotAdvice = <T extends { warnings?: readonly { code: string }[] } | undefined>(result: T): T => result && {
    ...result, warnings: result.warnings?.map(({ code, ...warning }) => code === 'plot-under-floor'
      ? { code, severity: (warning as { severity?: string }).severity, field: (warning as { field?: unknown }).field } : { code, ...warning }),
  };
  // One demo per type at one width: measure and the React chart must agree.
  // A sweep over every demo and width belongs to `npm run check:scorecard`.
  const cases = listCharts().map(({ type }) => ({ type, width: 800 }));
  for (const { type, width } of cases) {
    const demos = getFixtures(type).filter((fixture) => fixture.tags.includes('demo')).slice(0, 1);
    const groups = demos.map(fixture => [fixture]);
    for (const fixtures of groups) it(`${type}/${fixtures[0]!.id} demos match the React layout at width ${width}`, async () => {
      // TableChart deliberately renders a scrolling HTML table; the generic
      // component checks the canonical fixed-frame table geometry here.
      // Linked like an entry that links both fetched modules: a server frame of a chart whose entry
      // does not link them draws the busy placeholder (core/deferred asFirstFrame).
      const Component = createChartComponent(type, undefined, ['theme-rules', 'annotate']);
      for (const fixture of fixtures) {
        await new Promise<void>(resolve => setImmediate(resolve));
        const options = { ...fixture.options, size: { ...resolveSize(fixture.options?.size), width } };
        const request = resolveChartRequest({ type, data: fixture.data, options, annotations: fixture.annotations });
        const liveOptions = { ...request.options, [INTERACTIVE_LAYOUT]: true };
        const result = measureResolvedRequest({ ...request, options: liveOptions });
        received.geometry = undefined;
        const html = renderToStaticMarkup(createElement(Component, { data: fixture.data, ...options, annotations: fixture.annotations ?? options.annotations }));
        const context = `${type}/${fixture.id} at ${width}`;
        const drawn = received.geometry as Geometry | undefined;
        // A story draws its interactive step (buttons, counter); measure returns the static one.
        const actual = drawn?.story ? { ...drawn, ...storyView(drawn, drawn.story.step, false) } : drawn;
        if (result.refused) {
          expect(actual, context).toBeUndefined();
          // a layout's error lint refuses the chart in React as in the
          // CLI, and the error card names each refusal by its code; measure
          // refuses it too. A size refusal draws the placeholder, and so does a label-collision
          // refusal ("More height did not resolve the hidden labels").
          for (const { code } of result.refused.warnings.filter((entry) => entry.severity === 'error')) {
            expect(html, context).toContain(code === 'size-below-floor' || code === 'label-collision' ? 'data-bp-refused' : `&quot;code&quot;:&quot;${code}&quot;`);
          }
          expect(result, context).not.toHaveProperty('geometry');
          expect(result, context).not.toHaveProperty('mode');
        } else {
          // Measure the live target for the React slot. Static exports can grow their footer.
          // React crops this live SVG at the footer and draws the footer in HTML.
          const cropped = result.geometry!.frame?.noteList?.length ? withoutSvgFooter(result.geometry!) : result.geometry;
          expect(withoutPlotAdvice(actual), context).toEqual(withoutPlotAdvice(cropped));
          // Measurement verifies both minWidth and the requested width.
          // Wrapped text can raise the height above this layout's floor.
          for (const key of ['minWidth', 'minHeight', 'naturalWidth', 'naturalHeight'] as const) {
            expect(result[key], context).toBeGreaterThanOrEqual(actual!.sizing![key]);
          }
          expect(withoutPlotAdvice(actual)?.warnings, context).toEqual(withoutPlotAdvice(result)?.warnings);
          // React geometry carries the title line count measure reports.
          expect(result.titleLines, context).toBe(actual?.frame.titleLines ?? 0);
        }
      }
    }, type === 'diagram' || type === 'choropleth' ? 15_000 : 5_000);
  }

  it('preserves option precedence, empty annotations, locale and omitted sizes', () => {
    const fixture = getFixtures('gantt')[0]!;
    const request = resolveChartRequest({
      type: 'gantt', data: fixture.data,
      options: { theme: 'capital', locale: { language: 'de' }, annotations: fixture.annotations },
      theme: 'studio', locale: 'fr', annotations: [], fontMetrics: 'bundled',
    }, { theme: 'boardroom', locale: 'en' });
    expect(request.theme.name).toBe('studio');
    // The resolved tag carries the chart's number marks (numberMarks.ts).
    expect(request.locale).toEqual({ language: 'fr-x-marks-pc' });
    expect(request.annotations).toEqual([]);
    expect(request.fontMetrics).toBe(defaultMeasurer);
    expect(request.options).not.toHaveProperty('size');
    expect(request.size).toEqual(resolveSize(undefined));
  });

  it('warns about a context key measure does not read, and says where a width goes', () => {
    const fixture = getFixtures('bar')[0]!;
    const request = { type: 'bar', data: fixture.data, options: fixture.options };
    const plain = measure(request);
    const ignored = measure(request, { theme: 'boardroom', width: 320, density: 'compact' } as never);
    expect(ignored.minWidth).toBe(plain.minWidth);
    const codes = ignored.warnings.filter((warning) => warning.code === 'unknown-context-key');
    expect(codes.map((warning) => warning.message)).toEqual([
      "measure ignored the context key 'width': the frame belongs in options.size, as { width: <px> }",
      // The context carries the render target too.
      "measure ignored the context key 'density': the context takes only theme, locale, strings, target, textScale, textSize",
    ]);
    expect(plain.warnings.some((warning) => warning.code === 'unknown-context-key')).toBe(false);
  });

  it('returns the same dimensions and warnings through the CLI-backed MCP tool', () => {
    const fixture = getFixtures('bar')[0]!;
    for (const width of [300, 800]) {
      // A width argument on an unsized content-fit chart leaves the height to it, as size: { width } does.
      const options = { ...fixture.options, size: { width } };
      const { geometry: _geometry, ...expected } = measure({ type: 'bar', data: fixture.data, options, annotations: fixture.annotations });
      const result = callTool('boardplot_measure', {
        spec: { type: 'bar', data: fixture.data, options: fixture.options, annotations: fixture.annotations },
        width,
      });
      const payload = JSON.parse(result.text) as ChartMeasurement & { refused: unknown; warnings: { code: string }[] };
      // measuredMinWidth and measuredMinHeight feed grid layout only; the tool does not print them.
      // drawnHeight is the tool's size.height.
      const { warnings, refused, mode, titleLines, aspect: _aspect, measuredMinWidth: _w, measuredMinHeight: _h, drawnHeight: _d, ...sizes } = expected;
      expect(payload).toMatchObject({ ...sizes, ...(mode ? { mode } : {}), titleLines: titleLines ?? null });
      // A refusal is reported in refused, not repeated as a warning.
      expect(payload.warnings.map((warning) => warning.code))
        .toEqual(warnings.filter((warning) => warning.severity !== 'error').map((warning) => warning.code));
      expect(payload.refused === null).toBe(!refused);
      expect(payload).not.toHaveProperty('geometry');
      expect(result.isError).toBeUndefined();
    }
  });

  it('reports title lines and the natural height at a width for fill charts too ', () => {
    const title = 'Revenue grew in three of four quarters and ended the year 30% above the first quarter';
    const data = { categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ id: 'r', label: 'Revenue', values: [10, 12, 14, 13] }] };
    const cases = [
      { type: 'column', width: 489, natural: 275, lines: 2 },
      { type: 'column', width: 1200, natural: 675, lines: 1 },
      { type: 'line', width: 489, natural: 275, lines: 2 },
      { type: 'column', width: 489, natural: 275, lines: 0, untitled: true },
    ];
    for (const { type, width, natural, lines, untitled } of cases) {
      const options = { ...(untitled ? {} : { title }), size: { width, height: 405 } };
      const result = measure({ type, data, options });
      expect(result.fit, type).toBe('fill');
      expect(result.naturalHeight, `${type} at ${width}`).toBe(natural);
      expect(result.titleLines, `${type} at ${width}`).toBe(lines);
      const titleNode = result.geometry!.scene.find((node) => node.id === result.geometry!.frame.titleNodeId);
      expect(titleNode?.t === 'text' ? titleNode.lines.length : 0).toBe(lines);
      // Drawing at the reported height reports the same height back.
      const again = measure({ type, data, options: { ...options, size: { width, height: natural } } });
      expect(again.naturalHeight).toBe(natural);
      expect(again.titleLines).toBe(lines);
    }
    const scatter = getFixtures('scatter')[0]!;
    const measured = measure({ type: 'scatter', data: scatter.data,
      options: { ...scatter.options, size: { width: 800, height: 405 } }, annotations: scatter.annotations });
    expect(measured.naturalHeight).toBe(600);
    const envelope = { version: 1, charts: [{ name: 'c', type: 'column', data, options: { title } }] };
    const payload = JSON.parse(callTool('boardplot_measure', { spec: envelope, width: 489 }).text) as { charts: ChartMeasurement[] };
    // The plot floor grows the width-only column for its plot floor, and measure reports that height as natural:
    // a width-only fill chart reserves 150 + 11.5% of the width for its plot (206 px at 489).
    // The Q1-Q4 row prints at the 12 px label step, 1 px taller than the old 11 px.
    expect(payload.charts[0]).toMatchObject({ naturalWidth: 489, naturalHeight: 317, titleLines: 2, mode: 'full' });
  });

  it('rejects unknown charts and malformed measurement arguments', () => {
    expect(() => measure({ type: 'missing', data: {} })).toThrow("unknown chart type 'missing'");
    const fixture = getFixtures('bar')[0]!;
    const spec = { type: 'bar', data: fixture.data, options: fixture.options };
    // Check the public boundary so an unused schema cannot hide a validation regression.
    expect(publicMeasure({ ...spec, fontMetrics: 'bundled' }).refused).toBeUndefined();
    expect(() => publicMeasure({ ...spec, locale: { decimal: ';' } } as never)).toThrow();
    expect(callTool('boardplot_measure', { spec, width: -1 }).isError).toBe(true);
    expect(callTool('boardplot_measure', { spec, chart: 'absent' }).isError).toBe(true);
    expect(callTool('boardplot_measure', { spec: {} }).isError).toBe(true);
  });
});
