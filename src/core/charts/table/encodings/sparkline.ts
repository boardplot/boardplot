import type { FontSpec } from '../../../text';
import type { SceneNode } from '../../../types/scene';
import type { EncodingContext, ResolvedColumn, ResolvedRow } from '../../../types/table';
import type { Id } from '../../../types/cell';
import { formatExactNumber } from '../../../format';
import {
  emitSparklineMarks,
  lastObservedIndex,
  plotSparkline,
  sparklineDomain,
  TABLE_SPARK_STYLE,
  type SparklineDomain,
  type TableSparklineShape,
} from '../../sparkline/layout';

export function sparklineSourceValues(row: ResolvedRow, sourceColumns: readonly Id[]): (number | null)[] {
  return sourceColumns.map((sourceId) => {
    const source = row.cells[sourceId];
    return source?.state === 'value' && typeof source.raw === 'number' ? source.raw : null;
  });
}

export function tableSparklineDomain(
  rows: readonly ResolvedRow[],
  sourceColumns: readonly Id[],
  shape: TableSparklineShape,
): SparklineDomain {
  return sparklineDomain(
    rows.filter((row) => row.role !== 'section').map((row) => sparklineSourceValues(row, sourceColumns)),
    shape,
  );
}

/**
 * The domain each sparkline column shares across the rows a surface draws,
 * so one row's line is comparable with the next. Both renderers ask for it
 * here: the React cell draws the same shape the SVG does.
 */
export function sparklineDomains(
  columns: readonly ResolvedColumn[],
  rows: readonly ResolvedRow[],
): Map<Id, SparklineDomain> {
  const domains = new Map<Id, SparklineDomain>();
  for (const column of columns) {
    if (column.kind !== 'encoding' || column.encoding?.type !== 'sparkline') continue;
    domains.set(column.id, tableSparklineDomain(rows, column.encoding.sourceColumns, column.encoding.kind ?? 'line'));
  }
  return domains;
}

export function emitSparkline(
  context: EncodingContext,
  values: readonly (number | null)[],
  metrics: {
    kind?: TableSparklineShape;
    domain: SparklineDomain;
    lastText?: string;
    /** The chart's language tag with its number marks (numberMarks.ts), for a last value with no printed cell. */
    language?: string;
  },
): SceneNode[] {
  const present = values.some((value) => value !== null);
  if (!present) {
    const font = { family: context.theme.type.family, ...context.theme.type.label };
    // The same mark as the row's empty cells: the theme's missing glyph.
    const mark = context.theme.table?.glyphs?.missing ?? '—';
    return [
      {
        t: 'text', typeRole: 'label',
        id: context.nodeId('sparkEmpty'),
        x: context.box.x + context.box.w / 2,
        y: context.box.y + (context.box.h - context.measure(mark, font).height) / 2,
        lines: [mark],
        align: 'middle',
        font,
        ink: { token: 'inkMuted' },
        owner: context.owner,
        part: 'tableSparkEmpty',
      },
    ];
  }

  const kind = metrics.kind ?? 'line';
  const font: FontSpec = { family: context.theme.type.family, ...context.theme.type.label };
  const lastIndex = lastObservedIndex(values);
  const lastText =
    metrics.lastText ??
    (lastIndex === undefined ? undefined : formatExactNumber(values[lastIndex]!, metrics.language));
  const plot = plotSparkline({
    box: context.box,
    values,
    shape: kind,
    domain: metrics.domain,
    style: TABLE_SPARK_STYLE,
    lastText,
    font,
    measure: context.measure,
  });
  return emitSparklineMarks({
    plot,
    shape: kind,
    theme: context.theme,
    palette: context.palette,
    style: TABLE_SPARK_STYLE,
    nodeId: context.nodeId,
    owner: context.owner,
    partPrefix: 'table',
  }).map(node => node.t === 'text' ? { ...node, typeRole: 'label' as const } : node);
}
