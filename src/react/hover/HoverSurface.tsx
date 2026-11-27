import { createContext, useContext, useEffect, useId, useMemo, type CSSProperties, type ReactElement } from 'react';
import type { InteractionRecord } from '../../core/a11y/types';
import type { A11yTablePlacement } from '../../core/a11y/accessibility';
import type { Id } from '../../core/types/cell';
import type { ResolvedChartRequest } from '../../core/request';
import type { PreparedChart, RenderGeometry } from '../prepared';
import { SceneRenderer, type SeriesToggle } from '../SceneRenderer';
import { a11ySurfaceStyle, keyRingStyle } from '../a11ySurface';
import { useHover, useOptionalModule, type HoverOption, type KeyCursor, type RecordClickEvent, type RenderHoverContent } from '../useHover';

type DataTableModule = typeof import('./dataTable');
/** BoardplotChart supplies the table on its first client render, as before. */
export const DataTableContext = createContext<DataTableModule | undefined>(undefined);

const loadDataTable = () => import('./dataTable');

/**
 * A drawn chart with the hover card and highlight, and the record-derived
 * accessible data table when `options.a11y.table` asks for one. Chart
 * components render this instead of the bare SceneRenderer only when one of
 * the two is on, so a static chart's markup is unchanged. The table loads
 * independently of the hover engine.
 */
export function HoverSurface({ geometry, request, prepared, hover, table, responsive, background, styleNonce, extraCss = '', onSeriesClick, onRecordClick, onHoverChange, renderHoverContent, onStackFocus, seriesToggle }: {
  geometry: RenderGeometry;
  request: ResolvedChartRequest;
  prepared?: PreparedChart;
  hover?: HoverOption;
  table?: A11yTablePlacement;
  responsive: boolean;
  background?: 'theme' | 'transparent';
  /** CSP nonce for the style elements this surface renders. */
  styleNonce?: string;
  /** More rules for the same style element (the HTML footer's print rule), so a chart renders one. */
  extraCss?: string;
  onSeriesClick?: (seriesId: Id) => void;
  onRecordClick?: (record: InteractionRecord, event: RecordClickEvent) => void;
  onHoverChange?: (records: InteractionRecord[]) => void;
  renderHoverContent?: RenderHoverContent;
  /** A metric stack's focus look: the category the pointer or the keyboard rests on, undefined at rest. The chart lays the stack out with it. */
  onStackFocus?: (category: string | undefined) => void;
  seriesToggle?: SeriesToggle;
}): ReactElement {
  const { engine, view, origin, follow, handlers, focusStops, keys, scrub, cursor, cardRef, hostRef, focusCategory } = useHover({ request, geometry, prepared, hover, onRecordClick, onHoverChange,
    custom: renderHoverContent !== undefined });
  useEffect(() => { onStackFocus?.(focusCategory); }, [onStackFocus, focusCategory]);
  const contentId = `${useId()}-card`;
  const content = engine?.hostContent(view, renderHoverContent, cursor?.active === true);
  const custom = content !== undefined && content !== null && content !== false;
  const dataTable = useOptionalModule(useContext(DataTableContext), Boolean(table), loadDataTable);
  // The ring of the keyboard stop is needed before the engine is: the rules ride with the stop.
  const rules = keys || dataTable !== undefined;
  // A new innerHTML object replaces the stylesheet even when its text is unchanged.
  const css = useMemo(() => ({ __html: ((rules ? a11ySurfaceStyle(request.theme) : '') + extraCss).replace(/</g, '\\3c ') }),
    [rules, request.theme, extraCss]);
  const style = useMemo(() => ({ position: 'relative', ...keys && keyRingStyle(request.theme), ...scrub && { touchAction: 'pan-y pinch-zoom' } }) as CSSProperties,
    [keys, scrub, request.theme]);
  return <div ref={hostRef} data-bp-hover="" data-bp-keyed={cursor?.active ? '' : undefined} style={style} {...handlers}>
    {/* Raw text, as the table's: React 18's server escaped the quotes of a text child. A `<` is CSS-escaped, so no theme value can end the element. */}
    {css.__html && <style nonce={styleNonce} dangerouslySetInnerHTML={css} />}
    <SceneRenderer geometry={view} theme={request.theme} responsive={responsive} background={background} onSeriesClick={onSeriesClick} seriesToggle={seriesToggle} focusStops={focusStops} />
    {keys && <RecordKeys geometry={geometry} responsive={responsive} cursor={cursor} describedBy={custom ? contentId : undefined} />}
    {engine && <engine.Cards view={view} origin={origin} follow={follow} content={custom ? content : undefined} hosted={renderHoverContent !== undefined}
      contentId={contentId} locale={request.locale?.language} cardRef={cardRef} />}
    {dataTable && table && <dataTable.DataTable request={request} geometry={geometry} prepared={prepared} mode={table} />}
  </div>;
}

const HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/**
 * The chart's one keyboard stop, laid over the drawn SVG and transparent to
 * the pointer. It follows the W3C APG listbox pattern with
 * `aria-activedescendant`: the focus stays on the list, and the one option
 * it names carries the focused record's card reading, its place and the
 * count. The SVG keeps `role="img"`, its label and description for readers
 * who do not enter the chart. The client renders it once the hover engine
 * has loaded, so server markup and hydration do not change.
 */
function RecordKeys({ geometry, responsive, cursor, describedBy }: { geometry: RenderGeometry; responsive: boolean; cursor?: KeyCursor; describedBy?: string }): ReactElement {
  const base = useId();
  const { size, presentation } = geometry;
  const natural = presentation?.naturalSize;
  const option = cursor && `${base}-${cursor.index}`;
  return <div data-bp-keys="" role="listbox" tabIndex={0} aria-label={geometry.a11y.title} aria-activedescendant={option}
    style={{ position: 'absolute', left: 0, top: 0, width: natural?.unit === 'pt' ? `${natural.width}pt` : size.width,
      maxWidth: responsive ? '100%' : undefined, aspectRatio: `${size.width} / ${size.height}`, pointerEvents: 'none' }}>
    {cursor && <div key={cursor.id} id={option} role="option" aria-selected="true" aria-posinset={cursor.index + 1} aria-setsize={cursor.size} aria-describedby={describedBy}
      style={HIDDEN}>{cursor.reading}</div>}
  </div>;
}
