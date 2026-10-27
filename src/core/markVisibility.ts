import { isHatchPattern } from './svgPath';
/**
 * MARK VISIBILITY — one policy, applied at the scene, not at the theme.
 *
 * WHAT THIS EXISTS FOR. `color.others` is a primary categorical fill on
 * bar (`mark:__others:*`), mekko (`mark:<series>:others`) and pie
 * (`mark:<series>:others`), and it sits below the repo's own mark floor in all
 * six shipped presets — 1.13:1 to 1.52:1, floor 1.4 light / 3 dark. On
 * `bar/topn-others` the invisible bar is the second largest on the chart; on
 * `mekko/topn-others` all three segments of the Others column are the same
 * hex, so the legend is false for the whole column; on
 * `pie/topn-others-explode` the largest, exploded wedge is additionally
 * stroked `background`, so without this policy it has neither a visible fill
 * nor a visible edge.
 *
 * WHY THE FIX IS NOT "DARKEN THE TOKEN". `themeValidate.ts` exempts `others`
 * (and `total`, `neutral`, `neutralLight`) from the judgment-token visibility
 * gate ON PURPOSE, in writing: under PL notation the library paints these
 * background-coloured WITH AN OUTLINE (`scenario 'PL' -> pattern 'outline'`),
 * and `others` is separately railed from ABOVE — it must never read stronger
 * than `series[0]`, because it means "the rest". Darkening the token breaks
 * that rail and rejects themes a designer would ship (`{total:'#F5F5F5'}` on
 * white). The exemption is sound for the case it names.
 *
 * The exemption covers `neutral` as a GROUND only: a band, a zebra, a wash.
 * A mark that paints in the neutral carries `neutralMark`, which falls
 * back to `neutral` and is held to this floor like any series
 * (`series-invisible`, themeRules.ts).
 *
 * What the exemption cannot know is whether a given RENDER strokes the mark.
 * That fact does not exist in a theme; it exists in the scene. So the rail
 * belongs here, and it is the exemption's own premise turned into a rule:
 *
 *   A mark that carries a reading of its own must have EITHER a fill that
 *   clears the floor against what is actually behind it OR a stroke that
 *   clears the floor against both that fill and that backing. Never neither.
 *
 * `pattern: 'outline'` satisfies the second arm by construction (renderSvg.ts
 * paints fill=background, stroke=the mark's nominal colour), which is exactly
 * why the notation convention the exemption protects stays legal and untouched.
 *
 * THE SAME RULE, A SECOND SUBJECT: a gantt milestone diamond is
 * painted `status.gantt-cadence` inside a bar painted `status.gantt-workstream`
 * — the identical hex in three presets (1.00:1) and 1.19–1.55:1 in the other
 * three, i.e. below the floor in 6 of 6. `others` is measured against the page;
 * the milestone is measured against the bar it sits in. One rule covers both,
 * which is why this is a module and not four patches.
 */

import { contrastRatio, relativeLuminance, parseColor } from './color';
import { MARK_CONTRAST_FLOOR } from './themeRules';
import { contrastInkPaint, mixedPaint, paintColor, paintTokenColor, strokeToken } from './theme';
import { measureText } from './text';
import type { Geometry, MarkOnBand, Paint, PlacedLabel, SceneNode, SeparationRule } from './types/scene';
import type { Theme } from './types/theme';
import type { OwnerRef } from './types/cell';

/**
 * The repo's own bar for a categorical fill against its surface —
 * `seriesBackgroundFloor`, themeValidate.ts:207. Not a new number.
 */
export function markVisibilityFloor(background: string): number {
  return contrastRatio(background, '#FFFFFF') > contrastRatio(background, '#000000') ? 3 : 1.4;
}

/**
 * Quiet first, loud only if quiet does not separate — and the list must be
 * able to go DARK as well as light, because the separator's job is to differ
 * from two tones at once and the failing cases are not all pale.
 *
 * `inkMuted` is the library's "readable but subordinate" tone and is already
 * railed at 3:1 on the background (`contrast-ink-muted`, error severity), so on
 * a light preset it usually wins outright. The last two exist for a measured
 * reason: a gantt milestone inside a gantt bar is `#4D8EC5` on `#4D8EC5` in
 * `standard-dark` and `#D5D5D5` on `#ACACAC` in `notation-dark`, and BOTH of those
 * backings sit mid-scale on a dark page, where every light candidate falls
 * short of the 3:1 dark floor (best: 2.73 and 1.49). `inkInverse` — the dark
 * ink of a dark theme — clears them at 5.02 and 8.82. Two presets that a
 * quiet-only list would have left broken.
 */
const CANDIDATES = ['inkMuted', 'axis', 'ink', 'inkInverse'] as const;

/**
 * A page, light or dark, draws no contrast edge or outline round a fill by default: not the
 * 3:1 edge, the pale stack-ramp outline, or the Others, rest and slice outlines. `marks.contrastEdge:
 * true` restores them. A mark that crosses another fill keeps its own.
 */
export function fillEdgesOff(theme: Theme): boolean {
  return theme.marks?.contrastEdge !== true;
}

/** The plate under a label on hatch: 3 px of page colour beside the text, 1 px over and under, corners 2 px. */
export function labelPlate(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: rect.x - 3, y: rect.y - 1, w: rect.w + 6, h: rect.h + 2 };
}
export const LABEL_PLATE_RADIUS = 2;

/** A label over hatch strokes stands on a plate in the page colour. */
export function haloHatchedInsideLabels(nodes: readonly SceneNode[], labels: PlacedLabel[]): void {
  const rects = nodes.filter((node) => node.t === 'rect').reverse();
  if (!rects.some((node) => isHatchPattern(node.pattern))) return;
  for (const label of labels) {
    if (label.hidden || label.backing) continue;
    const x = label.rect.x + label.rect.w / 2;
    const y = label.rect.y + label.rect.h / 2;
    const host = rects.find((node) => {
      const left = node.rect.x + (node.tx ?? 0);
      const top = node.rect.y + (node.ty ?? 0);
      return x >= left && x <= left + node.rect.w && y >= top && y <= top + node.rect.h;
    });
    if (!isHatchPattern(host?.pattern)) continue;
    label.plate = true;
    label.halo = false;
    if ('token' in label.ink && (
      label.ink.token === 'ink' || label.ink.token === 'inkInverse' || label.ink.theme?.kind === 'contrast-ink'
    )) label.ink = { token: 'ink' };
  }
}

/**
 * The outline a mark needs to be separable from `backing`, or `undefined` when
 * its own fill already clears the floor and no outline is warranted.
 *
 * Returns `undefined` ALSO when no candidate separates. That is deliberate: a
 * silent best-effort stroke would paper over an unreadable mark.
 */
export function separationStroke(
  fillCss: string,
  backingCss: string,
  theme: Theme,
  surface = false,
): { stroke: Paint; strokeWidth: number } | undefined {
  // A mark that crosses another fill (a bullet bar over its bands, a gantt
  // milestone in its bar) is a mark against a fill: 3:1. A fill
  // on the page keeps the page floor, and so does a fill on a `surface`, a
  // tint of the page that marks rows or time rather than data (a gantt's
  // alternate rows, its elapsed band). Held to 3:1 there, a grey "in
  // progress" bar drew the only dark outline in the chart.
  const onPage = surface || contrastRatio(backingCss, theme.color.background) === 1;
  if (onPage && fillEdgesOff(theme)) return undefined;
  const floor = onPage ? markVisibilityFloor(theme.color.background) : MARK_CONTRAST_FLOOR;
  if (contrastRatio(fillCss, backingCss) >= floor) return undefined;
  for (const token of CANDIDATES) {
    const css = theme.color[token];
    if (contrastRatio(css, fillCss) >= floor && contrastRatio(css, backingCss) >= floor) {
      // Same weight as the notation outline convention, so an outlined "rest" bar
      // reads as the notation it already is rather than as a new device.
      return { stroke: { token }, strokeWidth: theme.pattern.outlineStrokeWidth };
    }
  }
  return undefined;
}

/** deepen a pale segment's own fill, rather than draw an ink ring. */
export function segmentSeparationStroke(
  fill: Paint, backingCss: string, theme: Theme,
): { stroke: Paint; strokeWidth: number } | undefined {
  if (fillEdgesOff(theme)) return undefined;
  const fillCss = paintColor(theme, fill);
  // Transparent and unsupported fills have no luminance to deepen.
  if (!parseColor(fillCss)) return separationStroke(fillCss, backingCss, theme);
  const floor = markVisibilityFloor(theme.color.background);
  if (contrastRatio(fillCss, backingCss) >= floor) return undefined;
  const luminance = (css: string) => relativeLuminance(parseColor(css)!);
  const token = luminance(theme.color.ink) < luminance(theme.color.inkInverse) ? 'ink' : 'inkInverse';
  // The first legal step keeps as much of the segment colour as possible.
  for (let step = 1; step < 100; step++) {
    const stroke = mixedPaint(fill, { token }, 1 - step / 100);
    const css = paintColor(theme, stroke);
    if (luminance(css) < luminance(fillCss) && contrastRatio(css, fillCss) >= floor && contrastRatio(css, backingCss) >= floor) {
      return { stroke, strokeWidth: theme.pattern.outlineStrokeWidth };
    }
  }
  // A dark fill on a dark page cannot gain visibility by getting darker.
  return separationStroke(fillCss, backingCss, theme);
}

/**
 * WCAG 1.4.11: the edge of a light-page fill under 3:1 that no visible text
 * carries. The fill keeps its colour; the edge is the theme's rule width, in the fill's own
 * hue at the lightest tone that reaches 3:1 against every ground the mark lies on.
 */
function ruleEdge(fill: Paint, grounds: readonly string[], theme: Theme): { stroke: Paint; strokeWidth: number } | undefined {
  const background = theme.color.background;
  // A dark page already holds every fill to 3:1 (markVisibilityFloor).
  if (contrastRatio(background, '#FFFFFF') > contrastRatio(background, '#000000')) return undefined;
  const fillCss = paintColor(theme, fill);
  if (!parseColor(fillCss)) return undefined;
  const clears = (css: string) => grounds.every((ground) => contrastRatio(css, ground) >= MARK_CONTRAST_FLOOR);
  if (clears(fillCss)) return undefined;
  // A pale step of the stack ramp takes the thin neutral outline Boardplot gives
  // pale fills (the bartable range: neutral at hair width), where that outline reaches 3:1.
  if ('theme' in fill && fill.theme?.kind === 'stack-ramp' && clears(paintTokenColor(theme, 'neutral'))) {
    return { stroke: { token: 'neutral' }, strokeWidth: strokeToken(theme, 'hair') };
  }
  const luminance = (css: string) => relativeLuminance(parseColor(css)!);
  const token = luminance(theme.color.ink) < luminance(theme.color.inkInverse) ? 'ink' : 'inkInverse';
  // The edge is the fill's own colour, deepened: it carries the fill's role, not 'neutral'.
  const role = 'token' in fill ? fill.token : undefined;
  for (let step = 1; step <= 100; step++) {
    const stroke = mixedPaint(fill, { token }, 1 - step / 100, role);
    if (clears(paintColor(theme, stroke))) return { stroke, strokeWidth: strokeToken(theme, 'rule') };
  }
  return undefined;
}

/** The stroke a separation rule gives its node under `theme`, with or without the 3:1 edge. */
function ruleStroke(rule: SeparationRule, part: string, theme: Theme, strict: boolean): { stroke: Paint; strokeWidth: number } | undefined {
  if (markOutlineOff(rule.fill, theme) || sliceOutlineOff(part, theme)) return rule.fallback;
  const fill = paintColor(theme, rule.fill);
  const backing = (rule.alternateBackings ?? []).reduce((nearest, paint) => {
    const candidate = paintColor(theme, paint);
    return contrastRatio(fill, candidate) < contrastRatio(fill, nearest) ? candidate : nearest;
  }, paintColor(theme, rule.backing));
  const base = rule.fillStep ? segmentSeparationStroke(rule.fill, backing, theme) : separationStroke(fill, backing, theme, rule.surface === true);
  // The 3:1 edge is for a mark on the page (or a page surface), not one crossing another fill.
  const onPage = rule.fillStep === true || rule.surface === true || contrastRatio(backing, theme.color.background) === 1;
  if (!strict || theme.marks?.contrastEdge !== true || !onPage || markVisibilityFloor(theme.color.background) === MARK_CONTRAST_FLOOR) return base ?? rule.fallback;
  const grounds = [theme.color.background, backing, ...(rule.grounds ?? []).map((paint) => paintColor(theme, paint))];
  if (base && grounds.every((ground) => contrastRatio(paintColor(theme, base.stroke), ground) >= MARK_CONTRAST_FLOOR)) return base;
  return ruleEdge(rule.fill, grounds, theme) ?? rule.fallback;
}

/** Ink the engine chose (ink / inkInverse / the contrast recipe), as opposed to an authored or semantic ink. */
function autoInk(ink: Paint): boolean {
  return 'token' in ink && (ink.token === 'ink' || ink.token === 'inkInverse' || ink.theme?.kind === 'contrast-ink');
}

/**
 * Re-ink an inside label whose own host another mark covers. The test uses
 * the label centre and scene order, so labels on their own marks stay plain.
 * A label wholly on the covering fill reads against it: auto ink
 * becomes the contrast recipe for it. A label the cover holds only in part
 * (its glyphs sit on two fills), an authored or semantic ink, and any label
 * on a hatched cover keep the page halo. The choice never depends on a colour,
 * so a light and a dark layout of one chart draw the same scene.
 * Call after scene marks are added and before labelsToNodes.
 */
export function haloOverpaintedInsideLabels(
  nodes: readonly SceneNode[],
  labels: PlacedLabel[],
  theme: Theme,
): number {
  interface Painted { x: number; y: number; w: number; h: number; owner: string; fill: Paint; pattern?: import('./types/scene').HatchPattern | 'outline' }
  /** Owner identity as a string, so "same mark, same reading" is one compare. */
  const ownerKey = (owner: { seriesId?: string; categoryId?: string; segmentId?: string } | undefined) =>
    `${owner?.seriesId ?? ''}|${owner?.categoryId ?? ''}|${owner?.segmentId ?? ''}`;
  const painted: Painted[] = [];
  for (const node of nodes) {
    if (node.t !== 'rect') continue;
    if (!String(node.id).startsWith('mark:')) continue;
    painted.push({
      x: node.rect.x + (node.tx ?? 0),
      y: node.rect.y + (node.ty ?? 0),
      w: node.rect.w,
      h: node.rect.h,
      owner: ownerKey(node.owner),
      fill: node.fill,
      ...(isHatchPattern(node.pattern) || node.pattern === 'outline' ? { pattern: node.pattern } : {}),
    });
  }
  let marked = 0;
  for (const label of labels) {
    if (label.hidden || label.halo || label.backing || label.leader) continue;
    if (!String(label.slot).startsWith('inside')) continue;
    const cx = label.rect.x + label.rect.w / 2;
    const cy = label.rect.y + label.rect.h / 2;
    let topmost: Painted | undefined;
    for (const mark of painted) {
      if (cx >= mark.x && cx <= mark.x + mark.w && cy >= mark.y && cy <= mark.y + mark.h) topmost = mark;
    }
    if (topmost === undefined) continue;
    const ownHost = ownerKey(label.owner);
    // The label's id is `<kind>:<seriesId>:<categoryId>`-shaped and the mark's
    // is `mark:<...>`, so the OWNER is the reliable join, not the id.
    if (painted.some((mark) => mark.owner === ownHost) && topmost.owner !== ownHost) {
      const r = label.rect;
      const covered = r.x >= topmost.x && r.y >= topmost.y && r.x + r.w <= topmost.x + topmost.w && r.y + r.h <= topmost.y + topmost.h;
      if (autoInk(label.ink) && topmost.pattern === undefined && covered) {
        label.ink = contrastInkPaint(topmost.fill);
      } else {
        // A cover that holds only part of the label, a hatched cover or an
        // authored ink: the label reads
        // on the page halo, and auto ink is decided against the page.
        label.halo = true;
        if (autoInk(label.ink)) {
          const background = theme.color.background;
          label.ink = { token: contrastRatio(theme.color.inkInverse, background) > contrastRatio(theme.color.ink, background) ? 'inkInverse' : 'ink' };
        }
      }
      marked++;
    }
  }
  return marked;
}

/**
 * At the scene, for every chart: a haloed label in auto ink that lies
 * wholly on a filled mark loses the halo and takes the contrast recipe for
 * that fill (ink or inkInverse, whichever reads, in each theme). The
 * page-colour halo on a dark bar is what draws hollow digits. Hatched hosts
 * keep the halo (the label crosses the hatch lines), as do outlined ones
 * (their fill is the page) and authored or semantic ink. Runs once per
 * layout in the registry, after every chart's own label pass, so no chart
 * can reintroduce the defect.
 */
export function labelsOnFills(geometry: Pick<Geometry, 'scene' | 'labels'> & Partial<Pick<Geometry, 'debug'>>): void {
  const rects = geometry.scene.filter((node): node is Extract<SceneNode, { t: 'rect' }> => node.t === 'rect' && String(node.id).startsWith('mark:'));
  if (rects.length === 0) return;
  const texts = new Map(geometry.scene.flatMap((node) => (node.t === 'text' ? [[node.id, node] as const] : [])));
  for (const label of geometry.labels) {
    if (label.hidden || !label.nodeId || label.backing) continue;
    const text = texts.get(label.nodeId);
    if (!text?.halo) continue;
    const { x, y, w, h } = label.rect;
    // a fill cannot replace the halo that separates text from a crossing reference rule.
    if (geometry.debug?.occupied.some(claim => claim.part === 'referenceLine'
      && x < claim.rect.x + claim.rect.w && x + w > claim.rect.x
      && y < claim.rect.y + claim.rect.h && y + h > claim.rect.y)) continue;
    let host: (typeof rects)[number] | undefined;
    for (const rect of rects) {
      const left = rect.rect.x + (rect.tx ?? 0);
      const top = rect.rect.y + (rect.ty ?? 0);
      if (x + w / 2 >= left && x + w / 2 <= left + rect.rect.w && y + h / 2 >= top && y + h / 2 <= top + rect.rect.h) {
        host = x >= left - 0.5 && x + w <= left + rect.rect.w + 0.5 && y >= top - 0.5 && y + h <= top + rect.rect.h + 0.5 ? rect : undefined;
      }
    }
    if (!host || host.pattern || !autoInk(text.ink)) continue;
    const ink = contrastInkPaint(host.fill);
    text.halo = false;
    text.ink = ink;
    label.halo = false;
    label.ink = ink;
  }
}

/**
 * The ink for emphasised text. `color.highlight` is a mark accent (a
 * latest-point ring, a prior-year tick) and fails body contrast on a light
 * page, so text never takes it. Emphasis is the theme's focus role where the
 * theme sets one that reads at 4.5:1 on the ground the text sits on (the
 * page unless a cell wash is named), otherwise the ink; the weight step
 * carries the rest.
 */
export function emphasisInk(theme: Theme, ground: Paint = { token: 'background' }): Paint {
  // The choice travels as a recipe (theme.ts decides it), so a repaint into
  // another theme or palette decides it again there.
  const recipe = { kind: 'emphasis-ink' as const, ground };
  return { token: paintColor(theme, { token: 'ink', theme: recipe }) === theme.color.ink ? 'ink' : 'focus', theme: recipe };
}

/** Scene parts that paint an area a line can cross. */
const FILL_PARTS = new Set(['segment', 'bar', 'area', 'fanBand', 'phaseFill', 'gapFill']);

/**
 * A line's page-colour casing separates it from the page and the
 * gridlines. Drawn over a fill it outlines the line in the page colour, a
 * double stroke on every dark bar. The casing moves under the first fill
 * that precedes it, so it still cuts the gridlines and the fills paint over
 * it; the line itself keeps its place on top. Scenes whose casings already
 * lie under every fill are returned unchanged. A casing flagged `overFills`
 * stays where it is: the Pareto curve must read over the columns it crosses.
 */
export function casingUnderFills(scene: SceneNode[]): SceneNode[] {
  const firstFill = scene.findIndex((node) => FILL_PARTS.has(node.part));
  if (firstFill < 0) return scene;
  const moved = scene.filter((node, index) => node.part === 'lineCasing' && !(node.t === 'path' && node.overFills) && index > firstFill);
  if (moved.length === 0) return scene;
  const rest = scene.filter((node) => !moved.includes(node));
  return [...rest.slice(0, firstFill), ...moved, ...rest.slice(firstFill)];
}

/**
 * A mark that recedes under a highlight (`color.rest`) on a theme that sets
 * `marks.restOutline: false`, and an Others mark (`color.othersMark`) on one
 * that sets `marks.othersOutline: false`, take no separation outline.
 */
export function markOutlineOff(fill: Paint, theme: Theme): boolean {
  const { marks } = theme;
  return 'token' in fill && (marks?.restOutline === false && fill.token === 'rest' || marks?.othersOutline === false && fill.token === 'othersMark');
}

/**
 * The Others family rule in one call: a mark painted `othersMark` takes the
 * separation outline when that fill is under the mark floor on the page, and
 * none under `marks.othersOutline: false`. Pie, column and bar run the same two
 * helpers inline; the waffle rest, funnel, butterfly and area Rest call this.
 */
export const isOthersFill = (fill: Paint): boolean => 'token' in fill && fill.token === 'othersMark';
export function othersSeparation(fill: Paint, theme: Theme): { stroke: Paint; strokeWidth: number } | undefined {
  if (!isOthersFill(fill) || markOutlineOff(fill, theme)) return undefined;
  return separationStroke(paintColor(theme, fill), theme.color.background, theme);
}

/**
 * A pie or doughnut slice on a theme that sets `marks.sliceOutline: false`
 * keeps its page-colour separator and takes no separation outline.
 */
export function sliceOutlineOff(part: string, theme: Theme): boolean {
  return theme.marks?.sliceOutline === false && part === 'slice';
}

/** Re-evaluate only a mark's stroke; geometry and authored paint remain unchanged. */
export function repaintSeparation(node: SceneNode, theme: Theme): SceneNode {
  if (node.t !== 'rect' && node.t !== 'path') return node;
  const rule = node.separation;
  if (!rule || rule.pattern) return node;
  const stroke = ruleStroke(rule, node.part, theme, rule.strict === true);
  const oldWidth = node.t === 'path' ? node.width : node.strokeWidth;
  if (JSON.stringify(node.stroke) === JSON.stringify(stroke?.stroke) && oldWidth === stroke?.strokeWidth) return node;
  const result = { ...node };
  delete result.stroke;
  if (result.t === 'path') delete result.width;
  else delete result.strokeWidth;
  if (stroke) {
    result.stroke = stroke.stroke;
    if (result.t === 'path') result.width = stroke.strokeWidth;
    else result.strokeWidth = stroke.strokeWidth;
  }
  return result;
}

/** Label kinds that print a mark's own value: a bar or point value, a stack segment, a pie slice. */
const VALUE_LABEL_KINDS = new Set(['point', 'segment', 'insidePie', 'outsidePie']);
/** A category total prints the value of the category's only mark (a Pareto bar, a one-segment stack). */
const TOTAL_LABEL_KINDS = new Set(['total', 'grandTotal']);

/**
 * A value label whose printed content has no number only names its mark (WCAG 1.4.11): pass
 * the content that prints. An authored text override prints the value only through its
 * `${value}` slot, which holds that content; "Pending" names the mark and nothing more.
 */
export function namesOnly(content: readonly string[] | null | undefined, override: unknown): { printsFor?: [] } {
  const bare = (typeof override === 'string' && !override.includes('${value}'))
    || (content != null && !content.some((part) => part === 'absolute' || part === 'percent'));
  return bare ? { printsFor: [] } : {};
}

const markKey = (owner: { seriesId?: string; categoryId?: string; segmentId?: string } | undefined) =>
  `${owner?.seriesId ?? ''}|${owner?.categoryId ?? ''}|${owner?.segmentId ?? ''}`;
type Separated = Extract<SceneNode, { t: 'rect' | 'path' }> & { separation: SeparationRule };
const separated = (node: SceneNode): node is Separated => (node.t === 'rect' || node.t === 'path') && node.separation !== undefined;
const KEY_PARTS = new Set(['swatch', 'labelSwatch']);

/**
 * WCAG 1.4.11. A light-page fill under 3:1 keeps its colour. It takes a 3:1
 * edge (ruleEdge) unless one of these holds:
 * - visible text carries its label and value: a drawn value label, or a note line that
 *   names it with its value (a counted "and 3 more" names nothing);
 * - its two neighbours in the same stack or pie reach 3:1 and leave both its boundaries
 *   visible after the seams (`bounds`).
 * The decision is per fill: when one mark of a fill needs the edge, every mark of that fill
 * and its key swatch take it, so the edge never singles out some marks of a series.
 * Run after the label solver. Grid panels arrive translated and already decided.
 */
export function fillEdges(geometry: Pick<Geometry, 'scene' | 'labels'> & { frame?: Pick<Geometry['frame'], 'footnoteNodeIds'> }, theme: Theme): void {
  const drawn = new Set(geometry.labels.filter((label) => !label.hidden).map((label) => label.id));
  // Only a note the frame drew is visible text; a note kept in frame.notes or a compact list is not.
  const footnoteIds = new Set(geometry.frame?.footnoteNodeIds ?? []);
  const squeeze = (text: string) => text.replace(/\s+/g, '');
  const footnotes = squeeze(geometry.scene.flatMap((node) => (node.t === 'text' && footnoteIds.has(node.id) ? [node.lines.join(' ')] : [])).join(' '));
  const inFootnote = (text: string | undefined) => text !== undefined && text !== '' && footnotes.includes(squeeze(text));
  const noteNames = (label: PlacedLabel) => label.noted === true && label.noteCounted !== true
    && ([...footnoteIds].some((id) => label.noteLocation?.includes(`(${id})`) === true) || inFootnote(label.noteText));
  const shows = (label: PlacedLabel) => !label.hidden || (label.printedIn !== undefined && drawn.has(label.printedIn)) || noteNames(label);
  const printed = new Set(geometry.labels.filter((label) => VALUE_LABEL_KINDS.has(label.kind) && shows(label))
    .flatMap((label) => (label.printsFor ?? [label.owner]).map(markKey)));
  const totals = new Set(geometry.labels.filter((label) => TOTAL_LABEL_KINDS.has(label.kind) && shows(label) && label.printsFor?.length !== 0
    && label.owner.seriesId === undefined && label.owner.categoryId !== undefined).map((label) => label.owner.categoryId!));
  const own = (node: SceneNode): node is Separated => separated(node) && node.tx === undefined && node.ty === undefined && !KEY_PARTS.has(node.part);
  const marksIn = new Map<string, number>();
  for (const node of geometry.scene) {
    const category = node.owner.categoryId;
    if (own(node) && category !== undefined) marksIn.set(category, (marksIn.get(category) ?? 0) + 1);
  }
  const segments = geometry.scene.filter((node): node is Extract<SceneNode, { t: 'rect' }> =>
    node.t === 'rect' && node.part === 'segment' && node.tx === undefined && node.ty === undefined);
  const rule = strokeToken(theme, 'rule');
  geometry.scene = geometry.scene.map((node) => {
    if (!own(node)) return node;
    const category = node.owner.categoryId;
    const isPrinted = node.separation.printed === true || printed.has(markKey(node.owner)) || inFootnote(node.separation.notedAs)
      || (category !== undefined && totals.has(category) && marksIn.get(category) === 1);
    const bounds = node.t === 'rect' && node.part === 'segment' ? stackBounds(node, segments, rule) : undefined;
    if (!isPrinted && !bounds) return node;
    return { ...node, separation: { ...node.separation, ...(isPrinted ? { printed: true as const } : {}), ...(bounds ? { bounds } : {}) } };
  });
  geometry.scene = decideFillEdges(geometry.scene, () => theme, false);
  // A segment no thicker than its two seams lies under them (withSegmentSeams). One that no
  // text carries is drawn above the seams, so its fill and any edge show. The order does not
  // depend on the theme, so a repaint draws the same scene.
  const isSeam = (node: SceneNode) => node.t === 'line' && node.part === 'segmentSeam';
  const lifted = geometry.scene.filter((node) => node.t === 'rect' && node.part === 'segment' && node.tx === undefined && node.ty === undefined
    && node.separation !== undefined && !node.separation.pattern && !node.separation.empty && !node.separation.printed
    && Math.min(node.rect.w, node.rect.h) <= 2 * rule);
  if (lifted.length > 0 && geometry.scene.some(isSeam)) {
    const rest = geometry.scene.filter((node) => !lifted.includes(node));
    const at = rest.length - [...rest].reverse().findIndex(isSeam);
    geometry.scene = [...rest.slice(0, at), ...lifted, ...rest.slice(at)];
  }
}

/**
 * A band annotation is the real ground of the marks it crosses. Keep the mark's visible
 * paints, once per pair; markLostOnBandWarnings judges them in the active theme.
 */
export function marksOnBands(scene: readonly SceneNode[]): MarkOnBand[] {
  type Rect = Extract<SceneNode, { t: 'rect' }>;
  const bands = scene.filter((node): node is Rect => node.t === 'rect' && node.part === 'band' && node.owner.annotationId !== undefined && node.fill !== undefined);
  if (bands.length === 0) return [];
  const crosses = (a: Rect['rect'], b: Rect['rect']) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const pairs = new Map<string, MarkOnBand>();
  for (const node of scene) {
    if (node.t !== 'rect' || !node.separation || node.tx !== undefined || node.ty !== undefined) continue;
    const name = node.owner.seriesId ?? node.owner.categoryId;
    if (name === undefined) continue;
    const { fill, stroke, strokeWidth, pattern, hatchGround, hatch, hatchEdge } = node;
    const paints = { fill, stroke, strokeWidth, pattern, hatchGround, hatch, hatchEdge };
    for (const band of bands) {
      const key = JSON.stringify([name, paints, band.fill]);
      if (!pairs.has(key) && crosses(band.rect, node.rect)) pairs.set(key, { name, owner: node.owner, ...paints, band: band.fill! });
    }
  }
  return [...pairs.values()];
}

/**
 * The fills on both sides of a stack segment, from the drawn rects: one neighbour flush at
 * each end along the stack, covering the segment's width. A segment no thicker than its two
 * seams has no visible boundary of its own and gets none.
 */
function stackBounds(node: Extract<SceneNode, { t: 'rect' }>, segments: readonly Extract<SceneNode, { t: 'rect' }>[], seam: number): Paint[] | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const { x, y, w, h } = node.rect;
  const covers = (from: number, to: number, oFrom: number, oTo: number) => oFrom <= from + 0.01 && oTo >= to - 0.01;
  const find = (test: (o: { x: number; y: number; w: number; h: number }) => boolean) => segments.find((o) => o !== node && test(o.rect));
  const vertical = [find((o) => near(o.y + o.h, y) && covers(x, x + w, o.x, o.x + o.w)), find((o) => near(o.y, y + h) && covers(x, x + w, o.x, o.x + o.w))];
  if (vertical[0] && vertical[1] && h > 2 * seam) return vertical.map((o) => o!.fill);
  const horizontal = [find((o) => near(o.x + o.w, x) && covers(y, y + h, o.y, o.y + o.h)), find((o) => near(o.x, x + w) && covers(y, y + h, o.y, o.y + o.h))];
  if (horizontal[0] && horizontal[1] && w > 2 * seam) return horizontal.map((o) => o!.fill);
  return undefined;
}

/**
 * The theme-dependent half of `fillEdges`: which fills take the edge under the
 * active theme. A repaint calls it again (repaintScene), so a theme change re-decides from
 * the stored `printed` and `bounds`, and a repaint under the same theme draws the same scene.
 */
export function decideFillEdges(scene: SceneNode[], themeOf: (node: SceneNode) => Theme, translated: boolean): SceneNode[] {
  const joins = (node: SceneNode): node is Separated => separated(node) && !node.separation.pattern && !node.separation.empty
    && (translated || (node.tx === undefined && node.ty === undefined));
  const groupOf = (node: Separated) => `${JSON.stringify(node.separation.fill)}|${node.tx ?? 0},${node.ty ?? 0}`;
  const needs = (node: Separated): boolean => {
    const rule = node.separation;
    const theme = themeOf(node);
    if (rule.printed) return false;
    const page = theme.color.background;
    if (rule.bounds?.every((paint) => contrastRatio(paintColor(theme, paint), page) >= MARK_CONTRAST_FLOOR)) return false;
    return JSON.stringify(ruleStroke(rule, node.part, theme, true)) !== JSON.stringify(ruleStroke(rule, node.part, theme, false));
  };
  const groups = new Map<string, boolean>();
  for (const node of scene) {
    if (!joins(node) || KEY_PARTS.has(node.part)) continue;
    const key = groupOf(node);
    if (groups.get(key) !== true) groups.set(key, needs(node));
  }
  return scene.map((node) => {
    if (!joins(node)) return node;
    const want = groups.get(groupOf(node)) === true;
    if ((node.separation.strict === true) === want) return node;
    const separation: SeparationRule = { ...node.separation };
    if (want) separation.strict = true;
    else delete separation.strict;
    return repaintSeparation({ ...node, separation }, themeOf(node));
  });
}

/**
 * Touching fills get a page-colour seam of `stroke.seam` (0.5 px, the half of a
 * 1 px line the next segment leaves visible), so each fill meets the page and
 * not its neighbour.
 * Navy tints cannot reach 3:1 against each other; the seam makes that moot.
 * One pass for every family that stacks `segment` rects edge to edge (stacked
 * column and bar, mekko, likert, bartable, funnel, waterfall). The seams go
 * right after the last segment, under connectors and labels. `oneBlock` names
 * pairs that are one block drawn as two rects (likert's split neutral). They
 * get no seam, and the one drawn first reaches 1 px under the other, so no
 * anti-aliased hairline of the page or of the rule behind shows at their edge.
 */
export function withSegmentSeams(
  nodes: SceneNode[], theme: Theme, oneBlock?: (a: OwnerRef, b: OwnerRef) => boolean,
): SceneNode[] {
  type RectNode = Extract<SceneNode, { t: 'rect' }>;
  const segments = nodes.filter((node): node is RectNode =>
    node.t === 'rect' && node.part === 'segment' && node.rect.w > 0 && node.rect.h > 0);
  const seams: SceneNode[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const seam = (a: RectNode, x1: number, y1: number, x2: number, y2: number) => seams.push({
    t: 'line', id: `seam:${a.id}:${seams.length}`, x1, y1, x2, y2,
    stroke: { token: 'background' }, width: strokeToken(theme, 'seam'), owner: a.owner, part: 'segmentSeam',
    ...(a.tx ? { tx: a.tx } : {}), ...(a.ty ? { ty: a.ty } : {}),
  });
  const order = new Map(nodes.map((node, index) => [node, index]));
  const underlaps = new Map<RectNode, RectNode>();
  // Without a oneBlock rule a pair seams only when a's top meets b's bottom or a's right edge
  // meets b's left edge (within `near`). Buckets of those edges give each a the few b that can
  // seam; they run in segment order, as the full scan visits them, so the seams and their ids
  // come out the same. A oneBlock rule can pair any two segments and keeps the full scan.
  // A non-finite or huge edge has no safe bucket: such a b joins every candidate list, such an a scans all.
  const bucket = (v: number) => Math.floor(v / 0.01);
  const bottoms = new Map<number, number[]>(), lefts = new Map<number, number[]>();
  const unbucketed: number[] = [];
  if (!oneBlock) segments.forEach((b, i) => {
    for (const [map, v] of [[bottoms, b.rect.y + b.rect.h], [lefts, b.rect.x]] as const) {
      const key = bucket(v);
      if (!Number.isSafeInteger(key)) { unbucketed.push(i); continue; }
      const list = map.get(key);
      if (list) list.push(i); else map.set(key, [i]);
    }
  });
  const partners = (a: RectNode): Iterable<RectNode> => {
    if (oneBlock) return segments;
    const found = new Set<number>(unbucketed);
    // |p - q| < 0.01 puts the buckets at most one apart; two covers rounding in the division.
    for (const [map, v] of [[bottoms, a.rect.y], [lefts, a.rect.x + a.rect.w]] as const) {
      const key = bucket(v);
      if (!Number.isSafeInteger(key - 2) || !Number.isSafeInteger(key + 2)) return segments;
      for (let k = key - 2; k <= key + 2; k++) for (const i of map.get(k) ?? []) found.add(i);
    }
    return [...found].sort((p, q) => p - q).map((i) => segments[i]!);
  };
  for (const a of segments) for (const b of partners(a)) {
    if (a === b || (a.tx ?? 0) !== (b.tx ?? 0) || (a.ty ?? 0) !== (b.ty ?? 0)) continue;
    if (oneBlock?.(a.owner, b.owner)) {
      // The block reads as one: no light line runs
      // through the number centred across the edge.
      const [first, second] = order.get(a)! < order.get(b)! ? [a, b] : [b, a];
      if (near(first.rect.x + first.rect.w, second.rect.x)) underlaps.set(first, { ...first, rect: { ...first.rect, w: first.rect.w + Math.min(1, second.rect.w) } });
      else if (near(second.rect.x + second.rect.w, first.rect.x)) underlaps.set(first, { ...first, rect: { ...first.rect, x: first.rect.x - Math.min(1, second.rect.w), w: first.rect.w + Math.min(1, second.rect.w) } });
      continue;
    }
    const { x, y, w, h } = a.rect;
    const o = b.rect;
    if (near(y, o.y + o.h)) {
      const from = Math.max(x, o.x), to = Math.min(x + w, o.x + o.w);
      if (to - from > 0.01) seam(a, from, y, to, y);
    }
    if (near(x + w, o.x)) {
      const from = Math.max(y, o.y), to = Math.min(y + h, o.y + o.h);
      if (to - from > 0.01) seam(a, x + w, from, x + w, to);
    }
  }
  const drawn = underlaps.size ? nodes.map((node) => underlaps.get(node as RectNode) ?? node) : nodes;
  if (seams.length === 0) return drawn;
  const last = nodes.lastIndexOf(segments.at(-1)!);
  return [...drawn.slice(0, last + 1), ...seams, ...drawn.slice(last + 1)];
}

/** The drawing parts of an annotation that only mean something next to their label. */
const ANNOTATION_DRAWING_PARTS = new Set(['arm', 'arrowHead', 'bracket', 'diffArrow', 'leader', 'indicator100']);

/**
 * An annotation whose every label the solver hid draws no arrow, bracket or
 * leader either: a bare arrow says nothing, and the hidden-label note names
 * the annotation. Value lines stay (a reference is never dropped).
 */
export function withoutOrphanAnnotationMarks(geometry: Pick<Geometry, 'scene' | 'labels'>): void {
  const shown = new Set<string>();
  const hidden = new Set<string>();
  for (const label of geometry.labels) {
    const id = label.owner.annotationId;
    if (id === undefined) continue;
    (label.hidden ? hidden : shown).add(id);
  }
  const orphans = [...hidden].filter((id) => !shown.has(id));
  if (orphans.length === 0) return;
  const drop = new Set(orphans);
  geometry.scene = geometry.scene.filter((node) => !(node.owner.annotationId !== undefined
    && drop.has(node.owner.annotationId) && ANNOTATION_DRAWING_PARTS.has(node.part)));
}

/** Air between a reference line and any label box it would otherwise run through. */
export const REFERENCE_LABEL_CLEARANCE = 3;
/** A line this close to a glyph box counts as touching the text and breaks around it. */
const TEXT_TOUCH_PX = 1;

/**
 * For every chart, a straight value line (an average, a
 * target, a plan value) never runs through text and stays readable over the
 * fills it crosses.
 *
 * - The line breaks where it runs within 1 px of a reference tick's casing,
 *   so the tick reads on its own. A line with a break is drawn as one path of
 *   several runs, under the same id.
 * - Every line that is not data breaks around the glyphs of any text it comes
 *   within 1 px of, with REFERENCE_LABEL_CLEARANCE px of air (`linesBehindText`);
 *   a label box it only grazes does not break it. It turns light where it runs
 *   over a dark fill drawn before it (`linesOverFills`). A line drawn before
 *   the marks lies behind them and needs neither.
 */
export function referenceLineClearance(geometry: Pick<Geometry, 'scene' | 'labels'>): void {
  const scene = geometry.scene;
  // A reference tick the line runs over keeps its page-colour casing clear of it.
  const boxes = scene.flatMap((node) => (node.t === 'rect' && node.part === 'referenceCasing' && node.tx === undefined && node.ty === undefined ? [node.rect] : []));
  const out: SceneNode[] = [];
  scene.forEach((node) => {
    // Value lines span the plot (an average, a target, a plan value).
    if (node.t !== 'line' || node.part !== 'valueLine' || node.tx !== undefined || node.ty !== undefined) {
      out.push(node);
      return;
    }
    const horizontal = Math.abs(node.y1 - node.y2) < 1e-6;
    if (!horizontal && Math.abs(node.x1 - node.x2) >= 1e-6) {
      out.push(node);
      return;
    }
    // Along-axis coordinates: x for a horizontal line, y for a vertical one.
    const at = horizontal ? node.y1 : node.x1;
    const [from, to] = horizontal ? [Math.min(node.x1, node.x2), Math.max(node.x1, node.x2)] : [Math.min(node.y1, node.y2), Math.max(node.y1, node.y2)];
    const half = node.width / 2;
    const pad = 1;
    const cuts: [number, number][] = [];
    for (const r of boxes) {
      const [across0, across1, along0, along1] = horizontal ? [r.y, r.y + r.h, r.x, r.x + r.w] : [r.x, r.x + r.w, r.y, r.y + r.h];
      if (across0 - pad >= at + half || across1 + pad <= at - half) continue;
      if (along1 + pad <= from || along0 - pad >= to) continue;
      cuts.push([along0 - pad, along1 + pad]);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    let start = from;
    for (const [c0, c1] of cuts) {
      if (c0 > start) runs.push([start, Math.min(c0, to)]);
      start = Math.max(start, c1);
    }
    if (start < to) runs.push([start, to]);
    const drawn = runs.filter(([a, b]) => b - a >= 1);
    const point = (along: number) => (horizontal ? `${fmt(along)} ${fmt(at)}` : `${fmt(at)} ${fmt(along)}`);
    // A line that would lose every run keeps its whole stroke: a reference is never dropped.
    if (cuts.length === 0 || drawn.length === 0) {
      out.push(node);
      return;
    }
    const { x1: _x1, y1: _y1, x2: _x2, y2: _y2, t: _t, ...rest } = node;
    out.push({ ...rest, t: 'path', d: drawn.map(([a, b]) => `M${point(a)}L${point(b)}`).join('') });
  });
  // A grid's panels arrive translated, banded by their own layout and theme: leave them as they are.
  // A grid's panels arrive translated, split by their own layout: leave them as they are.
  geometry.scene = linesOverFills(linesBehindText(out), (node) => node.tx === undefined && node.ty === undefined);
}

/**
 * Lines that are data marks keep their whole stroke: series lines and their
 * casings, area edges, slopes, sparks and ridges, hatch stripes, highlight
 * rings, the seams between bar segments, whiskers, stems, rails and caps,
 * targets, ties, and the key swatches beside their names. Every other line
 * part (references, targets lines, annotation rules, brackets, connectors,
 * leaders, gridlines, axis rules, and any part added later) breaks around text.
 */
const DATA_MARK_LINE_PARTS = new Set([
  'line', 'lineCasing', 'areaSeparator', 'slope', 'spark', 'ridge', 'track', 'forecastHatch', 'noDataHatch', 'highlightRing', 'segmentSeam',
  'boxMedian', 'boxWhisker', 'boxWhiskerCap', 'stem', 'rail', 'rangeRail', 'rangeCap', 'target', 'tie', 'metric',
  'kpiAttainmentTick', 'tick', 'treemapGroup', 'waffleGroupRule', 'waffleSubtotal', 'rowTint',
  'swatch', 'legendKey', 'legendTick', 'axisTitleSwatch', 'sizeKeyTick', 'diagramIcon',
]);
const behindText = (node: SceneNode): node is Extract<SceneNode, { t: 'line' | 'path' }> =>
  (node.t === 'line' || (node.t === 'path' && node.stroke !== undefined && node.fill === undefined)) && !DATA_MARK_LINE_PARTS.has(node.part);

/** Text drawn in the frame (title, subtitle, notes, source): no plot line reaches it. */
const FRAME_TEXT_PARTS = new Set(['title', 'subtitle', 'source', 'footnote', 'note', 'footer', 'credit']);
/** Where the glyphs of a text line sit in its line box, as a share of the font size (TEXT_ASCENT 0.88 less the ascender 0.74; plus the descender 0.21). */
const GLYPH_TOP = 0.14;
const GLYPH_BOTTOM = 1.09;
/** renderSvg's TEXT_ASCENT: the baseline sits this share of the font size below the top of the line box. */
const TEXT_ASCENT = 0.88;

interface GlyphBox { x0: number; y0: number; x1: number; y1: number; ax: number; ay: number; cos: number; sin: number }

/**
 * Whether one unrotated line of text, its line box at `top` and its glyphs from x0 to x1,
 * comes within 1 px of a line that breaks around text (linesBehindText). A seat that would
 * cut such a line (the zero line beside a thin segment) is no seat.
 */
export function textBreaksLine(scene: readonly SceneNode[], x0: number, x1: number, top: number, size: number): boolean {
  const box: GlyphBox = { x0, x1, y0: top + size * GLYPH_TOP, y1: top + size * GLYPH_BOTTOM, ax: x0, ay: top, cos: 1, sin: 0 };
  return scene.some((node) => {
    if (!behindText(node)) return false;
    const half = (node.t === 'line' ? node.width : node.width ?? 1) / 2;
    const dx = node.tx ?? 0;
    const dy = node.ty ?? 0;
    return (straightSegments(node) ?? []).some(([x1, y1, x2, y2]) =>
      segmentInBox([x1 + dx, y1 + dy], [x2 + dx, y2 + dy], box, half + TEXT_TOUCH_PX) !== undefined);
  });
}

/** The glyph box of each drawn line of text, in page coordinates; a rotated label keeps its rotation about the baseline anchor. */
function glyphBoxes(scene: readonly SceneNode[], near: (y0: number, y1: number) => boolean): GlyphBox[] {
  const boxes: GlyphBox[] = [];
  for (const node of scene) {
    if (node.t !== 'text' || node.backing || FRAME_TEXT_PARTS.has(node.part)) continue;
    const font = node.font;
    const lineH = font.size * (font.lineHeight ?? 1.2);
    const dx = node.tx ?? 0;
    const dy = node.ty ?? 0;
    const angle = ((node.rotate ?? 0) * Math.PI) / 180;
    node.lines.forEach((text, index) => {
      if (!text.trim()) return;
      const top = node.y + index * lineH;
      // Measure only text that some line can reach: most charts draw no line through most of their labels.
      if (angle === 0 && !near(top + font.size * GLYPH_TOP + dy, top + font.size * GLYPH_BOTTOM + dy)) return;
      const width = measureText(text, font).width + (font.letterSpacing ?? 0) * Math.max(0, [...text].length - 1);
      const x0 = node.align === 'start' ? node.x : node.align === 'end' ? node.x - width : node.x - width / 2;
      boxes.push({ x0: x0 + dx, x1: x0 + width + dx, y0: top + font.size * GLYPH_TOP + dy, y1: top + font.size * GLYPH_BOTTOM + dy,
        ax: node.x + dx, ay: node.y + font.size * TEXT_ASCENT + dy, cos: Math.cos(-angle), sin: Math.sin(-angle) });
    });
  }
  return boxes;
}

/** The part [t0, t1] of segment a→b that runs inside the box grown by `grow`, or undefined (Liang–Barsky). */
function segmentInBox(a: [number, number], b: [number, number], box: GlyphBox, grow: number): [number, number] | undefined {
  const into = ([x, y]: [number, number]): [number, number] => box.sin === 0 ? [x, y]
    : [box.ax + (x - box.ax) * box.cos - (y - box.ay) * box.sin, box.ay + (x - box.ax) * box.sin + (y - box.ay) * box.cos];
  const [x0, y0] = into(a);
  const [x1, y1] = into(b);
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, x0 - (box.x0 - grow)], [dx, box.x1 + grow - x0], [-dy, y0 - (box.y0 - grow)], [dy, box.y1 + grow - y0]] as const) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0) { if (r > t1) return undefined; t0 = Math.max(t0, r); }
    else { if (r < t0) return undefined; t1 = Math.min(t1, r); }
  }
  return t1 - t0 > 1e-6 ? [t0, t1] : undefined;
}

/** The straight segments of a line node or of an absolute `M`/`L`/`H`/`V` path; undefined for any other path (curves keep their stroke). */
function straightSegments(node: SceneNode): [number, number, number, number][] | undefined {
  if (node.t === 'line') return [[node.x1, node.y1, node.x2, node.y2]];
  if (node.t !== 'path' || !/^(?:\s*(?:[ML]\s*-?[\d.]+[ ,]\s*-?[\d.]+|[HV]\s*-?[\d.]+))+\s*$/.test(node.d)) return undefined;
  const segments: [number, number, number, number][] = [];
  let x = 0;
  let y = 0;
  for (const m of node.d.matchAll(/([MLHV])\s*(-?[\d.]+)(?:[ ,]\s*(-?[\d.]+))?/g)) {
    const cmd = m[1];
    const a = Number(m[2]);
    const [nx, ny] = cmd === 'H' ? [a, y] : cmd === 'V' ? [x, a] : [a, Number(m[3])];
    if (cmd !== 'M') segments.push([x, y, nx, ny]);
    x = nx;
    y = ny;
  }
  return segments;
}

/**
 * For every chart, text is always in front of a line, like
 * PowerPoint's "send backward". Where a line that is not data runs through
 * the glyphs of a drawn label, name or value, the line breaks around that
 * text with REFERENCE_LABEL_CLEARANCE px of air. The break is geometry, not
 * paint: it is exact in SVG, survives importers that ignore paint-order
 * and needs no repaint in another theme. The page-colour halo is too
 * thin for this (the line still shows between the letters). A line that
 * crosses no text keeps its node unchanged.
 */
function linesBehindText(scene: SceneNode[]): SceneNode[] {
  const reach: [number, number][] = [];
  for (const node of scene) {
    if (!behindText(node)) continue;
    const half = (node.t === 'line' ? node.width : node.width ?? 1) / 2;
    for (const [, y1, , y2] of straightSegments(node) ?? []) reach.push([Math.min(y1, y2) + (node.ty ?? 0) - half - TEXT_TOUCH_PX, Math.max(y1, y2) + (node.ty ?? 0) + half + TEXT_TOUCH_PX]);
  }
  if (reach.length === 0) return scene;
  const boxes = glyphBoxes(scene, (y0, y1) => reach.some(([a, b]) => a <= y1 && b >= y0));
  if (boxes.length === 0) return scene;
  return scene.map((node) => {
    if (!behindText(node)) return node;
    const segments = straightSegments(node);
    if (!segments) return node;
    const half = (node.t === 'line' ? node.width : node.width ?? 1) / 2;
    const dx = node.tx ?? 0;
    const dy = node.ty ?? 0;
    let crossed = false;
    const runs = segments.flatMap(([x1, y1, x2, y2]) => {
      const a: [number, number] = [x1 + dx, y1 + dy];
      const b: [number, number] = [x2 + dx, y2 + dy];
      const cuts: [number, number][] = [];
      for (const box of boxes) {
        // A line through the glyphs or within 1 px of them breaks (a line never touches text);
        // one that passes further away stays whole.
        if (!segmentInBox(a, b, box, half + TEXT_TOUCH_PX)) continue;
        const cut = segmentInBox(a, b, box, half + REFERENCE_LABEL_CLEARANCE);
        if (cut) cuts.push(cut);
      }
      if (cuts.length === 0) return [[x1, y1, x2, y2]];
      crossed = true;
      cuts.sort((p, q) => p[0] - q[0]);
      const length = Math.hypot(x2 - x1, y2 - y1);
      const kept: [number, number][] = [];
      let start = 0;
      for (const [c0, c1] of cuts) {
        if (c0 > start) kept.push([start, c0]);
        start = Math.max(start, c1);
      }
      if (start < 1) kept.push([start, 1]);
      return kept.filter(([t0, t1]) => (t1 - t0) * length >= 1)
        .map(([t0, t1]) => [x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1]);
    });
    // A line that would lose every run keeps its whole stroke: a reference is never dropped.
    if (!crossed || runs.length === 0) return node;
    const d = runs.map(([x1, y1, x2, y2]) => `M${fmt(x1!)} ${fmt(y1!)}L${fmt(x2!)} ${fmt(y2!)}`).join('');
    if (node.t === 'path') return { ...node, d };
    const { x1: _x1, y1: _y1, x2: _x2, y2: _y2, t: _t, width, ...rest } = node;
    return { ...rest, t: 'path', width, d };
  });
}

/**
 * A value line over a dark fill takes no page-colour band
 * (`referenceCasing`): the line itself turns light over a
 * dark fill (`linesOverFills`, at layout). This drops bands that a scene made
 * earlier still carries; a repaint needs nothing else, because the ink of
 * each piece is a recipe the new theme decides again.
 */
export function referenceCasings(
  scene: readonly SceneNode[], own: (node: SceneNode) => boolean = () => true,
): SceneNode[] {
  // Only the bands of value lines go; reference ticks bring casings of their own.
  const lines = new Set(scene.filter((node) => node.part === 'valueLine').map((node) => node.id));
  return scene.filter((node) => node.part !== 'referenceCasing' || !own(node) || !lines.has(node.id.replace(/:casing:\d+$/, '')));
}

/** A fill a line drawn after it can cross: a plain (unhatched, unoutlined) mark rectangle. */
function crossableFill(node: SceneNode): node is Extract<SceneNode, { t: 'rect' }> {
  return node.t === 'rect' && String(node.id).startsWith('mark:') && node.fill !== undefined && node.pattern === undefined;
}

/**
 * For every chart, a line that is not data and is drawn
 * over a filled mark is split at the fill edges. Over the page it keeps its
 * ink; over each fill it takes the `line-on-fill` recipe, which keeps the
 * line's ink where that reads at least as well as the inverse ink and turns
 * the line light over a dark fill (white in a light theme). No casing, no
 * halo. A dashed line is written as its dashes, one solid subpath each,
 * measured from the line's start, so the dash pattern runs on unbroken
 * across the fill edges (an importer that drops stroke-dashoffset
 * still draws the same dashes). Only straight lines split; a line that crosses no
 * fill keeps its node.
 */
/**
 * Lines over fills that keep their paint: gridlines are furniture, a bar
 * break cuts its bar in the page colour on purpose, and a reference series'
 * ticks and dashes carry their own page-colour casing (band/ticks.ts).
 */
const KEEP_INK_OVER_FILLS = new Set(['grid', 'gridline', 'barBreak', 'referenceTick', 'referenceLine']);

function linesOverFills(scene: SceneNode[], own: (node: SceneNode) => boolean): SceneNode[] {
  if (!scene.some(crossableFill)) return scene;
  const out: SceneNode[] = [];
  scene.forEach((node, index) => {
    out.push(node);
    if (!own(node) || !behindText(node) || KEEP_INK_OVER_FILLS.has(node.part) || node.stroke === undefined || ('token' in node.stroke && node.stroke.theme?.kind === 'line-on-fill')) return;
    const segments = straightSegments(node);
    if (!segments || segments.length === 0) return;
    const [ox, oy, ex, ey] = segments[0]!;
    const length = Math.hypot(ex - ox, ey - oy);
    if (length < 1e-6) return;
    const dx = (ex - ox) / length;
    const dy = (ey - oy) / length;
    // Every subpath on the one straight line: its run along that line from the first point.
    const along = (x: number, y: number) => (x - ox) * dx + (y - oy) * dy;
    const off = (x: number, y: number) => Math.abs((x - ox) * dy - (y - oy) * dx);
    if (segments.some(([x1, y1, x2, y2]) => off(x1, y1) > 0.01 || off(x2, y2) > 0.01)) return;
    const runs = segments.map(([x1, y1, x2, y2]) => [Math.min(along(x1, y1), along(x2, y2)), Math.max(along(x1, y1), along(x2, y2))] as [number, number]);
    const covers: { lo: number; hi: number; index: number }[] = [];
    const lineWidth = node.t === 'line' ? node.width : node.width ?? 1;
    scene.slice(0, index).forEach((fill, fillIndex) => {
      if (!crossableFill(fill) || fill.tx !== node.tx || fill.ty !== node.ty) return;
      // A fill no thicker across the line than three line widths (a bar of a
      // value too small to see, on the baseline) shows no fill on both sides
      // of a light line: the line keeps its ink over it, so it never turns
      // the page colour where nothing dark is left to read it against.
      if (fill.rect.w * Math.abs(dy) + fill.rect.h * Math.abs(dx) <= 3 * lineWidth) return;
      const box: GlyphBox = { x0: fill.rect.x, y0: fill.rect.y, x1: fill.rect.x + fill.rect.w, y1: fill.rect.y + fill.rect.h, ax: 0, ay: 0, cos: 1, sin: 0 };
      // A line along a fill's edge is not over it.
      const inner: GlyphBox = { ...box, x0: box.x0 + 0.01, y0: box.y0 + 0.01, x1: box.x1 - 0.01, y1: box.y1 - 0.01 };
      const far = runs.reduce((m, [, b]) => Math.max(m, b), 0);
      const hit = segmentInBox([ox, oy], [ox + dx * far, oy + dy * far], inner, 0);
      if (hit && (hit[1] - hit[0]) * far >= 0.5) covers.push({ lo: hit[0] * far, hi: hit[1] * far, index: fillIndex });
    });
    if (covers.length === 0) return;
    // Pieces of each run, each under the topmost fill that covers it (or the page).
    const pieces: { a: number; b: number; fill?: number }[] = [];
    for (const [a, b] of runs) {
      const cuts = [...new Set([a, b, ...covers.flatMap(({ lo, hi }) => [lo, hi]).filter((v) => v > a && v < b)])].sort((p, q) => p - q);
      for (let i = 1; i < cuts.length; i++) {
        const mid = (cuts[i - 1]! + cuts[i]!) / 2;
        const top = covers.filter(({ lo, hi }) => lo <= mid && hi >= mid).reduce<number | undefined>((m, { index: f }) => (m === undefined || f > m ? f : m), undefined);
        const last = pieces[pieces.length - 1];
        if (last && Math.abs(last.b - cuts[i - 1]!) < 1e-9 && last.fill === top) last.b = cuts[i]!;
        else pieces.push({ a: cuts[i - 1]!, b: cuts[i]!, ...(top === undefined ? {} : { fill: top }) });
      }
    }
    if (!pieces.some((piece) => piece.fill !== undefined)) return;
    const dash = node.dash && node.dash.length > 0 && node.dash.some((v) => v > 0) ? (node.dash.length % 2 ? [...node.dash, ...node.dash] : node.dash) : undefined;
    const period = dash ? dash.reduce((m, v) => m + v, 0) : 0;
    // The drawn stretches of [a, b]: the whole of it, or its dashes counted from the line's start.
    const strokes = (a: number, b: number): [number, number][] => {
      if (!dash) return b - a > 0.05 ? [[a, b]] : [];
      const result: [number, number][] = [];
      for (let start = Math.floor(a / period) * period; start < b; start += period) {
        let at = start;
        for (let i = 0; i < dash.length; i += 2) {
          const lo = Math.max(a, at);
          const hi = Math.min(b, at + dash[i]!);
          if (hi - lo > 0.05) result.push([lo, hi]);
          at += dash[i]! + dash[i + 1]!;
        }
      }
      return result;
    };
    const point = (v: number) => `${fmt(ox + dx * v)} ${fmt(oy + dy * v)}`;
    const pathOf = (stretches: [number, number][]) => stretches.map(([a, b]) => `M${point(a)}L${point(b)}`).join('');
    const groups = new Map<number | undefined, [number, number][]>();
    for (const piece of pieces) groups.set(piece.fill, [...(groups.get(piece.fill) ?? []), ...strokes(piece.a, piece.b)]);
    const width = node.t === 'line' ? node.width : node.width ?? 1;
    // Each written dash is no longer than the pattern's first dash, so the kept dash array draws it whole;
    // readers that match a key's dash against the drawn line still find it.
    const { x1: _x1, y1: _y1, x2: _x2, y2: _y2, d: _d, t: _t, ...rest } = node as typeof node & { x1?: number; y1?: number; x2?: number; y2?: number; d?: string };
    const { dash: _dash, ...undashed } = rest;
    const keepDash = dash !== undefined && dash.every((value, i) => i % 2 === 1 || value <= dash[0]!);
    const base = { ...(keepDash ? rest : undashed), width, ...(dash ? { lineCap: node.lineCap ?? 'butt' as const } : {}) };
    out.pop();
    const page = groups.get(undefined) ?? [];
    // The node keeps its id where the page shows it; a line wholly over fills keeps it on its first piece.
    let n = 0;
    if (page.length > 0) out.push({ ...base, t: 'path', d: pathOf(page) } as SceneNode);
    for (const [fill, stretches] of groups) {
      if (fill === undefined || stretches.length === 0) continue;
      const fillPaint = (scene[fill] as Extract<SceneNode, { t: 'rect' }>).fill;
      const stroke: Paint = { token: 'token' in node.stroke ? node.stroke.token : 'ink', theme: { kind: 'line-on-fill', base: node.stroke, fill: fillPaint } };
      const id = page.length === 0 && n === 0 ? node.id : `${node.id}:over:${n}`;
      n++;
      out.push({ ...base, id, t: 'path', d: pathOf(stretches), stroke } as SceneNode);
    }
  });
  return out;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}
