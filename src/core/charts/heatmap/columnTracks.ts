/**
 * Authored column widths of a matrix (heatmap, status, and the warnings a bar
 * table shares). One cell width becomes one width per column only when an
 * author sets one, so a spec without `columnOverrides` keeps its arithmetic.
 */
import type { Geometry, LayoutResult, LintWarning } from '../../types/scene';

export interface MatrixTracks {
  /** Width of each column, in column order. */
  widths: number[];
  /** Left edge of each column, measured from the left edge of the grid. */
  lefts: number[];
  /** The columns with an authored width. */
  authored: boolean[];
  /** The grid's width: it ends with its last column when every column is authored. */
  gridW: number;
  /** The ids whose authored width did not fit the room. */
  capped: string[];
  /** The ids whose authored width stopped at their floor. */
  floored: string[];
}

/**
 * Columns without a width share what the authored ones leave. A narrow width
 * stops at its `keep` width. When the widths pass the room, each column keeps
 * that width and the rest shrinks together, so an authored width never makes
 * the matrix wider than its plot.
 */
export function matrixTracks(ids: readonly string[], room: number, gap: number, widthOf: (id: string) => number | undefined, keepOf: (id: string) => number): MatrixTracks | undefined {
  const asked = ids.map(widthOf);
  if (asked.every((width) => width === undefined)) return undefined;
  const cells = Math.max(1, room - (ids.length - 1) * gap);
  const keeps = ids.map(keepOf);
  const wanted = asked.map((width, i) => (width === undefined ? undefined : Math.max(keeps[i]!, width)));
  const keepSum = keeps.reduce((sum, value) => sum + value, 0);
  // A chart too narrow for the columns' keep widths gives each column its share of those.
  const keepScale = keepSum > cells ? cells / keepSum : 1;
  const floors = keeps.map((keep) => keep * keepScale);
  const surplus = wanted.map((width, i) => (width === undefined ? 0 : Math.max(0, width - floors[i]!)));
  const surplusSum = surplus.reduce((sum, value) => sum + value, 0);
  const spare = Math.max(0, cells - floors.reduce((sum, value) => sum + value, 0));
  const scale = surplusSum > spare ? spare / surplusSum : 1;
  const set = wanted.map((width, i) => (width === undefined ? undefined : floors[i]! + surplus[i]! * scale));
  const setSum = set.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  const free = set.filter((width) => width === undefined).length;
  const share = free > 0 ? (cells - setSum) / free : 0;
  const widths = set.map((width) => width ?? share);
  let at = 0;
  const lefts = widths.map((width) => { const left = at; at += width + gap; return left; });
  return {
    widths, lefts,
    authored: asked.map((width) => width !== undefined),
    gridW: free > 0 ? Math.max(room, at - gap) : at - gap,
    capped: scale < 1 ? ids.filter((_, i) => surplus[i]! > 0) : [],
    floored: ids.filter((_, i) => asked[i] !== undefined && asked[i]! < keeps[i]!),
  };
}

/** A wide authored width stops where the rest of the chart keeps its floor. */
export function widthCapped(type: string, id: string): LintWarning {
  return {
    code: 'generated-column-width-capped', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
    message: `columnOverrides.${id}.width is wider than this ${type} has room for, so the column stops where the other columns keep their minimum`,
    suggest: 'Set a smaller width, or draw the chart wider.',
  };
}

/** A narrow authored width stops at the floor of its column. */
export function widthFloored(type: string, id: string): LintWarning {
  return {
    code: 'generated-column-width-floored', severity: 'warn', field: ['options', 'columnOverrides', id, 'width'],
    message: `columnOverrides.${id}.width is narrower than this ${type} column can draw, so the column stops at its minimum`,
    suggest: 'Set a larger width, or remove it.',
  };
}

/** A setting this column or this form has no part for. */
export function overrideIgnored(id: string, key: string, reason: string): LintWarning {
  return {
    code: 'option-ignored', severity: 'warn', field: ['options', 'columnOverrides', id, key],
    message: `columnOverrides.${id}.${key} has no effect: ${reason}`,
    suggest: `Remove columnOverrides.${id}.${key}.`,
    fix: [{ op: 'remove', path: `/options/columnOverrides/${id}/${key}` }],
  };
}

/** The text a width can cost: labels and key entries. Note rows report what the rest lost, and may leave when a value returns. */
const bodyText = (geometry: Geometry<object, object>) => new Map(geometry.scene.flatMap((node) => (
  node.t === 'text' && (node.id.startsWith('label:') || node.id.startsWith('frame:legendLabel')) ? [[node.id, node.lines.join('').replace(/\s+/g, '')] as const] : [])));
const cutIds = (geometry: Geometry<object, object>) => geometry.labels.filter((label) => !label.hidden && label.title !== undefined).map((label) => label.id);

type Drawn = LayoutResult<any, any>;
/** A layout's error lint refuses the chart as a refused layout does. */
const refuses = (drawn: Drawn) => drawn.refused === true || drawn.warnings.some((warning) => warning.severity === 'error');

/**
 * Whether a layout refuses, drops, rewords or newly cuts what the same chart
 * prints without a setting. A cut name that reads further in `drawn` is no loss.
 */
function losesText(drawn: Drawn, natural: Drawn): boolean {
  if (refuses(natural)) return false;
  if (refuses(drawn)) return true;
  const printed = bodyText(drawn as Geometry<object, object>);
  for (const [id, words] of bodyText(natural as Geometry<object, object>)) {
    const now = printed.get(id);
    if (now !== words && !(now !== undefined && words.endsWith('\u2026') && now.startsWith(words.slice(0, -1)))) return true;
  }
  const cut = new Set(cutIds(natural as Geometry<object, object>));
  return cutIds(drawn as Geometry<object, object>).some((id) => !cut.has(id));
}

const hidesLabel = (drawn: Drawn) => (drawn as Geometry<object, object>).labels.some((label) => label.hidden) || drawn.warnings.some((warning) => warning.code === 'label-hidden');

/** Which placed labels read a column's alignment: its head, and its cell text. */
export interface AlignReaders<D> { head: (id: string) => string; cell: (labelId: string, id: string, data: D) => boolean }

type ColumnSetting = { width?: number; align?: string; headAlign?: string };
type WidthOptions = { columnOverrides?: Readonly<Record<string, ColumnSetting | undefined>>; size?: { width?: number } };

/**
 * A column setting never costs text the chart prints without it. This wraps the
 * finished layout, so it compares the chart the registry really accepts, compact
 * step and all. A width that loses text gives way to the unset width, and a head
 * alignment that hides a head gives way too, each with a warning. A spec with no
 * settings runs one layout, one whose widths fit runs two, and head keys alone
 * run a second layout only when a head is hidden.
 */
export function yieldingWidths<D, O extends object, G extends LayoutResult<any, any>>(type: string, layout: (data: D, options?: O) => G, trackIds: (data: D) => readonly string[], readers: AlignReaders<D>): (data: D, options?: O) => G {
  return (data, options) => {
    const drawn = layout(data, options);
    const read = (options ?? {}) as WidthOptions;
    const overrides = read.columnOverrides;
    if (overrides === undefined || drawn.warnings.some((warning) => warning.code === 'invalid-options')) return drawn;
    const tracks = new Set(trackIds(data));
    const without = (widths: readonly string[], heads: readonly string[]) => ({
      ...read,
      columnOverrides: Object.fromEntries(Object.entries(overrides).map(([id, override]) => {
        const { width, align, headAlign, ...rest } = override ?? {};
        return [id, { ...rest,
          ...(width === undefined || widths.includes(id) ? {} : { width }),
          ...(align === undefined || heads.includes(id) ? {} : { align }),
          ...(headAlign === undefined || heads.includes(id) ? {} : { headAlign }) }];
      })),
    }) as unknown as O;
    let result = drawn;
    const warnings: LintWarning[] = [];
    const widthIds = Object.keys(overrides).filter((id) => overrides[id]?.width !== undefined && (id === 'label' || tracks.has(id)));
    const gone: string[] = [];
    const natural = widthIds.length > 0 ? layout(data, without(widthIds, [])) : drawn;
    if (losesText(drawn, natural)) {
      for (const id of widthIds) {
        gone.push(id);
        result = layout(data, without(gone, []));
        if (!losesText(result, natural)) break;
      }
      // An equal share stands for the unset width, which no layout reports.
      const share = (read.size?.width ?? 720) / (tracks.size + 1);
      for (const id of gone) warnings.push(overrides[id]!.width! < share ? widthFloored(type, id) : widthCapped(type, id));
    }
    const headIds = Object.keys(overrides).filter((id) => tracks.has(id) && (overrides[id]?.headAlign !== undefined || overrides[id]?.align !== undefined));
    if (headIds.length > 0 && !refuses(result) && hidesLabel(result)) {
      const plainHeads = layout(data, without(gone, headIds));
      if (losesText(result, plainHeads)) {
        const stripped: string[] = [];
        for (const id of headIds) {
          stripped.push(id);
          result = layout(data, without(gone, stripped));
          for (const key of ['headAlign', 'align'] as const) if (overrides[id]?.[key] !== undefined) warnings.push(overrideIgnored(id, key, 'at this size it would hide a head'));
          if (!losesText(result, plainHeads)) break;
        }
      }
    }
    // A thinned, left-out or textless column has no reader at this size, whatever the key says.
    if (headIds.length > 0 && !refuses(result)) {
      const placed = (result as Geometry<object, object>).labels.filter((label) => !label.hidden).map((label) => label.id);
      const known = new Set([...result.warnings, ...warnings].map((warning) => `${warning.code}:${(warning.field ?? []).join('.')}`));
      const silent = (id: string, key: 'align' | 'headAlign') => {
        if (!known.has(`option-ignored:options.columnOverrides.${id}.${key}`)) warnings.push(overrideIgnored(id, key, 'this column prints no text that reads it at this size'));
      };
      for (const id of headIds) {
        const override = overrides[id]!;
        const head = placed.includes(readers.head(id));
        const cell = placed.some((label) => readers.cell(label, id, data));
        if (override.headAlign !== undefined && !head) silent(id, 'headAlign');
        if (override.align !== undefined && !cell && (!head || override.headAlign !== undefined)) silent(id, 'align');
      }
    }
    return warnings.length === 0 ? result : { ...result, warnings: [...result.warnings, ...warnings] } as G;
  };
}

/**
 * The row-name track prints no head, so a head text or head alignment on it has
 * no reader. A real column with the id `label` has a head and keeps both. This
 * path has no zod, so it refuses in React too.
 */
export function nameTrackRefusals(overrides: Readonly<Record<string, { label?: string; headAlign?: string } | undefined>> | undefined, columnIds: readonly string[]): LintWarning[] {
  if (overrides?.label === undefined || columnIds.includes('label')) return [];
  return (['label', 'headAlign'] as const).flatMap((key) => (overrides.label![key] === undefined ? [] : [{
    code: 'invalid-options', severity: 'error' as const, field: ['options', 'columnOverrides', 'label', key],
    message: `columnOverrides.label.${key} has no head to set: the row names print no head`,
    suggest: `Remove columnOverrides.label.${key}.`,
    fix: [{ op: 'remove' as const, path: `/options/columnOverrides/label/${key}` }],
  }]));
}
