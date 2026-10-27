/**
 * The Claude Dashboard runtime: one chart type (column) on the engine's core
 * render path, for classic scripts that register on `window.Boardplot`.
 *
 * `render` follows the CLI's static render (src/cli/spec.ts, `resolveRequest`
 * and `drawn`): parse the document, validate the chart, resolve the request,
 * lay it out and serialize it. Before that it refuses what a dashboard wants
 * elsewhere: everything outside an allowlist of options and fields that print only the dataset's values, more than one series, a source line. It skips what only the CLI reports (the
 * document lints, the host font tables, size repairs). The chart modules do
 * not register themselves, so this entry registers the column definition as
 * a value, as the per-type React entries do (src/react/chartEntry.ts).
 */

import { columnDefinition } from '../../src/core/charts/column';
import { getChart, registerChart } from '../../src/core/registry';
import { linkStaticFooter } from '../../src/core/staticFooter';
import { linkThemeShapeRules } from '../../src/core/themeShapeRules';
import { parseDocumentInput, DocumentSchemaError } from '../../src/core/doc/document';
import { validateChartInput } from '../../src/core/doc/chartValidation';
import type { DocumentEnvelope } from '../../src/core/doc/document';
import { layoutResolvedRequest, resolveChartRequest } from '../../src/core/request';
import { requireGeometry } from '../../src/core/sizing';
import { renderSvg } from '../../src/core/svg/renderSvg';
import { resolvedPaintToken, resolveTheme, seriesColorIndex } from '../../src/core/theme';
import { sceneThemeBindings } from '../../src/core/repaintGeometry';
import { validateTheme, type ThemeUsage } from '../../src/core/themeRules';
import type { Annotation } from '../../src/core/types/annotations';
import type { Geometry, PaintToken } from '../../src/core/types/scene';
import type { Theme, ThemeRef } from '../../src/core/types/theme';
import { BOARDPLOT_VERSION } from '../../src/version';

export { specFromRows, InputError } from '../../src/rows';

// The CLI links the static footer and the patched-theme checks before layout
// (src/core/deferred): a dashboard draws statically and patches the theme.
linkStaticFooter();
linkThemeShapeRules();
if (!getChart(columnDefinition.type)?.dataSchema) registerChart(columnDefinition);

export const version = BOARDPLOT_VERSION;
export const types: readonly string[] = [columnDefinition.type];

export interface Finding { code: string; message: string; path?: string; severity?: string }

export interface RenderResult {
  ok: boolean;
  svg?: string;
  width?: number;
  height?: number;
  errors: Finding[];
  warnings: Finding[];
}

export interface RenderOptions {
  /** Suffix for every id in the SVG; unique per chart on the page (RenderSvgOptions.idScope). */
  idScope?: string;
}

const finding = (raw: { code?: string; message?: string; path?: string; severity?: string }): Finding => ({
  code: raw.code ?? 'render-error', message: raw.message ?? String(raw),
  ...(raw.path ? { path: raw.path } : {}), ...(raw.severity ? { severity: raw.severity } : {}),
});

/**
 * The theme roles a drawn chart paints, as the CLI collects them for its
 * theme check (src/cli/spec.ts `geometryThemeUsage`, without grid panels).
 */
function paintedRoles(geometry: Geometry, theme: Theme): ThemeUsage {
  const roles = new Set<string>(['background']);
  const visit = (value: unknown, seen: WeakSet<object>): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const object = value as Record<string, unknown>;
    const source = object.theme as Record<string, unknown> | undefined;
    if (typeof object.token === 'string' && source?.kind !== 'series' && source?.kind !== 'colorblind') {
      roles.add(object.token.replace(/^status-/, 'status.'));
      const token = resolvedPaintToken(theme, object.token as PaintToken);
      const series = /^series-(\d+)$/.exec(token);
      roles.add(series ? `series[${seriesColorIndex(theme, Number(series[1]) - 1)}]` : token.replace(/^status-/, 'status.'));
    }
    if (object.kind === 'series' && typeof object.index === 'number') {
      roles.add(`series[${seriesColorIndex(theme, object.index)}]`);
      if (object.scenario) roles.add(`scenario.${object.scenario}`);
    }
    if (object.kind === 'colorblind' && typeof object.role === 'string') roles.add(`colorblind.${object.role}`);
    for (const child of Object.values(object)) visit(child, seen);
  };
  const bindings = sceneThemeBindings(geometry);
  for (const node of geometry.scene) {
    if (bindings.some((binding) => node.id.startsWith(binding.prefix))) continue;
    const seen = new WeakSet<object>();
    if ('fill' in node) visit(node.fill, seen);
    if ('stroke' in node) visit(node.stroke, seen);
    if (node.t === 'text') visit(node.ink, seen);
    if (node.t === 'rect') visit(node.hatchGround, seen);
  }
  return { roles, types: new Set([geometry.type]) };
}

/**
 * The colour findings that a `{ preset, overrides }` theme adds to its
 * preset, for the roles this chart paints when drawn with it: the CLI's
 * `judgeTheme` rule. Each finding keeps its severity.
 */
export function themeFindings(ref: unknown, spec: unknown): Finding[] {
  if (ref === null || typeof ref !== 'object' || !Object.hasOwn(ref, 'preset')) return [];
  const laid = layout(withTheme(spec, ref));
  if ('errors' in laid) return [];
  const resolved = resolveTheme(ref as ThemeRef);
  const usage = paintedRoles(laid.geo, resolved);
  const key = (warning: { code: string; message: string }) => `${warning.code}\0${warning.message}`;
  const inherited = new Set(validateTheme(resolveTheme((ref as { preset: string }).preset), usage).map(key));
  return validateTheme(resolved, usage).filter((warning) => !inherited.has(key(warning))).map(finding);
}

function withTheme(spec: unknown, theme: unknown): unknown {
  const chart = spec as { options?: Record<string, unknown> };
  return { ...chart, options: { ...(chart.options ?? {}), theme } };
}

/**
 * What this one-type runtime accepts: the options, variants and data fields
 * that print only values the dataset holds. Everything else is refused, so a
 * chart never prints a number (a total, a share, a weighted summary, a rate)
 * that the dashboard's marks cannot trace to a cell. A dashboard wants such
 * numbers from the dataset's SQL or a `dash.calc`, where readers can inspect
 * them. `true` accepts any value; an array lists the accepted values; an
 * object lists the accepted keys; `{ each }` applies to every array item.
 */
type Allow = true | readonly unknown[] | { readonly each: Allow } | { readonly [key: string]: Allow };
const CELL_FIELDS: Allow = { number: true, pct: true, fill: true, format: true, priority: true, footnote: true, scenario: true, label: [false] };
const ALLOWED: { readonly [key: string]: Allow } = {
  name: true,
  type: ['column'],
  data: {
    categories: { each: { id: true, label: true, date: true, gapAfter: true, breakAfter: true, partial: true, footnote: true } },
    series: { each: { id: true, label: true, values: { each: CELL_FIELDS }, unit: true, format: true, fill: true, colorRole: true, direction: true, scenario: true, role: ['data'] } },
  },
  options: {
    variant: ['grouped'], title: true, subtitle: true, unit: true, unitShown: true, format: true, locale: true, theme: true,
    size: true, target: true, mode: true, belowMinimum: true, textScale: true, textSize: true, margin: true, footnotes: true,
    labelDensity: true, valueLabels: true, legend: true, axisTitles: true, palette: true, highlight: true, colorblindSafe: true,
    signColor: true, seriesRamp: true, othersShade: true, hatchStrength: true, bandFraction: true, smallValues: true,
    sort: { categories: true },
    valueAxis: { show: true, min: true, max: true, tickStep: true, includeZero: true, gridlines: true, break: true },
  },
};

/** The path of the first value `allow` does not accept, or undefined. */
function refusedPath(value: unknown, allow: Allow, path: string): string | undefined {
  if (allow === true || value === undefined) return undefined;
  if (Array.isArray(allow)) return allow.includes(value) ? undefined : path;
  if ('each' in allow && Object.keys(allow).length === 1) {
    if (!Array.isArray(value)) return refusedPath(value, (allow as { each: Allow }).each, path);
    for (const [index, item] of value.entries()) {
      const refused = refusedPath(item, (allow as { each: Allow }).each, `${path}/${index}`);
      if (refused) return refused;
    }
    return undefined;
  }
  // A cell may be a number or null, and a keyed cell wraps one in `value`.
  if (value === null || typeof value !== 'object') return undefined;
  const object = value as Record<string, unknown>;
  if (allow === CELL_FIELDS && 'categoryId' in object) {
    const { categoryId: _id, value: inner, ...rest } = object;
    return Object.keys(rest).length ? `${path}/${Object.keys(rest)[0]}` : refusedPath(inner, allow, `${path}/value`);
  }
  for (const key of Object.keys(object)) {
    const rule = (allow as Record<string, Allow>)[key];
    if (rule === undefined) return `${path}/${key}`;
    const refused = refusedPath(object[key], rule, `${path}/${key}`);
    if (refused) return refused;
  }
  return undefined;
}

/** Why the dashboard runtime refuses this chart, or undefined. */
function dashboardRefusal(chart: { options?: Record<string, unknown>; data?: unknown }): Finding | undefined {
  if (chart.options?.source !== undefined) {
    return { code: 'dashboard-source-line', path: '/options/source', message: "options.source draws a source line; the dashboard's Sources shows the source" };
  }
  const series = (chart.data as { series?: unknown[] } | undefined)?.series;
  if (Array.isArray(series) && series.length > 1) {
    return { code: 'dashboard-one-series', path: '/data/series',
      message: 'the dashboard runtime draws one series: with more, the chart prints per-category totals it computes' };
  }
  const path = refusedPath(chart, ALLOWED, '');
  if (path) {
    const name = path.slice(1).replace(/\/\d+(?=\/|$)/g, '[]').replace(/\//g, '.');
    return { code: 'dashboard-computed-number', path,
      message: `${name} is outside the options and fields that print only the dataset's values; in a dashboard, compute such numbers in the dataset's SQL or a dash.calc` };
  }
  return undefined;
}

/** Parse, check, validate, resolve and lay out a one-chart spec; findings instead of a throw. */
function layout(spec: unknown): { geo: Geometry; options: Record<string, unknown>; warnings: Finding[] } | { errors: Finding[]; warnings: Finding[] } {
  try {
    const { doc, envelope } = parseDocumentInput(spec) as { doc: Parameters<typeof validateChartInput>[0]; envelope: DocumentEnvelope };
    const chart = doc.charts[0];
    if (!chart || doc.charts.length !== 1) return { errors: [{ code: 'one-chart', message: 'render takes one chart' }], warnings: [] };
    const refusal = dashboardRefusal(chart as { options?: Record<string, unknown>; data?: unknown });
    if (refusal) return { errors: [refusal], warnings: [] };
    const validated = validateChartInput(doc, chart, envelope);
    if (!validated) return { errors: envelope.errors.map(finding), warnings: envelope.warnings.map(finding) };
    const request = resolveChartRequest({
      type: validated.definition.type, data: validated.data, options: validated.options as never,
      annotations: validated.chart.annotations as Annotation[] | undefined,
    }, { theme: doc.theme, locale: typeof doc.locale === 'string' ? doc.locale : undefined });
    const geo = requireGeometry(layoutResolvedRequest(request)) as Geometry;
    return { geo, options: request.options as Record<string, unknown>, warnings: [...envelope.warnings, ...geo.warnings].map(finding) };
  } catch (error) {
    if (error instanceof DocumentSchemaError) return { errors: error.envelopeErrors.map(finding), warnings: [] };
    return { errors: [finding(error as Finding)], warnings: [] };
  }
}

/** A one-chart spec (as the CLI takes it) to SVG. Never throws. */
export function render(spec: unknown, options: RenderOptions = {}): RenderResult {
  const laid = layout(spec);
  if ('errors' in laid) return { ok: false, errors: laid.errors, warnings: laid.warnings };
  try {
    const theme = resolveTheme((laid.options as { theme?: ThemeRef }).theme);
    const svg = renderSvg(laid.geo, theme, { interactive: false, ...(options.idScope ? { idScope: options.idScope } : {}) });
    return { ok: true, svg, width: laid.geo.size.width, height: laid.geo.size.height, errors: [], warnings: laid.warnings };
  } catch (error) {
    return { ok: false, errors: [finding(error as Finding)], warnings: [] };
  }
}
