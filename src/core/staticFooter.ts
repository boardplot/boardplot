/** Static footer layout, linked by static entry points before layout. */
import { footnoteMark } from './footnoteMark';
import { INTERACTIVE_LAYOUT, footerPlans, footerType, staticFrame, wrapFootnote } from './footer';
import { publishDeferred } from './deferred';
import { chartNotes, copyNote, engineNoteMeta, keepNoteMeta, printsNote, shownNoteKinds, sourceLine, unprintedNotes, type ChartNote } from './notes';
import { fittedNote } from './frame';
import { panelTypeClass, spaceTokens } from './theme';
import { chartString, localeStrings } from './strings/frame';
import { CARD_CLASS_WIDTH, heightOmitted } from './sizing';
import { TEXT_ASCENT } from './svg/renderSvg';
import type { FrameGeometry, Geometry, LayoutResult, LintWarning, PlacedLabel, SceneNode } from './types/scene';
import { round2 } from './geometry';
import { maxOf } from './arrays';

let active: { live: boolean; cards: Geometry<object, object>[] } | undefined;
/** Reserve static text in pinned frames; automatic frames can extend below their plot. */
export function layoutWithStaticFooter<D, O extends object, M extends object, DV extends object>(
  layout: (data: D, options?: O) => LayoutResult<M, DV>, data: D, options?: O, type?: string,
): LayoutResult<M, DV> {
  const geometry = staticFooterLayout(layout, data, options, type);
  // A grid speaks for its panels: one warning per chart.
  const noted = geometry.refused || panelTypeClass(options) !== undefined || geometry.warnings.some(w => w.code === 'values-in-note') ? undefined : notedValuesWarning(geometry);
  return noted ? { ...geometry, warnings: [...geometry.warnings, noted] } : geometry;
}

/** The footer height the hidden notes that name values would take if they printed (a list note keeps two lines). */
export function hiddenValueNoteHeight(geo: Geometry<object, object>): number {
  const plan = footerPlan(geo.frame);
  if (!plan) return 0;
  const lineH = plan.font.size * (plan.font.lineHeight ?? 1.3);
  const lines = (geo.frame.noteList ?? []).filter(note => !note.inFrame && note.kind === 'disclosure').reduce((sum, note) => {
    const meta = engineNoteMeta(note);
    if (!meta?.values && !meta?.list) return sum;
    const wrapped = wrapFootnote(note.short ?? note.text, plan.font, plan.width, plan.measure).length;
    return sum + (meta.list ? Math.min(2, wrapped) : wrapped);
  }, 0);
  return lines === 0 ? 0 : lines * lineH + plan.tokens.gapFootnoteSource;
}

/**
 * one info warning per chart, `values-in-note`, lists every
 * value and name the chart moved into a note: each noted label (by the name
 * the note gives it, else by id and text) and each item of a value note (`valueNoteLine`), so a check of the
 * warnings sees what the drawing does not print. Static entries only; live
 * React does not link this module.
 */
function notedValuesWarning(geo: Geometry<object, object>): LintWarning | undefined {
  const notes = chartNotes(geo).filter(note => engineNoteMeta(note)?.values);
  // Gantt already names these arrows in a specific warning, including in live React.
  const warnedArrows = new Set(geo.warnings.filter(warning => warning.code === 'gantt-arrow-label-hidden')
    .flatMap(warning => warning.owner?.segmentId ? [warning.owner.segmentId] : []));
  // A label a value note names already (its noteLocation leads with that note) is listed once, by the note.
  const inNote = (label: PlacedLabel) => notes.some(note => label.noteLocation !== undefined && note.text.startsWith(label.noteLocation.replace(/ \([^()]*\)$/, '')));
  const values = [...new Set([...geo.labels.flatMap(label => (label.hidden !== undefined && label.noted && !inNote(label)
    && !warnedArrows.has(label.owner.segmentId ?? '') ? [label.noteText ?? label.text] : [])),
    ...notes.flatMap(note => engineNoteMeta(note)!.values!)])];
  return values.length === 0 ? undefined : { code: 'values-in-note', severity: 'info',
    message: `${values.length} value${values.length === 1 ? ' has' : 's have'} no label on the chart. Notes can list or count these values; the full values follow: ${values.join(', ')}`,
    detail: { values } };
}

function staticFooterLayout<D, O extends object, M extends object, DV extends object>(
  layout: (data: D, options?: O) => LayoutResult<M, DV>, data: D, options?: O, type?: string,
): LayoutResult<M, DV> {
  const parent = active;
  const current = active = { live: !!(parent?.live || (options as { [INTERACTIVE_LAYOUT]?: boolean } | undefined)?.[INTERACTIVE_LAYOUT]),
    cards: [] as Geometry<object, object>[] };
  const previousPinned = staticFrame.pinned;
  const previousCountable = staticFrame.countable;
  const previousLive = staticFrame.live;
  staticFrame.countable = false;
  staticFrame.live = current.live;
  staticFrame.pinned = !current.live && !panelTypeClass(options) && (!parent || previousPinned)
    // Tables reserve the footer too. Fitting a choropleth's map credit needs a separate map layout change.
    && type !== 'choropleth'
    && !heightOmitted((options as { size?: unknown } | undefined)?.size);
  try {
    const geometry = layout(data, options);
    if (staticFrame.pinned && geometry.refused && geometry.warnings[0]?.code === 'size-below-floor') {
      // Keep an existing exact fit when its footer can use space below the marks.
      staticFrame.pinned = false;
      const prior = layout(data, options);
      staticFrame.pinned = true;
      if (!prior.refused) {
        const fitted = withStaticFooter(prior);
        if (fitted.size.width === geometry.size.width && fitted.size.height === geometry.size.height) return fitted;
      }
    }
    if (current.live || geometry.refused) return geometry;
    const notesOff = (options as { footnotes?: unknown } | undefined)?.footnotes === false;
    const show = shownNoteKinds(options as Parameters<typeof shownNoteKinds>[0]);
    if (!footerPlans.has(geometry.frame) && geometry.frame.noteList?.some(note => !note.inFrame && printsNote(note, show)
      && (!notesOff || note.kind === 'source' || note.kind === 'credit'))) {
      const warning = { code: 'static-footer-plan-missing', severity: 'error' as const,
        message: 'Static output cannot print all enabled notes because its footer plan is missing.' };
      if (typeof process !== 'undefined' && process.env.VITEST) throw new Error(`${warning.code}: ${warning.message}`);
      return { ...geometry, warnings: [...geometry.warnings, warning] };
    }
    if (panelTypeClass(options)) return geometry;
    const automatic = heightOmitted((options as { size?: unknown } | undefined)?.size);
    const minimumHeight = automatic ? Math.max(0, maxOf(current.cards.filter(card => card.type === geometry.type
      && card.size.width > geometry.size.width).map(card => card.size.height))) : 0;
    const expanded = withStaticFooter(geometry, minimumHeight);
    // A pinned canvas height is a promise to the host. The footer that the
    // static output adds may still need more room; say so instead of drawing
    // a taller SVG silently.
    if (!automatic && expanded !== geometry && expanded.size.height > geometry.size.height + 0.01) {
      expanded.warnings.push({ code: 'static-footer-grew', severity: 'info',
        message: `the notes and source need ${round2(expanded.size.height)} px; the canvas grew past the set height of ${geometry.size.height} px`,
        suggest: `set the height to ${Math.ceil(expanded.size.height)} px, or shorten the notes` });
    }
    if (parent && automatic && geometry.size.width <= CARD_CLASS_WIDTH) parent.cards.push(expanded);
    return parent ? geometry : expanded;
  } finally {
    active = parent;
    staticFrame.pinned = previousPinned;
    staticFrame.countable = previousCountable;
    staticFrame.live = previousLive;
  }
}


type Panel = { id: string; titleNodeId?: string; chart?: { geometry: Geometry<object, object>; offset: { x: number; y: number } } };
function footerPlan(frame: FrameGeometry) {
  const input = footerPlans.get(frame);
  if (!input) return;
  const tokens = spaceTokens(input.theme, input.size.width);
  return { input, tokens: input.cardGaps ? { ...tokens, gapAxisFootnote: 8, gapFootnoteSource: 0 } : tokens,
    source: input.source ? sourceLine(input.source, input.strings?.source ?? localeStrings().source) : undefined,
    notes: frame.noteList ?? [],
    noteIds: (frame.noteList ?? []).filter(note => note.inFrame && note.kind !== 'source' && note.kind !== 'credit')
      .map((note, i) => ({ note, id: frame.footnoteNodeIds?.[i] })),
    font: { family: input.theme.type.family, ...footerType(input.theme.type.footnote, input.target, input.textScale) },
    // A table's footer keeps its cell air in (footerInset), as the frame draws it.
    measure: input.measure, x: input.margin.left + (input.footerInset ?? 0),
    width: input.size.width - input.margin.left - input.margin.right - 2 * (input.footerInset ?? 0), bottom: input.margin.bottom };
}
type StaticFooterPlan = NonNullable<ReturnType<typeof footerPlan>>;
const footerIds = (frame: FrameGeometry) => [frame.sourceNodeId, frame.creditNodeId, ...(frame.footnoteNodeIds ?? [])];
function allNotes(plan: StaticFooterPlan): ChartNote[] {
  // a capped list note names what fits two footer lines here, as in the frame.
  const fit = (note: ChartNote): ChartNote => {
    const meta = engineNoteMeta(note);
    if (!meta?.list) return note;
    const fitted = fittedNote(meta.list, text => wrapFootnote(text, plan.font, plan.width, plan.measure).length <= 2);
    return keepNoteMeta(meta.short ? { ...note, short: fitted } : { ...note, text: fitted }, { ...meta, ...(meta.short ? { short: fitted } : {}) });
  };
  if (!plan.input.numberedFootnotes?.some(text => !plan.notes.some(note => note.text === text))) return plan.notes.map(fit);
  const used = new Set<number>();
  const authored = plan.input.numberedFootnotes.map((text, i): ChartNote => {
    const at = plan.notes.findIndex((note, j) => !used.has(j) && note.kind === 'note' && note.text === text);
    if (at >= 0) used.add(at);
    return { n: i + 1, kind: 'note', text, inFrame: at >= 0 && plan.notes[at]!.inFrame,
      ...(!plan.input.unreferencedNotes?.includes(i + 1) ? { ref: i + 1 } : {}) };
  });
  return [...authored, ...plan.notes.filter((_, i) => !used.has(i)).map(fit)].map((note, i) => copyNote(note, { n: i + 1 }));
}
const enabledNotes = (plan: StaticFooterPlan) => allNotes(plan).filter(note => printsNote(note, plan.input.notes?.show)
  && (!plan.input.footnotesOff || note.inFrame || note.kind === 'source' || note.kind === 'credit'));
function needsFooter(geometry: Geometry<object, object>, plan: StaticFooterPlan): boolean {
  const source = geometry.scene.find(node => node.id === geometry.frame.sourceNodeId);
  return !!(source?.t === 'text' && source.title) || enabledNotes(plan).some(note => !note.inFrame
    || (!plan.input.fullStaticFooter && note.kind === 'method' && note.short && note.short !== note.text));
}

/**
 * Under 'info', a React chart that draws this footer (content fit) keeps every note the footer
 * does not print one press away, behind its "Notes and sources (N)" button. The footer keeps the
 * button's width free after its source line or its last line, else an empty row under it, so the image and
 * the live chart break their lines the same and stand equally tall. The width, gap included.
 */
function notesButtonWidth(geometry: Geometry<object, object>, plan: StaticFooterPlan): number | undefined {
  // A table (footerInset) draws in React as an HTML table with its own footer (TableChart), never this one.
  if (geometry.frame.notePlacement !== 'info' || plan.input.footnotesOff || plan.input.notes?.pointer === false || plan.input.footerInset !== undefined) return undefined;
  const printed = new Set(enabledNotes(plan).map(note => note.n));
  // As ChartFooter lists them (chartNotes): the notes list, then the compact notes.
  const count = unprintedNotes([...allNotes(plan).map(note => copyNote(note, { inFrame: printed.has(note.n) })),
    ...(geometry.a11y?.compactNotes ?? []).map((text): ChartNote => ({ n: 0, kind: 'note', text, inFrame: false }))]).length;
  if (!count) return undefined;
  // ChartFooter sets the button 0.75em after the line.
  return plan.font.size * 0.75 + plan.measure(`${chartString(plan.input, 'notesAndSources')} (${count})`, plan.font).width;
}
const buttonFits = (lines: readonly string[], button: number, plan: StaticFooterPlan) =>
  lines.length > 0 && plan.measure(lines[lines.length - 1]!, plan.font).width + button <= plan.width;

/** The frame's own footer with the button's empty row under its last line (at `y`): the canvas grows by one line. */
function withNotesRow<G extends Geometry<object, object>>(geometry: G, y: number, button: number, plan: StaticFooterPlan): G {
  const lineH = plan.font.size * (plan.font.lineHeight ?? 1.3);
  const height = round2(geometry.size.height + lineH);
  const growth = height - geometry.size.height;
  const rect = geometry.frame.footerRect;
  const natural = geometry.presentation?.naturalSize;
  return {
    ...geometry, size: { ...geometry.size, height },
    frame: { ...geometry.frame, notesButton: { y },
      footerRect: rect ? { ...rect, h: rect.h + growth } : { x: plan.x, y, w: plan.width, h: height - y },
      ...(geometry.frame.minHeight !== undefined ? { minHeight: geometry.frame.minHeight + growth } : {}),
      ...(geometry.frame.plotMinHeight !== undefined ? { plotMinHeight: geometry.frame.plotMinHeight + growth } : {}) },
    ...(geometry.sizing ? { sizing: { ...geometry.sizing, naturalHeight: round2(geometry.sizing.naturalHeight + growth) } } : {}),
    ...(geometry.presentation && natural ? { presentation: {
      ...geometry.presentation, naturalSize: { ...natural, height: natural.height * height / geometry.size.height },
    } } : {}),
    debug: { ...geometry.debug, occupied: [...geometry.debug.occupied, { rect: { x: plan.x, y, w: button, h: lineH }, kind: 'frame' as const, owner: {} }] },
  };
}

/** Finish static geometry after plot and story layout. Renderers only paint it. */
function withStaticFooter<G extends Geometry<object, object>>(geometry: G, minimumHeight = 0): G {
  const plan = footerPlan(geometry.frame);
  if (!plan) return geometry;
  const groups: { plan: StaticFooterPlan; panel?: string; title?: string }[] = [];
  const removed = new Set<string | undefined>();
  const oldRects: { x: number; y: number; w: number; h: number }[] = [];
  const collectPanels = (geo: Geometry<object, object>, prefix = '', x = 0, y = 0): Geometry<object, object> => {
    if (geo.type !== 'grid') return geo;
    const panels = (geo.marks as { panels?: Panel[] }).panels;
    if (!panels) return geo;
    return { ...geo, marks: { ...geo.marks, panels: panels.map(panel => {
      if (!panel.chart) return panel;
      const child = panel.chart.geometry;
      const id = `${prefix}${panel.id}`;
      const dx = x + panel.chart.offset.x, dy = y + panel.chart.offset.y;
      let cleaned = collectPanels(child, `${id}/`, dx, dy);
      const childPlan = footerPlan(child.frame);
      if (childPlan && needsFooter(child, childPlan)) {
        const title = geo.scene.find(node => node.id === panel.titleNodeId);
        const name = title?.t === 'text' ? title.lines.join(' ') : panel.id;
        groups.push({ plan: childPlan, panel: id, title: name === id ? id : `${name} (${id})` });
        const ids = footerIds(child.frame);
        for (const nodeId of ids) if (nodeId) removed.add(`${id}/${nodeId}`);
        const rect = child.frame.footerRect;
        if (rect) oldRects.push({ ...rect, x: rect.x + dx, y: rect.y + dy });
        cleaned = { ...cleaned, scene: cleaned.scene.filter(node => !ids.includes(node.id)),
          frame: { ...cleaned.frame, sourceNodeId: undefined, creditNodeId: undefined, footnoteNodeIds: [], footerRect: undefined } };
      }
      return cleaned === child ? panel : { ...panel, chart: { ...panel.chart, geometry: cleaned } };
    }) } };
  };
  const collected = collectPanels(geometry);
  const button = notesButtonWidth(geometry, plan);
  if (!groups.length && !needsFooter(geometry, plan) && minimumHeight <= geometry.size.height) {
    if (button === undefined) return geometry;
    // The frame's own footer stays: the button goes after its source line, else after its last line, else in a row under it.
    const drawn = geometry.scene.filter((node): node is Extract<SceneNode, { t: 'text' }> => node.t === 'text' && footerIds(geometry.frame).includes(node.id))
      .sort((a, b) => a.y - b.y);
    const last = drawn.at(-1);
    const host = [drawn.find(node => node.id === geometry.frame.sourceNodeId), last].find(node => node && buttonFits(node.lines, button, plan));
    if (host) return { ...geometry, frame: { ...geometry.frame, notesButton: { nodeId: host.id } } };
    if (last) return withNotesRow(geometry, last.y + last.font.size * (last.font.lineHeight ?? 1.3) * last.lines.length, button, plan);
  }
  const notes = enabledNotes(plan);
  groups.unshift({ plan });
  const old = geometry.frame.footerRect;
  if (old) oldRects.push(old);
  for (const id of footerIds(geometry.frame)) removed.add(id);
  const parts = groups.flatMap(group => [
    ...(group.title ? [{ kind: 'footnote', text: group.title, panel: group.panel, oldId: undefined }] : []),
    ...enabledNotes(group.plan).map(note => ({
      kind: note.kind === 'source' || note.kind === 'credit' ? note.kind : 'footnote', panel: group.panel,
      oldId: group.plan.noteIds.find(({ note: old }) => old.kind === note.kind && old.text === note.text && old.ref === note.ref)?.id,
      text: note.kind === 'source' ? group.plan.source! : note.kind === 'credit' ? `${chartString(group.plan.input, 'mapCredit')}: ${note.text}`
        : `${note.ref ? `${footnoteMark(note.ref)} ` : ''}${note.kind === 'disclosure' ? note.short ?? note.text : note.text}`,
    })),
  ]).map(part => ({ ...part, lines: wrapFootnote(part.text, plan.font, plan.width, plan.measure) }));
  const lineH = plan.font.size * (plan.font.lineHeight ?? 1.3);
  const nodes: SceneNode[] = [];
  const moved = new Map<string, string>();
  const frame: FrameGeometry = { ...geometry.frame, notes: geometry.frame.notes?.filter(text => !notes.some(note => note.text === text || engineNoteMeta(note)?.list === (engineNoteMeta(text)?.list ?? 0))),
    noteList: allNotes(plan).map(note => notes.some(shown => shown.n === note.n) ? copyNote(note, { inFrame: true }) : note),
    source: undefined, sourceNodeId: undefined, creditNodeId: undefined, footnoteNodeIds: [] };
  // The button's host: the source line, else the last line of the chart's own footer, where it fits; else an empty row.
  const sourceAt = parts.findIndex(part => part.kind === 'source' && !part.panel);
  const lastAt = parts.reduce((at, part, i) => part.panel ? at : i, -1);
  const hostAt = button === undefined ? -1 : [sourceAt, lastAt].find(at => at >= 0 && buttonFits(parts[at]!.lines, button, plan)) ?? -1;
  const inline = hostAt >= 0;
  const row = button !== undefined && !inline;
  let hostId: string | undefined;
  let y = row ? -lineH : 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    y -= lineH * part.lines.length;
    const id = `static-footer:${part.kind}:${nodes.length}`;
    if (i === hostAt && inline) hostId = id;
    if (part.oldId) moved.set(`${part.panel ? `${part.panel}/` : ''}${part.oldId}`, id);
    nodes.push({ t: 'text', id, x: plan.x, y, lines: part.lines, align: 'start', font: plan.font,
      ink: { token: part.kind === 'footnote' ? plan.input.footnoteInk ?? 'inkMuted' : 'inkMuted' }, owner: {}, part: part.kind, typeRole: 'footnote',
      ...(part.panel ? { origin: { owner: {}, panels: part.panel.split('/') } } : {}) });
    if (part.kind === 'source' && !part.panel) frame.sourceNodeId = id;
    else if (part.kind === 'credit' && !part.panel) frame.creditNodeId = id;
    else frame.footnoteNodeIds!.unshift(id);
    if (i > 0 && (part.kind === 'source' || (part.kind === 'credit' && parts[i - 1]!.kind === 'footnote')
      || part.panel !== parts[i - 1]!.panel)) y -= plan.tokens.gapFootnoteSource;
  }
  // Use the empty footer space after the last chart element. Only the canvas
  // extension belongs to footerRect, so the plot-share denominator stays intact.
  const occupied = geometry.debug.occupied.filter(item => !oldRects.some(rect => item.kind === 'frame' && item.rect.x === rect.x
    && item.rect.y >= rect.y - 1e-6 && item.rect.y + item.rect.h <= rect.y + rect.h + 1e-6));
  const last = geometry.story?.staticPanel;
  let bottom = occupied.reduce((edge, { rect }) => Math.max(edge, rect.y + rect.h),
    Math.max(geometry.plot.y + geometry.plot.h, last ? last.y + last.h : 0));
  // Axis claims can predate text rotation. Measure those line boxes about the
  // same baseline anchor used by both renderers before placing the footer.
  for (const node of geometry.scene) if (node.t === 'text' && node.rotate && node.opacity !== 0 && !removed.has(node.id)) {
    const width = Math.max(0, ...node.lines.map(line => plan.measure(line, node.font).width));
    const left = node.align === 'end' ? -width : node.align === 'middle' ? -width / 2 : 0;
    const ascent = node.font.size * TEXT_ASCENT;
    const height = node.lines.length * node.font.size * (node.font.lineHeight ?? 1.2);
    const angle = node.rotate * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
    bottom = Math.max(bottom, node.y + (node.ty ?? 0) + ascent
      + Math.max(left * sin, (left + width) * sin) + Math.max(-ascent * cos, (height - ascent) * cos));
  }
  const start = bottom + plan.tokens.gapAxisFootnote;
  const top = geometry.size.height;
  // Round to 0.01 px: float noise in the sum broke height round trips
  // (a natural height of 513.3999999 drew back as 513.4).
  const height = round2(geometry.size.height + Math.max(0, start - y + plan.bottom - top, minimumHeight - top));
  const growth = height - geometry.size.height;
  frame.footerRect = { x: plan.x, y: top, w: plan.width, h: growth };
  if (frame.minHeight !== undefined) frame.minHeight += growth;
  if (frame.plotMinHeight !== undefined) frame.plotMinHeight += growth;
  for (const node of nodes) if (node.t === 'text') node.y += start - y;
  if (inline) frame.notesButton = { nodeId: hostId };
  else if (row) frame.notesButton = { y: start - y - lineH };
  // The space alone keeps the grown height. 'none' is no colour the SVG writer accepts, so a footer with no text keeps a transparent rect.
  if (!nodes.length) nodes.push({ t: 'rect', id: 'static-footer:space', rect: frame.footerRect, fill: { css: 'transparent' }, owner: {}, part: 'footnote' });
  // Grid labels also exist in their child geometry. Update children first so
  // their flattened labels keep the same destination in the outer scene.
  const destinations = new Map<string, string>();
  const remapLabels = (geo: Geometry<object, object>, prefix = ''): Geometry<object, object> => {
    const panels = geo.type === 'grid' ? (geo.marks as { panels?: Panel[] }).panels : undefined;
    const marks = panels ? { ...geo.marks, panels: panels.map(panel => panel.chart ? { ...panel,
      chart: { ...panel.chart, geometry: remapLabels(panel.chart.geometry, `${prefix}${panel.id}/`) },
    } : panel) } : geo.marks;
    return { ...geo, marks, labels: geo.labels.map(label => {
      if (!label.noteLocation) return label;
      const noteLocation = destinations.get(`${prefix}${label.id}`) ?? label.noteLocation.replace(/\(([^()]*)\)$/, (match, id: string) =>
        moved.has(`${prefix}${id}`) ? `(${moved.get(`${prefix}${id}`)})` : match);
      if (noteLocation === label.noteLocation) return label;
      destinations.set(`${prefix}${label.id}`, noteLocation);
      return { ...label, noteLocation };
    }) };
  };
  const remapped = remapLabels(collected);
  const natural = geometry.presentation?.naturalSize;
  return {
    ...geometry, marks: remapped.marks, labels: remapped.labels, size: { ...geometry.size, height }, frame,
    scene: [...geometry.scene.filter(node => !removed.has(node.id)), ...nodes],
    warnings: geometry.warnings.filter(w => w.code !== 'compact-notes-omitted'),
    ...(geometry.sizing ? { sizing: { ...geometry.sizing, naturalHeight: round2(geometry.sizing.naturalHeight + growth) } } : {}),
    ...(geometry.presentation && natural ? { presentation: {
      ...geometry.presentation, naturalSize: { ...natural, height: natural.height * height / geometry.size.height },
    } } : {}),
    debug: { ...geometry.debug, occupied: [
      ...occupied,
      ...nodes.flatMap(node => node.t === 'text' ? [{ rect: { x: node.x, y: node.y, w: plan.width, h: lineH * node.lines.length }, kind: 'frame' as const, owner: {} }] : []),
      ...(row ? [{ rect: { x: plan.x, y: start - y - lineH, w: button!, h: lineH }, kind: 'frame' as const, owner: {} }] : []),
    ] },
  } as G;
}


export function linkStaticFooter(): void {
  publishDeferred('footer', layoutWithStaticFooter);
}
