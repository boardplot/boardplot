import { rectContains, rectsOverlap, type Rect } from '../../geometry';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { SERIES_VALUE_GAP, type LabelRequest } from '../../label/solver';
import { claimStaircase, staircaseRequests, type StaircaseName } from '../../label/staircase';
import { hasLabelPosition } from '../band/labelPosition';
import { kindSetting } from './domain';
import { planColumnLabels } from './labels';
import { baselineBounds, netInsideStack, stackSegmentRect } from './marks';
import { netTotalBounds } from './netTick';
import type { ColumnArea, ColumnDomain } from './model';

/** Prove that the no-axis layout seats every total and every staircase name at the proposed size. */
export function stackedStaircaseSeatsFit(domain: ColumnDomain, area: ColumnArea, height: number,
  names: readonly StaircaseName[], topContentBottom: number): boolean {
  const { options, cats, stacks, dataSeries } = domain;
  if (domain.va.show || options.mode === 'compact' || options.labelOffsets || options.labelPlacements || hasLabelPosition(options)
    || domain.variant !== 'stacked' || !domain.gtContent || domain.averageMarker || domain.activeBreak || domain.anomaly
    || domain.incompleteCats.size || domain.pyRef || domain.refSeries.length || domain.annList.length || area.tier
    || domain.netLineOn || domain.connectorsOn || domain.ribbonsOn || options.seriesLabels !== undefined || options.ratioTier
    || kindSetting(options, 'segment') !== false || options.shareLabels || options.valueLabels || options.grandTotalLabels === false
    || area.showCatRow || area.stairTop === undefined || area.axisTitle || area.ruleH || domain.density === 'minimal'
    || names.length !== cats.length || !stacks.every(stack => stack.hasValue)
    || dataSeries.some(s => s.vals.some(v => v.range || v.labelOverride !== undefined))) return false;
  const occupied = createOccupiedIndex(area.plot);
  const requests = staircaseRequests(names, area.tickFont);
  planColumnLabels(domain, area, { bars: [], planEnds: undefined, netLineEnd: undefined }, requests, []);
  // Every potential seat is clear of the frame and its legend. Their positions need not be rebuilt.
  const bottom = area.frame.plot.y + area.frame.plot.h;
  if (requests.length !== cats.length * 2 || requests.some(r => (r.kind !== 'grandTotal' && r.kind !== 'category')
    || r.candidates.some(c => c.rect.y - 2 < topContentBottom || c.rect.y + c.rect.h + 2 > bottom))) return false;
  occupied.claim(baselineBounds(area.plot, area.y0), 'axis', {});
  for (let ci = 0; ci < stacks.length; ci++) {
    const id = cats[ci]!.id;
    const x = area.band.position(ci);
    const w = area.band.bandwidth;
    const segments = stacks[ci]!.segments;
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      if (!seg || seg.value === 0) continue;
      occupied.claim(stackSegmentRect(x, w, area.y, seg.start, seg.end), 'mark',
        { categoryId: id, seriesId: dataSeries[si]!.id }, 'segment');
    }
    if (netInsideStack(domain, ci)) occupied.claim(netTotalBounds(x, w, area.y(domain.stackTotals[id]!)),
      'mark', { categoryId: id, seriesId: '__netTotal' }, 'netTotal');
  }
  claimStaircase(names, occupied);
  return independentStackSeats(requests, occupied, { x: 0, y: 0, w: domain.size.width, h: height });
}

/** Every chosen box is free in any label order. Earlier net positions must already be blocked by fixed marks. */
function independentStackSeats(requests: LabelRequest[], occupied: OccupiedIndex, canvas: Rect): boolean {
  const totals: Rect[] = [], names: Rect[] = [];
  for (const request of requests) {
    const { candidates, kind, role } = request;
    if (request.redundant || request.printedIn || request.pinnedSlot || request.anchor) return false;
    const first = candidates[0];
    if (!first) return false;
    const simple = candidates.length === 1 && (kind === 'category' ? first.slot === 'staircase'
      : first.slot === 'aboveStack' || first.slot === 'belowStack');
    const net = kind === 'grandTotal' && role === 'category' && candidates.length === 4
      && first.slot === 'rightOfNet' && candidates[1]!.slot === 'rightOfNetAbove'
      && candidates[2]!.slot === 'rightOfNetBelow' && candidates[3]!.slot === 'aboveNet';
    if (!simple && !net) return false;
    let chosen: Rect | undefined;
    for (const { rect } of candidates) {
      if (!rectContains(canvas, rect)) return false;
      const hits = occupied.hitsWhich(rect, 2);
      if (hits.length === 0) { chosen = rect; break; }
      // A net's ordinary seats may cross their own marks. A foreign segment or a staircase leader blocks them.
      if (!net || !hits.some(c => (c.kind === 'annotation' && c.part === 'staircaseLeader')
        || (c.kind === 'mark' && c.part === 'segment' && c.owner.categoryId !== request.owner.categoryId))) return false;
    }
    if (!chosen) return false;
    const seat = chosen;
    const total = kind === 'grandTotal';
    if (names.some(rect => rectsOverlap(seat, rect, 2))
      || totals.some(rect => rectsOverlap(seat, rect, total ? SERIES_VALUE_GAP : 2))) return false;
    (total ? totals : names).push(seat);
  }
  return true;
}
