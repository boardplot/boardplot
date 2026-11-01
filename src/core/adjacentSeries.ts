import { parseColor } from './color';
import { effectiveFill, paintColor } from './theme';
import { PALETTE_CVD_FLOOR, PALETTE_NORMAL_FLOOR, PALETTE_TRITAN_FLOOR, palettePerceptualDistance } from './themeRules';
import type { Id } from './types/cell';
import type { AdjacentSeriesPaintSample, LintWarning, Paint, PaintWarningRule, SceneNode } from './types/scene';
import type { Theme } from './types/theme';

export interface SeriesColorSample {
  seriesId: Id;
  categoryId: Id;
  from: number;
  to: number;
  css: string;
  highlighted: boolean;
  /** The paint behind `css`; an ordered-ramp paint is held to the step floor. */
  paint?: Paint;
}

/**
 * Neighbouring rungs of an ordered ramp differ by order, not by hue:
 * they are held to a visible step (3 OKLab, about 1.5 JND, as the ramp sweep),
 * not to the categorical palette floors. A theme's stack ramp is one too; a
 * theme without one paints its stack from the categorical series colours.
 */
const ORDERED_STEP_FLOOR = 3;

const orderedRung = (sample: SeriesColorSample, theme: Theme): boolean => {
  const kind = sample.paint !== undefined && 'theme' in sample.paint ? sample.paint.theme?.kind : undefined;
  return kind === 'ordered-ramp' || kind === 'group-ramp' || (kind === 'stack-ramp' && (theme.color.stack?.length ?? 0) >= 2);
};

/** A likert step is a wash kept `apart` from its side's extreme; the extreme is its base. */
const sideOf = (paint: Paint | undefined): Paint | undefined =>
  paint && 'theme' in paint && paint.theme?.kind === 'visible-tint' && paint.theme.apart !== undefined ? paint.theme.base : paint;

/** Two options on one side of a likert scale: steps of one ramp, held to the step floor. */
const sameSide = (first: SeriesColorSample, second: SeriesColorSample): boolean => {
  const a = sideOf(first.paint);
  const b = sideOf(second.paint);
  return a !== undefined && (a !== first.paint || b !== second.paint) && JSON.stringify(a) === JSON.stringify(b);
};

/** Later marks cover earlier marks; split only the spans that remain visible. */
function visibleStackSpans(samples: readonly SeriesColorSample[]): SeriesColorSample[] {
  let visible: SeriesColorSample[] = [];
  for (const sample of samples) {
    const remaining: SeriesColorSample[] = [];
    for (const earlier of visible) {
      if (earlier.to <= sample.from || earlier.from >= sample.to) remaining.push(earlier);
      else {
        if (earlier.from < sample.from) remaining.push({ ...earlier, to: sample.from });
        if (earlier.to > sample.to) remaining.push({ ...earlier, from: sample.to });
      }
    }
    visible = [...remaining, sample];
  }
  return visible;
}

/**
 * The series a mark draws. A likert chart splits its neutral option across the
 * axis into 'likert:<id>:neg' and 'likert:<id>:pos': two halves of one
 * response, in one colour, which the lint read as two neighbours that match.
 */
function drawnSeries(id: Id): Id {
  return id.replace(/^(likert:.+):(?:neg|pos)$/, '$1');
}

/** Compare neighbours in their displayed order, using the named-palette floors. */
export function adjacentSeriesWarnings(samples: readonly SeriesColorSample[], stacked: boolean, theme: Theme): LintWarning[] {
  const groups = new Map<Id, SeriesColorSample[]>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.from) || !Number.isFinite(sample.to) || !parseColor(sample.css)) continue;
    if (stacked && sample.from === sample.to) continue;
    const group = groups.get(sample.categoryId) ?? [];
    group.push({ ...sample, from: Math.min(sample.from, sample.to), to: Math.max(sample.from, sample.to) });
    groups.set(sample.categoryId, group);
  }
  const pairs = new Map<string, { first: SeriesColorSample; second: SeriesColorSample; categories: Set<Id>; distances: ColorDistances }>();
  for (const group of groups.values()) {
    const displayed = stacked ? visibleStackSpans(group) : group;
    displayed.sort((a, b) => a.from - b.from || a.to - b.to);
    for (let index = 1; index < displayed.length; index++) {
      const first = displayed[index - 1]!;
      const second = displayed[index]!;
      if (drawnSeries(first.seriesId) === drawnSeries(second.seriesId)) continue;
      if (stacked ? second.from > first.to + 1e-6 : !first.highlighted && !second.highlighted) continue;
      const pair = [first, second].sort((a, b) => a.seriesId < b.seriesId ? -1 : 1);
      const key = JSON.stringify(pair.map((sample) => [sample.seriesId, sample.css]));
      const found = pairs.get(key);
      if (found) { found.categories.add(first.categoryId); continue; }
      const distances = similarPairDistances(first, second, theme);
      if (distances) pairs.set(key, { first, second, categories: new Set([first.categoryId]), distances });
    }
  }
  if (pairs.size === 0) return [];
  const affected = [...pairs.values()];
  const categories = [...new Set(affected.flatMap((pair) => [...pair.categories]))];
  const first = affected[0]!.first;
  return [{
    code: 'series-adjacent-similar', severity: 'warn',
    message: `Adjacent series colours fall below a palette distance floor in ${pairs.size} pair${pairs.size === 1 ? '' : 's'} across ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}: ${affected.map(({ first, second }) => `'${first.seriesId}' / '${second.seriesId}'`).join(', ')}.`,
    owner: { seriesId: first.seriesId, categoryId: first.categoryId },
    detail: { categories, pairs: affected.map(({ first, second, categories, distances }) => ({
      seriesIds: [first.seriesId, second.seriesId], colors: [first.css, second.css], categories: [...categories], ...distances,
    })) },
    suggest: 'Choose more distinct authored colours or a palette whose adjacent ranks clear the distance floors.',
  }];
}

interface ColorDistances { normal: number; protan: number; deutan: number; tritan: number }

function similarPairDistances(first: SeriesColorSample, second: SeriesColorSample, theme: Theme): ColorDistances | undefined {
  const normal = palettePerceptualDistance(first.css, second.css, 'normal');
  if (((orderedRung(first, theme) && orderedRung(second, theme)) || sameSide(first, second)) && normal >= ORDERED_STEP_FLOOR) return undefined;
  const distances = {
    normal,
    protan: palettePerceptualDistance(first.css, second.css, 'protan'),
    deutan: palettePerceptualDistance(first.css, second.css, 'deutan'),
    tritan: palettePerceptualDistance(first.css, second.css, 'tritan'),
  };
  if (distances.normal >= PALETTE_NORMAL_FLOOR && distances.protan >= PALETTE_CVD_FLOOR &&
      distances.deutan >= PALETTE_CVD_FLOOR && distances.tritan >= PALETTE_TRITAN_FLOOR) return undefined;
  return distances;
}

/**
 * The colour that tells a segment from its neighbour. A hatch in the segment's
 * own colour is read by its stripes, which carry the series colour at mark
 * strength; the averaged wash of two hatched neighbours is near the page for
 * every series and says nothing about which is which. An ink hatch has one
 * stripe colour for all, so its wash is what differs.
 */
function identityColour(css: string, pattern: 'hatch45' | undefined, byStripe: boolean, theme: Theme): string {
  return byStripe && pattern === 'hatch45' && theme.pattern.hatchColor !== 'ink' ? css : effectiveFill(css, pattern, theme);
}

export function resolveAdjacentSeriesWarningRule(
  rule: Extract<PaintWarningRule, { kind: 'series-adjacent-similar' }>, theme: Theme,
): LintWarning[] {
  return adjacentSeriesWarnings(rule.samples.map(({ paint, pattern, byStripe, ...sample }) => ({
    ...sample, paint, css: identityColour(paintColor(theme, paint), pattern, byStripe === true, theme),
  })), rule.stacked, theme);
}

export interface AdjacentWarningCapture {
  rules: PaintWarningRule[];
  before: number;
}

export function retainAdjacentWarningRule(
  samples: readonly (SeriesColorSample & AdjacentSeriesPaintSample)[], stacked: boolean,
  capture?: AdjacentWarningCapture,
): void {
  if (capture && samples.length > 0) capture.rules.push({
    kind: 'series-adjacent-similar', stacked, before: capture.before,
    samples: samples.map(({ css: _css, ...sample }) => sample),
  });
}

/** Scene marks exclude legends, reference ticks and zero-height stack members. With `resolve` false, only `capture` keeps the rule. */
export function rectSeriesAdjacentWarnings(
  nodes: readonly SceneNode[], paintCss: (paint: Paint) => string,
  orientation: 'vertical' | 'horizontal', highlights: ReadonlySet<Id>, theme: Theme,
  capture?: AdjacentWarningCapture, resolve = true,
): LintWarning[] {
  const stacks: (SeriesColorSample & AdjacentSeriesPaintSample)[] = [];
  const groups: (SeriesColorSample & AdjacentSeriesPaintSample)[] = [];
  for (const node of nodes) {
    if (node.t !== 'rect' || (node.part !== 'bar' && node.part !== 'segment')) continue;
    const { seriesId, categoryId } = node.owner;
    if (!seriesId || !categoryId || node.rect.w <= 0 || node.rect.h <= 0) continue;
    const stacked = node.part === 'segment';
    const alongY = stacked === (orientation === 'vertical');
    const from = alongY ? node.rect.y : node.rect.x;
    const extent = alongY ? node.rect.h : node.rect.w;
    const paint = (node.pattern === 'outline' || node.pattern === 'hollow') && node.stroke ? node.stroke : node.fill;
    (stacked ? stacks : groups).push({
      seriesId, categoryId, from, to: from + extent, paint,
      ...(node.pattern === 'hatch45' ? { pattern: 'hatch45' as const, byStripe: true as const } : {}),
      css: identityColour(paintCss(paint), node.pattern === 'hatch45' ? 'hatch45' : undefined, true, theme),
      highlighted: highlights.has(seriesId) || highlights.has(categoryId) || ('token' in paint && (paint.token === 'highlight' || paint.token === 'focus')),
    });
  }
  retainAdjacentWarningRule(stacks, true, capture);
  retainAdjacentWarningRule(groups, false, capture);
  if (!resolve) return [];
  return [...adjacentSeriesWarnings(stacks, true, theme), ...adjacentSeriesWarnings(groups, false, theme)];
}
