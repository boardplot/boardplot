import type { BandScale } from '../scale';
import type { FontSpec, TextMeasurer } from '../text';
import type { Category, ChartData } from '../types/data';
import type { Rect } from '../geometry';
import { maxOf } from '../arrays';
import type { CategoryRowPlan } from './categoryRow';
import { categoryNameWithGroup } from '../normalize/shared';
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

/** The single-name recipe keeps the original data order and the gaps of the displayed order. */
export function inlineCategoryGroups(data: ChartData, ordered: readonly Category[]): ChartData | undefined {
  if (!ordered.some(cat => cat.group !== undefined)) return;
  const names = new Map(ordered.map((cat, i) => [cat.id, { label: categoryNameWithGroup(cat), gapAfter: categoryGapAfter(cat, ordered[i + 1]) }]));
  return { ...data, categories: data.categories.map(cat => cat.group === undefined ? cat : { ...cat, ...names.get(cat.id), group: undefined }) };
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
export function columnGroupRow(categories: readonly Category[], band: BandScale, names: CategoryRowPlan,
  measure: TextMeasurer, availableHeight: number) {
  if (names.rotation || !names.keep.every(Boolean)
    || names.infos.some(info => info.truncated || info.title !== undefined || !info.lines.some(line => line.trim()))) return;
  const groups = categoryGroups(categories, band);
  if (!groups.length) return;
  const { font, typeRole } = names;
  const gap = 4;
  const maxLines = Math.min(3, Math.floor((availableHeight - gap) / lineBox(font)));
  if (maxLines < 1) return;
  const labels: { group: Group; fitted: ReturnType<typeof fitText>; x: number }[] = [];
  let right = -Infinity;
  for (const group of groups) {
    const fitted = fitText(group.name, font, group.span, maxLines, measure, { hyphenRetry: true });
    const x = group.center - fitted.w / 2;
    if (x < right + gap || !fitted.lines.some(Boolean)) return;
    labels.push({ group, fitted, x });
    right = x + fitted.w;
  }
  return {
    height: gap + maxOf(labels.map(label => label.fitted.h)),
    requests(top: number) {
      return labels.map(({ group, fitted, x }) => groupLabel(group, fitted, font, typeRole,
        { x, y: top + gap, w: fitted.w, h: fitted.h }, 'below'));
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
