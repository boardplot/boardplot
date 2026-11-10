/**
 * The OPTION_CAPABILITY census (the test src/core/schema/shared.ts promises).
 *
 * `implementedBy` is a hand-written allowlist, which needs a
 * derived cross-check. This census derives, from every registered type's OWN
 * published JSON Schema (io:'input' — the object the CLI describe surface,
 * the MCP tool schema and the react-surface comparison all read), whether
 * each gated key is ACCEPTED (a real schema) or REFUSED (`{ not: {} }` from
 * the z.never publication), and asserts that partition equals the table
 * exactly, in both directions, for every (type, key) pair.
 *
 * The behaviour checks below cover the shared capability keys, label kinds,
 * and every accepted top-level option in each published schema.
 * A key ABSENT from a published schema fails loudly too: zod objects
 * STRIP unknown keys, so an omitted gated key would be accepted-and-dropped
 * invisibly — the exact class the table exists to remove.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '../src/core/charts';
import '../src/core/geo/packs';
import '../src/core/storyLayer';
import { NormalizeError } from '../src/core/normalize/shared';
import { layoutRefusal } from '../src/core/emptyData';
import { retireChartSettings } from '../src/core/retired';
import { getChartDefinition, listCharts, type Fixture } from '../src/core/registry';
import { OPTION_CAPABILITY, VALUE_AXIS_CAPABILITY, valueAxisOnly } from '../src/core/schema/shared';
import { LABEL_KINDS } from '../src/core/schema/capability';
import { requireGeometry } from '../src/core/sizing';
import { renderSvg } from '../src/core/svg/renderSvg';
import { resolveTheme } from '../src/core/theme';
import type { ThemeRef } from '../src/core/types/theme';
import type {
  ButterflyOptions,
  ColumnOptions,
  FunnelOptions,
  HeatmapOptions,
  KpiOptions,
  LineOptions,
  PieOptions,
  ScatterOptions,
  SparklineOptions,
} from '../src/core/types/options';
import type { TableOptions } from '../src/core/types/table';
import type { BarTableOptions } from '../src/core/charts/bartable/types';
import type { ChoroplethOptions } from '../src/core/charts/choropleth/types';
import type { CohortOptions } from '../src/core/charts/cohort/types';
import type { GanttOptions } from '../src/core/charts/gantt/layout';
import type { LikertOptions } from '../src/core/charts/likert/layout';
import type { PvmOptions } from '../src/core/charts/pvm/types';
import type { PyramidOptions } from '../src/core/charts/pyramid/types';
import type { StatusOptions } from '../src/core/charts/status/layout';
import type { TilemapOptions } from '../src/core/charts/tilemap/types';
import { getFixtures } from '../src/fixtures';

describe('OPTION_CAPABILITY census', () => {
  it('every registered type publishes each gated key as exactly what the table says', () => {
    const failures: string[] = [];
    // listCharts() returns summaries; the schemas live on the definitions.
    const charts = listCharts().map((entry) => getChartDefinition(entry.type)!);
    expect(charts.length).toBeGreaterThan(0);

    for (const chart of charts) {
      const json = z.toJSONSchema(chart.optionsSchema as never, { io: 'input' }) as {
        properties?: Record<string, unknown>;
      };
      const properties = json.properties ?? {};
      for (const [key, capability] of Object.entries(OPTION_CAPABILITY)) {
        const published = properties[key];
        const listed =
          (capability.implementedBy as readonly string[]).includes(chart.type) ||
          ('unsupportedSeverity' in capability && capability.unsupportedSeverity === 'warn');
        if (published === undefined) {
          failures.push(`${chart.type}.${key}: absent from the published schema (silent strip)`);
          continue;
        }
        const refused = typeof published === 'object' && published !== null && 'not' in published;
        if (listed === refused) {
          failures.push(
            `${chart.type}.${key}: table says ${listed ? 'implements' : 'refuses'}, schema publishes ${refused ? 'a refusal' : 'acceptance'}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every published valueAxis refuses exactly the sub-keys VALUE_AXIS_CAPABILITY and VALUE_AXIS_ONLY refuse', () => {
    const failures: string[] = [];
    for (const { type } of listCharts()) {
      const json = z.toJSONSchema(getChartDefinition(type)!.optionsSchema as never, { io: 'input' }) as {
        properties?: Record<string, { not?: unknown; properties?: Record<string, object> }>;
      };
      const valueAxis = json.properties?.valueAxis;
      const only = valueAxisOnly(type);
      if (only?.keys.length === 0) {
        if (!valueAxis || !('not' in valueAxis)) failures.push(`${type}.valueAxis: reads no sub-key but is not refused`);
        continue;
      }
      const published = valueAxis?.properties ?? {};
      for (const key of ['show', 'min', 'max', 'tickStep', 'includeZero', 'percent', 'log', 'reverse', 'gridlines', 'break']) {
        const capability = (VALUE_AXIS_CAPABILITY as Record<string, { implementedBy: readonly string[] }>)[key];
        const reads = (!only || only.keys.includes(key)) && (!capability || capability.implementedBy.includes(type));
        const refused = typeof published[key] === 'object' && 'not' in published[key]!;
        if (published[key] === undefined || reads === refused) {
          failures.push(`${type}.valueAxis.${key}: tables say ${reads ? 'reads' : 'refuses'}, schema publishes ${published[key] === undefined ? 'nothing' : refused ? 'a refusal' : 'acceptance'}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the exported option types refuse the valueAxis sub-keys the schemas refuse', () => {
    // @ts-expect-error column draws no reversed axis (VALUE_AXIS_CAPABILITY.reverse)
    const column: ColumnOptions = { valueAxis: { tickStep: 10, reverse: true } };
    // @ts-expect-error a sparkline has no value axis (VALUE_AXIS_ONLY.sparkline)
    const sparkline: SparklineOptions = { valueAxis: { min: 0 } };
    const line: LineOptions = { valueAxis: { tickStep: 10, reverse: true } };
    const scatter: ScatterOptions = { valueAxis: { reverse: true, clamp: { max: 1 } } };
    // Automatic placement is an explicit bridge option.
    const pvm: PvmOptions = { valueAxis: { break: 'auto' } };
    // @ts-expect-error column supports authored breaks, not automatic placement
    const columnAuto: ColumnOptions = { valueAxis: { break: 'auto' } };
    expect([column, sparkline, line, scatter, pvm, columnAuto]).toHaveLength(6);
  });

  it('the exported option types refuse even an empty valueAxis where VALUE_AXIS_ONLY lists no sub-key', () => {
    // An object of never-valued keys still accepted {}; the schema refuses it.
    // Pick keeps a type's required fields out of the way (butterfly needs a and b).
    const refused = [
      // @ts-expect-error VALUE_AXIS_ONLY.sparkline
      { valueAxis: {} } satisfies Pick<SparklineOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.table
      { valueAxis: {} } satisfies Pick<TableOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.bartable
      { valueAxis: {} } satisfies Pick<BarTableOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.pie
      { valueAxis: {} } satisfies Pick<PieOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.funnel
      { valueAxis: {} } satisfies Pick<FunnelOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.heatmap
      { valueAxis: {} } satisfies Pick<HeatmapOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.kpi
      { valueAxis: {} } satisfies Pick<KpiOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.status
      { valueAxis: {} } satisfies Pick<StatusOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.gantt
      { valueAxis: {} } satisfies Pick<GanttOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.tilemap
      { valueAxis: {} } satisfies Pick<TilemapOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.choropleth
      { valueAxis: {} } satisfies Pick<ChoroplethOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.cohort
      { valueAxis: {} } satisfies Pick<CohortOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.likert
      { valueAxis: {} } satisfies Pick<LikertOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.butterfly
      { valueAxis: {} } satisfies Pick<ButterflyOptions, 'valueAxis'>,
      // @ts-expect-error VALUE_AXIS_ONLY.pyramid
      { valueAxis: {} } satisfies Pick<PyramidOptions, 'valueAxis'>,
    ];
    expect(refused).toHaveLength(15);
  });
});

/**
 * The behavioural direction of the census above: a type that
 * accepts a gated key must draw something different with it. For each key a
 * value that differs from every default is set on the type's fixtures, each
 * drawn without the key first; some fixture must change, or the key is
 * accepted and ignored. hatchStrength acts on a mark the SVG names, a hatch
 * pattern, so there the census asks it of every fixture that draws one: that
 * is what catches a recipe that ignores the key on most cells (one fixture of
 * five changing is not enough; tests/hatch-strength.test.tsx holds status to
 * 60 against 100).
 */
describe('OPTION_CAPABILITY census, behaviour: an accepted key changes the drawing', () => {
  const PROBES: Partial<Record<keyof typeof OPTION_CAPABILITY, readonly unknown[]>> = {
    labelPosition: ['insideBase', 'center'],
    rowLabels: [{ align: 'right' }, { align: 'left' }],
    categoryAxis: [{ crossesBetween: false }, { dateTicks: 'quarters' }],
    categoryLabels: ['staircase'],
    labels: [false, { point: false }],
    hatchStrength: [0, 100],
    sort: [{ categories: 'reverse' }, { segments: 'reverse' }],
    topN: [{ n: 2 }],
    rounding: ['sum-consistent', 'nearest'],
    bandFraction: [0.3],
  };
  /** (type, key) pairs no fixture can show yet; each must still fail, so the list only shrinks. */
  const NO_FIXTURE_DRAWS_IT: Record<string, string> = {
    'butterfly.hatchStrength': 'a forecast series is hatched; no fixture has one',
    'funnel.hatchStrength': 'a forecast series is hatched; no fixture has one',
    'mekko.hatchStrength': 'a forecast series is hatched; no fixture has one',
    'cohort.hatchStrength': 'a not-meaningful cell is hatched; no fixture has one',
  };
  /** Fixtures whose every hatch already sits at the floor its cue keeps, with the reason. */
  const AT_THE_FLOOR: Record<string, string> = {
    'column/scenario-corridor-fc': 'the forecast corridor stripes sit at the 3:1 floor',
    'heatmap/missing-cells': 'the no-data stripes sit at the 3:1 floor in the shipped presets',
    'heatmap/cell-states': 'the no-data and state stripes sit at the 3:1 floor in the shipped presets',
  };

  type AnyDefinition = NonNullable<ReturnType<typeof getChartDefinition>>;
  /** The fixture laid out with `key` removed, or set to `value`; undefined where the layout refuses. */
  const lay = (definition: AnyDefinition, fixture: Fixture, key: string, value?: unknown) => {
    const authored: Record<string, unknown> = { ...(fixture.options as Record<string, unknown> | undefined) };
    delete authored[key];
    if (value !== undefined) authored[key] = value;
    try {
      const options = { ...definition.defaults, ...(definition.optionsSchema.parse(structuredClone(authored)) as object),
        ...(fixture.annotations ? { annotations: structuredClone(fixture.annotations) } : {}) } as Record<string, unknown>;
      const geometry = requireGeometry(definition.layout(definition.normalize(structuredClone(fixture.data)), options as never));
      return { geometry, theme: resolveTheme(options.theme as ThemeRef | undefined) };
    } catch {
      return undefined;
    }
  };
  /**
   * The drawing with its ids taken out. Drawn here without an id scope, the
   * description id is fixed and a pattern id follows its colours, so neither
   * says more than the drawing; stripped all the same, so an id hash can never
   * make a key that draws nothing look effective.
   */
  const svg = (laid: ReturnType<typeof lay>) =>
    laid && renderSvg(laid.geometry, laid.theme).replace(/ id="[^"]*"| aria-describedby="[^"]*"|url\(#[^)]*\)/g, '');
  /** A fixture that does not author the key draws the same without it for every key: laid out once. */
  const plain = new Map<string, ReturnType<typeof lay>>();
  const before = (definition: AnyDefinition, fixture: Fixture, key: string) => {
    if (fixture.options && Object.hasOwn(fixture.options, key)) return lay(definition, fixture, key);
    const id = `${definition.type}/${fixture.id}`;
    if (!plain.has(id)) plain.set(id, lay(definition, fixture, key));
    return plain.get(id);
  };
  const hatched = (laid: NonNullable<ReturnType<typeof lay>>) =>
    laid.geometry.scene.some((node) => (node.t === 'rect' || node.t === 'path') && node.pattern === 'hatch45');

  /** Keys a generic value cannot probe: their values name the fixture's own series or scales. */
  const UNPROBED: Partial<Record<keyof typeof OPTION_CAPABILITY, string>> = {
    secondaryAxis: 'acknowledges or relabels a scale the fixture data has to declare',
    highlight: 'names categories, series or points of the fixture',
    story: 'names categories, series or points of the fixture in its steps',
    detailFields: 'labels the cell details for the hover record only; the static SVG draws the same picture',
  };
  it('probes every key some type implements, or names why not', () => {
    const implemented = Object.entries(OPTION_CAPABILITY).filter(([, capability]) => capability.implementedBy.length > 0).map(([key]) => key);
    expect(implemented.filter((key) => !(key in PROBES) && !(key in UNPROBED))).toEqual([]);
  });

  // Lays out the fixtures of every accepting type and draws only the ones a
  // probe can change. The full fixture census gets its own timeout.
  it('every accepting type draws differently with the key on some fixture, and with hatchStrength on every hatched one', { timeout: 90_000 }, () => {
    const failures: string[] = [];
    const stillGaps: string[] = [];
    for (const [key, values] of Object.entries(PROBES)) {
      for (const type of OPTION_CAPABILITY[key as keyof typeof OPTION_CAPABILITY].implementedBy as readonly string[]) {
        const definition = getChartDefinition(type)!;
        let changed = false;
        for (const fixture of getFixtures(type)) {
          const base = before(definition, fixture, key);
          if (base === undefined) continue;
          // hatchStrength acts on hatches only: a fixture without one is not drawn for it.
          if (key === 'hatchStrength' && !hatched(base)) continue;
          const drawn = svg(base);
          const moved = values!.some((value) => { const after = svg(lay(definition, fixture, key, value)); return after !== undefined && after !== drawn; });
          changed ||= moved;
          if (key === 'hatchStrength' && !moved && !(`${type}/${fixture.id}` in AT_THE_FLOOR)) {
            failures.push(`${type}/${fixture.id}: draws a hatch that hatchStrength does not change`);
          }
          if (changed && key !== 'hatchStrength') break;
        }
        const pair = `${type}.${key}`;
        if (pair in NO_FIXTURE_DRAWS_IT) { if (changed) stillGaps.push(pair); continue; }
        if (!changed) failures.push(`${pair}: accepted, and no fixture draws differently with it`);
      }
    }
    expect(failures).toEqual([]);
    expect(stillGaps, 'a listed gap now has a fixture that shows it; remove it from NO_FIXTURE_DRAWS_IT').toEqual([]);
  });

  // A label kind a type takes but never reads would be the silent no-op the table refuses.
  it('every label kind a type takes changes some fixture when set false or true', { timeout: 90_000 }, () => {
    const failures: string[] = [];
    for (const [type, kinds] of Object.entries(LABEL_KINDS)) {
      const definition = getChartDefinition(type)!;
      const fixtures = getFixtures(type).filter((fixture) => (fixture.options as { labels?: unknown } | undefined)?.labels !== false);
      for (const kind of kinds) {
        const shows = fixtures.some((fixture) => {
          const own = { ...((fixture.options as { labels?: Record<string, unknown> } | undefined)?.labels ?? {}) };
          delete own[kind];
          const drawn = svg(lay(definition, fixture, 'labels', own));
          return drawn !== undefined && [false, true].some((value) => {
            const after = svg(lay(definition, fixture, 'labels', { ...own, [kind]: value }));
            return after !== undefined && after !== drawn;
          });
        });
        if (!shows) failures.push(`${type}.labels.${kind}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

/** One fixture and one changed value per accepted top-level option. */
describe('published option behaviour census', () => {
  type JsonSchema = {
    type?: string; not?: unknown; const?: unknown; enum?: unknown[]; default?: unknown;
    anyOf?: JsonSchema[]; oneOf?: JsonSchema[];
    properties?: Record<string, JsonSchema>; required?: string[];
    items?: JsonSchema | false; prefixItems?: JsonSchema[]; minItems?: number; minimum?: number; maximum?: number;
    exclusiveMinimum?: number; additionalProperties?: boolean | JsonSchema;
  };
  type Options = Record<string, unknown>;

  // These values exercise common options without depending on an implicit default.
  const VALUES: Options = {
    rowLabelLines: 1, latestPoint: 'ring', binSnap: false, density: 'compact', maxPointLabels: 1, elapsed: false, valueTable: 'below',
    target: 'dashboard', textScale: 1.25, textSize: 18, a11y: { title: true },
    mode: 'compact', belowMinimum: 'refuse', size: { width: 960 }, embed: { width: 180 },
    margin: { left: 100 }, canvas: { margin: { left: 100 } },
    title: 'Option census title', subtitle: 'Option census subtitle', unit: 'census unit',
    unitShown: true, source: 'Option census source', footnotes: ['Option census footnote'],
    notes: { show: [] }, theme: 'standard-dark', locale: { language: 'de-DE' },
    strings: { source: 'Census source' }, format: '0.000', smallValues: 'scientific',
    palette: 'categorical', labelDensity: 'minimal', labelPosition: 'insideBase', labels: false,
    labelPlacements: { census: 'above' }, labelOffsets: { census: { y: 12 } }, legend: 'top', valueAxis: { min: -100 },
    scaleGroup: { y: 'census-scale' }, rowLabels: { align: 'right' },
    categoryAxis: { crossesBetween: false }, categoryLabels: 'staircase',
    sort: { categories: 'reverse' }, topN: { n: 2 }, bandFraction: 0.3,
    hatchStrength: 0, colorblindSafe: true, interactive: true,
    rounding: 'sum-consistent',
    valueLabels: 'none', methodNote: true,
    steps: [70, 80, 85, 90], viewDomain: { x: [1, 3] },
    secondaryAxis: { acknowledge: true, show: false }, breaks: [10, 30], anomaly: { method: 'threshold', high: 100 },
    rotate: 90, referenceBands: [{ value: 100, label: 'Census band' }],
    quadrants: { x: { stat: 'median' }, y: { stat: 'median' } },
    axisFormat: { x: '1.000', y: '1.000' }, gapFill: { between: ['output', 'market'] },
    scenarioStyle: { FC: { width: 5 } }, visiblePeriods: [0, 1],
    expansion: { depth: 0 }, columnVisibility: { actual: false },
    totalPosition: 'bottom', figures: false, magnitude: 'million', bars: false,
    driverTones: 'never', judgements: 'exceptions', show: 'withData',
    columnOverrides: { label: { width: 150 } }, columnOrder: ['plot'], columnHeads: false,
    rowVisibility: { census: false }, rowOrder: ['census'], rowOverrides: { census: { label: 'Census row' } },
    valueTableEmphasis: false,
  };

  type Probe = { fixture?: string; value?: unknown; options?: Options; data?: (data: any) => unknown; reason?: string };
  /**
   * Type.option | the input that shows the option. fixture replaces the representative
   * fixture, value replaces the census value, options go into both renders, and data
   * changes the fixture data of both renders. Prefer a shipped fixture over a data change.
   */
  const PROBES: Record<string, Probe> = {
    'box.annotations': { fixture: 'dated-median-growth', value: [{ id: 'growth', kind: 'diff', from: 'before', to: 'after' }] },
    'bullet.annotations': { fixture: 'annual-orders', value: [{ id: 'growth', kind: 'diff', from: 'fy21', to: 'fy23' }] },
    'likert.annotations': { fixture: 'dated-survey-comparison', value: [{ id: 'growth', kind: 'diff', from: { categoryId: 'before', seriesId: 'a' }, to: { categoryId: 'after', seriesId: 'a' } }] },
    'pvm.annotations': { fixture: 'dated-revenue-growth', value: [{ id: 'growth', kind: 'diff', from: 'prior', to: 'current' }] },
    'pyramid.annotations': { fixture: 'dated-population-comparison', value: [{ id: 'growth', kind: 'diff', from: { categoryId: 'young', seriesId: 'before' }, to: { categoryId: 'young', seriesId: 'after' } }] },
    'scatter.annotations': { fixture: 'log-y-under-a-decade', value: [{ kind: 'valueLine', value: 50, label: 'Census annotation' }] },
    'cohort.averages': { fixture: 'saas-logo-retention', value: 'weighted' },
    'bar.axisTitles': { fixture: 'valuation-football-field', value: { primary: 'census' } },
    'bullet.axisTitles': { fixture: 'sparse-targets-overshoot', value: { primary: 'Revenue, $m census' } },
    'histogram.axisTitles': { fixture: 'bimodal-with-far-outlier', value: { y: 'census' } },
    'variance.axisTitles': { fixture: 'all-negative-deltas', value: { primary: 'ΔPL, $m census' } },
    'bar.belowMinimum': { fixture: 'single-category', options: { target: 'slide', size: { width: 300, height: 200 } } },
    'bartable.belowMinimum': { options: { size: { width: 320 } } },
    'box.belowMinimum': { fixture: 'cycle-time-by-team', options: { target: 'slide' } },
    'butterfly.belowMinimum': { fixture: 'period-comparisons', options: { target: 'slide', size: { width: 400, height: 225 } } },
    'cohort.belowMinimum': { options: { size: { width: 320 } } },
    'column.belowMinimum': { options: { size: { width: 320 } } },
    'combo.belowMinimum': { options: { size: { width: 320 } } },
    'dimswitch.belowMinimum': { options: { size: { width: 320 } } },
    'dot.belowMinimum': { options: { size: { width: 320 } } },
    'funnel.belowMinimum': { fixture: 'annual-cohort-retention', options: { size: { width: 320 } } },
    'gantt.belowMinimum': { fixture: 'product-launch', options: { size: { width: 320 } } },
    'grid.belowMinimum': { fixture: 'assessment-map', options: { size: { width: 320 } } },
    'heatmap.belowMinimum': { options: { size: { width: 600, height: 120 } } },
    'histogram.belowMinimum': { options: { size: { width: 320 } } },
    'likert.belowMinimum': { fixture: 'twelve-statements-slide' },
    'line.belowMinimum': { options: { size: { width: 320 } } },
    'pareto.belowMinimum': { fixture: 'torture-pareto-flat', options: { size: { width: 330, height: 250 } } },
    'pie.belowMinimum': { fixture: 'doughnut-device-revenue', options: { size: { width: 250, height: 400 } } },
    'pvm.belowMinimum': { fixture: 'named-periods-and-ranges', options: { target: 'slide', size: { width: 300, height: 200 } } },
    'pyramid.belowMinimum': { fixture: 'column-overrides', options: { target: 'slide', size: { width: 400, height: 225 } } },
    'scatter.belowMinimum': { options: { size: { width: 320 } } },
    'slope.belowMinimum': { fixture: 'cell-value-label', options: { target: 'slide', size: { width: 300, height: 200 } } },
    'table.belowMinimum': { fixture: 'table-status-square' },
    'tilemap.belowMinimum': { fixture: 'us-state-tile-grid-wide-slot' },
    'treemap.belowMinimum': { fixture: 'growth-rect', options: { size: { width: 600, height: 300 } } },
    'variance.belowMinimum': { fixture: 'authored-relative-decimals', options: { target: 'slide', size: { width: 300, height: 200 } } },
    'waffle.belowMinimum': { options: { size: { width: 200 } } },
    'waterfall.belowMinimum': { fixture: 'single-delta', options: { target: 'slide', size: { width: 300, height: 200 } } },
    'waterfall.bracketRow': { fixture: 'step-brackets', value: 'span' },
    'heatmap.bubble': { fixture: 'survey-journey-bubbles', value: { levels: ['Low', 'Medium', 'High'], sizeLabel: 'Census importance', colorLabel: 'Expectations exceeded, % of respondents' } },
    'line.bump': { fixture: 'brand-share-bump', value: { direction: 'lowerIsBetter' } },
    'waffle.cellNote': { fixture: 'coarse-grid-cell-note', value: 'none', options: { notes: { show: ['disclosure'] } } },
    'gantt.colHeaders': { fixture: 'transformation-program', value: ['Owner census'] },
    'bar.colorblindSafe': { fixture: 'option-sign-color' },
    'butterfly.colorblindSafe': { options: { annotations: [{ kind: 'delta', at: { categoryId: 'c2', seriesId: 'prodB' }, vs: { categoryId: 'c2', seriesId: 'prodA' } }, { kind: 'note', at: 'c1', text: 'Census note', status: 'bad' }] } },
    'choropleth.colorblindSafe': { options: { scale: { kind: 'diverging', midpoint: 0, polarity: 'higherIsBetter' } }, reason: 'Needs two scale poles.' },
    'column.colorblindSafe': { fixture: 'actuals-forecast-operating-rate' },
    'combo.colorblindSafe': { fixture: 'weekly-events-lane' },
    'dot.colorblindSafe': { fixture: 'share-shift-arrow' },
    'funnel.colorblindSafe': { fixture: 'ramp-outcomes' },
    'gantt.colorblindSafe': { fixture: 'transformation-program' },
    'heatmap.colorblindSafe': { fixture: 'regional-monthly-performance' },
    'mekko.colorblindSafe': { fixture: 'bar-mekko-profit-pool' },
    'pareto.colorblindSafe': { options: { annotations: [{ id: 'growth', kind: 'cagr', from: 'fy21', to: 'fy24' }, { kind: 'note', at: 'fy21', text: 'Census note', status: 'bad' }] } },
    'pie.colorblindSafe': { options: { annotations: [{ kind: 'note', at: 'pop', text: 'Census note', status: 'bad' }] } },
    'pyramid.colorblindSafe': { options: { annotations: [{ kind: 'note', at: 'a0', text: 'Census note', status: 'bad' }] } },
    'sankey.colorblindSafe': { fixture: 'sales-stages' },
    'scatter.colorblindSafe': { fixture: 'negative-quadrants' },
    'slope.colorblindSafe': { fixture: 'diverging-regions' },
    'sparkline.colorblindSafe': { fixture: 'reference-inside-data' },
    'tilemap.colorblindSafe': { options: { scale: { kind: 'diverging', midpoint: 0, polarity: 'higherIsBetter' } }, reason: 'Needs two scale poles.' },
    'pie.colors': { fixture: 'doughnut-device-revenue', value: 'sequential' },
    'kpi.comparisons': { fixture: 'dual-compare', value: 'text' },
    'dimswitch.driverTones': { fixture: 'statement' },
    'table.driverTones': { fixture: 'driver-tones-grouped' },
    'line.endLabelPlacement': { fixture: 'brand-share-bump', value: 'gutter' },
    'column.events': { fixture: 'weekly-events-lane', value: { placement: 'key', rows: 1, groups: [{ id: 'stockout', label: 'Out of stock', tone: 'bad', glyph: 'triangle' }, { id: 'launch', label: 'Launch', tone: 'good', glyph: 'dot' }] } },
    'combo.events': { fixture: 'weekly-events-lane', value: { placement: 'key', groups: [{ id: 'stockout', label: 'Out of stock', tone: 'bad', glyph: 'triangle' }, { id: 'launch', label: 'Launch', tone: 'good', glyph: 'dot' }] } },
    'line.events': { fixture: 'era-event-markers', value: { placement: 'key', groups: [{ id: 'measurement', label: 'Measurement', tone: 'neutral', glyph: 'square' }, { id: 'pricing', label: 'Pricing', tone: 'bad', glyph: 'triangle' }] } },
    'cohort.figures': { options: { variant: 'stepped' }, reason: 'Only stepped fills can stop their numbers.' },
    'dimswitch.figures': { options: { encodings: { range: 'heat' } }, reason: 'Figures can be hidden only on a heat lane.' },
    'table.figures': { options: { encodings: { actual: 'heat' } }, reason: 'Figures can be hidden only on a heat lane.' },
    'dimswitch.fitFormats': { fixture: 'sheet', value: false, options: { size: { width: 1400 } } },
    'table.fitFormats': { fixture: 'fit-formats-narrow-tracks', value: false },
    'bar.focus': { fixture: 'valuation-football-field', value: { owner: { categoryId: 'dcf', seriesId: 'equity-value' } } },
    'bartable.focus': { value: { owner: { categoryId: 'co', colId: 'n' } } },
    'cohort.focus': { fixture: 'saas-logo-retention', value: { owner: { categoryId: 't3' } } },
    'combo.focus': { value: { owner: { seriesId: 'units', categoryId: '2024' } } },
    'gantt.focus': { value: { owner: { annotationId: 'sc-2' } } },
    'grid.focus': { fixture: 'metric-stack-volume', value: { owner: { seriesId: 'intake' } } },
    'heatmap.focus': { value: { owner: { categoryId: 'one' } } },
    'histogram.focus': { value: { owner: { categoryId: 'bin3' } } },
    'kpi.focus': { value: { owner: { categoryId: 'kpi', segmentId: 'delta' } } },
    'likert.focus': { value: { owner: { categoryId: 'growth' } } },
    'pareto.focus': { value: { owner: { seriesId: 'pareto:value' } } },
    'pie.focus': { value: { owner: { seriesId: 'revenue', categoryId: 'hiphop' } } },
    'sparkline.focus': { value: { owner: { categoryId: 'p3' } } },
    'status.focus': { value: { owner: { categoryId: '2021-03' } } },
    'treemap.focus': { value: { owner: { seriesId: 'platforms', categoryId: 'cloud-hosting' } } },
    'waffle.focus': { fixture: 'two-panels', value: { owner: { categoryId: 'rural' } } },
    'bullet.format': { fixture: 'exec-kpi-panel' },
    'kpi.format': { fixture: 'value-only' },
    'status.format': { fixture: 'status-with-values', value: '0.000', data: d => ({ ...d, cells: d.cells.map((c: object) => ({ ...c, value: 97.5 })) }) },
    'table.format': { fixture: 'management-report' },
    'table.frameFill': { value: 'none', options: { size: { width: 1400 } } },
    'dimswitch.groupGround': { fixture: 'by-member', value: 'always' },
    'table.groupGround': { fixture: 'management-report', value: 'always' },
    'bar.hatchStrength': { fixture: 'stacked-scenario-comparison-horizontal' },
    'butterfly.hatchStrength': { data: d => ({ ...d, series: d.series.map((s: { id: string }) => ({ ...s, scenario: 'FC' })) }) },
    'choropleth.hatchStrength': { fixture: 'world-all-null' },
    'combo.hatchStrength': { fixture: 'smooth-forecast-overlay' },
    'funnel.hatchStrength': { data: d => ({ ...d, series: d.series.map((s: { id: string }) => ({ ...s, scenario: 'FC' })) }) },
    'grid.hatchStrength': { fixture: 'stacked-plus-dpy-forecast' },
    'heatmap.hatchStrength': { fixture: 'survey-journey-bubbles' },
    'line.hatchStrength': { fixture: 'stacked-area-services-growth' },
    'mekko.hatchStrength': { data: d => ({ ...d, series: d.series.map((s: { id: string }) => ({ ...s, scenario: 'FC' })) }) },
    'slope.hatchStrength': { fixture: 'diverging-team-engagement' },
    'status.hatchStrength': { fixture: 'programme-rollout-rag' },
    'bartable.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a pinned height has spare height to fill.' },
    'diagram.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a set height has spare height to fill.' },
    'dimswitch.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a pinned height has spare height to fill.' },
    'table.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a pinned height has spare height to fill.' },
    'waffle.heightFill': { options: { target: 'slide', size: { width: 1184, height: 528 } }, reason: 'Only a pinned height has spare height to fill.' },
    'mekko.highlight': { value: 'alpha' },
    'slope.highlight': { value: 'software-a' },
    'line.highlightMode': { fixture: 'multiline-arr-endpoint-cagr', value: 'fade' },
    'dimswitch.inlineVisibility': { value: { change: false } },
    'table.inlineVisibility': { fixture: 'steering-table-v2', value: { mom: false, yoy: true, share: true } },
    'bartable.labelDensity': { fixture: 'single-panel' },
    'box.labelDensity': { fixture: 'cycle-time-by-team' },
    'grid.labelDensity': { fixture: 'metric-stack-volume' },
    'heatmap.labelDensity': { fixture: 'regional-monthly-performance' },
    // Every kpi and slope label sits at or above the band 'minimal' keeps, unless a cell authors a lower priority.
    'kpi.labelDensity': { fixture: 'spark-ends-below-card', data: (data) => { data.spark.values[2] = { number: data.spark.values[2], priority: 100 }; return data; } },
    'slope.labelDensity': { fixture: 'cost-per-unit-plants', data: (data) => { data.series[0].values[0] = { number: data.series[0].values[0], priority: 100 }; return data; } },
    'line.labelDensity': { fixture: 'stacked100-area-revenue-mix' },
    'status.labelDensity': { value: 'full', options: { size: { width: 320 } } },
    'variance.labelDensity': { fixture: 'integrated-fc-caps' },
    'bar.labelPlacements': { fixture: 'valuation-football-field', value: { 'category:analysts': 'insideCenter' } },
    'bartable.labelPlacements': { value: { 'cell:n:co': 'insideCenter' } },
    'box.labelPlacements': { value: { 'boxN:benelux': 'insideCenter' } },
    'bullet.labelPlacements': { value: { 'header:1:target': 'insideCenter' } },
    'butterfly.labelPlacements': { value: { 'category:c2': 'insideCenter' } },
    'choropleth.labelPlacements': { value: { 'category:DE-BY': 'insideCenter' } },
    'cohort.labelPlacements': { value: { 'cohort-header-label': 'insideCenter' } },
    'column.labelPlacements': { value: { 'category:fy27': 'insideCenter' } },
    'combo.labelPlacements': { value: { 'point:units:2019': 'left' } },
    'dot.labelPlacements': { value: { 'category:central': 'insideCenter' } },
    'funnel.labelPlacements': { value: { 'category:leads': 'insideCenter' } },
    'gantt.labelPlacements': { value: { 'event:sc-2': 'insideCenter' } },
    'grid.labelPlacements': { fixture: 'metric-stack-volume', value: { 'completed:arrow': 'insideCenter' } },
    'heatmap.labelPlacements': { value: { 'category:one': 'insideCenter' } },
    'histogram.labelPlacements': { value: { 'point:count:bin0': 'insideEnd' } },
    'kpi.labelPlacements': { value: { 'category:label': 'insideCenter' } },
    'likert.labelPlacements': { value: { 'grandTotal:growth': 'insideEnd' } },
    'line.labelPlacements': { value: { 'ratioTier:operating-rate:caption': 'insideCenter' } },
    'mekko.labelPlacements': { value: { 'total:americas': 'insideCenter' } },
    'pareto.labelPlacements': { value: { 'axis:primary:title': 'insideCenter' } },
    'pie.labelPlacements': { value: { 'outsidePie:revenue:hiphop': 'insideCenter' } },
    'pvm.labelPlacements': { value: { 'total:current': 'insideEnd' } },
    'pyramid.labelPlacements': { value: { 'category:a10': 'insideCenter' } },
    'sankey.labelPlacements': { value: { 'stage:outcome': 'insideCenter' } },
    'scatter.labelPlacements': { value: { 'point:j': 'above' } },
    'slope.labelPlacements': { value: { 'change:brindlevo': 'insideCenter' } },
    'status.labelPlacements': { value: { 'category:2021-03': 'insideCenter' } },
    // A sparkline label has one seat, so the pin shows by keeping the label that 'minimal' drops.
    'sparkline.labelPlacements': { value: { 'spark:high': 'above' }, options: { labelDensity: 'minimal' } },
    'tilemap.labelPlacements': { fixture: 'eu27-demand-versus-plan', value: { 'category:DE': 'tileCode' } },
    'treemap.labelPlacements': { value: { 'item:cloud-hosting': 'insideCenter' } },
    'variance.labelPlacements': { value: { 'point:dach': 'insideEnd' } },
    'waffle.labelPlacements': { fixture: 'two-panels', value: { 'total:urban': 'insideCenter' } },
    'waterfall.labelPlacements': { value: { 'total:fy21': 'insideEnd' } },
    'pyramid.labelPosition': { options: { size: { width: 960, height: 900 } }, reason: 'The representative fixture has eighteen rows; its default bars are too short for inside values.' },
    'choropleth.labelRegions': { fixture: 'world-inflation', value: ['AE', 'AF'] },
    'cohort.labels': { options: { variant: 'heatmap' }, reason: 'Exhibit variants have a fixed label set.' },
    'heatmap.labels': { fixture: 'regional-monthly-performance' },
    'status.labels': { fixture: 'review-status-legend-none' },
    'dimswitch.lastTrackFlex': { value: true, options: { rowExtent: 'tracks', size: { width: 375 } }, reason: 'Only tracks with spare width have a last track to grow.' },
    'table.lastTrackFlex': { options: { rowExtent: 'tracks', size: { width: 1400 } }, reason: 'Only tracks with spare width have a last track to grow.' },
    'bartable.legend': { value: 'bottom' },
    'cohort.legend': { fixture: 'retention-stepped-column', value: 'none' },
    'column.legend': { value: 'bottom' },
    'combo.legend': { fixture: 'stacked-shares-sum' },
    'dot.legend': { value: 'bottom' },
    'status.legend': { value: 'bottom' },
    'table.legend': { fixture: 'fatigue-cell-encodings', value: 'bottom' },
    'tilemap.legend': { value: 'bottom' },
    'treemap.legend': { value: 'bottom' },
    'variance.legend': { value: 'bottom' },
    'waffle.legend': { fixture: 'stacked-segments' },
    'waterfall.legend': { value: 'bottom' },
    'dimswitch.maxGrowth': { value: 1, options: { size: { width: 375 } } },
    'table.maxGrowth': { value: 9.5, options: { size: { width: 1400 } } },
    'bar.methodNote': { fixture: 'valuation-football-field' },
    'choropleth.methodNote': { fixture: 'world-inflation' },
    'line.methodNote': { fixture: 'stacked100-area-mixed-sign-fail-closed' },
    'dimswitch.minimumSample': { fixture: 'multiple-sample-bases', value: { orders: 500 } },
    'heatmap.missing': { fixture: 'missing-cells', value: 'blank' },
    'variance.missingMark': { fixture: 'missing-prior-dash', value: 'none' },
    'butterfly.negatives': { fixture: 'negatives-own-scale', value: 'magnitude' },
    'dimswitch.nulls': { value: 'blank', data: d => { d.facts[5].sums.orders = null; d.facts[6].sums.rev = null; return d; } },
    'table.nulls': { value: 'blank' },
    'dimswitch.order': { value: { by: 'revenue', desc: false }, reason: 'The sheet order is already descending by revenue.' },
    'treemap.order': { fixture: 'growth-circle', value: 'sheet' },
    'column.othersShade': { fixture: 'ordered-ramp-rest-apart', value: 'quietest' },
    'line.othersShade': { fixture: 'ordered-ramp-rest-apart', value: 'quietest' },
    'pie.othersShade': { fixture: 'others-shade-apart', value: 'quietest', options: { theme: { preset: 'standard', overrides: { color: { othersMark: '#888888' } } } } },
    'choropleth.overlayMeasure': { fixture: 'world-footprint', value: 'Market activation progress, % census' },
    'tilemap.overlayMeasure': { fixture: 'us-states-overlay-tones', value: 'Rollout progress, % census' },
    'choropleth.overlayTones': { fixture: 'world-footprint', value: { warn: 'Activation behind plan census' } },
    'tilemap.overlayTones': { fixture: 'us-states-overlay-tones', value: { good: 'Rollout ahead census', bad: 'Rollout stalled', warn: 'Rollout behind', neutral: 'Not rated', info: 'Pilot state' } },
    'line.pointLabelSide': { fixture: 'point-emphasis', reason: 'The usual fixture has several series; only a single line shows the side.' },
    'bar.referenceStyle': { fixture: 'topn-others', value: 'line' },
    'column.referenceStyle': { fixture: 'integrated-stacked-variance', value: 'line' },
    'combo.referenceStyle': { fixture: 'option-reference-line', value: 'tick' },
    'bar.referenceTick': { fixture: 'topn-others', value: { width: 7 } },
    'column.referenceTick': { fixture: 'plan-ticks-delta-callout', value: { position: 'front' } },
    'combo.referenceTick': { fixture: 'option-reference-tick-highlight', value: { width: 8, color: 'highlight' } },
    'grid.reflow': { fixture: 'nine-regions-reflow', value: false },
    'bar.rounding': { fixture: 'stacked100-slivers', value: 'nearest' },
    'column.rounding': { fixture: 'stacked-series-cagr', value: 'nearest' },
    'combo.rounding': { fixture: 'stacked-shares-sum', value: 'nearest' },
    'line.rounding': { fixture: 'stacked100-area-revenue-mix', value: 'nearest' },
    'pie.rounding': { fixture: 'ten-tiny-slices', value: 'nearest' },
    'table.rowExtent': { value: 'tracks', options: { size: { width: 1400 } } },
    'table.rowLabelLines': { fixture: 'monthly-kpi-sections' },
    'dot.rowLabels': { fixture: 'share-shift-dumbbell', options: { size: { width: 320 } } },
    'heatmap.scale': { fixture: 'regional-monthly-performance', value: 'discrete' },
    'line.scaleGroup': { fixture: 'actuals-forecast-market', value: { y: 'census-scale' } },
    'line.scenarioStyle': { fixture: 'brief-current-vs-prior' },
    'bartable.segmentValues': { fixture: 'single-panel', value: false },
    'grid.sharedScale': { fixture: 'weekly-actual-vs-plan', value: false },
    'bar.sharesOfOneWhole': { fixture: 'stacked-net-line-horizontal', value: true, options: { variant: 'stacked', unit: '%' }, reason: 'Only stacks have parts of one whole.' },
    'column.sharesOfOneWhole': { fixture: 'stacked100-survey-total-column', value: false, options: { variant: 'stacked' }, reason: 'Only stacks have parts of one whole.' },
    'dimswitch.show': { value: 'withData', data: d => { for (const f of d.facts) if (f.memberId === 'organic' && f.periodId === 'range') for (const k of Object.keys(f.sums)) f.sums[k] = 0; return d; } },
    'box.showObservations': { fixture: 'mixed-support-groups', value: 'none' },
    'dimswitch.signs': { fixture: 'statement', value: 'operators' },
    'table.signs': { fixture: 'contribution-margin-statement', value: 'signed' },
    'scatter.sizeBy': { fixture: 'portfolio-bubbles', value: 'diameter' },
    'choropleth.smallRegionArea': { fixture: 'eu-inflation', value: 1 },
    'bar.smallValues': { fixture: 'axis-break', value: 'p-value' },
    'bartable.smallValues': { fixture: 'cascade-two-periods', value: 'p-value' },
    'box.smallValues': { value: 'p-value' },
    'bullet.smallValues': { value: 'p-value' },
    'butterfly.smallValues': { fixture: 'tiny-side', value: 'p-value' },
    'choropleth.smallValues': { fixture: 'overlay-measure-heading', value: 'p-value', data: d => { d.regions[0].value = 0.0004; return d; } },
    'cohort.smallValues': { fixture: 'retention-24x24-resurrection', value: 'p-value' },
    'column.smallValues': { value: 'p-value' },
    'combo.smallValues': { fixture: 'margin-line-own-scale', value: 'p-value' },
    'dimswitch.smallValues': { data: d => { d.facts[2].sums.orders = 0.0004; return d; } },
    'dot.smallValues': { fixture: 'negatives-with-axis', value: 'p-value' },
    'funnel.smallValues': { fixture: 'zero-stage', value: 'p-value' },
    'grid.smallValues': { fixture: 'stacked-plus-dpy-tiered', value: 'p-value' },
    'heatmap.smallValues': { value: 'p-value' },
    'histogram.smallValues': { value: 'p-value' },
    'kpi.smallValues': { fixture: 'dual-compare', data: d => { d.value = 0.0004; return d; } },
    'line.smallValues': { fixture: 'stacked-area-services-growth', value: 'p-value' },
    'mekko.smallValues': { value: 'p-value' },
    'pareto.smallValues': { fixture: 'revenue-concentration', value: 'p-value' },
    'pie.smallValues': { fixture: 'ten-tiny-slices', data: d => { d.series[0].values[0] = 0.0004; return d; } },
    'pvm.smallValues': { fixture: 'named-periods-and-ranges', value: 'p-value' },
    'pyramid.smallValues': { fixture: 'workforce-tenure-gender', value: 'p-value' },
    'sankey.smallValues': { fixture: 'unbalanced-nodes', data: d => { d.links[0].value = 0.0004; return d; } },
    'scatter.smallValues': { fixture: 'price-volume-trend', value: 'p-value' },
    'slope.smallValues': { data: d => { d.series[0].values[0] = 0.0004; return d; } },
    'sparkline.smallValues': { fixture: 'bare-card-spark', data: d => { d.values[7] = 0.0004; return d; } },
    'status.smallValues': { fixture: 'status-with-values', data: d => ({ ...d, columns: [...d.columns, { id: 'm2', label: 'M2' }], cells: [{ ...d.cells[0], value: 12.4 }, { ...d.cells[0], col: 'm2', value: 0.0004 }] }) },
    'table.smallValues': { fixture: 'hierarchy-kinds', data: d => { d.rows[1].cells.value = 0.0004; return d; } },
    'tilemap.smallValues': { fixture: 'named-null-states', value: 'p-value', data: d => { d.regions[0].value = 0.0004; return d; } },
    'treemap.smallValues': { value: 'p-value' },
    'variance.smallValues': { fixture: 'all-negative-deltas', value: 'p-value' },
    'waffle.smallValues': { value: 'p-value' },
    'waterfall.smallValues': { fixture: 'sliver-segments', value: 'p-value' },
    'cohort.sort': { options: { variant: 'heatmap' }, reason: 'Only the heatmap warns that it keeps cohort order.' },
    'cohort.steps': { options: { variant: 'stepped', formatScope: 'classic' }, reason: 'Only absolute stepped classes read steps.' },
    'dimswitch.strings': { options: { source: 'Census' }, reason: 'The probe renames the word before a source.' },
    'waffle.subtotal': { fixture: 'stacked-segments' },
    'line.targets': { value: [{ at: 'fy24', value: 120, seriesId: 'output' }] },
    'choropleth.topN': { fixture: 'world-inflation' },
    'bar.tornado': { fixture: 'dcf-npv-sensitivity', value: { low: 'high', high: 'low' } },
    'table.totalPosition': { fixture: 'management-report' },
    'bar.unitShown': { fixture: 'gap-after-with-connectors' },
    'bartable.unitShown': { fixture: 'null-and-long-labels' },
    'box.unitShown': { fixture: 'dated-median-growth' },
    'butterfly.unitShown': { fixture: 'tiny-side' },
    'choropleth.unitShown': { fixture: 'dense-labels' },
    'cohort.unitShown': { fixture: 'missing-counts' },
    'column.unitShown': { fixture: 'gap-after-with-connectors' },
    'combo.unitShown': { fixture: 'zoom-preserves-source-mean' },
    'dot.unitShown': { fixture: 'highlighted-dumbbell-key' },
    'funnel.unitShown': { fixture: 'zero-stage' },
    'gantt.unitShown': { fixture: 'single-day' },
    'grid.unitShown': { fixture: 'three-tier' },
    'histogram.unitShown': { fixture: 'localized-binning' },
    'likert.unitShown': { fixture: 'column-overrides' },
    'line.unitShown': { fixture: 'multiline-highlight-fade' },
    'mekko.unitShown': { fixture: 'single-cell' },
    'pie.unitShown': { options: { subtitle: undefined } },
    'pvm.unitShown': { fixture: 'named-periods-and-ranges' },
    'pyramid.unitShown': { fixture: 'column-overrides' },
    'scatter.unitShown': { fixture: 'dense-paths-6000' },
    'slope.unitShown': { fixture: 'cell-value-label' },
    'status.unitShown': { fixture: 'status-with-values' },
    'table.unitShown': { fixture: 'table-status-square' },
    'tilemap.unitShown': { fixture: 'named-null-states' },
    'treemap.unitShown': { fixture: 'one-level-shares' },
    'variance.unitShown': { fixture: 'integrated-solid-shortfall' },
    'waffle.unitShown': { fixture: 'two-panels' },
    'waterfall.unitShown': { fixture: 'step-brackets' },
    'variance.variance': { fixture: 'all-positive-deltas', value: { of: 'saas', vs: 'services' } },
    'grid.variancePosition': { fixture: 'stacked-plus-dpy-tiered', value: 'below' },
  };
  // notes also gets one footnote (except creative, which refuses footnotes).
  // unitShown also gets an explicit unit. Both renders get the same companion.

  // Generate one different schema-valid value. Object values retain required fields.
  const sample = (schema: JsonSchema, current: unknown): unknown => {
    if (schema.enum) return schema.enum.find(value => JSON.stringify(value) !== JSON.stringify(current ?? schema.enum![0]));
    if ('const' in schema) return schema.const;
    const branches = schema.anyOf ?? schema.oneOf;
    if (branches) {
      const values = branches.map(part => sample(part, current));
      return values.find(value => JSON.stringify(value) !== JSON.stringify(current));
    }
    if (schema.type === 'boolean') return !current;
    if (schema.type === 'number' || schema.type === 'integer') {
      const value = typeof current === 'number' ? current + 7 : 7;
      return Math.min(schema.maximum ?? Infinity, Math.max(schema.minimum ?? (schema.exclusiveMinimum ?? -1) + 1, value));
    }
    if (schema.type === 'string') return typeof current === 'string' ? `${current} census` : 'census';
    if (schema.type === 'array') return schema.prefixItems
      ? schema.prefixItems.map((field, index) => sample(field, Array.isArray(current) ? current[index] : undefined))
      : Array.from({ length: Math.max(1, schema.minItems ?? 1) }, (_, index) => sample(schema.items || {}, Array.isArray(current) ? current[index] : undefined));
    if (schema.type === 'object') {
      const object = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } as Options : {};
      const fields = Object.entries(schema.properties ?? {}).filter(([, field]) => !('not' in field));
      for (const [key, field] of fields.filter(([key]) => schema.required?.includes(key))) {
        if (!(key in object)) object[key] = sample(field, undefined);
      }
      const field = fields.find(([key]) => key in object) ?? fields[0];
      if (field) object[field[0]] = sample(field[1], object[field[0]]);
      else if (typeof schema.additionalProperties === 'object') {
        const key = Object.keys(object)[0] ?? 'census';
        object[key] = sample(schema.additionalProperties, object[key]);
      }
      return object;
    }
    return 'census';
  };

  /**
   * Options that act only in a host, so one static chart cannot show them. Every row
   * still runs, and a row that starts to respond must be removed.
   *
   * Types | option | where it acts and the test that covers it.
   */
  const HOST_ONLY: readonly (readonly [string, string, string])[] = [
    ["bar bartable box bullet butterfly choropleth cohort column combo dot funnel gantt grid heatmap histogram kpi likert mekko pareto pie pvm pyramid scatter slope sparkline status dimswitch table tilemap sankey treemap variance waffle waterfall", "scaleGroup", "Shares one value domain across the charts of a React ScaleGroup (grid/sharedScale.ts) or a grid. tests/scale-group-react.test.tsx covers column, tests/grid-tiers-redesign.test.ts covers grid panels."],
    ["bar butterfly column combo dot funnel heatmap line mekko pie slope", "detailFields", "Labels the hover record (a11y/details.ts:16). tests/hover-record-details.test.tsx covers column."],
    ["bullet choropleth kpi mekko sparkline status", "belowMinimum", "No compact floor (sizing.ts:87), so only the request layer reads it: it stops the text step-down on a small slide (request.ts:404). tests/small-sizes.test.ts covers bar only. No CLI size changed choropleth, mekko or status."],
    ["dimswitch table", "mountCollapsed", "Initial React mount state (TableChart.tsx). No test compares its values."],
    ["dimswitch table", "paintOffscreenRows", "Offscreen React paint. tests/table-react.test.tsx covers it."],
    ["dimswitch table", "foldOn", "React click behaviour (TableChart.tsx). No test covers it."],
    ["dimswitch table", "stickyLabels", "Sticky host positioning. tests/table-react.test.tsx covers it."],
    ["dimswitch table", "sortIndicator", "The React sort head (TableChart.tsx). No test covers it."],
  ];

  /**
   * Accepted options that no layout of these types reads: they draw the same with any
   * value. Recorded, not fixed here. Every row still runs, and a row that starts to
   * respond must be removed. "Not sure" marks a reader that no tried input reached.
   *
   * Types | option | evidence.
   */
  const ACCEPTED_WITHOUT_EFFECT: readonly (readonly [string, string, string])[] = [
    ["tilemap", "focus", "Each tile label solves alone (tilemap/layout.ts solveTileLabels), so no label competes and the focus has no order to change."],
    ["waffle", "labelDensity", "Every waffle label is a total or a headline, above the band 'minimal' drops, and no cell priority is read; 'smart' and 'full' differ only where a chart reads them."],
    ["sankey", "belowMinimum", "Not sure: the fixed fallback reads it (sizing.ts:909), but no size changes the output."],
  ];
  /**
   * General preferences with nothing to act on in these types: no good and bad pair to
   * swap, no small number to print, a unit that already prints, no hatch to vary, or a
   * card that draws its own method lines. A warning here would be noise, so they stay
   * silent. Every row still runs, and a row that starts to respond must be removed.
   *
   * Types | option | why nothing can act.
   */
  const NOTHING_TO_ACT_ON: readonly (readonly [string, string, string])[] = [
    ["bartable cohort histogram treemap waffle", "colorblindSafe", "These types paint no good and bad pair, and the swap acts only on that pair (registry.ts:763, schema/shared.ts:1553)."],
    ["box", "colorblindSafe", "Not sure: the negative diff tone (annotateArms.ts:726) is not swapped."],
    ["gantt", "smallValues", "Gantt prints dates only; its format is never (gantt/layout.ts:66)."],
    ["likert", "smallValues", "Shares use the explicit share format (likert/layout.ts:549), and a share that rounds to zero is dropped (likert/layout.ts:716)."],
    ["pareto", "unitShown", "The unit is always the axis name (pareto/layout.ts:473, 558), so no unit line is added."],
    ["sparkline", "unitShown", "The unit feeds the format only (sparkline/layout.ts:774); no unit line is drawn."],
    ["cohort", "hatchStrength", "Not sure: the not-reached hatch (cohort/layout.ts:446) draws the same at 0 and 100."],
    ["creative", "notes", "The card draws its own method lines (creative/layout.ts:603) and refuses footnotes."],
  ];
  const gaps = new Map<string, string>([...HOST_ONLY, ...ACCEPTED_WITHOUT_EFFECT, ...NOTHING_TO_ACT_ON].flatMap(([types, key, reason]) =>
    types.split(' ').map(type => [`${type}.${key}`, reason] as const)));

  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const draw = (type: string, fixture: Fixture, authored: Options, parsed?: Options) => {
    const definition = getChartDefinition(type)!;
    const options = { ...definition.defaults, ...(parsed ?? definition.optionsSchema.parse(structuredClone(authored))) as object };
    let result;
    try { result = definition.layout(definition.normalize(structuredClone(fixture.data)), options as never); }
    catch (error) {
      if (!(error instanceof NormalizeError)) throw error;
      // Hosts expose these domain errors as refusals. A refusal is a response, not a silent drop.
      result = layoutRefusal(type, fixture.title, { width: 720, height: 405 }, error);
    }
    // Hosts pass interactive to the renderer, as the CLI does.
    const svg = result.refused ? '' : renderSvg(result, resolveTheme((options as Options).theme as ThemeRef | undefined), { interactive: (options as Options).interactive === true });
    // A scope hash is not visible behaviour. Keep text and aria content, but remove generated ids.
    return { refused: !!result.refused, labels: result.refused ? [] : result.labels, hash: digest(svg.replace(/ id="[^"]*"| aria-describedby="[^"]*"|url\(#[^)]*\)/g, '')), warnings: result.warnings };
  };

  // Prevent new options from being accepted without a visible effect or an option-specific warning.
  // Allow scheduler variance without changing the probe count.
  it('each published option changes SVG bytes or gives a warning that names the option', { timeout: 120_000 }, () => {
    const failures: string[] = [];
    const seenGaps = new Set<string>();
    const usedProbes = new Set<string>();
    for (const { type } of listCharts()) {
      const definition = getChartDefinition(type)!;
      const schema = z.toJSONSchema(definition.optionsSchema as never, { io: 'input' }) as JsonSchema;
      const fixtureId: Record<string, string> = { bar: 'margin-by-brand', diagram: 'onboarding-journey' };
      const fixture = (fixtureId[type] ? getFixtures(type).find(f => f.id === fixtureId[type]) : getFixtures(type)[0])!;
      expect(fixture, `${type}: needs a representative fixture`).toBeDefined();
      const authored: Options = { ...fixture.options as Options,
        ...(fixture.annotations ? { annotations: fixture.annotations } : {}) };
      const baseline = draw(type, fixture, authored);
      expect(baseline.refused, `${type}: representative fixture must draw`).toBe(false);
      const befores = new Map([['||{}', baseline]]);
      for (const [key, field] of Object.entries(schema.properties ?? {})) {
        if ('not' in field) continue;
        // Only the architecture variant reads highlight, and the agent-approval golden shows it.
        if (type === 'diagram' && key === 'highlight') continue;
        const probe: Probe = PROBES[`${type}.${key}`] ?? {};
        usedProbes.add(`${type}.${key}`);
        const shipped = probe.fixture ? getFixtures(type).find(item => item.id === probe.fixture) : fixture;
        expect(shipped, `${type}.${key}: needs fixture ${probe.fixture}`).toBeDefined();
        const probeFixture = probe.data ? { ...shipped!, data: probe.data(structuredClone(shipped!.data)) } as Fixture : shipped!;
        const probeAuthored: Options = probeFixture === fixture ? authored : { ...probeFixture.options as Options,
          ...(probeFixture.annotations ? { annotations: probeFixture.annotations } : {}) };
        const companions: Options = { ...probe.options };
        if (key === 'notes' && type !== 'creative') companions.footnotes = ['Census note'];
        if (key === 'unitShown') companions.unit = 'Census unit';
        // Draw each distinct before state once per type.
        const beforeKey = `${probe.fixture ?? ''}|${probe.data ? key : ''}|${JSON.stringify(companions, (_, item) => item === undefined ? 'undefined' : item)}`;
        if (!befores.has(beforeKey)) befores.set(beforeKey, draw(type, probeFixture, { ...probeAuthored, ...companions }));
        const before = befores.get(beforeKey)!;
        expect(before.refused, `${type}.${key}: probe input must draw`).toBe(false);
        const data = probeFixture.data as { categories?: { id: string }[]; series?: { id: string }[] };
        const ids = data.categories?.map(c => typeof c === 'string' ? c : c.id) ?? [];
        const series = data.series?.map(s => s.id) ?? [];
        const current = probeAuthored[key] ?? (definition.defaults as Options)[key] ?? field.default;
        let value = key in VALUES && JSON.stringify(VALUES[key]) !== JSON.stringify(current)
          ? VALUES[key] : sample(field, current);
        if (key === 'focus' && probeFixture.hover) value = { owner: probeFixture.hover.owner };
        if (key === 'highlight') value = series[0] ?? 'census';
        if (key === 'story') value = { steps: [{ id: 'census', title: 'Census step', highlight: series[0] ?? 'census' }] };
        if (key === 'annotations') {
          value = probeFixture.annotations?.length ? probeFixture.annotations.map(a => ['valueLine', 'band', 'event'].includes(a.kind) ? { ...a, label: 'Census annotation' } : { ...a, text: 'Census annotation' })
            : [{ kind: 'note', at: ids[0] ?? 'census', text: 'Census annotation' }];
        }
        if (key === 'labelPlacements' && before.labels[0]) value = { [before.labels[0].id]: 'insideCenter' };
        if (key === 'labelOffsets' && before.labels.some(label => !label.hidden)) value = { [before.labels.find(label => !label.hidden)!.id]: { y: 12 } };
        if (key === 'viewDomain' && type !== 'scatter') value = { x: [ids[1] ?? ids[0], ids.at(-1)] };
        if (key === 'a' || key === 'b') value = series.find(id => id !== current) ?? value;
        if (key === 'labelRegions') value = []; // An explicit empty set removes the authored region labels.
        if (key === 'today') value = '2026-05-20';
        // The fixture highlights Purchase, a final node. An unset linkColor already colours the ribbons into it, as 'target' does; 'source' leaves them neutral.
        if (type === 'sankey' && key === 'linkColor') value = 'source';
        // ['plot'] is the default order on these two, so the probe moves a block.
        if (type === 'bullet' && key === 'columnOrder') value = ['gap', 'target', 'plot'];
        if (type === 'likert' && key === 'columnOrder') value = ['net', 'plot'];
        if (type === 'butterfly' && key === 'sortBy') value = 'b';
        if (type === 'waterfall' && key === 'signColor') value = false;
        if (type === 'tilemap' && key === 'regionValues') value = false;
        if (type === 'table' && key === 'magnitude') value = 'thousand';
        if (type === 'dimswitch' && key === 'depth') value = 1;
        if (type === 'dimswitch' && key === 'expansion') value = { depth: 1 };
        if (type === 'scatter' && key === 'zones') value = { grid: { x: [5], y: [4] } };
        // A swamped pvm base breaks the axis by default, so the probe asks for a whole axis.
        if (type === 'pvm' && key === 'valueAxis') value = { break: false };
        if (type === 'line' && key === 'fan') value = { of: 'output', bands: [{ low: 'output', high: 'market', label: 'Census bounds' }] };
        if (type === 'bartable' && key === 'combinedShare') value = { rows: [ids[1], ids[2]] };
        // 'bottom' is the default, so only 'top' moves the Total row.
        if ((type === 'bartable' || type === 'cohort') && key === 'totalPosition') value = 'top';
        if (type === 'cohort' && key === 'columnVisibility') value = { size: false };
        if (type === 'cohort' && key === 'columnOverrides') value = { size: { label: 'Census size' } };
        if (type === 'cohort' && key === 'columnOrder') value = ['periods', 'size'];
        if (type === 'grid' && key === 'alignmentRules') value = [{ id: 'census', orientation: 'horizontal', at: { panelId: 'rev', anchor: 'plotTop' } }];
        if (type === 'waffle' && key === 'panelGroups') value = [{ id: 'census', panels: ids, label: 'Census group' }];
        if (type === 'waffle' && key === 'subtotal') value = { series, label: 'Census subtotal' };
        if ('value' in probe) value = probe.value;
        // The request removes a setting the type ignores before the schema reads it, as the CLI does.
        const optionPath = (options: Options) => retireChartSettings(type, { options });
        let changed = optionPath({ ...probeAuthored, ...companions, [key]: value }).chart.options as Options;
        // Use a schema-valid fallback before rendering; never count a rejected sample as behaviour.
        let parsed = definition.optionsSchema.safeParse(changed);
        if (!parsed.success && !('value' in probe)) {
          value = sample(field, current);
          changed = optionPath({ ...probeAuthored, ...companions, [key]: value }).chart.options as Options;
          parsed = definition.optionsSchema.safeParse(changed);
        }
        try {
          const after = draw(type, probeFixture, changed, parsed.success ? parsed.data as Options : undefined);
          after.warnings.push(...optionPath({ ...probeAuthored, ...companions, [key]: value }).warnings);
          const namedWarning = after.warnings.some(warning =>
            !before.warnings.some(old => JSON.stringify(old) === JSON.stringify(warning))
            && (warning.field?.includes(key) || new RegExp(`\\b${key}\\b`).test(`${warning.message} ${warning.suggest ?? ''}`)));
          if (after.hash === before.hash && !namedWarning) {
            const pair = `${type}.${key}`;
            if (gaps.has(pair)) seenGaps.add(pair);
            else failures.push(`${pair}: same SVG and no new warning naming the option (probe ${JSON.stringify(value)})`);
          }
        } catch (error) {
          failures.push(`${type}.${key}: ${String(error).slice(0, 500)}`);
        }
      }
    }
    expect(Object.keys(PROBES).filter(pair => !usedProbes.has(pair)), 'Remove probes of options that are no longer published').toEqual([]);
    const staleGaps = [...gaps.keys()].filter(pair => !seenGaps.has(pair));
    expect(staleGaps, 'Remove gaps that now respond or are no longer published').toEqual([]);
    expect(failures).toEqual([]);
  });
});
