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

  /** Options | companion settings | reason. Applied to both renders. */
  const COMPANIONS: Record<string, { options: Options; reason: string }> = {
    'pyramid.labelPosition': { options: { size: { width: 960, height: 900 } }, reason: 'The representative fixture has eighteen rows; its default bars are too short for inside values.' },
    'bar.sharesOfOneWhole': { options: { variant: 'stacked' }, reason: 'Only stacks have parts of one whole.' },
    'column.sharesOfOneWhole': { options: { variant: 'stacked' }, reason: 'Only stacks have parts of one whole.' },
    'choropleth.colorblindSafe': { options: { scale: { kind: 'diverging', midpoint: 0, polarity: 'higherIsBetter' } }, reason: 'Needs two scale poles.' },
    'tilemap.colorblindSafe': { options: { scale: { kind: 'diverging', midpoint: 0, polarity: 'higherIsBetter' } }, reason: 'Needs two scale poles.' },
    'cohort.labels': { options: { variant: 'heatmap' }, reason: 'Exhibit variants have a fixed label set.' },
    'cohort.sort': { options: { variant: 'heatmap' }, reason: 'Only the heatmap warns that it keeps cohort order.' },
    'dimswitch.strings': { options: { source: 'Census' }, reason: 'The probe renames the word before a source.' },
    'table.lastTrackFlex': { options: { rowExtent: 'tracks', size: { width: 1400 } }, reason: 'Only tracks with spare width have a last track to grow.' },
    'cohort.steps': { options: { variant: 'stepped', formatScope: 'classic' }, reason: 'Only absolute stepped classes read steps.' },
    'cohort.figures': { options: { variant: 'stepped' }, reason: 'Only stepped fills can stop their numbers.' },
    'table.figures': { options: { encodings: { actual: 'heat' } }, reason: 'Figures can be hidden only on a heat lane.' },
    'dimswitch.figures': { options: { encodings: { range: 'heat' } }, reason: 'Figures can be hidden only on a heat lane.' },
    'dimswitch.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a pinned height has spare height to fill.' },
    'table.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a pinned height has spare height to fill.' },
    'bartable.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a pinned height has spare height to fill.' },
    'waffle.heightFill': { options: { target: 'slide', size: { width: 1184, height: 528 } }, reason: 'Only a pinned height has spare height to fill.' },
    'diagram.heightFill': { options: { size: { width: 900, height: 900 } }, reason: 'Only a set height has spare height to fill.' },
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
   * Measured no-effect pairs, not a list of confirmed engine defects. Some
   * options need other data, a different variant, or a React host. Keep each
   * pair explicit: new types and options must never inherit a gap. Every row
   * still runs, and a row that starts to respond must be removed.
   *
   * Types | option | reason for the one-fixture coverage gap.
   */
  const KNOWN_GAPS: readonly (readonly [string, string, string])[] = [
    ["bar bartable box bullet butterfly choropleth cohort column combo dot funnel gantt grid heatmap histogram kpi likert line mekko pareto pie pvm pyramid scatter slope sparkline status dimswitch table tilemap sankey treemap variance waffle waterfall", "belowMinimum", "Runs only when the chart does not fit: box cycle-time-by-team at target slide, butterfly long-labels 320 wide. Types with no such spec: reader at registry.ts:700, needs a size under the floor, not proved."],
    ["bar bartable box butterfly choropleth cohort column combo dot funnel gantt grid histogram likert line mekko pareto pie pvm pyramid scatter slope sparkline status table tilemap treemap variance waffle waterfall", "unitShown", "Prints only where the chart does not already state the unit: butterfly tiny-side. Types with no such spec: reader at frame.ts:806, needs a unit the frame can hoist, not proved."],
    ["bar bartable box bullet butterfly choropleth cohort column combo dot funnel gantt grid heatmap histogram kpi likert line mekko pareto pie pvm pyramid scatter slope sparkline status dimswitch table tilemap sankey treemap variance waffle waterfall", "smallValues", "Acts on a value under the printed precision: slope diverging-team-engagement with data x 0.00001. Types with no such spec: reader at format.ts:31, needs such a value, not proved."],
    ["bar bartable box bullet butterfly choropleth cohort column combo dot funnel gantt grid heatmap histogram kpi likert line mekko pareto pie pvm pyramid scatter slope sparkline status tilemap sankey treemap variance waffle waterfall", "labelPlacements", "Pins a label to a slot its kind can take: box salary-bands-pinned-median with { 'median:ic5': 'aboveMedian' }. Where the slot cannot apply it warns, and the warning names the slot."],
    ["bar bartable box bullet butterfly choropleth cohort column combo dot funnel gantt grid heatmap histogram kpi likert line mekko pareto pie pvm pyramid scatter slope sparkline status dimswitch table tilemap sankey treemap variance waffle waterfall", "scaleGroup", "Shares a domain with a second chart of the group: column forecast-ci-column in a two-chart document, second chart values x 3."],
    ["bar bartable cohort combo gantt grid heatmap histogram kpi likert pareto pie sparkline status dimswitch table tilemap treemap waffle", "focus", "Lifts a label in the solve order, so it shows only where labels compete: bar valuation-football-field with its dcf equity-value owner. Others: reader at label/solver.ts:384, needs competing labels, not proved."],
    ["bar butterfly choropleth cohort combo funnel grid heatmap line mekko slope status", "hatchStrength", "Needs a hatched mark, which this fixture lacks: butterfly customer-spend with every series scenario FC. The hatch census above covers the rest."],
    ["bar column heatmap bartable box butterfly cohort combo dot funnel gantt histogram mekko pareto pie pyramid scatter slope sparkline sankey treemap waffle", "colorblindSafe", "Swaps the good and bad paints, so it needs a chart that paints them: sankey sales-stages. Others: reader at grid/layoutGrid.ts:353, needs a good and bad paint, not proved."],
    ["bar bartable box bullet butterfly choropleth cohort column combo creative diagram dot funnel gantt grid heatmap histogram kpi likert line mekko pareto pie pvm pyramid scatter slope sparkline status dimswitch table tilemap sankey treemap variance waffle waterfall", "interactive", "React host setting; the static SVG has no interaction state."],
    ["bar butterfly column combo dot funnel heatmap line mekko pie slope", "detailFields", "Hover-record labels for cell details; the static SVG draws the same picture. Reader at a11y/details.ts:16."],
    ["bar bullet histogram variance", "axisTitles", "Prints only under a drawn value axis: bullet sparse-targets-overshoot, variance all-negative-deltas on the variant that draws one."],
    ["bar column", "sharesOfOneWhole", "Reader at bar/domain.ts:589 and column/domain.ts:968, needs a stack whose authored parts miss 100, not proved."],
    ["bar", "tornado", "Only variant tornado reads it: dcf-npv-sensitivity with its real series ids."],
    ["bar choropleth line", "methodNote", "Adds a note only where the data needs one: choropleth world-inflation, bar stacked100-slivers with null values."],
    ["bar column combo", "referenceStyle", "Needs a reference mark: combo option-reference-line with 'marker'."],
    ["bar combo", "referenceTick", "Needs a reference tick: combo option-reference-tick-highlight."],
    ["column", "referenceTick", "Needs a plan tick across a column: column plan-ticks-front with { position: 'front' }."],
    ["bartable box grid heatmap kpi line slope sparkline status dimswitch table variance waffle", "labelDensity", "Thins labels only where they compete: box cycle-time-by-team with 'minimal'. Others: reader at frame.ts:1222, needs competing labels, not proved."],
    ["bartable column combo dot status table tilemap treemap variance waffle waterfall", "legend", "Draws a key only with parts to name: variance dpy-absolute-regions with 'bottom'."],
    ["bartable", "segmentValues", "The representative fixture gives every row a range, and a row with a range prints end labels only; the single-panel fixture shows the parts."],
    ["bartable mekko slope", "highlight", "Names a mark of the fixture: slope market-share-shift with '2020'. On bartable it warns only when a named row is missing."],
    ["box bullet gantt likert pvm pyramid scatter", "annotations", "The census note has no anchor on this fixture: box dated-median-growth with a diff annotation draws one."],
    ["box", "showObservations", "Needs observation marks: box mixed-support-groups with 'none'."],
    ["butterfly", "negatives", "Needs a negative value: butterfly negatives-own-scale with 'magnitude'."],
    ["choropleth", "topN", "Labels world maps only: choropleth world-inflation with { n: 2 }."],
    ["choropleth", "labelRegions", "Labels world maps only: choropleth world-inflation with ['AE', 'AF']."],
    ["choropleth", "smallRegionArea", "Needs small regions: choropleth eu-inflation with 0."],
    ["choropleth tilemap", "overlayTones", "Needs an overlay with tones: choropleth world-footprint."],
    ["choropleth tilemap", "overlayMeasure", "Needs an overlay: choropleth world-footprint with 'US'."],
    ["column line pie", "othersShade", "Reader at column/paints.ts:86, needs an Others mark in a topN cut, not proved."],
    ["column combo line", "events", "Needs an event lane: column weekly-events-lane with placement 'key'."],
    ["creative", "notes", "Reader at notes.ts:147, needs a footnote, which creative refuses, not proved."],
    ["dot", "rowLabels", "Moves a label only when it wraps: dot share-shift-dumbbell 320 wide with align 'right'."],
    ["gantt", "colHeaders", "Needs metadata columns: gantt transformation-program."],
    ["grid treemap waffle", "valueAxis", "Reader at a11y/categoryRecords.ts:68 and grid/layout.ts:694, needs a panel that reads a domain, not proved."],
    ["grid", "sharedScale", "Needs panels on different scales: grid weekly-actual-vs-plan with false."],
    ["grid", "variancePosition", "Needs column/variance category tiers: grid weekly-actual-vs-plan with 'below'."],
    ["grid", "reflow", "Needs a facet grid on a phone card; tests/grid-tiers-redesign.test.ts covers reflow on one."],
    ["heatmap status", "labels", "Acts on a label this variant draws: status review-status-legend-none with false."],
    ["heatmap", "scale", "Needs a value variant: heatmap regional-monthly-performance with 'discrete'."],
    ["heatmap", "bubble", "Needs the bubble variant: heatmap survey-journey-track with a track."],
    ["heatmap", "missing", "Needs a missing cell: heatmap missing-cells with 'blank'."],
    ["bullet kpi status table", "format", "Authored series, column or row formats win: kpi value-only prints it. Status: reader at status/layout.ts:193, needs values with decimals, not proved."],
    ["kpi", "comparisons", "Needs two comparisons: kpi dual-compare with 'chip'."],
    ["bar column combo line pie", "rounding", "Needs shares that miss the printed whole: combo stacked-shares-sum with 'nearest', pie streaming-genre-share with null values."],
    ["line", "endLabelPlacement", "Needs the bump variant: line brand-share-bump with 'gutter'."],
    ["line", "bump", "Needs the bump variant: line brand-share-bump."],
    ["line", "highlightMode", "Needs an area variant: line stacked-area-services-growth with 'fade'."],
    ["line", "scenarioStyle", "Needs scenario series: line brief-current-vs-prior."],
    ["line", "targets", "Needs a seat for the target at a narrow width: line stacked100-area-mixed-sign-fail-closed 320 wide."],
    ["pie", "colors", "Needs many slices: pie ten-tiny-slices with 'categorical'."],
    ["scatter", "sizeBy", "Needs bubbles: scatter portfolio-bubbles with 'diameter'."],
    ["cohort", "averages", "Draws only on the heatmap with cohorts of different lengths: saas-logo-retention with 'weighted'."],
    ["cohort", "legend", "The pure exhibit of this fixture draws no key: the heatmap of the same type does."],
    ["dimswitch", "lastTrackFlex", "Reader at table/tracks.ts:646, needs tracks that leave spare width, not proved."],
    ["dimswitch table", "mountCollapsed", "Initial React mount state does not change the static SVG."],
    ["dimswitch table", "paintOffscreenRows", "Offscreen React paint does not change the static SVG."],
    ["dimswitch table", "signs", "Needs sign -1 rows: dimswitch statement, table contribution-margin-statement."],
    ["dimswitch table", "driverTones", "Needs driver rows: dimswitch statement, table driver-tones-grouped."],
    ["table", "totalPosition", "Needs top-level rows and a total: table mixed-top-level-rows with 'top'."],
    ["dimswitch table", "nulls", "Needs a missing value: by-measure with every third value null."],
    ["dimswitch table", "inlineVisibility", "Needs an inline group: table steering-table-v2. Dimswitch: reader at dimswitch/compile.ts:764, needs a change line in the group, not proved."],
    ["dimswitch table", "foldOn", "React click behaviour: reader at TableChart.tsx:2247. The static SVG has no click."],
    ["dimswitch table", "groupGround", "Needs an open group: dimswitch by-member, table hierarchy-kinds with 'expanded'."],
    ["dimswitch table", "stickyLabels", "Sticky host positioning does not change the static SVG."],
    ["dimswitch table", "sortIndicator", "Changes the React sort head only; the static SVG has no chevron."],
    ["dimswitch table", "fitFormats", "Needs a width the figures miss: dimswitch sheet 1400 wide, table steering-monthly with value columns 34 wide."],
    ["dimswitch table", "maxGrowth", "Needs spare frame width: dimswitch by-measure with 1 at 320, table benchmark-competitors with 1."],
    ["dimswitch treemap", "order", "Needs siblings to sort: dimswitch by-member with { by: 'revenue' }. Treemap reads 'sheet' on its own data order."],
    ["dimswitch", "show", "Reader at dimswitch/compile.ts:397, needs a member whose fields are all empty in Range, not proved."],
    ["dimswitch", "minimumSample", "Needs a judge base field: dimswitch multiple-sample-bases with { orders: 57, sessions: 100 }."],
    ["table", "frameFill", "Needs spare frame width: table status-review-relaxed with 'none' 1400 wide."],
    ["table", "rowLabelLines", "Needs a label that wraps: table benchmark-competitors with 1."],
    ["table", "rowExtent", "Needs spare frame width: table status-review-relaxed with 'tracks' 1400 wide."],
    ["variance", "variance", "Needs real series ids: variance all-positive-deltas with { of: 'saas', vs: 'services' }."],
    ["variance", "missingMark", "Needs a missing prior: variance dpy-absolute-regions with every third value null."],
    ["waffle", "cellNote", "Reader at waffle/layout.ts:375, needs a cell with a note, not proved."],
    ["waffle", "subtotal", "Needs several series: waffle stacked-segments."],
  ];
  const gaps = new Map<string, string>(KNOWN_GAPS.flatMap(([types, key, reason]) =>
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
    const svg = result.refused ? '' : renderSvg(result, resolveTheme((options as Options).theme as ThemeRef | undefined));
    // A scope hash is not visible behaviour. Keep text and aria content, but remove generated ids.
    return { refused: !!result.refused, labels: result.refused ? [] : result.labels, hash: digest(svg.replace(/ id="[^"]*"| aria-describedby="[^"]*"|url\(#[^)]*\)/g, '')), warnings: result.warnings };
  };

  // Prevent new options from being accepted without a visible effect or an option-specific warning.
  // Allow scheduler variance without changing the probe count.
  it('each published option changes SVG bytes or gives a warning that names the option', { timeout: 120_000 }, () => {
    const failures: string[] = [];
    const seenGaps = new Set<string>();
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
      const data = fixture.data as { categories?: { id: string }[]; series?: { id: string }[] };
      const ids = data.categories?.map(c => typeof c === 'string' ? c : c.id) ?? [];
      const series = data.series?.map(s => s.id) ?? [];
      for (const [key, field] of Object.entries(schema.properties ?? {})) {
        if ('not' in field) continue;
        // Only the architecture variant reads highlight, and the agent-approval golden shows it.
        if (type === 'diagram' && key === 'highlight') continue;
        const current = authored[key] ?? (definition.defaults as Options)[key] ?? field.default;
        let value = key in VALUES && JSON.stringify(VALUES[key]) !== JSON.stringify(current)
          ? VALUES[key] : sample(field, current);
        if (key === 'focus' && fixture.hover) value = { owner: fixture.hover.owner };
        if (key === 'highlight') value = (fixture.data as { series?: { id: string }[] }).series?.[0]?.id ?? 'census';
        if (key === 'story') value = { steps: [{ id: 'census', title: 'Census step', highlight: (fixture.data as { series?: { id: string }[] }).series?.[0]?.id ?? 'census' }] };
        if (key === 'annotations') {
          value = fixture.annotations?.length ? fixture.annotations.map(a => a.kind === 'valueLine' ? { ...a, label: 'Census annotation' } : { ...a, text: 'Census annotation' })
            : [{ kind: 'note', at: (fixture.data as { categories?: { id: string }[] }).categories?.[0]?.id ?? 'census', text: 'Census annotation' }];
        }
        if (key === 'labelPlacements' && baseline.labels[0]) value = { [baseline.labels[0].id]: 'insideCenter' };
        if (key === 'labelOffsets' && baseline.labels.some(label => !label.hidden)) value = { [baseline.labels.find(label => !label.hidden)!.id]: { y: 12 } };
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
        if (type === 'dimswitch' && key === 'order') value = { by: 'revenue', desc: true };
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
        const companions: Options = { ...COMPANIONS[`${type}.${key}`]?.options };
        if (key === 'notes' && type !== 'creative') companions.footnotes = ['Census note'];
        if (key === 'unitShown') companions.unit = 'Census unit';
        let changed = { ...authored, ...companions, [key]: value };
        const before = Object.keys(companions).length ? draw(type, fixture, { ...authored, ...companions }) : baseline;
        expect(before.refused, `${type}.${key}: companion settings must draw`).toBe(false);
        // Use a schema-valid fallback before rendering; never count a rejected sample as behaviour.
        let parsed = definition.optionsSchema.safeParse(changed);
        if (!parsed.success) {
          value = sample(field, current);
          changed = { ...authored, ...companions, [key]: value };
          parsed = definition.optionsSchema.safeParse(changed);
        }
        try {
          const after = draw(type, fixture, changed, parsed.success ? parsed.data as Options : undefined);
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
    const staleGaps = [...gaps.keys()].filter(pair => !seenGaps.has(pair));
    expect(staleGaps, 'Remove gaps that now respond or are no longer published').toEqual([]);
    expect(failures).toEqual([]);
  });
});
