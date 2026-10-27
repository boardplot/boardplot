/**
 * The one spec every verb reads: a bare chart or an envelope,
 * passed as an object. Loads it, lays each chart out through the one boundary
 * every verb shares, and collects the findings in the document-finding shape.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { isatty } from 'node:tty';
import { isDeepStrictEqual } from 'node:util';
import '../core/charts';
import { requireGeometry, VERIFY_ADVICE, verifiedSizeRepair } from '../core/sizing';
import { layoutResolvedRequest, measureLayout, resolveChartRequest, type ChartMeasurement } from '../core/request';
import { completeChartDiagnostic, completeDiagnostic, completeDocumentDiagnostic, type DocumentFinding } from '../core/doc/diagnostics';
import {
  bareFinding, DocumentSchemaError, isBareChart, parseDocumentInput,
  type DocChart, type DocumentEnvelope, type BoardplotDoc,
} from '../core/doc/document';
import { gridPanelOptionTargets, validateChartInput } from '../core/doc/chartValidation';
import { resolveSharedScale } from '../core/grid/sharedScale';
import { ownedDocumentCopy } from '../core/doc/docExpand';
import { resolveTheme, resolvedPaintToken, seriesColorIndex } from '../core/theme';
import { sceneThemeBindings } from '../core/repaintGeometry';
import type { GridMarks } from '../core/grid/layoutGrid';
import { validateTheme, type ThemeUsage } from '../core/themeRules';
import { activeFontTables, activeMeasurer } from './activeFontTables';
import { renderSvg, XmlCharError } from '../core/svg/renderSvg';
import { claimsForChart } from '../core/claims';
import { adoptThemeObject, isThemeObject, rootContextErrors } from '../core/doc/themeObject';
import { lintCodes, runDocAdvice, runDocLints } from '../core/lint';
import { isRecord } from '../core/lint/shared';
import { aspectDocLints } from '../core/lint/aspect';
import { spaceDocLints } from '../core/lint/space';
import { typeDocLints } from '../core/lint/type';
import { lineIntegrityDocLints } from '../core/lint/lineIntegrity';
import { shareUnitLints, unitInFormatLints, unitNotShownLints } from '../core/frame';
import { unscaledFormatLint } from '../core/formatSpec';
import { chartRefusals } from '../core/schema/refusals';
import type { Annotation } from '../core/types/annotations';
import type { RenderTarget } from '../core/types/options';
import type { Theme, ThemeRef } from '../core/types/theme';
import type { Geometry, LintWarning, PaintToken, PlacedLabel } from '../core/types/scene';
import type { JsonPatchOperation } from '../core/diagnostics/jsonPatch';
import { InputError } from './result';
import { assertSpecObject } from '../core/inputError';
import { pushAll } from '../core/arrays';

interface LoadedSpec {
  doc: BoardplotDoc;
  envelope: DocumentEnvelope;
  /** The caller sent a bare chart: findings point into it, not into an envelope. */
  bare: boolean;
}

export { assertSpecObject };

/** Read a spec file (or `-` for stdin) for the CLI. */
export function readSpecFile(path: string | undefined): unknown {
  if (!path) throw new InputError('missing-spec', 'pass the spec file path, or - to read the spec from stdin');
  let raw: string;
  // Nothing piped: say what the wait is for, on stderr so stdout stays the output.
  // isatty(0), not process.stdin.isTTY: that getter makes fd 0 non-blocking and the read fails with EAGAIN.
  if (path === '-' && isatty(0)) process.stderr.write('Reading the spec from stdin (end with Ctrl-D).\n');
  try {
    raw = path === '-' ? readFileSync(0, 'utf8') : readFileSync(realpathSync(resolve(path)), 'utf8');
  } catch (error) {
    throw new InputError('spec-unreadable', `cannot read ${path}: ${error instanceof Error ? error.message : error}`);
  }
  try {
    // A Windows editor may lead the file with a byte order mark; JSON.parse does not skip it.
    return ownedDocumentCopy(JSON.parse(raw.replace(/^\uFEFF/, '')));
  } catch (error) {
    throw new InputError('invalid-json', `${path} is not valid JSON: ${error instanceof Error ? error.message : error}`, {
      suggest: 'Write the spec as one JSON object.',
    });
  }
}

/** Families the host passed tables for (`--font-tables`, `BOARDPLOT_FONT_TABLES`): the theme check does not warn about them. */
function passedFamilies(): readonly string[] | undefined {
  return activeFontTables()?.families;
}

/** The options with the host's table measurer, when the host passed tables, or the measurer a render format set. */
function withHostMeasure<T extends object | undefined>(options: T): T {
  const measure = activeMeasurer();
  return (measure ? { ...options, measure } : options) as T;
}

/** A root theme given as a full token object is adopted under its own name (core/doc/themeObject). */
/** Returns true when the root theme was a theme object, which adoption has already judged. */
function registerThemeObject(doc: BoardplotDoc, envelope: DocumentEnvelope): boolean {
  if (!isThemeObject(doc.theme)) return false;
  const adopted = adoptThemeObject(doc.theme, (theme) => validateTheme(theme,
    themeUsage(doc, doc.charts.filter((chart) => chart.options?.theme === undefined), theme), passedFamilies()));
  if (!adopted.ok) {
    throw new InputError(adopted.code, adopted.message, { path: '/theme', suggest: adopted.suggest, fix: adopted.fix, docs: 'docs/reference/theme.md#theme' });
  }
  // Warnings travel with the drawing, as they do for { preset, overrides }.
  pushAll(envelope.warnings, adopted.warnings.map((warning) =>
    completeDiagnostic(warning, doc, ['theme'], 'docs/reference/theme.md#theme')));
  doc.theme = adopted.ref;
  return true;
}

/**
 * A theme given as `{ preset, overrides }` is judged by the same rules as a
 * theme file: a contrast or separation error the overrides
 * add refuses the spec, a warning they add travels with the drawing. A
 * preset name, and what the preset carries under overrides, is judged once,
 * by the preset tests.
 */
function judgeTheme(doc: BoardplotDoc, ref: unknown, segments: (string | number)[], envelope: DocumentEnvelope, charts: DocChart[], geometry?: Geometry): DocumentFinding[] {
  if (ref === null || typeof ref !== 'object' || !Object.hasOwn(ref, 'preset')) return [];
  let resolved: ReturnType<typeof resolveTheme>;
  let base: ReturnType<typeof resolveTheme>;
  try {
    resolved = resolveTheme(ref as ThemeRef);
    base = resolveTheme((ref as { preset: string }).preset);
  } catch {
    return []; // chart validation reports an unknown preset or a malformed override at its own path
  }
  // Resolution validates the override first. Unchanged branches retain their
  // identity, so this exact check skips them without serializing either theme.
  if (isDeepStrictEqual(resolved, base)) return [];
  // Only what the overrides add: a finding the preset carries by itself is
  // the preset validation's, and a spec that pins it should not repeat it.
  const key = (warning: { code: string; message: string }) => `${warning.code}\0${warning.message}`;
  const usage = geometry ? geometryThemeUsage(geometry, resolved) : themeUsage(doc, charts, resolved);
  const inherited = new Set(validateTheme(base, usage, passedFamilies()).map(key));
  const findings = validateTheme(resolved, usage, passedFamilies()).filter((warning) => !inherited.has(key(warning))).map((warning) => completeDiagnostic({
    ...warning, suggest: warning.suggest ?? 'Change the theme token the message names.',
  }, doc, segments, 'docs/reference/theme.md#theme'));
  pushAll(envelope.warnings, findings.filter((finding) => finding.severity !== 'error'));
  return findings.filter((finding) => finding.severity === 'error');
}

function judgeThemes(doc: BoardplotDoc, envelope: DocumentEnvelope, rootJudged: boolean): DocumentFinding[] {
  const panelFindings: DocumentFinding[] = [];
  const warningStart = envelope.warnings.length;
  const panels = (geometry: Geometry, data: unknown, path: (string | number)[]): void => {
    if (geometry.type !== 'grid') return;
    const input = data as { panels?: { id: string; data: unknown }[]; template?: { data: unknown } };
    for (const panel of (geometry.marks as unknown as GridMarks).panels) {
      if (!panel.chart) continue;
      const index = input.panels?.findIndex(item => item.id === panel.id) ?? -1;
      const panelPath = index >= 0 ? [...path, 'data', 'panels', index] : [...path, 'data', 'template'];
      if (panel.chart.theme) {
        pushAll(panelFindings, judgeTheme(doc, panel.chart.theme, [...panelPath, 'options', 'theme'], envelope, [], panel.chart.geometry));
      }
      panels(panel.chart.geometry, index >= 0 ? input.panels![index]!.data : input.template?.data, panelPath);
    }
  };
  for (const [index, chart] of doc.charts.entries()) {
    if (!gridPanelOptionTargets(chart.type, chart.data, '').some(panel => panel.options.theme !== undefined)) continue;
    try {
      const geometry = themeGeometry(doc, chart, resolveTheme((chart.options?.theme ?? doc.theme) as ThemeRef | undefined));
      if (geometry) panels(geometry, chart.data, ['charts', index]);
    } catch { /* The normal input/layout boundary reports this refusal. */ }
  }
  // Repeated panels share one authored template. Keep each distinct finding
  // at that source path once, including warnings added by judgeTheme.
  const seen = new Set<string>();
  const panelWarnings = envelope.warnings.slice(warningStart).filter(finding => {
    const key = JSON.stringify([finding.path, finding.code, finding.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  envelope.warnings.length = warningStart;
  pushAll(envelope.warnings, panelWarnings);
  return [
    ...(rootJudged ? [] : judgeTheme(doc, doc.theme, ['theme'], envelope, doc.charts.filter((chart) => chart.options?.theme === undefined))),
    ...doc.charts.flatMap((chart, index) => judgeTheme(doc, chart.options?.theme, ['charts', index, 'options', 'theme'], envelope, [chart])),
    ...panelFindings.filter((finding, index, all) => all.findIndex(other => other.path === finding.path && other.code === finding.code && other.message === finding.message) === index),
  ];
}

/** Read roles from layout paints, including their symbolic palette sources. No chart-role registry. */
function geometryThemeUsage(geometry: Geometry, theme: Theme): ThemeUsage {
  const roles = new Set<string>(['background']);
  const types = new Set<string>();
  let visited = new WeakSet<object>();
  const series = new Map<string, Set<string>>();
  let seriesId: string | undefined;
  const role = (key: string) => {
    roles.add(key);
    if (seriesId) {
      const names = series.get(key) ?? new Set<string>();
      names.add(seriesId); series.set(key, names);
    }
  };
  const add = (token: string) => {
    role(token.replace(/^status-/, 'status.'));
    token = resolvedPaintToken(theme, token as PaintToken);
    const series = /^series-(\d+)$/.exec(token);
    role(series ? `series[${seriesColorIndex(theme, Number(series[1]) - 1)}]` : token.replace(/^status-/, 'status.'));
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    const object = value as Record<string, unknown>;
    if (typeof object.type === 'string') types.add(object.type);
    const source = object.theme as Record<string, unknown> | undefined;
    if (typeof object.token === 'string' && source?.kind !== 'series' && source?.kind !== 'colorblind') add(object.token);
    if (object.kind === 'series' && typeof object.index === 'number') {
      const palette = typeof object.palette === 'string' ? object.palette : undefined;
      const ramp = palette === undefined ? undefined : theme.color.palettes?.[palette];
      const index = seriesColorIndex(theme, object.index, ramp);
      roles.add(ramp?.length ? `palettes.${palette}[${index}]` : `series[${index}]`);
      if (object.scenario) roles.add(`scenario.${object.scenario}`);
    }
    if (object.kind === 'colorblind' && typeof object.role === 'string') roles.add(`colorblind.${object.role}`);
    for (const child of Object.values(object)) visit(child);
  };
  const bindings = sceneThemeBindings(geometry);
  for (const node of geometry.scene) {
    if (bindings.some(binding => node.id.startsWith(binding.prefix))) continue;
    visited = new WeakSet<object>();
    seriesId = node.owner?.seriesId;
    if ('fill' in node) visit(node.fill);
    if ('stroke' in node) visit(node.stroke);
    if (node.t === 'text') visit(node.ink);
    if (node.t === 'rect') visit(node.hatchGround);
  }
  const addTypes = (current: Geometry): void => {
    types.add(current.type);
    if (current.type !== 'grid') return;
    for (const panel of (current.marks as unknown as GridMarks).panels) {
      if (panel.chart && !panel.chart.theme) addTypes(panel.chart.geometry);
    }
  };
  addTypes(geometry);
  return { roles, types, series };
}

function themeGeometry(doc: BoardplotDoc, chart: DocChart, theme: Theme): Geometry | null | undefined {
  const probe = { ...chart, options: { ...chart.options, theme: { preset: 'standard', overrides: theme } } };
  const valid = validateChartInput({ ...doc, theme: 'standard' }, probe, { ok: true, errors: [], warnings: [] });
  if (!valid) return undefined;
  const request = resolveChartRequest({ type: valid.definition.type, data: valid.data, options: withHostMeasure(valid.options), annotations: valid.chart.annotations as Annotation[] | undefined });
  const layout = layoutResolvedRequest(request);
  // A chart too small to draw paints no roles. Its colours are judged once it draws; until then
  // the size refusal is the finding. Null: skip, unlike undefined (judge every pair).
  if (layout.refused && layout.warnings[0]?.code === 'size-below-floor') return null;
  return requireGeometry(layout);
}

function themeUsage(doc: BoardplotDoc, charts: DocChart[], theme: Theme): ThemeUsage | undefined {
  const roles = new Set<string>(['background']);
  const types = new Set<string>();
  const series = new Map<string, Set<string>>();
  for (const chart of charts) {
    try {
      const geometry = themeGeometry(doc, chart, theme);
      if (geometry === null) continue;
      if (!geometry) continue;
      const usage = geometryThemeUsage(geometry, theme);
      for (const role of usage.roles) roles.add(role);
      for (const type of usage.types) types.add(type);
      for (const [role, names] of usage.series ?? []) {
        const all = series.get(role) ?? new Set<string>();
        for (const name of names) all.add(name);
        series.set(role, all);
      }
    } catch {
      // The normal input/layout boundary reports the cause. Failed layouts paint no roles.
      continue;
    }
  }
  return { roles, types, series };
}

/** Parse the spec, or return the findings that refuse it. */
export function loadSpec(spec: unknown): LoadedSpec | { errors: DocumentFinding[]; bare: boolean } {
  assertSpecObject(spec);
  const bare = isBareChart(spec);
  try {
    const { doc, envelope } = parseDocumentInput(ownedDocumentCopy(spec));
    const rootJudged = registerThemeObject(doc, envelope);
    const rootErrors = rootContextErrors(doc).map((finding) => completeDiagnostic(finding, doc));
    if (rootErrors.length) return { errors: rootErrors, bare };
    const themeErrors = judgeThemes(doc, envelope, rootJudged);
    if (themeErrors.length) return { errors: themeErrors, bare };
    return { doc, envelope, bare };
  } catch (error) {
    if (error instanceof DocumentSchemaError) return { errors: error.envelopeErrors, bare };
    throw error;
  }
}

/**
 * `scaleGroup.y` across the charts of one envelope: the charts that name the
 * same group draw on one shared domain, resolved by the coordinator the grid
 * and React use. A member it cannot pin refuses the call by name, since a
 * chart that keeps its own scale would look shared and not be. A bare chart,
 * or the only chart of its group, has no peers here; the host's ScaleGroup
 * shares it.
 */
export function shareScaleGroups({ doc, envelope, bare }: LoadedSpec): void {
  if (bare) return;
  const groups = new Map<string, DocChart[]>();
  for (const chart of doc.charts) {
    const group = (chart.options?.scaleGroup as { y?: unknown } | undefined)?.y;
    if (typeof group === 'string') groups.set(group, [...(groups.get(group) ?? []), chart]);
  }
  for (const [group, charts] of groups) {
    // One chart in the group shares with nothing here; the host may share it.
    if (charts.length < 2) continue;
    // Validated copies: the probe lays out normalized data. An invalid member
    // is reported by its own layout pass, so the group waits for the fix.
    const scratch: DocumentEnvelope = { ok: true, errors: [], warnings: [] };
    const members = charts.map((chart) => ({ chart, valid: validateChartInput(doc, chart, scratch) }));
    if (members.some((member) => !member.valid)) continue;
    const plan = resolveSharedScale(group, members.map(({ chart, valid }) => ({
      id: chart.name, type: valid!.definition.type, data: valid!.data, options: valid!.options,
      ...(chart.annotations ? { annotations: chart.annotations } : {}),
    })));
    for (const refusal of plan.refusals) {
      for (const chart of charts.filter((candidate) => refusal.memberId === null || candidate.name === refusal.memberId)) {
        envelope.errors.push(completeChartDiagnostic(doc, chart, {
          code: refusal.code,
          message: `chart '${chart.name}': ${refusal.message}`,
          suggest: `Remove scaleGroup from '${chart.name}' so it keeps its own scale, or change what the message names.`,
          field: ['options', 'scaleGroup', 'y'],
          fix: [{ op: 'remove', path: '/options/scaleGroup' }],
        }));
      }
    }
    if (plan.refusals.length) continue;
    for (const pin of plan.members) {
      const chart = charts.find((candidate) => candidate.name === pin.id)!;
      chart.options = { ...chart.options, valueAxis: pin.options.valueAxis };
    }
  }
}

/** Findings as the caller sent the spec: bare paths for a bare chart. */
export function asSent<T extends DocumentFinding>(findings: readonly T[], bare: boolean): T[] {
  return bare ? findings.map((finding) => bareFinding(finding)) : [...findings];
}

function hiddenLabelId(label: PlacedLabel): string {
  if (label.kind === 'category' && label.owner.categoryId) return label.owner.categoryId;
  if (label.kind === 'series' && label.owner.seriesId) return label.owner.seriesId;
  if (label.kind === 'segment' && label.owner.segmentId) return label.owner.segmentId;
  if (label.kind === 'point' && label.owner.pointId) return label.owner.pointId;
  return label.id;
}

/** Collapse solver noise only in the public envelope. Geometry remains unchanged. */
function collapseLabelHiddenWarnings(geo: Geometry, warnings: readonly LintWarning[]): LintWarning[] {
  const passthrough: LintWarning[] = [];
  const groups = new Map<string, { kind: string; seriesId?: string; labels: PlacedLabel[]; warnings: LintWarning[] }>();
  const labelsById = new Map(geo.labels.map((label) => [label.id, label]));
  for (const warning of warnings) {
    const id = warning.code === 'label-hidden' ? /^label '([^']+)'/.exec(warning.message)?.[1] : undefined;
    const label = id ? labelsById.get(id) : undefined;
    if (!label) {
      passthrough.push(warning);
      continue;
    }
    const seriesId = label.owner.seriesId;
    const key = `${label.kind}\0${seriesId ?? ''}`;
    const group = groups.get(key) ?? { kind: label.kind, ...(seriesId ? { seriesId } : {}), labels: [], warnings: [] };
    group.labels.push(label);
    group.warnings.push(warning);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    // The note pass may hide labels placed by the last solver run. Count the
    // final scene, as reading.omissions does, rather than an earlier warning list.
    const hidden = geo.labels.filter(label => label.hidden !== undefined &&
      label.kind === group.kind && label.owner.seriesId === group.seriesId).map(hiddenLabelId);
    const total = geo.labels.filter((label) => label.kind === group.kind && label.owner.seriesId === group.seriesId).length;
    const shown = hidden.slice(0, 5);
    const suffix = hidden.length > shown.length ? ', ...' : '';
    passthrough.push({
      code: 'label-hidden',
      severity: group.warnings.some((warning) => warning.severity === 'warn') ? 'warn' : 'info',
      message: `${group.kind} labels: ${hidden.length} of ${total} hidden (${shown.join(', ')}${suffix})`,
      ...(group.seriesId ? { owner: { seriesId: group.seriesId } } : {}),
      detail: { kind: group.kind, ...(group.seriesId ? { seriesId: group.seriesId } : {}), hidden, total },
    });
  }
  return passthrough;
}

/**
 * unit-not-shown for every grid panel: each panel's own options
 * against its own text (its scene and the caption the grid prints for it),
 * so another panel's unit never counts. The finding points at the authored
 * panel, or at the repeat template that made it; nested grids recurse.
 */
function panelUnitLints(data: unknown, geo: Geometry, base: (string | number)[] = ['data']): LintWarning[] {
  const panels = geo.type === 'grid' ? (geo.marks as unknown as GridMarks | undefined)?.panels ?? [] : [];
  const authored = isRecord(data) && Array.isArray(data.panels) ? data.panels : undefined;
  const owns = (nodeId: string, panelId: string) => nodeId.startsWith(`${panelId}/`) || nodeId.includes(`panel:${panelId}:`);
  return panels.flatMap((panel) => {
    if (!panel.chart) return [];
    const index = authored?.findIndex((item) => isRecord(item) && item.id === panel.id) ?? -1;
    const own = index >= 0 ? [...base, 'panels', index] : [...base, 'template'];
    const child = panel.chart.geometry;
    // The panel's own text, its title and caption, and the grid's own title,
    // subtitle and notes; never another panel's text.
    const scene = geo.scene.filter((node) => owns(node.id, panel.id) || !panels.some((other) => owns(node.id, other.id)));
    return [
      ...unitNotShownLints(panel.chart.options as Record<string, unknown>, { type: child.type, scene, warnings: child.warnings })
        .map((warning) => ({ ...warning, message: `[${panel.id}] ${warning.message}`, field: [...own, 'options', 'unit'] })),
      ...unitInFormatLints(panel.chart.options as Record<string, unknown>, own)
        .map((warning) => ({ ...warning, message: `[${panel.id}] ${warning.message}` })),
      ...panelUnitLints(index >= 0 ? (authored![index] as Record<string, unknown>).data : undefined, child, [...own, 'data']),
    ];
  });
}

/** The document-boundary norm lints: warnings about proportions and embed legibility. */
function normLints(type: string, options: Record<string, unknown>, geo: Geometry, data?: unknown): LintWarning[] {
  // Each family stands down behind any refusal already on the geometry, so a
  // refused chart gets one trace naming the real cause. They run here,
  // not inside layout, because grid panels lay out on slot-sized canvases.
  const found = [...aspectDocLints(type, options, geo as never)];
  pushAll(geo.warnings, found);
  const rest = [
    ...spaceDocLints(type, options, geo as never),
    ...typeDocLints(type, options, geo as never),
    ...lineIntegrityDocLints(type, options, geo as never),
    ...unitNotShownLints(options, geo),
    ...shareUnitLints(options, geo),
    ...unitInFormatLints(options),
    ...unscaledFormatLint(options, data, geo),
    ...panelUnitLints(data, geo),
  ];
  pushAll(geo.warnings, rest);
  return geo.warnings;
}

function layoutFailure(chart: DocChart, error: unknown): DocumentFinding {
  if (process.env.BOARDPLOT_DEBUG_STACK === '1') console.error((error as Error).stack);
  const failure = error as {
    code?: string; path?: string; message: string; suggest?: string;
    fix?: JsonPatchOperation[]; segments?: readonly (string | number)[];
    expected?: DocumentFinding['expected'];
  };
  // A display path like `series[revenue].values` is not a pointer; only the
  // segments a refusal carries, or a plain dotted path, name a real field.
  const field = failure.segments ?? (failure.path && !/[[\]]/.test(failure.path) ? failure.path.split('.') : undefined);
  return {
    code: failure.code ?? 'layout-error',
    message: failure.message,
    path: `charts[${chart.name}]${failure.path ? `.${failure.path}` : ''}`,
    ...(failure.suggest ? { suggest: failure.suggest } : {}),
    ...(field ? { field } : {}),
    ...(failure.fix ? { fix: failure.fix } : {}),
    ...(failure.expected ? { expected: failure.expected } : {}),
  };
}

/** `target` is the caller's argument: it beats the chart's options.target. */
function resolveRequest(doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope, target?: RenderTarget) {
  const validated = validateChartInput(doc, chart, envelope);
  if (!validated) return null;
  const request = resolveChartRequest({
    type: validated.definition.type, data: validated.data, options: withHostMeasure(validated.options),
    annotations: validated.chart.annotations as Annotation[] | undefined,
    ...(target === undefined ? {} : { target }),
  }, { theme: doc.theme, locale: typeof doc.locale === 'string' ? doc.locale : undefined });
  return { validated, request };
}

/** What the CLI render adds to the serializer: the id scope and a transparent canvas. */
interface SvgWriteOptions { idScope?: string; background?: false }

function drawn(doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope, write: SvgWriteOptions = {}, target?: RenderTarget) {
  const resolved = resolveRequest(doc, chart, envelope, target);
  if (!resolved) return null;
  return judged(chart, resolved, requireGeometry(layoutResolvedRequest(resolved.request)) as Geometry, envelope, true, write);
}

/**
 * The refusal path render and measure share, so measure never answers ok for
 * a spec render refuses: the chart is serialized once, here, and a
 * serializer refusal or a lint the layout declares severity 'error' becomes an
 * error and nothing is drawn. Render keeps the SVG; measure keeps only the
 * verdict and its own warnings.
 */
function judged(
  chart: DocChart,
  { validated, request }: NonNullable<ReturnType<typeof resolveRequest>>,
  geo: Geometry,
  envelope: DocumentEnvelope,
  reportWarnings: boolean,
  write: SvgWriteOptions = {},
) {
  const def = validated.definition;
  const options = request.options as Record<string, unknown>;
  // Claims are keyed by the canonical type: an alias would miss its extractor.
  const claims = claimsForChart(def.type, geo as never);
  const theme = resolveTheme((options as { theme?: ThemeRef }).theme);
  let svg: string;
  try {
    svg = renderSvg(geo, theme, { interactive: options.interactive === true, claims, ...write });
  } catch (error) {
    // The serializer refuses what it cannot write safely: a string XML 1.0
    // cannot represent, a paint value that is not a colour. That is the
    // spec's fault, not the engine's.
    const message = error instanceof Error ? error.message : String(error);
    envelope.errors.push(error instanceof XmlCharError
      ? { code: 'unrepresentable-text', message: `chart '${chart.name}': ${message}`, path: `charts[${chart.name}]` }
      : {
          code: (error as { code?: string }).code ?? 'unserializable-chart',
          message: `chart '${chart.name}': ${message}`,
          path: `charts[${chart.name}]`,
          suggest: 'Correct the value the message names.',
        });
    return null;
  }
  const warnings = normLints(def.type, options, geo, validated.data);
  // The refusal path React shares (core/schema/refusals): what refuses here
  // draws the error card there, with the same message.
  const refusals = chartRefusals(warnings);
  if (reportWarnings) {
    pushAll(envelope.warnings, collapseLabelHiddenWarnings(geo, warnings.filter((warning) => warning.severity !== 'error')));
  }
  for (const refusal of refusals) {
    envelope.errors.push({
      code: refusal.code,
      message: `chart '${chart.name}': ${refusal.message}`,
      path: `charts[${chart.name}]`,
      ...(refusal.suggest ? { suggest: refusal.suggest } : {}),
      ...(refusal.field ? { field: refusal.field, displayPath: `charts[${chart.name}].${refusal.field.join('.')}` } : {}),
      ...(refusal.fix ? { fix: refusal.fix } : {}),
    });
  }
  if (refusals.length) return null;
  return { def, geo, options, claims, request, svg, fontFamily: theme.type.family };
}

export type DrawnChart = NonNullable<ReturnType<typeof drawn>>;

/** Measurement verifies drawing and size codes. Data and proportion warnings do not reject a size. */
function verifySizeAdvice(doc: BoardplotDoc, chart: DocChart, findings: DocumentFinding[], target?: RenderTarget): void {
  for (const finding of findings) {
    const operation = finding.fix?.find(op => op.op !== 'test' && op.path.endsWith('/options/size'));
    if (!operation || !('value' in operation)) continue;
    const value = operation.value as { width: number; height: number; unit?: string };
    const repair = verifiedSizeRepair(value, size => {
      const scratch: DocumentEnvelope = { ok: true, errors: [], warnings: [] };
      try {
        return drawn(doc, { ...chart, options: { ...chart.options, size: { ...value, ...size } } }, scratch, {}, target) !== null
          && scratch.errors.length === 0 && !scratch.warnings.some(w => w.code === finding.code
            || w.code === 'plot-under-floor' || w.code === 'size-below-floor');
      } catch { return false; }
    });
    if (repair.size) {
      if (repair.size.width !== value.width || repair.size.height !== value.height) {
        operation.value = { ...value, ...repair.size };
        finding.expected = { ...finding.expected, minimum: operation.value };
        finding.message = `The chart needs at least ${repair.size.width} × ${repair.size.height}${value.unit ?? 'px'}.`;
      }
      continue;
    }
    delete finding.fix;
    finding.suggest = `No size could be verified within ${repair.limit.width} × ${repair.limit.height}${value.unit ?? 'px'}. Reduce the content or change the chart settings.`;
    finding.expected = { condition: finding.suggest };
  }
}

/** Complete every finding this chart added with its pointer, expected/received and docs. */
function completing<T>(doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope, work: () => T): T {
  const errors = envelope.errors.length;
  const warnings = envelope.warnings.length;
  try {
    return work();
  } catch (error) {
    envelope.errors.push(layoutFailure(chart, error));
    return null as T;
  } finally {
    for (let index = errors; index < envelope.errors.length; index++) {
      envelope.errors[index] = completeChartDiagnostic(doc, chart, envelope.errors[index]!);
    }
    for (let index = warnings; index < envelope.warnings.length; index++) {
      envelope.warnings[index] = completeChartDiagnostic(doc, chart, envelope.warnings[index]!);
    }
  }
}

/**
 * Whether a chart, at the size it was drawn, still draws with some options
 * changed and raises no warning code its drawing did not raise (`drawnCodes`):
 * a design fix that changes the layout is advised only when it does. The probe
 * reports into a scratch envelope, so the render keeps its own findings.
 */
export function drawsWithOptions(
  doc: BoardplotDoc, chart: DocChart, changed: Record<string, unknown>, drawnCodes: ReadonlySet<string>, target?: RenderTarget,
): boolean {
  const scratch: DocumentEnvelope = { ok: true, errors: [], warnings: [] };
  return layoutChart(doc, { ...chart, options: { ...chart.options, ...changed } }, scratch, {}, target) !== null && scratch.errors.length === 0
    && scratch.warnings.every((warning) => drawnCodes.has(warning.code));
}

/** Lay one chart out and run the norm lints; null when it is refused. */
export function layoutChart(doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope, write: SvgWriteOptions = {}, target?: RenderTarget): DrawnChart | null {
  return completing(doc, chart, envelope, () => drawn(doc, chart, envelope, write, target));
}

/**
 * Measure one chart; null when the spec is refused. A size refusal is the
 * answer measure gives; every other refusal is render's, through `judged`.
 */
export function measureChart(doc: BoardplotDoc, chart: DocChart, envelope: DocumentEnvelope, target?: RenderTarget): (ChartMeasurement & { target: RenderTarget }) | null {
  return completing(doc, chart, envelope, () => {
    const resolved = resolveRequest(doc, chart, envelope, target);
    if (!resolved) return null;
    const request = { ...resolved.request, options: { ...resolved.request.options, [VERIFY_ADVICE]: true } };
    const layout = layoutResolvedRequest(request);
    const measured = measureLayout(request, layout);
    if (measured.refused) verifySizeAdvice(doc, chart, measured.refused.warnings, target);
    pushAll(envelope.warnings, measured.warnings.filter((warning) => warning.severity !== 'error'));
    if (!layout.refused && !judged(chart, resolved, layout, envelope, false)) return null;
    return { ...measured, target: resolved.request.target };
  });
}

/**
 * The central document lints judge the authored document, so they carry
 * document paths. Layout reports the same codes per chart; those copies go.
 */
export function addDocumentLints(
  doc: BoardplotDoc, envelope: DocumentEnvelope,
  drawn: readonly { name: string; chart: DrawnChart; drawsWith?: (changed: Record<string, unknown>) => boolean }[] = [],
): void {
  const central = new Set<string>(lintCodes);
  // A root theme reaches every chart: name each page variable once at its source path.
  const variables = new Set<string>();
  envelope.warnings = envelope.warnings.filter((warning) => !central.has(warning.code) && (warning.code !== 'css-var-fallback-used'
    || (!variables.has(`${warning.path}\0${warning.message}`) && Boolean(variables.add(`${warning.path}\0${warning.message}`)))));
  const lintDoc = { ...doc, charts: doc.charts.map((chart) => {
    const entry = drawn.find((candidate) => candidate.name === chart.name);
    return { ...chart, geometry: entry?.chart.geo, ...(entry?.drawsWith ? { drawsWith: entry.drawsWith } : {}) };
  }) };
  pushAll(envelope.warnings, runDocLints(lintDoc, true).map((warning) => completeDocumentDiagnostic(doc, warning)));
  // Design advice follows a drawing; a refused document gets its errors alone.
  if (!envelope.errors.length) pushAll(envelope.warnings, runDocAdvice(lintDoc, true).map((warning) => completeDocumentDiagnostic(doc, warning)));
}
