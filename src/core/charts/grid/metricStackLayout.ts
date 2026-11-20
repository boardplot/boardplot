import { chartString } from '../../strings/grid';
import { localeStrings } from '../../strings';
/** Parent-owned geometry for the category-sharing metric-stack mode. */
import { categoryBandFromCenters } from '../../annotateFields';
import { notApplicableGlyph } from '../../format';
import { frameTextOptions, normalizeLegendOption, solveFrame, type LegendItemInput } from '../../frame';
import { fmtPathNumber as n } from '../../curve';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { solveLabels, PRIORITY, type LabelRequest } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize } from '../../normalize/shared';
import { generatedIdWarnings, type GeneratedIdKey } from '../../schema/generatedColumns';
import type { JsonPatchOperation } from '../../diagnostics/jsonPatch';
import { partialFootnotes, partialIds, saysToDate } from '../../partialPeriod';
import { disclosureNote, disclosuresShown } from '../../notes';
import { heightOmitted } from '../../sizing';
import { structureCount } from '../../structureCounts';
import { defaultMeasurer, wrapText, type FontSpec } from '../../text';
import { dashToken, strokeToken, canvasMargin, HATCH_STRENGTH_DEFAULT, markRolePaint, resolveTheme, secondaryFont, seriesPaint, themeForWidth } from '../../theme';
import type { Rect } from '../../geometry';
import type { Geometry, LintWarning, Paint, SceneNode, TypographyRole } from '../../types/scene';
import type { OwnerRef } from '../../types/cell';
import type { GridLayoutOptions } from './normalize';
import type { GridMarks, GridDerived } from './layout';
import { computeMetricStack, metricStackGrain, normalizeMetricStack, stackError, stackRange, withCompareWindow, type ComputedStackPanel, type MetricStackData, type StackRange, type StackReadout, type StackState } from './metricStack';
import { maxOf, pushAll } from '../../arrays';
import { withUnprintedClaims } from '../../claims/ids';
import { displayFont } from '../cardRoles';
import { unitOnNumber, withUnit } from '../../unitJoin';

export interface MetricStackDerived {
  gap: number;
  gutterWidth: number;
  axisOwner: string;
  band?: { rect: Rect; panels: string[]; categoryIds: string[]; nodeId: string };
  readouts: StackReadout[];
  panels: { id: string; domain: [number, number]; plot: Rect; values: (number | null)[]; states: StackState[]; displayed: string[]; nodeIds: string[][] }[];
}
const neutral: Paint = { token: 'markInk' };
const muted: Paint = { token: 'inkMuted' };
/** The dashed base line of the focus look and its key in the header line. */
const baseStroke: Paint = { token: 'leader' };
const accent: Paint = { token: 'focus' };
/**
 * The room of one category in the focus look, where the category prints no name: a column of 9 px
 * and the 12 px focus dot with its halo. Only the focus prints its value, on a plate over its neighbours.
 */
const LOOK_CATEGORY_FLOOR = 14;
/** On the period axis, a period label starts 3 px under the last baseline. */
const PERIOD_TICK_TOP = 3;
const wash = (base: Paint, weight: number, pageFloor?: number): Paint =>
  ({ token: 'markInk', theme: { kind: 'mix', from: base, to: { token: 'background' }, weight, ...(pageFloor === undefined ? {} : { pageFloor }) } });

/** A gutter probe: the layout fails unless every label places. */
const GUTTER_PROBE = Symbol('boardplot.metricStackGutterProbe');
/** A fixed canvas too short for the readout gutter: unit beside name, headline and span on one line, tighter spacing. */
const COMPACT_READOUT = Symbol('boardplot.metricStackCompactReadout');
/** The widest authored gutter that still places every label, once a wider one lost a label. */
const GUTTER_LIMIT = Symbol('boardplot.metricStackGutterLimit');
/**
 * The focus look in React: the id of the category the pointer or the keyboard rests on, set on `options.stack`.
 * The stack then draws as it draws with that one category as its compare window.
 */
export const STACK_FOCUS = Symbol.for('boardplot.metricStackFocus');

/** Every focus a stack can draw: its compare window, then each category alone. The layout sizes for the widest. */
const focusStacks = new WeakMap<object, Map<string, ReturnType<typeof computeMetricStack>[]>>();
function everyFocus(data: MetricStackData, raw: object, locale: string | undefined, na: string): ReturnType<typeof computeMetricStack>[] {
  const byLocale = focusStacks.get(raw) ?? new Map<string, ReturnType<typeof computeMetricStack>[]>();
  focusStacks.set(raw, byLocale);
  const key = `${locale ?? ''}\0${na}`;
  let stacks = byLocale.get(key);
  if (!stacks) byLocale.set(key, stacks = [data.windows!.compare, ...data.categories.map(c => ({ from: c.id, to: c.id, label: c.label }))]
    .map(window => computeMetricStack(withCompareWindow(data, window), locale, na, true)));
  return stacks;
}

/** A readout as far as it prints: a hidden seat leaves no claim, and an operand goes with the last figure that used it. */
function printedReadout(readout: StackReadout, showHeadline: boolean, showSpan: boolean, look: boolean): StackReadout {
  if (showHeadline && showSpan) return readout;
  const byId = new Map(readout.claims.map(claim => [claim.id, claim]));
  const kept = new Set<string>();
  const keep = (id: string) => {
    const claim = byId.get(id);
    if (!claim || kept.has(id)) return;
    kept.add(id);
    claim.inputs.forEach(input => keep(input.ref));
  };
  const panel = `stack:${readout.panelId}`;
  if (showHeadline) { keep(`${panel}:headline`); keep(`${panel}:rate`); }
  if (showSpan) { keep(`${panel}:before`); keep(`${panel}:after`); }
  // The focus look prints the value and the shares always.
  if (look) { keep(`${panel}:after`); keep(`${panel}:base`); readout.claims.forEach(claim => { if (/:share:[^:]+$/.test(claim.id.slice(panel.length))) keep(claim.id); }); }
  return { ...readout, claims: readout.claims.filter(claim => kept.has(claim.id)),
    ...(showHeadline ? {} : { headline: null, headlineText: '' }),
    ...(showSpan ? {} : { before: null, ...(look ? {} : { after: null }), spanText: '' }) };
}

/** What the column keys and the look warn on one draw. */
function stackColumnWarnings(stack: NonNullable<GridLayoutOptions['stack']>, narrow: boolean, floored: boolean, capped: boolean, lookIgnored: boolean): LintWarning[] {
  const inStack = (key: GeneratedIdKey, authored: Parameters<typeof generatedIdWarnings>[2], drawn: readonly string[]): LintWarning[] =>
    generatedIdWarnings('grid', key, authored, drawn).map(warning => ({ ...warning, field: ['options', 'stack', ...(warning.field ?? []).slice(1)] }));
  const warnings = [
    ...inStack('columnVisibility', stack.columnVisibility, ['name', 'unit', 'headline', 'span']),
    ...inStack('columnOverrides', stack.columnOverrides, ['gutter']),
    ...inStack('columnOrder', stack.columnOrder, ['gutter', 'plot']),
  ];
  const ignored = (key: string, what: string): LintWarning => ({ code: 'option-ignored', severity: 'warn', field: ['options', 'stack', key],
    message: `this canvas seats each readout above its panel, with no gutter track, so ${what} does nothing here`, suggest: 'Widen the chart to draw the gutter.' });
  if (narrow && stack.columnOverrides?.gutter) warnings.push(ignored('columnOverrides', 'the gutter override'));
  if (narrow && stack.columnOrder?.length) warnings.push(ignored('columnOrder', 'columnOrder'));
  if (floored) warnings.push({ code: 'generated-column-width-floored', severity: 'warn', field: ['options', 'stack', 'columnOverrides', 'gutter', 'width'],
    message: 'the gutter width is under what its readouts need, so the gutter stays as wide as they need', suggest: 'Raise the width, or shorten the panel titles.' });
  if (capped) warnings.push({ code: 'generated-column-width-capped', severity: 'warn', field: ['options', 'stack', 'columnOverrides', 'gutter', 'width'],
    message: 'the gutter width leaves too little room for the values on this canvas, so it gave way', suggest: 'Lower the width, or widen the chart.' });
  if (lookIgnored) warnings.push({ code: 'option-ignored', severity: 'warn', field: ['options', 'stack', 'variant'],
    message: "the focus look compares the base and the compare window, and these panels read a weighted rate (readout { base }), so variant 'focus' does nothing here",
    suggest: "Use readout 'change' with data.windows in every panel, or remove variant." });
  return warnings;
}

export function layoutMetricStack(raw: MetricStackData, options: GridLayoutOptions): Geometry<GridMarks, GridDerived> {
  const data = normalizeMetricStack(raw);
  if (!options.stack) stackError('options.stack', 'Shared measures require options.stack: {}');
  if (options.sharedAxis === 'none' || options.sharedScale === true || options.columns !== undefined || options.gutters !== undefined
    || options.anchors !== undefined || options.alignmentRules !== undefined || options.panelOrder !== undefined) {
    stackError('options', 'A metric stack owns top-down order, shared categories, spacing and independent scales; remove conflicting grid controls');
  }
  const stack = options.stack;
  // The focus look: every panel reads the change between the two windows, and the compare window is the focus.
  const look = stack.variant === 'focus' && data.panels.every(p => p.readout === 'change');
  // In React a pointer or the keyboard moves the focus to one category, which then draws as the compare window.
  const pointed = look ? (stack as { [STACK_FOCUS]?: string })[STACK_FOCUS] : undefined;
  const focusCategory = pointed === undefined ? undefined : data.categories.find(c => c.id === pointed);
  const focusWindow: StackRange | undefined = focusCategory ? { from: focusCategory.id, to: focusCategory.id, label: focusCategory.label } : data.windows?.compare;
  const showUnit = stack.columnVisibility?.unit !== false, showHeadline = stack.columnVisibility?.headline !== false, showSpan = stack.columnVisibility?.span !== false;
  const gutterAfter = (() => { const order = stack.columnOrder ?? [], plotAt = order.indexOf('plot'), gutterAt = order.indexOf('gutter'); return plotAt >= 0 && (gutterAt < 0 || plotAt < gutterAt); })();
  if (stack.heights && options.rows) stackError('options', 'Use stack.heights or rows, not both');
  if (stack.heights && stack.heights.length !== data.panels.length || options.rows && options.rows.length !== data.panels.length) stackError('options', 'Supply one height or row weight per panel');
  // The display sizes of the focus look are not stepped by width class.
  const fullTheme = resolveTheme(options.theme);
  const theme = themeForWidth(fullTheme, resolveSize(options.size).width);
  const measure = options.measure ?? defaultMeasurer;
  const na = notApplicableGlyph(options.strings);
  const computed = computeMetricStack(focusCategory ? withCompareWindow(data, focusWindow!) : data, options.locale?.language, na, look);
  const font = (role: 'label' | 'axis' | 'title' | 'footnote', weight?: number): FontSpec => ({ family: theme.type.family, ...theme.type[role], ...(weight ? { weight } : {}) });
  const valueFont = font('label', 700), nameFont = font('label', 700), unitFont = font('axis'), heroFont = font('title', 700), axisFont = font('axis'), noteFont = font('footnote');
  // The panel unit, the key and the method line take the secondary type step.
  const keyFont = secondaryFont(theme);
  const heightOf = (f: FontSpec) => f.size * (f.lineHeight ?? 1.2);
  // The focus look: the value in a display size, the change in the name's bold and "from" the base value in the label role.
  const largeFont = displayFont(fullTheme, true), smallFont = displayFont(fullTheme, false), changeFont = nameFont, fromFont = font('label');
  const textBox = (text: string, f: FontSpec, width: number) => {
    const lines = wrapText(text, f, width, Number.MAX_SAFE_INTEGER, measure).lines;
    return { lines, w: Math.max(...lines.map(line => measure(line,f).width), 0), h: heightOf(f) * lines.length };
  };
  const NO_BOX = { lines: [] as string[], w: 0, h: 0 };
  const spacingError = (field: string, message: string, fix?: JsonPatchOperation[]): never => { throw new NormalizeError('metric-stack-spacing', field, message, 'Increase the named dimension; the engine does not shrink or overlap required labels.', fix); };
  const heightFix = (i: number, px: number): JsonPatchOperation[] | undefined => stack.heights ? [{ op: 'replace', path: `/options/stack/heights/${i}`, value: px }] : undefined;
  const minGap = Math.ceil(heightOf(axisFont) + 8);
  // The compact readout also tightens the spacing: the panels sit 10 px apart where no maturing band needs the room.
  const compactReadout = (options as { [COMPACT_READOUT]?: boolean })[COMPACT_READOUT] === true;
  const gap = compactReadout && !computed.maturing.length ? 10 : Math.max(26, minGap);
  // Fallback arrow glyphs can be one em wide even when the font table has no arrow.
  const arrowWidth = Math.max(unitFont.size, measure('→', unitFont).width);
  const spanSpace = measure(' ', unitFont).width;
  const spanWidths = computed.panels.map(p => measure(p.readout.spanText, unitFont).width + arrowWidth - measure('→', unitFont).width);
  // The focus look's texts of one focus: the value with a currency sign or % on it, the change, "from" the base value,
  // and the shares of a stacked panel. A focus without a value prints no change line.
  const sign = (p: ComputedStackPanel, text: string) => withUnit(text, unitOnNumber(p.panel.unit), true);
  // "from {v1}": the words around the base value, which prints as a label of its own with its claim.
  const fromTemplate = chartString(options, 'stackFrom', { v1: '\u0000' }), fromAt = fromTemplate.indexOf('\u0000');
  const fromWords = fromAt < 0 ? [`${fromTemplate} `, ''] : [fromTemplate.slice(0, fromAt), fromTemplate.slice(fromAt + 1)];
  const focusText = (p: ComputedStackPanel) => {
    const end = (key: string) => p.readout.claims.find(c => c.id === `stack:${p.panel.id}:${key}`)!.output;
    const after = end('after'), before = end('before'), line = after.raw !== null;
    const base = before.raw === null ? na : sign(p, before.displayed);
    return { value: line ? sign(p, after.displayed) : na, change: line && showHeadline ? p.readout.headlineText : '',
      from: line && showSpan ? `${fromWords[0]}${base}${fromWords[1]}` : '', base: line && showSpan ? base : '', shares: p.shares ?? [] };
  };
  const texts = look ? computed.panels.map(focusText) : [];
  // The layout holds still while the focus moves: the gutter and every panel take the widest text of any focus.
  const variants = look ? everyFocus(data, raw, options.locale?.language, na).map(c => c.panels.map(focusText)) : [];
  const valueFontOf = (i: number, small: boolean) => small || !computed.panels[i]!.panel.emphasis ? smallFont : largeFont;
  const lineWidth = (t: (typeof texts)[number]) => (t.change ? measure(t.change, changeFont).width : 0) + (t.change && t.from ? measure(' ', fromFont).width : 0) + (t.from ? measure(t.from, fromFont).width : 0);
  const hasLine = showHeadline || showSpan;
  const lookWidths = computed.panels.map((_, i) => ({
    value: (small: boolean) => maxOf(variants.map(v => measure(v[i]!.value, valueFontOf(i, small)).width)),
    line: maxOf(variants.map(v => lineWidth(v[i]!))),
    share: maxOf(variants.flatMap(v => v[i]!.shares.map(share => measure(share.text, keyFont).width))),
  }));
  const minGutter = look
    ? Math.ceil(Math.max(120, maxOf(computed.panels.map((p,i) => Math.max(lookWidths[i]!.value(false), lookWidths[i]!.line,
      ...(showUnit ? `${p.panel.title} ${p.panel.unit}` : p.panel.title).split(/\s+/).map(word => measure(word, nameFont).width))))) + 4)
    : Math.ceil(Math.max(120, maxOf(computed.panels.map((p,i) => Math.max(showSpan ? spanWidths[i]! : 0, showHeadline ? measure(p.readout.headlineText, heroFont).width : 0,
    ...(showUnit ? `${p.panel.title} ${p.panel.unit}` : p.panel.title).split(/\s+/).map(word => measure(word, nameFont).width))))) + 4);
  const nameWidth = Math.ceil(maxOf(computed.panels.flatMap(p => p.panel.title.split('\n').map(line => measure(line, nameFont).width)))) + 4;
  // Keep normal names on one line; cap name-driven growth so prose still wraps.
  // A compact readout holds the headline and the span on one line; the span sits on the headline's baseline and ends below the headline's own height.
  const heroBlock = !showHeadline ? (showSpan ? heightOf(unitFont) : 0) : !showSpan ? heroFont.size : Math.max(heroFont.size, heightOf(heroFont) / 2 + heightOf(unitFont) / 2 + 0.36 * (heroFont.size - unitFont.size));
  const oneLine = (p: ComputedStackPanel, i: number) => !showHeadline ? (showSpan ? spanWidths[i]! : 0) : !showSpan ? measure(p.readout.headlineText, heroFont).width : measure(p.readout.headlineText, heroFont).width + 3 * spanSpace + spanWidths[i]!;
  // A compact focus look holds the value and its change line on one line.
  const lookLine = (i: number) => lookWidths[i]!.value(true) + (hasLine ? 3 * spanSpace + lookWidths[i]!.line : 0);
  const compactFloor = !compactReadout ? 0 : Math.ceil(maxOf(computed.panels.map((p, i) => look ? lookLine(i) : oneLine(p, i))) + 4);
  // The focus look keeps the name and the unit on one line where a gutter of at most 320 px holds them.
  const nameUnitWidth = look ? Math.ceil(maxOf(computed.panels.map(p => measure(p.panel.title, nameFont).width + (showUnit ? 2 * spanSpace + measure(p.panel.unit, keyFont).width : 0)))) + 4 : 0;
  const defaultGutter = Math.max(170, minGutter, Math.min(320, Math.max(nameWidth, nameUnitWidth)), compactFloor);
  // The focus look prints each panel's base level at the left end of its dashed base line, 8 px left of the plot,
  // as a bare number like the marks. The air between the readout and the plot holds the widest of them.
  const baseFont = font('label');
  const baseLevel = (p: ComputedStackPanel): number | null => p.readout.claims.find(c => c.id === `stack:${p.panel.id}:base${'denominator' in p.panel.measure ? ':raw' : ''}`)?.output.raw ?? null;
  const baseTexts = computed.panels.map(p => { const v = look ? baseLevel(p) : null; return v === null ? undefined : p.format(v); });
  const baseRoom = look ? Math.ceil(maxOf(baseTexts.map(t => t === undefined ? 0 : measure(t, baseFont).width)) + 8) : 0;
  const gutterGap = Math.max(28, heightOf(axisFont), look ? baseRoom + 4 : 0);
  const partial = partialIds(data.categories);
  const notes = [...(options.footnotes || [])];
  // A state note the engine words prints, with its marker, only where
  // `notes.show` lists 'disclosure'; else it stays in the notes list unmarked.
  const listed: string[] = [];
  const stateNotes: { maturing?: number; partial?: number } = {};
  const engineNumbers: number[] = [];
  const notesOff = frameTextOptions(options).footnotesOff;
  const stateNote = (state: 'maturing' | 'partial', authored: string | undefined, engine: () => string) => {
    // With footnotes off no value carries a marker, so an engine note prints unnumbered or not at all.
    if (authored === undefined && (!disclosuresShown(options) || notesOff)) { listed.push(disclosureNote(engine())); return; }
    stateNotes[state] = notes.length + 1;
    if (authored === undefined) engineNumbers.push(notes.length + 1);
    notes.push(authored ?? engine());
  };
  if (computed.maturing.length) stateNote('maturing', data.states?.maturing?.footnote, () => chartString(options, 'maturingCohortNote'));
  if (partial.size) stateNote('partial', data.states?.partial?.footnote, () => partialFootnotes(data.categories, options.strings)[0]!);
  const marker = (value: number | undefined) => value === undefined || notesOff ? '' : String(value).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]).join('');
  const visibleValue = (p: ComputedStackPanel, i: number) => p.values[i] !== null;
  const hasProvisional = computed.panels.some(p => p.states.some((state, i) => state !== 'mature' && visibleValue(p, i)));
  const hasMatureLine = (p: ComputedStackPanel) => p.panel.type === 'line' && p.states.some((state, i) =>
    i > 0 && state === 'mature' && p.states[i - 1] === 'mature' && visibleValue(p, i) && visibleValue(p, i - 1));
  // A keyed measure keeps one paint across panel order and emphasis. The ramp restarts per panel,
  // so a later panel's measures do not all land on the faintest step: in first-seen order, a measure
  // takes the first step that no measure it shares any stacked panel with holds.
  const measureIndexes = new Map<string, number>();
  const emphasizedMeasures = new Set<string>();
  const companions = new Map<string, Set<string>>();
  for (const p of computed.panels) if (p.panel.type === 'column' && 'sum' in p.panel.measure && p.parts.length > 1) {
    for (const id of p.panel.measure.sum) {
      const set = companions.get(id) ?? new Set<string>();
      p.panel.measure.sum.forEach(other => { if (other !== id) set.add(other); });
      companions.set(id, set);
      if (p.panel.emphasis) emphasizedMeasures.add(id);
    }
  }
  for (const [id, others] of companions) {
    const taken = new Set([...others].flatMap(other => measureIndexes.has(other) ? [measureIndexes.get(other)!] : []));
    let i = 0;
    while (taken.has(i)) i++;
    measureIndexes.set(id, i);
  }
  const columnFill = seriesPaint(0, options.palette);
  const emphasizedFill = markRolePaint('focus', true);
  const measurePaints = new Map([...measureIndexes].map(([id, i]) => {
    const base = emphasizedMeasures.has(id) ? emphasizedFill : columnFill;
    return [id, {
      // A later measure steps back into the page but keeps the 1.4:1 mark floor, as a faded series does.
      mature: i === 0 ? base : wash(base, Math.max(0.16, 0.45 - i * 0.12), 1.4),
    }];
  }));
  // The focus look paints a category by its state: the focus in the accent, the base window in the strong neutral,
  // every other category in the light neutral. A stacked column takes the state's ramp, decided in the theme painted in.
  const focusIndexes = new Set(look ? stackRange(data, focusWindow!) : []), baseIndexes = new Set(look ? stackRange(data, data.windows!.base) : []);
  const stateOf = (ci: number) => focusIndexes.has(ci) ? 'focus' as const : baseIndexes.has(ci) ? 'base' as const : 'rest' as const;
  const stateToken = { focus: 'focus', base: 'neutralMark', rest: 'rest' } as const;
  const statePaint = (state: 'focus' | 'base' | 'rest', index: number, count: number): Paint =>
    count < 2 ? { token: stateToken[state] } : { token: stateToken[state], theme: { kind: 'focus-ramp', state, index, count } };
  // A stacked panel keys its measures inside its own readout. Its band label,
  // hatch and dashed outline carry the provisional state, so it needs no key.
  const stacked = (p: ComputedStackPanel) => p.panel.type === 'column' && 'sum' in p.panel.measure && p.parts.length > 1;
  // Each stacked panel keys every measure it draws, also one an earlier panel keyed.
  const panelKeys = computed.panels.map(() => [] as { id: string; label: string; paint: Paint }[]);
  const seen = new Set<string>();
  computed.panels.forEach((p, pi) => { if (stacked(p) && 'sum' in p.panel.measure) {
    const count = p.panel.measure.sum.length;
    p.panel.measure.sum.forEach((id,i) => { if (p.parts[i]!.some((value, ci) => value !== null && value > 0 && visibleValue(p, ci))) { seen.add(id); panelKeys[pi]!.push({ id, label: data.measures.find(m=>m.id===id)!.label, paint: look ? statePaint('focus', i, count) : measurePaints.get(id)!.mature }); } });
  } });
  if (options.legend === 'none') panelKeys.forEach(items => items.splice(0));
  const totalsCue = chartString(options, 'labelsShowTotals');
  // The focus look keys its rows closer: one measure, its label and its share per row.
  const keySwatch = 10, keyRow = heightOf(keyFont) + (compactReadout ? 0 : look ? 4 : 6);
  // Key items in reading order. A gutter key is one item per row; an above-panel key fills rows across the plot width.
  // A label wider than the key area wraps to it and takes its own rows.
  // A stacked panel reserves the totals cue: whether its segment values fit is known only once its plot is drawn.
  // A word wider than the key area breaks between characters and ends its line with a hyphen; a key
  // label is never cut with an ellipsis. An authored newline still breaks the line, and words joined
  // by a no-break space (U+00A0, U+202F) stay together unless they alone are wider than the key area.
  const breakWords = (text: string, width: number) => text.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const word of paragraph.split(/[^\S  ]+/).filter(Boolean)) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined, keyFont).width <= width) { line = joined; continue; }
      if (line) lines.push(line);
      line = '';
      for (const char of word) {
        if (line && measure(`${line}${char}-`, keyFont).width > width) { lines.push(`${line}-`); line = ''; }
        line += char;
      }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  });
  // The focus look keys no totals: each row ends in its measure's share, right-aligned in one column of the widest share.
  const keyLayout = (pi: number, width: number, column: boolean) => {
    const shareW = look ? lookWidths[pi]!.share : 0, tail = shareW ? (column ? 12 : 6) + shareW : 0;
    const items = [...panelKeys[pi]!, ...(!look && panelKeys[pi]!.length ? [{ id: 'stack:totals', label: totalsCue, paint: undefined }] : [])].map(item => {
      const inset = item.paint ? keySwatch + 5 : 0, room = Math.max(1, width - inset - tail), wrapped = wrapText(item.label, keyFont, room, Number.MAX_SAFE_INTEGER, measure);
      const lines = wrapped.truncated ? breakWords(item.label, room) : wrapped.lines, textW = Math.max(...lines.map(line => measure(line, keyFont).width));
      return { ...item, lines, textW, w: inset + textW + tail, extra: (lines.length - 1) * heightOf(keyFont), shareRight: inset + textW + tail };
    });
    // In a column the shares share one right edge.
    const labelColumn = look && column ? maxOf(items.map(item => item.textW)) : 0;
    if (labelColumn) items.forEach(item => { item.w = item.shareRight = keySwatch + 5 + labelColumn + tail; });
    let x = 0, dy = 0, rowExtra = 0;
    const placed = items.map((item, i) => {
      if (i > 0 && (column || rowExtra > 0 || item.extra > 0 || x + item.w > width)) { x = 0; dy += keyRow + rowExtra; rowExtra = 0; }
      const at = { ...item, dx: x, dy };
      x += item.w + 14; rowExtra = Math.max(rowExtra, item.extra);
      return at;
    });
    return { placed, h: items.length ? dy + keyRow + rowExtra : 0 };
  };
  // A key caption, such as "By plan", over the key of a stacked panel.
  const captionBox = (pi: number, width: number) => data.panels[pi]!.keyTitle && panelKeys[pi]!.length ? textBox(data.panels[pi]!.keyTitle!, keyFont, width) : NO_BOX;
  const captionRoom = (pi: number, width: number) => { const box = captionBox(pi, width); return box.h ? box.h + 2 : 0; };
  const legend: LegendItemInput[] = [];
  // The focus look keys only its provisional marks above the chart.
  if (look) { if (hasProvisional) legend.push({ id: 'stack:provisional', label: chartString(options, 'provisional'), paint: muted, key: 'line', dash: dashToken(theme, 'reference') }); }
  else if (!seen.size) {
    if (hasProvisional && computed.panels.some(p => !p.panel.emphasis && hasMatureLine(p))) {
      legend.push({ id: 'stack:mature', label: chartString(options, 'matureCohort'), paint: neutral, key: 'line' });
    }
    const emphasis = computed.panels.find(p => p.panel.emphasis && hasMatureLine(p));
    if (emphasis) legend.push({ id: 'stack:emphasis', label: emphasis.panel.title, paint: accent, key: 'line', width: strokeToken(theme, 'focus') });
    if (hasProvisional) legend.push({ id: 'stack:provisional', label: chartString(options, 'provisional'), paint: muted, key: 'line', dash: dashToken(theme, 'reference') });
  }
  let size = resolveSize(options.size);
  const automatic = heightOmitted(options.size);
  // A metric stack keeps at most 24 px side margins at every width; an authored margin still wins.
  const base = canvasMargin(theme, size.width);
  const margin = { ...base, left: Math.min(24, base.left), right: Math.min(24, base.right), ...options.margin };
  const frameAt = () => {
    const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
    const frame = solveFrame({ size, margin, ...frameTextOptions(options), footnotes: [...notes, ...listed], numberedFootnotes: notes, unreferencedNotes: [], numberedDisclosures: engineNumbers,
      // A state note a marker points at prints with it (an engine-worded one where notes.show lists 'disclosure').
      pointedNotes: [...frameTextOptions(options).pointedNotes ?? [], ...Object.values(stateNotes).map(n => notes[n - 1]!)],
      legend: options.legend === 'none' ? undefined : { options: normalizeLegendOption(options.legend, { position: 'top' }), items: legend }, theme, measure }, occupied);
    return { occupied, frame };
  };
  if (automatic) size = { ...size, height: Math.max(size.height, 1600) };
  let { occupied, frame } = frameAt();
  const valueWidth = maxOf(computed.panels.flatMap(p => p.values.map(v => v === null ? measure(na,valueFont).width : measure(p.format(v), valueFont).width))) + 4;
  // A column also holds its category name with 3 px to spare.
  const categoryWidth = maxOf(data.categories.flatMap(c => c.label.split(/\s+/).map(word => measure(word, keyFont).width))) + 3;
  // The focus look with periods makes the period row the axis: no category prints its name. A category of the
  // focus look needs room for its mark, and for its name where names print.
  const periodAxis = look && data.periods !== undefined;
  const valueRoom = (look ? Math.max(LOOK_CATEGORY_FLOOR, periodAxis ? 0 : categoryWidth) : Math.max(20, valueWidth, categoryWidth)) * data.categories.length;
  // Names thinned to every second category halve their room; the marks of the focus look keep their floor.
  const thinnedRoom = Math.max(valueRoom / 2, look ? LOOK_CATEGORY_FLOOR * data.categories.length : 0);
  // Where the readout gutter leaves too little room for the values, each
  // readout moves above its panel and the plot takes the full width.
  const unitBox = (p: ComputedStackPanel, width: number) => (showUnit ? textBox(p.panel.unit, keyFont, width) : NO_BOX);
  const gutterAt = (width: number) => {
    const boxes = computed.panels.map(p => {
      const name = textBox(p.panel.title, nameFont, width), unit = unitBox(p, width);
      // A compact readout, and the focus look, put the unit beside the name where both stay on one line.
      const beside = showUnit && (compactReadout || look) && name.lines.length === 1 && unit.lines.length === 1 && name.w + 2 * spanSpace + unit.w <= width;
      return { name, unit, beside, top: beside ? Math.max(name.h, unit.h) : showUnit ? name.h + 2 + unit.h : name.h };
    });
    const keys = computed.panels.map((_, i) => keyLayout(i, width, !compactReadout));
    const heights = boxes.map((box, i) => {
      const captioned = keys[i]!.h ? captionRoom(i, width) : 0;
      // The focus look: the value, then the change line (beside the value in a compact readout), then the key.
      if (look) {
        const lineH = hasLine ? heightOf(changeFont) : 0, keyed = keys[i]!.h ? 6 + captioned + keys[i]!.h : 0;
        if (compactReadout) return box.top + 4 + Math.max(heightOf(smallFont), lineH) + keyed;
        return box.top + 4 + heightOf(valueFontOf(i, false)) + (lineH ? 4 + lineH : 0) + keyed;
      }
      if (compactReadout) return box.top + 4 + heroBlock + captioned + keys[i]!.h - (heroBlock ? 0 : 4);
      const keyed = keys[i]!.h ? captioned + keys[i]!.h + 6 : 0;
      if (showUnit && showHeadline && showSpan) return box.name.h + box.unit.h + heightOf(heroFont) + heightOf(unitFont) + 18 + keyed;
      return box.top + (showHeadline ? 10 + heightOf(heroFont) : 0) + (showSpan ? (showHeadline ? 6 : 10) + heightOf(unitFont) : 0) + keyed;
    });
    return { boxes, keys, heights };
  };
  const atDefault = gutterAt(defaultGutter);
  // A readout also moves above its panel where its gutter block is taller than an authored plot height.
  // The authored gutter does not change this choice.
  const narrow = frame.plot.w - defaultGutter - gutterGap < valueRoom || atDefault.heights.some((h, i) => stack.heights !== undefined && Math.ceil(h) > stack.heights[i]!);
  const authoredGutter = narrow ? undefined : stack.columnOverrides?.gutter?.width;
  const widest = frame.plot.w - gutterGap - valueRoom;
  // A narrower gutter that makes a readout taller gives way on a canvas or plot that cannot grow.
  const heldHeight = !automatic || stack.heights !== undefined || options.rows !== undefined;
  const fitGutter = (width: number) => {
    const at = gutterAt(width);
    return !heldHeight || at.heights.every((h, i) => h <= atDefault.heights[i]!) ? at : undefined;
  };
  const wanted = authoredGutter === undefined ? defaultGutter : Math.min(Math.max(authoredGutter, minGutter, compactFloor), widest, (options as { [GUTTER_LIMIT]?: number })[GUTTER_LIMIT] ?? Infinity);
  const fitted = wanted === defaultGutter ? atDefault : fitGutter(wanted);
  const gutter = fitted ? wanted : defaultGutter;
  const { boxes: gutterBoxes, keys: gutterKeys, heights: gutterHeights } = fitted ?? atDefault;
  const gutterFloored = authoredGutter !== undefined && gutter > authoredGutter;
  const gutterCapped = authoredGutter !== undefined && gutter < authoredGutter;
  // Where even the full width is too little, values and category names thin
  // to every second category, counted back from the latest one.
  const onRight = gutterAfter && !narrow;
  // A plot at the left edge of the frame moves right by the room of the base labels.
  const inset = narrow || onRight ? baseRoom : 0;
  const thin = narrow && !periodAxis && frame.plot.w - inset < valueRoom;
  const lastIndex = data.categories.length - 1;
  const named = (ci: number) => !thin || ci % 2 === lastIndex % 2;
  const plotX = narrow || onRight ? frame.plot.x + inset : frame.plot.x + gutter + gutterGap, plotW = narrow ? frame.plot.w - inset : frame.plot.w - gutter - gutterGap - inset;
  // Where the readout text sits: the gutter track, or the full width above a panel, which reads no gutter setting.
  const trackX = onRight ? frame.plot.x + plotW + gutterGap : frame.plot.x;
  const trackW = narrow ? frame.plot.w : gutter;
  const trackAlign = narrow ? undefined : stack.columnOverrides?.gutter?.align;
  const seat = (w: number) => (trackAlign === 'right' ? trackX + trackW - w : trackAlign === 'center' ? trackX + (trackW - w) / 2 : trackX);
  const step = plotW / data.categories.length;
  const minimumWidth = Math.ceil(size.width - plotW + (thin ? thinnedRoom : valueRoom));
  // Let the shared sizing pass verify the wider frame and return its size fix.
  const needsWidth = (width: number): Geometry<GridMarks, GridDerived> => ({ type:'grid',size,plot:frame.plot,scene:[],labels:[],axes:[],annotations:[],frame:frame.frame,marks:{panels:[]},derived:{},
    sizing:{aspect:'content',fit:'content',minWidth:width,minHeight:0,measuredMinWidth:width,measuredMinHeight:0,naturalWidth:width,naturalHeight:size.height,comfortableWidth:width,comfortableHeight:size.height},
    a11y:{title:chartString(options, 'metricStack'),desc:chartString(options, 'metricStackWidth', { v1: width })},warnings:[],debug:{occupied:[],decisions:[]} });
  if (size.width < minimumWidth) return needsWidth(minimumWidth);
  // A narrow readout: name and unit on one row, headline and span on the next, each pair side by side where it fits.
  const heads = !narrow ? undefined : computed.panels.map((p,i) => {
    const name = textBox(p.panel.title, nameFont, frame.plot.w), unit = unitBox(p, frame.plot.w);
    const unitBeside = showUnit && name.lines.length === 1 && unit.lines.length === 1 && name.w + 2 * spanSpace + unit.w <= frame.plot.w;
    const captioned = captionRoom(i, frame.plot.w);
    if (look) {
      // The focus look above a panel: the value, the change and the base value on one line where they fit.
      const spanBeside = hasLine && lookLine(i) <= frame.plot.w;
      const top = unitBeside ? Math.max(name.h, unit.h) : showUnit ? name.h + 2 + unit.h : name.h;
      const body = top + 8 + heightOf(smallFont) + (!hasLine || spanBeside ? 0 : 6 + heightOf(changeFont)) + 6;
      const key = keyLayout(i, frame.plot.w, false);
      return { name, unit, unitBeside, spanBeside, top, key, body, h: body + (key.h ? captioned + key.h + 4 : 0) };
    }
    const hero = measure(p.readout.headlineText, heroFont).width;
    const spanBeside = showHeadline && showSpan && hero + 3 * spanSpace + spanWidths[i]! + 2 * spanSpace <= frame.plot.w;
    const top = unitBeside ? Math.max(name.h, unit.h) : showUnit ? name.h + 2 + unit.h : name.h;
    const block = !showHeadline ? (showSpan ? heightOf(unitFont) : 0) : !showSpan ? heightOf(heroFont) : heightOf(heroFont) + (spanBeside ? 0 : 6 + heightOf(unitFont));
    const key = keyLayout(i, frame.plot.w, false), body = !block ? top + 6 : showHeadline && showSpan ? top + 8 + heightOf(heroFont) + (spanBeside ? 0 : 6 + heightOf(unitFont)) + 6 : top + 8 + block + 6;
    return { name, unit, unitBeside, spanBeside, top, key, body, h: body + (key.h ? captioned + key.h + 4 : 0) };
  });
  const minimumHeights = gutterHeights.map(h => Math.ceil(Math.max(narrow ? 0 : h, 3 * heightOf(valueFont) + 20)));
  // Narrow plots default lower: the readout no longer sets their height.
  let heights = computed.panels.map((p,i) => stack.heights?.[i] ?? Math.max(minimumHeights[i]!, p.panel.type === 'column' ? p.parts.length > 1 ? narrow ? 110 : 150 : narrow ? 120 : 200 : narrow ? 90 : 130));
  if (options.rows) {
    const factor = maxOf(minimumHeights.map((h,i) => h / options.rows![i]!));
    heights = options.rows.map(w => w * factor);
  }
  // One refusal for every panel under its floor: a patch that raised one panel would leave the next one refused.
  const short = heights.flatMap((h,i) => !Number.isFinite(h) || h < minimumHeights[i]! ? [i] : []);
  if (short.length) {
    const fix = stack.heights ? short.flatMap(i => heightFix(i, minimumHeights[i]!)!) : undefined;
    spacingError(`options.stack.heights.${short[0]}`, `${short.map(i => `Panel '${data.panels[i]!.id}' needs at least ${minimumHeights[i]} px`).join(', ')} for its readout and value labels`, fix);
  }
  const headRoom = heads?.reduce((sum, head) => sum + head.h, 0) ?? 0;
  const partialOnValues = computed.panels.some(p => p.panel.type === 'column' && computed.partial.some(i => p.values[i] !== null));
  // A running period with no marker to point at its note says "to date" on its axis name.
  const partialMark = marker(stateNotes.partial);
  const toDate = ` ${options.strings?.toDate ?? localeStrings(options.locale?.language).toDate}`;
  const categoryName = (c: (typeof data.categories)[number]) => c.label + (!c.partial ? '' : !partialMark ? (saysToDate(c.label, toDate.trim()) ? '' : toDate) : partialOnValues ? '' : partialMark);
  const categoryBoxes = data.categories.map(c => periodAxis ? NO_BOX : textBox(categoryName(c), keyFont, (thin ? 2 : 1) * step - 3));
  const categoryHeight = maxOf(categoryBoxes.map(b=>b.h));
  const periodBoxes = data.periods?.map(period => {
    const indexes = stackRange(data, period);
    // On the period axis every label is muted and plain, set 5 px after its tick.
    const bold = !periodAxis && (data.windows ? [data.windows.base, data.windows.compare].some(w => w.from === period.from && w.to === period.to) : indexes.every(i => computed.mature.includes(i)));
    const f = { ...keyFont, weight: bold ? 700 : keyFont.weight };
    return { ...textBox(period.label, f, indexes.length * step - (periodAxis ? 7 : 4)), indexes, bold, font: f };
  });
  const axisHeight = periodAxis ? PERIOD_TICK_TOP + maxOf(periodBoxes!.map(b=>b.h)) + (compactReadout ? 4 : 10)
    : (compactReadout ? 8 : 12) + categoryHeight + (periodBoxes ? 10 + maxOf(periodBoxes.map(b=>b.h)) : 0) + (compactReadout ? 4 : 10);
  const bandFirstIndex = data.states?.maturing ? data.panels.findIndex(p=>data.states!.maturing!.panels.includes(p.id)) : -1;
  const firstOverhang = computed.maturing.length ? gap : 0;
  // The method line explains the headline and the span: it goes with the last of them. The focus look's header always prints.
  const hasMethod = showHeadline || showSpan || look;
  const readLogic = data.panels.some(p => p.readout === 'change') && data.windows
    ? chartString(options, showHeadline ? 'stackChangeMethod' : 'stackAverageMethod', { v1: metricStackGrain(data), v2: data.windows.base.label, v3: data.windows.compare.label })
    : chartString(options, `stack${narrow ? 'Above' : onRight ? 'Right' : 'Left'}${!showSpan ? 'Rates' : !showHeadline ? 'Remaining' : 'Method'}` as const);
  // The focus look's header line: the focus label, "against", a dashed key in the stroke of the base line and
  // the base window's label, then a second sentence where a window holds more than one category.
  const focusLabelFont: FontSpec = { ...keyFont, weight: 700 };
  const header = !look ? undefined : (() => {
    const sp = measure(' ', keyFont).width, dashW = 18;
    const against = chartString(options, 'stackAgainst'), base = data.windows!.base.label;
    const widest = maxOf([data.windows!.compare.label, ...data.categories.map(c => c.label)].map(label => measure(label, focusLabelFont).width));
    const tail = sp + measure(against, keyFont).width + sp + dashW + sp + measure(base, keyFont).width;
    const several = (range: StackRange) => stackRange(data, range).length > 1;
    // Room for the sentence wherever a focus prints it: the authored windows hold it; a single category may not.
    const averages = several(data.windows!.base) || several(data.windows!.compare) ? chartString(options, 'stackAverages', { v1: metricStackGrain(data) }) : '';
    const shown = several(data.windows!.base) || several(focusWindow!);
    const sentence = averages ? textBox(averages, keyFont, frame.plot.w) : NO_BOX;
    const beside = sentence.lines.length === 1 && widest + tail + 2 * sp + sentence.w <= frame.plot.w;
    return { sp, dashW, against, base, averages: shown ? averages : '', sentence, beside, h: heightOf(keyFont) + (averages && !beside ? sentence.h : 0) };
  })();
  const readLogicBox = header ? { lines: [] as string[], w: frame.plot.w, h: header.h } : hasMethod ? textBox(readLogic, keyFont, frame.plot.w) : NO_BOX;
  const headerRoom = hasMethod ? readLogicBox.h + 12 + (compactReadout ? 4 : 30) : 0;
  const topRoom = headerRoom + (bandFirstIndex === 0 ? firstOverhang : 0);
  const neededPlotHeight = topRoom + headRoom + heights.reduce((a,b)=>a+b,0) + gap*(heights.length-1) + axisHeight;
  const overhead = size.height-frame.plot.h;
  const naturalHeight = Math.ceil(overhead+neededPlotHeight);
  // Default plot heights give way to the readout floor on a fixed canvas; an authored height or row weight does not.
  const shrinks = !stack.heights && !options.rows;
  const floorPlotHeight = neededPlotHeight - heights.reduce((a,b)=>a+b,0) + minimumHeights.reduce((a,b)=>a+b,0);
  const floorHeight = shrinks ? Math.ceil(overhead+floorPlotHeight) : naturalHeight;
  let minHeight = naturalHeight;
  if (automatic) { size = { ...size, height: naturalHeight }; ({ occupied, frame } = frameAt()); }
  else if (frame.plot.h < neededPlotHeight-0.01) {
    if (shrinks && frame.plot.h >= floorPlotHeight-0.01) {
      const share = neededPlotHeight > floorPlotHeight ? (frame.plot.h-floorPlotHeight)/(neededPlotHeight-floorPlotHeight) : 0;
      heights = heights.map((h,i) => minimumHeights[i]! + (h-minimumHeights[i]!)*share);
      minHeight = floorHeight;
    } else {
      if (shrinks && !narrow && !compactReadout) {
        // The gutter block sets the floor: retry with the unit beside the name, the headline and span on one line, and tighter spacing.
        try {
          const compact = layoutMetricStack(raw, { ...options, [COMPACT_READOUT]: true } as GridLayoutOptions);
          if (compact.scene.length > 0 || compact.sizing!.minWidth <= size.width && compact.sizing!.minHeight < floorHeight) return compact;
        } catch (error) { if (!(error instanceof NormalizeError)) throw error; }
      }
      // The common sizing pass probes a fixed frame even for width-only input.
      // Return its measured floor before attempting labels outside that frame.
      return { type:'grid',size,plot:frame.plot,scene:[],labels:[],axes:[],annotations:[],frame:frame.frame,marks:{panels:[]},derived:{},
        sizing:{aspect:'content',fit:'content',minWidth:size.width,minHeight:floorHeight,measuredMinWidth:size.width,measuredMinHeight:floorHeight,naturalWidth:size.width,naturalHeight,comfortableWidth:size.width,comfortableHeight:naturalHeight},
        a11y:{title:chartString(options, 'metricStack'),desc:chartString(options, 'metricStackHeight', { v1: floorHeight })},warnings:[],debug:{occupied:[],decisions:[]} };
    }
  }
  else if (!stack.heights && frame.plot.h > neededPlotHeight) {
    const available = frame.plot.h-topRoom-headRoom-gap*(heights.length-1)-axisHeight;
    const total = heights.reduce((a,b)=>a+b,0);
    heights = heights.map(h=>h*available/total);
  }
  const scene: SceneNode[] = [...frame.nodes];
  const requests: LabelRequest[] = [];
  const inks = new Map<string,Paint>();
  const put = (id: string, text: string, f: FontSpec, rect: Rect, owner: OwnerRef, ink: Paint, role: TypographyRole = 'label', kind: LabelRequest['kind'] = 'point', lines = [text], claimId?: string, below?: number) => {
    if (rect.w > 0 && rect.h > 0) {
      // A line value may drop below its point where a segment crosses the slot above.
      const candidates = [{slot:'fixed' as const,rect,penalty:0}, ...(below === undefined ? [] : [{slot:'fixed' as const,rect:{...rect,y:below},penalty:1}])];
      requests.push({ id, kind, owner, text, lines, font:f, typeRole: role, priority: PRIORITY.total, pad:0, candidates, ...(claimId ? {claimIds: [claimId]} : {}) });
      inks.set(id,ink);
    }
  };
  const centerText = (id:string, text:string, f:FontSpec, x:number, y:number, owner:OwnerRef, ink:Paint, role:TypographyRole='label', kind:LabelRequest['kind']='point', claimId?:string, below?:number) => {
    const box=measure(text,f); put(id,text,f,{x:x-box.width/2,y,w:box.width,h:heightOf(f)},owner,ink,role,kind,[text],claimId,below);
  };
  if (header) {
    const at = (text: string, f: FontSpec) => ({ w: measure(text, f).width, h: heightOf(f) });
    const lineY = frame.plot.y;
    let hx = frame.plot.x;
    const focus = at(focusWindow!.label, focusLabelFont);
    // The label role keeps the full ink, as a panel name does; a secondary annotation would print muted.
    put('stack:focus', focusWindow!.label, focusLabelFont, { x: hx, y: lineY, ...focus }, {}, { token: 'ink' }, 'label', 'annotation');
    hx += focus.w + header.sp;
    const against = at(header.against, keyFont);
    put('stack:against', header.against, keyFont, { x: hx, y: lineY, ...against }, {}, muted, 'secondary', 'annotation');
    hx += against.w + header.sp;
    scene.push({ t: 'line', id: 'stack:base-key', x1: hx, x2: hx + header.dashW, y1: lineY + heightOf(keyFont) / 2, y2: lineY + heightOf(keyFont) / 2, stroke: baseStroke, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference'), owner: {}, part: 'baseKey' });
    hx += header.dashW + header.sp;
    const base = at(header.base, keyFont);
    put('stack:base-window', header.base, keyFont, { x: hx, y: lineY, ...base }, {}, muted, 'secondary', 'annotation');
    hx += base.w;
    if (header.averages) {
      const box = header.sentence;
      put('stack:averages', header.averages, keyFont, header.beside ? { x: hx + 2 * header.sp, y: lineY, w: box.w, h: box.h } : { x: frame.plot.x, y: lineY + heightOf(keyFont), w: box.w, h: box.h }, {}, muted, 'secondary', 'annotation', box.lines);
    }
  } else put('stack:read-logic', readLogic, keyFont, {x:frame.plot.x,y:frame.plot.y,w:readLogicBox.w,h:readLogicBox.h}, {}, muted, 'secondary', 'annotation', readLogicBox.lines);
  if (hasMethod) scene.push({t:'line',id:'stack:header-rule',x1:frame.plot.x,x2:frame.plot.x+frame.plot.w,y1:frame.plot.y+readLogicBox.h+10,y2:frame.plot.y+readLogicBox.h+10,stroke:{token:'grid'},width:strokeToken(theme, 'hair'),owner:{},part:'headerRule'});
  const plots: Rect[] = [];
  // A panel's top: its plot, or its readout where that sits above the plot.
  const tops: number[] = [];
  let y = frame.plot.y + topRoom;
  heights.forEach((h,i) => { tops.push(y); y += heads?.[i]!.h ?? 0; plots.push({ x:plotX,y,w:plotW,h }); y+=h+gap; });
  const derived: MetricStackDerived = { gap,gutterWidth:narrow?0:gutter,axisOwner:data.panels.at(-1)!.id,readouts:computed.panels.map(p=>printedReadout(p.readout,showHeadline,showSpan,look)),panels:[] };
  let bandLabelHeight = 0;
  if (computed.maturing.length) {
    const scope = data.states!.maturing!;
    const indexes = scope.panels.map(id=>data.panels.findIndex(p=>p.id===id)).sort((a,b)=>a-b);
    const first = plots[indexes[0]!]!, last=plots[indexes.at(-1)!]!, firstTop=tops[indexes[0]!]!;
    const bandAt = categoryBandFromCenters(data.categories.map(c=>c.id),first,i=>plotX+(i+0.5)*step,'x');
    const left=bandAt(scope.from)! as {x:number;w:number},right=bandAt(scope.to)! as {x:number;w:number};
    const rect = {x:left.x,y:firstTop-firstOverhang,w:right.x+right.w-left.x,h:last.y+last.h-firstTop+firstOverhang};
    const nodeId='stack:maturing:band';
    derived.band={rect,panels:indexes.map(i=>data.panels[i]!.id),categoryIds:computed.maturing.map(i=>data.categories[i]!.id),nodeId};
    scene.push({t:'rect',id:nodeId,rect,fill:wash(neutral,0.035),owner:{annotationId:'stack:maturing'},part:'band'});
    const text=(scope.label??chartString(options, 'notYetMature'))+marker(stateNotes.maturing);
    const box=textBox(text,noteFont,rect.w - 8);
    bandLabelHeight=box.h;
    put('stack:maturing:label',text,noteFont,{x:rect.x+(rect.w-box.w)/2,y:rect.y+4,w:box.w,h:box.h},{annotationId:'stack:maturing'},muted,'footnote','annotation',box.lines);
  }
  const marks: GridMarks = {panels:[]};
  const yielding = new Set<string>();
  // The focus look's values stand on a plate in the page colour.
  const plated = new Set<string>();
  computed.panels.forEach((p,pi) => {
    const formatValue = p.format;
    const plot=plots[pi]!, baseline=plot.y+plot.h;
    const owner={seriesId:p.panel.id};
    // The focus look keeps one paint along a line: the accent in the panel with emphasis, the strong neutral else.
    const color: Paint = p.panel.emphasis ? accent : look ? { token: 'neutralMark' } : neutral;
    const labelGap=p.panel.type==='line'?9:5;
    const clearance=heightOf(valueFont)+labelGap+(p.panel.type==='line'?4.5:0)+4;
    const bandClear=pi===bandFirstIndex?Math.max(0,bandLabelHeight+8-firstOverhang-(heads?.[pi]!.h??0)):0;
    const headroom=clearance+bandClear;
    if (plot.h<=headroom+10) spacingError(`options.stack.heights.${pi}`,`Panel '${p.panel.id}' needs at least ${Math.ceil(headroom+11)} px height for its band and labels`, heightFix(pi, Math.ceil(headroom+11)));
    const visible=(i:number)=>visibleValue(p,i);
    const max=Math.max(maxOf(p.values.map((v,i)=>visible(i)?v??0:0)),0);
    const domainMax=max===0?1:max/(1-headroom/plot.h);
    const py=(v:number)=>baseline-v/domainMax*plot.h;
    const nodeIds:string[][]=data.categories.map(()=>[]);
    const displayed:string[]=data.categories.map(()=> na);
    const emit=(node:SceneNode,ci?:number)=>{scene.push(node);if(ci!==undefined)nodeIds[ci]!.push(node.id);};
    marks.panels.push({id:p.panel.id,type:p.panel.type,plot,content:{x:frame.plot.x,y:plot.y,w:frame.plot.w,h:plot.h},title:p.panel.title,row:pi,column:0});
    derived.panels.push({id:p.panel.id,domain:[0,domainMax],plot,values:p.values,states:p.states,displayed,nodeIds});
    const boxes=heads?.[pi] ?? gutterBoxes[pi]!, head=heads?.[pi];
    let gy=tops[pi]!;
    // A multi-line part keeps its lines on the track's alignment.
    const lineAlign = trackAlign === 'right' ? 'end' as const : trackAlign === 'center' ? 'middle' as const : undefined;
    const putLines = (...args: Parameters<typeof put>) => { put(...args); const last = requests.at(-1); if (lineAlign && last?.id === args[0]) last.align = lineAlign; };
    const unitBeside = head ? head.unitBeside : gutterBoxes[pi]!.beside;
    const nameX = seat(unitBeside ? boxes.name.w + 2*spanSpace + boxes.unit.w : boxes.name.w);
    putLines(`${p.panel.id}:name`,p.panel.title,nameFont,{x:nameX,y:gy,w:boxes.name.w,h:boxes.name.h},owner,{token:'ink'},'label','category',boxes.name.lines);
    if (unitBeside) put(`${p.panel.id}:unit`,p.panel.unit,keyFont,{x:nameX+boxes.name.w+2*spanSpace,y:gy+boxes.name.h-boxes.unit.h,w:boxes.unit.w,h:boxes.unit.h},owner,muted,'secondary','category',boxes.unit.lines);
    else if (!showUnit) gy+=boxes.name.h;
    else { gy+=boxes.name.h+2; putLines(`${p.panel.id}:unit`,p.panel.unit,keyFont,{x:seat(boxes.unit.w),y:gy,w:boxes.unit.w,h:boxes.unit.h},owner,muted,'secondary','category',boxes.unit.lines); }
    gy = head ? tops[pi]!+head.top+8 : unitBeside ? tops[pi]!+gutterBoxes[pi]!.top+4 : gy+boxes.unit.h+(compactReadout || look ? 4 : 10);
    const hero=measure(p.readout.headlineText,heroFont);
    // The focus look: the value of the focus, then the change and "from" the base value.
    let lookKeyTop: number | undefined;
    if (look) {
      const t = texts[pi]!, vf = valueFontOf(pi, narrow || compactReadout), vw = measure(t.value, vf).width, lw = lineWidth(t);
      const claimOf = (key: string) => p.readout.claims.find(c => c.id === `stack:${p.panel.id}:${key}`)!.id;
      const beside = hasLine && (head ? head.spanBeside : compactReadout);
      const vx = seat(beside ? vw + 3 * spanSpace + lw : vw);
      put(`${p.panel.id}:after`, t.value, vf, { x: vx, y: gy, w: vw, h: heightOf(vf) }, owner, { token: 'ink' }, 'title', 'point', [t.value], claimOf('after'));
      // Beside the value the line shares its baseline: half a cap height (about 0.36 em) per size step.
      let lx = beside ? vx + vw + 3 * spanSpace : seat(lw);
      const ly = beside ? gy + heightOf(vf) / 2 - heightOf(changeFont) / 2 + 0.36 * (vf.size - changeFont.size) : gy + heightOf(vf) + (head ? 6 : 4);
      if (t.change) {
        const w = measure(t.change, changeFont).width;
        put(`${p.panel.id}:headline`, t.change, changeFont, { x: lx, y: ly, w, h: heightOf(changeFont) }, owner, { token: 'ink' }, 'label', 'point', [t.change], claimOf('headline'));
        lx += w + measure(' ', fromFont).width;
      }
      // "from" and the base value: the words in muted text around the value, which carries its claim.
      if (t.from) for (const [key, text, claim] of [['from', fromWords[0]!.trimEnd(), undefined], ['before', t.base, claimOf('before')], ['from-end', fromWords[1]!.trim(), undefined]] as const) {
        if (!text) continue;
        if (key === 'before' && fromWords[0]!.endsWith(' ')) lx += measure(' ', fromFont).width;
        if (key === 'from-end' && fromWords[1]!.startsWith(' ')) lx += measure(' ', fromFont).width;
        const w = measure(text, fromFont).width;
        put(`${p.panel.id}:${key}`, text, fromFont, { x: lx, y: ly, w, h: heightOf(fromFont) }, owner, muted, 'label', 'point', [text], claim);
        lx += w;
      }
      lookKeyTop = head ? undefined : (beside ? gy + Math.max(heightOf(vf), hasLine ? heightOf(changeFont) : 0) : gy + heightOf(vf) + (hasLine ? 4 + heightOf(changeFont) : 0)) + 6;
    }
    const headlineClaim=p.readout.claims.find(c=>c.id===`stack:${p.panel.id}:headline`||c.id===`stack:${p.panel.id}:rate`)!;
    const sideBySide = showHeadline && showSpan && (head?.spanBeside || !head && compactReadout);
    const heroX = seat(sideBySide ? hero.width + 3*spanSpace + spanWidths[pi]! : hero.width);
    if (showHeadline && !look) put(`${p.panel.id}:headline`,p.readout.headlineText,heroFont,{x:heroX,y:gy,w:hero.width,h:compactReadout ? heroFont.size : heightOf(heroFont)},owner,color,'title','point',[p.readout.headlineText],headlineClaim.id);
    const before=p.readout.claims.find(c=>c.id===`stack:${p.panel.id}:before`)!,after=p.readout.claims.find(c=>c.id===`stack:${p.panel.id}:after`)!;
    let gx=sideBySide ? heroX : seat(spanWidths[pi]!);
    // Beside the headline the span shares its baseline: half a cap height (about 0.36 em) per size step.
    const heroTop = gy;
    if (sideBySide) { gx += hero.width + 3*spanSpace; gy += heightOf(heroFont)/2 - heightOf(unitFont)/2 + 0.36*(heroFont.size-unitFont.size); }
    else if (showHeadline) gy += heightOf(heroFont)+6;
    if (showSpan && !look) for(const [suffix,text,claim] of [['before',before.output.displayed,before.id],['arrow','→',undefined],['after',after.output.displayed,after.id]] as const) {
      if (suffix === 'arrow') gx += spanSpace;
      const width = suffix === 'arrow' ? arrowWidth : measure(text,unitFont).width;
      put(`${p.panel.id}:${suffix}`,text,unitFont,{x:gx,y:gy,w:width,h:heightOf(unitFont)},owner,muted,'axis','point',[text],claim);
      gx += width + (suffix === 'arrow' ? spanSpace : 0);
    }
    // Segment values of a stacked panel show for every category or for none;
    // with none, its key says that the labels show totals.
    const barWidth = step*0.64;
    const segmentLabels = stacked(p) && !thin && !look && data.categories.every((_, ci) => {
      const part = p.parts[0]![ci];
      return !visible(ci) || !part || part/domainMax*plot.h >= heightOf(valueFont)+10 && measure(formatValue(part),valueFont).width < barWidth-6;
    });
    const key = head ? head.key : gutterKeys[pi]!;
    let keyTop = head ? tops[pi]!+head.body : lookKeyTop ?? (compactReadout ? heroTop+heroBlock : gy+(showSpan ? heightOf(unitFont)+6 : 0));
    const caption = key.placed.length ? captionBox(pi, head ? frame.plot.w : trackW) : NO_BOX;
    if (caption.h) {
      putLines(`${p.panel.id}:key-title`, data.panels[pi]!.keyTitle!, keyFont, { x: seat(caption.w), y: keyTop, w: caption.w, h: caption.h }, owner, muted, 'secondary', 'category', caption.lines);
      keyTop += caption.h + 2;
    }
    for (const item of key.placed) {
      if (item.id === 'stack:totals' && segmentLabels) continue;
      // A key row sits on the track's alignment as one line.
      const rowW = maxOf(key.placed.filter(other => other.dy === item.dy && !(other.id === 'stack:totals' && segmentLabels)).map(other => other.dx + other.w));
      const kx = seat(rowW)+item.dx, ky = keyTop+item.dy;
      if (item.paint) scene.push({t:'rect',id:`${p.panel.id}:key:${item.id}`,rect:{x:kx,y:ky+(keyRow-keySwatch)/2,w:keySwatch,h:keySwatch},fill:item.paint,owner:{seriesId:item.id},part:'swatch'});
      const tx = item.paint ? kx+keySwatch+5 : kx;
      put(`${p.panel.id}:key:${item.id}:label`,item.label,keyFont,{x:tx,y:ky+(keyRow-heightOf(keyFont))/2,w:item.textW,h:heightOf(keyFont)*item.lines.length},{seriesId:item.id},muted,'secondary','category',item.lines);
      // The focus look ends the row in the measure's share of the focus.
      const share = look ? texts[pi]!.shares.find(s => s.id === item.id) : undefined;
      if (share) {
        const sw = measure(share.text, keyFont).width;
        put(`${p.panel.id}:key:${item.id}:share`, share.text, keyFont, { x: kx + item.shareRight - sw, y: ky + (keyRow - heightOf(keyFont)) / 2, w: sw, h: heightOf(keyFont) }, { seriesId: item.id }, { token: 'ink' }, 'secondary', 'point', [share.text], share.claimId);
      }
    }
    // The focus look's base line: dashed at the base window's level, over the columns and under a line, with the
    // base level at its left end. None where the base value is not available.
    const level = look ? baseLevel(p) : null, baseText = baseTexts[pi];
    const baseLine = () => {
      if (level === null || baseText === undefined) return;
      const by = py(level), bw = measure(baseText, baseFont).width;
      emit({ t: 'line', id: `${p.panel.id}:base-line`, x1: plotX, x2: plotX + plotW, y1: by, y2: by, stroke: baseStroke, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference'), owner, part: 'baseLine' });
      put(`${p.panel.id}:base-value`, baseText, baseFont, { x: plotX - 8 - bw, y: by - heightOf(baseFont) / 2, w: bw, h: heightOf(baseFont) }, owner, muted, 'label', 'point', [baseText],
        `stack:${p.panel.id}:base${'denominator' in p.panel.measure ? ':raw' : ''}`);
    };
    if (p.panel.type === 'line') baseLine();
    if(p.panel.type==='line') {
      for(let i=1;i<data.categories.length;i++) if(visible(i-1)&&visible(i)&&p.states[i-1]!=='partial'&&p.states[i]!=='partial') {
        const provisional=p.states[i-1]==='maturing'||p.states[i]==='maturing';
        const x1=plotX+(i-0.5)*step,y1=py(p.values[i-1]!),x2=plotX+(i+0.5)*step,y2=py(p.values[i]!);
        emit({t:'line',id:`${p.panel.id}:line:${i}`,x1,y1,x2,y2,stroke:provisional?muted:color,width:strokeToken(theme, p.panel.emphasis ? 'focus' : 'data'),...(provisional?{dash:dashToken(theme, 'reference')}:{}),owner,part:provisional?'provisionalLine':'line'});
        // Use the thin polygon, not its large bounding box. A steep line must
        // block labels that cross it without blocking the empty space beside it.
        // The focus look's value stands on a plate that may cover the line, as it covers other categories' marks.
        if (look) continue;
        const length=Math.hypot(x2-x1,y2-y1),dx=-(y2-y1)/length,dy=(x2-x1)/length;
        occupied.claim({x:x1-1,y:Math.min(y1,y2)-1,w:x2-x1+2,h:Math.abs(y2-y1)+2},'mark',
          {...owner,pointId:`segment:${i}`},'line',[
            {x:x1+dx,y:y1+dy},{x:x2+dx,y:y2+dy},{x:x2-dx,y:y2-dy},{x:x1-dx,y:y1-dy},
          ]);
      }
    }
    const latest=data.categories.reduce((last,_,ci)=>visible(ci)?ci:last,-1);
    // The focus look prints the value of each focus category only.
    const valued=(ci:number)=>look ? stateOf(ci)==='focus' : named(ci)||ci===latest;
    // A latest value off the thinned rhythm sits one column from its neighbour's; that neighbour yields where they collide.
    if(!look&&!named(latest)) yielding.add(`${p.panel.id}:value:${data.categories[latest-1]?.id}`);
    data.categories.forEach((category,ci)=>{
      const x=plotX+(ci+0.5)*step,cellOwner={seriesId:p.panel.id,categoryId:category.id};
      if(!visible(ci)) {if(valued(ci))centerText(`${p.panel.id}:value:${category.id}`,na,valueFont,x,baseline-heightOf(valueFont)-5,cellOwner,muted);if(look&&valued(ci))plated.add(`${p.panel.id}:value:${category.id}`);return;}
      const v=p.values[ci]!,top=py(v),provisional=p.states[ci]!=='mature';
      const val=formatValue(v);
      displayed[ci]=val;
      const labelText = val + (p.panel.type === 'column' && p.states[ci] === 'partial' ? marker(stateNotes.partial) : '');
      if(p.panel.type==='column') {
        const width=barWidth;
        let sum=0;
        const values='sum'in p.panel.measure?p.parts.map(part=>part[ci]!):[v];
        values.forEach((part,si)=>{
          const h=part!/domainMax*plot.h;sum+=part!;
          const paints = values.length > 1 && 'sum' in p.panel.measure && !look ? measurePaints.get(p.panel.measure.sum[si]!)! : undefined;
          // A provisional bar keeps its measure's paint as a hatch; the dashed outline marks it too.
          // A stacked one keeps its segments a grey step apart in a grey theme (hatchStripeColor).
          const lookFill = look ? statePaint(stateOf(ci), si, values.length) : undefined;
          const fill = lookFill ?? (paints ? paints.mature : p.panel.emphasis ? emphasizedFill : columnFill);
          const rect={x:x-width/2,y:py(sum),w:width,h};
          const partOwner={...cellOwner,segmentId:String(si)};
          emit({t:'rect',id:`${p.panel.id}:bar:${category.id}:${si}`,rect,fill,...(provisional?{pattern:'hatch45' as const,hatchEdge:false as const,...(paints||look&&values.length>1?{hatch:{strength:options.hatchStrength??HATCH_STRENGTH_DEFAULT.sole,cue:'sole' as const,stacked:true as const}}:{})}:{}),owner:partOwner,part:'segment'},ci);
          if(!look||valued(ci))occupied.claim(rect,'mark',partOwner,'segment');
          if(segmentLabels&&si===0&&part) {
            const text=formatValue(part);
            // A reordered first segment can now carry a light measure tint; a hatched one puts its value on a tag.
            const ink: Paint = provisional ? { token: 'ink' } : paints && fill !== color
              ? { token: 'ink', theme: { kind: 'contrast-ink', fill } } : { token: 'inkInverse' };
            const tw=measure(text,valueFont).width;
            if(provisional)emit({t:'rect',id:`${p.panel.id}:segment-tag:${category.id}`,rect:{x:x-tw/2-2,y:rect.y+4,w:tw+4,h:heightOf(valueFont)},fill:{token:'background'},radius:2,owner:partOwner,part:'labelTag'},ci);
            centerText(`${p.panel.id}:segment:${category.id}`,text,valueFont,x,rect.y+4,partOwner,ink);
          }
        });
        if(provisional)emit({t:'path',id:`${p.panel.id}:outline:${category.id}`,d:`M${n(x-width/2)} ${n(baseline)}V${n(top)}H${n(x+width/2)}V${n(baseline)}`,stroke:muted,width:strokeToken(theme, 'mark'),dash:dashToken(theme, 'reference'),owner:cellOwner,part:'provisionalOutline'},ci);
      } else if (look && !provisional) {
        // The focus look draws no point per category: an open ring on the base window, a dot with a halo on the focus.
        const state = stateOf(ci);
        if (state === 'base') emit({ t: 'circle', id: `${p.panel.id}:point:${category.id}`, cx: x, cy: top, r: 3.75, fill: { token: 'background' }, stroke: { token: 'neutralMark' }, strokeWidth: 1.5, owner: cellOwner, part: 'basePoint' }, ci);
        if (state === 'focus') emit({ t: 'circle', id: `${p.panel.id}:point:${category.id}`, cx: x, cy: top, r: 6, fill: accent, stroke: { token: 'background' }, strokeWidth: 2, owner: cellOwner, part: 'focusPoint' }, ci);
        if (state === 'focus') occupied.claim({ x: x - 6, y: top - 6, w: 12, h: 12 }, 'mark', cellOwner, 'point');
      } else {
        emit({t:'circle',id:`${p.panel.id}:point:${category.id}`,cx:x,cy:top,r:4.5,fill:provisional?{token:'background'}:color,...(provisional?{stroke:muted,strokeWidth:strokeToken(theme, 'mark')}:{}),owner:cellOwner,part:provisional?'provisionalPoint':'point'},ci);
        occupied.claim({x:x-4.5,y:top-4.5,w:9,h:9},'mark',cellOwner,'point');
      }
      if(valued(ci))centerText(`${p.panel.id}:value:${category.id}`,labelText,valueFont,x,top-labelGap-heightOf(valueFont),cellOwner,provisional?muted:{token:'ink'},'label','point',undefined,!look&&p.panel.type==='line'&&top+labelGap+heightOf(valueFont)<baseline-2?top+labelGap:undefined);
      if(look&&valued(ci))plated.add(`${p.panel.id}:value:${category.id}`);
      // A line point value ranks as on the line chart: the latest is its endpoint, the others interior, so 'minimal' keeps the latest.
      const valueRequest=requests.at(-1);
      if(p.panel.type==='line'&&valueRequest?.id===`${p.panel.id}:value:${category.id}`)valueRequest.priority=ci===latest?PRIORITY.endpoint:PRIORITY.interior;
    });
    if (p.panel.type === 'column') baseLine();
    // The focus look runs the baseline under the readout too, so each panel's column and plot sit on one rule.
    const ruleFrom = look && !narrow && !onRight ? frame.plot.x : plotX, ruleTo = look && onRight ? trackX + trackW : plotX + plotW;
    emit({t:'line',id:`${p.panel.id}:baseline`,x1:ruleFrom,x2:ruleTo,y1:baseline,y2:baseline,stroke:{token:'axis'},width:strokeToken(theme, 'rule'),owner,part:'baseline'});
    occupied.claim({x:plotX,y:baseline-0.5,w:plotW,h:1},'axis',owner,'baseline');
  });
  const axisY=plots.at(-1)!.y+plots.at(-1)!.h+8;
  if(!periodAxis) data.categories.forEach((category,i)=>{
    const box=categoryBoxes[i]!,text=categoryName(category);
    if(!named(i)) { scene.push({t:'line',id:`stack:category:tick:${category.id}`,x1:plotX+(i+0.5)*step,x2:plotX+(i+0.5)*step,y1:axisY+2,y2:axisY+7,stroke:muted,width:strokeToken(theme, 'rule'),owner:{categoryId:category.id},part:'categoryTick'}); return; }
    put(`stack:category:${category.id}`,text,keyFont,{x:plotX+(i+0.5)*step-box.w/2,y:axisY,w:box.w,h:box.h},{categoryId:category.id},{token:'ink'},'secondary','category',box.lines);
  });
  // The period axis: each period's label at its first category, after a short tick from the last baseline, with no rule.
  const lastBaseline=plots.at(-1)!.y+plots.at(-1)!.h;
  if(periodAxis) data.periods!.forEach((period,i)=>{
    const box=periodBoxes![i]!,x=plotX+box.indexes[0]!*step;
    scene.push({t:'line',id:`stack:period:tick:${i}`,x1:x+0.5,x2:x+0.5,y1:lastBaseline,y2:lastBaseline+PERIOD_TICK_TOP+heightOf(box.font),stroke:{token:'axis'},width:strokeToken(theme, 'rule'),owner:{},part:'periodTick'});
    put(`stack:period:${i}`,period.label,box.font,{x:x+5,y:lastBaseline+PERIOD_TICK_TOP,w:box.w,h:box.h},{categoryId:period.from},muted,'secondary','category',box.lines);
  });
  else data.periods?.forEach((period,i)=>{
    const box=periodBoxes![i]!,{indexes,bold,font:f}=box;
    const x=plotX+indexes[0]!*step,y=axisY+categoryHeight+8;
    // A rule over each period; the readout windows take a heavier ink rule and a bold label.
    put(`stack:period:${i}`,period.label,f,{x:x+2,y:y+4,w:box.w,h:box.h},{categoryId:period.from},bold?{token:'ink'}:muted,'secondary','category',box.lines);
    scene.push({t:'line',id:`stack:period:rule:${i}`,x1:x+1.5,x2:x+indexes.length*step-1.5,y1:y,y2:y,stroke:bold?{token:'ink'}:{token:'grid'},width:strokeToken(theme, bold ? 'data' : 'rule'),owner:{},part:'periodRule'});
  });
  for(const request of requests) if(yielding.has(request.id)) request.priority=PRIORITY.interior;
  const solved=solveLabels(requests,occupied,{focus:options.focus,density:options.labelDensity??'full',pins:options.labelPlacements??{},labelOffsets:options.labelOffsets,measure,plot:frame.plot,canvas:{x:0,y:0,w:size.width,h:size.height},darkInk:theme.color.ink,lightInk:theme.color.inkInverse,labelPad:0});
  const fonts = new Map(requests.map(request => [request.id, request.font]));
  for(const label of solved.placed) { label.ink=inks.get(label.id)??label.ink; label.font=fonts.get(label.id); if(plated.has(label.id))label.plate=true; }
  // A label the density or redundancy gate drops is left out on purpose; only a label that found no seat failed.
  const hidden=solved.placed.filter(l=>(l.hidden==='collision'||l.hidden==='tooSmall')&&!yielding.has(l.id));
  const probe=(options as { [GUTTER_PROBE]?: boolean })[GUTTER_PROBE]===true;
  if(hidden.length&&probe)spacingError('options.size',`Metric stack cannot place ${hidden.map(l=>`'${l.text}'`).join(', ')} at ${size.width} × ${size.height} px`);
  // An authored gutter wider than the default gives way to the widest gutter that places every label.
  if(hidden.length&&gutter>defaultGutter){
    const places=(width:number)=>{
      try { return layoutMetricStack(raw,{...options,[GUTTER_LIMIT]:width,[GUTTER_PROBE]:true} as GridLayoutOptions).scene.length>0; }
      catch(error){ if(error instanceof NormalizeError)return false; throw error; }
    };
    let low=defaultGutter,high=gutter;
    while(high-low>1){ const mid=Math.floor((low+high)/2); if(places(mid))low=mid; else high=mid; }
    return layoutMetricStack(raw,{...options,[GUTTER_LIMIT]:low} as GridLayoutOptions);
  }
  // Any other label without a seat drops: the shared note pass names it and warns label-hidden, as on every chart type.
  pushAll(scene, labelsToNodes(theme, solved.placed,()=>valueFont));
  const counts=[structureCount('panels',data.panels.length, undefined, options),structureCount('categories',data.categories.length, undefined, options),structureCount('series',data.measures.length,chartString(options, 'sourceMeasures', { v1: data.measures.length }))];
  // A readout operand (a sum, a raw share) and a figure without a seat print no number of their own.
  const requested=new Set(requests.flatMap(request=>request.claimIds ?? []));
  const unprinted=derived.readouts.flatMap(readout=>readout.claims.filter(claim=>!requested.has(claim.id)).map(claim=>claim.id));
  return withUnprintedClaims<Geometry<GridMarks, GridDerived>>({type:'grid',size,plot:frame.plot,scene,labels:solved.placed,axes:[{axis:'x',baselineNodeId:`${data.panels.at(-1)!.id}:baseline`,ticks:data.categories.map((c,i)=>({at:c.id,pos:plotX+(i+0.5)*step,...(periodAxis?{}:{labelId:`stack:category:${c.id}`})}))}],annotations:[],frame:frame.frame,legend:frame.legend,marks,derived:{metricStack:derived,sharedPlotX:plotX,sharedPlotW:plotW,tierGap:gap},
    sizing:{aspect:'content',fit:'content',minWidth:size.width,minHeight,measuredMinWidth:size.width,measuredMinHeight:minHeight,naturalWidth:size.width,naturalHeight,comfortableWidth:size.width,comfortableHeight:naturalHeight},
    a11y:{title:accessibleTitle(options.title,chartString(options, 'metricStackTitle', { v1: data.panels.length })),counts,desc:chartString(options, 'metricStackDesc', { v1: counts.map(c=>c.text).join(', '), v2: data.panels.map(p=>p.title).join('; '), v3: look ? computed.panels.map((p,i)=>`${p.panel.title}: ${[texts[i]!.value,...(texts[i]!.change?[texts[i]!.change]:[]),...(texts[i]!.from?[texts[i]!.from]:[])].join(' ')}.`).join(' ')
      : !hasMethod ? '' : computed.panels.map(p=>`${p.panel.title}: ${[...(showHeadline?[p.readout.headlineText]:[]),...(showSpan?[p.readout.spanText]:[])].join('; ')}.`).join(' ') })},warnings:[...solved.warnings,...stackColumnWarnings(stack,narrow,gutterFloored,gutterCapped,stack.variant==='focus'&&!look)],debug:{occupied:occupied.snapshot(),decisions:solved.decisions}},unprinted);
}
