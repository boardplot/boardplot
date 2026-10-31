/** Child requirements are measured at the width allocated by the grid. */
import type { Geometry, LayoutResult, RefusedLayout } from '../types/scene';
import type { Rect, Size } from '../geometry';
import { chartSizing, resolveSizing, sizeRefusal } from '../sizing';
import { isVarianceTier } from './varianceTiers';
import { maxOf, minOf } from '../arrays';

type ChildChartLayout = (data: unknown, options: unknown) => LayoutResult;

/** Panel types that print a big figure in the kpi role and take part in one common figure size. */
export const hasKpiFigure = (type: string): boolean => type === 'kpi' || type === 'waffle';

/**
 * The smallest fitted figure among sibling KPI cards and waffle headlines.
 * A multi-panel waffle (more than one `label:total` node) prints panel
 * numbers, not a hero figure, so it does not take part.
 */
export function smallestKpiValueSize(children: Geometry[]): number | undefined {
  const figures = (child: Geometry) => child.scene
    .filter(node => (child.type === 'kpi' ? node.id === 'label:total:value' : node.id.startsWith('label:total:')) && node.t === 'text');
  const sizes = children.filter(child => hasKpiFigure(child.type)).map(child => ({ type: child.type, nodes: figures(child) }))
    .filter(({ type, nodes }) => type !== 'waffle' || nodes.length <= 1)
    .flatMap(({ nodes }) => nodes.map(node => node.t === 'text' ? node.font.size : Infinity));
  return sizes.length > 1 && maxOf(sizes) > minOf(sizes) ? minOf(sizes) : undefined;
}

export function layoutChildChart(
  data: unknown,
  options: unknown,
  layout: ChildChartLayout,
): LayoutResult {
  let geometry = layout(data, options);
  if (geometry.refused) return geometry;
  // Content panels stop at their natural height within a larger slot. The
  // grid owns refusal/growth, so retain requirements even on a short probe.
  if (geometry.sizing?.fit === 'content') {
    const height = geometry.sizing.naturalHeight;
    if (height < geometry.size.height) geometry = layout(data, { ...options as object, size: { width: geometry.size.width, height } });
  }
  if (geometry.refused) return geometry;
  // Canvas floors do not apply to panels. Measured content and frame
  // floors do. Variance strips keep the grid's existing short-plot policy.
  const { sizing, frame } = geometry;
  if (sizing) {
    const minWidth = sizing.measuredMinWidth;
    const minHeight = Math.ceil(Math.max(frame.minHeight ?? 0, isVarianceTier(options) ? 0 : frame.plotMinHeight ?? 0,
      sizing.measuredMinHeight));
    geometry.sizing = resolveSizing({ ...sizing, minWidth, minHeight }, geometry.size, {
      minWidth, minHeight, naturalWidth: sizing.naturalWidth, naturalHeight: sizing.naturalHeight,
    });
  }
  return geometry;
}

type GridChild = { geometry: LayoutResult; row: number; column: number; rowSpan: number; columnSpan: number };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Only rows occupied entirely by content-fit panels have a fixed content height. */
function contentRows(children: GridChild[], rows: number[], gaps: number[], automatic: boolean): (number | undefined)[] {
  return rows.map((_, row) => {
    const occupants = children.filter(child => child.row <= row && row < child.row + child.rowSpan);
    if (!automatic || occupants.length === 0 || occupants.some(child => child.geometry.sizing?.fit !== 'content')) return undefined;
    return maxOf(occupants.map(child => {
      const weight = sum(rows.slice(child.row, child.row + child.rowSpan));
      const height = child.geometry.sizing!.naturalHeight - sum(gaps.slice(child.row, child.row + child.rowSpan - 1));
      return Math.max(0, height) * rows[row]! / weight;
    }));
  });
}

/** Share the remaining canvas between flexible rows; authored weights bypass content fitting. */
export function gridRowHeights(height: number, children: GridChild[], rows: number[], gaps: number[]): number[] | undefined {
  const fixed = contentRows(children, rows, gaps, true);
  if (fixed.every(value => value === undefined)) return undefined;
  const flexibleWeight = sum(rows.filter((_, row) => fixed[row] === undefined));
  const remaining = Math.max(0, height - sum(gaps) - sum(fixed.map(value => value ?? 0)));
  return rows.map((weight, row) => fixed[row] ?? remaining * weight / flexibleWeight);
}

/**
 * Each spanned slot must hold its child's requirement, including fixed content rows.
 * `minimumRows` weights the rows for the minimum height only; the natural height keeps the slot `rows`.
 */
export function gridSizing(size: Size, area: Rect,
  children: GridChild[],
  rows: number[], columns: number[], rowGaps: number[], columnGaps: number[],
  automaticRows = false,
  minimumRows = rows,
) {
  const fixed = contentRows(children, rows, rowGaps, automaticRows);
  const required = (axis: 'row' | 'column', weights: number[], gaps: number[], natural = false) => {
    const heights = weights.map((_, row) => axis === 'row' ? fixed[row] : undefined);
    const flexible = weights.map((weight, row) => heights[row] === undefined ? weight : 0);
    const total = sum(flexible);
    return sum(gaps) + sum(heights.map(value => value ?? 0)) + Math.max(0, maxOf(children.map(child => {
      const start = child[axis];
      const span = axis === 'row' ? child.rowSpan : child.columnSpan;
      const g = child.geometry;
      const need = axis === 'column' ? g.sizing?.minWidth ?? 0
        : (natural ? g.sizing?.naturalHeight : g.sizing?.minHeight) ?? (g.refused ? 0 : Math.max(g.frame.minHeight ?? 0, g.frame.plotMinHeight ?? 0));
      const weight = sum(flexible.slice(start, start + span));
      const held = sum(heights.slice(start, start + span).map(value => value ?? 0));
      return weight === 0 ? 0 : Math.max(0, need - held - sum(gaps.slice(start, start + span - 1))) * total / weight;
    })));
  };
  const hasContentRows = fixed.some(value => value !== undefined);
  const content = hasContentRows || (children.length > 0 && children.every(child => child.geometry.sizing?.fit === 'content'));
  const policy = chartSizing('grid');
  const chrome = size.height - area.h;
  const slotMinimum = required('row', rows, rowGaps);
  const minimumHeight = minimumRows === rows ? slotMinimum : required('row', minimumRows, rowGaps);
  // Flexible rows keep their share of the grid's preferred aspect height.
  // Use that stable reference, not the current canvas, so measure and drawing agree.
  const naturalRows = hasContentRows ? Math.max(slotMinimum,
    sum(rowGaps) + sum(fixed.map(value => value ?? 0))
    + Math.max(0, resolveSizing(policy, size).naturalHeight - chrome - sum(rowGaps))
      * sum(rows.filter((_, row) => fixed[row] === undefined)) / sum(rows))
    : required('row', rows, rowGaps, true);
  return resolveSizing(content ? { ...policy, fit: 'content', aspect: 'content', minHeight: 0 } : policy, size, {
    minWidth: size.width - area.w + required('column', columns, columnGaps),
    minHeight: chrome + minimumHeight,
    ...(content ? { naturalHeight: chrome + naturalRows }
      // The minimum may come from tier minimums, below what the slots demand: the natural height keeps the slots' demand.
      : minimumHeight < slotMinimum ? { naturalHeight: Math.max(resolveSizing(policy, size).naturalHeight, chrome + slotMinimum) } : {}),
  });
}

/** Unwind a composition pass before any code reads a refused child's geometry. */
export class GridChildRefusal extends Error {
  constructor(readonly panelId: string, readonly child: RefusedLayout) {
    super(`Grid panel '${panelId}' refused layout`);
  }

  result(size: Size, sizing: RefusedLayout['sizing'], panelIndex: number): RefusedLayout {
    const result = sizeRefusal('grid', 'Grid', size, sizing);
    const childWarnings = this.child.warnings.map(warning => ({
      ...warning,
      field: ['data', 'panels', panelIndex, ...(warning.field ?? [])],
      ...(warning.fix ? { fix: warning.fix.map(fix => ({ ...fix,
        path: `/data/panels/${panelIndex}${fix.path}`,
      })) } : {}),
    }));
    result.warnings = this.child.warnings[0]?.code === 'size-below-floor'
      ? [...result.warnings, ...childWarnings] : [...childWarnings, ...result.warnings];
    return result;
  }
}
