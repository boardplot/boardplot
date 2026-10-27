import type { RenderTarget } from './types/options';
import { tint } from './color';
import { fitText } from './label/fitText';
import { NOT_AVAILABLE, NOT_MEANINGFUL } from './format';
import { formatterFromExample, parseFormatExample, specUnitKind } from './formatSpec';
import type { Rect } from './geometry';
import type { OccupiedIndex } from './label/occupied';
import { PRIORITY, type LabelRequest } from './label/solver';
import { arrowHeadPath } from './svgPath';
import { composedTextRole } from './textRole';
import type { FontSpec, TextMeasurer } from './text';
import { resolveSurface } from './theme';
import type { Direction, Id, OwnerRef } from './types/cell';
import type { DerivedRatioTier } from './types/options';
import type { LintWarning, PlacedLabel, SceneNode } from './types/scene';
import type { Theme } from './types/theme';
import { DEFAULT_TARGET } from './target';
import { maxOf } from './arrays';

interface RatioTierSourceCategory {
  id: Id;
  label?: string;
}

interface RatioTierSourceSeries {
  id: Id;
  label?: string;
  /** The declared unit, printed with the inputs when the tier shows them. */
  unit?: string;
  vals: readonly { v: number | null }[];
}

/**
 * 'value' = a number the reader can act on · 'na' = an input was missing or the
 * denominator is exactly zero · 'nm' = the quotient left the finite reals.
 * `value` is null for both non-value states, so the JSON and the painted badge
 * can never disagree (JSON.stringify turns a non-finite into null on its own —
 * that is how "Infinity%" and `value: null` shipped side by side).
 */
interface RatioTierBadgeGeometry {
  categoryId: Id;
  value: number | null;
  text: string;
  state: 'value' | 'na' | 'nm';
  tone?: 'good' | 'bad';
  labelId: Id;
  rect?: Rect;
  nodeId?: Id;
  statusNodeId?: Id;
}

export interface RatioTierGeometry {
  id: Id;
  label: string;
  captionLabelId: Id;
  reserveHeight: number;
  badges: RatioTierBadgeGeometry[];
}

interface PreparedBadge {
  categoryId: Id;
  categoryLabel: string;
  value: number | null;
  text: string;
  /** "8 ÷ 100 units": the numerator and denominator the chip divides, when the tier shows its inputs. */
  inputs?: string;
  state: RatioTierBadgeGeometry['state'];
  tone?: 'good' | 'bad';
}

export interface PreparedRatioTier {
  spec: DerivedRatioTier;
  badges: PreparedBadge[];
  captionFont: FontSpec;
  badgeFont: FontSpec;
  captionLines: string[];
  /** Full caption when its last line was cut; the node's `<title>`. */
  captionTitle?: string;
  captionWidth: number;
  captionHeight: number;
  badgeHeight: number;
  reserveHeight: number;
}

export interface PrepareRatioTierResult {
  tier?: PreparedRatioTier;
  warnings: LintWarning[];
}

interface RatioTierBadgeState extends PreparedBadge {
  labelId: Id;
  owner: OwnerRef;
}

export interface RatioTierRequestState {
  prepared: PreparedRatioTier;
  captionLabelId: Id;
  badges: RatioTierBadgeState[];
  fontByLabelId: Map<Id, FontSpec>;
}

interface RatioTierRequestInput {
  plot: Rect;
  categoryBandHeight: number;
  categoryCenter: (categoryId: Id) => number;
  theme: Theme;
  measure: TextMeasurer;
}

export interface FinalizedRatioTier {
  geometry: RatioTierGeometry;
  nodes: SceneNode[];
}

export const ratioTierMetrics = {
  categoryCaptionGap: 19,
  categoryCaptionRange: [18, 26],
  captionBadgeGap: 4,
  captionBadgeRange: [4, 8],
  tailReserve: 4,
  badgeSourceRange: [12, 18],
  minBadgeHeight: 18,
  badgeVerticalPadding: 6,
  captionShift: 2,
  maxCaptionLines: 3,
} as const;

export function ratioTierSpacingWarnings(
  tier: PreparedRatioTier | undefined,
  labels: readonly PlacedLabel[],
): LintWarning[] {
  if (!tier) return [];
  const caption = labels.find(
    (label) => label.id === `ratioTier:${tier.spec.id}:caption`,
  );
  const categories = labels.filter(
    (label) => label.kind === 'category' && !label.hidden,
  );
  const [minimum, maximum] = ratioTierMetrics.categoryCaptionRange;
  if (!caption || caption.hidden || categories.length === 0) {
    return [{
      code: 'ratio-tier-spacing-degraded',
      severity: 'warn',
      message:
        `ratioTier '${tier.spec.id}' category-to-caption gap is compressed below its contracted ` +
        `${minimum}–${maximum}px range because the caption or all category labels are hidden`,
      owner: { annotationId: `ratioTier:${tier.spec.id}` },
      suggest: 'increase chart height or shorten the category labels',
    }];
  }
  const categoryBottom = maxOf(categories.map((label) => label.rect.y + label.rect.h));
  const gap = caption.rect.y - categoryBottom;
  if (gap >= minimum && gap <= maximum) return [];
  const measured = Math.round(gap * 100) / 100;
  return [{
    code: 'ratio-tier-spacing-degraded',
    severity: 'warn',
    message:
      `ratioTier '${tier.spec.id}' category-to-caption gap is ${measured}px, ` +
      `${gap < minimum ? 'compressed below' : 'expanded beyond'} the contracted ` +
      `${minimum}–${maximum}px range`,
    owner: { annotationId: `ratioTier:${tier.spec.id}` },
    suggest: 'increase chart height or shorten the category labels',
  }];
}

export function ratioTierCanRender(
  spec: DerivedRatioTier | undefined,
  categories: readonly RatioTierSourceCategory[],
  series: readonly RatioTierSourceSeries[],
): boolean {
  if (!spec) return false;
  const seriesIds = new Set(series.map((item) => item.id));
  if (
    !seriesIds.has(spec.numeratorSeriesId) ||
    !seriesIds.has(spec.denominatorSeriesId)
  ) {
    return false;
  }
  const categoryIds = new Set(categories.map((category) => category.id));
  return spec.at.some((categoryId) => categoryIds.has(categoryId));
}

export function prepareRatioTier(
  spec: DerivedRatioTier | undefined,
  categories: readonly RatioTierSourceCategory[],
  series: readonly RatioTierSourceSeries[],
  theme: Theme,
  measure: TextMeasurer,
  captionMaxWidth = Number.POSITIVE_INFINITY,
  /**
   * Print the inputs under each chip and name them in the
   * caption ("Defect rate: Defects ÷ Inspected"), for a chart whose two
   * series share one scale and so cannot be read off it.
   */
  inputFormat?: (value: number) => string,
  target: RenderTarget = DEFAULT_TARGET,
  notApplicable = NOT_AVAILABLE,
  locale?: string,
): PrepareRatioTierResult {
  if (!spec) return { warnings: [] };

  const warnings: LintWarning[] = [];
  if (spec.format && specUnitKind(parseFormatExample(spec.format)) === 'number') {
    return { warnings: [{ code: 'ratio-tier-format-unit', severity: 'error',
      message: 'ratioTier computes a percentage; its format needs % or pp.',
      suggest: "Use a percent format such as '1.0%'.", field: ['options', 'ratioTier', 'format'] }] };
  }
  const validSeriesIds = series.map((item) => item.id);
  const numerator = series.find((item) => item.id === spec.numeratorSeriesId);
  const denominator = series.find((item) => item.id === spec.denominatorSeriesId);
  if (!numerator || !denominator) {
    const missing = [
      !numerator ? spec.numeratorSeriesId : undefined,
      !denominator ? spec.denominatorSeriesId : undefined,
    ].filter((id): id is Id => id !== undefined);
    warnings.push({
      code: 'ratio-tier-series-missing',
      severity: 'warn',
      message:
        `ratioTier '${spec.id}' references unknown series id${missing.length === 1 ? '' : 's'} ` +
        `${missing.map((id) => `'${id}'`).join(', ')}; tier omitted`,
      suggest: `Valid series ids: ${validSeriesIds.join(', ')}`,
    });
    return { warnings };
  }

  const requested = new Set(spec.at);
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const unknownCategories = [...new Set(spec.at.filter((id) => !validCategoryIds.has(id)))];
  if (unknownCategories.length > 0) {
    warnings.push({
      code: 'ratio-tier-category-missing',
      severity: 'warn',
      message:
        `ratioTier '${spec.id}' skips unknown category id${unknownCategories.length === 1 ? '' : 's'} ` +
        unknownCategories.map((id) => `'${id}'`).join(', '),
      suggest: `Valid category ids: ${categories.map((category) => category.id).join(', ')}`,
    });
  }

  const formatter = formatterFromExample(spec.format ?? '88%', locale);
  const units = [numerator.unit?.trim(), denominator.unit?.trim()];
  const inputText = (numValue: number, denValue: number): string => {
    const [num, den] = [inputFormat!(numValue), inputFormat!(denValue)];
    return units[0] === units[1]
      ? `${num} ÷ ${den}${units[0] ? ` ${units[0]}` : ''}`
      : `${num}${units[0] ? ` ${units[0]}` : ''} ÷ ${den}${units[1] ? ` ${units[1]}` : ''}`;
  };
  const badges: PreparedBadge[] = [];
  const notMeaningful: Id[] = [];
  categories.forEach((category, categoryIndex) => {
    if (!requested.has(category.id)) return;
    const numeratorValue = numerator.vals[categoryIndex]?.v ?? null;
    const denominatorValue = denominator.vals[categoryIndex]?.v ?? null;
    const quotient =
      numeratorValue === null || denominatorValue === null || denominatorValue === 0
        ? null
        : (numeratorValue / denominatorValue) * 100;
    // `denominator === 0` is not the whole guard: a denominator that is merely
    // TINY (5e-324 is finite, non-zero and schema-valid) overflows the quotient
    // out of the finite reals. Such a badge has no value to show, so it fails
    // closed on the frozen state glyph instead of printing "Infinity%".
    const overflowed = quotient !== null && !Number.isFinite(quotient);
    if (overflowed) notMeaningful.push(category.id);
    const value = overflowed ? null : quotient;
    const state: PreparedBadge['state'] =
      overflowed ? 'nm' : value === null ? 'na' : 'value';
    badges.push({
      categoryId: category.id,
      categoryLabel: category.label ?? category.id,
      value,
      state,
      text:
        state === 'nm' ? NOT_MEANINGFUL : state === 'na' ? notApplicable : formatter(value!),
      ...(inputFormat && numeratorValue !== null && denominatorValue !== null ? { inputs: inputText(numeratorValue, denominatorValue) } : {}),
      ...(value !== null && spec.direction
        ? { tone: toneFor(value, spec.direction) }
        : {}),
    });
  });

  if (notMeaningful.length > 0) {
    warnings.push({
      code: 'ratio-tier-not-meaningful',
      severity: 'warn',
      message:
        `ratioTier '${spec.id}': '${spec.numeratorSeriesId}' ÷ '${spec.denominatorSeriesId}' ` +
        `overflows to a non-finite ratio for categor${notMeaningful.length === 1 ? 'y' : 'ies'} ` +
        `${notMeaningful.map((id) => `'${id}'`).join(', ')}; ` +
        `shown as ${NOT_MEANINGFUL} instead of a number`,
      suggest:
        `The denominator is non-zero but too small for the quotient to be representable. ` +
        `Check the units of '${spec.denominatorSeriesId}'.`,
    });
  }

  if (badges.length === 0) {
    warnings.push({
      code: 'ratio-tier-no-valid-categories',
      severity: 'warn',
      message: `ratioTier '${spec.id}' has no valid selected categories; tier omitted`,
      suggest: `Valid category ids: ${categories.map((category) => category.id).join(', ')}`,
    });
    return { warnings };
  }

  const captionFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const badgeFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const captionMeasureCache = new Map<string, ReturnType<TextMeasurer>>();
  const measureCaption: TextMeasurer = (text, font) => {
    const cached = captionMeasureCache.get(text);
    if (cached) return cached;
    const size = measure(text, font);
    captionMeasureCache.set(text, size);
    return size;
  };
  const captionText = inputFormat ? `${spec.label}: ${numerator.label ?? numerator.id} ÷ ${denominator.label ?? denominator.id}` : spec.label;
  const caption = wrapMeasured(captionText, captionFont, captionMaxWidth, ratioTierMetrics.maxCaptionLines, measureCaption, target);
  const captionLines = caption.lines;
  const captionSizes = captionLines.map((line) => measureCaption(line, captionFont));
  const captionWidth = Math.max(...captionSizes.map((size) => size.width));
  const captionHeight =
    Math.max(...captionSizes.map((size) => size.height)) * captionLines.length;
  const badgeHeight = Math.max(
    ratioTierMetrics.minBadgeHeight,
    measure('100%', badgeFont).height + ratioTierMetrics.badgeVerticalPadding,
  );
  const inputsHeight = badges.some((badge) => badge.inputs) ? ratioTierMetrics.captionBadgeGap + measure('0', captionFont).height : 0;
  const reserveHeight =
    theme.space.tierGap +
    captionHeight +
    ratioTierMetrics.captionBadgeGap +
    badgeHeight +
    inputsHeight +
    ratioTierMetrics.tailReserve;

  return {
    tier: {
      spec,
      badges,
      captionFont,
      badgeFont,
      captionLines,
      ...(caption.title !== undefined ? { captionTitle: caption.title } : {}),
      captionWidth,
      captionHeight,
      badgeHeight,
      reserveHeight,
    },
    warnings,
  };
}

export function addRatioTierRequests(
  prepared: PreparedRatioTier,
  requests: LabelRequest[],
  input: RatioTierRequestInput,
): RatioTierRequestState {
  const { spec } = prepared;
  const annotationId = `ratioTier:${spec.id}`;
  const captionLabelId = `${annotationId}:caption`;
  const tierTop = input.plot.y + input.plot.h + input.categoryBandHeight;
  const captionY = tierTop + input.theme.space.tierGap;
  const badgeY =
    captionY + prepared.captionHeight + ratioTierMetrics.captionBadgeGap;
  const surface = resolveSurface(input.theme);
  const fontByLabelId = new Map<Id, FontSpec>([[captionLabelId, prepared.captionFont]]);

  requests.push({
    id: captionLabelId,
    kind: 'axisTitle',
    owner: { annotationId },
    text: prepared.captionTitle ?? prepared.captionLines.join(' '),
    lines: prepared.captionLines,
    ...(prepared.captionTitle !== undefined ? { title: prepared.captionTitle } : {}),
    typeRole: 'axis', font: prepared.captionFont,
    priority: PRIORITY.valueLine,
    candidates: [
      {
        slot: 'ratioTierCaption',
        rect: {
          x: input.plot.x,
          y: captionY,
          w: prepared.captionWidth,
          h: prepared.captionHeight,
        },
        penalty: 0,
      },
      {
        slot: 'ratioTierCaptionShifted',
        rect: {
          x: input.plot.x,
          y: captionY + ratioTierMetrics.captionShift,
          w: prepared.captionWidth,
          h: prepared.captionHeight,
        },
        penalty: 1,
      },
    ],
  });

  const badges: RatioTierBadgeState[] = prepared.badges.map((badge) => {
    const labelId = `${annotationId}:${badge.categoryId}`;
    const owner: OwnerRef = {
      annotationId,
      seriesId: spec.numeratorSeriesId,
      categoryId: badge.categoryId,
      segmentId: annotationId,
    };
    const textSize = input.measure(badge.text, prepared.badgeFont);
    const center = input.categoryCenter(badge.categoryId);
    const hasStatusCue = badge.value !== null && spec.direction !== undefined;
    const statusPad = hasStatusCue ? 10 : 0;
    const width =
      badge.value === null ? textSize.width : Math.max(28, textSize.width + 12 + statusPad);
    const y =
      badge.value === null
        ? badgeY + (prepared.badgeHeight - textSize.height) / 2
        : badgeY;
    const height = badge.value === null ? textSize.height : prepared.badgeHeight;
    const fillToken = badge.tone ?? 'neutralLight';
    const fillColor =
      fillToken === 'good'
        ? input.theme.color.good
        : fillToken === 'bad'
          ? input.theme.color.bad
          : input.theme.color.neutralLight;
    const offsets = [0, -2, 2];

    if (badge.inputs) {
      const inputsId = `${labelId}:inputs`;
      const size = input.measure(badge.inputs, prepared.captionFont);
      requests.push({
        id: inputsId,
        kind: 'point',
        role: composedTextRole(badge.inputs),
        owner: { ...owner, segmentId: `${annotationId}:inputs` },
        text: badge.inputs,
        lines: [badge.inputs],
        typeRole: 'label', font: prepared.captionFont,
        priority: PRIORITY.valueLine,
        candidates: [{ slot: 'ratioTierInputs', rect: { x: center - size.width / 2, y: badgeY + prepared.badgeHeight + ratioTierMetrics.captionBadgeGap, w: size.width, h: size.height }, penalty: 0 }],
      });
      fontByLabelId.set(inputsId, prepared.captionFont);
    }
    requests.push({
      id: labelId,
      kind: 'point',
      owner,
      text: badge.text,
      lines: [badge.text],
      typeRole: 'label', font: prepared.badgeFont,
      priority: PRIORITY.valueLine,
      candidates: offsets.map((offset, index) => ({
        slot:
          index === 0
            ? 'ratioTierBadge'
            : index === 1
              ? 'ratioTierBadgeUp'
              : 'ratioTierBadgeDown',
        rect: { x: center - width / 2, y: y + offset, w: width, h: height },
        penalty: index,
        ...(badge.value !== null
          ? { insideFill: tint(fillColor, surface.chipTint, input.theme.color.background), insidePaint: { token: fillToken, tint: surface.chipTint } }
          : {}),
      })),
    });
    fontByLabelId.set(labelId, prepared.badgeFont);
    return { ...badge, labelId, owner };
  });

  return { prepared, captionLabelId, badges, fontByLabelId };
}

/** The caption through the shared truncation policy (src/core/label/fitText.ts). */
function wrapMeasured(
  text: string,
  font: FontSpec,
  maxWidth: number,
  maxLines: number,
  measure: TextMeasurer,
  target: RenderTarget,
): { lines: string[]; title?: string } {
  if (text.split(/\s+/).filter(Boolean).length === 0) return { lines: [''] };
  if (!Number.isFinite(maxWidth)) return { lines: [text.split(/\s+/).filter(Boolean).join(' ')] };
  const fitted = fitText(text, font, maxWidth, maxLines, measure, { target, typeRole: 'axis' });
  return { lines: fitted.lines, ...(fitted.title !== undefined ? { title: fitted.title } : {}) };
}

export function finalizeRatioTier(
  state: RatioTierRequestState,
  labels: PlacedLabel[],
  occupied: OccupiedIndex,
  theme: Theme,
  measure: TextMeasurer,
): FinalizedRatioTier {
  const nodes: SceneNode[] = [];
  const surface = resolveSurface(theme);
  const caption = labels.find((label) => label.id === state.captionLabelId);
  if (caption && !caption.hidden) caption.ink = { token: 'inkMuted' };

  const badges: RatioTierBadgeGeometry[] = state.badges.map((badge) => {
    const placed = labels.find((label) => label.id === badge.labelId);
    const base: RatioTierBadgeGeometry = {
      categoryId: badge.categoryId,
      value: badge.value,
      text: badge.text,
      state: badge.state,
      ...(badge.tone ? { tone: badge.tone } : {}),
      labelId: badge.labelId,
    };
    if (!placed || placed.hidden) return base;

    if (badge.value === null) {
      placed.ink = { token: 'inkMuted' };
      return { ...base, rect: { ...placed.rect } };
    }

    const rect = { ...placed.rect };
    const fillToken = badge.tone ?? 'neutralLight';
    const nodeId = `mark:ratioTier:${state.prepared.spec.id}:${badge.categoryId}`;
    nodes.push({
      t: 'rect',
      id: nodeId,
      rect,
      fill: { token: fillToken, tint: surface.chipTint },
      radius: surface.chipRadius,
      owner: badge.owner,
      part: 'ratioTierBadge',
    });
    occupied.claim(rect, 'mark', badge.owner, 'ratioTierBadge');

    let statusNodeId: Id | undefined;
    let statusPad = 0;
    if (state.prepared.spec.direction) {
      statusNodeId = `mark:ratioTier:${state.prepared.spec.id}:${badge.categoryId}:status`;
      statusPad = 10;
      const statusRect: Rect = {
        x: rect.x + 4,
        y: rect.y + 4,
        w: 6,
        h: Math.max(6, rect.h - 8),
      };
      if (badge.value === 100) {
        nodes.push({
          t: 'circle',
          id: statusNodeId,
          cx: statusRect.x + statusRect.w / 2,
          cy: statusRect.y + statusRect.h / 2,
          r: 2,
          fill: placed.ink,
          owner: badge.owner,
          part: 'ratioTierStatus',
        });
      } else {
        const up = badge.value > 100;
        const cy = statusRect.y + statusRect.h / 2;
        const tip = {
          x: statusRect.x + statusRect.w / 2,
          y: up ? cy - 2.5 : cy + 2.5,
        };
        nodes.push({
          t: 'path',
          id: statusNodeId,
          d: arrowHeadPath(tip, up ? -Math.PI / 2 : Math.PI / 2, 3.2),
          fill: placed.ink,
          owner: badge.owner,
          part: 'ratioTierStatus',
        });
      }
      occupied.claim(statusRect, 'mark', badge.owner, 'ratioTierStatus');
    }

    const textSize = measure(badge.text, state.prepared.badgeFont);
    placed.rect = {
      x: rect.x + 6 + statusPad,
      y: rect.y + (rect.h - textSize.height) / 2,
      w: textSize.width,
      h: textSize.height,
    };
    return {
      ...base,
      rect,
      nodeId,
      ...(statusNodeId ? { statusNodeId } : {}),
    };
  });

  return {
    geometry: {
      id: state.prepared.spec.id,
      label: state.prepared.spec.label,
      captionLabelId: state.captionLabelId,
      reserveHeight: state.prepared.reserveHeight,
      badges,
    },
    nodes,
  };
}

export function ratioTierA11y(tier: PreparedRatioTier | undefined): string {
  if (!tier) return '';
  return ` ${tier.spec.label}: ${tier.badges.map((badge) => `${badge.categoryLabel} ${badge.text}`).join(', ')}.`;
}

function toneFor(value: number, direction: Direction): 'good' | 'bad' {
  const meets = direction === 'higherIsBetter' ? value >= 100 : value <= 100;
  return meets ? 'good' : 'bad';
}
