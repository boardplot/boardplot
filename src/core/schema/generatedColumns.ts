/**
 * The ids of the columns, blocks and rows a chart type generates itself: the
 * ones an author cannot name in `data`. The option builders beside this file
 * print these lists in the reference, and `generatedIdWarnings` prints them
 * when an id is wrong. This module stays free of zod, because layouts import it.
 *
 * Naming rule: the name column is `label`, the marks are `plot`, every other
 * column is its head word in lowerCamel. A type with no generated columns has
 * no entry. The generic `table` has none: `data.columns[]` authors its columns.
 */
import type { LintWarning } from '../types/scene';

export interface GeneratedIds {
  /** The ids `columnVisibility` takes. */
  columns: readonly string[];
  /** The ids `columnOverrides` takes, where they differ from `columns`. */
  tracks?: readonly string[];
  /** The ids `columnOrder` takes: whole blocks, never single columns. */
  blocks: readonly string[];
  /** The ids `rowVisibility`, `rowOrder` and `rowOverrides` take. */
  rows: readonly string[];
  /** The column ids that come from the data, in words. */
  columnsFromData?: string;
  /** The row ids that come from the data, in words. */
  rowsFromData?: string;
}

export const GENERATED_COLUMNS = {
  // bar/layout.ts:1087 caps the name band.
  bar: { columns: ['label'], blocks: [], rows: [] },
  // bartable/layout.ts places the name track, then the number tracks and the panels in columnOrder.
  bartable: { columns: ['label'], columnsFromData: 'each data.columns id and each data.panels id', blocks: ['numbers', 'panels'], rows: [] },
  // box/layout.ts:528 is the name band and :579 the median band. `n` prints the sample sizes.
  box: { columns: ['label', 'n', 'median'], blocks: [], rows: [] },
  // bullet/targetScale.ts:235 lists the columns under percentOfTarget and targetColumns.
  bullet: { columns: ['label', 'actual', 'share', 'delta', 'target', 'gap'], blocks: ['actual', 'share', 'delta', 'target', 'gap', 'plot'], rows: [] },
  // butterfly/layout.ts:443 is the difference track. The centre column holds the names.
  butterfly: { columns: ['label', 'diff'], blocks: [], rows: [] },
  // choropleth/smallMembers.ts:581 draws the lookup value. Region ids go through the pack's aliases.
  choropleth: { columns: ['swatch', 'code', 'value'], blocks: [], rows: [], rowsFromData: 'each region id, through the aliases of the map pack' },
  // cohort/exhibit.ts:406 plans the tracks and :761 draws the period heads. Periods stay on visiblePeriods.
  cohort: { columns: ['size'], tracks: ['label', 'size', 'periods'], blocks: ['size', 'periods'], rows: [] },
  // creative/layout.ts:191 sets the label track, and the value, median and delta right edges follow it.
  creative: { columns: ['label', 'value', 'median', 'delta'], blocks: ['label', 'value', 'median', 'delta'], rows: ['ctr', 'cpa', 'roas', 'hookRate', 'holdRate', 'frequency'] },
  // diagram/architecture.ts:157 sizes the inset and :192 splits its rows. The keys live under data.inset.
  diagram: { columns: ['label', 'value'], blocks: [], rows: [] },
  // dimswitch/compile.ts:749 lists the columns.
  dimswitch: {
    columns: ['label', 'range', 'pp', 'pl'], columnsFromData: 'each displayed period id', blocks: ['block', 'periods'], rows: [],
    rowsFromData: 'dimension.total.id, group:<measures[].group as authored>, and group: for the ungrouped section',
  },
  // dot/layout.ts:520 is the head of the gap column.
  dot: { columns: ['label', 'gap'], blocks: [], rows: [] },
  // funnel/rowsText.ts:84 sizes the callout track and funnel/centered.ts:340 heads the cumulative column.
  funnel: { columns: ['label', 'value', 'totalCvr'], blocks: [], rows: [] },
  // gantt/plot.ts:374 plans the metadata columns.
  gantt: { columns: ['name', 'meta0', 'meta1', 'meta2'], blocks: ['meta', 'plot'], rows: [] },
  // grid/metricStackLayout.ts:108 sizes the one track, and :389 seats the parts in it.
  grid: { columns: ['unit', 'headline', 'span'], tracks: ['gutter'], blocks: ['gutter', 'plot'], rows: [] },
  // heatmap/layout.ts places the name band and one width per column. An id that the turned form has no column for warns.
  heatmap: { columns: ['label'], columnsFromData: 'each data.categories id', blocks: [], rows: [] },
  // kpi/steering.ts:133 measures the comparison values and :237 seats them.
  kpi: { columns: ['label', 'value'], blocks: [], rows: [] },
  // likert/layout.ts:833 is the base column, and :1098 and :1127 draw the net and base columns.
  likert: { columns: ['label', 'net', 'base'], blocks: ['plot', 'net', 'base'], rows: [] },
  // pvm/layout.ts:123 builds the bridge that waterfall/layout.ts:404 draws.
  pvm: { columns: ['label', 'value'], blocks: [], rows: [] },
  // butterfly/layout.ts:615 places the bands of the pyramid's host.
  pyramid: { columns: ['label'], blocks: [], rows: [] },
  // sankey/layout.ts:186 sizes the gutters of the first and the last stage.
  sankey: { columns: ['first', 'last'], blocks: [], rows: [] },
  // slope/layout.ts:402 is the change column.
  slope: { columns: ['change'], blocks: [], rows: [] },
  // status/layout.ts places the name band and one width per column.
  status: { columns: ['label'], columnsFromData: 'each data.columns id', blocks: [], rows: [] },
  // waterfall/layout.ts:379 is the name band and :404 the value reserve of the horizontal form.
  waterfall: { columns: ['label', 'value'], blocks: [], rows: [] },
} as const satisfies Record<string, GeneratedIds>;

/** One entry of `columnOverrides`: the fields a type reads are in its schema. */
export interface ColumnOverride {
  width?: number;
  align?: 'left' | 'right' | 'center';
  headAlign?: 'left' | 'right' | 'center';
  label?: string;
}

export type GeneratedColumnType = keyof typeof GENERATED_COLUMNS;

export type GeneratedIdKey = 'columnVisibility' | 'columnOverrides' | 'columnOrder' | 'rowVisibility' | 'rowOrder' | 'rowOverrides';

/** A name column stays: the marks need a name. Hiding one warns and does nothing. */
const NAME_COLUMNS: ReadonlySet<string> = new Set(['label', 'name', 'code']);

/** The ids one key takes on one type, with the ids from the data in words: 'label, range, or each displayed period id'. */
export function generatedIdList(type: GeneratedColumnType, key: GeneratedIdKey): string {
  const ids: GeneratedIds = GENERATED_COLUMNS[type];
  const rowKey = key === 'rowVisibility' || key === 'rowOrder' || key === 'rowOverrides';
  const listed = key === 'columnOrder' ? ids.blocks : rowKey ? ids.rows : key === 'columnOverrides' ? ids.tracks ?? ids.columns : ids.columns;
  const words = key === 'columnOrder' ? undefined : rowKey ? ids.rowsFromData : ids.columnsFromData;
  return [...listed, ...(words === undefined ? [] : [words])].join(', ');
}

/**
 * What a generated-id key warns on one draw. `authored` is the key's value: a
 * record, or a list for an order. `drawn` holds the ids the current form draws.
 * A wrong id warns with the type's list and never refuses, and a hidden name
 * column warns and stays. The caller ignores every id this returns a warning for.
 */
export function generatedIdWarnings(type: GeneratedColumnType, key: GeneratedIdKey, authored: readonly string[] | Readonly<Record<string, unknown>> | undefined, drawn: readonly string[]): LintWarning[] {
  if (authored === undefined) return [];
  const ids = Array.isArray(authored) ? authored as readonly string[]
    : Object.entries(authored).filter(([, value]) => key !== 'columnVisibility' && key !== 'rowVisibility' || value === false).map(([id]) => id);
  const list = generatedIdList(type, key);
  return ids.flatMap((id, index): LintWarning[] => {
    const shown = drawn.includes(id);
    if (key === 'columnVisibility' && shown && NAME_COLUMNS.has(id)) {
      return [{ code: 'generated-name-column-kept', severity: 'warn', field: ['options', key, id],
        message: `${key} cannot hide '${id}': the marks need a name, so the column stays`, suggest: `Remove '${id}' from ${key}.` }];
    }
    if (shown) return [];
    // A list takes its position in the field path: a warning's path resolves against the spec.
    return [{ code: 'generated-id-unknown', severity: 'warn', field: ['options', key, Array.isArray(authored) ? index : id],
      message: `${key} names '${id}', which this ${type} does not draw, so nothing changed. Its ids: ${list}`, suggest: `Use one of: ${list}.` }];
  });
}
