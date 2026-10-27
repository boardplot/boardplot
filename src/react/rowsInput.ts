/**
 * The `rows` and `columns` props of the chart components: SQL-shaped rows
 * become the chart's data through the one rows transform (`core/rows`, the
 * transform `specFromRows` and the CLI's `rows` run). The transform is its own
 * chunk (`./rowsModule`), fetched the first time a chart gets rows; a chart
 * without rows reads none of this and fetches nothing.
 *
 * The server holds nothing here, whatever its process imported: the server
 * pass and the pass that hydrates it both read "not loaded", so their markup
 * agrees. A `prepared` snapshot carries the data the server mapped, keyed by
 * the type, template, rows and columns it was mapped from, and the chart
 * draws from it until the chunk lands.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { RowsColumns, RowsReading } from '../rows';
import type { RefusalFinding } from '../core/schema/refusals';
import type { LintWarning } from '../core/types/scene';
import { loadedModule, loadFailure, loadRowsModule, rowsKey, subscribe, type MappedRows, type PreparedRows, type RowsRefusal } from './rowsStore';
import { freezeValue, useStableValue } from './useStableValue';

export type { RowsColumns, RowsReading } from '../rows';
export type { MappedRows, PreparedRows, RowsRefusal } from './rowsStore';

const nothingLoaded = () => undefined;

/** The props every chart component takes for rows. */
export interface RowsProps {
  /**
   * SQL-shaped rows, one object per row, that become the chart's data
   * through `columns`, as `specFromRows` and `rows` in `boardplot_render`
   * map them. `data` is then the template: a category or series it names
   * keeps its label and colour role.
   */
  rows?: readonly Record<string, unknown>[];
  /** Which source column holds each role, such as `{ category: 'month', series: 'channel', value: 'revenue' }`. */
  columns?: RowsColumns;
  /** The reading of the rows (row count, columns no role names, suppressed cells), once per distinct reading. */
  onRowsReading?: (reading: RowsReading) => void;
}

export interface RowsInput<D> {
  /** The data to draw: the mapped data, the authored data without rows, undefined while waiting or refused. */
  data: D | undefined;
  /** BoardplotChart: the spec with the mapped data. */
  spec?: Record<string, unknown>;
  /** The rows chunk is loading. */
  waiting: boolean;
  /** Why the rows chunk did not load. */
  failure?: string;
  /** The refused mapping, as the chart card shows it. */
  refusals: RefusalFinding[];
  /** The refused mapping as the InputError gave it, for the spec error card. */
  refusal?: RowsRefusal;
  /** Moves findings at a mapped data path (`/data/series/0/values/2`) to the rows field they came from; absent when nothing moves. */
  rewrite?: <T extends { path?: string; displayPath?: string; fix?: { path: string }[] }>(findings: T[]) => T[];
  /** The same for layout warnings, whose `field` holds the path. */
  rewriteWarnings?: (warnings: LintWarning[]) => LintWarning[];
}

const NO_REFUSALS: RefusalFinding[] = [];

/**
 * The chart's data from `rows` and `columns`, or `spec.data` as authored when
 * the host passes neither. `spec` is what the transform reads besides the
 * rows: the chart type and the template data, or BoardplotChart's whole spec.
 */
export function useRowsInput<D>(spec: { type?: unknown; data?: unknown } | null | undefined, props: RowsProps, prepared?: { rows?: PreparedRows }): RowsInput<D> {
  const { rows, columns, onRowsReading } = props;
  const active = rows !== undefined || columns !== undefined;
  const module = useSyncExternalStore(subscribe, loadedModule, nothingLoaded);
  const loadFailed = useSyncExternalStore(subscribe, loadFailure, nothingLoaded);
  // No dependency list: a render that still lacks the chunk asks again, so a failed load is tried a second time.
  useEffect(() => {
    if (active && !loadedModule()) loadRowsModule();
  });
  // By content: rows, columns and a template written inline are new objects on every render.
  const stableSpec = useStableValue(active ? spec : undefined);
  const stableRows = useStableValue(rows);
  const stableColumns = useStableValue(columns);
  const bridge = active && !module ? prepared?.rows : undefined;
  const bridged = useMemo(() => bridge !== undefined && bridge.key === rowsKey(stableSpec ?? {}, stableRows, stableColumns), [bridge, stableSpec, stableRows, stableColumns]);
  const mapped = useMemo((): MappedRows | undefined => {
    if (!active) return undefined;
    // The snapshot's data stays the host's: it is not frozen. The chunk's result is this chart's own copy.
    if (!module) return bridged ? { spec: { ...stableSpec, data: bridge!.data }, reading: bridge!.reading } : undefined;
    const result = module.mapRows(stableSpec, stableColumns, stableRows);
    return result.spec ? { ...result, spec: freezeValue(result.spec) } : result;
  }, [active, module, bridged, stableSpec, stableRows, stableColumns]);
  // After commit, once per distinct reading, as onNotes reports the notes; a remount reports it again.
  const listener = useRef(onRowsReading);
  listener.current = onRowsReading;
  const reported = useRef<string | undefined>(undefined);
  const reading = mapped?.reading;
  useEffect(() => {
    if (!reading) return;
    const key = JSON.stringify(reading);
    if (reported.current === key) return;
    reported.current = key;
    listener.current?.(reading);
  }, [reading]);
  const pathMap = mapped?.pathMap;
  const rewrite = useMemo(() => (module && pathMap
    ? <T extends { path?: string; displayPath?: string; fix?: { path: string }[] }>(findings: T[]) => module.rewriteRowsDiagnostics(findings, pathMap)
    : undefined), [module, pathMap]);
  const rewriteWarnings = useMemo(() => (module && pathMap ? (warnings: LintWarning[]) => module.rewriteWarningFields(warnings, pathMap) : undefined), [module, pathMap]);
  const refusal = mapped?.refusal;
  if (!active) return { data: spec?.data as D, waiting: false, refusals: NO_REFUSALS };
  return {
    data: mapped?.spec?.data as D | undefined,
    ...(mapped?.spec ? { spec: mapped.spec } : {}),
    waiting: mapped === undefined && loadFailed === undefined,
    ...(mapped === undefined && loadFailed !== undefined ? { failure: loadFailed } : {}),
    refusals: mapped?.refusals ?? NO_REFUSALS,
    ...(refusal ? { refusal } : {}),
    ...(rewrite ? { rewrite } : {}),
    ...(rewriteWarnings ? { rewriteWarnings } : {}),
  };
}
