import { emphasisWeight } from '../../theme';
import type { AnnotatePassInput, AnchorResolution } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { marginBracketLayout } from '../../annotateLinks';
import { labelsToNodes } from '../../label/emit';
import type { AnchorRef } from '../../types/annotations';
import type { Geometry } from '../../types/scene';
import type { BoxData, BoxDerived, BoxMarks, BoxOptions } from './types';
import { maxOf, pushAll } from '../../arrays';

type BoxGeometry = Geometry<BoxMarks, BoxDerived>;
type BoxAnnotationContext = Pick<AnnotatePassInput, 'occupied' | 'theme' | 'measure' | 'solveCtx'> & {
  xScale(value: number): number;
  /** Where comparison brackets start, right of the plot. */
  bracketRight: number;
  /** Lays the chart out again when the brackets need `reach` more than the room left; undefined keeps this layout. */
  relayout?: (reach: number) => BoxGeometry | undefined;
  /** Puts a bracket's named span on its own line. */
  wrapLead?: boolean;
  /** The sizing the chart reports when its brackets need `reach` right of the plot. */
  bracketFloor?: (reach: number) => BoxGeometry['sizing'];
};

const STATISTIC_NAMES = { median: 'Median', q1: 'Q1', q3: 'Q3', whiskerLow: 'Lower whisker', whiskerHigh: 'Upper whisker' } as const;

/** Add comparisons after the row marks and their labels have claimed space. */
export function annotateBox(
  geometry: BoxGeometry,
  data: BoxData,
  options: BoxOptions,
  context: BoxAnnotationContext,
): BoxGeometry {
  if (!options.annotations?.length) return geometry;
  const groups = new Map(data.groups.map(group => [group.id, group]));
  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const anchor = typeof ref === 'string' ? { categoryId: ref } : ref;
    if (!('categoryId' in anchor)) return null;
    const row = geometry.derived.groups.find(group => group.id === anchor.categoryId);
    const mark = geometry.marks.rows.find(group => group.id === anchor.categoryId);
    if (!row || !mark) return null;
    const statistic = (anchor.seriesId ?? anchor.segmentId ?? 'median') as keyof typeof STATISTIC_NAMES;
    if (!(statistic in STATISTIC_NAMES)) return null;
    const value = row[statistic];
    if (value === null) return null;
    return {
      x: context.xScale(value), y: mark.rect.y + mark.rect.h / 2, value, date: groups.get(row.id)?.date, label: row.label,
      series: { id: statistic, label: STATISTIC_NAMES[statistic] },
      row: { y: mark.rect.y, h: mark.rect.h }, owner: { categoryId: row.id },
    };
  };
  const brackets = marginBracketLayout(context.theme, { right: context.bracketRight }, { wrapLead: context.wrapLead });
  const ids = geometry.derived.groupOrder;
  const result = runAnnotatePass({
    ...context, annotations: options.annotations, resolve, plot: geometry.plot,
    format: options.format, locale: options.locale?.language, strings: options.strings, valueAxis: 'horizontal', comparisonLayout: brackets,
    defaultSpan: ids.length > 1 ? { from: ids[0]!, to: ids[ids.length - 1]! } : undefined,
  });
  const again = context.relayout?.(brackets.need().right);
  if (again) return again;
  const font = { family: context.theme.type.family, ...context.theme.type.label, weight: emphasisWeight(context.theme) };
  // The floor counts each drawn bracket at its wrapped width, the narrowest the layout draws it.
  const reach = result.labels.filter((label) => label.slot === 'bracket' && !label.hidden).map((label) => {
    const cut = label.text.indexOf(': ');
    const width = cut > 0 ? Math.max(context.measure(label.text.slice(0, cut + 1), font).width, context.measure(label.text.slice(cut + 2), font).width) : label.rect.w;
    return label.rect.x - context.bracketRight + width;
  });
  const sizing = reach.length && context.bracketFloor ? context.bracketFloor(maxOf(reach)) : undefined;
  if (sizing) geometry.sizing = sizing;
  pushAll(geometry.scene, result.nodes);
  pushAll(geometry.scene, labelsToNodes(context.theme, result.labels, () => font));
  pushAll(geometry.labels, result.labels);
  pushAll(geometry.annotations, result.placed);
  pushAll(geometry.warnings, result.warnings);
  if (geometry.debug) {
    geometry.debug.occupied = context.occupied.snapshot();
    pushAll(geometry.debug.decisions, result.decisions);
  }
  return geometry;
}
