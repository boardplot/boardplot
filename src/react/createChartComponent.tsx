import { chartString } from '../core/strings/createChartComponent';
import { localeStrings } from '../core/strings/createChartComponent';
/**
 * Generated chart components: one component per registry type,
 * flat props = data + annotations + options, zero per-chart React code.
 */

import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import type { InteractionRecord } from '../core/a11y/types';
import { BoardplotThemeContext } from './themeContext';
import type { ChartRequest, RequestOptions } from '../core/request';
import type { Annotation } from '../core/types/annotations';
import type { Id } from '../core/types/cell';
import type { Geometry, LintWarning } from '../core/types/scene';
import type { RenderTarget } from '../core/types/options';
import type { ThemeRef } from '../core/types/theme';
import { useDeferredModule } from './deferredCore';
import type { DeferredName } from '../core/deferred';
import { HoverSurface } from './hover/HoverSurface';
import { SceneRenderer } from './SceneRenderer';
import { ChartFooter, FOOTER_PRINT_CSS } from './ChartFooter';
import { withoutSvgFooter } from './footerFrame';
import { chartNotes, shownNoteKinds, type ChartNote } from '../core/notes';
import { chartRefusals, isSizeDependentRefusal, optionRefusals, refusalFindings } from '../core/schema/refusals';
import type { OptionKeyCheck } from '../core/schema/unknownKeys';
import { useSharedScaleValueAxis, type ScaleGroupRef } from './scaleGroupContext';
import { LayoutRefusal, LoadingPlaceholder, SizePlaceholder, type EmptyProps, type RefusalProps } from './SizePlaceholder';
import { useDeferrableChartLayout } from './useResolvedChartLayout';
import { rebindable } from './linkedBinding';
import { PROBE_STYLE, useContainerSize, type ContainerSizeOptions } from './useContainerSize';
import { useStableValue } from './useStableValue';
import { SIZE_TOLERANCE } from '../core/sizing';
import { containerFit, containerHostlessHeight } from './containerLayout';
import { checkedIdPrefix, IdPrefixContext } from './idPrefix';
import { isFullGeometry, type PreparedChart } from './prepared';
import { useDisplayWarnings } from './useDisplayWarnings';
import { languageOf, useZoom, type ZoomOption } from './useZoom';
import { useRefusalSettle } from './useRefusalSettle';
import { hoverFlags, type HoverOption, type RenderHoverContent } from './useHover';
import type { StoryLink } from './StoryFrame';
import type { RenderGeometry } from './prepared';
import { markScrollRegion, scrollStateOf, type TableScrollState } from './scrollState';
import { useChartExport, type ExportLink } from './exportLink';
import { useRowsInput, type RowsProps } from './rowsInput';

export type { HoverContentContext, HoverOption, RenderHoverContent } from './useHover';

/**
 * The drawing re-renders only when its geometry or props change: while a new layout renders in the background
 * (`deferLayout`), every resize frame renders the chart again with its last geometry, and the scene is not walked again.
 */
const DrawnScene = memo(SceneRenderer);
const DrawnSurface = memo(HoverSurface);

/** Chart types whose width refusal scrolls instead of drawing the refusal card. */
const SCROLLS_WIDE = new Set(['cohort']);

/** The print-only layout's input while it has nothing to lay out (`idle`). */
const IDLE_REQUEST = { type: 'column', data: undefined } as unknown as ChartRequest;

type SizedRefusal = { size: { width: number; height: number }; sizing: { minWidth: number; minHeight: number } };
/** Print: the smallest box of the printed box's shape that holds `need`'s minimum (createChartComponent print refit). */
function printBox(printed: SizedRefusal, need: SizedRefusal): { width: number; height: number } {
  const { width, height } = printed.size;
  const k = Math.max(1, need.sizing.minWidth / width, need.sizing.minHeight / height, need.size.width / width);
  return { width: Math.ceil(width * k), height: Math.ceil(height * k) };
}

/** Shared fields allow chart-specific label, legend and mode policies. */
type ChartOptionsLike = Omit<RequestOptions, 'annotations'>;

/** The props every chart component takes besides its chart options and its data. */
type ChartHostProps = ContainerSizeOptions & RefusalProps & EmptyProps & {
  /** Set by `withStory` from `boardplot/react/story`; without it a story chart draws its static step. */
  storyLink?: StoryLink;
  /** Explicit target wins over the provider. Defaults to report. */
  target?: RenderTarget;
  /** Canonical findings plus observed display findings. Fires only when findings change. */
  onWarnings?: (warnings: LintWarning[]) => void;
  annotations?: Annotation<string | number>[];
  /** Render at intrinsic size instead of filling the parent. */
  fixedSize?: boolean;
  /**
   * On by default: a new size or new data lays the chart out in the background, and the chart keeps its last
   * drawing until the new one is ready. `false` lays it out in the render that brought the change.
   */
  deferLayout?: boolean;
  onGeometry?: (geometry: Geometry) => void;
  /** Prepared server result for attachment without layout. */
  prepared?: PreparedChart;
  /** Label card and series highlight on pointer hover. Off by default. */
  hover?: HoverOption;
  /** Called with the series id when the reader clicks a series' line or area, its name label or its legend entry. */
  onSeriesClick?: (seriesId: Id) => void;
  /**
   * Called with the record the reader clicks, the one the hover card names: a bar, a point, a
   * slice or a category band, with its category, series and source value. A click on a mark then
   * fires no `onSeriesClick`; the name label and the legend entry keep it. The keyboard fires it
   * too: Enter or Space on the record the chart's keyboard stop has focused.
   */
  onRecordClick?: (record: InteractionRecord, event: MouseEvent<Element> | KeyboardEvent<Element>) => void;
  /**
   * Line and area on a time, date or number x: Ctrl or Cmd with the wheel, or a pinch, zooms
   * around the pointer, and the plain wheel scrolls the page. Focused, + and - zoom, 0 resets,
   * Shift+Left and Shift+Right pan. `aggregate` lets a wide range draw coarser buckets
   * (day to month to year); `range` and `onZoom` let the host hold the range or send finer data.
   */
  zoom?: ZoomOption;
  /**
   * Your own hover card content, for links and free layout: called with the record `onRecordClick`
   * receives for the same mark and `{ records, defaultContent, source }`. Return
   * `defaultContent` to keep the default card, wrap it to add to it, return your own content to
   * replace it, or null for no card. The card then takes the pointer and the focus: Tab moves from
   * the chart's keyboard stop into it, and Escape returns. Turns on `hover` when it is absent.
   */
  renderHoverContent?: RenderHoverContent;
  /**
   * Called with the state of the chart's own sideways scroller (`.bp-scroll`) on mount, on every
   * scroll and on a resize, as TableChart reports its scroller: a host fades the cut edge from it.
   * Only a chart that scrolls calls it, a cohort too wide for its box.
   */
  onScrollChange?: (state: TableScrollState) => void;
  /** CSP nonce for the style elements this component renders. */
  styleNonce?: string;
  /** The handle from `useExport()` (`boardplot/react/export`): it exports this chart as drawn on screen. */
  exporter?: ExportLink;
  /**
   * Footer rule: the notes list (author notes, method notes, disclosures,
   * source and map credit, each with its kind) whenever it changes, for a host
   * that builds its own appendix.
   */
  onNotes?: (notes: ChartNote[]) => void;
  /**
   * Draws the notes instead of the "Notes and sources" button and panel, for
   * a host that puts them in its own appendix. The source line and a required
   * map credit stay visible under the chart.
   */
  renderNotes?: (notes: ChartNote[]) => ReactNode;
  /**
   * Prepended to every id this chart writes. Give each separately rendered
   * React root (island, one `renderToString` per chart) its own, or set
   * React's `identifierPrefix` per root; `useId` alone repeats across roots.
   */
  idPrefix?: string;
};

/**
 * The chart's data, or SQL-shaped `rows` that become it through `columns`
 * (`boardplot/rows` documents the roles); `data` is then the template.
 */
export type ChartDataProps<D> =
  | { data: D; rows?: undefined; columns?: undefined; onRowsReading?: undefined }
  | (Required<Pick<RowsProps, 'rows' | 'columns'>> & Pick<RowsProps, 'onRowsReading'> & { data?: Partial<D> });

/** Grid's own `rows` and `columns` options lay out its panels; a grid takes no rows mapping. */
export type ChartProps<D, O extends ChartOptionsLike> = O extends unknown
  ? Omit<O, 'annotations' | 'size'> & ChartHostProps & ('rows' extends keyof O ? { data: D } : ChartDataProps<D>)
  : never;

/** The props every chart component takes besides its chart options. */
export type ChartComponentProps<D> = ChartHostProps & ChartDataProps<D>;

/** Grid lays out its panels with options of the same names. */
const OWN_ROWS_OPTIONS = new Set(['grid']);

/** The default count wording of a capped note plus the hover hint (`strings.moreListed` overrides it). */


/**
 * `checkKeys`, the check a per-type entry builds from the key tree of the
 * type's options schema, refuses every option prop outside it as the CLI
 * does; without it only the options the capability tables refuse
 * are refused.
 */
/**
 * `linked` names the fetched core modules the chart's own entry links by
 * value (likert the theme checks, pareto the annotation engine). Only those
 * count in the server's first frame and the hydrating one (`asFirstFrame`).
 */
export function createChartComponent<D, O extends ChartOptionsLike>(type: string, checkKeys?: OptionKeyCheck, linked?: readonly DeferredName[]) {
  function Chart(props: ChartProps<D, O>): ReactElement {
    const { data: authored, annotations, fixedSize, onGeometry, onWarnings, onRefused, renderRefused, onEmpty, target, size, fit, fallbackSize, prepared, hover, onSeriesClick, onRecordClick, renderHoverContent, zoom, styleNonce, idPrefix,
      storyLink, onNotes, renderNotes, onScrollChange, deferLayout = true, exporter, rows: rowsProp, columns: columnsProp, onRowsReading, ...rest } = props;
    // A grid's rows and columns are its panel layout options.
    const ownRows = OWN_ROWS_OPTIONS.has(type);
    const options = ownRows ? { ...rest, ...rowsProp !== undefined && { rows: rowsProp }, ...columnsProp !== undefined && { columns: columnsProp } } as typeof rest : rest;
    const rows = ownRows ? undefined : rowsProp as RowsProps['rows'];
    const columns = ownRows ? undefined : columnsProp as RowsProps['columns'];
    // Rows become the data before anything reads it: zoom, the layout, the export and the server's snapshot all see the mapped chart.
    const mapped = useRowsInput<D>({ type, data: authored }, { rows, columns, onRowsReading }, prepared);
    const data = mapped.data as D;
    const container = size === 'container';
    const resolvedFit = container ? containerFit(type, fit) : undefined;
    const measured = useContainerSize({ size, target, fit: resolvedFit, fallbackSize, hostlessHeight: (width, height) => containerHostlessHeight(type, width, height) });
    // A chart inside a matching ScaleGroup reads the group's pinned bounds. The
    // hook is called unconditionally and returns null outside such a group, so a
    // standalone chart keeps exactly the options it always had.
    const stableOptions = useStableValue(options);
    const sharedValueAxis = useSharedScaleValueAxis(stableOptions.scaleGroup as ScaleGroupRef | undefined);
    const layoutOptions = useMemo(() => {
      if (!sharedValueAxis) return stableOptions;
      return { ...stableOptions, valueAxis: { ...stableOptions.valueAxis as object, ...sharedValueAxis } };
    }, [stableOptions, sharedValueAxis]);
    // A capped note ends "and 236 more". Only a chart with a hover card can say "hover shows each value":
    // SVG, PNG and PDF output have no hover, so the hint is chosen here and never by the layout.
    // A prepared chart keeps the layout it was prepared with: its request key covers the strings.
    const hoverCard = hoverFlags(hover);
    const hinted = hoverCard !== undefined && hoverCard.card !== false && prepared === undefined;
    const noteOptions = useMemo(() => {
      const strings = (layoutOptions as { strings?: Record<string, unknown> }).strings;
      return hinted && strings?.moreListed === undefined ? { ...layoutOptions, strings: { ...strings, moreListed: chartString(layoutOptions, 'hoverMoreListed') } } : layoutOptions;
    }, [layoutOptions, hinted]);
    // An option the schemas refuse, or a key they do not take, refuses here
    // too, with the CLI's code, path and patch; the
    // layout does not run on it. The props above are React's and never reach it.
    // A BoardplotTheme provider's retired string keys refuse as a chart prop does.
    const provider = useContext(BoardplotThemeContext);
    const providerStrings = provider?.strings as Record<string, unknown> | undefined;
    const optionsRefused = optionRefusals(stableOptions as Record<string, unknown>, type, checkKeys, providerStrings);
    const refusedOptions = mapped.refusals.length ? [...optionsRefused, ...mapped.refusals] : optionsRefused;
    // Rows without data yet (the chunk loads, failed or refused them): no request is resolved, since a type's
    // preparation reads its data, and the busy box, the failure or the refusal card shows instead.
    const noData = (rows !== undefined || columns !== undefined) && mapped.data === undefined;
    const asked = container ? measured.size : size;
    // A zoomed view is a derived spec: the range as its view, or the readings in coarser buckets.
    const inherited = useMemo(() => ({ strings: providerStrings, language: languageOf(provider?.locale) }), [providerStrings, provider?.locale]);
    const zoomed = useZoom({ type, data, annotations, options: noteOptions as Record<string, unknown>, zoom: noData ? undefined : zoom, width: typeof asked === 'object' ? asked.width : undefined, inherited });
    // A prepared chart attaches the server's layout, which is checked against the current request. Print lays out
    // at once: the browser takes the printed page right after the print listener's render (printLayout.ts).
    // A zoomed view is a new request, so the server's layout no longer matches it and the client lays it out.
    // Once detached it stays detached: after a resize, a reset would no longer match it either.
    const detached = useRef<PreparedChart | undefined>(undefined);
    if (zoomed.derived && prepared) detached.current = prepared;
    const attached = zoomed.derived || detached.current === prepared ? undefined : prepared;
    const defer = deferLayout && attached === undefined && !measured.printing;
    const first = useDeferrableChartLayout({ type, data: zoomed.data as D, target, options: { ...zoomed.options as typeof noteOptions, size: asked }, annotations: zoomed.annotations as Annotation[] | undefined }, {},
      { prepared: attached, fit: measured.printFill ? 'fill' : resolvedFit, fallback: container ? measured.fallback : undefined, skipLayout: refusedOptions.length > 0 || measured.waiting || noData, idle: noData, errorAsRefusal: true, linked, defer });
    // A cohort refused for width alone draws at the width it needs in a horizontal
    // scroll box, as TableChart scrolls a wide table. A pinned height stays pinned. A prepared
    // chart attaches without a client layout, so its refusal keeps the card.
    const scrollable = SCROLLS_WIDE.has(type) && attached === undefined && (typeof asked !== 'object' || (asked as { unit?: string }).unit === undefined);
    // A compact cohort that left periods out for space scrolls too: the box can show every period, which a
    // static image cannot. The full-mode refusal at the same size names the width the whole table needs.
    const leftOut = scrollable && first.geometry !== undefined && !first.geometry.refused && isFullGeometry(first.geometry) && stableOptions.mode !== 'compact'
      && ((first.geometry.derived as { periodsLeftOut?: number[] } | undefined)?.periodsLeftOut?.length ?? 0) > 0;
    const full = useDeferrableChartLayout({ type, data: zoomed.data as D, target, options: { ...zoomed.options as typeof noteOptions, size: asked, mode: 'full' }, annotations: zoomed.annotations as Annotation[] | undefined }, {},
      { fit: resolvedFit, skipLayout: !leftOut, idle: noData, errorAsRefusal: true, linked, defer });
    const refusedWide = (geometry: typeof first.geometry) => geometry?.refused && geometry.size.width + SIZE_TOLERANCE < geometry.sizing.minWidth ? geometry : undefined;
    const short = scrollable ? refusedWide(first.geometry) ?? (leftOut ? refusedWide(full.geometry) : undefined) : undefined;
    // While a newer size lays out in the background, the scroll box keeps the size it was drawn at: `asked` is
    // already the new size, `first` still the old layout, and together they could drop a scroll that still draws.
    const shownWide = useRef<{ width: number; height?: number } | false | undefined>(undefined);
    // Print: a printed box too small for the chart lays it out in the smallest box of the same shape it fits, and the
    // drawing scales down into the printed box. A smaller chart reads better on paper than a refusal card, and the
    // same shape keeps the page as long as the browser counted it (printLayout.ts).
    const printShort = measured.printing && container && first.geometry?.refused
      && first.geometry.warnings.some(isSizeDependentRefusal) ? first.geometry : undefined;
    const wideSize = first.pending ? shownWide.current
      : printShort ? printBox(printShort, printShort)
      : short && { width: Math.ceil(short.sizing.minWidth), ...(typeof asked === 'object' && asked.height !== undefined ? { height: asked.height } : {}) };
    useEffect(() => { shownWide.current = wideSize; });
    const wide = useDeferrableChartLayout({ type, data: zoomed.data as D, target, options: { ...zoomed.options as typeof noteOptions, size: wideSize || undefined }, annotations: zoomed.annotations as Annotation[] | undefined }, {},
      { fit: printShort || measured.printFill ? 'fill' : resolvedFit, skipLayout: !wideSize, idle: noData, errorAsRefusal: true, linked, defer });
    // A story's step panel can raise the minimum at the larger box: print scales once more, from the minimum found there.
    const printShorter = printShort && wide.geometry?.refused && wide.geometry.warnings.some(isSizeDependentRefusal) ? wide.geometry : undefined;
    // Off print it reads nothing: no resolved request and no copy of the data on every render.
    const wider = useDeferrableChartLayout(printShorter ? { type, data: zoomed.data as D, target, options: { ...zoomed.options as typeof noteOptions, size: printBox(printShort!, printShorter) }, annotations: zoomed.annotations as Annotation[] | undefined } : IDLE_REQUEST, {},
      { fit: 'fill', skipLayout: !printShorter, idle: !printShorter, errorAsRefusal: true, linked, defer });
    const draws = (layout: typeof wide) => layout.geometry !== undefined && !layout.geometry.refused && isFullGeometry(layout.geometry) && chartRefusals(layout.geometry.warnings).length === 0;
    const scrolls = draws(wide) || (printShorter !== undefined && draws(wider));
    const resolved = printShorter && draws(wider) ? wider : scrolls ? wide : first;
    const fitted = scrolls && measured.printing;
    // Print keeps the scroll box the screen had, drawn open, so the chart under it is not mounted again (story step).
    const screenScroll = useRef(false);
    if (!measured.printing) screenScroll.current = scrolls;
    const scrollBox = SCROLLS_WIDE.has(type) && (measured.printing ? screenScroll.current : scrolls);
    // A core module this bundle links on demand (the theme checks a patched
    // theme needs, the annotation placement pass): the chart waits on the
    // busy placeholder for exactly as long as the chunk takes.
    // A grid's failure comes with its layout: the panel types it needs that did not load.
    const moduleFailure = useDeferredModule(resolved.deferred);
    const failure = resolved.failure ?? moduleFailure ?? mapped.failure;
    // What the CLI refuses, React refuses with the same findings: the
    // layout's error lints draw the error card instead of the chart. A finding at a
    // mapped data field names the rows field, as the CLI's does; a zoomed view's
    // buckets came from several rows and keep their own path.
    const rewriteWarnings = zoomed.derived ? undefined : mapped.rewriteWarnings;
    const geometry = useMemo(() => {
      const drawnGeometry = resolved.geometry;
      return drawnGeometry?.warnings && rewriteWarnings ? { ...drawnGeometry, warnings: rewriteWarnings(drawnGeometry.warnings) } as typeof drawnGeometry : drawnGeometry;
    }, [resolved.geometry, rewriteWarnings]);
    // A host that is still growing passes through sizes the chart refuses: the busy box stands in (useRefusalSettle).
    const layoutRefusals = chartRefusals(geometry?.warnings ?? []);
    const refusedHere = container && refusedOptions.length === 0 && layoutRefusals.length > 0 && layoutRefusals.every(isSizeDependentRefusal);
    // Print takes the page right after this render: a refusal there shows at once, never the busy box.
    const settling = useRefusalSettle(refusedHere && !measured.printing, measured.client, `${measured.size.width}x${measured.size.height ?? ''}`, geometry);
    const displayRef = useDisplayWarnings(settling ? undefined : geometry, onWarnings);
    zoomed.seen(geometry && !geometry.refused && isFullGeometry(geometry) ? geometry : undefined);
    const attachZoom = zoomed.attach;
    const chartRef = useCallback((element: HTMLDivElement | null) => {
      displayRef(element);
      attachZoom(element);
    }, [displayRef, attachZoom]);
    const refusals = refusedOptions.length ? refusedOptions : !geometry || geometry.refused ? []
      : isFullGeometry(geometry) ? refusalFindings(chartRefusals(geometry.warnings)) : geometry.refusals ?? [];

    useEffect(() => {
      if (geometry && !geometry.refused && isFullGeometry(geometry) && refusals.length === 0) onGeometry?.(geometry);
    }, [onGeometry, geometry, refusals.length]);
    // The scroll box reports its state as TableChart's scroller does, so a host can fade the cut edge.
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
    const scrollListener = useRef(onScrollChange);
    scrollListener.current = onScrollChange;
    const scrollReported = useRef(false);
    const scrollLabel = useRef('');
    scrollLabel.current = typeof (options as { title?: unknown }).title === 'string' && (options as { title: string }).title ? (options as { title: string }).title : `${type} chart`;
    const live = scrolls ? scroller : null;
    useEffect(() => {
      // A chart that stops scrolling (a wider box) reports the empty state once, so a host drops its fade.
      if (live === null) {
        if (scrollReported.current) scrollListener.current?.(scrollStateOf(null));
        scrollReported.current = false;
        return undefined;
      }
      scrollReported.current = true;
      const report = () => {
        markScrollRegion(live, scrollLabel.current);
        scrollListener.current?.(scrollStateOf(live));
      };
      report();
      live.addEventListener('scroll', report, { passive: true });
      const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : undefined;
      resize?.observe(live);
      return () => {
        live.removeEventListener('scroll', report);
        resize?.disconnect();
      };
      // A wider drawing in the same box changes the scroll width without a resize of the box.
    }, [live, scrolls ? resolved.geometry?.size.width : undefined]);
    // Footer rule: the notes under the chart are HTML.
    const footer = geometry && !geometry.refused && geometry.frame?.noteList?.length ? geometry : undefined;
    const notes = useMemo(() => (footer ? chartNotes(footer) : []), [footer]);
    // Content fit drew the static footer (layoutContainerRequest); the HTML footer draws its lines as drawn.
    const asDrawn = (resolved === wider ? 'fill' : measured.printFill || (resolved === wide && printShort) ? 'fill' : resolvedFit) === 'content';
    const footless = useMemo(() => (footer ? withoutSvgFooter(footer, asDrawn) : undefined), [footer, asDrawn]);
    // A list that empties after an update is reported too, once, as [].
    const notesSent = useRef(false);
    useEffect(() => {
      if (!footer && !notesSent.current) return;
      notesSent.current = footer !== undefined;
      onNotes?.(notes);
    }, [onNotes, notes, footer]);
    const pinned = container ? measured.pinnedHeight : size !== undefined && (typeof size === 'string' || size.height !== undefined);
    // The export lays out what is on screen: no snapshot while a refusal, the busy box or an older drawing shows.
    const [storyStep, setStoryStep] = useState<string>();
    const shown = !settling && refusals.length === 0 && !resolved.deferred && !resolved.pending && geometry && !geometry.refused ? geometry : undefined;
    useChartExport(exporter, shown && resolved.request, zoomed.data, shown?.size, container || scrolls, pinned, storyStep);

    // The wrapper the container size is measured on; a filling chart's first
    // child is the probe that reads the host's height (useContainerSize).
    const frame = (children: ReactNode) => {
      const body = container ? <div ref={measured.wrapperRef} data-bp-container={resolvedFit} style={measured.wrapperStyle}>
        {measured.probed && <div data-bp-probe="" aria-hidden="true" style={PROBE_STYLE} />}
        {children}
      </div> : children as ReactElement;
      return idPrefix === undefined ? body : <IdPrefixContext.Provider value={checkedIdPrefix(idPrefix)}>{body}</IdPrefixContext.Provider>;
    };

    // The busy box takes the refusal's size: a host without a height
    // would otherwise swap heights, show or hide its scrollbar and restart the settle.
    if (settling && resolved.request && geometry) return frame(<LoadingPlaceholder fixedSize={fixedSize} theme={resolved.request.theme} size={geometry.size} options={{ ...stableOptions, target }} />);
    if (noData && refusals.length) return frame(<LayoutRefusal fixedSize={fixedSize} refusals={refusals} theme={(stableOptions as { theme?: ThemeRef }).theme} options={{ ...stableOptions, size: container ? measured.size : size, target }} />);
    if (refusals.length && resolved.request) return frame(<LayoutRefusal fixedSize={fixedSize} refusals={refusals} theme={resolved.request.theme} options={resolved.request.options} size={geometry?.size ?? resolved.request.size} />);
    // Nothing below reads a request the resolution did not produce: a chart
    // waiting for a core module draws the busy box and no more.
    if (!resolved.request || !geometry) {
      return frame(<LoadingPlaceholder fixedSize={fixedSize} theme={(stableOptions as { theme?: ThemeRef }).theme} failure={failure} options={{ ...stableOptions, size: container ? measured.size : size, target }} />);
    }

    const theme = resolved.request.theme;
    const table = resolved.request.options.a11y?.table;
    if (geometry.refused) {
      return frame(<SizePlaceholder fixedSize={fixedSize} result={geometry} theme={theme} options={resolved.request.options} onRefused={onRefused} renderRefused={renderRefused} onEmpty={onEmpty} />);
    }
    const request = resolved.request;
    // One style element per chart: with a hover surface, the footer's print rule rides in its style.
    const surface = Boolean(hoverFlags(hover) || table || onRecordClick || renderHoverContent);
    const draw = (shown: RenderGeometry) => {
      const view = !footer ? shown : shown === footer ? footless! : withoutSvgFooter(shown, asDrawn);
      return surface
        ? <DrawnSurface geometry={view} request={request} prepared={attached} hover={hover} table={table} responsive={!fixedSize && (!scrolls || fitted)} styleNonce={styleNonce} extraCss={footer ? FOOTER_PRINT_CSS : ''} onSeriesClick={onSeriesClick} onRecordClick={onRecordClick} renderHoverContent={renderHoverContent} />
        : <DrawnScene geometry={view} theme={theme} responsive={!fixedSize && (!scrolls || fitted)} onSeriesClick={onSeriesClick} />;
    };
    const drawn = geometry;
    const chart = (
      <div ref={chartRef} {...zoomed.active && { 'aria-keyshortcuts': '+ - 0 Shift+ArrowLeft Shift+ArrowRight', ...!hoverFlags(hover) && onRecordClick === undefined && renderHoverContent === undefined && { tabIndex: 0 } }} style={{ position: 'relative', ...(scrolls && !fitted ? { width: drawn.size.width } : {}), maxWidth: !container || resolvedFit === 'content' || drawn.sizing?.fit === 'content' ? drawn.size.width : undefined }}>
        {drawn.story && storyLink
          ? <storyLink.Frame {...storyLink} onStep={exporter && setStoryStep} geometry={{ ...drawn, story: drawn.story }} theme={theme} strings={{ ...localeStrings(request.locale?.language), ...request.options.strings }} render={draw} styleNonce={styleNonce} />
          : draw(drawn)}
        {footer && <ChartFooter geometry={footer} notes={notes} theme={theme} strings={{ ...localeStrings(request.locale?.language), ...request.options.strings }} sourceWord={request.options.strings?.source} renderNotes={renderNotes} styleNonce={styleNonce}
          show={shownNoteKinds(request.options as Parameters<typeof shownNoteKinds>[0])}
          pinned={pinned} asDrawn={asDrawn}
          pointer={request.options.footnotes !== false && (request.options as { notes?: { pointer?: boolean } }).notes?.pointer !== false} ownStyle={!surface} />}
      </div>
    );
    return frame(scrollBox ? <div ref={setScroller} data-bp-scroll="" className="bp-scroll" style={{ overflowX: fitted ? 'visible' : 'auto', maxWidth: '100%' }}>{chart}</div> : chart);
  }
  Chart.displayName = `${type[0]!.toUpperCase()}${type.slice(1)}Chart`;
  // First-class, not name-shaped: the public API check resolves type → component
  // from this stamp, so a rename of the export or of displayName cannot make a
  // registered type look covered (or uncovered) by accident.
  Chart.chartType = type;
  rebindable(Chart, (relinked): unknown => createChartComponent<D, O>(type, checkKeys, relinked));
  return Chart;
}
