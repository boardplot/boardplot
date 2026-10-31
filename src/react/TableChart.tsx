import { hasPolarityBadge, isFigureCell, polarityBadgeInk } from '../core/charts/table/chips';
import { belowTableViewportFloor, tableWidths } from '../core/charts/table/widths';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent, type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { useIsomorphicLayoutEffect as useLayoutEffect } from './useIsomorphicLayoutEffect';
import { resolveCanvasOptions, resolveSize } from '../core/normalize/shared';
import { canvasMargin } from '../core/theme';
import { measureResolvedRequest, resolveChartRequest, type ResolvedChartRequest } from '../core/request';
import { asFirstFrame, DeferredCoreError, type DeferredName } from '../core/deferred';
import { useDeferredModule, useDeferredRevision } from './deferredCore';
import { useResolvedChartRequest } from './useResolvedChartRequest';
import { usePrinting, watchPrint } from './printLayout';
import { rebindable } from './linkedBinding';
import { useExportLink, type DrawnChart, type ExportLink } from './exportLink';
import { checkedIdPrefix, IdPrefixContext, useScopedId } from './idPrefix';
import { frameSize, RefusalBoundary } from './RefusalBoundary';
import { LayoutRefusal, LoadingPlaceholder, SizePlaceholder, type RefusalProps } from './SizePlaceholder';
import { chartRefusals, isSizeDependentRefusal, optionRefusals, refusalFindings } from '../core/schema/refusals';
import { useRefusalSettle } from './useRefusalSettle';
import type { OptionKeyCheck } from '../core/schema/unknownKeys';
import { publishTableChart } from './specHandover';
import { registeredType } from './chartEntry';
import { tableCore } from '../core/charts/table/core';
import { tableCellNodeId } from '../core/charts/table/cellKey';
import { columnHeadLabel, columnHeaderAffix, resolveTable } from '../core/charts/table/resolve';
import {
  cellDrawsTabular,
  collapsedByDefault,
  expansionForFolds,
  expansionRootsHidden,
  groupSpans,
  heatColumn,
  inCellBarMaxima,
  numericCell,
  printsFigures,
  hasNoDataRows,
  emptyMessageRow,
  finalClosers,
  rowGrounds,
  sortRows,
  sortableColumnIds,
  treeChildCounts,
  visibleColumns,
  visibleInlineRows,
  visibleRows,
  type TableSort,
} from '../core/charts/table/view';
import { levelLadder } from '../core/charts/table/ladder';
import { presetLanguage } from '../core/charts/table/presets';
import {
  browserSlack,
  cellPadX as trackCellPadX,
  kindFont,
  pinnedColumns,
  changeLineFitFont,
  rowFont as ladderRowFont,
  tableFonts,
  trackTemplate,
  trackTotal,
  ENGINE_NOTES,
  SOFT_LABEL_CAP,
  LABEL_WRAP_FLOOR,
  type TableFonts,
} from '../core/charts/table/tracks';
import { DEFAULT_EMPTY_MESSAGE } from '../core/emptyData';
import { fitTableFormats, formatsFittedWarning, type FormatFitChange } from '../core/charts/table/fitFormats';
import { emitSparkline, sparklineDomains, sparklineSourceValues } from '../core/charts/table/encodings/sparkline';
import { arrowGlyph, arrowKey, printedNumber, type ArrowKeyEntry } from '../core/charts/table/encodings/arrow';
import { badSide, heatKey, heatPaint, heatRanges, type HeatKeyEntry, type HeatRange } from '../core/charts/table/encodings/heat';
import { heatEncodingRefusals } from '../core/charts/table/encodings/heatOptions';
import { lastObservedIndex, type SparklineDomain } from '../core/charts/sparkline/layout';
import { resolvePaint } from '../core/svg/paint';
import { sceneAttributes } from './sceneAttributes';
import type { LintWarning, Paint, RefusedLayout, SceneNode } from '../core/types/scene';
import { defaultMeasurer, splitNameBreaks, type FontSpec, type TextMeasurer } from '../core/text';
import type { Id } from '../core/types/cell';
import type {
  ResolvedCell,
  ResolvedColumn,
  ResolvedRow,
  ResolvedTable,
  StickyLabels,
  TableData,
  TableOptions,
} from '../core/types/table';
import { stickySettings } from '../core/charts/table/sticky';
// Both table renderers share subtitles, source lines and note disclosure.
import { insetTint, tableFrame, tableGroundTextStyle, tablePresentation, tableRenderTheme, tableStylesheet } from './tablePresentation';
import { useStableValue } from './useStableValue';
import { PROBE_STYLE, useContainerSize, type ContainerSizeOptions } from './useContainerSize';
import { useDisplayWarnings } from './useDisplayWarnings';
import { usePrepared } from './usePrepared';
import type { PreparedTable } from './preparedTable';
import { useRowsGate } from './rowsGate';
import type { RowsProps } from './rowsInput';
import type { InteractionScope } from '../core/a11y/types';
import type { RenderTarget } from '../core/types/options';
import type { Theme, ThemeRef } from '../core/types/theme';
import type { ChartRequest } from '../core/request';
import { TableHoverFrame } from './hover/TableHoverFrame';
import { hoverFlags, type HoverOption } from './useHover';
import { useTableGridNavigation, type TableGridFocus } from './tableGrid';
import { textScaleOf } from '../core/typeFloors';
import { markScrollRegion, scrollStateOf, type TableScrollState } from './scrollState';

export type { TableScrollState } from './scrollState';

/**
 * The authored sibling order (`options.sort`, resolved once in the core) and
 * the reader's column sort share one prop name, because to a host they are
 * one question: in which order do the rows come out. The shapes say which is
 * meant — a column sort names a column, an authored order names `categories`.
 */
type TableSortProp = TableSort | TableOptions['sort'] | null;

/** From this many columns on, the grid builds only the columns near its scroll viewport, so a table of hundreds of day columns stays responsive. */
const WINDOW_COLUMNS = 40;
/** Full cells enter the window in small blocks, so scrolling only replaces nearby columns. */
const WINDOW_BLOCK = 8;
const ROW_PAGE = 64;
// Larger text-only runs need fewer React wrappers without widening the full-cell window.
const LITE_BLOCK = 32;

function isColumnSort(value: TableSortProp | undefined): value is TableSort {
  return typeof value === 'object' && value !== null && 'column' in value;
}


/** What `onRowSelect` hands a host besides the row id. */
export interface TableRowSelectDetail {
  row: ResolvedRow;
  /** The click, or the Enter or Space on the row's focused cell. */
  event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
  /**
   * The column of the cell the reader clicked, or of the focused cell the
   * key was pressed on, so a host can run one cell's action from
   * that cell alone. Undefined on the empty track `rowExtent: 'frame'` adds.
   */
  columnId?: Id;
}

/** The column of the cell an event landed in, inside this row's element. */
function eventColumn(event: { target: EventTarget; currentTarget: Element }): Id | undefined {
  const cell = event.target instanceof Element ? event.target.closest('[data-bp-column]') : null;
  return cell !== null && event.currentTarget.contains(cell) ? cell.getAttribute('data-bp-column') ?? undefined : undefined;
}


/** What `handleRef` hands a host: the scroller, read and driven without selectors. */
export interface TableHandle {
  /** The scroll state now. */
  scrollState(): TableScrollState;
  /** Scroll so this column starts where the pinned columns end. */
  scrollToColumn(columnId: Id, behavior?: ScrollBehavior): void;
  /** Scroll to a horizontal offset in px. */
  scrollTo(left: number, behavior?: ScrollBehavior): void;
}

/** A glyph before each row label, and the room it takes. */
export interface TableRowLabelLead {
  /** px the lead takes before the label text, its gap included. */
  width: number;
  /** The glyph for one row; null or undefined draws none. */
  render: (row: ResolvedRow) => ReactNode;
}

export type TableChartProps = Omit<TableOptions, 'columnVisibility' | 'inlineVisibility' | 'size' | 'sort'> & ContainerSizeOptions & RefusalProps & RowsProps & {
  data: TableData;
  /** Explicit target wins over the provider. Defaults to report. */
  target?: RenderTarget;
  /** Canonical findings and observed display findings, once per warning state. */
  onWarnings?: (warnings: LintWarning[]) => void;
  /** The handle from `useExport()` (`boardplot/react/export`): it exports this table as drawn, at its width on screen. */
  exporter?: ExportLink;
  prepared?: PreparedTable;
  scope?: InteractionScope;
  fontMetrics?: ChartRequest['fontMetrics'];
  /** CSP nonce for the server and client table style elements. */
  styleNonce?: string;
  /** Prepended to every id the table writes; one per separately rendered React root (see the chart components). */
  idPrefix?: string;
  collapsed?: Id[];
  defaultCollapsed?: Id[];
  onCollapsedChange?: (ids: Id[]) => void;
  /**
   * Called after the reader folds or opens a row, with the view as an
   * `options.expansion`: the authored one, its `collapsed` and `expanded`
   * lists rewritten to hold the reader's folds. A depth control shows no
   * depth pressed while the lists differ from the ones it wrote. Stored in
   * `options.expansion`, it keeps the view; a later change of
   * `options.expansion` resets the folds to what the new value says.
   */
  onExpansionChange?: (expansion: NonNullable<TableOptions['expansion']>) => void;
  columnVisibility?: Record<Id, boolean>;
  defaultColumnVisibility?: Record<Id, boolean>;
  onColumnVisibilityChange?: (visibility: Record<Id, boolean>) => void;
  /** Which inline-line groups are printed, keyed by `inlineGroup`. */
  inlineVisibility?: Record<Id, boolean>;
  defaultInlineVisibility?: Record<Id, boolean>;
  onInlineVisibilityChange?: (visibility: Record<Id, boolean>) => void;
  /**
   * Which columns carry a sort control: `true` is every value, computed,
   * date and text column, a list names them. Off by default — a table the
   * host does not want reordered keeps plain headers.
   */
  sortable?: boolean | Id[];
  /** The active column sort, controlled; `null` is the authored order. */
  sort?: TableSortProp;
  defaultSort?: TableSort | null;
  onSortChange?: (next: TableSort | null) => void;
  /**
   * Hide the level-0 data rows and keep the totals;
   * `depthToExpansion(table, 0)`. Omitted, the authored
   * `options.expansion.rootsHidden` decides, so a spec that names the step
   * draws the same rows on both surfaces.
   */
  rootsHidden?: boolean;
  /**
   * Where the column widths come from. `'browser'` (the default) asks the
   * browser itself, through `CanvasRenderingContext2D.measureText` in the
   * resolved face, and takes the wider of that and the shipped width table;
   * `'tables'` keeps the shipped metrics plus the weight-600 slack. The SVG
   * always measures from the tables, so it stays deterministic.
   *
   * Named `measureWidths` and not `measure`: `options.measure` is already
   * the injected text measurer a host may hand any chart, and the table
   * props carry the shared options.
   */
  measureWidths?: 'browser' | 'tables';
  /**
   * Pin the head and leading columns. `true` pins one column and a number
   * pins that many, with the head pinned in the table's own scroll box. The
   * object form `{ head, columns, top, sections }` also pins the head to the
   * page scroll (`head: 'page'`, `top` px below the page top) and keeps the
   * active section label under the head (`sections: true`). Page mode is
   * refused with `fillHeight`.
   */
  stickyLabels?: StickyLabels;
  /** Draw the column-group segmented control above the table. On by default. */
  toolbar?: boolean;
  /** Label card for the hovered cell and a highlight of it. Off by default. */
  hover?: HoverOption;
  /**
   * Called with the scroll state of the table's own scroller on mount, on
   * every scroll, and when the container or the tracks change width.
   */
  onScrollChange?: (state: TableScrollState) => void;
  /** Receives a `TableHandle` for the table's scroller. */
  handleRef?: Ref<TableHandle>;
  /**
   * Called with the width the table needs to show every column without
   * scrolling: its tracks, the spacer tracks and the frame margins. A card
   * that sizes itself to its table reads it instead of measuring the grid.
   */
  onContentWidth?: (width: number) => void;
  /**
   * Fill the parent's height: the figure becomes a column as tall as its
   * parent and the scroller takes the height left, scrolling both ways. The
   * host gives the parent a height; `stickyLabels` keeps the head and the
   * label column in place.
   */
  fillHeight?: boolean;
  /** A glyph before each row label, a channel mark for one. */
  rowLabelLead?: TableRowLabelLead;
  /**
   * Where the hover card renders. Absent or null: a portal at the end of
   * `document.body`, so a glass or clipping ancestor neither traps nor cuts
   * it. An element: a portal into it, such as an open dialog's panel, whose
   * stacking context the card then shares. false: inside the table's frame.
   */
  portalContainer?: HTMLElement | null | false;
  /**
   * Called when the reader picks a row: a click anywhere in it outside a
   * link or a button, or Enter or Space on its focused cell. Section
   * headings take none. A parent row the reader may fold folds on the same
   * click; Enter on its label cell folds it and selects nothing. With the
   * prop set, body rows show a pointer.
   */
  onRowSelect?: (rowId: Id, detail: TableRowSelectDetail) => void;
  /**
   * Which rows `onRowSelect` covers. A row it answers false for
   * takes no click and no key for the pick, shows no pointer and carries no
   * `data-bp-selectable`; a parent still folds. Absent, every row but a
   * section heading is selectable. The second argument is the live fold
   * state: `collapsed` is true while the row is folded shut.
   */
  isRowSelectable?: (row: ResolvedRow, state: { collapsed: boolean }) => boolean;
  /**
   * false: clicks and keys select, sort and fold nothing, for a host mode
   * such as annotation, where the host handles the click. The rows keep
   * their fold state and draw their fold marks as marks; hover stays.
   */
  interactions?: boolean;
  /**
   * Called with the formats `options.fitFormats` shortened to fit authored widths: each change names a row, a column or a
   * cell, the example it printed through before (`from`, absent where it was derived) and the example now (`to`). Called
   * when the list changes, and an empty list when a table that was fitted no longer is. The layout reports the same list
   * as the `table-formats-fitted` info warning.
   */
  onFormatsFit?: (changes: FormatFitChange[]) => void;
  /**
   * Called once when the table has no data row after filtering (no row but section headings and totals, or no row at all).
   * The head stays and one row says `strings.emptyMessage` (default "No data to show."), so the host does not show an empty
   * box. It is called again if the table fills and empties again. `canDraw(request)` answers `empty-data` for the same case,
   * for a host that hides the card before it renders.
   */
  onEmpty?: () => void;
};

interface StyleEntry {
  count: number;
  element: HTMLStyleElement;
}

/** Per document or shadow root: a style in `document.head` does not reach into a shadow tree. */
const styleRegistry = new WeakMap<Node, Map<string, StyleEntry>>();
/** The cell a heat-only grid draws: ground alone, 22 px wide. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|#)/i;

function encodeStructuralIds(ids: readonly Id[]): string {
  return `${ids.length}:${ids.map((id) => `${id.length}:${id}`).join('')}`;
}

/** The uncompiled request whose floor the HTML table must report. Internal to DimSwitch. */
export const TableFloorRequestContext = createContext<{ request: ChartRequest; options: TableOptions } | undefined>(undefined);

/** One canvas and one width cache for every table on the page; a font swap clears the cache. */
let measureContext: CanvasRenderingContext2D | undefined;
const measuredWidths = new Map<string, number>();
const measuredDigits = new Map<string, number[]>();
const noSubscription = () => () => {};

/**
 * The browser's own width for a string, in the face the table resolved:
 * family from the theme, size and weight from the ladder. A canvas measures
 * what the browser will draw, kerning and hinting included, where the
 * shipped width tables can only estimate it, and a grid track is a hard
 * width, so a figure the estimate undersold met an ellipsis ("17,5…" in a
 * Total row). Returns undefined where there is no canvas to ask:
 * jsdom, SSR, a locked-down document.
 */
function canvasTextWidth(): ((text: string, font: FontSpec) => number) | undefined {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return undefined;
  if ((document as Document & { fonts?: unknown }).fonts === undefined) return undefined;
  try {
    measureContext ??= document.createElement('canvas').getContext('2d') ?? undefined;
  } catch {
    return undefined;
  }
  const context = measureContext;
  if (context === undefined || typeof context.measureText !== 'function') return undefined;
  const cache = measuredWidths;
  const digits = measuredDigits;
  // shortcut: cleared whole at a cap, an LRU if a page cycles through more strings than that.
  if (cache.size > 50_000) cache.clear();
  return (text, font) => {
    const face = `${font.weight ?? 400} ${font.size}px ${font.family ?? 'sans-serif'}`;
    const key = `${face}\u0000${font.letterSpacing ?? 0}\u0000${font.tabular === true}\u0000${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    context.font = face;
    // The measurer counts the VISIBLE width, so tracking pays for the gaps
    // between glyphs and not for a trailing advance (core/text).
    let width = context.measureText(text).width
      + (font.letterSpacing ?? 0) * Math.max(0, text.length - 1);
    // A canvas has no `font-variant-numeric`, so it measures the face's
    // default digits. Where the grid draws the string with tabular figures
    // (`.bp-figures`), the width pass asks with `tabular`, and every digit
    // counts at the face's widest digit, which stands in for the tabular
    // advance the canvas cannot ask for, as the shipped tables count it.
    if (font.tabular === true && /[0-9]/.test(text)) {
      let advances = digits.get(face);
      if (advances === undefined) {
        advances = [...'0123456789'].map((digit) => context.measureText(digit).width);
        digits.set(face, advances);
      }
      const widest = Math.max(...advances);
      for (const character of text) {
        if (character >= '0' && character <= '9') width += widest - advances[character.charCodeAt(0) - 48]!;
      }
    }
    cache.set(key, width);
    return width;
  };
}

/** Whether the canvas now measures any of up to 64 cached strings, spread over the cache, differently. */
function canvasWidthsMoved(): boolean {
  const context = measureContext;
  if (context === undefined || measuredWidths.size === 0) return true;
  const step = Math.max(1, Math.floor(measuredWidths.size / 64));
  let index = 0;
  for (const [key, width] of measuredWidths) {
    if (index++ % step !== 0) continue;
    const [face, spacing, tabular, text] = key.split('\u0000') as [string, string, string, string];
    context.font = face;
    let fresh = context.measureText(text).width + Number(spacing) * Math.max(0, text.length - 1);
    if (tabular === 'true' && /[0-9]/.test(text)) {
      const advances = [...'0123456789'].map((digit) => context.measureText(digit).width);
      const widest = Math.max(...advances);
      for (const character of text) if (character >= '0' && character <= '9') fresh += widest - advances[character.charCodeAt(0) - 48]!;
    }
    if (Math.abs(fresh - width) > 0.01) return true;
  }
  return false;
}

/**
 * The measurer the width pass uses: the wider of the shipped table and what
 * the browser says, re-taken once `document.fonts.ready` resolves so a late
 * font swap cannot leave a stale track behind.
 */
function useWidthMeasure(base: TextMeasurer, enabled: boolean): { measure: TextMeasurer; browser: boolean } {
  const [swap, setSwap] = useState(0);
  // False while React hydrates server markup, which had no canvas to ask: the
  // hydrating pass draws the server's tracks and the next pass measures. Read
  // during hydration, the canvas widths never reached the DOM.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  useEffect(() => {
    if (!enabled) return undefined;
    const fonts = (document as Document & { fonts?: Partial<Pick<FontFaceSet, 'ready' | 'addEventListener' | 'removeEventListener'>> }).fonts;
    if (fonts?.ready === undefined) return undefined;
    let active = true;
    // A face that loaded after the widths were taken changes them; where a sample of them measures the same, the
    // tracks stand and the table is not fitted and measured a second time.
    const remeasure = () => {
      if (!active || !canvasWidthsMoved()) return;
      measuredWidths.clear();
      measuredDigits.clear();
      setSwap((previous) => previous + 1);
    };
    void fonts.ready.then(remeasure);
    // `ready` has resolved already where no face was loading when the table mounted. A web font the page first
    // asks for when it draws the table's text loads after that, and its wider text would cut the text columns.
    fonts.addEventListener?.('loadingdone', remeasure);
    return () => {
      active = false;
      fonts.removeEventListener?.('loadingdone', remeasure);
    };
  }, [enabled]);
  return useMemo(() => {
    const browser = enabled && hydrated ? canvasTextWidth() : undefined;
    if (browser === undefined) return { measure: base, browser: false };
    return {
      browser: true,
      measure: (text, font) => {
        const metric = base(text, font);
        const drawn = browser(text, font);
        return drawn > metric.width ? { ...metric, width: drawn } : metric;
      },
    };
    // `swap` is the font-load generation: the same inputs measure again once
    // the face the browser drew with has changed.
  }, [base, enabled, hydrated, swap]);
}

function columnVisibilityDefaults(table: ResolvedTable, authored?: Record<Id, boolean>): Record<Id, boolean> {
  return {
    ...Object.fromEntries(table.columnToggles.map((toggle) => [toggle.id, toggle.visible])),
    ...authored,
  };
}

/**
 * The table component the `react/table` entry publishes: `checkKeys`, built
 * from the table options' generated key tree, refuses every option prop
 * outside it as the CLI does. The table's own props are taken off
 * before the check.
 */
export function createTableChart(checkKeys?: OptionKeyCheck, linked?: readonly DeferredName[]) {
  function GatedTable(props: TableChartProps): ReactElement {
    // Rows answer before the table resolves: a table has no data while the rows chunk loads or after it refuses them.
    const { rows, columns, onRowsReading, ...table } = props;
    const gate = useRowsGate({ type: 'table', data: table.data }, { rows, columns, onRowsReading }, table);
    return gate.element ?? <DrawnTable table={{ ...table, data: gate.data! }} checkKeys={checkKeys} linked={linked} />;
  }
  // A bad value draws the refusal card in the table's own frame and never unmounts the host's root (RefusalBoundary).
  function TableChart(props: TableChartProps): ReactElement {
    const { size, fallbackSize, target, title, theme } = props as TableChartProps & { title?: unknown; theme?: ThemeRef };
    return <RefusalBoundary watch={props} fallback={(finding) => <LayoutRefusal refusals={[finding]} theme={theme}
      size={frameSize(size === 'container' ? fallbackSize : size as Parameters<typeof frameSize>[0], target)} options={typeof title === 'string' ? { title } : {}} />}><GatedTable {...props} /></RefusalBoundary>;
  }
  // The registry type this component renders, stated by the component itself —
  // the same stamp createChartComponent writes, so the public API check resolves
  // every registered type through one mechanism instead of a name convention.
  TableChart.displayName = 'TableChart';
  TableChart.chartType = 'table';
  rebindable(TableChart, (relinked): unknown => createTableChart(checkKeys, relinked));
  return TableChart;
}

/** The table without the unknown-key check, for code that links this module directly. */
export const TableChart = createTableChart();

function DrawnTable({ table: props, checkKeys, linked }: { table: TableChartProps; checkKeys: OptionKeyCheck | undefined; linked: readonly DeferredName[] | undefined }): ReactElement {
  const compiledRequest = useContext(TableFloorRequestContext);
  const originalFloorRequest = compiledRequest?.request;
  const {
    data,
    collapsed: controlledCollapsed,
    defaultCollapsed,
    onCollapsedChange,
    onExpansionChange,
    columnVisibility: controlledColumnVisibility,
    defaultColumnVisibility,
    onColumnVisibilityChange,
    inlineVisibility: controlledInlineVisibility,
    defaultInlineVisibility,
    onInlineVisibilityChange,
    sortable: authoredSortable = false,
    sort: controlledSort,
    defaultSort,
    onSortChange,
    rootsHidden: controlledRootsHidden,
    measureWidths = 'browser',
    stickyLabels = false,
    toolbar = true,
    target,
    onWarnings,
    size,
    fit = 'content',
    fallbackSize,
    prepared,
    scope,
    fontMetrics,
    styleNonce,
    idPrefix,
    onRefused,
    renderRefused,
    hover,
    onScrollChange,
    handleRef,
    onContentWidth,
    fillHeight = false,
    rowLabelLead,
    portalContainer,
    onRowSelect: authoredRowSelect,
    interactions = true,
    foldOn,
    onFormatsFit,
    onEmpty,
    isRowSelectable,
    exporter,
    ...options
  } = props;
  // React props and request normalization omit symbol keys. Keep the compiler's width rules in context.
  const widthOptions = compiledRequest?.options ?? options;
  const softLabelCap = (widthOptions as { [SOFT_LABEL_CAP]?: boolean })[SOFT_LABEL_CAP] === true;
  const labelWrapFloor = (widthOptions as { [LABEL_WRAP_FLOOR]?: boolean })[LABEL_WRAP_FLOOR] === true;
  // A host mode such as annotation owns the click: nothing selects, sorts or folds.
  const onRowSelect = interactions ? authoredRowSelect : undefined;
  const sortable = interactions ? authoredSortable : false;
  const flags = hoverFlags(hover);
  // A table normally takes its height from its rows and observes only width.
  // fillHeight uses the host's fixed height when the probe observes one.
  const container = useContainerSize({ size, target, fit, fallbackSize, needsHeight: fillHeight });
  const [scrollWidth, setScrollWidth] = useState<number>();
  const resolvedSize = size === 'container' ? container.size : size;
  const stableSize = useStableValue(typeof resolvedSize === 'object' ? resolvedSize : {});
  const authoredTableOptions: TableOptions = {
    ...options,
    // An authored sibling order goes back into the options the core resolves;
    // a column sort is reader state and never reaches resolveTable.
    ...(controlledSort == null || isColumnSort(controlledSort) ? {} : { sort: controlledSort }),
    ...(resolvedSize === undefined ? {} : { size: typeof resolvedSize === 'object' ? stableSize as typeof resolvedSize : resolvedSize }),
    ...(controlledColumnVisibility === undefined
      ? {}
      : { columnVisibility: controlledColumnVisibility }),
    ...(controlledInlineVisibility === undefined
      ? {}
      : { inlineVisibility: controlledInlineVisibility }),
  };
  const stableOptions = useStableValue(
    authoredTableOptions as unknown as Record<string, unknown>,
  ) as unknown as TableOptions;
  const { request, layoutRequest: fullLayoutRequest, provider, deferred } = useResolvedChartRequest({ type: 'table', data, target, options: stableOptions, scope, fontMetrics }, {}, prepared, linked);
  // Inline visibility changes the drawn lines, not their values or widths.
  // Keep the full request for prepared-snapshot matching; reuse resolution and
  // format fitting while the reader switches the lines on or off.
  const { inlineVisibility: _inlineVisibility, ...valueOptions } = (fullLayoutRequest?.options as TableOptions | undefined) ?? {};
  const valueContext = useStableValue(fullLayoutRequest === undefined ? undefined
    : { ...fullLayoutRequest, data: undefined, options: valueOptions });
  const layoutRequest = useMemo(() => valueContext === undefined ? undefined
    : { ...valueContext, data: fullLayoutRequest!.data }, [valueContext, fullLayoutRequest?.data]);
  // A patched theme is checked in a chunk this entry fetches (core/deferred).
  // Until it lands there is no resolved theme to draw the table with, so the
  // table waits on the busy placeholder rather than drawing in the default
  // theme and swapping. A patch the checks REFUSE throws as it always did.
  // What the table schema refuses, refused here as the CLI refuses it.
  const refusedProps = optionRefusals(stableOptions as unknown as Record<string, unknown>, 'table', checkKeys, provider?.strings as Record<string, unknown> | undefined);
  const failure = useDeferredModule(deferred);
  // Everything below reads `undefined` while the request is deferred, and
  // nothing is drawn from it: the component returns the busy box before the
  // first of these values reaches the markup. No stand-in request is made,
  // so `usePrepared` has nothing to reject and the table is not resolved
  // against a theme the caller did not ask for.
  const tableOptions = layoutRequest?.options as TableOptions | undefined;
  const initialPrepared = usePrepared(prepared, fullLayoutRequest, 'table', size === 'container' ? fit : undefined, size === 'container' ? container.fallback : undefined);
  // The values, formats and judgements do not depend on the frame size: a container that reports its width after the
  // first pass does not resolve the table again.
  const { size: _resolveSize, ...sizeFreeOptions } = tableOptions ?? {};
  const resolveKey = useStableValue(tableOptions === undefined ? undefined : sizeFreeOptions as Record<string, unknown>);
  const resolved = useMemo(() => !layoutRequest || !tableOptions ? undefined : initialPrepared
    ? { table: { ...initialPrepared.table, provenance: {} }, warnings: initialPrepared.warnings ?? [] }
    : resolveTable(layoutRequest.data as TableData, tableOptions), [layoutRequest?.data, resolveKey, initialPrepared]);
  // The prop when the host wrote one, the authored option otherwise, so a
  // spec that carries `expansion.rootsHidden` or the totals step hides its
  // roots in the grid as the SVG does.
  const rootsHidden = controlledRootsHidden ?? (resolved === undefined ? false : expansionRootsHidden(resolved.table, tableOptions?.expansion));
  const colorblindSafe = tableOptions?.colorblindSafe === true;
  // By content: a container that reports its width re-derives the theme, and the same theme must not fit and measure
  // every cell again.
  // A table in a container, mounted fresh on the client, waits the frame its container takes to report a width, as a
  // chart does, so it draws once, at that width, in the type the frame's width class sets. A host's fallbackSize, a
  // server render and its hydration draw at once, as before.
  // The value on the first render: a hydrated table never waits, also on the renders after hydration.
  const [freshMount] = useState(useSyncExternalStore(noSubscription, () => true, () => false));
  // The wait is the shared container rule (`useContainerSize`).
  const waitsForWidth = container.waiting;
  // By content: a container that reports its width re-derives the theme, and the same theme must not fit and measure
  // every cell again.
  const theme = useStableValue(useMemo(() => request && !waitsForWidth ? tableRenderTheme(request) : undefined,
    [request?.theme, request?.target, request?.size.width, tableOptions, waitsForWidth]));
  // Whether the table paints a good/bad pair at all is the SVG layout's own
  // check (table-colorblind-safe-unused), so the grid refuses what the CLI
  // refuses. It lays the table out only when colorblindSafe is on.
  const colorblindWarnings = useMemo(() => colorblindSafe && layoutRequest && tableOptions
    ? tableCore.layout(layoutRequest.data as TableData, tableOptions).warnings.filter((warning) => warning.code === 'table-colorblind-safe-unused')
    : [], [layoutRequest, colorblindSafe]);
  const metricMeasure = request?.fontMetrics ?? defaultMeasurer;
  const width = useWidthMeasure(metricMeasure, measureWidths === 'browser');
  const statement = resolved?.table.rows.some(row => row.sign === -1 || row.operator !== undefined || row.kind === 'subtotal' || row.kind === 'result' || row.kind === 'driver') ?? false;
  const cohort = tableOptions?.density?.startsWith('cohort') ?? false;
  // The selected palette paints the chips and the tone text, as the SVG layout passes it.
  const stylesheet = useMemo(() => theme && tableStylesheet(theme, request?.target, statement, cohort, typeof stickyLabels === 'object', textScaleOf(request?.options), tableOptions?.palette), [theme, request?.target, request?.options.textScale, request?.options.textSize, statement, cohort, typeof stickyLabels === 'object', tableOptions?.palette]);
  const themeScope = stylesheet === undefined ? '' : stylesheetHash(stylesheet);

  const floorRevision = useDeferredRevision();
  // By content: an inline `size={{ … }}` is a new object on every render and must not remake the refusal.
  const sizeProp = useStableValue(size);
  const floorAttempt = useMemo<{ result?: RefusedLayout; deferred?: DeferredName }>(() => {
    if (!fullLayoutRequest || !belowTableViewportFloor(fullLayoutRequest.options.size)) return {};
    // The server's first frame and the hydrating one count only the modules this entry links.
    return floorRevision === 0 ? asFirstFrame(linked ?? [], attemptFloor) : attemptFloor();
  }, [fullLayoutRequest, originalFloorRequest, provider, scope, fontMetrics, floorRevision, sizeProp, container.pinnedHeight, data, target, stableOptions, linked]);
  function attemptFloor(): { result?: RefusedLayout; deferred?: DeferredName } {
    if (!fullLayoutRequest) return {};
    try {
      // A fallback height is only a seed. Without an observed host height,
      // the refusal measures the original request with width alone.
      const openHeight = size === 'container' && !container.pinnedHeight;
      // Keep DimSwitch's original request: its automatic card forms have a
      // different floor from the compiled table.
      const floorRequest = originalFloorRequest === undefined && !openHeight ? fullLayoutRequest
        : (provider?.resolve ?? resolveChartRequest)({
          ...(originalFloorRequest ?? { type: 'table', data, target, options: stableOptions }),
          size: openHeight ? { width: fullLayoutRequest.size.width } : fullLayoutRequest.options.size,
          scope, fontMetrics,
        }, provider ?? {});
      return { result: measureResolvedRequest(floorRequest).refused };
    } catch (error) {
      if (!(error instanceof DeferredCoreError)) throw error;
      return { deferred: error.module as DeferredName };
    }
  }
  const sized = floorAttempt.result;
  // A size refusal in a growing container waits as every other chart's does: the busy box stands in.
  const settling = useRefusalSettle(size === 'container' && sized !== undefined && chartRefusals(sized.warnings).every(isSizeDependentRefusal),
    container.client, `${container.size.width}x${container.size.height ?? ''}`, sized);
  const floorFailure = useDeferredModule(floorAttempt.deferred);


  const initialCollapsed = (): Id[] =>
    defaultCollapsed ?? (resolved ? [...collapsedByDefault(resolved.table)] : []);
  const initialColumnVisibility = (): Record<Id, boolean> =>
    resolved ? columnVisibilityDefaults(resolved.table, defaultColumnVisibility) : {};

  const initialInlineVisibility = (): Record<Id, boolean> => ({
    ...(options as TableOptions).inlineVisibility,
    ...defaultInlineVisibility,
  });

  // `null` is a legitimate controlled value (the authored order), so the
  // ownership test is whether the caller wrote a COLUMN sort at all, not
  // whether its value is defined.
  const isSortControlled = controlledSort === null || isColumnSort(controlledSort);

  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState<Id[]>(initialCollapsed);
  const [uncontrolledColumnVisibility, setUncontrolledColumnVisibility] = useState<
    Record<Id, boolean>
  >(initialColumnVisibility);
  const [uncontrolledInlineVisibility, setUncontrolledInlineVisibility] = useState<
    Record<Id, boolean>
  >(initialInlineVisibility);
  const isInlineVisibilityControlled = controlledInlineVisibility !== undefined;
  const inlineVisibility = isInlineVisibilityControlled
    ? controlledInlineVisibility
    : uncontrolledInlineVisibility;
  const [uncontrolledSort, setUncontrolledSort] = useState<TableSort | null>(defaultSort ?? null);

  /**
   * Both states above are UNCONTROLLED, so their initializers run once per mount
   * and never again. That is wrong the moment the same mounted instance is handed
   * a different table: replacing the document in place must not preserve stale state.
   * Without a reset, document B inherited A's collapsed ids and visibility entries and
   * overrode its own defaults (a fresh mount of B showed {b-parent} and three
   * columns, the same B reached through A showed {b-parent,b-child} and two).
   *
   * The reset key is the table's STRUCTURAL identity, not its values: replacing
   * the document resets, while new numbers in the same shape keep the reader's
   * expansions where they put them. Reset happens during render, which is React's
   * documented way to adjust state on a prop change — an effect would paint one
   * frame of the wrong table first.
   */
  const structureKey = useMemo(
    () => resolved === undefined ? '' :
      encodeStructuralIds(resolved.table.rows.map((row) => row.id)) +
      encodeStructuralIds(resolved.table.columns.map((column) => column.id)) +
      encodeStructuralIds(resolved.table.columnToggles.map((toggle) => toggle.id)),
    [resolved?.table],
  );
  // A new `options.expansion` (a depth control) is the newer instruction: the
  // reader's folds give way to it on the mounted table, so scroll, column
  // toggles and the fold animation stay. The first resolve only records it.
  const expansionKey = resolved === undefined ? undefined : JSON.stringify(tableOptions?.expansion ?? null);
  const [seenExpansionKey, setSeenExpansionKey] = useState(expansionKey);
  if (expansionKey !== undefined && seenExpansionKey !== expansionKey) {
    setSeenExpansionKey(expansionKey);
    if (seenExpansionKey !== undefined) setUncontrolledCollapsed([...collapsedByDefault(resolved!.table)]);
  }
  const [seenStructureKey, setSeenStructureKey] = useState(structureKey);
  if (seenStructureKey !== structureKey) {
    setSeenStructureKey(structureKey);
    setUncontrolledCollapsed(initialCollapsed());
    setUncontrolledColumnVisibility(initialColumnVisibility());
    setUncontrolledInlineVisibility(initialInlineVisibility());
    setUncontrolledSort(defaultSort ?? null);
  }

  // The sort reorders the resolved rows and nothing else: same rows, same
  // cells, same ids, so the structure key above (which must NOT reset the
  // reader's expansions when they sort) is taken from the unsorted table.
  const isColumnVisibilityControlled = controlledColumnVisibility !== undefined;
  const currentColumnVisibility = isColumnVisibilityControlled
    ? controlledColumnVisibility
    : uncontrolledColumnVisibility;
  const columnVisibility = useMemo(
    () =>
      Object.fromEntries(
        (resolved?.table.columnToggles ?? []).map((toggle) => [
          toggle.id,
          currentColumnVisibility[toggle.id] ?? toggle.visible,
        ]),
      ),
    [currentColumnVisibility, resolved?.table.columnToggles],
  );
  /**
   * Formats that fit their authored tracks: measured in the faces
   * the grid draws and with the measurer its width pass uses, so the figure
   * that fits here is the figure the cell draws. Structure never changes:
   * the same rows, columns and toggles, only shorter formats and their
   * strings, so the reader state keyed on the unfitted table stays valid.
   */
  const fitResult = useMemo(() => {
    if (resolved === undefined || layoutRequest === undefined || theme === undefined || tableOptions?.fitFormats !== true) return undefined;
    const ladder = levelLadder(theme, tableOptions.density ?? 'regular', request?.target, textScaleOf(request?.options));
    const fonts = tableFonts(theme, ladder);
    const rowById = new Map(resolved.table.rows.map((row) => [row.id, row]));
    const fitChanges = new Set(resolved.table.rows.filter(row => visibleInlineRows(row, inlineVisibility).length > 0).map(row => row.id));
    const drawnColumns = (candidate: ResolvedTable) => visibleColumns(candidate, columnVisibility);
    const result = fitTableFormats(layoutRequest.data as TableData, tableOptions, resolved, drawnColumns, {
      measure: width.measure,
      padX: tableOptions.cellPadX ?? trackCellPadX(drawnColumns(resolved.table).length),
      cellFont: (cell) => {
        const row = rowById.get(cell.rowId);
        return kindFont(ladderRowFont(theme, ladder, fonts, cell.role, row?.step ?? cell.level, row?.hasChildren === true, fitChanges.has(cell.rowId)), row?.kind, cell.kind === 'rowLabel', theme);
      },
      ...(width.browser ? {} : { slack: browserSlack }),
      figures: (column, text) => cellDrawsTabular(theme, column.kind, text),
      lineFont: (parent, line, text, tabular) => changeLineFitFont(theme, ladder, parent.step, line.polarity !== undefined, text, width.measure, tabular, width.browser ? undefined : browserSlack),
      ...(tableOptions.locale?.decimal === undefined ? {} : { decimal: tableOptions.locale.decimal }),
    });
    return result;
    // Formats fit fixed tracks and do not change with the frame size: `resolveKey` is the size-free options.
  }, [resolved, layoutRequest?.data, theme, resolveKey, columnVisibility, inlineVisibility, width]);
  const fitted = useMemo(
    () => (fitResult === undefined || resolved === undefined ? resolved : { table: { ...fitResult.resolved.table, provenance: resolved.table.provenance } }),
    [fitResult, resolved],
  );
  // `fitFormats` reports what it shortened, to the host (`onFormatsFit`) and as the `table-formats-fitted` info warning.
  const formatChanges = fitResult?.changes;
  const formatsListener = useRef(onFormatsFit);
  formatsListener.current = onFormatsFit;
  const formatsKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = JSON.stringify(formatChanges ?? []);
    if (formatsKey.current === key) return;
    const first = formatsKey.current === undefined;
    formatsKey.current = key;
    if (first && (formatChanges?.length ?? 0) === 0) return;
    formatsListener.current?.(formatChanges ?? []);
  }, [formatChanges]);
  const fittedNote = useMemo(() => formatsFittedWarning(formatChanges ?? []), [formatChanges]);
  const sort = isSortControlled ? (isColumnSort(controlledSort) ? controlledSort : null) : uncontrolledSort;
  const sortedTable = useMemo(() => {
    if (fitted === undefined) return undefined;
    const sorted = sortRows(fitted.table, sort, request?.locale?.language);
    return sorted === fitted.table.rows ? fitted.table : { ...fitted.table, rows: sorted };
  }, [fitted?.table, sort, request?.locale?.language]);
  // A table with no data row after filtering tells the host once (`onEmpty`) and draws one row under its head that
  // says so, the row the SVG draws; `strings.emptyMessage` words it. Folds and `rootsHidden` do not make a table empty.
  const isEmpty = sortedTable !== undefined && hasNoDataRows(sortedTable);
  const emptyText = provider?.strings?.emptyMessage ?? DEFAULT_EMPTY_MESSAGE;
  const table = useMemo(
    () => (sortedTable !== undefined && isEmpty ? { ...sortedTable, rows: [...sortedTable.rows, emptyMessageRow(sortedTable, emptyText)] } : sortedTable),
    [sortedTable, isEmpty, emptyText],
  );
  const emptyListener = useRef(onEmpty);
  emptyListener.current = onEmpty;
  const emptyNotified = useRef(false);
  useEffect(() => {
    if (!isEmpty) { emptyNotified.current = false; return; }
    if (emptyNotified.current) return;
    emptyNotified.current = true;
    emptyListener.current?.();
  }, [isEmpty]);
  const sortableIds = useMemo(
    () => (table ? sortableColumnIds(table, sortable) : new Set<Id>()),
    [table, sortable],
  );

  const isCollapsedControlled = controlledCollapsed !== undefined;
  /**
   * A controlled `collapsed` without `onCollapsedChange` is a read-only tree,
   * the way an input with a `value` and no `onChange` is a
   * read-only field: no toggle is drawn, a row takes no click and no key,
   * and nothing offers a pointer. The rows still fold where the host says.
   */
  const readOnlyTree = (isCollapsedControlled && onCollapsedChange === undefined) || !interactions;
  const collapsed = isCollapsedControlled ? controlledCollapsed : uncontrolledCollapsed;
  // A foldable: false parent stays open whatever the host's state names.
  const collapsedSet = useMemo(() => {
    const fixed = new Set((table?.rows ?? []).filter((row) => row.foldable === false).map((row) => row.id));
    return new Set(collapsed.filter((id) => !fixed.has(id)));
  }, [collapsed, table]);
  const rows = useMemo(
    () => table ? visibleRows(table, collapsedSet, rootsHidden) : [],
    [table, collapsedSet, rootsHidden],
  );
  const closers = useMemo(() => finalClosers(rows), [rows]);

  const columns = useMemo(
    () => table ? visibleColumns(table, columnVisibility) : [],
    [table, columnVisibility],
  );
  const spans = useMemo(
    () => table ? groupSpans(table, columns) : [],
    [table, columns],
  );
  // Which drawn columns wear the band, and which open a group — the
  // first drawn column of every group after the first carries the divider.
  const groupMarks = useMemo(() => {
    const banded = new Set<Id>();
    const groupStart = new Set<Id>();
    // The heat lanes that draw their grounds alone: a 22 px track, so their
    // cells take no inline air, as the SVG centres a head on the track.
    const groundsOnly = new Set<Id>(
      printsFigures(tableOptions?.figures, columns) ? [] : columns.filter(heatColumn).map((column) => column.id),
    );
    // Whether the SVG draws a divider anywhere, which sets the ink of the
    // right end: it draws none for a group a spacer stands off, where the
    // gap is the separation.
    let divided = false;
    // The right edge of a banded block: the column after it opens with
    // the divider, or the block's last column closes on one where it is the
    // last drawn column and the rows reach on past it to the frame.
    const groupEnd = new Set<Id>();
    // Ungrouped columns whose group-row cell carries that divider, as a
    // banded group's own divider runs through its heading.
    const groupRowStart = new Set<Id>();
    if (!table) return { banded, groupStart, groupEnd, groupRowStart, groundsOnly, divided };
    const drawn = new Set(columns.map((column) => column.id));
    table.columnGroups.forEach((group, index) => {
      const visible = group.columnIds.filter((columnId) => drawn.has(columnId));
      if (visible.length === 0) return;
      if (group.band === true) for (const columnId of visible) banded.add(columnId);
      if (index > 0 && columns[0]?.id !== visible[0]) {
        groupStart.add(visible[0]!);
        if ((group.spacer ?? 0) <= 0) divided = true;
      }
    });
    // A band authored on the columns themselves: the run reads as
    // one block and its first column takes the hairline, so a block inside a
    // column group needs no group of its own.
    columns.forEach((column, index) => {
      if (column.band !== true) return;
      banded.add(column.id);
      if (index > 0 && columns[index - 1]?.band !== true) {
        groupStart.add(column.id);
        divided = true;
      }
    });
    const blocks: { lastIndex: number; group: boolean }[] = [];
    for (const group of table.columnGroups) {
      if (group.band !== true) continue;
      const lastIndex = columns.reduce((last, column, index) => (group.columnIds.includes(column.id) ? index : last), -1);
      if (lastIndex >= 0) blocks.push({ lastIndex, group: true });
    }
    columns.forEach((column, index) => {
      if (column.band === true && columns[index + 1]?.band !== true) blocks.push({ lastIndex: index, group: false });
    });
    for (const { lastIndex, group } of blocks) {
      const next = columns[lastIndex + 1];
      if (next === undefined) {
        if (tableOptions?.rowExtent === 'frame') {
          groupEnd.add(columns[lastIndex]!.id);
          divided = true;
        }
        continue;
      }
      // A spacer before the next group is the separation, as on the left.
      const nextGroup = table.columnGroups.find((candidate) => candidate.columnIds.includes(next.id));
      if (nextGroup && (nextGroup.spacer ?? 0) > 0 && nextGroup.columnIds.find((id) => columns.some((column) => column.id === id)) === next.id) continue;
      groupStart.add(next.id);
      if (group && next.groupId === undefined) groupRowStart.add(next.id);
      divided = true;
    }
    return { banded, groupStart, groupEnd, groupRowStart, groundsOnly, divided };
  }, [table, columns, tableOptions?.figures, tableOptions?.rowExtent]);
  const density = tableOptions?.density ?? 'regular';
  /**
   * How many leading columns pin: `true` is one, a number is that many.
   * A spec reaches this through the same field: `BoardplotSpec`
   * spreads `options` onto the component, so `options.stickyLabels` IS this
   * prop.
   */
  const sticky = stickySettings(stickyLabels);
  const stickyCount = sticky.columns;
  const pageHead = sticky.head === 'page';
  /** Heat-only mode draws the grounds and leaves the figures out, where a heat column is drawn. */
  const figures = printsFigures(tableOptions?.figures, columns);
  const grid = useTableGridNavigation(rows, columns, table?.rows);
  const summaryId = `bp-table-summary-${useScopedId(checkedIdPrefix(idPrefix))}`;

  // Every column stays in the DOM and every track keeps its place in the
  // list; a hidden column's track closes to zero. Layout owns the widths
  // (`table/tracks.ts`), the renderer only writes them into `--bp-cols`.
  const allColumns = table?.columns ?? [];
  // A table this wide builds only the columns near its scroll viewport; see `windowIds`.
  const windowed = allColumns.length > WINDOW_COLUMNS;
  // Plain rows keep all text and cell roles for find and screen readers; only offscreen cell decoration waits.
  // shortcut: complex rows keep full rendering until shared layout exposes their exact row heights.
  const rowWindowed = useMemo(() => freshMount && typeof IntersectionObserver !== 'undefined' && !windowed && !sticky.sections && rowLabelLead === undefined
    && rows.length > 500 && allColumns.every(column => (column.kind === 'rowLabel' || column.kind === 'value' || column.kind === 'computed') && !column.wrap
      // A capped label track can wrap a label to two lines (rowLabelLines), and rows of one height are what the pages assume.
      && !(column.kind === 'rowLabel' && tableOptions?.rowLabelLines !== 1 && (column.width !== undefined || column.maxWidth !== undefined || column.maxTextWidth !== undefined))
      && (column.cellEncoding === undefined || column.cellEncoding.type === 'inCellBar'))
    && rows.every(row => !row.hasChildren && !row.inlineRows?.length && row.role === 'data' && row.unitAffix === undefined && row.operator === undefined
      && Object.values(row.cells).every(cell => cell.note === undefined && cell.href === undefined)),
  [freshMount, windowed, sticky.sections, rowLabelLead, rows, allColumns, tableOptions?.rowLabelLines]);
  // Only uniform single-line rows can share one measured height without moving the scroll limits.
  const containRowPages = useMemo(() => rowWindowed && figures && rows.every(row => row.step === 0 && row.kind === undefined
    && row.spacer === undefined && !row.divider && allColumns.some(column => column.kind === 'rowLabel' && row.cells[column.id]?.displayed !== '')),
  [rowWindowed, figures, rows, allColumns]);
  useLayoutEffect(() => {
    if (!containRowPages) return;
    const body = grid.tableRef.current?.querySelector<HTMLElement>('[data-bp-rowgroup="body"]');
    // The first row omits its top border; later pages need the regular row pitch.
    const sample = body?.querySelectorAll<HTMLElement>('[data-bp-row-page="0"] [role="row"]')[1];
    if (!body || !sample) return;
    const measure = () => {
      // CSS height keeps fractional layout pixels without ancestor transforms.
      const height = parseFloat(getComputedStyle(sample).height);
      if (!(height > 0)) return;
      const second = body.querySelector<HTMLElement>('[data-bp-row-page="1"]');
      if (second !== null && Math.abs(parseFloat(getComputedStyle(second).blockSize) - height * ROW_PAGE) < 0.01) return;
      const pitch = `${height}px`;
      if (body.style.getPropertyValue('--bp-row-pitch') !== pitch) body.style.setProperty('--bp-row-pitch', pitch);
    };
    measure();
    // A hidden tab can become visible without a React render.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(sample);
    return () => observer?.disconnect();
  }, [containRowPages, grid.tableRef, rows]);
  const hiddenColumns = useMemo(() => {
    const drawn = new Set(columns.map((column) => column.id));
    return new Set(allColumns.filter((column) => !drawn.has(column.id)).map((column) => column.id));
  }, [allColumns, columns]);
  const margin = tableOptions === undefined ? undefined : resolveCanvasOptions(tableOptions).margin;
  const marginLeft = margin?.left ?? 0;
  const marginRight = margin?.right ?? 0;
  const frameReach = tableOptions?.rowExtent === 'frame' ? Math.max(0, marginRight) : 0;
  const frameStart = tableOptions?.rowExtent === 'frame' ? Math.max(0, marginLeft) : 0;
  const rowToFrame = (tableOptions?.rowExtent ?? 'frame') === 'frame';
  const available = useMemo(() => {
    if (size === 'container') return container.size === undefined ? undefined : container.size.width - marginLeft - marginRight;
    if (size === undefined || theme === undefined) return undefined;
    const frameWidth = resolveSize(size).width;
    const sides = { ...canvasMargin(theme, frameWidth), ...margin };
    return frameWidth - sides.left - sides.right;
  }, [size, container.size?.width, theme, margin, marginLeft, marginRight]);
  const measured = useMemo(() => table && theme ? tableWidths(table, theme, width.measure, {
    ...tableOptions, density, target: request?.target, inlineVisibility,
    [SOFT_LABEL_CAP]: softLabelCap, [LABEL_WRAP_FLOOR]: labelWrapFloor,
  }, {
    columns, allColumns, rows, available, frameStart, scroll: true,
    withMarks: !readOnlyTree || tableOptions?.outlineMarks === true,
    sortable: sortableIds, leadWidth: rowLabelLead?.width,
    trailingTracking: true, groupStart: groupMarks.groupStart, groupEnd: groupMarks.groupEnd,
    slack: width.browser ? undefined : browserSlack,
    fit: size === 'container' ? fit : undefined,
  }) : undefined, [table, theme, width, tableOptions, density, request?.target, inlineVisibility, softLabelCap, labelWrapFloor,
    columns, allColumns, rows, available, frameStart, readOnlyTree, sortableIds, rowLabelLead?.width, groupMarks, size, fit]);
  const padX = measured?.cellPadX ?? 12;
  const indents = measured?.indents ?? { base: 0, step: 16 };
  const operatorSlot = measured?.operatorSlot ?? 0;
  const tracks = measured?.tracks ?? [];
  const spacerWidths = measured?.spacerBefore ?? new Map<Id, number>();
  const labelsWrap = measured?.labelsWrap ?? false;
  const diagnostics = useMemo(() => layoutRequest && resolved ? {
    warnings: [...resolved.warnings, ...(layoutRequest.inputWarnings ?? []), ...(fittedNote === undefined ? [] : [fittedNote]), ...colorblindWarnings, ...(measured?.warnings ?? []), ...(sized?.warnings ?? [])],
    presentation: initialPrepared?.presentation ?? tablePresentation(layoutRequest, resolved.table),
    refused: sized?.refused,
  } : undefined, [layoutRequest, resolved, initialPrepared, sized, colorblindWarnings, fittedNote, measured?.warnings]);
  const displayRef = useDisplayWarnings(settling ? undefined : diagnostics, onWarnings, null);
  const headFonts = measured?.fonts;
  const frameRoom = !rowToFrame || tableOptions?.frameFill === 'none' ? undefined
    : available === undefined ? undefined : available - (measured?.spacerTotal ?? 0);
  const reachFrame = rowToFrame && !(tableOptions?.rowExtent === undefined && frameRoom !== undefined && Math.floor(frameRoom - trackTotal(tracks)) >= 1);
  /** The track list the grid draws, spacer tracks folded in at their columns. */
  const gridTracks = measured?.gridTracks ?? [];

  /**
   * Which track each column sits in, 1-based, once spacers have shifted
   * them. Only a table WITH spacers places its cells explicitly: auto
   * placement would put the next cell into the empty track.
   */
  const trackColumn = useMemo(() => {
    if (spacerWidths.size === 0 && !windowed) return undefined;
    const index = new Map<Id, number>();
    gridTracks.forEach((track, position) => {
      if (!track.id.startsWith('bp-spacer:')) index.set(track.id, position + 1);
    });
    return index;
  }, [gridTracks, spacerWidths, windowed]);
  /**
   * The pinned core columns: `stickyLabels` names how many, each
   * one takes the width of the tracks before it as its offset, and the last
   * of them carries the hairline that shows where the scrolling starts.
   */
  const pinned = useMemo(() => pinnedColumns(
    allColumns.filter(column => !hiddenColumns.has(column.id)),
    gridTracks,
    stickyCount,
    scrollWidth ?? (container.ready ? container.size.width : undefined),
  ), [stickyCount, gridTracks, allColumns, hiddenColumns, scrollWidth, container.ready, container.size.width]);
  // Where the pinned columns end, so a column-group label can stay in view beside them.
  const pinEnd = useMemo(() => {
    const widths = new Map(gridTracks.map(track => [track.id, track.width]));
    let end = 0;
    for (const [id, pin] of pinned) if (pin.last) end = pin.left + (widths.get(`bp-spacer:${id}`) ?? 0) + (widths.get(id) ?? 0);
    return end;
  }, [pinned, gridTracks]);
  /**
   * The groups wider than the room the scroll box shows beside the pinned
   * columns. A centred heading over such a group would sit off screen until
   * the reader scrolls to the group's middle, so it starts at the group's
   * first column instead and stays in view while the group scrolls, as 'left' does.
   */
  const wideGroups = useMemo(() => {
    const wide = new Set<Id>();
    // The scroll box reports its width only where it differs from the container's.
    const box = scrollWidth ?? (container.ready ? container.size.width : undefined);
    const room = box === undefined ? undefined : box - pinEnd;
    if (room === undefined || room <= 0) return wide;
    const widths = new Map(gridTracks.map(track => [track.id, track.width]));
    // In drawn order, so the spacer before a group's first drawn column stays outside it.
    const groupWidths = new Map<Id, number>();
    for (const column of allColumns) {
      if (column.groupId === undefined || hiddenColumns.has(column.id)) continue;
      const before = groupWidths.get(column.groupId);
      groupWidths.set(column.groupId, (before ?? 0) + (widths.get(column.id) ?? 0) + (before === undefined ? 0 : widths.get(`bp-spacer:${column.id}`) ?? 0));
    }
    for (const [id, width] of groupWidths) if (width > room + 0.5) wide.add(id);
    return wide;
  }, [allColumns, gridTracks, hiddenColumns, scrollWidth, container.ready, container.size.width, pinEnd]);
  /**
   * The left edge of every drawn column, from the grid's start, and of each
   * one that opens a group. A section heading is one cell across those
   * columns, so it draws their dividers itself, as the SVG runs a divider
   * through the heading. Only the last track flexes, so every edge before it is exact.
   */
  const columnEdges = useMemo(() => {
    const width = new Map(gridTracks.map((track) => [track.id, track.width]));
    const left = new Map<Id, number>();
    let x = 0;
    for (const column of allColumns) {
      if (hiddenColumns.has(column.id)) continue;
      x += width.get(`bp-spacer:${column.id}`) ?? 0;
      left.set(column.id, x);
      x += width.get(column.id) ?? 0;
    }
    // A group a spacer stands off draws no divider on the SVG: the gap is the separation.
    return { left, groupStart: [...groupMarks.groupStart].filter((id) => left.has(id) && !((width.get(`bp-spacer:${id}`) ?? 0) > 0)) };
  }, [gridTracks, allColumns, hiddenColumns, groupMarks]);
  const gridStyle = useMemo(() => ({
    // Under 'frame' the empty track is at least the right margin wide.
    // The scroll box reaches through the margin, so a grid whose
    // natural width left the margin out gave a card that sizes itself to
    // its content (`width: max-content`) no room for it: the card shrank by
    // the margin and the last column met its edge.
    '--bp-cols': reachFrame ? `${trackTemplate(gridTracks)} minmax(${frameReach > 0 ? `${frameReach}px` : 0},1fr)` : trackTemplate(gridTracks),
    // The table is exactly as wide as the columns it draws; room a capped
    // fill did not use stays to the right of it.
    '--bp-table-width': reachFrame ? `max(${Math.round((trackTotal(gridTracks) + frameReach) * 10) / 10}px, 100%)` : `${trackTotal(gridTracks)}px`,
    // Print has no animation to protect, so the tracks may be proportional
    // and the table takes the page width.
    '--bp-cols-print': `${gridTracks.map((track) => (track.width === 0 ? '0px' : `${track.natural}fr`)).join(' ')}${reachFrame ? ' 0px' : ''}`,
    '--bp-cell-pad-x': `${padX}px`,
    ...(frameStart > 0 ? { '--bp-reach-pad-x': `${padX + frameStart}px`, '--bp-pad-x-base': `${padX}px` } : {}),
    // Use the same label ladder for track measurement and CSS padding.
    '--bp-indent-base': `${indents.base}px`,
    '--bp-indent-step': `${indents.step}px`,
    ...(headFonts === undefined ? {} : headVars(headFonts)),
  } as CSSProperties), [gridTracks, padX, headFonts, reachFrame, frameReach, frameStart, indents]);
  /**
   * Under 'frame' the rows run through an authored right margin as well:
   * the margin insets the columns, and the scroll box reaches past it to
   * the figure's edge, so the empty track takes the margin too.
   */
  const reachEnd = reachFrame && marginRight > 0 ? marginRight : 0;
  const scrollStyle = frameStart + reachEnd > 0
    ? {
      ...(frameStart > 0 ? { marginInlineStart: -frameStart } : {}),
      ...(reachEnd > 0 ? { marginInlineEnd: -reachEnd } : {}),
      maxWidth: `calc(100% + ${frameStart + reachEnd}px)`,
    } as CSSProperties
    : undefined;
  /**
   * The trailing empty track's cell: placed explicitly on a grid that places
   * its cells. It belongs to the row, so it takes the row's grounds, rules,
   * hover and highlight; a column band stops at its column.
   */
  const filler = useMemo(() => reachFrame
    ? (trackColumn === undefined ? {} : { gridColumn: gridTracks.length + 1 })
    : undefined, [reachFrame, trackColumn, gridTracks.length]);

  /**
   * The host API of the scroller. The scroller is Boardplot's, since
   * the pinned columns are measured against it, so a minimap, a card that
   * sizes itself to its table and a dialog that fills with it read this
   * state instead of selecting the engine's markup.
   */
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // Page mode only: the head box that follows the body's sideways scroll.
  const [headBox, setHeadBox] = useState<HTMLDivElement | null>(null);
  // Page mode with `sections`: the floating copy of the section heading under the head (see the effect below).
  const [floatClip, setFloatClip] = useState<HTMLDivElement | null>(null);
  const [floatInner, setFloatInner] = useState<HTMLDivElement | null>(null);
  const [floatId, setFloatId] = useState<Id | undefined>(undefined);
  const gridWidth = trackTotal(gridTracks);
  // Print draws every column, as the full table does: the window opens at `beforeprint`, before the browser lays the
  // page out for print and counts its pages (printLayout.ts).
  const printing = usePrinting();
  // Print: a table whose columns need more than its printed box draws at their width and scales down into the box,
  // as a chart does, so no column is squeezed until its figures drop out. The box is read where the page is already
  // laid out for print (printLayout.ts); a table of fixed size keeps it.
  const [printBox, setPrintBox] = useState<number>();
  useEffect(() => size !== 'container' ? undefined : watchPrint(phase => {
    const box = phase === 'print' ? grid.tableRef.current?.parentElement?.clientWidth : undefined;
    return () => setPrintBox(box);
  }), [size, grid.tableRef]);
  const printFit = useMemo((): CSSProperties | undefined => printing && printBox !== undefined && printBox > 0 && gridWidth > printBox + 0.5
    ? { zoom: printBox / gridWidth, width: gridWidth, '--bp-cols-print': 'var(--bp-cols)' } as CSSProperties : undefined, [printing, printBox, gridWidth]);
  const [scrolled, setScrolled] = useState(false);
  const scrollListener = useRef(onScrollChange);
  scrollListener.current = onScrollChange;
  const scrollLabel = useRef('');
  useEffect(() => {
    if (scroller === null) return undefined;
    const report = () => {
      if (scroller.clientWidth > 0) setScrollWidth(before => (before ?? container.size.width) === scroller.clientWidth ? before : scroller.clientWidth);
      // The pinned hairline shows only while the grid is scrolled.
      setScrolled(scroller.scrollLeft > 0);
      markScrollRegion(scroller, scrollLabel.current);
      if (headBox !== null && headBox.scrollLeft !== scroller.scrollLeft) headBox.scrollLeft = scroller.scrollLeft;
      scrollListener.current?.(scrollStateOf(scroller));
    };
    // A focus or a find in the head scrolls the head box alone; the body follows it.
    const follow = () => {
      if (headBox !== null && scroller.scrollLeft !== headBox.scrollLeft) scroller.scrollLeft = headBox.scrollLeft;
    };
    report();
    scroller.addEventListener('scroll', report, { passive: true });
    headBox?.addEventListener('scroll', follow, { passive: true });
    // A filling scroller changes its box without the container changing its
    // width: the dialog grows, or a vertical scrollbar appears and takes
    // `clientWidth` with it. It reports on its own resize then; otherwise
    // the container width and the tracks are what move it.
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : undefined;
    resize?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', report);
      headBox?.removeEventListener('scroll', follow);
      resize?.disconnect();
    };
  }, [scroller, headBox, gridWidth, container.size?.width, fillHeight, rows, theme, density]);
  /**
   * Column windowing: a wide table builds the cells of the pinned columns, the focused column and the
   * columns within half a viewport of the scroll box, and swaps them as the reader scrolls. The track list keeps
   * every column, so the scroll width stays the full table's and the scrollbar stays honest.
   */
  const trackSpans = useMemo(() => {
    if (!windowed) return [];
    let left = 0;
    return gridTracks.map((track) => { const span = { id: track.id, start: left, end: left + track.width }; left += track.width; return span; });
  }, [windowed, gridTracks]);
  const fallbackViewport = container.size?.width ?? (typeof size === 'object' ? resolveSize(size).width : typeof window === 'undefined' ? 1024 : window.innerWidth);
  const viewRange = useCallback((left: number, width: number): string => {
    const view = width > 0 ? width : fallbackViewport;
    const from = left - view / 2, to = left + view * 1.5;
    const inside = trackSpans.filter((span) => span.end >= from && span.start <= to);
    return inside.length === 0 ? '' : `${inside[0]!.id}\u0000${inside[inside.length - 1]!.id}`;
  }, [trackSpans, fallbackViewport]);
  const [viewKey, setViewKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!windowed || scroller === null) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Under dir="rtl" scrollLeft runs from 0 to negative; the tracks count from the logical start either way.
      const left = getComputedStyle(scroller).direction === 'rtl' ? Math.abs(scroller.scrollLeft) : scroller.scrollLeft;
      const next = viewRange(left, scroller.clientWidth);
      setViewKey((before) => (before === next ? before : next));
    };
    const schedule = () => { if (frame === 0) frame = typeof requestAnimationFrame === 'undefined' ? (update(), 0) : requestAnimationFrame(update); };
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(scroller);
    return () => {
      if (frame !== 0 && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      resize?.disconnect();
    };
  }, [windowed, scroller, viewRange]);
  const liteSlots = useMemo(() => new Map(trackSpans.map((span) => [span.id, { start: span.start, width: span.end - span.start }])), [trackSpans]);
  const [rowPagesInView, setRowPagesInView] = useState<ReadonlySet<number>>(() => new Set([0]));
  useEffect(() => {
    if (!rowWindowed || scroller === null) return undefined;
    const observer = new IntersectionObserver(entries => {
      setRowPagesInView(before => {
        const next = new Set(before);
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.bpRowPage);
          if (entry.isIntersecting) next.add(page); else next.delete(page);
        }
        return next.size === before.size && [...next].every(page => before.has(page)) ? before : next;
      });
    }, { root: fillHeight ? scroller : null, rootMargin: '100% 0px' });
    scroller.querySelectorAll('[data-bp-row-page]').forEach(page => observer.observe(page));
    return () => observer.disconnect();
  }, [rowWindowed, scroller, fillHeight, rows]);
  const focusColumn = grid.focus?.colId;
  const windowRef = useRef<ReadonlySet<Id> | undefined>(undefined);
  const windowIds = useMemo(() => {
    if (!windowed || printing) return undefined;
    const key = viewKey ?? viewRange(0, 0);
    const [first, last] = key.split('\u0000');
    const ids = new Set<Id>([...pinned.keys()]);
    if (focusColumn !== undefined) ids.add(focusColumn);
    let inside = false;
    for (const span of trackSpans) {
      if (span.id === first) inside = true;
      if (inside) ids.add(span.id);
      if (span.id === last) inside = false;
    }
    // Whole blocks of WINDOW_BLOCK columns: a block outside the window keeps its light cells while the reader scrolls.
    const blocks = new Set<number>();
    allColumns.forEach((column, index) => { if (ids.has(column.id) && !pinned.has(column.id)) blocks.add(Math.floor(index / WINDOW_BLOCK)); });
    allColumns.forEach((column, index) => { if (blocks.has(Math.floor(index / WINDOW_BLOCK))) ids.add(column.id); });
    const before = windowRef.current;
    if (before !== undefined && before.size === ids.size && [...ids].every((id) => before.has(id))) return before;
    return windowRef.current = ids;
  }, [windowed, printing, viewKey, viewRange, pinned, focusColumn, trackSpans, allColumns]);
  // The columns a row draws, in order: an index for a drawn cell, a range for a run of light cells (one per block).
  const columnPlan = useMemo(() => {
    if (windowIds === undefined) return undefined;
    const plan: (number | { from: number; to: number })[] = [];
    let run: { from: number; to: number } | undefined;
    allColumns.forEach((column, index) => {
      if (windowIds.has(column.id)) { plan.push(index); run = undefined; return; }
      if (hiddenColumns.has(column.id)) { run = undefined; return; }
      if (run !== undefined && Math.floor(run.to / LITE_BLOCK) === Math.floor(index / LITE_BLOCK)) { run.to = index; return; }
      plan.push(run = { from: index, to: index });
    });
    return plan;
  }, [windowIds, allColumns, hiddenColumns]);
  // `sticky.sections`: the section label pins under the head, whose height the stylesheet reads as `--bp-head-h`.
  // It is measured, so a column toggle, a fold, a font swap or a resize that changes the head moves it too.
  const stickySections = sticky.sections;
  const stickyHeadMode = sticky.head;
  const tableReady = table !== undefined;
  useEffect(() => {
    const element = grid.tableRef.current;
    const head = element?.querySelector<HTMLElement>('[data-bp-rowgroup="head"]');
    if (!stickySections || !element || !head) return undefined;
    const apply = () => element.style.setProperty('--bp-head-h', `${stickyHeadMode === false ? 0 : head.offsetHeight}px`);
    apply();
    const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply);
    watch?.observe(head);
    return () => watch?.disconnect();
  }, [stickySections, stickyHeadMode, tableReady, gridWidth]);
  // Page mode cannot pin a section row with CSS: the rows sit in the box that scrolls sideways, and an overflow
  // ancestor captures `position: sticky`. So one floating copy of the heading (`aria-hidden`, no ids, no pointer
  // events) is drawn under the head. The copy takes the last heading that scrolled under the head, and it leaves
  // upward when the next heading, or the end of the table, comes up behind it.
  useEffect(() => {
    const element = grid.tableRef.current;
    if (!pageHead || !stickySections || !element || headBox === null || scroller === null || floatClip === null || floatInner === null) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const body = element.querySelector<HTMLElement>('[data-bp-rowgroup="body"]');
      if (body === null) return;
      const headBottom = headBox.getBoundingClientRect().bottom;
      const headings = Array.from(body.querySelectorAll<HTMLElement>('[role="row"][data-role="section"]')).map((row) => ({ id: row.getAttribute('data-row-id') ?? undefined, box: row.getBoundingClientRect() }));
      let active = -1;
      headings.forEach((heading, index) => { if (heading.box.top < headBottom - 0.5) active = index; });
      const current = headings[active];
      if (current === undefined) floatClip.style.visibility = 'hidden';
      else {
        const limit = headings[active + 1]?.box.top ?? body.getBoundingClientRect().bottom;
        // The copy's own height: the first heading of a table is drawn with less air above it than a later one.
        const height = floatInner.firstElementChild === null ? current.box.height : floatInner.getBoundingClientRect().height;
        floatClip.style.height = `${height}px`;
        floatClip.style.visibility = 'visible';
        floatInner.style.transform = `translateY(${Math.min(0, limit - (headBottom + height))}px)`;
        floatClip.scrollLeft = scroller.scrollLeft;
      }
      setFloatId((before) => (before === current?.id ? before : current?.id));
    };
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(update); };
    update();
    // Capture: any ancestor that scrolls moves the heading under the head too.
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    watch?.observe(element);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      watch?.disconnect();
    };
  }, [pageHead, stickySections, headBox, scroller, floatClip, floatInner, floatId, tableReady, gridWidth]);
  useImperativeHandle(handleRef, () => ({
    scrollState: () => scrollStateOf(scroller),
    scrollToColumn: (columnId, behavior) => {
      if (scroller === null) return;
      // From the tracks the grid draws, not from the markup: the column's
      // offset less the width the pinned columns hold at the left edge.
      let offset = 0;
      for (const track of gridTracks) {
        if (track.id === columnId) break;
        offset += track.width;
      }
      let pinnedWidth = 0;
      for (const [id, pin] of pinned) {
        if (pin.last) pinnedWidth = pin.left + (gridTracks.find((track) => track.id === id)?.width ?? 0);
      }
      scrollBoxTo(scroller, Math.max(0, offset - pinnedWidth), behavior);
    },
    scrollTo: (left, behavior) => {
      if (scroller !== null) scrollBoxTo(scroller, left, behavior);
    },
  }), [scroller, gridTracks, pinned]);
  /**
   * The width the figure needs to show every column: its two margins and
   * the tracks and spacers. Under 'frame' the first track already carries
   * the left margin it reaches through, so the margin counts once.
   */
  const contentWidth = tracks.length === 0 ? undefined
    : Math.ceil(marginLeft - frameStart + trackTotal(gridTracks) + Math.max(0, marginRight));
  const contentListener = useRef(onContentWidth);
  contentListener.current = onContentWidth;
  useEffect(() => {
    if (contentWidth !== undefined) contentListener.current?.(contentWidth);
  }, [contentWidth]);

  const toggleRow = useCallback(
    (rowId: Id) => {
      const next = collapsedSet.has(rowId)
        ? collapsed.filter((candidate) => candidate !== rowId)
        : [...collapsed, rowId];
      if (!isCollapsedControlled) setUncontrolledCollapsed(next);
      onCollapsedChange?.(next);
      if (onExpansionChange !== undefined && resolved !== undefined) onExpansionChange(expansionForFolds(resolved.table, tableOptions?.expansion, new Set(next)));
    },
    [collapsed, collapsedSet, isCollapsedControlled, onCollapsedChange, onExpansionChange, resolved, tableOptions?.expansion],
  );

  const toggleColumns = useCallback(
    (toggleId: Id) => {
      const next = {
        ...columnVisibility,
        [toggleId]: !(columnVisibility[toggleId] ?? true),
      };
      if (!isColumnVisibilityControlled) setUncontrolledColumnVisibility(next);
      onColumnVisibilityChange?.(next);
    },
    [
      columnVisibility,
      isColumnVisibilityControlled,
      onColumnVisibilityChange,
    ],
  );

  // The host's handler behind a stable function, so a new arrow function on
  // every host render does not redraw every row.
  const rowSelectListener = useRef(onRowSelect);
  rowSelectListener.current = onRowSelect;
  const hasRowSelect = onRowSelect !== undefined;
  const selectRow = useMemo(
    () => (hasRowSelect
      ? (row: ResolvedRow, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, columnId: Id | undefined) =>
        rowSelectListener.current?.(row.id, { row, event, ...(columnId === undefined ? {} : { columnId }) })
      : undefined),
    [hasRowSelect],
  );

  const toggleSort = useCallback(
    (column: ResolvedColumn) => {
      const next = nextSort(sort, column);
      if (!isSortControlled) setUncontrolledSort(next);
      onSortChange?.(next);
    },
    [sort, isSortControlled, onSortChange],
  );

  // `rows`/`columns` are the LIVE visible sets, so the suppressed marker's
  // footnote appears exactly when a marker is on screen — including when the
  // reader expands the row that holds it
  // A bar scales to, and an arrow takes its angle from, the largest value
  // among the rows the grid draws, as the SVG and the arrow key count them:
  // a collapsed subtree's largest change does not set the angles.
  const barMaxima = useMemo(
    () => table && inCellBarMaxima(rows, columns),
    [table, rows, columns],
  );
  // The sparkline cell draws the same mini chart the SVG does: one
  // domain per column over the drawn rows, and the box is the column's own
  // track, so the two surfaces put the same point in the same place.
  const sparkDomains = useMemo(
    () => (table ? sparklineDomains(columns, rows) : new Map<Id, SparklineDomain>()),
    [table, columns, rows],
  );
  // The heat lane per column, so the React cell tints exactly as the SVG
  // rect does: same emission, same ink switch.
  const heatLanes = useMemo(
    () => (table ? heatRanges(columns, rows) : new Map<Id, HeatRange>()),
    [table, columns, rows],
  );
  // The grounds: the top-level groups on the emphasis, their own parents on
  // the band, everything under them on the panel, and none at all under the
  // benchmark preset.
  const grounds = useMemo(
    () => (table && presetLanguage(tableOptions?.variant).groupBand ? rowGrounds(table) : new Map<Id, 'emphasis' | 'band'>()),
    [table, tableOptions?.variant],
  );
  const sparkWidths = useMemo(
    () => new Map(tracks.filter((track) => track.width > 0).map((track) => [track.id, track.width])),
    [tracks],
  );
  // The tree children, which is the set `hasChildren` is drawn from: a MoM
  // or YoY line prints inside its parent's cells and is no child of it, so a
  // KPI with two sub-KPIs and two lines hides two rows and says two.
  const childCounts = useMemo(
    () => (table ? treeChildCounts(table) : new Map<Id, number>()),
    [table],
  );

  // The drawn tree: every row keeps its element, collapsed or not, so the
  // fold animates the same path both ways.
  const rowTree = useMemo(() => tableRowTree(table?.rows ?? [], rootsHidden), [table, rootsHidden]);
  const rowPages = useMemo(() => rowWindowed ? Array.from({ length: Math.ceil(rowTree.length / ROW_PAGE) }, (_, index) => rowTree.slice(index * ROW_PAGE, (index + 1) * ROW_PAGE)) : [], [rowWindowed, rowTree]);
  // A dimswitch's disclosures ride on the props in ENGINE_NOTES; the request normalisation keeps string keys only.
  const engineNotes = (options as { [ENGINE_NOTES]?: string[] })[ENGINE_NOTES];
  // The footnotes walk every cell: once per table and fold state, not on each scroll render.
  const frameMemo = useMemo(() => table === undefined || tableOptions === undefined ? undefined
    : tableFrame(table, engineNotes ? { ...tableOptions, [ENGINE_NOTES]: engineNotes } as TableOptions : tableOptions, rows, columns),
  [table, tableOptions, engineNotes, rows, columns]);
  // A group that draws no heading keeps its meaning and gives up its row
  // in the head: where no group draws one, the head is one row.
  const headRowCount = (table?.columnGroups ?? []).some((group) => group.heading !== false) ? 2 : 1;
  const isTree = (table?.rows ?? []).some((row) => row.hasChildren);
  const rowIndices = useMemo(() => new Map(rows.map((row, index) => [row.id, index + headRowCount + 1])), [rows, headRowCount]);
  const columnIndices = useMemo(() => new Map(columns.map((column, index) => [column.id, index + 1])), [columns]);

  const wrap = (content: ReactElement) => {
    const body = size === 'container'
      ? <div ref={container.wrapperRef} data-bp-container={fit} style={fillHeight ? { height: '100%' } : undefined}>
        {container.probed && <div data-bp-probe="" aria-hidden="true" style={PROBE_STYLE} />}
        {content}
      </div> : content;
    return idPrefix === undefined ? body : <IdPrefixContext.Provider value={checkedIdPrefix(idPrefix)}>{body}</IdPrefixContext.Provider>;
  };
  // The last hook is above, so this return costs no hook: React sees the
  // same calls in the same order on the pass that draws the table.
  const refusedOptions = [
    ...refusedProps,
    ...heatEncodingRefusals((stableOptions as { encodings?: Record<string, unknown> }).encodings),
    ...refusalFindings(colorblindWarnings),
    // The table is the vertical scroll owner under fillHeight, so it cannot also pin its head to the page.
    ...(pageHead && fillHeight ? [{
      code: 'invalid-options',
      message: "stickyLabels.head 'page' cannot be used with fillHeight: fillHeight makes the table the vertical scroll box, so the head cannot follow the page scroll",
      path: 'options.stickyLabels.head',
      suggest: "Set stickyLabels.head to 'table' so the head pins inside the table's scroll box, or remove fillHeight to pin it to the page.",
      fix: [{ op: 'replace' as const, path: '/options/stickyLabels/head', value: 'table' }],
    }] : []),
  ];
  // The export lays out the request this table resolved, with the rows, column groups and inline lines the reader
  // sees, at its width on screen; its height follows its rows. A column sort is reader state the core never draws.
  // Only a table that drew hands over a snapshot: a refusal card or the busy box exports nothing.
  const drew = refusedOptions.length === 0 && !floorAttempt.deferred && !!resolved && !!table && !!theme && !!tableOptions
    && stylesheet !== undefined && !sized?.refused && !settling;
  // The paint request: a theme switch keeps the layout request but repaints the grid. A grid wider than its box
  // exports at the width it scrolls at.
  const exported = useMemo((): DrawnChart | undefined => exporter && drew && request ? {
    request: { ...request, options: { ...request.options,
      expansion: { depth: 'all', collapsed: [...collapsedSet], expanded: openParents(table, collapsedSet), rootsHidden },
      columnVisibility,
      inlineVisibility } as TableOptions & typeof request.options },
    data,
    frame: { width: Math.max(request.size.width, contentWidth ?? 0) },
    pinnedHeight: false,
    // A DimSwitch's document is its own spec at the view on screen: the compiled table is internal.
    ...(originalFloorRequest === undefined ? {} : { source: { type: originalFloorRequest.type, data: originalFloorRequest.data,
      options: Object.fromEntries(Object.entries({ ...originalFloorRequest.options as Record<string, unknown>,
        expansion: { expanded: openParents(table, collapsedSet), collapsed: [...collapsedSet] }, columnVisibility, inlineVisibility })
        .filter(([, value]) => value !== undefined)) } }),
  } : undefined, [exporter, drew, request, data, table, collapsedSet, rootsHidden, columnVisibility, inlineVisibility, contentWidth, originalFloorRequest]);
  useExportLink(exporter, exported);
  if (refusedOptions.length && request?.theme) return wrap(<LayoutRefusal refusals={refusedOptions} theme={request.theme} options={request.options} size={request.size} />);
  if (floorAttempt.deferred || !resolved || !table || !theme || !tableOptions || stylesheet === undefined) {
    return wrap(<LoadingPlaceholder theme={stableOptions.theme} failure={failure ?? floorFailure} options={{ ...stableOptions, target }} />);
  }

  const frame = frameMemo!;
  // The footnotes and the source line keep the cell's own air on both sides,
  // so at canvas margin 0 their text never meets the card's edge.
  const figureStyle = {
    ...(frame.padding === undefined ? {} : { padding: frame.padding }),
    '--bp-note-indent': `${padX}px`,
  } as CSSProperties;
  const withInteraction = (content: ReactElement) => flags
    ? <TableHoverFrame
        flags={flags}
        styleNonce={styleNonce}
        table={table}
        rows={rows}
        columns={columns}
        request={request as ResolvedChartRequest<TableData, TableOptions>}
        theme={theme}
        initialPrepared={initialPrepared}
        refused={sized?.refused}
        portal={portalContainer}
        inlineVisibility={inlineVisibility}
      >{content}</TableHoverFrame>
    : content;
  if (sized?.refused) return wrap(settling ? <LoadingPlaceholder theme={theme} size={sized.size} options={tableOptions} /> : withInteraction(
    <SizePlaceholder result={sized} theme={theme} options={tableOptions} onRefused={onRefused} renderRefused={renderRefused} />,
  ));

  const stickyObject = typeof stickyLabels === 'object' && stickyLabels !== null;
  const stickyVars = stickyObject ? {
    ...(pageHead ? { '--bp-sticky-top': `${sticky.top}px` } : {}),
    ...(sticky.sections ? { '--bp-sections-top': sticky.head === 'page' ? `calc(${sticky.top}px + var(--bp-head-h,0px))` : sticky.head === 'table' ? 'var(--bp-head-h,0px)' : '0px' } : {}),
  } : undefined;
  // The scroller takes the grid's name once it overflows (markScrollRegion).
  scrollLabel.current = frame.title || (typeof tableOptions.title === 'string' ? tableOptions.title : 'Table');
  const gridProps = {
    role: isTree ? 'treegrid' : 'grid',
    'aria-label': scrollLabel.current,
    className: 'bp-table bp-table-grid',
    'aria-describedby': summaryId,
    'aria-rowcount': rows.length + headRowCount,
    'aria-colcount': columns.length,
    'data-bp-table-theme': themeScope,
    'data-bp-variant': tableOptions.variant ?? 'hierarchy',
    'data-bp-tree': isTree ? '' : undefined,
    'data-bp-operators': operatorSlot > 0 ? '' : undefined,
    'data-bp-reach': frameStart > 0 ? '' : undefined,
    'data-bp-readonly': isTree && readOnlyTree ? '' : undefined,
    'data-bp-sticky': sticky.on ? '' : undefined,
    // Only the object form writes these: a `true` or a number draws the 0.27 markup.
    'data-bp-sticky-head': stickyObject && sticky.on ? (sticky.head === false ? 'off' : sticky.head) : undefined,
    'data-bp-sticky-sections': stickyObject && sticky.sections ? '' : undefined,
    'data-bp-scrolled': scrolled ? '' : undefined,
    'data-bp-group-rule': (tableOptions.groupRule ?? 'span') === 'span' ? 'span' : undefined,
    'data-bp-group-align': tableOptions.groupAlign === 'left' || tableOptions.groupAlign === 'right' ? tableOptions.groupAlign : undefined,
    // The right end: every row closes on a hairline in the group
    // divider's ink, or the head rule's where no group opens with a
    // divider. A cohort grid keeps its open matrix edge, as in the SVG,
    // and so does a theme with `table.endRule: 'none'`.
    'data-bp-mark-style': theme?.table?.mark ?? (tableOptions.variant === 'steering' ? 'boxed' : 'bare'),
    'data-bp-end': undefined,
    'data-bp-density': density,
    // A row label takes two lines before its cut (`rowLabelLines`), as on the SVG.
    'data-bp-label-lines': tableOptions.rowLabelLines === 1 ? '1' : undefined,
    // 'sorted' keeps the chevron on the sorted header alone; the other
    // sortable headers keep its reserve, so no track moves.
    'data-bp-sort-indicator': tableOptions.sortIndicator === 'sorted' ? 'sorted' : undefined,
    'data-bp-figures': figures ? undefined : 'off',
    'data-bp-wired': '',
    onKeyDown: grid.onKeyDown,
    onFocusCapture: grid.onFocusCapture,
    onBlurCapture: grid.onBlurCapture,
  } as const;
  const headGroup = (
    <TableHead
      table={table}
      columnIndices={columnIndices}
      columns={allColumns}
      hiddenColumns={hiddenColumns}
      spans={spans}
      groupMarks={groupMarks}
      sortableIds={sortableIds}
      sort={sort}
      onToggleSort={toggleSort}
      pinned={pinned}
      trackColumn={trackColumn}
      theme={theme}
      windowIds={windowIds}
      wideGroups={wideGroups}
    />
  );
  const rowShared: SharedRowProps = {
    palette: tableOptions.palette,
    rowIndices,
    columnIndices,
    isTree,
    columns: allColumns,
    hiddenColumns,
    collapsedSet,
    closers,
    mountCollapsed: tableOptions.mountCollapsed !== false,
    anchorWash: tableOptions.anchorWash === true,
    barMaxima: barMaxima!,
    grounds,
    groundMode: tableOptions.groupGround ?? theme.table?.groupGround ?? 'expanded',
    heatLanes,
    sparkDomains,
    sparkWidths,
    theme,
    measure: request?.fontMetrics ?? defaultMeasurer,
    groupMarks,
    levelNouns: table.levelNouns,
    childCounts,
    inlineVisibility,
    onToggleRow: toggleRow,
    readOnly: readOnlyTree,
    staticMarks: readOnlyTree && tableOptions.outlineMarks === true,
    onSelect: selectRow,
    selectable: isRowSelectable,
    labelLead: rowLabelLead,
    filler,
    focus: grid.focus,
    pinned,
    trackColumn,
    columnEdges,
    figures,
    foldOn,
    liteSlots,
    columnPlan,
  };
  const rowGroup = (node: TableRowNode) => <TableRowGroup key={node.row.id} node={node} hidden={false} {...rowShared} />;
  const floatHeading = floatId === undefined ? undefined : table.rows.find((row) => row.id === floatId);
  // Inner scroll mode, `sections: true`: wrap each section heading with the rows after it, so its row can stay under the head
  // until the next section starts. No wrapper is drawn without the option.
  const bodyGroup = (
    <div role="rowgroup" data-bp-rowgroup="body">
      {rowWindowed ? rowPages.map((nodes, index) => <TableRowPage key={index} {...rowShared} nodes={nodes} index={index} contain={containRowPages && !labelsWrap && !printing}
        filler={frameReach === 0 && gridWidth >= container.size.width ? undefined : filler}
        light={!printing && !rowPagesInView.has(index) && !nodes.some(node => node.row.id === grid.focus?.rowId)} />)
        : sticky.sections && !pageHead
        ? sectionScopes(rowTree).map((item) => 'scope' in item
          ? <div key={`scope:${item.scope}`} className="bp-section-scope">{item.nodes.map(rowGroup)}</div>
          : rowGroup(item))
        : rowTree.map(rowGroup)}
    </div>
  );

  const figure = (
    <figure ref={displayRef} className="bp-table" data-bp-chart="table" data-bp-table-theme={themeScope} data-bp-motion={provider?.motion} data-bp-mount={tableOptions.mountCollapsed === false ? 'open' : undefined} data-bp-density={density} data-bp-mode={frame.mode === 'compact' ? 'compact' : undefined} data-bp-fill-height={fillHeight ? '' : undefined} style={figureStyle}>
      <TableThemeStyle stylesheet={stylesheet} scope={themeScope} nonce={styleNonce} />
      {/* `legend: 'none'` drops the key row, as on the SVG. */}
      <TableCaption frame={frame} theme={theme}
        keyEntries={tableOptions.legend === 'none' ? [] : heatKey(columns, heatLanes, theme, tableOptions.strings, tableOptions.locale?.language)}
        arrowEntries={tableOptions.legend === 'none' ? [] : arrowKey(columns, rows)} />
      <p id={summaryId} className="bp-summary">{frame.summary}</p>
      <TableColumnToggles toggles={toolbar ? table.columnToggles : []} visibility={columnVisibility} onToggle={toggleColumns} />
      {pageHead ? (
        // Page mode (`stickyLabels.head: 'page'`): the live head sits OUTSIDE the box that scrolls sideways, so the page
        // scroll can pin it; an overflow ancestor would capture `position: sticky`. The head box follows the body's
        // sideways scroll (see the scroll effect), and the table stays one grid.
        <div ref={grid.tableRef} {...gridProps} style={{ ...gridStyle, ...scrollStyle, ...stickyVars, ...printFit, '--bp-pin-end': `${pinEnd}px` } as CSSProperties}>
          <div ref={setHeadBox} className="bp-page-head">{headGroup}</div>
          {sticky.sections ? (
            <div className="bp-section-float" aria-hidden="true">
              <div ref={setFloatClip} className="bp-section-float-clip" style={{ visibility: 'hidden' }}>
                <div ref={setFloatInner} className="bp-section-float-inner">
                  {floatHeading === undefined ? null : (
                    <TableGridRow row={floatHeading} collapsed={false} hidden={false} floating {...rowShared} readOnly staticMarks={tableOptions.outlineMarks === true} onSelect={undefined} selectable={undefined} focus={undefined} />
                  )}
                </div>
              </div>
            </div>
          ) : null}
          <div ref={setScroller} className="bp-scroll">{bodyGroup}</div>
        </div>
      ) : (
        <div ref={setScroller} className="bp-scroll" style={scrollStyle}>
          <div ref={grid.tableRef} {...gridProps} style={{ ...gridStyle, ...stickyVars, ...printFit, '--bp-pin-end': `${pinEnd}px` } as CSSProperties}>
            {headGroup}
            {bodyGroup}
          </div>
        </div>
      )}
      {frame.footnotes.length > 0 ? (
        <ul className="bp-footnotes">
          {frame.footnotes.map((footnote, index) => (
            <li key={`${index}:${footnote}`}>{footnote}</li>
          ))}
        </ul>
      ) : null}
      {frame.pointer ? (
        // The author's notes the placement keeps out of the frame (footer rule), behind a native disclosure.
        // Print shows the list open in place of the disclosure, as ChartFooter's panel does: a closed
        // <details> keeps its content out of print in browsers without ::details-content.
        <>
          <details className="bp-notes">
            <summary>{frame.pointer}</summary>
            <ul className="bp-footnotes">{frame.listed.map((note, index) => <li key={`${index}:${note}`}>{note}</li>)}</ul>
          </details>
          <div className="bp-notes-print"><ul className="bp-footnotes">{frame.listed.map((note, index) => <li key={`${index}:${note}`}>{note}</li>)}</ul></div>
        </>
      ) : null}
      {frame.source ? <p className="bp-source">{frame.source}</p> : null}
    </figure>
  );
  return wrap(withInteraction(figure));
}

/** Scroll a box sideways; a document without `scrollTo` (jsdom) sets the offset. */
function scrollBoxTo(box: HTMLElement, left: number, behavior: ScrollBehavior | undefined): void {
  if (typeof box.scrollTo === 'function') box.scrollTo({ left, ...(behavior === undefined ? {} : { behavior }) });
  else box.scrollLeft = left;
}

/** Keep controls above the table so hiding a column group cannot hide its toggle. */
function TableColumnToggles({ toggles, visibility, onToggle }: {
  toggles: ResolvedTable['columnToggles'];
  visibility: Record<Id, boolean>;
  onToggle: (id: Id) => void;
}): ReactElement | null {
  return toggles.length ? <div className="bp-col-toolbar" role="group" aria-label="Column groups">
    {toggles.map(toggle => <button
      key={toggle.id}
      type="button"
      className="bp-col-toggle"
      data-bp-toggle-cols={toggle.id}
      data-bp-default-visible={String(toggle.visible)}
      aria-pressed={visibility[toggle.id] ?? toggle.visible}
      onClick={() => onToggle(toggle.id)}
    >{toggle.label}</button>)}
  </div> : null;
}

function TableCaption({ frame, keyEntries, arrowEntries, theme }: {
  frame: ReturnType<typeof tableFrame>;
  /** The heat lane's swatch key, drawn under the subtitle as the SVG frame draws it. */
  keyEntries: readonly HeatKeyEntry[];
  /** The arrow shapes the grid draws, keyed in the same row. */
  arrowEntries: readonly ArrowKeyEntry[];
  theme: Theme;
}): ReactElement | null {
  const keyed = keyEntries.length + arrowEntries.length > 0;
  if (!frame.title && !frame.subtitle && !keyed) return null;
  return <figcaption>
    {frame.title ? <span className="bp-title">{frame.title}
      {frame.markerNotes ? <sup className="bp-footnote-marker" aria-label={frame.markerNotes}>1</sup> : null}
    </span> : null}
    {frame.title && frame.subtitle ? ' ' : null}
    {frame.subtitle ? <span className="bp-subtitle">{frame.subtitle}</span> : null}
    {keyed ? <span className="bp-key" role="list" aria-label="Key">
      {keyEntries.map((entry) => <span key={entry.id} role="listitem">
        <i aria-hidden="true" style={{ background: resolvePaint(entry.fill, theme) }} />{entry.label}
      </span>)}
      {arrowEntries.map((entry) => <span key={entry.id} role="listitem">
        <b className="bp-key-glyph">{entry.glyph}</b>{entry.label}
      </span>)}
    </span> : null}
  </figcaption>;
}

interface GroupMarks {
  banded: ReadonlySet<Id>;
  groupStart: ReadonlySet<Id>;
  /** The last column of a banded block that ends the drawn columns under `rowExtent: 'frame'`: it closes on the divider. */
  groupEnd: ReadonlySet<Id>;
  /** Ungrouped columns after a banded group: their group-row cell carries the divider the group's right edge draws. */
  groupRowStart: ReadonlySet<Id>;
  /** Heat lanes under `figures: false`: grounds alone in a 22 px track. */
  groundsOnly: ReadonlySet<Id>;
  /** The SVG draws a group or band divider, so the right end takes its ink. */
  divided: boolean;
}

/** One top-level row and everything under it; the tree the grid renders. */
interface TableRowNode {
  row: ResolvedRow;
  children: TableRowNode[];
}

/** The parents open on screen. An export names them, since a generated Others row starts folded even at depth 'all'. */
function openParents(table: ResolvedTable | undefined, collapsed: ReadonlySet<Id>): Id[] {
  const rows = table?.rows ?? [];
  const foldable = new Set(rows.filter((row) => row.foldable !== false).map((row) => row.id));
  return [...new Set(rows.map((row) => row.parentId))].filter((id): id is Id => id !== undefined && foldable.has(id) && !collapsed.has(id));
}

/**
 * The drawn rows as a tree. Inline rows are not rows: they print inside their
 * parent's cells, so they never appear here. `rootsHidden` drops the
 * level-0 data rows with everything under them and keeps the totals and the
 * section headings, which is the totals-only step of a depth control.
 */
function tableRowTree(rows: readonly ResolvedRow[], rootsHidden = false): TableRowNode[] {
  const nodes = new Map<Id, TableRowNode>();
  const roots: TableRowNode[] = [];
  for (const row of rows) {
    if (row.inline === true) continue;
    nodes.set(row.id, { row, children: [] });
  }
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (node === undefined) continue;
    const parent = row.parentId === undefined ? undefined : nodes.get(row.parentId);
    // A section heading is not a tree parent, so a KPI a section OWNS is
    // still a top-level data row and `rootsHidden` drops it with its
    // subtree; the heading itself stays.
    // A root authored foldable: false never folds, so it stays with its subtree, and so does a
    // root under a section heading authored foldable: false.
    if (rootsHidden && row.role === 'data' && row.foldable !== false
      && (parent === undefined || (parent.row.role === 'section' && parent.row.foldable !== false))) continue;
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}

type SectionScope = { scope: Id; nodes: TableRowNode[] };

/** Each section heading with the rows up to the next section; a total or a row before the first section stands alone. */
function sectionScopes(nodes: readonly TableRowNode[]): (TableRowNode | SectionScope)[] {
  const items: (TableRowNode | SectionScope)[] = [];
  let open: SectionScope | undefined;
  for (const node of nodes) {
    if (node.row.role === 'section') {
      open = { scope: node.row.id, nodes: [node] };
      items.push(open);
    } else if (open !== undefined && node.row.role !== 'total') open.nodes.push(node);
    else {
      open = undefined;
      items.push(node);
    }
  }
  return items;
}

/** A number opens descending, a name or a date ascending. */
function firstSortDirection(column: ResolvedColumn): TableSort['direction'] {
  return column.kind === 'value' || column.kind === 'computed' ? 'desc' : 'asc';
}

/**
 * The chevron of a sortable header: the 8 px outline stroke the tree toggle
 * draws, pointing the way the column is sorted — or, on a column nobody has
 * sorted yet, the way the next click will sort it.
 */
function SortChevron({ direction }: { direction: TableSort['direction'] }): ReactElement {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <path
        d={direction === 'asc' ? 'M1 5l3-3 3 3' : 'M1 3l3 3 3-3'}
        stroke="currentColor"
        strokeWidth="var(--bp-stroke-mark)"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * The next state of a sortable header. A number opens descending,
 * the order an analyst reads a ranking in; a name or a date opens ascending.
 * The third click clears the sort, so the authored order is always one more
 * click away.
 */
function nextSort(current: TableSort | null | undefined, column: ResolvedColumn): TableSort | null {
  const first = firstSortDirection(column);
  if (!current || current.column !== column.id) return { column: column.id, direction: first };
  if (current.direction === first) {
    return { column: column.id, direction: first === 'desc' ? 'asc' : 'desc' };
  }
  return null;
}

interface TableHeadProps {
  columnIndices: ReadonlyMap<Id, number>;
  table: ResolvedTable;
  columns: readonly ResolvedColumn[];
  hiddenColumns: ReadonlySet<Id>;
  spans: ReturnType<typeof groupSpans>;
  groupMarks: GroupMarks;
  sortableIds: ReadonlySet<Id>;
  sort: TableSort | null;
  onToggleSort: (column: ResolvedColumn) => void;
  pinned: ReadonlyMap<Id, { left: number; last: boolean }>;
  trackColumn: ReadonlyMap<Id, number> | undefined;
  /** The head's case comes from `table.head.case`. */
  theme: Pick<Theme, 'table'> | undefined;
  /** The columns a windowed table builds; undefined builds every column. */
  windowIds: ReadonlySet<Id> | undefined;
  /** Groups wider than the scroll box beside the pinned columns. */
  wideGroups: ReadonlySet<Id>;
}

/** A group header starts at its leftmost reachable member: `columnGroups[].columns` need not follow display order. */
function groupColIndex(ids: readonly Id[], indices: ReadonlyMap<Id, number>): number | undefined {
  let first: number | undefined;
  for (const id of ids) {
    const index = indices.get(id);
    if (index !== undefined && (first === undefined || index < first)) first = index;
  }
  return first;
}

function TableHead({
  columnIndices,
  table,
  columns,
  hiddenColumns,
  spans,
  groupMarks,
  sortableIds,
  sort,
  onToggleSort,
  pinned,
  trackColumn,
  theme,
  windowIds,
  wideGroups,
}: TableHeadProps): ReactElement {
  // A sub-label is a second line under the label. Where one column
  // in the row has one, every other head cell reserves the same line, so the
  // primary labels keep one baseline instead of the bottom-aligned cells
  // pushing the single-line ones down onto it.
  const hasSubLabels = columns.some((column) => column.subLabel !== undefined);
  const groupById = new Map(table.columnGroups.map((group) => [group.id, group]));
  const spanById = new Map(spans.map((span) => [span.id, span]));
  const collapsedVisibility = Object.fromEntries(
    table.columnToggles.map((toggle) => [toggle.id, false]),
  );
  const collapsedSpanById = new Map(
    groupSpans(table, visibleColumns(table, collapsedVisibility)).map((span) => [
      span.id,
      span.span,
    ]),
  );
  const togglesByGroup = new Map<Id, typeof table.columnToggles>();
  for (const toggle of table.columnToggles) {
    const groupId = table.columns.find((column) =>
      toggle.columnIds.includes(column.id),
    )?.groupId;
    if (groupId === undefined) continue;
    const toggles = togglesByGroup.get(groupId) ?? [];
    toggles.push(toggle);
    togglesByGroup.set(groupId, toggles);
  }

  // A head cell whose track opens from zero grows over the layout transition.
  // It keeps its label on one line (`data-bp-opening`) until the track is
  // full width, so the head row does not stretch while the track is narrow.
  const headRef = useRef<HTMLDivElement>(null);
  const lastHidden = useRef(hiddenColumns);
  useLayoutEffect(() => {
    const was = lastHidden.current;
    lastHidden.current = hiddenColumns;
    const head = headRef.current;
    const row = head?.querySelector('[role="row"]');
    if (!head || !row || was === hiddenColumns) return;
    const ms = parseFloat(getComputedStyle(row).transitionDuration) * 1000;
    if (!(ms > 0)) return;
    const opened = (ids: readonly Id[]) => ids.every((id) => was.has(id)) && ids.some((id) => !hiddenColumns.has(id));
    const cells = [...head.querySelectorAll<HTMLElement>('[data-col-id],[data-group-id]')].filter((cell) =>
      cell.dataset.colId !== undefined
        ? opened([cell.dataset.colId])
        : opened(groupById.get(cell.dataset.groupId!)?.columnIds ?? []));
    cells.forEach((cell) => cell.setAttribute('data-bp-opening', ''));
    const done = () => cells.forEach((cell) => cell.removeAttribute('data-bp-opening'));
    const timer = setTimeout(done, ms);
    return () => { clearTimeout(timer); done(); };
  }, [hiddenColumns]);

  // Every column stays in the DOM, hidden or not, so the track list keeps its
  // shape and the browser can interpolate it. A group heading spans
  // all of its member tracks and fades out when every one of them is closed.
  const renderedGroups = new Set<Id>();
  const groupCells: ReactElement[] = [];
  for (const column of columns) {
    if (column.groupId === undefined) {
      if (windowIds !== undefined && !windowIds.has(column.id)) continue;
      groupCells.push(
        <div key={`ungrouped:${column.id}`} role="columnheader" aria-hidden="true"
          data-bp-hidden={hiddenColumns.has(column.id) ? '' : undefined}
          data-bp-group-start={groupMarks.groupRowStart.has(column.id) ? '' : undefined}
          data-bp-pin={pinned.has(column.id) ? '' : undefined}
          style={headCellStyle(pinned.get(column.id), trackColumn?.get(column.id))} />,
      );
      continue;
    }
    if (renderedGroups.has(column.groupId)) continue;
    renderedGroups.add(column.groupId);
    const group = groupById.get(column.groupId);
    const span = spanById.get(column.groupId);
    if (group === undefined || span === undefined) continue;
    const toggles = togglesByGroup.get(group.id) ?? [];
    groupCells.push(
      <div
        key={group.id}
        role="columnheader"
        // A group with nothing drawn spans nothing a reader can reach, and
        // `aria-colspan="0"` is not a number ARIA accepts; the cell is
        // hidden from the tree instead.
        aria-colspan={span.span > 0 ? span.span : undefined}
        aria-colindex={groupColIndex(group.columnIds, columnIndices)}
        aria-hidden={span.span === 0 ? 'true' : undefined}
        style={{
          gridColumn: trackColumn === undefined
            ? `span ${span.fullSpan}`
            : `${trackColumn.get(column.id) ?? 1} / span ${span.fullSpan}`,
        }}
        data-group-id={group.id}
        data-colspan-full={toggles.length > 0 ? span.fullSpan : undefined}
        data-colspan-visible={
          toggles.length > 0 ? collapsedSpanById.get(group.id) : undefined
        }
        data-bp-hidden={span.span === 0 ? '' : undefined}
        data-bp-band={group.band === true ? '' : undefined}
        data-bp-group-wide={wideGroups.has(group.id) ? '' : undefined}
        data-bp-group-start={groupMarks.groupStart.has(column.id) ? '' : undefined}
        data-bp-group-end={group.columnIds.some((id) => groupMarks.groupEnd.has(id)) ? '' : undefined}
        // A group that draws no heading keeps its span and its divider, and
        // its label names the columns for a reader who cannot see them.
        aria-label={group.heading === false ? group.label : undefined}
      >
        {group.heading === false ? null : (
          <span>{group.label}{group.note === undefined ? null : <span className="bp-group-note"> · {group.note}</span>}</span>
        )}
      </div>,
    );
  }

  return (
    <div ref={headRef} role="rowgroup" data-bp-rowgroup="head">
      {table.columnGroups.some((group) => group.heading !== false)
        ? <div className="bp-groups" role="row" aria-rowindex={1}>{groupCells}</div>
        : null}
      <div className="bp-columns" role="row" aria-rowindex={table.columnGroups.some(group => group.heading !== false) ? 2 : 1}>
        {columns.map((column) => {
          if (windowIds !== undefined && !windowIds.has(column.id)) {
            return hiddenColumns.has(column.id) ? null : (
              <div key={column.id} role="columnheader" aria-colindex={columnIndices.get(column.id)} data-bp-lite="" style={liteStyle(trackColumn?.get(column.id))}>{headText(column, theme)}</div>
            );
          }
          const sortable = sortableIds.has(column.id);
          const active = sortable && sort?.column === column.id ? sort.direction : undefined;
          const text = headText(column, theme);
          return (
            <div
              key={column.id}
              role="columnheader"
              aria-colindex={columnIndices.get(column.id)}
              data-col-id={column.id}
              data-bp-column={column.id}
              data-bp-detail={column.toggleGroup}
              data-bp-hidden={hiddenColumns.has(column.id) ? '' : undefined}
              aria-hidden={hiddenColumns.has(column.id) ? 'true' : undefined}
              aria-sort={
                !sortable ? undefined : active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'
              }
              data-bp-band={groupMarks.banded.has(column.id) ? '' : undefined}
              data-bp-group-start={groupMarks.groupStart.has(column.id) ? '' : undefined}
              data-bp-group-end={groupMarks.groupEnd.has(column.id) ? '' : undefined}
              data-bp-grounds-only={groupMarks.groundsOnly.has(column.id) ? '' : undefined}
              data-emphasis={column.emphasis}
              data-bp-pin={pinned.has(column.id) ? '' : undefined}
              data-bp-pin-last={pinned.get(column.id)?.last === true ? '' : undefined}
              style={headCellStyle(pinned.get(column.id), trackColumn?.get(column.id))}
              className={alignmentClass(column)}
            >
              {sortable ? (
                <button
                  type="button"
                  className="bp-sort"
                  data-bp-sort={column.id}
                  data-bp-sort-direction={active}
                  onClick={() => onToggleSort(column)}
                >
                  <span className="bp-head-label">{text}</span>
                  <SortChevron direction={active ?? firstSortDirection(column)} />
                </button>
              ) : (
                <span className="bp-head-label">{text}</span>
              )}
              {!hasSubLabels ? null : column.subLabel === undefined
                ? <span className="bp-head-sub bp-head-sub-spacer" aria-hidden="true" />
                : <span className="bp-head-sub">{column.subLabel}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A column head as the SVG sets it: the label in capitals, or as
 * authored under `table.head.case: 'asis'`, and the affix as
 * written ("SPEND ($k)").
 */
function headText(column: ResolvedColumn, theme: Pick<Theme, 'table'> | undefined): string {
  return `${columnHeadLabel(column.label, theme ?? {})}${columnHeaderAffix(column)}`;
}

/** The pin offset and the explicit track a head cell carries, or nothing. */
function headCellStyle(
  pin: { left: number; last: boolean } | undefined,
  gridColumn: number | undefined,
): CSSProperties | undefined {
  if (pin === undefined && gridColumn === undefined) return undefined;
  return {
    ...(pin === undefined ? {} : { '--bp-pin-left': `${pin.left}px` }),
    ...(gridColumn === undefined ? {} : { gridColumn }),
  } as CSSProperties;
}

interface SharedRowProps {
  palette?: string;
  rowIndices: ReadonlyMap<Id, number>;
  columnIndices: ReadonlyMap<Id, number>;
  isTree: boolean;
  light?: boolean;
  mountCollapsed: boolean;
  /** Rows that draw a closing rule (view.finalClosers). */
  closers: ReadonlySet<Id>;
  columns: readonly ResolvedColumn[];
  hiddenColumns: ReadonlySet<Id>;
  collapsedSet: ReadonlySet<Id>;
  anchorWash: boolean;
  barMaxima: ReadonlyMap<Id, number>;
  grounds: ReadonlyMap<Id, 'emphasis' | 'band'>;
  /** `options.groupGround`, else the theme key. */
  groundMode: 'expanded' | 'always' | 'none';
  heatLanes: ReadonlyMap<Id, HeatRange>;
  sparkDomains: ReadonlyMap<Id, SparklineDomain>;
  sparkWidths: ReadonlyMap<Id, number>;
  theme: Theme;
  measure: TextMeasurer;
  groupMarks: GroupMarks;
  levelNouns: ResolvedTable['levelNouns'];
  childCounts: ReadonlyMap<Id, number>;
  inlineVisibility: Record<Id, boolean>;
  onToggleRow: (rowId: Id) => void;
  /** A controlled tree the host gave no handler: no toggle, no click, no key. */
  readOnly: boolean;
  /** Opt-in outline marks for a read-only tree. */
  staticMarks: boolean;
  /** The host's row pick, wrapped so its identity stays put across renders. */
  onSelect: ((row: ResolvedRow, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, columnId: Id | undefined) => void) | undefined;
  /** The host's predicate of which rows the pick covers. */
  selectable: ((row: ResolvedRow, state: { collapsed: boolean }) => boolean) | undefined;
  /** A glyph before each row label, in a box its authored width wide. */
  labelLead: TableRowLabelLead | undefined;
  /**
   * The hidden cell of the trailing empty track under `rowExtent: 'frame'`,
   * with its explicit track on a grid with spacers; undefined draws none.
   */
  filler: { gridColumn?: number } | undefined;
  focus: TableGridFocus | undefined;
  /** The pinned core columns and their offsets; empty where nothing pins. */
  pinned: ReadonlyMap<Id, { left: number; last: boolean }>;
  /** 1-based track of each column, on a grid with spacer tracks only. */
  trackColumn: ReadonlyMap<Id, number> | undefined;
  /** Each drawn column's left edge from the grid's start, and the columns that open a group. */
  columnEdges: { left: ReadonlyMap<Id, number>; groupStart: readonly Id[] };
  /** Each column's start and width in the track list, for the runs outside the column window. */
  liteSlots?: ReadonlyMap<Id, { start: number; width: number }>;
  /** The drawn columns by index, and the runs outside the window, while the columns are windowed. */
  columnPlan?: readonly (number | { from: number; to: number })[];
  /** False draws the heat grounds without the figures. */
  figures: boolean;
  /** What folds a parent row (`options.foldOn`); undefined: the toggle for a selectable row, the row otherwise. */
  foldOn: 'row' | 'toggle' | undefined;
  /** The columns a windowed table builds; undefined builds every column. */
}

/**
 * One row and its descendants. The descendants keep their elements while the
 * row is closed (hidden content keeps its element), so the reverse
 * animation runs the same path the forward one did.
 */
function TableRowGroup({ node, hidden, ...shared }: SharedRowProps & {
  node: TableRowNode;
  hidden: boolean;
}): ReactElement {
  const collapsed = shared.collapsedSet.has(node.row.id);
  // A subtree that mounts on open stays mounted while it folds, so it closes as it opens; it unmounts when the fold ends.
  const [closing, setClosing] = useState(false);
  const [seenCollapsed, setSeenCollapsed] = useState(collapsed);
  if (seenCollapsed !== collapsed) {
    setSeenCollapsed(collapsed);
    setClosing(collapsed && !shared.mountCollapsed);
  }
  const closed = useCallback(() => setClosing(false), []);
  return (
    <div className="bp-rowwrap" data-bp-row-wrap={node.row.id}
      data-bp-defer-row={!shared.mountCollapsed && node.children.length === 0 ? '' : undefined}
      style={!shared.mountCollapsed && node.children.length === 0 ? { '--bp-defer-lines': visibleInlineRows(node.row, shared.inlineVisibility).length } as CSSProperties : undefined}>
      <TableGridRow row={node.row} collapsed={collapsed} hidden={hidden} {...shared} />
      {node.children.length > 0 && (shared.mountCollapsed || !collapsed || closing) ? (
        <TableChildren rowId={node.row.id} collapsed={collapsed} onClosed={closing ? closed : undefined}>
          {node.children.map((child) => (
            <TableRowGroup key={child.row.id} node={child} hidden={hidden || collapsed} {...shared} />
          ))}
        </TableChildren>
      ) : null}
    </div>
  );
}

const TableRowPage = memo(function TableRowPage({ nodes, index, contain, ...shared }: SharedRowProps & { nodes: readonly TableRowNode[]; index: number; contain: boolean }) {
  return <div data-bp-row-page={index}
    style={index > 0 && contain ? { contentVisibility: 'auto', blockSize: `calc(var(--bp-row-pitch, calc(round(up, calc((var(--bp-label-size) + var(--bp-size-step)) * var(--bp-line-ratio)), 1px) + 2 * var(--bp-pad-anchor) + var(--bp-stroke-hair))) * ${nodes.length})` } : undefined}>
    {nodes.map(node => <TableRowGroup key={node.row.id} node={node} hidden={false} {...shared} />)}
  </div>;
});

/**
 * The container a parent folds. Its natural height is measured at the moment
 * of the toggle and driven to zero, so the transition has a number to run
 * against; on the way back it ends at `none` and the subtree may grow again.
 */
function TableChildren({ rowId, collapsed, onClosed, children }: {
  rowId: Id;
  collapsed: boolean;
  /** Called once the fold has run, where the subtree unmounts after it. */
  onClosed?: () => void;
  children: ReactNode;
}): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const previous = useRef(collapsed);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null || previous.current === collapsed) return;
    previous.current = collapsed;
    // An open subtree at rest has no inline cap. The stylesheet's
    // `max-height: 0` for a closed one then applied at the first layout read
    // below, starting from `none`, which does not interpolate, so the rows
    // went at once. Pinned before that read, the fold runs the unfold's path.
    if (collapsed && node.style.maxHeight === '') node.style.maxHeight = 'none';
    const natural = node.scrollHeight;
    node.style.maxHeight = collapsed ? `${natural}px` : '0px';
    // Reading the box commits the start value, so the browser has two
    // numbers to interpolate instead of one assignment.
    void node.offsetHeight;
    node.style.maxHeight = collapsed ? '0px' : `${natural}px`;
    // Without a transition (motion reduce, `prefers-reduced-motion`) no
    // transitionend comes to lift the cap, and an open subtree kept the
    // height it had at the toggle: a child opened inside it was cut.
    const still = () => getComputedStyle(node).transitionDuration.split(',').every((duration) => parseFloat(duration) === 0);
    if (!collapsed && still()) {
      node.style.maxHeight = '';
    }
    // Nothing to fold, or no transition to wait for: the subtree goes now.
    if (collapsed && closedRef.current !== undefined && (natural === 0 || still())) closedRef.current();
  }, [collapsed]);
  return (
    <div
      ref={element}
      className="bp-children"
      data-bp-children={rowId}
      data-bp-collapsed={collapsed ? '' : undefined}
      aria-hidden={collapsed ? 'true' : undefined}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== 'max-height') return;
        if (!collapsed && element.current) element.current.style.maxHeight = '';
        if (collapsed) closedRef.current?.();
      }}
    >
      {children}
    </div>
  );
}

/**
 * One drawn row. `aria-expanded` stays on the row header, not on the row:
 * axe is right that a `role=row` inside a `role=table` may not carry it (it
 * belongs to a treegrid row), and the header cell is where the reader's Enter
 * and Space land anyway.
 */
function TableGridRow({
  palette,
  row,
  rowIndices,
  columnIndices,
  isTree,
  light,
  floating = false,
  closers,
  columns,
  hiddenColumns,
  collapsed,
  hidden,
  anchorWash,
  barMaxima,
  grounds,
  groundMode,
  heatLanes,
  sparkDomains,
  sparkWidths,
  theme,
  measure,
  groupMarks,
  levelNouns,
  childCounts,
  inlineVisibility,
  onToggleRow,
  readOnly,
  staticMarks,
  onSelect,
  selectable,
  labelLead,
  filler,
  focus,
  pinned,
  trackColumn,
  columnEdges,
  figures,
  foldOn,
  liteSlots,
  columnPlan,
}: SharedRowProps & { row: ResolvedRow; collapsed: boolean; hidden: boolean; floating?: boolean }): ReactElement {
  // A read-only tree folds where the host says and offers nothing to press.
  // A row authored foldable: false offers neither.
  const foldable = row.hasChildren && row.foldable !== false;
  const toggles = foldable && !readOnly;
  // Opt-in marks show open and closed groups without a control.
  const mark = toggles
    ? <TreeToggle row={row} collapsed={collapsed} hidden={hidden} onToggleRow={onToggleRow} />
    : foldable && staticMarks ? <OutlineMark collapsed={collapsed} /> : null;
  const rowLabel = columns.find((column) => column.kind === 'rowLabel')!;
  const childCount = childCounts.get(row.id) ?? 0;
  // A row-label note prints under the label, so it is a line the whole row
  // pays for: without the same reserved line in every other cell, the
  // change lines under the values sit a line above the ones under the
  // label. The SVG positions the same row as a block.
  const labelNote = row.cells[rowLabel.id]?.note !== undefined;
  // A row the host lets the reader pick; a section heading is none,
  // and neither is a row the host's predicate turns down.
  const selects = onSelect !== undefined && row.role !== 'section' && selectable?.(row, { collapsed }) !== false;
  // What folds the row: a selectable row folds on its mark alone unless the host says 'row', so a
  // click that picks the row for a dialog does not also unfold it.
  const foldsOnRow = toggles && (foldOn ?? (selects ? 'toggle' : 'row')) === 'row';
  const handleRowClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest('a,button')) return;
    if (foldsOnRow) onToggleRow(row.id);
    if (selects) onSelect!(row, event, eventColumn(event));
  };
  // A pick from the keyboard: Enter or Space on one of this row's cells.
  // The fold of a parent's label cell handles its own keys first and marks
  // them handled, so they fold and do not also select.
  const handleRowKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[role="gridcell"],[role="rowheader"]') !== target) return;
    event.preventDefault();
    // The key does what the click does: on the label cell of a row that folds on the row, it folds and selects.
    if (foldsOnRow && target.getAttribute('role') === 'rowheader') onToggleRow(row.id);
    onSelect!(row, event, eventColumn(event));
  };
  // The rung. `data-bp-step` is what the stylesheet's type, weight
  // and air rules select on, floored at the ladder's deepest step so a rung
  // 7 reads as rung 3 instead of falling through to the top one. The indent
  // keeps the unfloored rung: a deeper row still steps 16 px right.
  const step = Math.min(3, row.step);
  // An empty band before the row; the first drawn row takes none.
  const style = {
    '--bp-level': row.step,
    ...(row.spacer === undefined ? {} : { '--bp-row-spacer': `${row.spacer}px` }),
  } as CSSProperties;
  // A section heading is one cell across the whole grid, and its hairline
  // with it. The span is MERGED over whatever `cellAttributes` carries, a
  // pin offset or a heat ground, because that spread writes its own `style`
  // and replaced a span written before it, leaving `grid-column: auto` and a
  // heading the width of the label track.
  const sectionCell = row.role === 'section'
    ? cellAttributes(row.cells[rowLabel.id]!, rowLabel, focus, groupMarks, hiddenColumns, hidden)
    : undefined;
  // The floating copy of a section heading (page mode, `sections: true`) is a picture of the real row: it carries no
  // id a host, a test or the hover could address it by.
  if (floating && sectionCell !== undefined) for (const key of ['data-col-id', 'data-bp-row', 'data-bp-column', 'data-bp-label', 'data-bp-mark']) delete sectionCell[key];
  // Under stickyLabels the heading's text stays at the pinned label
  // column's left while the cell keeps spanning the grid; a sticky cell as
  // wide as its row could not move. A right or centred heading stays put.
  const sectionPin = row.role === 'section' && alignmentClass(rowLabel) === undefined ? pinned.get(rowLabel.id) : undefined;
  // `table.blockRule: 'rule'`: the heading is a cell of the pinned block, so
  // the rule that closes the block runs through it; the rest of the row is
  // an empty cell that carries the heading's line.
  const pinnedSpan = row.role === 'section' && theme.table?.blockRule === 'rule' && trackColumn === undefined && pinned.size > 0
    ? columns.findIndex((column) => !pinned.has(column.id)) : -1;
  // The dividers a section heading's cells draw, at their offsets inside each
  // cell. A pinned heading cell draws the pinned group starts, the rest of
  // its row the others; a heading across the grid draws the ones that
  // scroll with it, and a pinned one only where nothing pins.
  const restStart = pinnedSpan > 0 ? columnEdges.left.get(columns[pinnedSpan]!.id) ?? 0 : 0;
  const sectionRules = (inPinned: boolean, start: number) => row.role !== 'section' ? null
    : columnEdges.groupStart.filter((id) => (pinnedSpan > 0 ? pinned.has(id) === inPinned : !pinned.has(id)))
      .map((id) => <span key={id} aria-hidden="true" className="bp-section-rule" style={{ insetInlineStart: `${columnEdges.left.get(id)! - start}px` }} />);

  return (
    <div
      role="row"
      className={row.role === 'total' && row.kind !== 'result' && row.kind !== 'driver' ? 'bp-total' : undefined}
      aria-rowindex={hidden || floating ? undefined : rowIndices.get(row.id)}
      aria-level={isTree && !floating ? row.level + 1 : undefined}
      aria-expanded={isTree && foldable && !floating ? !collapsed : undefined}
      data-row-id={floating ? undefined : row.id}
      data-bp-row={floating ? undefined : row.id}
      data-bp-floating={floating ? '' : undefined}
      data-parent-id={row.parentId}
      data-has-children={row.hasChildren ? 'true' : undefined}
      data-bp-kind={row.kind}
      data-bp-driver-tone={row.driverTone ? '' : undefined}
      data-bp-final={closers.has(row.id) ? '' : undefined}
      data-bp-divider={row.divider ? '' : undefined}
      data-bp-member-open={row.kind === 'member' && row.hasChildren && !collapsed ? '' : undefined}
      data-bp-ground={row.kind === 'member' ? (row.hasChildren && !collapsed && groundMode !== 'none' ? 'band' : undefined) : row.kind === 'measure' || row.kind === 'detail' || row.kind === 'split' || row.kind === 'subtotal' || row.kind === 'result' || row.kind === 'driver' ? undefined : row.role === 'total' ? 'emphasis' : (groundMode === 'always' || (groundMode === 'expanded' && row.hasChildren && !collapsed)) && grounds.has(row.id) ? 'band' : undefined}
      data-anchor={anchorWash && row.step === 0 && row.hasChildren ? '' : undefined}
      data-level={row.level}
      data-bp-step={step}
      data-role={row.role}
      data-relation={row.relation}
      data-highlight-tone={row.highlightTone}
      data-bp-spacer={row.spacer === undefined ? undefined : ''}
      data-bp-selectable={selects ? '' : undefined}
      style={style}
      onClick={foldsOnRow || selects ? handleRowClick : undefined}
      onKeyDown={selects ? handleRowKey : undefined}
    >
      {row.role === 'section' ? (
        <div
          role="rowheader"
          aria-colindex={1}
          aria-colspan={columnIndices.size}
          {...sectionCell}
          {...(toggles ? expandableCellProps(row, collapsed, onToggleRow, foldsOnRow && !selects) : {})}
          data-bp-section-pin={sectionPin === undefined || pinnedSpan > 0 ? undefined : ''}
          data-bp-pin={pinnedSpan > 0 ? '' : undefined}
          data-bp-pin-last={pinnedSpan > 0 ? '' : undefined}
          style={{ ...(sectionCell?.style as CSSProperties | undefined),
            ...(sectionPin === undefined ? {} : { '--bp-pin-left': `${sectionPin.left}px` }), gridColumn: pinnedSpan > 0 ? `1 / ${pinnedSpan + 1}` : '1 / -1' } as CSSProperties}
        >
          {sectionRules(true, 0)}
          {row.badge === undefined ? (
            <CellContent
              cell={row.cells[rowLabel.id]!}
              column={rowLabel}
              row={row}
              mark={mark}
              after={<CollapsedHint row={row} collapsed={collapsed} count={childCount} levelNouns={levelNouns} />}
            />
          ) : (
            // The heading's text gives way, the chip never does. Its
            // paints are chipPaints, the SVG's, through the chip variables.
            // The line carries the mark too, so mark, heading and chip share one centre.
            <span className="bp-section-line">
              {mark}
              <CellContent cell={row.cells[rowLabel.id]!} column={rowLabel} row={row} />
              <span className="bp-section-badge" data-tone={row.badge.tone === 'neutral' ? undefined : row.badge.tone}>
                <span className="bp-chip">{row.badge.text}</span>
              </span>
              <CollapsedHint row={row} collapsed={collapsed} count={childCount} levelNouns={levelNouns} />
            </span>
          )}
        </div>
      ) : null}
      {pinnedSpan > 0 ? <div aria-hidden="true" data-bp-section-rest="" style={{ gridColumn: `${pinnedSpan + 1} / -1` }}>{sectionRules(false, restStart)}</div> : null}
      {row.role === 'section' ? null : (
        (columnPlan ?? columns.map((_, index) => index)).map((entry) => {
          // A run of columns outside the window draws as one light box.
          if (typeof entry === 'object') return <LiteRun key={`lite:${entry.from}`} row={row} columns={columns} columnIndices={columnIndices} from={entry.from} to={entry.to} trackColumn={trackColumn} slots={liteSlots!} inlineVisibility={inlineVisibility} />;
          const index = entry, column = columns[index]!;
          const cell = row.cells[column.id]!;
          const isLabel = column.kind === 'rowLabel';
          // A light label keeps the label's text box, so a name wraps there as it does in the full row.
          if (light) return <div key={column.id} role={isLabel ? 'rowheader' : 'gridcell'} aria-colindex={columnIndices.get(column.id)}
            {...cellAttributes(cell, column, focus, groupMarks, hiddenColumns, hidden, undefined,
              { pin: pinned.get(column.id), gridColumn: trackColumn?.get(column.id) })}>{isLabel ? <span className="bp-value">{cell.displayed}</span> : cell.displayed}</div>;
          // A value cell is its own memoised component, so a scroll that moves the column window renders the
          // cells it adds, not every cell of every row again.
          if (!isLabel) return (
            <GridValueCell
              key={column.id}
              row={row}
              column={column}
              colIndex={columnIndices.get(column.id)}
              focus={focus?.rowId === cell.rowId && focus.colId === column.id ? focus : undefined}
              groupMarks={groupMarks}
              hiddenColumns={hiddenColumns}
              hidden={hidden}
              palette={palette}
              heatLane={heatLanes.get(column.id)}
              theme={theme}
              measure={measure}
              figures={figures}
              pin={pinned.get(column.id)}
              gridColumn={trackColumn?.get(column.id)}
              labelNote={labelNote}
              barMaximum={barMaxima.get(column.id)}
              sparkDomain={sparkDomains.get(column.id)}
              sparkWidth={sparkWidths.get(column.id)}
              inlineVisibility={inlineVisibility}
            />
          );
          return (
            <div
              key={column.id}
              role="rowheader"
              aria-colindex={columnIndices.get(column.id)}
              title={cellTitle(undefined, cell)}
              {...cellAttributes(cell, column, focus, groupMarks, hiddenColumns, hidden,
                heatStyle(cell, column, heatLanes.get(column.id), theme, measure, figures),
                { ...(pinned.get(column.id) === undefined ? {} : { pin: pinned.get(column.id)! }),
                  ...(trackColumn?.get(column.id) === undefined ? {} : { gridColumn: trackColumn.get(column.id)! }) })}
              {...(toggles ? expandableCellProps(row, collapsed, onToggleRow, foldsOnRow && !selects) : {})}
            >
              <CellContent
                cell={cell}
                column={column}
                row={row}
                mark={mark}
                before={labelLead === undefined ? undefined : leadBox(labelLead, row)}
                barMaximum={barMaxima.get(column.id)}
                spark={{
                  domain: sparkDomains.get(column.id),
                  width: sparkWidths.get(column.id),
                  theme,
                  measure,
                }}
                after={<CollapsedHint row={row} collapsed={collapsed} count={childCount} levelNouns={levelNouns} />}
              />
              <InlineLines
                row={row}
                column={column}
                visibility={inlineVisibility}
              />
            </div>
          );
        })
      )}
      {/* The trailing empty track: no content and no role, only the
          ground, the rule, the hover and the highlight the row paints. A
          section heading spans it already. */}
      {filler === undefined || row.role === 'section' ? null : (
        <div aria-hidden="true" data-bp-filler="" style={filler.gridColumn === undefined ? undefined : { gridColumn: filler.gridColumn }} />
      )}
    </div>
  );
}

/**
 * The cells of a run of columns outside the column window: their text alone, one span per cell in its track's
 * width, in one box that spans the run. Find in page and a screen reader in browse mode reach every cell, at a fraction
 * of a drawn cell's nodes and layout. Scrolled into view, the drawn cells replace them.
 */
const LiteRun = memo(function LiteRun({ row, columns, columnIndices, from, to, trackColumn, slots, inlineVisibility }: {
  row: ResolvedRow;
  columns: readonly ResolvedColumn[];
  columnIndices: ReadonlyMap<Id, number>;
  from: number;
  to: number;
  trackColumn: ReadonlyMap<Id, number> | undefined;
  slots: ReadonlyMap<Id, { start: number; width: number }>;
  inlineVisibility: Record<Id, boolean>;
}): ReactElement {
  const first = columns[from]!, last = columns[to]!;
  const startLine = trackColumn?.get(first.id), endLine = trackColumn?.get(last.id);
  const spans: ReactElement[] = [];
  for (let index = from; index <= to; index++) {
    const column = columns[index]!, slot = slots.get(column.id), next = index < to ? slots.get(columns[index + 1]!.id) : undefined;
    if (!columnIndices.has(column.id)) continue;
    const width = slot === undefined ? 0 : next === undefined ? slot.width : next.start - slot.start;
    spans.push(<span key={column.id} role="gridcell" aria-colindex={columnIndices.get(column.id)} style={{ flex: `0 0 ${width}px`, overflow: 'hidden' }}>{liteText(row, column, inlineVisibility)}</span>);
  }
  return (
    <div data-bp-lite="" style={{ ...(startLine === undefined || endLine === undefined ? {} : { gridColumn: `${startLine} / ${endLine + 1}` }), display: 'flex', flexDirection: 'row', overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0, contentVisibility: 'auto', containIntrinsicSize: 'auto 1px auto 1em' } as CSSProperties}>
      {spans}
    </div>
  );
});
/** A cell's value and the inline lines shown under it, as one line of text. */
function liteText(row: ResolvedRow, column: ResolvedColumn, inlineVisibility: Record<Id, boolean>): string {
  const lines = row.role === 'data' ? row.inlineRows ?? [] : [];
  let text = row.cells[column.id]?.displayed ?? '';
  for (const line of lines) {
    if (inlineVisibility[line.inlineGroup ?? line.id] === false) continue;
    const part = line.cells[column.id]?.displayed ?? '';
    if (part !== '') text = text === '' ? part : `${text} ${part}`;
  }
  return text;
}
const liteStyle = (gridColumn: number | undefined): CSSProperties => ({ ...(gridColumn === undefined ? {} : { gridColumn }), overflow: 'hidden', whiteSpace: 'nowrap' });

/** One value cell of a grid row; memoised, so its props are the stable values the row hands down. */
const GridValueCell = memo(function GridValueCell({ palette, row, column, colIndex, focus, groupMarks, hiddenColumns, hidden, heatLane, theme, measure, figures, pin, gridColumn, labelNote, barMaximum, sparkDomain, sparkWidth, inlineVisibility }: {
  row: ResolvedRow;
  column: ResolvedColumn;
  colIndex: number | undefined;
  focus: TableGridFocus | undefined;
  groupMarks: GroupMarks;
  hiddenColumns: ReadonlySet<Id>;
  hidden: boolean;
  heatLane: Parameters<typeof heatStyle>[2];
  palette?: string;
  theme: SharedRowProps['theme'];
  measure: TextMeasurer;
  figures: SharedRowProps['figures'];
  pin: CellPlacement['pin'];
  gridColumn: number | undefined;
  labelNote: boolean;
  barMaximum: number | undefined;
  sparkDomain: SparklineDomain | undefined;
  sparkWidth: number | undefined;
  inlineVisibility: Record<Id, boolean>;
}): ReactElement {
  const cell = row.cells[column.id]!;
  return (
    <div
      role="gridcell"
      aria-colindex={colIndex}
      title={cellTitle(inlineTitle(row, column.id), cell)}
      {...cellAttributes(cell, column, focus, groupMarks, hiddenColumns, hidden,
        heatStyle(cell, column, heatLane, theme, measure, figures),
        { ...(pin === undefined ? {} : { pin }), ...(gridColumn === undefined ? {} : { gridColumn }) })}
    >
      <CellContent cell={cell} column={column} row={row} barMaximum={barMaximum} spark={{ domain: sparkDomain, width: sparkWidth, theme, measure, palette }} />
      {labelNote ? <span className="bp-note-spacer" aria-hidden="true" /> : null}
      <InlineLines row={row} column={column} visibility={inlineVisibility} noteLine={column.noteLine === true ? cell.note : undefined} />
    </div>
  );
});

/**
 * The lines inside the cell: the row-label column prints each line's
 * authored label, a value column prints that line's own cell. A hidden group
 * keeps its elements and closes to nothing, so the Changes control animates
 * both ways. A signed change carries its judgment tone; a share or a
 * year-on-year reference whispers.
 */
function InlineLines({ row, column, visibility, noteLine }: {
  row: ResolvedRow;
  column: ResolvedColumn;
  visibility: Record<Id, boolean>;
  /** A `noteLine` column's own note, waiting for a line slot. */
  noteLine?: string;
}): ReactElement | null {
  const lines = row.inlineRows;
  if (column.kind !== 'rowLabel' && column.kind !== 'value' && column.kind !== 'computed') return null;
  if (lines === undefined || row.role !== 'data') {
    return noteLine === undefined ? null : <span className="bp-note-line">{noteLine}</span>;
  }
  // The note takes the first slot where this cell's lines hold no value,
  // and the slot after the last one where they all do, so the lines stay
  // level across the row and nothing is drawn twice over.
  let notePlaced = noteLine === undefined;
  return (
    <>
      {lines.map((line) => {
        const group = line.inlineGroup ?? line.id;
        const cell = line.cells[column.id];
        const signed = line.polarity !== undefined && column.kind !== 'rowLabel';
        const toned = column.kind !== 'rowLabel' && cell?.state === 'value' && cell.tone !== 'neutral';
        const text = column.kind === 'rowLabel' ? line.label : (cell?.displayed ?? '');
        const holdsValue = cell !== undefined && cell.state === 'value' && cell.displayed !== '';
        const takesNote = !notePlaced && !holdsValue && visibility[group] !== false;
        if (takesNote) notePlaced = true;
        return (
          <span
            key={line.id}
            className={
              takesNote ? 'bp-line bp-note-line'
                : visibility[group] === false ? 'bp-line bp-line-off' : 'bp-line'
            }
            data-bp-inline={takesNote ? undefined : group}
            data-bp-line={takesNote ? undefined : line.id}
            data-bp-kind={line.kind}
            data-bp-driver-tone={line.driverTone ? '' : undefined}
            data-bp-signed={signed && !takesNote ? '' : undefined}
            data-tone={toned ? cell!.tone : undefined}
            data-bp-strong={toned && cell!.strong ? '' : undefined}
            data-state={!takesNote && column.kind !== 'rowLabel' && cell !== undefined && cell.state !== 'value' ? cell.state : undefined}
          >
            {takesNote ? noteLine : text}
          </span>
        );
      })}
      {notePlaced ? null : <span className="bp-note-line">{noteLine}</span>}
    </>
  );
}

/** Hover text of a cell: its inline lines, then the label of its value band (`TableCellObject.bands`). */
function cellTitle(lineTitle: string | undefined, cell: ResolvedCell): string | undefined {
  const parts = [lineTitle, cell.band?.label].filter((part): part is string => part !== undefined && part !== '');
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** The inline lines under one value as hover text: each line's label and figure. */
function inlineTitle(row: ResolvedRow, columnId: Id): string | undefined {
  const parts = (row.inlineRows ?? []).flatMap((line) => {
    const cell = line.cells[columnId];
    return cell === undefined || cell.displayed === '' ? [] : [`${line.label} ${cell.displayed}`.trim()];
  });
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** Where a cell sits: its pinned offset and, on a spaced grid, its track. */
interface CellPlacement {
  pin?: { left: number; last: boolean };
  gridColumn?: number;
}

function cellAttributes(
  cell: ResolvedCell,
  column: ResolvedColumn,
  focus: TableGridFocus | undefined,
  groupMarks: GroupMarks,
  hiddenColumns: ReadonlySet<Id>,
  rowHidden: boolean,
  heat?: { tint?: CSSProperties; color?: string; fontWeight?: number },
  placement: CellPlacement = {},
): Record<string, string | number | CSSProperties | undefined> {
  const classes: string[] = [];
  const alignment = alignmentClass(column);
  if (alignment !== undefined) classes.push(alignment);
  // Figures follow the cell, not its alignment: a readout an author
  // right-aligns is still prose, and a numeric column an author left-aligns
  // still keeps its digit grid.
  if (numericCell(cell)) classes.push('bp-figures');
  if (cell.deEmphasized) classes.push('bp-muted');
  const key = `${encodeURIComponent(cell.rowId)}:${encodeURIComponent(column.id)}`;
  const hidden = hiddenColumns.has(column.id) || rowHidden;
  return {
    'data-col-id': column.id,
    'data-bp-row': cell.rowId,
    'data-bp-column': column.id,
    ...(column.kind === 'rowLabel' ? { 'data-bp-label': key } : { 'data-bp-mark': key }),
    'data-bp-detail': column.toggleGroup,
    'data-bp-wrap': column.wrap === true ? '' : undefined,
    'data-bp-hidden': hiddenColumns.has(column.id) ? '' : undefined,
    'aria-hidden': hiddenColumns.has(column.id) ? 'true' : undefined,
    'data-bp-band': groupMarks.banded.has(column.id) ? '' : undefined,
    'data-bp-group-start': groupMarks.groupStart.has(column.id) ? '' : undefined,
    'data-bp-group-end': groupMarks.groupEnd.has(column.id) ? '' : undefined,
    'data-bp-grounds-only': groupMarks.groundsOnly.has(column.id) ? '' : undefined,
    'data-emphasis': column.emphasis,
    'data-state': cell.state,
    'data-bp-figure': isFigureCell(cell, column) ? '' : undefined,
    tabIndex: !hidden && focus?.rowId === cell.rowId && focus.colId === column.id ? 0 : -1,
    'data-tone': cell.tone === 'neutral' ? undefined : cell.tone,
    'data-bp-strong': cell.strong ? '' : undefined,
    'data-bp-bar': cell.bar === undefined || cell.state !== 'value' ? undefined : '',
    'data-bp-zero': cell.zero ? '' : undefined,
    'data-encoding':
      column.kind === 'encoding'
        ? (column.encoding?.type ?? 'sparkline')
        : column.cellEncoding?.type === 'inCellBar'
          ? 'inCellBar'
          : column.cellEncoding?.type === 'heat' && heat !== undefined
            ? 'heat'
            : undefined,
    'data-bp-pin': placement.pin === undefined ? undefined : '',
    'data-bp-pin-last': placement.pin?.last === true ? '' : undefined,
    // The heat lane is paint, and the cell's own background is where it
    // belongs: a rule in the stylesheet could not know the value.
    style: heat === undefined && placement.pin === undefined && placement.gridColumn === undefined && cell.bar === undefined
      ? undefined
      : {
        ...(cell.bar === undefined ? {} : { '--bp-bar': String(cell.bar) }),
        ...(heat === undefined ? {} : {
          ...heat.tint,
          ...(heat.color === undefined ? {} : { color: heat.color }),
          ...(heat.fontWeight === undefined ? {} : { fontWeight: heat.fontWeight }),
        }),
        ...(placement.pin === undefined ? {} : { '--bp-pin-left': `${placement.pin.left}px` }),
        ...(placement.gridColumn === undefined ? {} : { gridColumn: placement.gridColumn }),
      } as CSSProperties,
    className: classes.length > 0 ? classes.join(' ') : undefined,
  };
}


/** The ground and ink one heat cell takes, as CSS colours. */
function heatStyle(
  cell: ResolvedCell,
  column: ResolvedColumn,
  lane: HeatRange | undefined,
  theme: Theme,
  measure: TextMeasurer,
  figures = true,
): { tint?: CSSProperties; color?: string; fontWeight?: number } | undefined {
  // Heat-only: a cell whose ground was painted says its number through the
  // ground. One without a ground, a core column or a closing row, keeps it.

  const encoding = column.cellEncoding;
  if (encoding?.type !== 'heat' || lane === undefined) return undefined;
  const { fill, ink, weight } = heatPaint({ cell, theme, measure }, lane, encoding);
  // A band may whisper without a ground: the skipped column of a cohort
  // grid keeps its figure and takes no tint.
  const plain: Paint = { token: 'ink' };
  // A cell with `heat: false` has no ground and its own ink.
  if (fill === undefined && weight === undefined && figures && JSON.stringify(ink) === JSON.stringify(plain)) return undefined;
  return {
    // No ground where the band has none: an unshaded cell must not paint
    // over the row's own band.
    ...(fill === undefined ? {} : { tint: { ...insetTint(resolvePaint(fill, theme)), ...tableGroundTextStyle(theme, fill) } }),
    ...(!figures && cell.role !== 'total'
      ? { color: 'transparent' }
      : JSON.stringify(ink) === JSON.stringify(plain) ? {} : { color: resolvePaint(ink, theme) }),
    ...(weight === undefined ? {} : { fontWeight: weight }),
  };
}

/** The border a column group after the first opens with (`[data-bp-group-start]`). */

/**
 * The face the grid draws a column-group heading in: the SVG's own
 * (`tableFonts(...).group`), the group step of the table's density at the axis role weight
 * and tracked 0.12 of that step, or the dense face where a head does not fit
 * at that step. The width pass measures this face, and the grid
 * writes its size and tracking into `--bp-group-head-size` and
 * `--bp-group-head-tracking`, so the cell draws what was measured.
 * Without it the head row's rule outranks the heading's and draws it at the
 * header size and weight.
 */
function groupHeadingFace(fonts: TableFonts): FontSpec {
  const group = fonts.group;
  return { ...group, letterSpacing: Math.round((group.letterSpacing ?? 0) * 1000) / 1000 };
}

/**
 * The head faces the tracks were measured with, so the drawn text fits them:
 * the header's size and tracking, 0.5 px or 0.2 px on the dense face as the
 * SVG draws it, and the group heading's.
 */
function headVars(fonts: TableFonts): Record<string, string> {
  const face = groupHeadingFace(fonts);
  return {
    '--bp-header-size': `${fonts.header.size}px`,
    '--bp-header-tracking': `${Math.round((fonts.header.letterSpacing ?? 0) * 1000) / 1000}px`,
    '--bp-group-head-size': `${face.size}px`,
    '--bp-group-head-tracking': `${face.letterSpacing}px`,
  };
}

function alignmentClass(column: ResolvedColumn): string | undefined {
  if (column.align === 'right') return 'bp-num';
  return column.align === 'center' ? 'bp-center' : undefined;
}

interface TreeToggleProps {
  row: ResolvedRow;
  collapsed: boolean;
  hidden: boolean;
  onToggleRow: (rowId: Id) => void;
}

/**
 * The label cell of a parent row expands and collapses on Enter and Space, as
 * the row does on click, and says so through aria-expanded. A key
 * on the toggle button inside the cell is the button's own.
 */
function expandableCellProps(row: ResolvedRow, collapsed: boolean, onToggleRow: (rowId: Id) => void, foldsOnKey: boolean): {
  'aria-expanded'?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
} {
  if (!row.hasChildren || row.foldable === false) return {};
  return {
    'aria-expanded': !collapsed,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      const foldArrow = (event.key === 'ArrowRight' && collapsed) || (event.key === 'ArrowLeft' && !collapsed);
      if (!foldArrow && (!foldsOnKey || (event.key !== 'Enter' && event.key !== ' '))) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      onToggleRow(row.id);
    },
  };
}

/**
 * The outline mark: minus open, plus closed, 8 px in the gutter. No
 * rotation and no triangle — the glyph says what it does at a glance and the
 * row does not shift when it changes.
 */
function TreeToggle({ row, collapsed, hidden, onToggleRow }: TreeToggleProps): ReactElement {
  return (
    <button
      type="button"
      className="bp-tree-toggle"
      data-bp-toggle-row=""
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.label}`}
      tabIndex={hidden ? -1 : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onToggleRow(row.id);
      }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
        <path
          d={collapsed ? 'M1 4h6M4 1v6' : 'M1 4h6'}
          stroke="currentColor"
          strokeWidth="var(--bp-stroke-mark)"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </button>
  );
}

/**
 * A host's lead glyph in a box `width` px wide, the room the width pass
 * reserved for it on the label track: the glyph sits at the start and the
 * rest of the box is its gap to the label. A row without a glyph
 * takes no box, as the width pass reserved the room for every row alike.
 */
function leadBox(lead: TableRowLabelLead, row: ResolvedRow): ReactNode {
  const glyph = lead.render(row);
  if (glyph === undefined || glyph === null || glyph === false) return undefined;
  return <span className="bp-label-lead" style={{ width: lead.width }}>{glyph}</span>;
}

/**
 * The outline mark of a read-only tree: the toggle's glyph, placed
 * where the toggle sits, with no button, no focus and no pointer. The SVG
 * draws this mark when outlineMarks is true. A host can show which groups
 * are open while it controls the depth.
 */
function OutlineMark({ collapsed }: { collapsed: boolean }): ReactElement {
  return (
    <span className="bp-tree-mark" data-bp-outline-mark={collapsed ? 'closed' : 'open'} aria-hidden="true">
      <svg width="8" height="8" viewBox="0 0 8 8" focusable="false">
        <path d={collapsed ? 'M1 4h6M4 1v6' : 'M1 4h6'} stroke="currentColor" strokeWidth="var(--bp-stroke-mark)" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
}

/**
 * What a closed row hides, in the noun the author wrote for that level. No
 * `levelNouns` entry, no hint: Boardplot does not invent the word.
 */
function CollapsedHint({ row, collapsed, count, levelNouns }: {
  row: ResolvedRow;
  collapsed: boolean;
  count: number;
  levelNouns: ResolvedTable['levelNouns'];
}): ReactElement | null {
  if (!collapsed || !row.hasChildren || count === 0) return null;
  const noun = levelNouns?.[row.level + 1];
  if (noun === undefined) return null;
  return <span className="bp-hint">{`· ${count} ${count === 1 ? noun.one : noun.other}`}</span>;
}

interface SparkContext {
  palette?: string;
  domain?: SparklineDomain;
  width?: number;
  theme: Theme;
  measure: TextMeasurer;
}

interface CellContentProps {
  cell: ResolvedCell;
  column: ResolvedColumn;
  row?: ResolvedRow;
  barMaximum?: number;
  spark?: SparkContext;
  /**
   * What prints after the label on the label's own line: the collapsed
   * hint. The cell is a flex column, so a sibling of the value would take a
   * line of its own under the label, where the SVG prints it beside.
   */
  after?: ReactNode;
  /** What prints before the label on its own line: a host's lead glyph. */
  before?: ReactNode;
  /**
   * The fold toggle or outline mark of a parent row. It is positioned on the
   * label's own line: centred on the cell, it sat above a section
   * heading, whose cell has more air on top, and below a label with lines.
   */
  mark?: ReactNode;
}

/** The height the sparkline cell draws in; the row grows to it. */
/**
 * The drawing's height. The cell takes no air of its own and the drawing
 * spans the whole track, as the SVG draws it over its whole cell box: the
 * cell padded the track-wide drawing and cut its end label ("11" for 112.0).
 */
const SPARK_CELL_HEIGHT = 28;

/**
 * The sparkline cell draws the shape: "first → last" would repeat the two
 * numbers the neighbouring columns already carry. Layout owns the geometry here as everywhere: the
 * marks come from `emitSparkline`, the same call the SVG makes, over the same
 * domain and the same `TABLE_SPARK_STYLE`, in a box the width of the column's
 * own track.
 */
function SparklineCell({ cell, column, row, spark }: {
  cell: ResolvedCell;
  column: ResolvedColumn;
  row: ResolvedRow;
  spark: SparkContext;
}): ReactElement {
  const encoding = column.encoding;
  const width = spark.width;
  if (encoding?.type !== 'sparkline' || width === undefined || row.role === 'section') {
    return <span className="bp-muted">—</span>;
  }
  const values = sparklineSourceValues(row, encoding.sourceColumns);
  const last = lastObservedIndex(values);
  const lastSource = last === undefined ? undefined : encoding.sourceColumns[last];
  const box = { x: 0, y: 0, w: width, h: SPARK_CELL_HEIGHT };
  const nodes = emitSparkline(
    {
      cell,
      box,
      theme: spark.theme,
      measure: spark.measure,
      nodeId: (suffix) => tableCellNodeId(suffix, row.id, column.id),
      owner: { rowId: row.id, colId: column.id },
    },
    values,
    {
      kind: encoding.kind ?? 'line',
      domain: spark.domain ?? { min: 0, max: 0 },
      lastText: lastSource === undefined ? undefined : row.cells[lastSource]?.displayed,
    },
  );
  return (
    <>
      <svg
        className="bp-spark"
        width={width}
        height={SPARK_CELL_HEIGHT}
        viewBox={`0 0 ${width} ${SPARK_CELL_HEIGHT}`}
        aria-hidden="true"
        focusable="false"
      >
        {nodes.map((node) => sparkNode(node, spark.theme))}
      </svg>
      {/* The drawing is aria-hidden and the cell's own displayed string is
          empty, so the line would reach a screen reader as nothing at all.
          A sentence that summarises the line stays, out of sight. */}
      <span className="bp-spark-text">{sparklineSummary(row, encoding.sourceColumns, spark.theme.table?.glyphs?.missing ?? '—')}</span>
    </>
  );
}

/** What a sparkline cell says when it is read rather than looked at. */
function sparklineSummary(row: ResolvedRow, sourceColumns: readonly Id[], missing: string): string {
  const drawn = sourceColumns
    .map((id) => row.cells[id])
    .filter((candidate): candidate is ResolvedCell => candidate?.state === 'value');
  if (drawn.length === 0) return missing;
  if (drawn.length === 1) return drawn[0]!.displayed;
  return `${drawn[0]!.displayed} → ${drawn[drawn.length - 1]!.displayed}`;
}

/** The four node kinds a sparkline emits, painted the way the SVG paints them. */
function sparkNode(node: SceneNode, theme: Theme): ReactElement | null {
  const common = { key: node.id, ...sceneAttributes(node) };
  switch (node.t) {
    case 'path':
      return <path {...common} d={node.d}
        fill={node.fill === undefined ? 'none' : resolvePaint(node.fill, theme)}
        stroke={node.stroke === undefined ? undefined : resolvePaint(node.stroke, theme)}
        strokeWidth={node.width} strokeLinecap="round" strokeLinejoin="round" />;
    case 'rect':
      return <rect {...common} x={node.rect.x} y={node.rect.y} width={node.rect.w} height={node.rect.h}
        fill={node.fill === undefined ? 'none' : resolvePaint(node.fill, theme)} />;
    case 'circle':
      return <circle {...common} cx={node.cx} cy={node.cy} r={node.r}
        fill={node.fill === undefined ? 'none' : resolvePaint(node.fill, theme)} />;
    case 'text':
      return <text {...common} x={node.x} y={node.y + node.font.size * SPARK_TEXT_ASCENT}
        textAnchor={node.align === 'end' ? 'end' : node.align === 'middle' ? 'middle' : 'start'}
        fontFamily={node.font.family} fontSize={node.font.size} fontWeight={node.font.weight}
        fill={resolvePaint(node.ink, theme)}>{node.lines.join(' ')}</text>;
    default:
      return null;
  }
}

/** The baseline the SVG serializer and the scene renderer both use. */
const SPARK_TEXT_ASCENT = 0.88;

function CellContent({
  cell,
  column,
  row,
  barMaximum = 0,
  spark,
  after,
  before,
  mark,
}: CellContentProps): ReactElement {
  let main: ReactNode;
  if (column.kind === 'encoding' && row !== undefined && spark !== undefined) {
    main = <SparklineCell cell={cell} column={column} row={row} spark={spark} />;
  } else if (hasPolarityBadge(cell, column) && spark !== undefined && row !== undefined) {
    main = <span className="bp-chip bp-polarity-badge" style={{ color: resolvePaint(polarityBadgeInk(spark.theme, cell, column, row, spark.palette), spark.theme) }}>{cell.displayed}</span>;
  } else if (cell.kind === 'status' && cell.state === 'value' && column.statusMark === 'square') {
    main = (
      <span className="bp-status-mark" data-status={typeof cell.raw === 'string' ? cell.raw : cell.displayed}>
        <span className="bp-status-square" aria-hidden="true" />
        <span className="bp-status-text">{cell.displayed}</span>
      </span>
    );
  } else if (cell.kind === 'status' && cell.state === 'value') {
    main = (
      <span
        className="bp-chip"
        data-status={typeof cell.raw === 'string' ? cell.raw : cell.displayed}
      >
        {cell.displayed}
      </span>
    );
  } else if (
    column.cellEncoding?.type === 'inCellBar' &&
    cell.state === 'value' &&
    typeof cell.raw === 'number'
  ) {
    const scale = barMaximum > 0 ? Math.min(100, (100 * Math.abs(cell.raw)) / barMaximum) : 0;
    // `data-bar-sign` names the side the bar is painted on, as the SVG
    // decides it: 'negative' takes the bad fill, so under lowerIsBetter a
    // rise is the negative side.
    main = (
      <span className="bp-in-cell-bar" data-bar-sign={cell.raw !== 0 && badSide(cell.raw < 0, cell.polarity) ? 'negative' : 'positive'}>
        <span className="bp-in-cell-track" aria-hidden="true">
          <span className="bp-in-cell-fill" style={{ width: `${scale}%` }} />
        </span>
        <span className="bp-in-cell-value">{cell.displayed}</span>
      </span>
    );
  } else if (column.cellEncoding?.type === 'arrow' && column.kind === 'computed' && column.polarity !== undefined &&
    cell.state === 'value' && typeof cell.raw === 'number') {
    // The direction glyph the SVG sets before the change, in its tone:
    // the grid printed the coloured number alone.
    main = <><span className="bp-arrow" aria-hidden="true">{arrowGlyph(printedNumber(cell), barMaximum, column.cellEncoding.scale)}</span>{cell.displayed}</>;
  } else if (column.kind === 'rowLabel') {
    // The breaks the SVG may take after _ - / . (NAME_BREAK), so a long name wraps at the same places.
    main = splitNameBreaks(cell.displayed).flatMap((piece, index) => index === 0 ? [piece] : [<wbr key={index} />, piece]);
  } else {
    main = cell.displayed;
  }
  // A row-label note prints UNDER its label, at the ladder's inline step in
  // the muted ink, the way the SVG prints it. In a value or a text
  // column the note stays inline after the figure, unless the column asked
  // for it on a line of its own, where `InlineLines` prints it.
  const underLabel = column.kind === 'rowLabel' && cell.note !== undefined;
  const onItsOwnLine = underLabel || column.noteLine === true;
  // A hoisted unit is not a note and never takes a line of its own: it sits
  // on the label's line, so the change lines under the label stay level with
  // the ones under the values.
  const unit = column.kind === 'rowLabel' ? row?.unitAffix : undefined;
  const content = (
    <>
      {before}
      {column.kind === 'rowLabel' && row?.operator !== undefined ? <span className="bp-operator" aria-hidden="true">{row.operator}</span> : null}
      {main}
      {unit === undefined ? null : <span className="bp-unit-affix">{unit}</span>}
      {cell.note === undefined || onItsOwnLine ? null : <span className="bp-note">{cell.note}</span>}
    </>
  );
  const href = safeHref(cell.href);
  const drawn = <span className="bp-value" title={column.kind === 'rowLabel' ? cell.displayed : undefined}>{href === undefined ? content : <a href={href} rel="noopener">{content}</a>}{after}</span>;
  const value = mark === undefined || mark === null ? drawn : <span className="bp-label-line">{mark}{drawn}</span>;
  if (!underLabel) return value;
  return <>{value}<span className="bp-note-line">{cell.note}</span></>;
}

function safeHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  const trimmed = href.trim();
  return SAFE_HREF.test(trimmed) ? trimmed : undefined;
}

function TableThemeStyle({ stylesheet, scope, nonce }: { stylesheet: string; scope: string; nonce?: string }): ReactElement | null {
  const [attached, setAttached] = useState(false);
  const inline = useRef<HTMLStyleElement>(null);
  const root = useRef<Node>(undefined);
  const key = `${nonce ?? ''}\0${stylesheet}`;
  // `.bp-table-grid` carries `.bp-table` as well, so both class names take the
  // instance attribute — and the boundary matters: a bare string replace turned
  // `.bp-table-grid` into `.bp-table[...]-grid`, a selector that matches nothing.
  // Consume declarations too, so a missing opening brace cannot cause quadratic backtracking.
  const css = useMemo(() => stylesheetBody(stylesheet).replace(/([^{}]+)([{}])/g,
    (match, selector: string, brace: string) => brace === '}' ? match : `${selector.replace(/\.bp-table(-grid)?(?![\w-])/g, (_hit, grid: string | undefined) => `.bp-table${grid ?? ''}[data-bp-table-theme="${scope}"]`)}{`) +
    '\n.bp-table[data-bp-motion="reduce"] .bp-tree-toggle,.bp-table[data-bp-motion="reduce"] [role="row"],.bp-table[data-bp-motion="reduce"] [role="row"]>*,.bp-table[data-bp-motion="reduce"] .bp-line,.bp-table[data-bp-motion="reduce"] .bp-children{transition:none;animation:none}' +
    '\n@media(prefers-reduced-motion:reduce){.bp-table:not([data-bp-motion="full"]) .bp-tree-toggle,.bp-table:not([data-bp-motion="full"]) [role="row"],.bp-table:not([data-bp-motion="full"]) [role="row"]>*,.bp-table:not([data-bp-motion="full"]) .bp-line,.bp-table:not([data-bp-motion="full"]) .bp-children{transition:none;animation:none}}', [stylesheet, scope]);
  // A layout effect, not an insertion effect: it needs the inline copy's
  // node to find the root the table renders in, and that copy stays in the
  // DOM until the shared one has mounted, so no frame goes unstyled.
  useLayoutEffect(() => {
    root.current ??= inline.current?.getRootNode();
    // By node type, not instanceof: an iframe's Document and ShadowRoot come
    // from its own window, and the table there lost its stylesheet to ours.
    const found = root.current;
    const owner: Document | ShadowRoot = found?.nodeType === Node.DOCUMENT_NODE ? found as Document
      : found?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in found ? found as ShadowRoot : document;
    const doc = owner.ownerDocument ?? owner as Document;
    let styles = styleRegistry.get(owner);
    if (styles === undefined) { styles = new Map(); styleRegistry.set(owner, styles); }
    let entry = styles.get(key);
    if (entry !== undefined && !entry.element.isConnected) {
      styles.delete(key);
      entry = undefined;
    }
    if (entry === undefined) {
      const element = doc.createElement('style');
      element.dataset.bpTableTheme = scope;
      if (nonce !== undefined) element.nonce = nonce;
      element.textContent = css;
      (owner === doc ? doc.head : owner).append(element);
      entry = { count: 0, element };
      styles.set(key, entry);
    }
    entry.count += 1;
    const registered = styles;
    return () => {
      const current = registered.get(key);
      if (current === undefined) return;
      current.count -= 1;
      if (current.count === 0) {
        current.element.remove();
        registered.delete(key);
      }
    };
  }, [key, css, scope, nonce]);
  // The first server/client frame includes CSS. Remove its inline copy only
  // after the shared stylesheet has mounted, without resolving the table.
  useEffect(() => setAttached(true), []);
  // Raw text on both sides: React 18's server escapes the quotes of a style
  // element's text child and the client then re-rendered the whole root
  //. `stylesheetBody` refuses any `<style` or `</style` in it.
  return attached ? null : <style ref={inline} data-bp-table-theme={scope} nonce={nonce} dangerouslySetInnerHTML={{ __html: css }} />;
}

function stylesheetBody(stylesheet: string): string {
  const open = '<style>';
  const close = '</style>';
  if (!stylesheet.startsWith(open) || !stylesheet.endsWith(close)) {
    throw new Error('tableStylesheet(theme) must return one <style> element');
  }
  const body = stylesheet.slice(open.length, -close.length);
  // The stylesheet's paint is allowlisted upstream (checkedCssColor /
  // checkedFontFamily). This is the boundary assertion for that contract: a
  // body that still carries a style-element terminator means a token escaped
  // its declaration, and the React host must not mount it either.
  if (/<\/?style/i.test(body)) {
    throw new Error('tableStylesheet(theme) body carries a <style> boundary — refusing to mount');
  }
  return body;
}

function stylesheetHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

// BoardplotChart links this component dynamically. Announcing it here lets a
// graph that already carries the table renderer draw its first table spec
// without a round trip. The announcement can redraw a waiting chart at once,
// so the type it resolves is registered first.
registeredType(tableCore);
publishTableChart(TableChart);
