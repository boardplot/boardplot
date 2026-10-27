import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { getChartDefinition, listCharts, measure, resolveChartRequest } from '../src/index.ts';
import { getFixtures, getRefusalExamples } from '../src/fixtures/index.ts';
import '../src/core/geo/packs/all.ts';
// Keep the check on the engine's constants without adding public package exports.
import { PLOT_FLOOR_PX, WIDTH_SCALED_TYPES, autoPlotShare } from '../src/core/sizing.ts';
import { defaultMeasurer, estimateTextWidthForFace, graphemes, WIDTH_SAFETY } from '../src/core/text.ts';
import { resolveFace } from '../src/core/fontMetrics/index.ts';
import { rectLineDistance, segmentHitsRect, rectContains } from '../src/core/geometry.ts';
import { REFERENCE_LABEL_CLEARANCE } from '../src/core/markVisibility.ts';
import { localeStrings } from '../src/core/strings.ts';
import { NOT_AVAILABLE } from '../src/core/format.ts';
import { cubicPoint } from '../src/core/curve.ts';
import { formatScenarios, resolveSubtitle } from '../src/core/normalize/shared.ts';
import { liveWindowOptions } from '../src/core/viewport.ts';
import { themeForWidth, strokeToken, paintColor, solidMutedPlan } from '../src/core/theme.ts';
import { isHatchPattern } from '../src/core/svgPath.ts';
import { chartReading } from '../src/core/reading.ts';
import { parseJsonPointer, readJsonPointer } from '../src/core/diagnostics/jsonPatch.ts';
import { createOccupiedIndex } from '../src/core/label/occupied.ts';
import { renderSvg } from '../src/core/svg/renderSvg.ts';
import { textRole, numericVariant } from '../src/core/textRole.ts';
import { parseColor } from '../src/core/color.ts';
import { variants } from './explorer/variants.mjs';
import { chartId } from './explorer/cardspec.mjs';
import { censusCase, EXCEPTIONS_FILE, failureLine, unexcepted } from './number-census.mjs';

const WIDTHS = [960, 720, 480, 400, 320];
const CARD_WIDTHS = [480, 400, 320];
const THEMES = ['authored', 'notation'];
// The number census reads the authored-theme renders in English and one more render per width in German
// marks (',' and '.'); the scorecard's own German pass keeps English marks, so it reads no German figure.
const CENSUS_DE_WIDTHS = [960, 720, 480, 400, 320];
const EPS = 1e-6;
const RULES = { S1: 3, S2: 3, S3: 3, S4: 3, R1: 2, R2: 2, R3: 2, R4: 2, R5: 2, R6: 2, R7: 2 };
// A content type whose marks scale with the width takes the height of its
// content, so a narrower card of it may be shorter (docs/manual.md, "Frame text, key and automatic height").
// The engine's own list (sizing.ts WIDTH_SCALED_TYPES); tilemap tiles are the plot width over the columns.
const S2_EXEMPT = WIDTH_SCALED_TYPES;
// English table state glyphs that a locale replaces ('n/a' is 'k. A.' in German).
const GLYPH_WORDS = [NOT_AVAILABLE];
const normal = (text) => String(text ?? '').replace(/\s+/gu, ' ').trim();
const subtitleNormal = (text) => normal(text).replace(/\s*·\s*/gu, ' ').trim();
const drawn = (node) => node.t === 'text' && node.opacity !== 0 && normal(node.lines.join(' ')) !== '';
const clone = (value) => structuredClone(value);

function stringsIn(value) {
  if (typeof value === 'string') return [normal(value)];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  return value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : [];
}

function unitFor(type, fixture, options) {
  const forms = variants[type]?.variants ?? [];
  const exact = forms.find((form) => form.fixture === fixture.id);
  const matching = forms.find((form) => {
    const sample = getFixtures(type).find((item) => item.id === form.fixture);
    return (variants[type].axis ?? []).length > 0 && variants[type].axis.every((key) =>
      key.split('.').reduce((object, part) => object?.[part], options) ===
      key.split('.').reduce((object, part) => object?.[part], { ...sample?.options, ...form.options }));
  });
  return chartId(type, exact ?? matching ?? forms[0] ?? { id: '' });
}

function subtitleAuthored(options) {
  const sub = resolveSubtitle(options.subtitle);
  if (!sub) return '';
  return [sub.company, sub.measure, sub.period, sub.scenarios?.length ? formatScenarios(sub.scenarios) : '']
    .filter(Boolean).join(' · ');
}

/** Only adjacent automatic card widths belong to S2; a refusal breaks the pair. */
export function auditHeight(item, geometry, wider) {
  if (item.height !== 'auto' || !wider || S2_EXEMPT.has(item.fixture.split('/')[0]) || !CARD_WIDTHS.includes(item.width)
    || !CARD_WIDTHS.includes(wider.width)
    || CARD_WIDTHS.indexOf(item.width) !== CARD_WIDTHS.indexOf(wider.width) + 1) return [];
  return geometry.size.height + EPS < wider.height ? [{ ...item, rule: 'S2', severity: 3,
    subject: 'height', message: `height ${geometry.size.height.toFixed(2)} px at ${item.width} px < ${wider.height.toFixed(2)} px at ${wider.width} px` }] : [];
}

function containsName(text, name) {
  const words = normal(text).toLocaleLowerCase('en').split(/[^\p{L}\p{N}%]+/u).filter(Boolean);
  const wanted = normal(name).toLocaleLowerCase('en').split(/[^\p{L}\p{N}%]+/u).filter(Boolean);
  return wanted.length > 0 && words.some((_, i) => wanted.every((word, j) => words[i + j] === word));
}

function windowClause(request, geometry) {
  let sampling = geometry.derived.liveWindow;
  // Column/combo expose their drawn columns, but not their sampling record.
  // Their window accepts last only. Derive its exact counts from the authored
  // category window; sourceCategoryIds in viewport.ts includes all source periods.
  if (!sampling && ['column', 'combo'].includes(request.type) && request.options?.window) {
    const categories = request.data.categories.map((entry) => typeof entry === 'string' ? entry : entry.id);
    const domain = request.options.viewDomain?.x;
    let displayed = categories;
    if (domain) {
      const ends = domain.map((id) => categories.indexOf(id)).sort((a, b) => a - b);
      displayed = categories.slice(ends[0], ends[1] + 1);
    }
    displayed = displayed.slice(-Math.min(request.options.window.last ?? displayed.length, displayed.length));
    sampling = { sourceCategoryIds: categories, displayedCategoryIds: displayed, method: 'window' };
  }
  return subtitleNormal(subtitleAuthored(liveWindowOptions({}, sampling)));
}

function frameTextComplete(authored, actual, request) {
  if (authored === actual) return true;
  const language = request.locale?.language ?? request.options?.locale?.language;
  const strings = { ...localeStrings(language), ...request.options?.strings };
  // Permit complete fixed clauses from the engine table between authored words.
  // Do not accept an unbound template as a wildcard for arbitrary missing text.
  const clauses = Object.values(strings).filter((value) => value && !value.includes('{'))
    .map((value) => subtitleNormal(value).split(' '));
  const wanted = authored ? authored.split(' ') : [];
  const words = actual ? actual.split(' ') : [];
  const seen = new Set();
  const matches = (a, b) => {
    if (a === wanted.length && b === words.length) return true;
    const key = `${a}/${b}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (a < wanted.length && wanted[a] === words[b] && matches(a + 1, b + 1)) return true;
    return clauses.some((clause) => clause.every((word, i) => words[b + i] === word) && matches(a, b + clause.length));
  };
  return matches(0, 0);
}

function seriesOnCanvas(request, geometry, text, series) {
  const visible = geometry.scene.filter((node) => node.opacity !== 0);
  const ownerIds = (node) => [node.owner?.seriesId, node.origin?.owner?.seriesId].filter(Boolean);
  // Read data ink, not a key swatch or a hidden/raw source value. This also excludes
  // folded series, off-window series and a one-point line with no marker or value text.
  const dataInk = visible.filter((node) => node.t === 'text'
    ? drawn(node) && ['point', 'segment', 'total', 'grandTotal'].includes(node.part)
    : !['swatch', 'legendKey', 'legendLine'].includes(node.part)
      && (node.t !== 'path' || /[LCHV]/i.test(node.d)));
  const active = new Set(dataInk.flatMap(ownerIds));
  const named = new Set();
  for (const node of text) for (const id of ownerIds(node)) {
    if (['legendLabel', 'series', 'lineEnd', 'seriesName', 'axisTitle'].includes(node.part)
      || series.some((entry) => entry.id === id && containsName(node.lines.join(' '), entry.label ?? entry.id))) named.add(id);
  }
  // Row/column headers and names on marks can have a category part. Axis titles
  // such as Mekko's "Width: Revenue" do not carry their series owner.
  for (const entry of series) if (text.some((node) => node.part === 'axisTitle'
    && containsName(node.lines.join(' '), entry.label ?? entry.id))) named.add(entry.id);
  // As the legend policy reads it: a grid panel with one primary series is
  // named by its drawn panel title when the title holds the series name.
  if (request.type === 'grid') {
    const prepared = getChartDefinition('grid').prepare?.(request.data) ?? request.data;
    for (const panel of prepared?.panels ?? []) {
      const primary = (panel.data?.series ?? []).filter((entry) => entry.role !== 'reference');
      if (primary.length === 1 && text.some((node) => node.id === `label:panel:${panel.id}:title`
        && containsName(node.lines.join(' '), primary[0].label ?? primary[0].id))) named.add(primary[0].id);
    }
  }
  // A scenario header identifies a series only when that scenario belongs to
  // one series. A shared AC header cannot name several distinct AC measures.
  const headerScenarios = resolveSubtitle(request.options?.subtitle)?.scenarios ?? [];
  for (const entry of series) if (entry.scenario && headerScenarios.includes(entry.scenario)
    && series.filter((other) => other.scenario === entry.scenario).length === 1
    && text.some((node) => ['subtitle', 'scenarioHeader'].includes(node.part)
      && containsName(node.lines.join(' '), entry.scenario))) named.add(entry.id);
  if (request.type === 'variance' && dataInk.some((node) => ['bar', 'pin', 'stem', 'cap'].includes(node.part))) {
    for (const [role, id] of Object.entries({ of: request.options?.variance?.of, vs: request.options?.variance?.vs })) {
      const entry = series.find((entry) => entry.id === id);
      if (!entry) continue;
      active.add(id);
      const scenario = entry.scenario ?? (role === 'of' ? 'AC' : undefined);
      // The key can name the plan too ("Above Plan", "Shortfall to Plan").
      if (text.some((node) => ['subtitle', 'axisTitle', 'legendLabel'].includes(node.part)
        && (containsName(node.lines.join(' '), entry.label ?? id)
          || (scenario && containsName(node.lines.join(' '), scenario))))) named.add(id);
    }
  }
  if (request.type === 'mekko' && dataInk.some((node) => node.part === 'bar') && request.options?.widthSeriesId) active.add(request.options.widthSeriesId);
  const nameOf = (entry) => entry.label ?? entry.id;
  // (a) Rule: no name hidden without a note naming it. A rendered "Not labelled on the chart" note names a
  // series only with its complete name and only when one of its labels is marked noted; a count names none.
  const language = request.locale?.language ?? request.options?.locale?.language;
  const lead = normal(request.options?.strings?.hiddenLabels ?? localeStrings(language).hiddenLabels);
  const notes = text.filter((node) => ['footnote', 'static-footer'].some((part) => node.part === part || node.id?.startsWith('static-footer:'))
    && normal(node.lines.join(' ')).startsWith(lead));
  for (const entry of series) if (!named.has(entry.id)
    && geometry.labels.some((label) => label.noted && label.owner?.seriesId === entry.id)
    && notes.some((node) => containsName(normal(node.lines.join(' ')).slice(lead.length), nameOf(entry)))) named.add(entry.id);
  // (b) Rule: no name hidden without a note naming it. A panel title or tier caption names the
  // one primary series of its panel (src/core/legendPolicy.ts panelTitlesCoverSeries), scoped by panel path.
  if (request.type === 'grid') {
    const data = getChartDefinition('grid').prepare?.(request.data) ?? request.data;
    const panels = (data?.panels ?? []).map((panel) => ({ id: panel.id,
      primary: (panel.data?.series ?? []).filter((entry) => entry.role !== 'reference') }));
    for (const entry of series) if (!named.has(entry.id)) {
      const owning = panels.filter((panel) => panel.primary.some((item) => item.id === entry.id));
      if (owning.length > 0 && owning.every((panel) => panel.primary.length === 1 && text.some((node) =>
        (node.part === 'tierCaption' || node.part === 'panelTitle') && node.id?.startsWith(`${panel.id}/`)
        && containsName(node.lines.join(' '), nameOf(entry))))) named.add(entry.id);
    }
  }
  // (c) Rule: no name hidden without a note naming it. A Mekko subtitle that holds the width series'
  // complete name and unit replaces its width caption (src/core/charts/mekko/plot.ts captionShown).
  const widthEntry = request.type === 'mekko' ? series.find((entry) => entry.id === request.options?.widthSeriesId) : undefined;
  if (widthEntry?.unit && !named.has(widthEntry.id)) {
    const subtitle = normal(text.filter((node) => node.part === 'subtitle').flatMap((node) => node.lines).join(' ')).toLocaleLowerCase('en');
    if (containsName(subtitle, nameOf(widthEntry)) && subtitle.includes(String(widthEntry.unit).toLocaleLowerCase('en'))) named.add(widthEntry.id);
  }
  // A named interval names both bounds. Check that its band is actually drawn,
  // and that its key item is drawn; raw bound values alone do not suffice.
  const visibleIds = new Set(dataInk.map((node) => node.id));
  for (const band of geometry.marks?.fan ?? []) if (band.nodeIds.some((id) => visibleIds.has(id))) {
    active.add(band.low); active.add(band.high);
    if (text.some((node) => node.part === 'legendLabel' && node.owner?.seriesId === `fan:${band.bandIndex}`)) {
      named.add(band.low); named.add(band.high);
    }
  }
  return { active, named };
}

function pathRuns(path) {
  const runs = [];
  let point = { x: 0, y: 0 };
  for (const [, command, coordinates] of path.matchAll(/([MLCHV])([^MLCHVZ]*)/g)) {
    const numbers = (coordinates.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    if (command === 'M') { point = { x: numbers[0], y: numbers[1] }; continue; }
    if (command === 'C') {
      for (let i = 0; i < numbers.length; i += 6) {
        const curve = { from: point, c1: { x: numbers[i], y: numbers[i + 1] },
          c2: { x: numbers[i + 2], y: numbers[i + 3] }, to: { x: numbers[i + 4], y: numbers[i + 5] } };
        // Same 16-chord approximation as core/curve.ts's drawnStroke.
        runs.push([point, ...Array.from({ length: 16 }, (_, k) => cubicPoint(curve, (k + 1) / 16))]);
        point = curve.to;
      }
    } else for (let i = 0; i < numbers.length; i += command === 'L' ? 2 : 1) {
      const next = command === 'H' ? { x: numbers[i], y: point.y } : command === 'V' ? { x: point.x, y: numbers[i] } : { x: numbers[i], y: numbers[i + 1] };
      runs.push([point, next]); point = next;
    }
  }
  return runs;
}

const engineSymbol = (object, name) => {
  const key = Object.getOwnPropertySymbols(object).find((symbol) => symbol.description === name);
  return key === undefined ? undefined : object[key];
};

/** Check a measured scene. Exported for test helpers, not the package. */
export function auditGeometry(item, request, geometry, skipped = []) {
  const findings = [];
  const add = (rule, subject, message) => findings.push({ ...item, rule, severity: RULES[rule], subject, message });
  const { options = {}, data } = request;
  const text = geometry.scene.filter(drawn);
  const nodes = new Map(text.map((node) => [node.id, node]));
  const visibleLabels = geometry.labels.filter((label) => !label.hidden && nodes.has(label.nodeId));
  const skip = (rule, reason, partial = false) => skipped.push({ rule, reason, ...(partial ? { partial: true } : {}) });
  // docs/manual.md, "Sizing": content fit keeps its own row/tile/text height.
  // Use the measured fit, including pie, choropleth and tilemap; no type override.
  if (item.height !== 'auto' || !CARD_WIDTHS.includes(item.width)) skip('S1', 'outside automatic card widths');
  else if (geometry.sizing?.fit === 'content') skip('S1', 'measured content sizing');
  else if (['kpi', 'status', 'bullet', 'sparkline'].includes(request.type)) skip('S1', 'no plot floor for this card type');
  else {
    const target = request.target ?? options.target ?? 'report';
    const floor = PLOT_FLOOR_PX[target];
    // Only S1 excludes appended blocks. All other rules inspect the complete static scene.
    const staticFooter = geometry.scene.some(node => node.id?.startsWith('static-footer:')) ? geometry.frame.footerRect : undefined;
    let canvasHeight = geometry.size.height - (staticFooter?.h ?? 0);
    if (geometry.story?.placement === 'below') {
      const resolved = resolveChartRequest(request);
      if (!resolved.fixed.height) {
        const theme = themeForWidth(resolved.theme, geometry.size.width);
        // story.ts grows the automatic canvas by the full panel plus this theme gap.
        canvasHeight -= geometry.story.panel.h + Math.max(12, theme.space.labelPad * 3);
      }
    }
    // The engine's own floor rule (src/core/sizing.ts): the rect it holds to the floor
    // (PLOT_FLOOR_RECT: variance value rows, line forecast field) and a content plot height
    // (CONTENT_PLOT_HEIGHT: dot rows at their row pitch), read by symbol description because
    // Read the engine metadata without adding package exports.
    const plot = engineSymbol(geometry, 'boardplot.plotFloorRect') ?? geometry.plot;
    const content = engineSymbol(geometry, 'boardplot.contentPlotHeight');
    const share = plot.h / canvasHeight;
    // The engine's own share rule (0.4 below 600 px for a 16:9 fill chart); the registry may
    // choose 0.5 when 0.4 hides a value, so 0.4 is the floor every such layout must keep.
    const shareFloor = autoPlotShare(getChartDefinition(request.type), { ...options, target }, item.width);
    if (content && (content.exact || content.px < floor)) {
      // An exact content plot, or one under the floor, sets the plot height (sizing.ts autoHeightNeed).
      if (plot.h + 1 < content.px) add('S1', 'plot', `plot ${plot.h.toFixed(2)} px under its content plot height ${content.px.toFixed(2)} px (${target})`);
    } else if (plot.h + EPS < floor || share + EPS < shareFloor) {
      add('S1', 'plot', `plot ${plot.h.toFixed(2)} px, ${(share * 100).toFixed(2)}% of ${canvasHeight.toFixed(2)} px; floor ${floor} px and ${shareFloor * 100}% (${target})`);
    }
  }

  // Only the outer frame belongs to this request. Grid child titles have an origin.
  const frameText = (part) => normal(text.filter((node) => node.part === part && !node.origin?.panels?.length).flatMap((node) => node.lines).join(' '));
  if (typeof options.title === 'string' && !frameTextComplete(normal(options.title), frameText('title'), request)) {
    add('S3', 'title', `title drawn ${JSON.stringify(frameText('title'))}; authored ${JSON.stringify(normal(options.title))}`);
  }
  if (options.subtitle !== undefined) {
    const authored = subtitleNormal(subtitleAuthored(options));
    let actual = subtitleNormal(frameText('subtitle'));
    // The frame adds a unit after the measure. A wrapped separator becomes a line break.
    const sub = resolveSubtitle(options.subtitle);
    const units = [options.unit, geometry.derived.table?.unit,
      options.variant === 'relative' ? '%' : undefined,
      geometry.derived.basis === 'shareOfTotal' ? '% of the grand total' : undefined].filter(Boolean);
    for (const unit of units) if (sub && !normal(sub.measure).includes(unit)) {
      actual = actual.replace(`${subtitleNormal(sub.measure)} in ${unit}`, subtitleNormal(sub.measure));
      if (['x', '×', 'ratio'].includes(unit.toLowerCase())) actual = actual.replace(`${subtitleNormal(sub.measure)} ratio (×)`, subtitleNormal(sub.measure)).replace(`${subtitleNormal(sub.measure)} (×)`, subtitleNormal(sub.measure));
    }
    // The existing window clause still lives in viewport.ts, outside localeStrings.
    // Reuse its exact text and measured counts, never a permissive "Showing ..." match.
    const window = windowClause(request, geometry);
    if (window && actual !== authored) actual = subtitleNormal(actual.replace(window, ''));
    const moved = geometry.warnings.some((warning) => warning.code === 'subtitle-moved-to-notes') &&
      (geometry.frame.noteList ?? []).some((note) => subtitleNormal(note.text) === authored);
    if (!frameTextComplete(authored, actual, request) && !moved) add('S3', 'subtitle', `subtitle drawn ${JSON.stringify(actual)}; authored ${JSON.stringify(authored)}`);
  }

  // A composed grid can lift its children's keys into the outer frame.
  const nameData = request.type === 'grid' ? getChartDefinition('grid').prepare?.(data) ?? data : data;
  const collectSeries = (data) => [...(Array.isArray(data?.series) ? data.series : []),
    ...(data?.panels ?? []).flatMap((panel) => collectSeries(panel.data))];
  const series = [...new Map(collectSeries(nameData).map((series) => [series.id, series])).values()];
  if (series.length < 2) skip('S4', 'fewer than two authored series');
  else if (series.length >= 2) {
    const { active, named } = seriesOnCanvas(request, geometry, text, series);
    const drawnSeries = series.filter((entry) => active.has(entry.id));
    const missing = drawnSeries.filter((entry) => !named.has(entry.id));
    if (drawnSeries.length < series.length) skip('S4', `${series.length - drawnSeries.length} series have no drawn data`, drawnSeries.length > 0);
    // One drawn series needs no name to tell it apart (a pie draws one of two authored series).
    if (missing.length && drawnSeries.length >= 2) add('S4', missing.map((series) => series.id).sort().join(','), `named ${drawnSeries.length - missing.length}/${drawnSeries.length} drawn series; missing ${missing.map((series) => series.id).join(', ')}`);
  }

  // Include text that is not in the label solver (frame/key/axis text).
  const boxes = visibleLabels.map((label) => ({ id: label.nodeId, owner: label.owner, rect: label.rect }));
  const boxed = new Set(boxes.map((box) => box.id));
  for (const node of text) {
    if (boxed.has(node.id)) continue;
    const w = Math.max(...node.lines.map((line) => defaultMeasurer(line, node.font).width));
    const h = node.lines.length * node.font.size * (node.font.lineHeight ?? 1.2);
    boxes.push({ id: node.id, owner: node.owner, rect: {
      x: node.x + (node.tx ?? 0) - (node.align === 'end' ? w : node.align === 'middle' ? w / 2 : 0),
      y: node.y + (node.ty ?? 0), w, h,
    } });
  }
  let clearance = Infinity, nearest = '';
  for (const node of geometry.scene) {
    if (!['valueLine', 'reference', 'referenceLine', 'targetLine', 'target', 'targetPath'].includes(node.part)) continue;
    let runs = [];
    if (node.t === 'line') runs = [[{ x: node.x1, y: node.y1 }, { x: node.x2, y: node.y2 }]];
    // Cut reference lines are M…L… runs. Do not check their uncut source.
    if (node.t === 'path') runs = pathRuns(node.d);
    for (const run of runs) for (const box of boxes) {
      const distance = rectLineDistance(box.rect, run.map(({ x, y }) => ({ x: x + (node.tx ?? 0), y: y + (node.ty ?? 0) })));
      if (distance < clearance) { clearance = distance; nearest = `${node.id} / ${box.id}`; }
    }
  }
  if (clearance + EPS < REFERENCE_LABEL_CLEARANCE) add('R1', nearest, `reference clearance ${clearance.toFixed(2)} px; floor ${REFERENCE_LABEL_CLEARANCE} px (${nearest})`);

  let gap = Infinity, pair = '';
  const values = visibleLabels.filter((label) => ['point', 'segment', 'total', 'grandTotal', 'valueLine'].includes(label.kind));
  for (let a = 0; a < values.length; a++) for (let b = a + 1; b < values.length; b++) {
    const first = values[a], second = values[b];
    if (first.owner.seriesId !== second.owner.seriesId || first.owner.categoryId === second.owner.categoryId) continue;
    const r = first.rect, s = second.rect;
    if (Math.min(r.y + r.h, s.y + s.h) <= Math.max(r.y, s.y) + EPS) continue;
    const distance = Math.max(r.x, s.x) - Math.min(r.x + r.w, s.x + s.w);
    if (distance < gap) { gap = distance; pair = `${first.id} / ${second.id}`; }
  }
  if (gap + EPS < 6) add('R2', pair, `value label gap ${gap.toFixed(2)} px; floor 6 px (${pair})`);

  if (/^de(?:[-_]|$)/i.test(request.locale?.language ?? options.locale?.language ?? '')) {
    const en = localeStrings('en'), de = localeStrings('de');
    const words = new Set([...Object.entries(en).filter(([key, word]) => !word.includes('{') && word !== de[key]).map(([, word]) => normal(word)), ...GLYPH_WORDS]);
    const authored = new Set(stringsIn([data, options, request.annotations]));
    // A whole text node ("Total"), or a library word that leads a line ("Source: …").
    const leading = (line) => /^([^:]{1,40}):\s/u.exec(line)?.[1];
    const leaked = [...new Set(text.flatMap((node) => [normal(node.lines.join(' ')), ...node.lines.map((line) => leading(normal(line)))])
      .filter((word) => word && words.has(word) && !authored.has(word)))];
    if (leaked.length) add('R3', [...leaked].sort().join(','), `${leaked.length} English library word(s) under de: ${leaked.map((word) => JSON.stringify(word)).join(', ')}`);
  }
  return findings;
}

// The SVG renderer uses a 0.88 em baseline and a 2.5 px glyph halo.
// Word ink boxes exclude spaces and line-box leading. Rotation is about that baseline.
const INK_EPS = 0.5;
// Layout reserves a 1.5% fitting margin. It is not painted text.
function inkWidth(text, font) {
  const face = resolveFace(font.family, font.weight);
  const tracking = (font.letterSpacing ?? 0) * Math.max(0, graphemes(text).length - 1);
  return (estimateTextWidthForFace(text, font, face) - tracking) / (face ? WIDTH_SAFETY : 1) + tracking;
}
const bounds = (points) => {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const corners = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > INK_EPS
  && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > INK_EPS;
function polygonsOverlap(a, b, clearance = INK_EPS) {
  return [a, b].every(poly => poly.every((p, i) => {
    const q = poly[(i + 1) % poly.length], length = Math.hypot(q.x - p.x, q.y - p.y);
    const project = point => (point.x * (p.y - q.y) + point.y * (q.x - p.x)) / length;
    const first = a.map(project), second = b.map(project);
    return Math.min(Math.max(...first), Math.max(...second)) - Math.max(Math.min(...first), Math.min(...second)) > clearance;
  }));
}
export function textInk(node, theme) {
  const font = { ...node.font, ...(theme ? { tabular: numericVariant(textRole(node), theme) === 'tabular-nums' } : {}) }, angle = (node.rotate ?? 0) * Math.PI / 180;
  const c = Math.cos(angle), sn = Math.sin(angle);
  const ls = font.letterSpacing ?? 0;
  const x = node.x + (node.align === 'end' ? ls : node.align === 'middle' ? ls / 2 : 0);
  const y = node.y + font.size * 0.88;
  const world = p => ({ x: x + (p.x - x) * c - (p.y - y) * sn + (node.tx ?? 0), y: y + (p.x - x) * sn + (p.y - y) * c + (node.ty ?? 0) });
  const local = p => { const dx = p.x - (node.tx ?? 0) - x, dy = p.y - (node.ty ?? 0) - y; return { x: x + dx * c + dy * sn, y: y - dx * sn + dy * c }; };
  const words = [];
  node.lines.forEach((line, i) => {
    const runs = node.runs ?? [{ text: line }];
    const fonts = runs.map(run => ({ ...font, ...(run.weight === undefined ? {} : { weight: run.weight }) }));
    const widths = runs.map((run, j) => inkWidth(run.text, fonts[j]));
    const width = widths.reduce((a, b) => a + b, 0);
    let start = x - (node.align === 'end' ? width : node.align === 'middle' ? width / 2 : 0);
    runs.forEach((run, j) => {
      const own = fonts[j], cap = defaultMeasurer.capHeight?.(own) ?? own.size * 0.72;
      for (const match of run.text.matchAll(/\S+/gu)) {
        const offset = inkWidth(run.text.slice(0, match.index), own);
        const rect = { x: start + offset, y: y + i * font.size * (font.lineHeight ?? 1.2) - cap,
          w: inkWidth(match[0], own), h: cap + (/[gjpqy,;_]/u.test(match[0]) ? own.size * 0.2 : 0) };
        words.push({ rect, polygon: corners(rect).map(world) });
      }
      start += widths[j];
    });
  });
  return { node, words, local, rect: bounds(words.flatMap(word => word.polygon)) };
}

// Flatten every SVG stroke command, including relative commands, closed paths and arcs.
// Curves use the same 16 chords as the existing reference-line check.
export function strokeRuns(path) {
  const tokens = path.match(/[a-zA-Z]|[-+]?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? [];
  const runs = []; let i = 0, cmd, at = { x: 0, y: 0 }, start = at, lastC, lastQ, active;
  const append = points => { if (active) active.push(...points.slice(1)); else { active = points; runs.push(active); } };
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    const op = cmd?.toUpperCase(), relative = cmd !== op, from = at;
    const point = () => { const x = next(), y = next(); return { x: x + (relative ? from.x : 0), y: y + (relative ? from.y : 0) }; };
    if (op === 'Z') { append([at, start]); active.closed = true; at = start; active = undefined; cmd = undefined; lastC = lastQ = undefined; continue; }
    if (!cmd || !['M','L','H','V','C','S','Q','T','A'].includes(op)) throw new Error(`Unsupported SVG stroke command ${cmd}`);
    if (op === 'M') { at = point(); start = at; active = undefined; cmd = relative ? 'l' : 'L'; }
    else if (op === 'L' || op === 'H' || op === 'V') {
      at = op === 'L' ? point() : op === 'H' ? { x: next() + (relative ? from.x : 0), y: from.y } : { x: from.x, y: next() + (relative ? from.y : 0) };
      append([from, at]);
    } else if (op === 'C' || op === 'S' || op === 'Q' || op === 'T') {
      let c1, c2;
      if (op === 'C' || op === 'S') {
        c1 = op === 'C' ? point() : lastC ? { x: 2 * from.x - lastC.x, y: 2 * from.y - lastC.y } : from;
        c2 = point(); at = point(); lastC = c2;
      } else {
        const q = op === 'Q' ? point() : lastQ ? { x: 2 * from.x - lastQ.x, y: 2 * from.y - lastQ.y } : from;
        at = point(); lastQ = q;
        c1 = { x: from.x + (q.x - from.x) * 2 / 3, y: from.y + (q.y - from.y) * 2 / 3 };
        c2 = { x: at.x + (q.x - at.x) * 2 / 3, y: at.y + (q.y - at.y) * 2 / 3 };
      }
      append([from, ...Array.from({ length: 16 }, (_, n) => cubicPoint({ from, c1, c2, to: at }, (n + 1) / 16))]);
    } else {
      let rx = Math.abs(next()), ry = Math.abs(next()); const phi = next() * Math.PI / 180, large = next(), sweep = next(); at = point();
      if (!rx || !ry || (from.x === at.x && from.y === at.y)) append([from, at]);
      else {
        const cos = Math.cos(phi), sin = Math.sin(phi), dx = (from.x - at.x) / 2, dy = (from.y - at.y) / 2;
        const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
        const scale = Math.sqrt(Math.max(1, xp * xp / (rx * rx) + yp * yp / (ry * ry))); rx *= scale; ry *= scale;
        const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) / (rx * rx * yp * yp + ry * ry * xp * xp)));
        const cxp = factor * rx * yp / ry, cyp = -factor * ry * xp / rx;
        const cx = cos * cxp - sin * cyp + (from.x + at.x) / 2, cy = sin * cxp + cos * cyp + (from.y + at.y) / 2;
        const theta = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
        let delta = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - theta;
        if (sweep && delta < 0) delta += 2 * Math.PI; if (!sweep && delta > 0) delta -= 2 * Math.PI;
        const count = Math.max(16, Math.ceil(Math.abs(delta) * Math.max(rx, ry) / 2));
        append([from, ...Array.from({ length: count }, (_, n) => { const a = theta + delta * (n + 1) / count; return { x: cx + cos * rx * Math.cos(a) - sin * ry * Math.sin(a), y: cy + sin * rx * Math.cos(a) + cos * ry * Math.sin(a) }; })]);
      }
    }
    if (!['C','S'].includes(op)) lastC = undefined;
    if (!['Q','T'].includes(op)) lastQ = undefined;
  }
  return runs;
}
function lineRuns(node) {
  if (node.t === 'line') return [[{ x: node.x1, y: node.y1 }, { x: node.x2, y: node.y2 }]];
  if (node.t === 'path') return strokeRuns(node.d);
  if (node.t === 'rect') { const p = corners(node.rect); return [Object.assign([...p, p[0]], { closed: true })]; }
  if (node.t === 'circle') return [Object.assign(Array.from({ length: 65 }, (_, i) => ({ x: node.cx + node.r * Math.cos(i * Math.PI / 32), y: node.cy + node.r * Math.sin(i * Math.PI / 32) })), { closed: true })];
  return [];
}

function paintAlpha(paint, theme) {
  if (!paint) return 0;
  const color = paintColor(theme, paint).trim();
  if (!parseColor(color)) return 0;
  const hex = /^#([\da-f]{4}|[\da-f]{8})$/i.exec(color)?.[1];
  if (hex) return parseInt(hex.length === 4 ? hex.slice(3).repeat(2) : hex.slice(6), 16) / 255;
  const alpha = /^rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)$/i.exec(color)?.[1]?.trim();
  return alpha === undefined ? 1 : Number(alpha.endsWith('%') ? alpha.slice(0, -1) : alpha) / (alpha.endsWith('%') ? 100 : 1);
}

// Match the SVG/React stroke defaults, including notation-created rectangle edges.
function sceneStroke(node, theme) {
  if (node.opacity === 0) return;
  let paint = node.stroke, width;
  if (node.t === 'line') width = node.width;
  else if (node.t === 'path') width = node.width ?? strokeToken(theme, 'rule');
  else if (node.t === 'circle') width = node.strokeWidth ?? strokeToken(theme, 'mark');
  else if (node.t === 'rect') {
    if (isHatchPattern(node.pattern)) { paint = node.hatchEdge === false ? undefined : node.fill; width = strokeToken(theme, 'hair'); }
    else if (node.pattern === 'outline' && solidMutedPlan(theme)) return;
    else if (node.pattern === 'outline' || node.pattern === 'hollow') { paint = node.fill; width = theme.pattern.outlineStrokeWidth; }
    else width = node.strokeWidth ?? strokeToken(theme, 'mark');
  }
  if (width > 0 && paintAlpha(paint, theme) > 0) return width;
}

// Dash phase continues across commands and flattened chords, and restarts at M.
// The scene has no dash offset. Odd arrays repeat; an empty/all-zero array is solid.
function paintedRuns(runs, dash, cap) {
  if (!dash?.length || dash.some(n => !Number.isFinite(n) || n < 0) || !dash.some(n => n > 0)) return runs;
  const pattern = dash.length % 2 ? [...dash, ...dash] : dash;
  return runs.flatMap(run => {
    const distances = [0];
    for (let i = 1; i < run.length; i++) distances.push(distances[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y));
    const total = distances.at(-1), spans = [];
    const at = distance => {
      let lo = 1, hi = run.length - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (distances[mid] < distance) lo = mid + 1; else hi = mid; }
      const a = run[lo - 1], b = run[lo], length = distances[lo] - distances[lo - 1];
      const t = length > 0 ? (distance - distances[lo - 1]) / length : 0;
      return { index: lo, point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
    };
    for (let from = 0, i = 0; from <= total; from += pattern[i], i = (i + 1) % pattern.length) {
      const to = Math.min(total, from + pattern[i]);
      if (i % 2 || (to === from && cap === 'butt')) continue;
      const a = at(from), b = at(to);
      spans.push({ from, to, points: [a.point, ...run.slice(a.index, b.index), b.point] });
    }
    if (spans.length > 1 && run.closed && spans[0].from === 0 && spans.at(-1).to === total) {
      spans[0].points = [...spans.pop().points, ...spans[0].points.slice(1)];
    }
    else if (spans.length === 1 && run.closed && spans[0].from === 0 && spans[0].to === total) spans[0].points.closed = true;
    return spans.map(span => span.points);
  });
}

function strokeHitsRect(a, b, rect, radius, startCap, endCap) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const ux = length ? dx / length : 1, uy = length ? dy / length : 0;
  if (length || startCap === 'square' || endCap === 'square') {
    const start = startCap === 'square' ? radius : 0, end = endCap === 'square' ? radius : 0;
    const p = { x: a.x - ux * start, y: a.y - uy * start }, q = { x: b.x + ux * end, y: b.y + uy * end };
    const polygon = [{ x: p.x - uy * radius, y: p.y + ux * radius }, { x: q.x - uy * radius, y: q.y + ux * radius },
      { x: q.x + uy * radius, y: q.y - ux * radius }, { x: p.x + uy * radius, y: p.y - ux * radius }];
    if (polygonsOverlap(polygon, corners(rect), -EPS)) return true;
  }
  return (startCap === 'round' && rectLineDistance(rect, [a]) <= radius + EPS)
    || (endCap === 'round' && rectLineDistance(rect, [b]) <= radius + EPS);
}

export function auditScene(item, request, geometry, reading) {
  const findings = [], add = (rule, subject, message, detail) => findings.push({ ...item, rule, severity: 2, subject, message, detail });
  const resolved = resolveChartRequest(request), theme = themeForWidth(resolved.theme, geometry.size.width);
  const texts = geometry.scene.flatMap((node, index) => drawn(node) ? [{ ...textInk(node, theme), index }] : []);
  const index = createOccupiedIndex(geometry.plot);
  for (const [i, text] of texts.entries()) {
    const outside = text.words.some(word => word.polygon.some(p => p.x < -INK_EPS || p.y < -INK_EPS || p.x > geometry.size.width + INK_EPS || p.y > geometry.size.height + INK_EPS));
    if (outside) add('R5', `${text.node.id} / canvas`, 'Text extends outside the canvas', { text: text.node.id, textPart: text.node.part, edge: true });
    for (const hit of index.hitsWhich(text.rect)) {
      const other = texts[Number(hit.owner.annotationId)];
      if (!overlaps(text.rect, other.rect)) continue;
      if (text.words.some(a => other.words.some(b => polygonsOverlap(a.polygon, b.polygon)))) {
        add('R5', [other.node.id, text.node.id].sort().join(' / '), 'Visible text overlaps visible text', { text: text.node.id, other: other.node.id, textPart: text.node.part, otherPart: other.node.part });
      }
    }
    index.claim(text.rect, 'label', { annotationId: String(i) });
  }
  const occluders = geometry.scene.flatMap((node, i) => ['rect','circle'].includes(node.t) && paintAlpha(node.fill, theme) === 1 && (node.opacity ?? 1) === 1 ? [{ node, index: i }] : []);
  for (const [order, node] of geometry.scene.entries()) {
    const width = sceneStroke(node, theme);
    if (width === undefined) continue;
    const hitTexts = new Set();
    const cap = node.lineCap ?? 'butt', pad = width / 2 * Math.SQRT2;
    for (const run of paintedRuns(lineRuns(node), node.dash, cap)) for (let k = 1; k < run.length; k++) {
      const segment = [run[k - 1], run[k]].map(p => ({ x: p.x + (node.tx ?? 0), y: p.y + (node.ty ?? 0) }));
      const rect = bounds(segment);
      const closed = run.closed;
      const join = node.t === 'rect' ? 'square' : 'round';
      const startCap = k === 1 && !closed ? cap : join, endCap = k === run.length - 1 && !closed ? cap : join;
      for (const hit of index.hitsWhich(rect, pad)) {
        const ti = Number(hit.owner.annotationId), text = texts[ti];
        if (hitTexts.has(ti)) continue;
        if (text.index > order && text.node.halo && (text.node.opacity ?? 1) === 1) continue;
        const local = segment.map(text.local);
        const crossing = text.words.some(word => {
          if (!segmentHitsRect(local[0], local[1], word.rect, pad)
            || !strokeHitsRect(local[0], local[1], word.rect, width / 2, startCap, endCap)) return false;
          // A solid mark or label plate can hide a line before text is drawn too.
          if (occluders.some(o => o.index > order && o.index < text.index && word.polygon.every(p => {
            const q = { x: p.x - (o.node.tx ?? 0), y: p.y - (o.node.ty ?? 0) };
            return o.node.t === 'rect' ? rectContains(o.node.rect, { ...q, w: 0, h: 0 }) : Math.hypot(q.x - o.node.cx, q.y - o.node.cy) < o.node.r;
          }))) return false;
          return true;
        });
        if (crossing) {
          hitTexts.add(ti);
          add('R6', `${node.id} / ${text.node.id}`, 'A drawn stroke crosses text without a later covering halo', { line: node.id, linePart: node.part, text: text.node.id, textPart: text.node.part });
        }
      }
    }
  }
  const omissions = new Set(reading.omissions.map(omission => omission.labelId));
  const labels = new Map(geometry.labels.map(label => [label.id, label]));
  const ticks = geometry.axes?.flatMap(axis => axis.ticks) ?? [];
  const requested = new Set([...labels.keys(), ...geometry.debug.decisions.map(decision => decision.labelId), ...ticks.flatMap(tick => tick.labelId ? [tick.labelId] : [])]);
  // Histogram replaces the delegated column names with its bin-edge axis.
  // Exclude only those obsolete requests, and keep every final axis request.
  const binEdges = geometry.derived?.binning?.edges;
  const histogramAxis = request.type === 'histogram' && binEdges && geometry.axes?.some(axis => axis.axis === 'x'
    && axis.ticks.length === binEdges.length && axis.ticks.every((tick, i) => tick.at === binEdges[i]));
  if (histogramAxis) for (const bin of geometry.marks.bins) requested.delete(`category:${bin.id}`);
  const drawnIds = new Set(texts.map(text => text.node.id));
  for (const id of requested) {
    const label = labels.get(id);
    if (!omissions.has(id) && !drawnIds.has(id) && !(label?.nodeId && drawnIds.has(label.nodeId)) && !drawnIds.has(`label:${id}`)) {
      add('R7', id, 'Requested label has no drawn text and no reading.omissions entry', { label: id, kind: label?.kind ?? 'solver request' });
    }
  }
  return findings;
}

export function applyRepair(request, operations) {
  let root = clone(request);
  for (const operation of operations) {
    const keys = parseJsonPointer(operation.path);
    if (keys[0] === 'charts' && keys[1] === '0') keys.splice(0, 2);
    const pointer = keys.map(key => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
    const current = operation.op === 'add' ? { found: false } : readJsonPointer(root, pointer);
    if (operation.op === 'test') { if (!current.found || JSON.stringify(current.value) !== JSON.stringify(operation.value)) throw new Error(`Repair test failed at ${pointer}`); continue; }
    if (operation.op !== 'add' && !current.found) throw new Error(`Repair ${operation.op} has no member at ${pointer}`);
    if (!keys.length) { root = operation.op === 'remove' ? undefined : clone(operation.value); continue; }
    const parent = keys.slice(0, -1).reduce((object, key) => object[key], root), key = keys.at(-1);
    if (Array.isArray(parent)) {
      const at = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(at) || at < 0 || at > parent.length) throw new Error(`Invalid repair array index ${key}`);
      if (operation.op === 'remove') parent.splice(at, 1);
      else if (operation.op === 'add') parent.splice(at, 0, clone(operation.value));
      else parent[at] = clone(operation.value);
    } else if (operation.op === 'remove') delete parent[key];
    else parent[key] = clone(operation.value);
  }
  return root;
}
const warningKey = warning => JSON.stringify([warning.code, warning.field ?? [], warning.owner ?? {}]);
export function auditRepairs(item, request, measured, thrown) {
  const findings = [], warnings = thrown ? [thrown] : measured.refused?.warnings ?? measured.warnings;
  for (const warning of warnings) {
    const repairs = [];
    if (warning.fix?.length) repairs.push({ kind: 'patch', operations: warning.fix });
    // Only machine-readable or explicitly numeric sizes are executable advice.
    if (thrown || measured.refused) {
      let size = warning.expected?.minimum;
      const match = /(?:at least |at |Render it at )(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*px/i.exec(warning.suggest ?? '');
      if (!size && match) size = { width: Number(match[1]), height: Number(match[2]) };
      if (!size && warning.code === 'size-below-floor' && measured?.minHeightAtWidth > 0) size = { width: Math.max(request.options.size.width, measured.minWidth), height: measured.minHeightAtWidth };
      if (size?.width > 0 && size?.height > 0 && !warning.fix?.some(op => op.path.endsWith('/size') && JSON.stringify(op.value) === JSON.stringify(size))) {
        repairs.push({ kind: 'size', operations: [{ op: 'add', path: '/options/size', value: size }] });
      }
    }
    for (const repair of repairs) {
      const subject = `${warningKey(warning)} / ${repair.kind}`;
      const detail = { code: warning.code, repair: repair.kind, paths: repair.operations.map(op => op.path) };
      try {
        const fixed = applyRepair(request, repair.operations), after = measure(fixed);
        if (!after.geometry) { findings.push({ ...item, rule: 'R4', severity: 2, subject, message: 'The advertised repair still refuses', detail: { ...detail, codes: (after.refused?.warnings ?? after.warnings).map(w => w.code) } }); continue; }
        renderSvg(after.geometry, resolveChartRequest(fixed).theme);
        if (after.warnings.some(next => warningKey(next) === warningKey(warning))) findings.push({ ...item, rule: 'R4', severity: 2, subject, message: 'The warning remains after its fix patch', detail });
      } catch (error) {
        findings.push({ ...item, rule: 'R4', severity: 2, subject, message: `The advertised repair failed: ${error.message}`, detail });
      }
    }
  }
  return findings;
}

function set(object, path, value) {
  const parts = path.split('.');
  let node = object;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function leaves(schema, prefix = '', result = new Map()) {
  const def = schema._zod.def;
  if (def.innerType) return leaves(def.innerType, prefix, result);
  if (def.type === 'pipe') return leaves(def.in, prefix, result);
  if (def.type === 'object') for (const [key, child] of Object.entries(schema.shape)) leaves(child, prefix ? `${prefix}.${key}` : key, result);
  else if (def.type === 'union') for (const child of def.options) leaves(child, prefix, result);
  else if (prefix) {
    const values = result.get(prefix) ?? [];
    if (def.type === 'enum') values.push(...Object.values(def.entries));
    if (def.type === 'boolean') values.push(false, true);
    if (def.type === 'literal') values.push(...(def.values ?? [def.value]));
    result.set(prefix, [...new Set(values)]);
  }
  return result;
}

/** One option at a time, only on the Explorer's representative variants. */
function settingsFor(type, fixture, form) {
  const schema = getChartDefinition(type).optionsSchema;
  const fields = leaves(schema);
  const base = { ...fixture.options, ...form.options };
  const settings = [];
  const add = (name, key, value) => {
    const options = clone(base);
    set(options, key, value);
    if (schema.safeParse(options).success) settings.push({ name, options });
  };
  if (fields.has('valueLabels')) {
    for (const value of ['none', 'all']) if (fields.get('valueLabels').includes(value)) add(`valueLabels=${value}`, 'valueLabels', value);
  } else {
    // Shared labels are false / a per-kind map, not an invented none/all enum.
    if (schema.shape?.labels) {
      add('valueLabels=none', 'labels', false);
      add('valueLabels=all', 'labelDensity', 'full');
    }
  }
  for (const position of ['top', 'right', 'direct']) {
    if (fields.get('legend')?.includes(position)) add(`legend=${position}`, 'legend', position);
    else if (fields.get('legend.position')?.includes(position)) add(`legend=${position}`, 'legend.position', position);
  }
  if (fields.get('valueAxis.show')?.includes(false)) add('valueAxis=off', 'valueAxis.show', false);
  if ((fixture.annotations ?? base.annotations ?? []).length) settings.push({ name: 'annotations=removed', options: base, annotations: [] });
  return settings;
}

/** Rebuild a recorded case for a rendered finding review. */
export function requestForCase(item) {
  const [type, ...parts] = item.fixture.split('/'), id = parts.join('/');
  const fixture = [...getFixtures(type), ...getRefusalExamples(type)].find(fixture => fixture.id === id);
  if (!fixture) throw new Error(`Fixture missing: ${item.fixture}`);
  let options = fixture.options ?? {}, annotations, locale;
  if (!['default', 'fixed=400x300'].includes(item.setting)) {
    const split = item.setting.lastIndexOf(':'), formId = item.setting.slice(0, split), name = item.setting.slice(split + 1);
    const form = variants[type].variants.find(form => form.id === formId);
    if (name === 'locale=de') { options = { ...options, ...form.options }; locale = { language: 'de' }; }
    else { const setting = settingsFor(type, fixture, form).find(setting => setting.name === name); options = setting.options; annotations = setting.annotations; }
  }
  const fixed = item.setting === 'fixed=400x300';
  return { type, data: clone(fixture.data), options: { ...clone(options), ...(fixed ? { target: 'dashboard' } : {}), size: { width: item.width, ...(fixed ? { height: 300 } : {}) } },
    annotations: clone(annotations ?? fixture.annotations ?? options.annotations ?? []), ...(item.theme === 'authored' ? {} : { theme: item.theme }), ...(locale ? { locale } : {}) };
}

/** Whether `--only` (a list of `type` or `type/id`) takes the fixture `type/id`; no list takes every fixture. */
export const selects = (only, fixture) => !only || only.some((entry) => entry === fixture || entry === fixture.split('/')[0]);

export function scorecard(shard = 0, shards = 1, only = undefined) {
  const cases = [], findings = [], refusals = [], errors = [], census = [];
  let censusMs = 0;
  const readNumbers = (type, fixture, width, locale, measured) => {
    const started = performance.now();
    try { census.push(...censusCase(type, fixture, width, locale, measured).findings); }
    catch (error) { census.push({ fixture: `${type}/${fixture.id}`, width, locale, class: 'census-error', surface: '-', text: String(error.message ?? error).slice(0, 200) }); }
    censusMs += performance.now() - started;
  };
  const fixtures = listCharts().flatMap(({ type }) => [...getFixtures(type), ...getRefusalExamples(type)].map((fixture) => ({ type, fixture })))
    .filter(({ type, fixture }) => selects(only, `${type}/${fixture.id}`));
  const run = (type, fixture, options, theme, setting, widths, height = 'auto', annotations, locale) => {
    let wider;
    for (const width of widths) {
      const previous = wider;
      wider = undefined;
      const item = { fixture: `${type}/${fixture.id}`, width, theme, setting, height, unit: unitFor(type, fixture, options) };
      const request = { type, data: clone(fixture.data), options: { ...clone(options), ...(height === 'auto' ? {} : { target: 'dashboard' }),
        size: { width, ...(height === 'auto' ? {} : { height }) } },
        annotations: clone(annotations ?? fixture.annotations ?? options.annotations ?? []),
        ...(theme === 'authored' ? {} : { theme }), ...(locale ? { locale: { language: locale } } : {}) };
      try {
        const started = performance.now();
        const measured = measure(request);
        findings.push(...auditRepairs(item, request, measured));
        const geometry = measured.geometry;
        if (!geometry) {
          const warnings = measured.refused?.warnings ?? measured.warnings;
          if (!warnings.some((warning) => warning.suggest || warning.fix?.length)) throw new Error('Refusal has no repair suggestion or patch');
          const refusal = { ...item, status: 'refused', codes: warnings.map((warning) => warning.code), fixes: warnings.filter((warning) => warning.suggest || warning.fix?.length).map((warning) => warning.suggest ?? warning.fix) };
          refusals.push(refusal); cases.push({ ...refusal, durationMs: performance.now() - started });
          continue;
        }
        const skipped = [];
        findings.push(...auditGeometry(item, request, geometry, skipped));
        const reading = chartReading({ name: 'scorecard', type, request: resolveChartRequest(request), geometry, claims: [] });
        findings.push(...auditScene(item, request, geometry, reading));
        if (height !== 'auto' || !CARD_WIDTHS.includes(width)) skipped.push({ rule: 'S2', reason: 'outside automatic card widths' });
        else if (S2_EXEMPT.has(type)) skipped.push({ rule: 'S2', reason: 'content height scales with width' });
        else if (!previous || !CARD_WIDTHS.includes(previous.width) || CARD_WIDTHS.indexOf(width) !== CARD_WIDTHS.indexOf(previous.width) + 1) skipped.push({ rule: 'S2', reason: 'no drawn adjacent wider card' });
        findings.push(...auditHeight(item, geometry, previous));
        if (theme === 'authored' && setting === 'default' && height === 'auto' && !locale) {
          readNumbers(type, fixture, width, 'en', measured);
          if (CENSUS_DE_WIDTHS.includes(width)) readNumbers(type, fixture, width, 'de');
        }
        cases.push({ ...item, status: 'drawn', canvas: geometry.size, plot: geometry.plot, text: visibleTextHash(geometry),
          target: request.target ?? request.options.target ?? 'report', sizing: geometry.sizing, skipped, durationMs: performance.now() - started });
        wider = { width, height: geometry.size.height };
      } catch (error) {
        if (error.code && (error.suggest || error.fix?.length || fixture.refuses?.code === error.code)) {
          // Authored refusal examples can carry the repair in their error message.
          findings.push(...auditRepairs(item, request, undefined, error));
          const refusal = { ...item, status: 'refused', codes: [error.code], fixes: [error.suggest ?? error.fix ?? error.message] };
          refusals.push(refusal); cases.push(refusal);
        } else {
          const failure = { ...item, message: error.message ?? String(error) };
          errors.push(failure); cases.push({ ...failure, status: 'error' });
          findings.push({ ...failure, rule: 'S1', severity: 3, subject: 'layout', message: `layout failed before a plot was measured: ${failure.message}` });
        }
      }
    }
  };
  for (const { type, fixture } of fixtures) for (const theme of THEMES) {
    if (outcomeShard({ fixture: `${type}/${fixture.id}`, setting: 'default' }, shards) !== shard) continue;
    run(type, fixture, fixture.options ?? {}, theme, 'default', WIDTHS);
    run(type, fixture, fixture.options ?? {}, theme, 'fixed=400x300', [400], 300);
  }
  let sampledVariants = 0;
  for (const { type } of listCharts()) for (const form of variants[type]?.variants ?? []) {
    const fixture = getFixtures(type).find((fixture) => fixture.id === form.fixture);
    if (!fixture) throw new Error(`Explorer fixture missing: ${type}/${form.fixture}`);
    sampledVariants++;
    if (!selects(only, `${type}/${fixture.id}`)) continue;
    if (outcomeShard({ fixture: `${type}/${fixture.id}`, setting: `${form.id}:locale=de` }, shards) !== shard) continue;
    const options = { ...fixture.options, ...form.options };
    for (const theme of THEMES) {
      for (const setting of settingsFor(type, fixture, form)) run(type, fixture, setting.options, theme, `${form.id}:${setting.name}`, [720, 400], 'auto', setting.annotations);
      // Locale changes library words and wrapping. Keep authored number formats.
      run(type, fixture, options, theme, `${form.id}:locale=de`, [720, 400], 'auto', undefined, 'de');
    }
  }
  return { matrix: { fixtures: fixtures.length, types: listCharts().length, sampledVariants, widths: WIDTHS, themes: THEMES, cases: cases.length }, cases, findings, refusals, errors, census, censusMs };
}

// Keep a fixture's adjacent widths together for S2. Stable ownership also detects
// a removed fixture or setting when checking only one CI shard.
export function outcomeShard(item, shards) {
  const group = item.setting === 'default' || item.setting === 'fixed=400x300' ? 'fixture' : item.setting.split(':')[0];
  return createHash('sha256').update(`${item.fixture}/${group}`).digest().readUInt32BE(0) % shards;
}

export function visibleTextHash(geometry) {
  const strings = geometry.scene.filter(drawn).map((node) => normal(node.lines.join(' '))).sort();
  return createHash('sha256').update(JSON.stringify(strings)).digest('hex').slice(0, 12);
}

// Each JSONL row is [fixture, width, theme, setting, status, refusal codes,
// canvas [width,height], rounded plot [x,y,w,h], visible-text hash, [rule,subject][]].
const outcomeKey = (row) => JSON.stringify(row.slice(0, 4));
const byOutcomeKey = (a, b) => outcomeKey(a) < outcomeKey(b) ? -1 : outcomeKey(a) > outcomeKey(b) ? 1 : 0;
export function outcomes(result) {
  const findings = new Map();
  for (const item of result.findings) {
    const key = outcomeKey([item.fixture, item.width, item.theme, item.setting]);
    const group = findings.get(key) ?? [];
    group.push([item.rule, item.subject]);
    findings.set(key, group);
  }
  return result.cases.map((item) => [item.fixture, item.width, item.theme, item.setting, item.status,
    [...(item.codes ?? [])].sort(), item.canvas ? [item.canvas.width, item.canvas.height] : null,
    item.plot ? [item.plot.x, item.plot.y, item.plot.w, item.plot.h].map(Math.round) : null, item.text ?? null,
    (findings.get(outcomeKey([item.fixture, item.width, item.theme, item.setting])) ?? [])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))])
    .sort(byOutcomeKey);
}

export function compareOutcomes(actual, baseline, job = 1, jobs = 1, only = undefined) {
  const expected = new Map(baseline.filter(([fixture, , , setting]) => selects(only, fixture) &&
    Math.floor(outcomeShard({ fixture, setting }, jobs * 2) / 2) === job - 1).map((row) => [outcomeKey(row), row]));
  const changes = [];
  for (const row of actual) {
    const key = outcomeKey(row), before = expected.get(key);
    if (JSON.stringify(row) !== JSON.stringify(before)) changes.push({ key, before, after: row });
    expected.delete(key);
  }
  for (const [key, before] of expected) changes.push({ key, before, after: undefined });
  return changes.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

const caseKey = (item) => JSON.stringify([item.rule, item.fixture, item.width, item.theme, item.setting]);

export function classify(result, known) {
  const keys = new Set();
  for (const item of known) {
    if (RULES[item.rule] !== 3 || !item.fixture || !WIDTHS.includes(item.width) || !THEMES.includes(item.theme) || !item.setting || !item.unit || !item.reason) throw new Error('Malformed known severity-3 case');
    if (keys.has(caseKey(item))) throw new Error(`Duplicate known case: ${caseKey(item)}`);
    keys.add(caseKey(item));
  }
  const findings = result.findings.map((item) => ({ ...item, status: keys.has(caseKey(item)) ? 'known' : item.severity === 3 ? 'failure' : 'report' }));
  const active = new Set(findings.map(caseKey));
  // A sharded run judges only the known cases it measured.
  const ran = result.cases ? new Set(result.cases.map((item) => caseKey({ ...item, rule: '' }))) : undefined;
  const stale = known.filter((item) => !active.has(caseKey(item)) && (!ran || ran.has(caseKey({ ...item, rule: '' }))));
  const counts = Object.fromEntries(Object.keys(RULES).map((rule) => [rule, {
    severity: RULES[rule], findings: findings.filter((item) => item.rule === rule).length,
    failures: findings.filter((item) => item.rule === rule && item.status === 'failure').length,
    known: findings.filter((item) => item.rule === rule && item.status === 'known').length,
    stale: stale.filter((item) => item.rule === rule).length,
  }]));
  const skips = Object.fromEntries(Object.keys(RULES).filter((rule) => rule.startsWith('S')).map((rule) => {
    const cases = (result.cases ?? []).filter((item) => item.skipped?.some((skip) => skip.rule === rule));
    const byReason = {}, byType = {};
    for (const item of cases) {
      const reason = item.skipped.find((skip) => skip.rule === rule).reason;
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      const type = item.fixture.split('/')[0];
      byType[type] = (byType[type] ?? 0) + 1;
    }
    const partialCases = cases.filter((item) => item.skipped.some((skip) => skip.rule === rule && skip.partial)).length;
    return [rule, { cases: cases.length - partialCases, partialCases, byReason, byType }];
  }));
  // Size refusals at the card widths, per type, on an automatic height.
  const cardRefusals = {};
  for (const item of result.refusals) {
    if (item.height !== 'auto' || ![400, 320].includes(item.width) || !item.codes?.includes('size-below-floor')) continue;
    const type = item.fixture.split('/')[0];
    cardRefusals[type] ??= { 400: 0, 320: 0 };
    cardRefusals[type][item.width]++;
  }
  return { ...result, findings, stale, counts, skips, cardRefusals, failures: findings.filter((item) => item.status === 'failure').length };
}

async function main() {
  const args = process.argv.slice(2);
  const usage = 'Usage: npm run check:scorecard -- [--out <dir>] [--shard <k>/<n>] [--only <type|type/id>,...] [--record]';
  let out, record = false, job = 1, jobs = 1, only;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--record') record = true;
    else if (args[i] === '--only' && args[i + 1]) only = args[++i].split(',').map((entry) => entry.trim()).filter(Boolean);
    else if (args[i] === '--out' && args[i + 1]) out = args[++i];
    else if (args[i] === '--shard' && /^\d+\/\d+$/.test(args[i + 1] ?? '')) [job, jobs] = args[++i].split('/').map(Number);
    else throw new Error(usage);
  }
  if (job < 1 || job > jobs || (record && jobs !== 1) || only?.length === 0) throw new Error(usage);
  // A misspelt entry would select nothing and pass.
  for (const entry of only ?? []) {
    const [type, id, extra] = entry.split('/');
    // Rows carry the type name, not an alias.
    const known = extra === undefined && listCharts().some((chart) => chart.type === type)
      && (id === undefined || [...getFixtures(type), ...getRefusalExamples(type)].some((fixture) => fixture.id === id));
    if (!known) throw new Error(`--only: no fixture ${entry}; name a type or type/id, with the type name, not an alias`);
  }
  const known = JSON.parse(readFileSync(new URL('./layout-scorecard-known.json', import.meta.url), 'utf8'));
  // Two worker shards per run; CI runs the check as several jobs (--shard k/n),
  // each with its own two of the 2n fixture shards. Merge and sort only after
  // both finish. Completion order cannot affect output.
  const parts = await Promise.all([0, 1].map((worker) => (job - 1) * 2 + worker).map((shard) => new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      require('tsx/esm/api').register();
      import(workerData.url);
    `, { eval: true, execArgv: [], workerData: { shard, shards: jobs * 2, only, url: import.meta.url } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`Scorecard worker exited ${code}`)); });
  })));
  const sort = (items) => items.sort((a, b) => {
    const first = JSON.stringify([a.fixture, a.theme, a.setting, a.width, a.rule]);
    const second = JSON.stringify([b.fixture, b.theme, b.setting, b.width, b.rule]);
    return first < second ? -1 : first > second ? 1 : 0;
  });
  const merged = { matrix: { ...parts[0].matrix, cases: parts.reduce((count, part) => count + part.matrix.cases, 0) },
    ...Object.fromEntries(['cases', 'findings', 'refusals', 'errors'].map((key) => [key, sort(parts.flatMap((part) => part[key]))])) };
  const result = classify(merged, known);
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(resolve(out, 'layout-scorecard.json'), JSON.stringify(result, null, 2) + '\n');
  }
  const actual = outcomes(result);
  const baselineDir = new URL('./layout-scorecard-baseline/', import.meta.url);
  let changes = [];
  if (record) {
    if (result.failures) throw new Error('Record refused: explain new severity-3 failures in layout-scorecard-known.json first.');
    mkdirSync(baselineDir, { recursive: true });
    const types = only ? new Set(only.map((entry) => entry.split('/')[0]))
      : new Set([...actual.map((row) => row[0].split('/')[0]), ...readdirSync(baselineDir).filter((file) => file.endsWith('.jsonl')).map((file) => file.slice(0, -6))]);
    for (const type of [...types].sort()) {
      const file = new URL(`${type}.jsonl`, baselineDir);
      // With --only, the rows of the fixtures it did not run stay as recorded.
      const kept = only && existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((row) => !selects(only, row[0])) : [];
      const rows = [...kept, ...actual.filter((row) => row[0].startsWith(`${type}/`))].sort(byOutcomeKey);
      writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    }
    console.log(`Recorded ${actual.length} outcomes in scripts/layout-scorecard-baseline/${only ? ` for ${only.join(', ')}` : ''}.`);
  } else {
    const baseline = readdirSync(baselineDir).filter((file) => file.endsWith('.jsonl')).sort()
      .flatMap((file) => readFileSync(new URL(file, baselineDir), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    changes = compareOutcomes(actual, baseline, job, jobs, only);
    if (out) writeFileSync(resolve(out, 'changes.json'), JSON.stringify(changes, null, 2) + '\n');
    console.log(`Scorecard baseline: ${changes.length ? 'FAIL' : 'PASS'} (${actual.length} cases, ${changes.length} changed).`);
    for (const change of changes) {
      console.error(`CHANGED ${change.key}`);
      console.error(`  - ${JSON.stringify(change.before) ?? '(new case)'}`);
      console.error(`  + ${JSON.stringify(change.after) ?? '(removed case)'}`);
    }
  }
  console.log(`Layout scorecard${jobs > 1 ? ` shard ${job}/${jobs}` : ''}: ${result.matrix.cases} cases; ${result.matrix.types} types; ${result.matrix.fixtures} fixtures; ${result.refusals.length} refusals; ${result.errors.length} errors`);
  console.log('Slowest cases: ' + [...result.cases].filter(item => item.durationMs !== undefined).sort((a, b) => b.durationMs - a.durationMs).slice(0, 5).map(item => `${item.fixture} ${item.width}/${item.theme}/${item.setting}: ${item.durationMs.toFixed(1)} ms`).join('; '));
  console.log(`Card-width size refusals (automatic height) at 400 / 320: ${Object.entries(result.cardRefusals).sort(([a], [b]) => a < b ? -1 : 1).map(([type, n]) => `${type} ${n[400]}/${n[320]}`).join(', ') || 'none'}`);
  for (const [rule, count] of Object.entries(result.counts)) console.log(`${rule} severity ${count.severity}: ${count.findings} findings, ${count.failures} new failures, ${count.known} known, ${count.stale} stale`);
  for (const [rule, skipped] of Object.entries(result.skips)) {
    console.log(`${rule} skipped ${skipped.cases} drawn cases, partly excluded ${skipped.partialCases}: ${JSON.stringify(skipped.byReason)}`);
    console.log(`${rule} skipped types: ${JSON.stringify(skipped.byType)}`);
  }
  const groups = new Map();
  for (const finding of result.findings) {
    const group = groups.get(finding.fixture) ?? [];
    group.push(finding); groups.set(finding.fixture, group);
  }
  for (const [fixture, group] of groups) {
    console.log(`${fixture}: ${group.length} findings (${group.filter((item) => item.status === 'failure').length} new failures, ${group.filter((item) => item.status === 'known').length} known)`);
    for (const finding of group.filter((item) => item.status === 'failure')) console.log(`  ${finding.rule} ${finding.width}/${finding.theme}/${finding.setting}: ${finding.message}`);
  }
  for (const item of result.stale) console.log(`STALE ${item.rule} ${item.fixture} ${item.width}/${item.theme}/${item.setting}: ${item.reason}`);
  for (const item of result.errors) {
    const known = result.findings.some((finding) => finding.rule === 'S1' && finding.status === 'known' && caseKey(finding) === caseKey({ ...item, rule: 'S1' }));
    console.error(`${known ? 'KNOWN' : 'NEW'} layout error ${item.fixture} ${item.width}/${item.theme}/${item.setting}: ${item.message}`);
  }
  // The number gate: every census finding fails unless the exception file names it exactly.
  // Recording never adds one; an exception goes into scripts/number-census-exceptions.json in a reviewed PR.
  const exceptions = existsSync(EXCEPTIONS_FILE) ? JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8')) : [];
  const numbers = parts.flatMap((part) => part.census);
  const numberFailures = unexcepted(numbers, exceptions);
  if (out) writeFileSync(resolve(out, 'number-census.json'), JSON.stringify(numbers, null, 1) + '\n');
  console.log(`Number census: ${numberFailures.length ? 'FAIL' : 'PASS'} (${numbers.length} findings, ${numbers.length - numberFailures.length} excepted, ${numberFailures.length} failures; ${(parts.reduce((ms, part) => ms + part.censusMs, 0) / 1000).toFixed(1)} s in two workers).`);
  for (const finding of numberFailures) console.error(failureLine(finding));
  process.exitCode = result.failures || changes.length || numberFailures.length ? 1 : 0;
}

if (!isMainThread) {
  parentPort.postMessage(scorecard(workerData.shard, workerData.shards, workerData.only));
} else if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message ?? error); process.exitCode = 2; });
}
