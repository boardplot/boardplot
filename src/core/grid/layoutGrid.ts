import { alignCategoryPanels, alignValuePanels } from './panelAlignment';
import { chartString } from '../strings/layoutGrid';
/**
 * Grid — facets AND variance tiers, one primitive.
 * `sharedAxis: 'category'` aligns panels column-for-column via a two-pass
 * layout: pass 1 discovers each panel's plot rect, pass 2 re-lays out with
 * left/right margins adjusted so every plot spans the same x-range. Child
 * geometries are id-prefixed and translated into place — the composed scene
 * stays paint-ready; renderers still add nothing.
 */

import { frameTextOptions, LEFT_OUT_OF_NOTE, valueNoteLine, panelNoteTexts, solveFrame, type FrameInput } from '../frame';
import { collectGridLegendItems, gridLegendInput, gridPanelsKeepEndNames, hatchStrengthFor } from './gridKey';
import { balanceVarianceTierPlots, VARIANCE_TIER, varianceTierWeights } from './varianceTiers';
import { boundsOf, type Rect } from '../geometry';
import { createOccupiedIndex } from '../label/occupied';
import { PRIORITY, solveLabels, type LabelRequest } from '../label/solver';
import { accessibleTitle, NormalizeError, resolveCanvasOptions, resolveSize } from '../normalize/shared';
import { getChart } from '../registry';
import { panelNoteData } from '../panelNoteData';
import { GridChildRefusal, gridRowHeights, gridSizing, hasKpiFigure, layoutChildChart, smallestKpiValueSize } from './childLayout';
import { KPI_HOST_TEXT, KPI_VALUE_SIZE } from '../typeFloors';
import { stringsIn } from '../frame';
import { authoredStrings } from '../strings';
import { defaultMeasurer } from '../text';
import { canvasMargin, panelTypeClass, resolveTheme, themeForWidth, typeWidthClass, type TypeWidthClass } from '../theme';
import type { GridData, GridPanel } from '../types/data';
import type { ThemeRef } from '../types/theme';
import type { GridOptions, LegendOptions } from '../types/options';
import type { AxisGeometry, Geometry, LayoutResult, LintWarning, PlacedLabel, SceneNode } from '../types/scene';
import { isRecord } from '../lint/shared';
import { maxOf, minOf } from '../arrays';

export interface GridMarks {
  panels: {
    id: string;
    type: string;
    plot: Rect;
    content: Rect;
    title: string;
    chart?: { options: object; geometry: Geometry; offset: { x: number; y: number }; warningOffset?: number; warningOwnerPrefix?: string; theme?: ThemeRef };
    titleNodeId?: string;
    captionNodeId?: string;
  }[];
}

export interface GridDerived {
  sharedPlotX?: number;
  sharedPlotW?: number;
  tierGap?: number;
}

function serializableOptions(options: object & { measure?: unknown }): object {
  const { measure: _measure, ...rest } = options;
  return rest;
}

const TIER_WEIGHT_FIRST = 2.2;
const TIER_SLACK_PASSES = 32;
const TIER_SLACK_BACKOFFS = 8;

/**
 * The name every panel shares as options.scaleGroup.y, or null. Panels on one
 * value scale must get equal slot heights — otherwise identical domains map to
 * different pixel-per-unit rates and "same scale" is a lie the eye catches.
 */
export function sharedYGroup(panels: { options?: object }[]): string | null {
  let group: string | null = null;
  for (const p of panels) {
    const sg = (p.options as Record<string, unknown> | undefined)?.scaleGroup;
    const y =
      sg !== null && typeof sg === 'object' && !Array.isArray(sg)
        ? (sg as Record<string, unknown>).y
        : undefined;
    if (typeof y !== 'string') return null;
    if (group === null) group = y;
    else if (group !== y) return null;
  }
  return group;
}

export function tierWeights(panels: { type?: string; options?: object }[]): number[] {
  const uniformScale = sharedYGroup(panels) !== null;
  const varianceWeights = !uniformScale ? varianceTierWeights(panels) : undefined;
  if (varianceWeights) return varianceWeights;
  return panels.map((_, index) =>
    index === 0 && panels.length > 1 && !uniformScale ? TIER_WEIGHT_FIRST : 1,
  );
}

/** The first tier that has not explicitly suppressed category labels. */
export function sharedCategoryLabelOwner(panels: { options?: object }[]): number {
  return panels.findIndex((panel) => {
    const options = isRecord(panel.options) ? panel.options : {};
    if (options.labels === false) return false;
    return !isRecord(options.labels) || options.labels.category !== false;
  });
}

/** Bottom-up tier order: the shared category-axis owner anchors the exhibit. */
export function bottomUpTierOrder(panels: { options?: object }[]): number[] {
  const owner = sharedCategoryLabelOwner(panels);
  const indexes = panels.map((_, index) => index);
  return owner < 0 ? indexes : [owner, ...indexes.filter((index) => index !== owner)];
}

/** Only variance tiers imply a shared category stack. Facets keep array order. */
export function gridShare(panels: { type?: string; options?: object }[], share?: GridOptions['sharedAxis']): 'category' | 'none' {
  return share ?? (varianceTierWeights(panels) ? 'category' : 'none');
}

function soloPanelReserve(share: GridOptions['sharedAxis'], panels: GridPanel[]): number {
  if (share !== 'category' || panels.length !== 1) return 0;
  const panel = panels[0]!;
  const hasCaption =
    (typeof panel.title === 'string' && panel.title.trim().length > 0) ||
    (typeof panel.caption === 'string' && panel.caption.trim().length > 0);
  const marginTop = (panel.options as { margin?: { top?: number } } | undefined)?.margin?.top;
  return hasCaption ? (typeof marginTop === 'number' ? marginTop : 20) : 0;
}

/** Internal: the note line naming panel values the panels could not print. */
const PANEL_VALUE_NOTE = Symbol('panelValueNote');
/**
 * Facet gaps: the one internal set of gaps between grid panels. Not an option and
 * not a schema field; a theme moves them only through `space.tierGap` and `space.facetGap`.
 *
 * - Tier gap (`theme.space.tierGap`): between stacked tiers of a one-column grid.
 * - Facet gap (`theme.space.facetGap`, 28 px in the default theme): between the rows and the
 *   columns of plain facets; the authored grid's `gutters` also default to it.
 * - FACET_HEADED_ROW_GAP (5 px): between the rows of facets that carry their own heading band
 *   (an axis label baseline stands 27 px over the next heading).
 * - Headed column gap (`facetHeadedColumnGap`): between the columns of those facets. The facet gap
 *   scaled along FACET_HEADED_COLUMN_LADDER, the gutter per card width
 *   (20 / 24 / 32 / 40 / 48 px at 320 / 400 / 480 / 720 / 960 for the default 28 px).
 *
 * The grid chart hands the headed gaps to the composer under FACET_GAPS; without it the
 * composer uses the tier gap or the facet gap.
 */
const FACET_HEADED_ROW_GAP = 5;
const FACET_HEADED_COLUMN_LADDER: readonly (readonly [width: number, gap: number])[] = [[320, 20], [400, 24], [480, 32], [720, 40], [960, 48]];
/** The default theme's facet gap, the base the ladder is measured against. */
const FACET_GAP_BASE = 28;

/** The column gap of headed facets on a card `width` px wide (see Facet gaps). */
function facetHeadedColumnGap(facetGap: number, width: number): number {
  // Linear between the ladder's widths; the end steps hold outside them.
  const ladder = FACET_HEADED_COLUMN_LADDER;
  const i = ladder.findIndex(([w]) => w >= width);
  let gap: number;
  if (i === 0) gap = ladder[0]![1];
  else if (i < 0) gap = ladder[ladder.length - 1]![1];
  else {
    const [w0, g0] = ladder[i - 1]!;
    const [w1, g1] = ladder[i]!;
    gap = g0 + ((g1 - g0) * (width - w0)) / (w1 - w0);
  }
  return Math.round((gap * facetGap) / FACET_GAP_BASE);
}

/** The gaps of headed facets (see Facet gaps). */
export function facetHeadedGaps(facetGap: number, width: number): { row: number; column: number } {
  return { row: FACET_HEADED_ROW_GAP, column: facetHeadedColumnGap(facetGap, width) };
}

/** Internal option key: the row and column gaps the grid chart sets for headed facets. */
export const FACET_GAPS = Symbol('facetGaps');

/** Internal option key: the panel ids of each shared y scale group the grid chart resolved; a clamped or log panel left its group. */
export const SCALE_GROUP_MEMBERS = Symbol('scaleGroupMembers');

/**
 * A column panel leaves the values it cannot print to its grid
 * (column/layout.ts), so the grid names them in its note line. The note takes
 * footer height and moves the panels, so the grid is laid out again with it
 * until the named set holds (three passes at most, as a column does).
 */
export function layoutGrid(data: GridData, options: GridOptions = {}): LayoutResult<GridMarks, GridDerived> {
  let named: string[] = [];
  let geometry = layoutGridPass(data, options);
  for (let round = 0; round < 2; round++) {
    if (geometry.refused) return geometry;
    const unprinted = unprintedPanelValues(data, geometry);
    if (unprinted.every((item) => named.includes(item))) break;
    named = [...new Set([...named, ...unprinted])];
    geometry = layoutGridPass(data, { ...options, [PANEL_VALUE_NOTE]: named } as GridOptions);
  }
  return geometry;
}

/** "APAC in Q1 12": each value a panel hid, named by its series and category, the panel's title first when several panels hide one. */
function unprintedPanelValues(data: GridData, geometry: { labels: readonly PlacedLabel[] }): string[] {
  const byPanel = data.panels.map((panel) => {
    // Likert owns its complete named-share disclosure, including in a panel.
    if (panel.type === 'likert') return { title: panel.title ?? panel.id, items: [] };
    const prefix = `${panel.id}/`;
    const panelData = panel.data as { categories?: ({ id: string; label?: string } | string)[]; series?: { id: string; label?: string }[] } | undefined;
    const nameOf = (list: ({ id: string; label?: string } | string)[] | undefined, id: string | undefined): string => {
      const found = list?.find((entry) => (typeof entry === 'string' ? entry : entry.id) === id);
      return found === undefined ? String(id) : typeof found === 'string' ? found : found.label ?? found.id;
    };
    const unprefix = (id: string | undefined) => (id?.startsWith(prefix) ? id.slice(prefix.length) : id);
    const order = (id: string | undefined) => panelData?.categories?.findIndex((entry) => (typeof entry === 'string' ? entry : entry.id) === id) ?? -1;
    const items = geometry.labels
      .filter((label) => label.id.startsWith(prefix) && label.hidden && label.kind === 'segment' && /\d/.test(label.text))
      .sort((a, b) => order(unprefix(a.owner.categoryId)) - order(unprefix(b.owner.categoryId)))
      .map((label) => `${nameOf(panelData?.series, unprefix(label.owner.seriesId))} in ${nameOf(panelData?.categories, unprefix(label.owner.categoryId))} ${label.text}`);
    return { title: panel.title ?? panel.id, items };
  }).filter((entry) => entry.items.length > 0);
  return byPanel.flatMap((entry) => (byPanel.length > 1 ? entry.items.map((item) => `${entry.title}: ${item}`) : entry.items));
}

function layoutGridPass(data: GridData, options: GridOptions = {}): LayoutResult<GridMarks, GridDerived> {
  options = resolveCanvasOptions(options);
  if (!data || !Array.isArray(data.panels) || data.panels.length === 0) {
    throw new NormalizeError('empty-data', 'panels', 'grid requires at least one panel');
  }
  const size = resolveSize(options.size);
  // Panels inherit the GRID canvas's width class (a panel is not a canvas).
  const gridClass: TypeWidthClass = panelTypeClass(options) ?? typeWidthClass(size.width);
  const theme = themeForWidth(resolveTheme(options.theme), gridClass);
  const measure = options.measure ?? defaultMeasurer;
  const share = gridShare(data.panels, options.sharedAxis);
  const compactTiers = share === 'category' && data.panels.length > 1;
  const varianceTiers = compactTiers && varianceTierWeights(data.panels) !== undefined;
  const varianceWeights = varianceTiers && sharedYGroup(data.panels) === null ? tierWeights(data.panels) : undefined;
  const warnings: LintWarning[] = [];
  if (share === 'category' && ((options.columns ?? 1) !== 1 || options.panelOrder !== undefined)) {
    warnings.push({ code: 'grid-tier-order', severity: 'warn',
      message: 'Category tiers use one column and bottom-up order, with the category-axis owner at the bottom; columns and panelOrder do not set their visual order',
      suggest: "use sharedAxis: 'none' for facet columns in array or panelOrder order" });
  }
  if (options.valueAxis?.break) warnings.push({ code: 'axis-break-unsupported', severity: 'warn', message: "chart type 'grid' does not support valueAxis.break — ignored" });
  let legendInput: FrameInput['legend'];
  if (options.legend && options.legend !== 'none' && options.legend !== 'auto') {
    const legendOptions: LegendOptions =
      typeof options.legend === 'string' ? { position: options.legend } : options.legend;
    legendInput = gridLegendInput(collectGridLegendItems(data.panels, options, measure), legendOptions, options, warnings);
  }

  // ---- grid-level frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      ...panelValueFootnotes(options),
      legend: legendInput,
      theme,
      measure,
    },
    occupied,
  );
  const area = frameResult.plot;

  // ---- panel slots ----
  const n = data.panels.length;
  const categoryOwner = compactTiers ? sharedCategoryLabelOwner(data.panels) : -1;
  const bottomUpOrder = bottomUpTierOrder(data.panels);
  const columns = share === 'category' ? 1 : Math.max(1, options.columns ?? 1);
  const rows = Math.ceil(n / columns);
  const facetGaps = (options as { [FACET_GAPS]?: { row: number; column: number } })[FACET_GAPS];
  const gap = columns === 1 ? theme.space.tierGap : facetGaps?.column ?? theme.space.facetGap;
  const rowGap = columns === 1 ? gap : facetGaps?.row ?? gap;
  const slots: Rect[] = [];
  if (share === 'category') {
    const gap = theme.space.tierGap;
    const weights = tierWeights(data.panels);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const usable = area.h - gap * (n - 1);
    let y = area.y + area.h;
    for (const i of bottomUpOrder) {
      const h = (usable * weights[i]!) / wSum;
      y -= h;
      slots[i] = { x: area.x, y, w: area.w, h };
      y -= gap;
    }
  } else {
    const cols = columns;
    const cw = (area.w - gap * (cols - 1)) / cols;
    const ch = (area.h - rowGap * (rows - 1)) / rows;
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      slots.push({ x: area.x + c * (cw + gap), y: area.y + r * (ch + rowGap), w: cw, h: ch });
    }
  }

  // ---- category consistency check (sharedAxis mode) ----
  if (share === 'category') {
    const idLists = data.panels.map((p) => {
      const d = p.data as { categories?: ({ id?: string } | string)[] } | undefined;
      return Array.isArray(d?.categories) ? d.categories.map((c) => (typeof c === 'string' ? c : c.id)) : null;
    });
    const first = idLists.findIndex((ids) => ids !== null);
    const firstIds = idLists[first];
    const other = idLists.findIndex((ids) => ids !== null && firstIds != null
      && (ids.length !== firstIds.length || ids.some((id, index) => id !== firstIds[index])));
    // Shared positions over different categories would put one
    // panel's Q3 above another's Mar, so the grid is refused, not drawn.
    if (other >= 0) {
      warnings.push({
        code: 'grid-category-mismatch',
        severity: 'error',
        message: `sharedAxis "category" aligns every panel on one category axis, but panel '${data.panels[other]!.id}' has categories ${idLists[other]!.join(', ')} where panel '${data.panels[first]!.id}' has ${firstIds!.join(', ')}`,
        suggest: "give every panel the same category ids in the same order, or set options.sharedAxis to 'none' so each panel keeps its own axis. The independent axes can need more room; leave the height open or increase the chart size.",
        field: ['data', 'panels', other, 'data', 'categories'],
      });
    }
  }

  // ---- layout children (two passes when aligning) ----
  let uniformLineEndpointLegend = false;
  // under legend 'none', or a key row that keys only some series, each line
  // panel keeps the end names it can fit; a panel that cannot fit them is keyed by the grid.
  const keepEndNames = gridPanelsKeepEndNames(options);
  let kpiValueSize: number | undefined;
  const layoutPanel = (
    panel: GridPanel,
    panelIndex: number,
    slot: Rect,
    marginLR?: { left?: number; right?: number; bottom?: number },
  ) => {
    const def = getChart(panel.type);
    if (!def) {
      throw new NormalizeError('unknown-type', `panels[${panel.id}].type`, `unknown chart type '${panel.type}'`);
    }
    const panelOpts = resolveCanvasOptions((panel.options ?? {}) as Record<string, unknown>);
    const authoredTitle =
      typeof panelOpts.title === 'string' && panelOpts.title.trim().length > 0 ? panelOpts.title : undefined;
    const panelCaption = (panel as GridPanel & { caption?: unknown }).caption;
    const tierDetail =
      compactTiers && typeof panelCaption === 'string' && panelCaption.trim().length > 0
        ? panelCaption.trim()
        : undefined;
    const labels =
      compactTiers && panelIndex !== categoryOwner ? withoutCategoryLabels(panelOpts.labels) : panelOpts.labels;
    const suppressTitle = compactTiers && panelOpts.title !== false && (authoredTitle !== undefined || def.type === 'variance');
    const opts = {
      ...def.defaults,
      ...panelOpts,
      ...(hasKpiFigure(def.type) && kpiValueSize !== undefined ? { [KPI_VALUE_SIZE]: kpiValueSize } : {}),
      ...(def.type === 'kpi' ? { [KPI_HOST_TEXT]: stringsIn([panelCaption, (panel as { title?: unknown }).title, options.title, options.subtitle, options.footnotes, options.source]) } : {}),
      // The value is the panel count, so a tier knows whether it is the only one (isSingleVarianceTier).
      ...(varianceTiers && def.type === 'variance' ? { [VARIANCE_TIER]: data.panels.length } : {}),
      ...(compactTiers
        ? { ...(suppressTitle ? { title: '' } : {}), ...(labels !== undefined ? { labels } : {}) }
        : {}),
      ...(panel.annotations ? { annotations: panel.annotations } : {}),
      ...(legendInput && def.type === 'column' ? { [Symbol.for('boardplot.panelKeyed')]: true } : {}),
      ...(uniformLineEndpointLegend && def.type === 'line'
        ? { gridEndpointIdentity: 'legend' as const }
        : {}),
      target: options.target, theme: panelOpts.theme ?? options.theme,
      locale: panelOpts.locale ?? options.locale,
      ...hatchStrengthFor(panelOpts as Record<string, unknown>, options),
      ...(options.strings ? { strings: { ...authoredStrings(options), ...(panelOpts.strings as object) } } : {}),
      size: { width: slot.w, height: slot.h },
      ...(marginLR
        ? { margin: { ...(panelOpts.margin as object | undefined), ...marginLR } }
        : {}),
      measure,
      typeClass: panelTypeClass(options) ?? typeWidthClass(resolveSize(options.size).width),
    };
    const probe = layoutChildChart(panel.data, opts, def.layout as (data: unknown, options: unknown) => LayoutResult);
    if (probe.refused) throw new GridChildRefusal(panel.id, probe);
    const autoTierName = (probe.derived as { tierName?: unknown }).tierName;
    const tierCaption = compactTiers && panelOpts.title !== false
      ? authoredTitle ?? (typeof autoTierName === 'string' ? autoTierName : undefined)
      : undefined;
    const tierFont = { family: theme.type.family, ...theme.type.axis };
    const tierReserve = compactTiers
      ? (tierCaption ? measure(tierCaption, tierFont).height : 0) +
        (tierCaption && tierDetail ? theme.space.labelPad : 0) +
        (tierDetail ? measure(tierDetail, tierFont).height : 0) +
        (tierCaption || tierDetail ? theme.space.labelPad : 0)
      : 0;
    const childMargin: Record<string, unknown> = isRecord(opts.margin) ? opts.margin : {};
    const marginTop = typeof childMargin.top === 'number' ? childMargin.top : 20;
    let finalOptions = tierReserve > 0 ? { ...opts, margin: { ...childMargin, top: Math.max(marginTop, tierReserve) } } : opts;
    let geo =
      tierReserve > marginTop
        ? layoutChildChart(panel.data, finalOptions, def.layout as (data: unknown, options: unknown) => LayoutResult)
        : probe;
    if (geo.refused) throw new GridChildRefusal(panel.id, geo);
    // upper endpoint labels can extend above the plot's top margin.
    // Reserve the caption above the child's first ink, not just above its plot.
    if (options.target && tierReserve > 0) {
      for (let pass = 0; pass < 3; pass++) {
        const missing = Math.ceil(tierReserve - occupiedBounds(geo).y);
        if (missing <= 0) break;
        const margin = finalOptions.margin as Record<string, number> | undefined;
        finalOptions = { ...finalOptions, margin: { ...margin, top: (margin?.top ?? marginTop) + missing } };
        geo = layoutChildChart(panel.data, finalOptions, def.layout as (data: unknown, options: unknown) => LayoutResult);
        if (geo.refused) throw new GridChildRefusal(panel.id, geo);
      }
    }
    return {
      def,
      geo,
      recordOptions: serializableOptions(finalOptions),
      tierCaption,
      ...(tierDetail ? { tierDetail } : {}),
    };
  };

  const baseMargins = data.panels.map((p) => {
    const m = resolveCanvasOptions((p.options ?? {}) as Pick<GridOptions, 'canvas' | 'margin'>).margin;
    return { left: m?.left ?? 28, right: m?.right ?? 28 };
  });

  type GridChild = {
    def: ReturnType<typeof getChart>;
    geo: Geometry;
    recordOptions: object;
    tierCaption?: string;
    tierDetail?: string;
  };
  let sharedX: number | undefined;
  let sharedW: number | undefined;
  const landsOnEndpointLegend = (children: GridChild[]): boolean =>
    children.some(
      (child) =>
        child.def?.type === 'line' &&
        (child.geo.derived as { endpointLabelEconomy?: { strategy?: unknown } })
          .endpointLabelEconomy?.strategy === 'legend',
    );
  const alignedPanels = (children: GridChild[]) => children.map((child, i) => ({
    geometry: child.geo, slot: slots[i]!,
    margin: (child.recordOptions as { margin?: { left?: number; right?: number; bottom?: number } }).margin ?? {},
    relayout: (margin: { left?: number; right?: number; bottom?: number }) => {
      Object.assign(child, layoutPanel(data.panels[i]!, i, slots[i]!, margin));
      return child.geo;
    },
  }));
  const alignSharedValues = (children: GridChild[]) => {
    const panels = alignedPanels(children);
    const resolved = (options as { [SCALE_GROUP_MEMBERS]?: Record<string, string[]> })[SCALE_GROUP_MEMBERS];
    if (resolved) {
      for (const ids of Object.values(resolved)) alignValuePanels(panels.filter((_, i) => ids.includes(data.panels[i]!.id)), theme);
      return children;
    }
    const groups = new Set(data.panels.map(panel => (panel.options as { scaleGroup?: { y?: string } })?.scaleGroup?.y));
    for (const group of groups) if (group !== undefined) {
      alignValuePanels(panels.filter((_, i) => (data.panels[i]!.options as { scaleGroup?: { y?: string } })?.scaleGroup?.y === group), theme);
    }
    return children;
  };
  const layoutChildren = (): GridChild[] => {
    if (share === 'category' && n > 1) {
      let pass1 = data.panels.map((p, i) => layoutPanel(p, i, slots[i]!, baseMargins[i]));
      if (!uniformLineEndpointLegend && !keepEndNames && landsOnEndpointLegend(pass1)) {
        uniformLineEndpointLegend = true;
        pass1 = data.panels.map((p, i) => layoutPanel(p, i, slots[i]!, baseMargins[i]));
      }
      sharedX = maxOf(pass1.map((c) => c.geo.plot.x));
      const sharedR = minOf(pass1.map((c) => c.geo.plot.x + c.geo.plot.w));
      sharedW = sharedR - sharedX;
      const aligned = data.panels.map((p, i) => {
        const c1 = pass1[i]!;
        // Pass-2 compensation must start from the margin the child ACTUALLY
        // applied, not the one we requested: charts that widen their margin for
        // label reserves (line's endpoint names, derived.rightInset) would
        // otherwise clamp our request and overshoot sharedR — misaligned tiers.
        const effRight =
          typeof (c1.geo.derived as { rightInset?: unknown }).rightInset === 'number'
            ? (c1.geo.derived as { rightInset: number }).rightInset
            : baseMargins[i]!.right;
        const effLeft =
          typeof (c1.geo.derived as { leftInset?: unknown }).leftInset === 'number'
            ? (c1.geo.derived as { leftInset: number }).leftInset
            : baseMargins[i]!.left;
        return layoutPanel(p, i, slots[i]!, {
          left: effLeft + (sharedX! - c1.geo.plot.x),
          right: effRight + (c1.geo.plot.x + c1.geo.plot.w - sharedR),
        });
      });
      alignCategoryPanels(alignedPanels(aligned), theme);
      return alignSharedValues(aligned);
    }
    let children = data.panels.map((p, i) => layoutPanel(p, i, slots[i]!));
    if (!uniformLineEndpointLegend && !keepEndNames && landsOnEndpointLegend(children)) {
      uniformLineEndpointLegend = true;
      children = data.panels.map((p, i) => layoutPanel(p, i, slots[i]!));
    }
    return alignSharedValues(children);
  };

  const measureTierContents = (laidOut: GridChild[]) => {
    const childContent = laidOut.map((child) => occupiedBounds(child.geo));
    const tierLabels = laidOut.map((child, index) => {
      if (!child.tierCaption && !child.tierDetail) return undefined;
      const font = { family: theme.type.family, ...theme.type.axis };
      const titleSize = child.tierCaption ? measure(child.tierCaption, font) : undefined;
      const detailSize = child.tierDetail ? measure(child.tierDetail, font) : undefined;
      const lineGap = titleSize && detailSize ? theme.space.labelPad : 0;
      const height = (titleSize?.height ?? 0) + lineGap + (detailSize?.height ?? 0);
      let y = childContent[index]!.y - theme.space.labelPad - height;
      const title = titleSize ? { x: 0, y, w: titleSize.width, h: titleSize.height } : undefined;
      y += (titleSize?.height ?? 0) + lineGap;
      const detail = detailSize ? { x: 0, y, w: detailSize.width, h: detailSize.height } : undefined;
      const occupied = createOccupiedIndex({ x: 0, y: 0, w: child.geo.size.width, h: child.geo.size.height });
      for (const claim of child.geo.debug.occupied) {
        occupied.claim(claim.rect, claim.kind, claim.owner, claim.part);
      }
      const requests: LabelRequest[] = [];
      const candidates = (rect: Rect) => [
        { slot: 'tierLeft', rect, penalty: 0 },
        { slot: 'tierPlotLeft', rect: { ...rect, x: child.geo.plot.x }, penalty: 1 },
      ];
      for (const [id, text, rect, priority] of [
        ['tier:caption', child.tierCaption, title, PRIORITY.total],
        ['tier:detail', child.tierDetail, detail, PRIORITY.valueLine],
      ] as const) {
        if (text && rect) requests.push({ id, kind: 'axisTitle', typeRole: 'axis', owner: {}, text,
          lines: [text], font, priority, candidates: candidates(rect) });
      }
      const solved = solveLabels(requests, occupied, {
        density: 'full',
        pins: {},
        measure,
        plot: child.geo.plot,
        canvas: { x: 0, y: 0, w: child.geo.size.width, h: child.geo.size.height },
        darkInk: theme.color.ink,
        lightInk: theme.color.inkInverse,
        labelPad: theme.space.labelPad,
      });
      for (const label of solved.placed) label.ink = { token: 'inkMuted' };
      return { font, solved };
    });
    // Tier furniture is solved against the child's full occupied index inside
    // a dedicated band. Including the chosen labels in packing keeps the token
    // gap exact between adjacent tier contents.
    const localContent = childContent.map((bounds, index) => {
      const tier = tierLabels[index];
      const placed = tier?.solved.placed.filter((label) => !label.hidden).map((label) => label.rect) ?? [];
      return placed.length > 0 ? boundsOf([bounds, ...placed]) : bounds;
    });
    return { tierLabels, localContent };
  };

  // Single-tier grids pack and fill exactly like compact multi-tier grids;
  // without this, bottom-anchored packing pools ALL slack between the
  // frame furniture and the panel's first ink. The solo panel's caption band
  // is painted by the caption mirror (charts/grid/layout.ts) INSIDE the
  // prepared margin.top at the STATIC slot top, so when the panel declares a
  // title/caption the pack area must keep that margin clear — content packs
  // below `area.y + margin.top`, never into the band.
  const packedTiers = share === 'category' && data.panels.every(panel => getChart(panel.type)?.sizing.fit !== 'content');
  const packReserve = soloPanelReserve(share, data.panels);

  const rowOf = (index: number) => share === 'category' ? n - 1 - bottomUpOrder.indexOf(index) : Math.floor(index / columns);
  const rowWeights = share === 'category' ? [...bottomUpOrder].reverse().map(index => tierWeights(data.panels)[index]!) : Array(rows).fill(1);
  const rowGaps = Array(rows - 1).fill(rowGap);
  try {
  let children = layoutChildren();
  kpiValueSize = smallestKpiValueSize(children.map(child => child.geo));
  if (kpiValueSize !== undefined) children = layoutChildren();
  const sizingChildren = () => children.map((child, i) => ({
    geometry: child.geo, row: rowOf(i), column: i % columns, rowSpan: 1, columnSpan: 1,
  }));
  const heights = gridRowHeights(area.h, sizingChildren(), rowWeights, rowGaps);
  if (heights) {
    let y = area.y;
    const starts = heights.map((height, row) => { const start = y; y += height + (rowGaps[row] ?? 0); return start; });
    slots.forEach((slot, index) => { slot.y = starts[rowOf(index)]!; slot.h = heights[rowOf(index)]!; });
    children = layoutChildren();
  }
  children = balanceVarianceTierPlots(slots, children, varianceWeights, layoutChildren);
  let tierContents = measureTierContents(children);
  let effectiveTierGap = theme.space.tierGap;
  const requirements = () => gridSizing(size, area, sizingChildren(),
    packedTiers ? [...bottomUpOrder].reverse().map(index => children[index]!.geo.sizing!.minHeight) : rowWeights,
    Array(columns).fill(1), rowGaps, Array(columns - 1).fill(gap), true);
  // A short probe already needs a larger canvas. Packing slack there cannot
  // make it renderable and can repeatedly cross label-wrapping thresholds.
  if (packedTiers && requirements().minHeight <= size.height) {
    const weights = tierWeights(data.panels);
    const wSum = weights.reduce((sum, weight) => sum + weight, 0);
    const gapFloor = Math.min(4, theme.space.tierGap);
    const gapCapacity = (theme.space.tierGap - gapFloor) * (n - 1);
    for (let pass = 0; pass < TIER_SLACK_PASSES; pass++) {
      const slack =
        area.h -
        packReserve -
        theme.space.tierGap * (n - 1) -
        tierContents.localContent.reduce((sum, bounds) => sum + bounds.h, 0);
      if (slack < 0 && slack >= -gapCapacity) {
        effectiveTierGap = theme.space.tierGap + slack / (n - 1);
        break;
      }
      if (slack <= theme.space.tierGap) break;
      const previousSlots = slots.map((slot) => ({ ...slot }));
      const previousChildren = children;
      const previousTierContents = tierContents;
      const previousSharedX = sharedX;
      const previousSharedW = sharedW;
      const growth = Math.max(slack, wSum * theme.space.tierGap);
      let accepted = false;
      for (let backoff = 0; backoff < TIER_SLACK_BACKOFFS; backoff++) {
        previousSlots.forEach((slot, index) => {
          slots[index] = { ...slot };
        });
        const fraction = 2 ** -backoff;
        for (let i = 0; i < n; i++) {
          slots[i] = { ...slots[i]!, h: slots[i]!.h + (growth * fraction * weights[i]!) / wSum };
        }
        children = balanceVarianceTierPlots(slots, layoutChildren(), varianceWeights, layoutChildren);
        tierContents = measureTierContents(children);
        const remaining =
          area.h -
          packReserve -
          theme.space.tierGap * (n - 1) -
          tierContents.localContent.reduce((sum, bounds) => sum + bounds.h, 0);
        if (remaining >= -gapCapacity) {
          effectiveTierGap =
            remaining < 0 ? theme.space.tierGap + remaining / (n - 1) : theme.space.tierGap;
          accepted = true;
          break;
        }
      }
      if (!accepted) {
        previousSlots.forEach((slot, index) => {
          slots[index] = slot;
        });
        children = previousChildren;
        tierContents = previousTierContents;
        sharedX = previousSharedX;
        sharedW = previousSharedW;
        break;
      }
    }
  }
  const sizing = requirements();
  const { tierLabels, localContent } = tierContents;
  const panelY = slots.map((slot) => slot.y);
  if (packedTiers) {
    let cursor = area.y + area.h;
    for (const i of bottomUpOrder) {
      const bounds = localContent[i]!;
      panelY[i] = cursor - (bounds.y + bounds.h);
      cursor = bounds.y + panelY[i]! - effectiveTierGap;
    }
  }

  // ---- compose ----
  const scene: SceneNode[] = [...frameResult.nodes];
  const labels: PlacedLabel[] = [];
  const axes: AxisGeometry[] = [];
  const annotations: Geometry['annotations'] = [];
  const occupiedAll = occupied.snapshot().slice();
  const decisions: Geometry['debug']['decisions'] = [];
  const marks: GridMarks = { panels: [] };

  children.forEach((child, i) => {
    const panel = data.panels[i]!;
    const slot = slots[i]!;
    const prefix = `${panel.id}/`;
    const dx = slot.x;
    const dy = panelY[i]!;
    const geo = child.geo;

    appendPanelScene(scene, geo, panel.id, prefix, dx, dy);
    const noteData = panelNoteData(panel.type, panel.data, (panel.options as { locale?: { language?: string } } | undefined)?.locale?.language);
    const noteTexts = panelNoteTexts(geo, noteData, panel.options as Record<string, unknown> | undefined, (panel as { annotations?: unknown }).annotations);
    for (const label of geo.labels) {
      const noteText = noteTexts.texts.get(label.id);
      labels.push({
        ...label,
        ...(noteText === undefined ? {} : { noteText }),
        ...(noteTexts.leftOut.has(label.id) ? { [LEFT_OUT_OF_NOTE]: true as const } : {}),
        id: prefix + label.id,
        ...(label.claimId ? { claimId: prefix + label.claimId } : {}),
        nodeId: label.nodeId ? prefix + label.nodeId : undefined,
        rect: { ...label.rect, x: label.rect.x + dx, y: label.rect.y + dy },
        backing: label.backing ? { ...label.backing, x: label.backing.x + dx, y: label.backing.y + dy } : undefined,
      });
    }
    for (const axis of geo.axes) {
      axes.push({
        ...axis,
        baselineNodeId: axis.baselineNodeId ? prefix + axis.baselineNodeId : undefined,
        ticks: axis.ticks.map((t) => ({
          ...t,
          pos: t.pos + (axis.axis === 'x' ? dx : dy),
          labelId: t.labelId ? prefix + t.labelId : undefined,
          gridNodeId: t.gridNodeId ? prefix + t.gridNodeId : undefined,
        })),
        scenarioBands: axis.scenarioBands?.map((b) => ({
          ...b,
          rect: { ...b.rect, x: b.rect.x + dx, y: b.rect.y + dy },
        })),
      });
    }
    for (const ann of geo.annotations) {
      annotations.push({
        ...ann,
        id: prefix + ann.id,
        // The event anchor is a child-scene rect: move it with the panel.
        ...(ann.event?.anchor ? { event: { ...ann.event, anchor: { ...ann.event.anchor, x: ann.event.anchor.x + dx, y: ann.event.anchor.y + dy } } } : {}),
        nodeIds: ann.nodeIds.map((id) => prefix + id),
        labelId: ann.labelId ? prefix + ann.labelId : undefined,
        // The label NODE is prefixed as a node (`<panel>/label:<id>`), not as a
        // labelId — see PlacedAnnotation.labelNodeId. Concatenating `label:`
        // onto the prefixed labelId names a node that does not exist.
        labelNodeId: ann.labelId
          ? prefix + (ann.labelNodeId ?? `label:${ann.labelId}`)
          : undefined,
      });
    }
    for (const occ of geo.debug.occupied) {
      occupiedAll.push({ ...occ, rect: { ...occ.rect, x: occ.rect.x + dx, y: occ.rect.y + dy } });
    }
    for (const d of geo.debug.decisions) {
      decisions.push({ ...d, labelId: prefix + d.labelId });
    }
    const warningOffset = warnings.length;
    for (const w of geo.warnings) {
      warnings.push({ ...w, message: `[${panel.id}] ${w.message}` });
    }
    const tier = tierLabels[i];
    let titleNodeId: string | undefined;
    let captionNodeId: string | undefined;
    for (const label of tier?.solved.placed ?? []) {
      const moved = {
        ...label,
        id: prefix + label.id,
        ...(label.claimId ? { claimId: prefix + label.claimId } : {}),
        rect: { ...label.rect, x: label.rect.x + dx, y: label.rect.y + dy },
      };
      if (label.hidden) {
        labels.push(moved);
        continue;
      }
      const part = label.id === 'tier:caption' ? 'tierCaption' : 'panelCaption';
      const nodeId = `${prefix}${label.id}`;
      moved.nodeId = nodeId;
      labels.push(moved);
      scene.push({
        t: 'text', typeRole: 'axis',
        id: nodeId,
        x: moved.rect.x,
        y: moved.rect.y,
        lines: moved.lines,
        align: 'start',
        font: tier!.font,
        ink: moved.ink,
        owner: moved.owner,
        part,
        origin: { owner: moved.owner, panels: [panel.id] },
      });
      occupiedAll.push({ rect: moved.rect, kind: 'label', owner: moved.owner, part });
      if (label.id === 'tier:caption') titleNodeId = nodeId;
      else captionNodeId = nodeId;
    }
    for (const decision of tier?.solved.decisions ?? []) {
      decisions.push({ ...decision, labelId: prefix + decision.labelId });
    }
    for (const warning of tier?.solved.warnings ?? []) {
      warnings.push({ ...warning, message: `[${panel.id}] ${warning.message}` });
    }
    const content = localContent[i]!;
    marks.panels.push({
      id: panel.id,
      type: panel.type,
      chart: { options: child.recordOptions, geometry: geo, offset: { x: dx, y: dy }, warningOffset, ...((panel.options as { theme?: ThemeRef } | undefined)?.theme ? { theme: (panel.options as { theme?: ThemeRef }).theme } : {}) },
      plot: { x: geo.plot.x + dx, y: geo.plot.y + dy, w: geo.plot.w, h: geo.plot.h },
      content: { x: content.x + dx, y: content.y + dy, w: content.w, h: content.h },
      title: child.tierCaption ?? (geo.a11y.title || child.def?.title || panel.id),
      ...(titleNodeId ? { titleNodeId } : {}),
      ...(captionNodeId ? { captionNodeId } : {}),
    });
  });

  const first = children[0]!.geo;
  const compactNotes = children.flatMap((child) => child.geo.a11y.compactNotes ?? []);
  return {
    type: 'grid',
    size,
    sizing,
    plot: area,
    scene,
    labels,
    axes,
    annotations,
    frame: frameResult.frame,
    legend: frameResult.legend,
    marks,
    derived: {
      sharedPlotX: sharedX,
      sharedPlotW: sharedW,
      ...(compactTiers ? { tierGap: effectiveTierGap } : {}),
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'gridChartsTitle', { v1: n })),
      counts: children.flatMap((child, i) =>
        [...(child.geo.a11y.counts ?? []), ...(child.geo.a11y.titleCounts ?? [])]
          .filter(count => marks.panels[i]!.title.includes(count.text))),
      desc: chartString(options, 'gridChartsDesc', { v1: share === 'category' && n > 1 ? chartString(options, 'alignedExhibit') : chartString(options, 'chartGrid'), v2: marks.panels
        .map((p) => p.title)
        .join('; '), v3: compactNotes.length > 0 ? chartString(options, 'notesClause', { v1: compactNotes.join('; ') }) : '' }),
      ...(compactNotes.length > 0 ? { compactNotes } : {}),
    },
    warnings,
    debug: { occupied: occupiedAll, decisions },
  };

  void first;
  } catch (error) {
    if (!(error instanceof GridChildRefusal)) throw error;
    const index = data.panels.findIndex(panel => panel.id === error.panelId);
    return error.result(size, gridSizing(size, area, [{ geometry: error.child,
      row: rowOf(index), column: index % columns, rowSpan: 1, columnSpan: 1,
    }], rowWeights, Array(columns).fill(1), rowGaps, Array(columns - 1).fill(gap), true), index);
  }

}

function appendPanelScene(
  scene: SceneNode[], geometry: Geometry, panelId: string, prefix: string, dx: number, dy: number,
): void {
  const legendItems = new Map((geometry.legend?.items ?? []).flatMap(item => [
    [item.swatchNodeId, item.id] as const,
    [item.labelId, item.id] as const,
  ]));
  for (const node of geometry.scene) {
    const legendItem = node.origin?.legendItem ?? legendItems.get(node.id);
    const moved = {
      ...node,
      id: prefix + node.id,
      tx: (node.tx ?? 0) + dx,
      ty: (node.ty ?? 0) + dy,
      origin: {
        owner: node.origin?.owner ?? node.owner,
        panels: [panelId, ...(node.origin?.panels ?? [])],
        ...(legendItem === undefined ? {} : { legendItem }),
      },
    };
    scene.push(moved as SceneNode);
  }
}

export function withoutCategoryLabels(labels: unknown): unknown {
  if (labels === false) return false;
  return { ...(isRecord(labels) ? labels : {}), category: false };
}

function occupiedBounds(geometry: Geometry): Rect {
  const rects = geometry.debug.occupied.filter((item) => item.kind !== 'reserved').map((item) => item.rect);
  if (rects.length === 0) return geometry.plot;
  const x1 = minOf(rects.map((rect) => rect.x));
  const y1 = minOf(rects.map((rect) => rect.y));
  const x2 = maxOf(rects.map((rect) => rect.x + rect.w));
  const y2 = maxOf(rects.map((rect) => rect.y + rect.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}


/** The grid's footnotes with the note line of panel values appended; unnumbered, since no mark points at it. */
function panelValueFootnotes(options: GridOptions): Pick<FrameInput, 'footnotes'> | Record<string, never> {
  const named = (options as { [PANEL_VALUE_NOTE]?: string[] })[PANEL_VALUE_NOTE] ?? [];
  if (named.length === 0 || options.footnotes === false) return {};
  return { footnotes: [...(frameTextOptions(options).footnotes ?? []), ...valueNoteLine(chartString(options, 'valuesNotOnColumns'), named, options)] };
}

