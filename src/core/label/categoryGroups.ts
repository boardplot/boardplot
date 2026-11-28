import type { BandScale } from '../scale';
import type { FontSpec, TextMeasurer } from '../text';
import type { Category } from '../types/data';
import type { Rect } from '../geometry';
import { planCategoryRow, type CategoryRowPlan } from './categoryRow';
import { fitText, lineBox } from './fitText';
import { fitBand } from './rowFit';
import { PRIORITY, type LabelRequest } from './solver';

interface Group {
  name: string;
  first: number;
  center: number;
  span: number;
}

/** A change between two named groups uses the same half step as gapAfter: true. */
export function categoryGapAfter(category: Pick<Category, 'group' | 'gapAfter' | 'breakAfter'>, next?: Pick<Category, 'group' | 'role'>): number {
  const gap = category.gapAfter ?? (category.group !== undefined && next?.group !== undefined && category.group !== next.group);
  // An axis break and a total column still need room for their marks.
  return Math.max(category.breakAfter || next?.role === 'total' ? 0.5 : 0, gap === true ? 0.5 : Number(gap));
}

function categoryGroups(categories: readonly Category[], band: BandScale): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < categories.length; i++) {
    const name = categories[i]!.group;
    if (name === undefined) continue;
    const first = i;
    while (categories[i + 1]?.group === name) i++;
    const start = band.position(first);
    const span = band.position(i) + band.bandwidth - start;
    groups.push({ name, first, center: start + span / 2, span });
  }
  return groups;
}

function groupLabel(group: Group, fitted: { lines: string[]; title?: string }, font: FontSpec,
  typeRole: CategoryRowPlan['typeRole'], rect: Rect, slot: 'below' | 'left'): LabelRequest {
  return {
    id: `category-group:${group.first}`, kind: 'category', owner: {}, text: group.name,
    lines: fitted.lines, title: fitted.title, font, fontStep: font, typeRole,
    align: slot === 'below' ? 'middle' : 'start', priority: PRIORITY.endpoint,
    candidates: [{ slot, rect, penalty: 0 }],
  };
}

/** The stack names keep their own fit. Each group gets only the span of its stacks. */
export function columnGroupRow(categories: readonly Category[], band: BandScale, names: Pick<CategoryRowPlan, 'font' | 'typeRole'>,
  measure: TextMeasurer, availableHeight: number) {
  const groups = categoryGroups(categories, band);
  if (!groups.length) return;
  const { font, typeRole } = names;
  const row = planCategoryRow({
    labels: groups.map(group => group.name), centers: groups.map(group => group.center), widths: groups.map(group => group.span),
    step: band.step, fonts: [font], rotate: false, everyName: 'including-periods', padding: 0, measure,
  });
  const gap = 4;
  const maxLines = Math.max(1, Math.min(3, Math.floor((availableHeight - gap) / lineBox(font))));
  const ellipsisWidth = measure('…', font).width;
  const rows: { right: number; height: number; top: number }[] = [];
  const labels = groups.map((group, index) => {
    const info = row.infos[index]!;
    // A category tick may be thinned or abbreviated. A group always gets a horizontal label and a title for a cut.
    const width = group.span;
    const fitted = !info.truncated && !info.title && info.w <= width && info.lines.length <= maxLines ? info
      : fitText(group.name, font, Math.max(ellipsisWidth, width), width < ellipsisWidth ? 1 : maxLines, measure, { hyphenRetry: true });
    const x = group.center - fitted.w / 2;
    // When even adjacent ellipses touch, use another line and keep each centre on its group.
    let line = rows.find(line => line.right + gap <= x);
    if (!line) {
      line = { right: 0, height: 0, top: 0 };
      rows.push(line);
    }
    line.right = x + fitted.w;
    line.height = Math.max(line.height, fitted.h);
    return { group, fitted, x, line };
  });
  let height = 0;
  for (const line of rows) {
    line.top = height + gap;
    height = line.top + line.height;
  }
  return {
    height,
    requests(top: number) {
      return labels.map(({ group, fitted, x, line }) => groupLabel(group, fitted, font, typeRole,
        { x, y: top + line.top, w: fitted.w, h: fitted.h }, 'below'));
    },
  };
}

/** Fit the outer name column after the stack names have taken their usual width. */
export function barGroupColumn(categories: readonly Category[], band: BandScale, font: FontSpec, measure: TextMeasurer,
  room: { cap: number; wider: number; spare: number; gap: number; x: number }) {
  const groups = categoryGroups(categories, band);
  if (!groups.length) return;
  const spare = Math.max(0, room.spare);
  const wider = Math.min(room.wider, Math.max(measure('…', font).width, spare - room.gap));
  const rows = groups.map(({ name, span }) => ({
    label: name, maxLines: Math.max(1, Math.min(3, Math.floor((span - 4) / lineBox(font)))),
  }));
  const fitted = fitBand(rows, font, Math.min(room.cap, wider), 3, measure, { wider, typeRole: 'axis' });
  const width = Math.min(fitted.width + room.gap, spare);
  const x = room.x + width - fitted.width - room.gap;
  return {
    width,
    labels: fitted.labels.map((label, i) => groupLabel(groups[i]!, label, font, 'axis',
      { x, y: groups[i]!.center - label.h / 2, w: label.w, h: label.h }, 'left')),
  };
}
