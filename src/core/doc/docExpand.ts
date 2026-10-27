import * as z from 'zod';
import type { LintWarning } from '../types/scene';
import { ownedDocumentCopy } from './ownedDocumentCopy';
import { isRecord } from '../lint/shared';
import { maxOf, pushAll } from '../arrays';

export { ownedDocumentCopy } from './ownedDocumentCopy';

/** Every own property name ECMAScript defines on Object.prototype. */
const STANDARD_OBJECT_PROTOTYPE_MEMBERS = new Set([
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/**
 * Remove non-standard properties from Object.prototype at a process entry
 * point. The per-boundary ownedDocumentCopy guards every document parse, but
 * optional-key reads exist in every layout, the renderer and theme
 * validation — an inherited `labels` or `theme` silently restyles
 * output. A CLI process owns its runtime: anything foreign on
 * Object.prototype is either pollution or a broken embedder, and removing it
 * once ends the class everywhere. Non-configurable members cannot be removed;
 * those are reported through `warn` and the parse-level guards still turn the
 * resulting failures into diagnosed errors.
 */
export function sanitizeObjectPrototype(warn: (message: string) => void): void {
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    if (STANDARD_OBJECT_PROTOTYPE_MEMBERS.has(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, name);
    if (descriptor?.configurable) {
      delete (Object.prototype as Record<string, unknown>)[name];
    } else {
      warn(
        `the JavaScript environment defines a non-removable property '${name}' on Object.prototype — results may be affected; run in a clean Node process`,
      );
    }
  }
}

interface RepeatSpec {
  dimension: string;
  values: string[];
}

interface ExpandedChart {
  name: string;
  type: string;
  data: unknown;
  options?: Record<string, unknown>;
  annotations?: unknown[];
}

interface RepeatChart extends ExpandedChart {
  repeat: RepeatSpec;
  data: { bySlice: Record<string, unknown> };
}

interface ExpandedEntry {
  chart: ExpandedChart;
  index: number;
  repeatOrigin?: string;
  repeatLabel?: string;
}

export interface DocExpansion {
  doc: unknown;
  warnings: LintWarning[];
  /** Authored chart and optional slice corresponding to each expanded chart. */
  sources: { index: number; slice?: string }[];
}

const repeatSpecSchema = z
  .strictObject({
    dimension: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/)
      .describe('Placeholder name; use it as $dimension in chart name, title, and subtitle strings.'),
    values: z.array(z.string().min(1).describe('Facet value bound to the placeholder and used to look up a data.bySlice entry.')).min(1).describe('Ordered facet values to bind and expand.'),
  })
  .describe('Chart-level repeat declaration expanded before chart validation.');

/** A chart without its name reads this, not "expected string, received undefined". */
export function missingChartName(issue: { input?: unknown }): string | undefined {
  return issue.input === undefined ? 'chart name is missing; every chart in charts needs a name, unique in the document' : undefined;
}

const repeatChartSchema = z
  .object({
    name: z
      .string({ error: missingChartName })
      .min(1)
      .describe('Chart name template; without $dimension, expanded names are <name>-<value>.'),
    type: z.string().min(1).describe('Registered chart type repeated for every facet value.'),
    repeat: repeatSpecSchema,
    data: z
      .strictObject({
        bySlice: z
          .record(z.string(), z.unknown().describe('Chart data for this facet; the selected chart schema validates it after expansion.'))
          .describe('Exact slice lookup; every repeat value must have one chart-data entry.'),
      })
      .describe('Facet data keyed by repeat value.'),
    options: z
      .record(z.string(), z.unknown().describe('Chart option value, validated by the selected chart schema after expansion.'))
      .optional()
      .describe('Chart options; title and subtitle strings may contain the dimension placeholder.'),
    annotations: z.array(z.unknown().describe('Annotation copied to each expanded chart; chart validation and annotation resolution check its shape and anchors.')).optional().describe('Shared annotations attached to each expanded chart.'),
  })
  .superRefine((chart, ctx) => {
    const seen = new Set<string>();
    chart.repeat.values.forEach((value, index) => {
      if (seen.has(value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['repeat', 'values', index],
          message: `duplicate repeat value '${value}'`,
        });
      }
      seen.add(value);
      if (!Object.hasOwn(chart.data.bySlice, value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['data', 'bySlice', value],
          message: `missing data slice for repeat value '${value}'`,
        });
      }
    });
  })
  .describe('Chart specification expanded once per repeat value before validation, rendering, and manifests.');

export class DocExpansionError extends Error {
  constructor(readonly issues: { path: (string | number)[]; message: string }[]) {
    super(
      `document schema errors:\n${issues
        .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'DocExpansionError';
  }
}

/** Expand chart-level repeat shorthand and run lints that need whole-document context. */
export function expandDoc(input: unknown): DocExpansion {
  if (!isRecord(input) || !Array.isArray(input.charts)) return { doc: input, warnings: [], sources: [] };

  const entries: ExpandedEntry[] = [];
  const outputCharts: unknown[] = [];
  const sources: DocExpansion['sources'] = [];
  const repeats: RepeatChart[] = [];
  const issues: { path: (string | number)[]; message: string }[] = [];

  input.charts.forEach((rawChart, sourceIndex) => {
    // Object.hasOwn, not a bare property read: an inherited 'repeat' (a
    // polluted Object.prototype) would drag every chart into the repeat
    // parse and degrade the whole document to a pathless cli-error.
    if (!isRecord(rawChart) || !Object.hasOwn(rawChart, 'repeat') || rawChart.repeat === undefined) {
      const copied = ownedDocumentCopy(rawChart);
      outputCharts.push(copied);
      sources.push({ index: sourceIndex });
      if (isExpandedChart(copied)) entries.push({ chart: copied, index: outputCharts.length - 1 });
      return;
    }

    const parsed = repeatChartSchema.safeParse(rawChart);
    if (!parsed.success) {
      pushAll(issues, parsed.error.issues.map((issue) => ({
          path: [
            'charts',
            sourceIndex,
            ...issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
          ],
          message: issue.message,
        })));
      return;
    }

    const chart = parsed.data as RepeatChart;
    repeats.push(chart);
    const origin = `repeat:${sourceIndex}:${chart.repeat.dimension}`;
    for (const value of chart.repeat.values) {
      const expanded = expandRepeatChart(chart, value);
      entries.push({
        chart: expanded,
        index: outputCharts.length,
        repeatOrigin: origin,
        repeatLabel: `repeat chart '${chart.name}' over '${chart.repeat.dimension}'`,
      });
      outputCharts.push(expanded);
      sources.push({ index: sourceIndex, slice: value });
    }
  });

  if (issues.length > 0) throw new DocExpansionError(issues);

  return {
    doc: { ...input, charts: outputCharts },
    sources,
    warnings: [
      ...lintRepeatValues(repeats),
      ...lintPaletteDrift(entries),
      ...lintScaleDrift(entries),
    ],
  };
}

function expandRepeatChart(chart: RepeatChart, value: string): ExpandedChart {
  const placeholder = `$${chart.repeat.dimension}`;
  const substitutedName = substituteString(chart.name, placeholder, value);
  const name = chart.name.includes(placeholder) ? substitutedName : `${substitutedName}-${value}`;
  const options = chart.options ? ownedDocumentCopy(chart.options) : undefined;
  if (options && typeof options.title === 'string') {
    options.title = substituteString(options.title, placeholder, value);
  }
  if (options && options.subtitle !== undefined) {
    options.subtitle = substituteStrings(options.subtitle, placeholder, value);
  }
  // The expanded chart itself goes onto a null prototype: the drift lints
  // read absent optional keys (options, annotations) off these objects, and
  // an ordinary literal would answer them from a polluted prototype chain.
  return Object.assign(Object.create(null) as ExpandedChart, {
    name,
    type: chart.type,
    data: ownedDocumentCopy(chart.data.bySlice[value]),
    ...(options ? { options } : {}),
    ...(chart.annotations ? { annotations: ownedDocumentCopy(chart.annotations) } : {}),
  });
}

function lintRepeatValues(repeats: RepeatChart[]): LintWarning[] {
  const byDimension = new Map<string, RepeatChart[]>();
  for (const chart of repeats) {
    const group = byDimension.get(chart.repeat.dimension) ?? [];
    group.push(chart);
    byDimension.set(chart.repeat.dimension, group);
  }

  const warnings: LintWarning[] = [];
  for (const [dimension, charts] of byDimension) {
    if (charts.length < 2) continue;
    const signatures = new Set(charts.map((chart) => JSON.stringify(chart.repeat.values)));
    if (signatures.size < 2) continue;
    warnings.push({
      code: 'facet-values-drift',
      severity: 'warn',
      message: `repeat charts ${quoteList(charts.map((chart) => chart.name))} use different ordered values for dimension '${dimension}'; align the lists or call out the missing facet explicitly`,
    });
  }
  return warnings;
}

function lintPaletteDrift(entries: ExpandedEntry[]): LintWarning[] {
  const byPalette = new Map<string, ExpandedEntry[]>();
  for (const entry of entries) {
    const palette = entry.chart.options?.palette;
    if (typeof palette !== 'string') continue;
    const group = byPalette.get(palette) ?? [];
    group.push(entry);
    byPalette.set(palette, group);
  }

  const warnings: LintWarning[] = [];
  for (const [palette, charts] of byPalette) {
    for (let left = 0; left < charts.length; left++) {
      const a = charts[left]!;
      const aSlots = paletteSlots(a.chart.data);
      if (aSlots.size === 0) continue;
      for (let right = left + 1; right < charts.length; right++) {
        const b = charts[right]!;
        const bSlots = paletteSlots(b.chart.data);
        const drifted = [...aSlots].flatMap(([seriesId, slot]) =>
          bSlots.has(seriesId) && bSlots.get(seriesId) !== slot ? [seriesId] : [],
        );
        if (drifted.length === 0) continue;
        warnings.push({
          code: 'facet-palette-drift',
          severity: 'warn',
          message: `charts '${a.chart.name}' and '${b.chart.name}' assign shared palette '${palette}' to series ${quoteList(drifted)} at different positions; keep series order consistent or set explicit color roles`,
        });
      }
    }
  }
  return warnings;
}

function paletteSlots(data: unknown): Map<string, number> {
  if (!isRecord(data) || !Array.isArray(data.series)) return new Map();
  const slots = new Map<string, number>();
  let slot = 0;
  for (const rawSeries of data.series) {
    if (!isRecord(rawSeries) || rawSeries.role === 'reference') continue;
    if (
      typeof rawSeries.id === 'string' &&
      rawSeries.fill === undefined &&
      rawSeries.colorRole === undefined &&
      rawSeries.scenario === undefined
    ) {
      slots.set(rawSeries.id, slot);
    }
    slot++;
  }
  return slots;
}

function lintScaleDrift(entries: ExpandedEntry[]): LintWarning[] {
  const groups = new Map<string, { label: string; entries: ExpandedEntry[] }>();
  for (const entry of entries) {
    if (entry.repeatOrigin) {
      addScaleGroup(groups, entry.repeatOrigin, entry.repeatLabel ?? entry.repeatOrigin, entry);
    }
    const scaleGroup = entry.chart.options?.scaleGroup;
    if (isRecord(scaleGroup) && typeof scaleGroup.y === 'string') {
      addScaleGroup(groups, `scale:${scaleGroup.y}`, `y scale group '${scaleGroup.y}'`, entry);
    }
  }

  const warnings: LintWarning[] = [];
  const warnedPairs = new Set<string>();
  for (const group of groups.values()) {
    for (let left = 0; left < group.entries.length; left++) {
      const a = group.entries[left]!;
      const aMagnitude = domainMagnitude(a.chart);
      if (aMagnitude === null) continue;
      for (let right = left + 1; right < group.entries.length; right++) {
        const b = group.entries[right]!;
        const bMagnitude = domainMagnitude(b.chart);
        if (bMagnitude === null) continue;
        const ratio = scaleRatio(aMagnitude, bMagnitude);
        if (!(ratio > 20)) continue;
        const pair = [a.index, b.index].sort((x, y) => x - y).join(':');
        if (warnedPairs.has(pair)) continue;
        warnedPairs.add(pair);
        const ratioText = Number.isFinite(ratio) ? `${roundRatio(ratio)}x` : 'more than 20x';
        const message = `charts '${a.chart.name}' and '${b.chart.name}' in ${group.label} have value domains that differ by ${ratioText}; use shared axis bounds or add an explicit callout so the scale difference cannot mislead`;
        warnings.push({
          code: 'facet-scale-drift',
          severity: 'warn',
          message,
          suggest: 'Use shared value-axis bounds or an explicit scale callout.',
        });
      }
    }
  }
  return warnings;
}

function addScaleGroup(
  groups: Map<string, { label: string; entries: ExpandedEntry[] }>,
  key: string,
  label: string,
  entry: ExpandedEntry,
): void {
  const group = groups.get(key) ?? { label, entries: [] };
  group.entries.push(entry);
  groups.set(key, group);
}

function domainMagnitude(chart: ExpandedChart): number | null {
  const values = yValues(chart.type, chart.data);
  if (values.length === 0) return null;
  return maxOf(values.map((value) => Math.abs(value)));
}

function yValues(type: string, data: unknown): number[] {
  if (!isRecord(data)) return [];
  if (Array.isArray(data.series)) {
    return data.series.flatMap((series) => {
      if (!isRecord(series) || series.role === 'reference' || !Array.isArray(series.values)) return [];
      return series.values.flatMap(numericCell);
    });
  }
  if ((type === 'scatter' || type === 'bubble') && Array.isArray(data.points)) {
    return data.points.flatMap((point) => (isRecord(point) ? numericCell(point.y) : []));
  }
  if (type === 'waterfall' || type === 'bridge') return waterfallDomainValues(data);
  if (Array.isArray(data.rows)) {
    return data.rows.flatMap((row) => (isRecord(row) ? numericCell(row.value) : []));
  }
  if (type === 'kpi') {
    return [
      ...numericCell(data.value),
      ...(isRecord(data.spark) && Array.isArray(data.spark.values)
        ? data.spark.values.flatMap(numericCell)
        : []),
    ];
  }
  return [];
}

function waterfallDomainValues(data: Record<string, unknown>): number[] {
  if (!Array.isArray(data.items)) return [];
  const values: number[] = [0];
  let running = 0;
  for (const item of data.items) {
    if (!isRecord(item)) continue;
    const segments = Array.isArray(item.segments)
      ? item.segments.flatMap((segment) => (isRecord(segment) ? numericCell(segment.value) : []))
      : [];
    const authored = numericCell(item.value);
    const delta = segments.length > 0 ? segments.reduce((sum, value) => sum + value, 0) : authored[0];
    if (item.type === 'subtotal' || item.type === 'total') {
      values.push(running);
    } else if (delta !== undefined) {
      running += delta;
      values.push(running);
    }
  }
  return values;
}

function numericCell(value: unknown): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (!isRecord(value)) return [];
  if (typeof value.number === 'number' && Number.isFinite(value.number)) return [value.number];
  if (typeof value.pct === 'number' && Number.isFinite(value.pct)) return [value.pct];
  if ('value' in value) return numericCell(value.value);
  return [];
}

function scaleRatio(a: number, b: number): number {
  const smaller = Math.min(a, b);
  const larger = Math.max(a, b);
  if (smaller === 0) return larger === 0 ? 1 : Number.POSITIVE_INFINITY;
  return larger / smaller;
}

function roundRatio(value: number): number {
  return Math.round(value * 10) / 10;
}

function substituteString(value: string, placeholder: string, replacement: string): string {
  return value.split(placeholder).join(replacement);
}

function substituteStrings(value: unknown, placeholder: string, replacement: string): unknown {
  if (typeof value === 'string') return substituteString(value, placeholder, replacement);
  if (Array.isArray(value)) return value.map((item) => substituteStrings(item, placeholder, replacement));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteStrings(item, placeholder, replacement)]),
    );
  }
  return value;
}

function quoteList(values: string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

function isExpandedChart(value: unknown): value is ExpandedChart {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    'data' in value
  );
}

