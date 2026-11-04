/**
 * Authored column widths of a matrix (heatmap, status, and the warnings a bar
 * table shares). One cell width becomes one width per column only when an
 * author sets one, so a spec without `columnOverrides` keeps its arithmetic.
 */
import type { Geometry, LintWarning } from '../../types/scene';

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

/** The labels the chart hid or cut. A label's title holds the full text of a cut one. */
const textLost = (geometry: Geometry<any, any>) => (geometry.refused ? Infinity : geometry.labels.filter((label) => label.hidden || label.title !== undefined).length);

type WidthOptions = { columnOverrides?: Readonly<Record<string, { width?: number } | undefined>>; size?: { width?: number } };

/**
 * An authored width never costs what the chart draws without it: a width that
 * refuses, cuts or hides text gives way to the unset width and warns. It changes
 * how many lines the names take, so only a drawn layout can tell. A spec with no
 * width runs one layout.
 */
export function yieldingWidths<D, O extends object, G extends Geometry<any, any>>(type: string, layout: (data: D, options?: O) => G, trackCount: (data: D) => number): (data: D, options?: O) => G {
  return (data, options) => {
    const drawn = layout(data, options);
    const read = (options ?? {}) as WidthOptions;
    const overrides = read.columnOverrides ?? {};
    const ids = Object.keys(overrides).filter((id) => overrides[id]?.width !== undefined);
    if (ids.length === 0) return drawn;
    const without = (gone: readonly string[]) => ({
      ...read,
      columnOverrides: Object.fromEntries(Object.entries(overrides).map(([id, override]) => {
        if (!gone.includes(id)) return [id, override];
        const { width: _width, ...rest } = override!;
        return [id, rest];
      })),
    }) as O;
    const natural = textLost(layout(data, without(ids)));
    if (textLost(drawn) <= natural) return drawn;
    const gone: string[] = [];
    let result = drawn;
    for (const id of ids) {
      gone.push(id);
      result = layout(data, without(gone));
      if (textLost(result) <= natural) break;
    }
    // An equal share stands for the unset width, which no layout reports.
    const share = (read.size?.width ?? 720) / Math.max(1, trackCount(data));
    return { ...result, warnings: [...result.warnings, ...gone.map((id) => (overrides[id]!.width! < share ? widthFloored(type, id) : widthCapped(type, id)))] };
  };
}
