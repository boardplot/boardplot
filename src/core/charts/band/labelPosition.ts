import { rectContains, type Rect } from '../../geometry';
import type { LabelRequest, SlotCandidate } from '../../label/solver';
import { NormalizeError } from '../../normalize/shared';
import type { BaseOptions, LabelPosition } from '../../types/options';
import type { BandOrientation, TextSize } from './labels';

type PositionOptions = Pick<BaseOptions, 'labelPosition' | 'labelPlacements'>;
type InsidePaint = Pick<SlotCandidate, 'insideFill' | 'insidePaint' | 'insidePattern'>;

export function hasLabelPosition(options: PositionOptions): boolean {
  return options.labelPosition !== undefined && options.labelPosition !== 'auto';
}

/** Variant refusals also run in the React entries that do not link the schemas. */
export function refuseLabelPosition(options: PositionOptions, variant: string, accepted: readonly LabelPosition[]): void {
  if (!hasLabelPosition(options) || accepted.includes(options.labelPosition!)) return;
  throw new NormalizeError('label-position-unsupported', 'options.labelPosition',
    `${variant} does not support labelPosition '${options.labelPosition}'`,
    `Use labelPosition ${['auto', ...accepted].map(value => `'${value}'`).join(', ')}.`);
}

interface BarLabelSeat extends InsidePaint {
  rect: Rect;
  size: TextSize;
  orientation: BandOrientation;
  /** The farther edge is at the top/right; equal absolute levels take this edge too. */
  endPositive: boolean;
  zero?: boolean;
  edgeGap?: number;
  outsideGap?: number;
  fallback?: 'bridge' | 'stack' | 'inside';
  muted?: boolean;
  /** Integrated totals can sit only within one of these painted stretches. */
  paints?: (InsidePaint & { rect: Rect })[];
}

/** Add preferences, never pins. Legacy slots keep their names and geometry. */
export function positionBarLabel(request: LabelRequest, options: PositionOptions, bar: BarLabelSeat): LabelRequest {
  const position = options.labelPosition;
  if (position === undefined || position === 'auto' || options.labelPlacements?.[request.id] || request.pinnedSlot) return request;
  const { rect, size: { width: w, height: h }, orientation, endPositive, fallback, muted } = bar;
  const vertical = orientation === 'vertical';
  const gap = bar.edgeGap ?? 4;
  const outsideGap = bar.outsideGap ?? 4;
  const center: Rect = { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
  const inside = (at: 'center' | 'insideEnd' | 'insideBase'): SlotCandidate[] => {
    if (muted || bar.zero || w + 8 > rect.w || h + (vertical && at !== 'center' ? 4 : 2) > rect.h) return [];
    const positive = at === 'insideBase' ? !endPositive : endPositive;
    const seat = at === 'center' ? center : vertical
      ? { ...center, y: positive ? rect.y + gap : rect.y + rect.h - h - gap }
      : { ...center, x: positive ? rect.x + rect.w - w - gap : rect.x + gap };
    if (!rectContains(rect, seat)) return [];
    const paint = bar.paints ? bar.paints.find(paint => rectContains(paint.rect, seat)) : bar;
    if (!paint) return [];
    return [{ slot: at === 'center' ? 'insideBarCenter' : at === 'insideEnd' ? 'insideBarEnd' : 'insideBarBase', rect: seat, penalty: 0,
      // The fit check already leaves air inside the bar; extra padding would reject its base line.
      pad: 0, insideFill: paint.insideFill, insidePaint: paint.insidePaint, insidePattern: paint.insidePattern }];
  };
  const outside = (positive: boolean): SlotCandidate => ({
    slot: vertical ? positive ? 'outsideBarTop' : 'outsideBarBottom' : positive ? 'outsideBarRight' : 'outsideBarLeft',
    rect: vertical
      ? { ...center, y: positive ? rect.y - h - outsideGap : rect.y + rect.h + outsideGap }
      : { ...center, x: positive ? rect.x + rect.w + outsideGap : rect.x - w - outsideGap },
    penalty: 0,
  });
  const asked = position === 'outsideEnd' ? [outside(endPositive)] : inside(position);
  const next = fallback === 'bridge' ? [outside(true), outside(false)]
    : fallback === 'inside' || fallback === 'stack' && !bar.zero ? [] : [outside(endPositive)];
  const old = request.candidates.flatMap(candidate => {
    if (!candidate.slot.startsWith('inside')) return [candidate];
    if (muted || bar.zero) return [];
    if (fallback === 'stack') return [candidate];
    const heightRoom = vertical && !/Center/.test(candidate.slot) ? 4 : 2;
    if (w + 8 > rect.w || h + heightRoom > rect.h || !rectContains(rect, candidate.rect)) return [];
    const paint = bar.paints ? bar.paints.find(paint => rectContains(paint.rect, candidate.rect)) : bar;
    return paint ? [{ ...candidate, needsBacking: false,
      insideFill: paint.insideFill, insidePaint: paint.insidePaint, insidePattern: paint.insidePattern }] : [];
  });
  return { ...request, candidates: [
    ...asked,
    ...next.map((candidate, i) => ({ ...candidate, penalty: i + 1 })),
    ...old.map(candidate => ({ ...candidate, penalty: candidate.penalty + next.length + 2 })),
  ].map(candidate => ({ ...candidate, keepOffLines: true, overRules: false, overValueLines: false })) };
}
