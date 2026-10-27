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
import type { JsonPatchOperation } from '../../diagnostics/jsonPatch';
import { partialFootnotes, partialIds, saysToDate } from '../../partialPeriod';
import { disclosureNote, disclosuresShown } from '../../notes';
import { heightOmitted } from '../../sizing';
import { structureCount } from '../../structureCounts';
import { defaultMeasurer, wrapText, type FontSpec } from '../../text';
import { dashToken, strokeToken, canvasMargin, HATCH_STRENGTH_DEFAULT, markRolePaint, resolveTheme, secondaryFont, seriesPaint, themeForWidth } from '../../theme';
import type { Rect } from '../../geometry';
import type { Geometry, Paint, SceneNode, TypographyRole } from '../../types/scene';
import type { OwnerRef } from '../../types/cell';
import type { GridLayoutOptions } from './normalize';
import type { GridMarks, GridDerived } from './layout';
import { computeMetricStack, formatPanelValue, metricStackGrain, normalizeMetricStack, stackError, stackRange, type ComputedStackPanel, type MetricStackData, type StackReadout, type StackState } from './metricStack';
import { maxOf, pushAll } from '../../arrays';

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
const accent: Paint = { token: 'focus' };
const wash = (base: Paint, weight: number, pageFloor?: number): Paint =>
  ({ token: 'markInk', theme: { kind: 'mix', from: base, to: { token: 'background' }, weight, ...(pageFloor === undefined ? {} : { pageFloor }) } });

const NO_WIDER_SEARCH = Symbol('boardplot.metricStackNoWiderSearch');

/** The narrowest width up to 512 px wider that draws every label, at the same height; undefined when none does. */
function widerThatPlaces(raw: MetricStackData, options: GridLayoutOptions, size: { width: number; height: number }, automatic: boolean): number | undefined {
  const draws = (width: number) => {
    try {
      const geo = layoutMetricStack(raw, { ...options, size: automatic ? { width } : { width, height: size.height }, [NO_WIDER_SEARCH]: true } as GridLayoutOptions);
      return geo.scene.length > 0;
    } catch (error) { if (error instanceof NormalizeError) return false; throw error; }
  };
  // The received width failed; a fractional one (288.1) leaves its next whole px untested.
  const base = Math.floor(size.width);
  let low = base, high: number | undefined;
  for (let step = 4; step <= 512; step *= 2) {
    if (draws(base + step)) { high = base + step; break; }
    low = base + step;
  }
  if (high === undefined) return undefined;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (draws(mid)) high = mid; else low = mid;
  }
  return high;
}

export function layoutMetricStack(raw: MetricStackData, options: GridLayoutOptions): Geometry<GridMarks, GridDerived> {
  const data = normalizeMetricStack(raw);
  if (!options.stack) stackError('options.stack', 'Shared measures require options.stack: {}');
  if (options.sharedAxis === 'none' || options.sharedScale === true || options.columns !== undefined || options.gutters !== undefined
    || options.anchors !== undefined || options.alignmentRules !== undefined || options.panelOrder !== undefined) {
    stackError('options', 'A metric stack owns top-down order, shared categories, spacing and independent scales; remove conflicting grid controls');
  }
  const stack = options.stack;
  if (stack.heights && options.rows) stackError('options', 'Use stack.heights or rows, not both');
  if (stack.heights && stack.heights.length !== data.panels.length || options.rows && options.rows.length !== data.panels.length) stackError('options', 'Supply one height or row weight per panel');
  const theme = themeForWidth(resolveTheme(options.theme), resolveSize(options.size).width);
  const measure = options.measure ?? defaultMeasurer;
  const na = notApplicableGlyph(options.strings);
  const computed = computeMetricStack(data, options.locale?.language, na);
  const font = (role: 'label' | 'axis' | 'title' | 'footnote', weight?: number): FontSpec => ({ family: theme.type.family, ...theme.type[role], ...(weight ? { weight } : {}) });
  const valueFont = font('label', 700), nameFont = font('label', 700), unitFont = font('axis'), heroFont = font('title', 700), axisFont = font('axis'), noteFont = font('footnote');
  // The panel unit, the key and the method line take the secondary type step.
  const keyFont = secondaryFont(theme);
  const heightOf = (f: FontSpec) => f.size * (f.lineHeight ?? 1.2);
  const textBox = (text: string, f: FontSpec, width: number) => {
    const lines = wrapText(text, f, width, Number.MAX_SAFE_INTEGER, measure).lines;
    return { lines, w: Math.max(...lines.map(line => measure(line,f).width), 0), h: heightOf(f) * lines.length };
  };
  const spacingError = (field: string, message: string, fix?: JsonPatchOperation[]): never => { throw new NormalizeError('metric-stack-spacing', field, message, 'Increase the named dimension; the engine does not shrink or overlap required labels.', fix); };
  const heightFix = (i: number, px: number): JsonPatchOperation[] | undefined => stack.heights ? [{ op: 'replace', path: `/options/stack/heights/${i}`, value: px }] : undefined;
  const minGap = Math.ceil(heightOf(axisFont) + 8);
  const gap = Math.max(26, minGap);
  // Fallback arrow glyphs can be one em wide even when the font table has no arrow.
  const arrowWidth = Math.max(unitFont.size, measure('→', unitFont).width);
  const spanSpace = measure(' ', unitFont).width;
  const spanWidths = computed.panels.map(p => measure(p.readout.spanText, unitFont).width + arrowWidth - measure('→', unitFont).width);
  const minGutter = Math.ceil(Math.max(120, maxOf(computed.panels.map((p,i) => Math.max(spanWidths[i]!, measure(p.readout.headlineText, heroFont).width,
    ...`${p.panel.title} ${p.panel.unit}`.split(/\s+/).map(word => measure(word, nameFont).width))))) + 4);
  const nameWidth = Math.ceil(maxOf(computed.panels.flatMap(p => p.panel.title.split('\n').map(line => measure(line, nameFont).width)))) + 4;
  // Keep normal names on one line; cap name-driven growth so prose still wraps.
  const gutter = Math.max(170, minGutter, Math.min(320, nameWidth));
  const gutterGap = Math.max(28, heightOf(axisFont));
  const gutterBoxes = computed.panels.map(p => ({ name: textBox(p.panel.title, nameFont, gutter), unit: textBox(p.panel.unit, keyFont, gutter) }));
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
  // A keyed measure keeps one paint across panel order and emphasis.
  const measureIndexes = new Map<string, number>();
  const emphasizedMeasures = new Set<string>();
  for (const p of computed.panels) if (p.panel.type === 'column' && 'sum' in p.panel.measure && p.parts.length > 1) {
    for (const id of p.panel.measure.sum) {
      if (!measureIndexes.has(id)) measureIndexes.set(id, measureIndexes.size);
      if (p.panel.emphasis) emphasizedMeasures.add(id);
    }
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
  // A stacked panel keys its measures inside its own readout. Its band label,
  // hatch and dashed outline carry the provisional state, so it needs no key.
  const stacked = (p: ComputedStackPanel) => p.panel.type === 'column' && 'sum' in p.panel.measure && p.parts.length > 1;
  // Each stacked panel keys every measure it draws, also one an earlier panel keyed.
  const panelKeys = computed.panels.map(() => [] as { id: string; label: string; paint: Paint }[]);
  const seen = new Set<string>();
  computed.panels.forEach((p, pi) => { if (stacked(p) && 'sum' in p.panel.measure) {
    p.panel.measure.sum.forEach((id,i) => { if (p.parts[i]!.some((value, ci) => value !== null && value > 0 && visibleValue(p, ci))) { seen.add(id); panelKeys[pi]!.push({ id, label: data.measures.find(m=>m.id===id)!.label, paint: measurePaints.get(id)!.mature }); } });
  } });
  if (options.legend === 'none') panelKeys.forEach(items => items.splice(0));
  const totalsCue = chartString(options, 'labelsShowTotals');
  const keySwatch = 10, keyRow = heightOf(keyFont) + 6;
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
  const keyLayout = (pi: number, width: number, column: boolean) => {
    const items = [...panelKeys[pi]!, ...(panelKeys[pi]!.length ? [{ id: 'stack:totals', label: totalsCue, paint: undefined }] : [])].map(item => {
      const inset = item.paint ? keySwatch + 5 : 0, wrapped = wrapText(item.label, keyFont, width - inset, Number.MAX_SAFE_INTEGER, measure);
      const lines = wrapped.truncated ? breakWords(item.label, width - inset) : wrapped.lines, textW = Math.max(...lines.map(line => measure(line, keyFont).width));
      return { ...item, lines, textW, w: inset + textW, extra: (lines.length - 1) * heightOf(keyFont) };
    });
    let x = 0, dy = 0, rowExtra = 0;
    const placed = items.map((item, i) => {
      if (i > 0 && (column || rowExtra > 0 || item.extra > 0 || x + item.w > width)) { x = 0; dy += keyRow + rowExtra; rowExtra = 0; }
      const at = { ...item, dx: x, dy };
      x += item.w + 14; rowExtra = Math.max(rowExtra, item.extra);
      return at;
    });
    return { placed, h: items.length ? dy + keyRow + rowExtra : 0 };
  };
  const legend: LegendItemInput[] = [];
  if (!seen.size) {
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
  const valueWidth = maxOf(computed.panels.flatMap(p => p.values.map(v => v === null ? measure(na,valueFont).width : measure(formatPanelValue(p.panel, v, options.locale?.language), valueFont).width))) + 4;
  // A column also holds its category name with 3 px to spare.
  const categoryWidth = maxOf(data.categories.flatMap(c => c.label.split(/\s+/).map(word => measure(word, keyFont).width))) + 3;
  const valueRoom = Math.max(20, valueWidth, categoryWidth) * data.categories.length;
  // Where the readout gutter leaves too little room for the values, each
  // readout moves above its panel and the plot takes the full width.
  const gutterKeys = computed.panels.map((_, i) => keyLayout(i, gutter, true));
  const gutterHeights = gutterBoxes.map((box, i) => box.name.h + box.unit.h + heightOf(heroFont) + heightOf(unitFont) + 18 + (gutterKeys[i]!.h ? gutterKeys[i]!.h + 6 : 0));
  // A readout also moves above its panel where its gutter block is taller than an authored plot height.
  const narrow = frame.plot.w - gutter - gutterGap < valueRoom || gutterHeights.some((h, i) => stack.heights !== undefined && Math.ceil(h) > stack.heights[i]!);
  // Where even the full width is too little, values and category names thin
  // to every second category, counted back from the latest one.
  const thin = narrow && frame.plot.w < valueRoom;
  const lastIndex = data.categories.length - 1;
  const named = (ci: number) => !thin || ci % 2 === lastIndex % 2;
  const plotX = narrow ? frame.plot.x : frame.plot.x + gutter + gutterGap, plotW = narrow ? frame.plot.w : frame.plot.w - gutter - gutterGap;
  const step = plotW / data.categories.length;
  const minimumWidth = Math.ceil(size.width - plotW + (thin ? valueRoom / 2 : valueRoom));
  // Let the shared sizing pass verify the wider frame and return its size fix.
  const needsWidth = (width: number): Geometry<GridMarks, GridDerived> => ({ type:'grid',size,plot:frame.plot,scene:[],labels:[],axes:[],annotations:[],frame:frame.frame,marks:{panels:[]},derived:{},
    sizing:{aspect:'content',fit:'content',minWidth:width,minHeight:0,measuredMinWidth:width,measuredMinHeight:0,naturalWidth:width,naturalHeight:size.height,comfortableWidth:width,comfortableHeight:size.height},
    a11y:{title:chartString(options, 'metricStack'),desc:chartString(options, 'metricStackWidth', { v1: width })},warnings:[],debug:{occupied:[],decisions:[]} });
  if (size.width < minimumWidth) return needsWidth(minimumWidth);
  // A narrow readout: name and unit on one row, headline and span on the next, each pair side by side where it fits.
  const heads = !narrow ? undefined : computed.panels.map((p,i) => {
    const name = textBox(p.panel.title, nameFont, frame.plot.w), unit = textBox(p.panel.unit, keyFont, frame.plot.w);
    const unitBeside = name.lines.length === 1 && unit.lines.length === 1 && name.w + 2 * spanSpace + unit.w <= frame.plot.w;
    const hero = measure(p.readout.headlineText, heroFont).width;
    const spanBeside = hero + 3 * spanSpace + spanWidths[i]! + 2 * spanSpace <= frame.plot.w;
    const top = unitBeside ? Math.max(name.h, unit.h) : name.h + 2 + unit.h;
    const key = keyLayout(i, frame.plot.w, false), body = top + 8 + heightOf(heroFont) + (spanBeside ? 0 : 6 + heightOf(unitFont)) + 6;
    return { name, unit, unitBeside, spanBeside, top, key, body, h: body + (key.h ? key.h + 4 : 0) };
  });
  const minimumHeights = gutterHeights.map(h => Math.ceil(Math.max(narrow ? 0 : h, 3 * heightOf(valueFont) + 20)));
  // Narrow plots default lower: the readout no longer sets their height.
  let heights = computed.panels.map((p,i) => stack.heights?.[i] ?? Math.max(minimumHeights[i]!, p.panel.type === 'column' ? p.parts.length > 1 ? narrow ? 110 : 150 : narrow ? 120 : 200 : narrow ? 90 : 130));
  if (options.rows) {
    const factor = maxOf(minimumHeights.map((h,i) => h / options.rows![i]!));
    heights = options.rows.map(w => w * factor);
  }
  heights.forEach((h,i) => { if (!Number.isFinite(h) || h < minimumHeights[i]!) spacingError(`options.stack.heights.${i}`, `Panel '${data.panels[i]!.id}' needs at least ${minimumHeights[i]} px for its readout and value labels`, heightFix(i, minimumHeights[i]!)); });
  const headRoom = heads?.reduce((sum, head) => sum + head.h, 0) ?? 0;
  const partialOnValues = computed.panels.some(p => p.panel.type === 'column' && computed.partial.some(i => p.values[i] !== null));
  // A running period with no marker to point at its note says "to date" on its axis name.
  const partialMark = marker(stateNotes.partial);
  const toDate = ` ${options.strings?.toDate ?? localeStrings(options.locale?.language).toDate}`;
  const categoryName = (c: (typeof data.categories)[number]) => c.label + (!c.partial ? '' : !partialMark ? (saysToDate(c.label, toDate.trim()) ? '' : toDate) : partialOnValues ? '' : partialMark);
  const categoryBoxes = data.categories.map(c => textBox(categoryName(c), keyFont, (thin ? 2 : 1) * step - 3));
  const categoryHeight = maxOf(categoryBoxes.map(b=>b.h));
  const periodBoxes = data.periods?.map(period => {
    const indexes = stackRange(data, period);
    const bold = data.windows ? [data.windows.base, data.windows.compare].some(w => w.from === period.from && w.to === period.to) : indexes.every(i => computed.mature.includes(i));
    const f = { ...keyFont, weight: bold ? 700 : keyFont.weight };
    return { ...textBox(period.label, f, indexes.length * step - 4), indexes, bold, font: f };
  });
  const axisHeight = 12 + categoryHeight + (periodBoxes ? 10 + maxOf(periodBoxes.map(b=>b.h)) : 0) + 10;
  const bandFirstIndex = data.states?.maturing ? data.panels.findIndex(p=>data.states!.maturing!.panels.includes(p.id)) : -1;
  const firstOverhang = computed.maturing.length ? gap : 0;
  const readLogic = data.panels.some(p => p.readout === 'change') && data.windows
    ? chartString(options, 'stackChangeMethod', { v1: metricStackGrain(data), v2: data.windows.base.label, v3: data.windows.compare.label })
    : chartString(options, narrow ? 'stackAboveMethod' : 'stackLeftMethod');
  const readLogicBox = textBox(readLogic, keyFont, frame.plot.w);
  const headerRoom = readLogicBox.h + 12 + 30;
  const topRoom = headerRoom + (bandFirstIndex === 0 ? firstOverhang : 0);
  let neededPlotHeight = topRoom + headRoom + heights.reduce((a,b)=>a+b,0) + gap*(heights.length-1) + axisHeight;
  const overhead = size.height-frame.plot.h;
  const naturalHeight = Math.ceil(overhead+neededPlotHeight);
  if (automatic) { size = { ...size, height: naturalHeight }; ({ occupied, frame } = frameAt()); }
  else if (frame.plot.h < neededPlotHeight-0.01) {
    // The common sizing pass probes a fixed frame even for width-only input.
    // Return its measured floor before attempting labels outside that frame.
    return { type:'grid',size,plot:frame.plot,scene:[],labels:[],axes:[],annotations:[],frame:frame.frame,marks:{panels:[]},derived:{},
      sizing:{aspect:'content',fit:'content',minWidth:size.width,minHeight:naturalHeight,measuredMinWidth:size.width,measuredMinHeight:naturalHeight,naturalWidth:size.width,naturalHeight,comfortableWidth:size.width,comfortableHeight:naturalHeight},
      a11y:{title:chartString(options, 'metricStack'),desc:chartString(options, 'metricStackHeight', { v1: naturalHeight })},warnings:[],debug:{occupied:[],decisions:[]} };
  }
  else if (!stack.heights && frame.plot.h > neededPlotHeight) {
    const available = frame.plot.h-topRoom-headRoom-gap*(heights.length-1)-axisHeight;
    const total = heights.reduce((a,b)=>a+b,0);
    heights = heights.map(h=>h*available/total);
    neededPlotHeight = frame.plot.h;
  }
  const scene: SceneNode[] = [...frame.nodes];
  const requests: LabelRequest[] = [];
  const inks = new Map<string,Paint>();
  const put = (id: string, text: string, f: FontSpec, rect: Rect, owner: OwnerRef, ink: Paint, role: TypographyRole = 'label', kind: LabelRequest['kind'] = 'point', lines = [text], claimId?: string, below?: number) => {
    if (rect.w > 0 && rect.h > 0) {
      // A line value may drop below its point where a segment crosses the slot above.
      const candidates = [{slot:'fixed' as const,rect,penalty:0}, ...(below === undefined ? [] : [{slot:'fixed' as const,rect:{...rect,y:below},penalty:1}])];
      requests.push({ id, kind, owner, text, lines, font:f, typeRole: role, priority: PRIORITY.total, pad:0, candidates, ...(claimId ? {claimId} : {}) });
      inks.set(id,ink);
    }
  };
  const centerText = (id:string, text:string, f:FontSpec, x:number, y:number, owner:OwnerRef, ink:Paint, role:TypographyRole='label', kind:LabelRequest['kind']='point', claimId?:string, below?:number) => {
    const box=measure(text,f); put(id,text,f,{x:x-box.width/2,y,w:box.width,h:heightOf(f)},owner,ink,role,kind,[text],claimId,below);
  };
  put('stack:read-logic', readLogic, keyFont, {x:frame.plot.x,y:frame.plot.y,w:readLogicBox.w,h:readLogicBox.h}, {}, muted, 'secondary', 'annotation', readLogicBox.lines);
  scene.push({t:'line',id:'stack:header-rule',x1:frame.plot.x,x2:frame.plot.x+frame.plot.w,y1:frame.plot.y+readLogicBox.h+10,y2:frame.plot.y+readLogicBox.h+10,stroke:{token:'grid'},width:strokeToken(theme, 'hair'),owner:{},part:'headerRule'});
  const plots: Rect[] = [];
  // A panel's top: its plot, or its readout where that sits above the plot.
  const tops: number[] = [];
  let y = frame.plot.y + topRoom;
  heights.forEach((h,i) => { tops.push(y); y += heads?.[i]!.h ?? 0; plots.push({ x:plotX,y,w:plotW,h }); y+=h+gap; });
  const derived: MetricStackDerived = { gap,gutterWidth:narrow?0:gutter,axisOwner:data.panels.at(-1)!.id,readouts:computed.panels.map(p=>p.readout),panels:[] };
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
  computed.panels.forEach((p,pi) => {
    const formatValue = (value: number) => formatPanelValue(p.panel, value, options.locale?.language);
    const plot=plots[pi]!, baseline=plot.y+plot.h;
    const owner={seriesId:p.panel.id};
    const color=p.panel.emphasis?accent:neutral;
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
    put(`${p.panel.id}:name`,p.panel.title,nameFont,{x:frame.plot.x,y:gy,w:boxes.name.w,h:boxes.name.h},owner,{token:'ink'},'label','category',boxes.name.lines);
    if (head?.unitBeside) put(`${p.panel.id}:unit`,p.panel.unit,keyFont,{x:frame.plot.x+boxes.name.w+2*spanSpace,y:gy+boxes.name.h-boxes.unit.h,w:boxes.unit.w,h:boxes.unit.h},owner,muted,'secondary','category',boxes.unit.lines);
    else { gy+=boxes.name.h+2; put(`${p.panel.id}:unit`,p.panel.unit,keyFont,{x:frame.plot.x,y:gy,w:boxes.unit.w,h:boxes.unit.h},owner,muted,'secondary','category',boxes.unit.lines); }
    gy = head ? tops[pi]!+head.top+8 : gy+boxes.unit.h+10;
    const hero=measure(p.readout.headlineText,heroFont);
    const headlineClaim=p.readout.claims.find(c=>c.id===`stack:${p.panel.id}:headline`||c.id===`stack:${p.panel.id}:rate`)!;
    put(`${p.panel.id}:headline`,p.readout.headlineText,heroFont,{x:frame.plot.x,y:gy,w:hero.width,h:heightOf(heroFont)},owner,color,'title','point',[p.readout.headlineText],headlineClaim.id);
    const before=p.readout.claims.find(c=>c.id===`stack:${p.panel.id}:before`)!,after=p.readout.claims.find(c=>c.id===`stack:${p.panel.id}:after`)!;
    let gx=frame.plot.x;
    // Beside the headline the span shares its baseline: half a cap height (about 0.36 em) per size step.
    if (head?.spanBeside) { gx += hero.width + 3*spanSpace; gy += heightOf(heroFont)/2 - heightOf(unitFont)/2 + 0.36*(heroFont.size-unitFont.size); }
    else gy += heightOf(heroFont)+6;
    for(const [suffix,text,claim] of [['before',before.output.displayed,before.id],['arrow','→',undefined],['after',after.output.displayed,after.id]] as const) {
      if (suffix === 'arrow') gx += spanSpace;
      const width = suffix === 'arrow' ? arrowWidth : measure(text,unitFont).width;
      put(`${p.panel.id}:${suffix}`,text,unitFont,{x:gx,y:gy,w:width,h:heightOf(unitFont)},owner,muted,'axis','point',[text],claim);
      gx += width + (suffix === 'arrow' ? spanSpace : 0);
    }
    // Segment values of a stacked panel show for every category or for none;
    // with none, its key says that the labels show totals.
    const barWidth = step*0.64;
    const segmentLabels = stacked(p) && !thin && data.categories.every((_, ci) => {
      const part = p.parts[0]![ci];
      return !visible(ci) || !part || part/domainMax*plot.h >= heightOf(valueFont)+10 && measure(formatValue(part),valueFont).width < barWidth-6;
    });
    const key = head ? head.key : gutterKeys[pi]!, keyTop = head ? tops[pi]!+head.body : gy+heightOf(unitFont)+6;
    for (const item of key.placed) {
      if (item.id === 'stack:totals' && segmentLabels) continue;
      const kx = frame.plot.x+item.dx, ky = keyTop+item.dy;
      if (item.paint) scene.push({t:'rect',id:`${p.panel.id}:key:${item.id}`,rect:{x:kx,y:ky+(keyRow-keySwatch)/2,w:keySwatch,h:keySwatch},fill:item.paint,owner:{seriesId:item.id},part:'swatch'});
      const tx = item.paint ? kx+keySwatch+5 : kx;
      put(`${p.panel.id}:key:${item.id}:label`,item.label,keyFont,{x:tx,y:ky+(keyRow-heightOf(keyFont))/2,w:item.textW,h:heightOf(keyFont)*item.lines.length},{seriesId:item.id},muted,'secondary','category',item.lines);
    }
    if(p.panel.type==='line') {
      for(let i=1;i<data.categories.length;i++) if(visible(i-1)&&visible(i)&&p.states[i-1]!=='partial'&&p.states[i]!=='partial') {
        const provisional=p.states[i-1]==='maturing'||p.states[i]==='maturing';
        const x1=plotX+(i-0.5)*step,y1=py(p.values[i-1]!),x2=plotX+(i+0.5)*step,y2=py(p.values[i]!);
        emit({t:'line',id:`${p.panel.id}:line:${i}`,x1,y1,x2,y2,stroke:provisional?muted:color,width:strokeToken(theme, p.panel.emphasis ? 'focus' : 'data'),...(provisional?{dash:dashToken(theme, 'reference')}:{}),owner,part:provisional?'provisionalLine':'line'});
        // Use the thin polygon, not its large bounding box. A steep line must
        // block labels that cross it without blocking the empty space beside it.
        const length=Math.hypot(x2-x1,y2-y1),dx=-(y2-y1)/length,dy=(x2-x1)/length;
        occupied.claim({x:x1-1,y:Math.min(y1,y2)-1,w:x2-x1+2,h:Math.abs(y2-y1)+2},'mark',
          {...owner,pointId:`segment:${i}`},'line',[
            {x:x1+dx,y:y1+dy},{x:x2+dx,y:y2+dy},{x:x2-dx,y:y2-dy},{x:x1-dx,y:y1-dy},
          ]);
      }
    }
    const latest=data.categories.reduce((last,_,ci)=>visible(ci)?ci:last,-1);
    const valued=(ci:number)=>named(ci)||ci===latest;
    // A latest value off the thinned rhythm sits one column from its neighbour's; that neighbour yields where they collide.
    if(!named(latest)) yielding.add(`${p.panel.id}:value:${data.categories[latest-1]?.id}`);
    data.categories.forEach((category,ci)=>{
      const x=plotX+(ci+0.5)*step,cellOwner={seriesId:p.panel.id,categoryId:category.id};
      if(!visible(ci)) {if(valued(ci))centerText(`${p.panel.id}:value:${category.id}`,na,valueFont,x,baseline-heightOf(valueFont)-5,cellOwner,muted);return;}
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
          const paints = values.length > 1 && 'sum' in p.panel.measure ? measurePaints.get(p.panel.measure.sum[si]!)! : undefined;
          // A provisional bar keeps its measure's paint as a hatch; the dashed outline marks it too.
          // A stacked one keeps its segments a grey step apart in a grey theme (hatchStripeColor).
          const fill = paints ? paints.mature : p.panel.emphasis ? emphasizedFill : columnFill;
          const rect={x:x-width/2,y:py(sum),w:width,h};
          const partOwner={...cellOwner,segmentId:String(si)};
          emit({t:'rect',id:`${p.panel.id}:bar:${category.id}:${si}`,rect,fill,...(provisional?{pattern:'hatch45' as const,hatchEdge:false as const,...(paints?{hatch:{strength:options.hatchStrength??HATCH_STRENGTH_DEFAULT.sole,cue:'sole' as const,stacked:true as const}}:{})}:{}),owner:partOwner,part:'segment'},ci);
          occupied.claim(rect,'mark',partOwner,'segment');
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
      } else {
        emit({t:'circle',id:`${p.panel.id}:point:${category.id}`,cx:x,cy:top,r:4.5,fill:provisional?{token:'background'}:color,...(provisional?{stroke:muted,strokeWidth:strokeToken(theme, 'mark')}:{}),owner:cellOwner,part:provisional?'provisionalPoint':'point'},ci);
        occupied.claim({x:x-4.5,y:top-4.5,w:9,h:9},'mark',cellOwner,'point');
      }
      if(valued(ci))centerText(`${p.panel.id}:value:${category.id}`,labelText,valueFont,x,top-labelGap-heightOf(valueFont),cellOwner,provisional?muted:{token:'ink'},'label','point',undefined,p.panel.type==='line'&&top+labelGap+heightOf(valueFont)<baseline-2?top+labelGap:undefined);
    });
    emit({t:'line',id:`${p.panel.id}:baseline`,x1:plotX,x2:plotX+plotW,y1:baseline,y2:baseline,stroke:{token:'axis'},width:strokeToken(theme, 'rule'),owner,part:'baseline'});
    occupied.claim({x:plotX,y:baseline-0.5,w:plotW,h:1},'axis',owner,'baseline');
  });
  const axisY=plots.at(-1)!.y+plots.at(-1)!.h+8;
  data.categories.forEach((category,i)=>{
    const box=categoryBoxes[i]!,text=categoryName(category);
    if(!named(i)) { scene.push({t:'line',id:`stack:category:tick:${category.id}`,x1:plotX+(i+0.5)*step,x2:plotX+(i+0.5)*step,y1:axisY+2,y2:axisY+7,stroke:muted,width:strokeToken(theme, 'rule'),owner:{categoryId:category.id},part:'categoryTick'}); return; }
    put(`stack:category:${category.id}`,text,keyFont,{x:plotX+(i+0.5)*step-box.w/2,y:axisY,w:box.w,h:box.h},{categoryId:category.id},{token:'ink'},'secondary','category',box.lines);
  });
  data.periods?.forEach((period,i)=>{
    const box=periodBoxes![i]!,{indexes,bold,font:f}=box;
    const x=plotX+indexes[0]!*step,y=axisY+categoryHeight+8;
    // A rule over each period; the readout windows take a heavier ink rule and a bold label.
    put(`stack:period:${i}`,period.label,f,{x:x+2,y:y+4,w:box.w,h:box.h},{categoryId:period.from},bold?{token:'ink'}:muted,'secondary','category',box.lines);
    scene.push({t:'line',id:`stack:period:rule:${i}`,x1:x+1.5,x2:x+indexes.length*step-1.5,y1:y,y2:y,stroke:bold?{token:'ink'}:{token:'grid'},width:strokeToken(theme, bold ? 'data' : 'rule'),owner:{},part:'periodRule'});
  });
  for(const request of requests) if(yielding.has(request.id)) request.priority=PRIORITY.interior;
  const solved=solveLabels(requests,occupied,{density:'full',pins:options.labelPlacements??{},measure,plot:frame.plot,canvas:{x:0,y:0,w:size.width,h:size.height},darkInk:theme.color.ink,lightInk:theme.color.inkInverse,labelPad:0});
  const fonts = new Map(requests.map(request => [request.id, request.font]));
  for(const label of solved.placed) { label.ink=inks.get(label.id)??label.ink; label.font=fonts.get(label.id); }
  const hidden=solved.placed.filter(l=>l.hidden&&!yielding.has(l.id));
  if(hidden.length){
    // A value that finds no room on a narrow card needs width: refuse with the narrowest width that places every label.
    const width=(options as { [NO_WIDER_SEARCH]?: boolean })[NO_WIDER_SEARCH]?undefined:widerThatPlaces(raw,options,size,automatic);
    if(width!==undefined)return needsWidth(width);
    spacingError('options.size',`Metric stack cannot place ${hidden.map(l=>`'${l.text}'`).join(', ')} at ${size.width} × ${size.height} px`);
  }
  pushAll(scene, labelsToNodes(theme, solved.placed,()=>valueFont));
  const counts=[structureCount('panels',data.panels.length, undefined, options),structureCount('categories',data.categories.length, undefined, options),structureCount('series',data.measures.length,chartString(options, 'sourceMeasures', { v1: data.measures.length }))];
  return {type:'grid',size,plot:frame.plot,scene,labels:solved.placed,axes:[{axis:'x',baselineNodeId:`${data.panels.at(-1)!.id}:baseline`,ticks:data.categories.map((c,i)=>({at:c.id,pos:plotX+(i+0.5)*step,labelId:`stack:category:${c.id}`}))}],annotations:[],frame:frame.frame,legend:frame.legend,marks,derived:{metricStack:derived,sharedPlotX:plotX,sharedPlotW:plotW,tierGap:gap},
    sizing:{aspect:'content',fit:'content',minWidth:size.width,minHeight:naturalHeight,measuredMinWidth:size.width,measuredMinHeight:naturalHeight,naturalWidth:size.width,naturalHeight,comfortableWidth:size.width,comfortableHeight:naturalHeight},
    a11y:{title:accessibleTitle(options.title,chartString(options, 'metricStackTitle', { v1: data.panels.length })),counts,desc:chartString(options, 'metricStackDesc', { v1: counts.map(c=>c.text).join(', '), v2: data.panels.map(p=>p.title).join('; '), v3: computed.panels.map(p=>`${p.panel.title}: ${p.readout.headlineText}; ${p.readout.spanText}.`).join(' ') })},warnings:solved.warnings,debug:{occupied:occupied.snapshot(),decisions:solved.decisions}};
}
