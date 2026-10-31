import { chartString } from '../../strings/choropleth';
import { chartTheme } from '../chartEnv';
import { structureCount } from '../../structureCounts';
import { levenshtein } from '../../spelling';
import { authoredNotes, frameTextOptions, legendRequired, solveFrame, unitPrinted } from '../../frame';
import { formatAutomaticNumber } from '../../format';
import { formatterFromExample } from '../../formatSpec';
import { boxGap, rectHitsConvexPolygon, rectsOverlap, round2, type Rect } from '../../geometry';
// The geo modules by name, not the '../../geo' barrel: the barrel re-exports
// './packs', whose import registers every pack, and a choropleth must not
// register the pack it draws.
import { decodeGeoPack, fitGeoPack } from '../../geo/decode';
import { fitGeoLonLat } from '../../geo/project';
import { geoRegionIdIndex, resolveGeoRegionId, type GeoRegionIdIndex } from '../../geo/resolveRegionId';
import type { FittedGeoBoundary, FittedGeoRegion, GeoPack, GeoPoint } from '../../geo/types';
import { getGeoPack } from '../../geo/packs/registry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedClaim, type OccupiedIndex } from '../../label/occupied';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize, resolveSubtitle } from '../../normalize/shared';
import { defaultMeasurer, type FontSpec } from '../../text';
import { emphasisWeight, strokeToken, dashToken, canvasMargin, effectiveFill, paintColor, resolveSemanticPaletteTheme } from '../../theme';
import type { OwnerRef } from '../../types/cell';
import type {
  Geometry,
  LintWarning,
  OccupiedRect,
  Paint,
  SceneNode,
} from '../../types/scene';
import type { Theme } from '../../types/theme';
import type {
  ChoroplethData,
  ChoroplethDerived,
  ChoroplethLabelPolicy,
  ChoroplethMarks,
  ChoroplethOptions,
} from './types';
import { buildGeoScale, geoLabelFont, ingestGeoRegions, geoStatePattern, geoStateLabel, geoStateLegend, geoStateSummary, geoStateCounts, geoPolarityCaption, geoScaleHints } from '../geoScale';
import { autoDecimals } from '../../formatPrecision';
import { compareText } from '../../text';
import { geoOverlayDiameter, geoOverlayInFrame, geoOverlayLegend, renderGeoOverlays, reserveGeoOverlayGlyphs } from './overlays';
import { layoutMapKeys, mapKeysSize, MAP_GAP, smallRegionIds, shortestRegionName, valueTable, VALUE_TABLE_MAX_ROWS } from './smallMembers';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { chartSizing, resolveSizing } from '../../sizing';
import { rowDrivenHeight } from '../../rowCanvas';
import { textScaleOf } from '../../typeFloors';
import type { GeoOverlay } from './overlayTypes';
import { geoOptionRefusals } from './geoRefusals';
import { outsideLabelGuard } from './outsideLabels';
import { pushAll } from '../../arrays';

interface HatchSegment {
  a: GeoPoint;
  b: GeoPoint;
}

interface RegionLabelPolicy {
  mode: ChoroplethLabelPolicy;
  eligibleIds: Set<string>;
  leaderIds: Set<string>;
  inlineMarkerIds: Set<string>;
  topN: number;
}

interface RegionLabelVariant {
  request: LabelRequest;
  font: FontSpec;
  leader: boolean;
  /** A callout off the map: its seats are built against what is placed when its turn comes. */
  callout?: (occupied: OccupiedIndex, plot: Rect) => LabelRequest['candidates'];
}

interface RegionLabelPlan {
  region: FittedGeoRegion;
  priority: number;
  variants: RegionLabelVariant[];
}

/** Set when the value table is drawn: its top group, bold on the map too. */
type TableLabels = { emphasis: ReadonlySet<string> } | undefined;

interface LeaderLane {
  index: number;
  rect: Rect;
}

interface PreparedMapFit {
  fitted: ReturnType<typeof fitGeoPack>;
  outsideFits: ReturnType<typeof outsideLabelGuard>;
  contentRight?: number;
}

type RegionLabelSolveResult = ReturnType<typeof solveLabels> & {
  fontByLabel: Map<string, FontSpec>;
};

const MAP_PAD = 8;
// The mandatory inset-scale footnote consumes one dashboard frame line.
const US_MAP_PAD_Y = 6;
const LEADER_GUTTER = 92;
// The largest share of the plot width a leader gutter takes. certainlyUnderKey relies on this bound.
const LEADER_GUTTER_SHARE = 0.22;
const CLEARANCE_TEXT_SPAN = 6;
const LEADER_LANE_GAP = 5;
const CLAIM_STEP = 4;
const HATCH_STEP = 7;
const WORLD_AUTO_LABEL_COUNT = 12;
/** A callout's leader runs at most this far when a free side is that near. */
const CALLOUT_MAX_LEADER = 60;
const CALLOUT_DIRECTIONS = 16;
const CALLOUT_STEP = 4;
/** A label on its region covers at most this share of the region's area. */
const LABEL_MAX_COVER = 0.3;
/** Up to this many regions labelled on the map, each label prints its value by default. */
const REGION_VALUES_DEFAULT_MAX = 10;
/** A leader longer than this share of the map width sends its region to the table. */
const LISTED_LEADER_FRACTION = 0.2;
const LISTED_PASSES = 4;
/** The value table may take this share of the map row beside the map; else it goes under the map. */
const TABLE_MAX_SHARE = 0.45;
const TABLE_GAP = 16;
/** An unsized map is never taller than this share of the canvas width, nor than MAP_MAX_HEIGHT_PX (a slide's height). */
const MAP_MAX_HEIGHT = 0.7;
const MAP_MAX_HEIGHT_PX = 560;
/** A map stacked over its value table may be as tall as the canvas is wide. */
const STACKED_MAP_MAX_HEIGHT = 1;
/** Beside its table the map is at most this tall. */
const SIDE_MAP_MAX_PX = 640;
/** The block beside the map is at least as wide as a readable key. */
const SIDE_KEY_MIN_W = 160;
/** On a pinned canvas the map may shrink to this share of the row to make room for another table column. */
const SIDE_MIN_SHARE = 0.4;
/** The table goes beside the map only when the map keeps at least this width there. */
const SIDE_MIN_MAP_W = 360;
/** Beside the map a table column holds at most this many rows before a second column opens. */
const SIDE_ROWS = 8;
/** Between the key and the table in the block beside the map. */
const KEY_TABLE_GAP = 24;
/** The least map height a table under the map leaves on a pinned frame. */
const MIN_MAP_AREA_H = 120;
// Canonical clearance 14.5 is the first tier that includes India plus the
// six continent-scale anchors without admitting the broader mid-size tier.
const WORLD_LARGE_REGION_CLEARANCE = 14.5;

export function layoutChoropleth(
  data: ChoroplethData,
  options: ChoroplethOptions = {},
  /** Regions an earlier pass could not label on the map, or only on a long leader; they join the lookup table. */
  listed?: ReadonlySet<string>,
  pass = 0,
  /** The listed passes this frame has laid out, by pass and listed set. */
  passes = new Map<string, Geometry<ChoroplethMarks, ChoroplethDerived>>(),
  omittedOverlays: ReadonlySet<string> = new Set(),
): Geometry<ChoroplethMarks, ChoroplethDerived> {
  // What the schema refuses, refused here for the React entry.
  const warnings: LintWarning[] = geoOptionRefusals(options, 'choropleth');

  const pack = getGeoPack(data.pack);
  const idIndex = geoRegionIdIndex(pack.regions);
  const canonicalIds = idIndex.canonical;
  const { valuesById, statesById } = ingestGeoRegions(data.regions, idIndex, { where: `pack '${pack.id}'`, regionWord: 'pack region' }, warnings, (id, index) => {
    const suggestion = nearestRegionId(id, [...canonicalIds.keys()], canonicalIds);
    throw new NormalizeError(
      'choropleth-unknown-region',
      `regions[${index}].id`,
      `region '${id}' is not present in pack '${pack.id}'`,
      suggestion ? `did you mean '${suggestion}'?` : undefined,
    );
  });
  const explicitLabelIds = resolveLabelRegionIds(
    options.labelRegions ?? [],
    idIndex,
    pack,
  );
  const labelPolicy = resolveRegionLabelPolicy(
    pack,
    valuesById,
    explicitLabelIds,
    options.labels,
    options.topN?.n,
  );
  // A polygonless region (world micro-states) can only be seen as a marker.
  // Two independent questions, deliberately kept apart:
  //   1. a region the document gives a VALUE is always drawn. An accepted value
  //      that paints nothing is the ghost defect — the reader sees no mark while
  //      `noDataCount` counts the region as having data. Not negotiable, and in
  //      particular not switchable by a label-economy option.
  //   2. a region the document LISTS but leaves empty is drawn only on request:
  //      that is the whole remaining job of `microStateMarkers`.
  // A region the document never mentions is never dotted — inventing a mark for
  // a place with nothing to say would put ink on the map that no datum backs.
  const showListedEmptyMarkers = options.microStateMarkers ?? pack.id !== 'world';
  // Only a pack with outline-less micro-states draws their dots, so the
  // option changes nothing anywhere else and is refused there.
  if (options.microStateMarkers !== undefined && !pack.regions.some((region) => region.polygons.length === 0)) {
    warnings.push({
      code: 'choropleth-micro-state-markers-unused',
      severity: 'error',
      message: `microStateMarkers draws dots for micro-states without an outline, and pack '${pack.id}' has none, so it would change nothing`,
      suggest: "drop microStateMarkers; it applies to the world pack",
      field: ['options', 'microStateMarkers'],
      fix: [{ op: 'remove', path: '/options/microStateMarkers' }],
    });
  }
  const visibleMarkerIds = new Set(
    pack.regions
      .filter(
        (region) =>
          region.polygons.length === 0 &&
          (
            labelPolicy.eligibleIds.has(region.id) ||
            (valuesById.has(region.id) &&
              ((valuesById.get(region.id) ?? null) !== null || showListedEmptyMarkers))
          ),
      )
      .map((region) => region.id),
  );

  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const pinnedHeight = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height
    ?? (typeof options.size === 'string' || (typeof options.size === 'object' && options.size.height !== undefined));
  const compactCard = size.width <= 400
    && ((options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height ?? (typeof options.size === 'object' && options.size.height !== undefined));
  const compactPadding = compactCard && !data.overlays?.length ? 2 : undefined;
  const tableGap = compactPadding !== undefined ? 2 : compactCard ? 8 : TABLE_GAP;
  let minMapHeight = compactPadding !== undefined ? 68 : compactCard ? 80 : MIN_MAP_AREA_H;
  const margin = canvasMargin(theme, size.width);
  if (size.width < 480) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) margin[side] = Math.min(compactCard ? 8 : 12, margin[side]);
    if (compactCard) margin.top = margin.bottom = Math.min(5, margin.top, margin.bottom);
  }
  const measure = options.measure ?? defaultMeasurer;
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language)
    : (value: number) => formatAutomaticNumber(value, { locale: options.locale?.language, decimals: autoDecimals(value) });
  const numericValues = [...valuesById.values()].filter((value): value is number => value !== null);
  if (numericValues.length === 0) {
    warnings.push({
      code: 'choropleth-no-values',
      severity: 'info',
      message: `pack '${pack.id}' has no numeric observations; all ${pack.regions.length} regions render as no data`,
    });
  }
  /**
   * Does any region actually render as no data? The region loop below paints a
   * `noDataHatch` path for listed regions whose value is null, so
   * the same predicate over the same population decides whether the legend
   * carries a `No data` key. A swatch for ink that appears nowhere on the map
   * is a lying legend.
   */
  const hasNoDataRegion = pack.regions.some(
    (region) => valuesById.has(region.id) && valuesById.get(region.id) === null && !statesById.has(region.id),
  );
  const scale = buildGeoScale(numericValues, options, fmt, hasNoDataRegion, theme, { token: 'background' });
  // Keep this key formatting local to choropleth; tilemap keeps its scale
  // formatter. A round break prints round on the boundary ticks ('20', not '20.0').
  scale.edgeFmt = options.format !== undefined ? scale.edgeFmt : (value: number) => {
    const magnitude = Math.abs(value) >= 1e9 ? 1e9 : Math.abs(value) >= 1e6 ? 1e6 : Math.abs(value) >= 1e3 ? 1e3 : 1;
    const scaled = value / magnitude;
    let decimals = 0;
    while (decimals < 6 && !(Math.abs(Math.round(scaled * 10 ** decimals) - scaled * 10 ** decimals) < 1e-6)) decimals++;
    return formatAutomaticNumber(value, { locale: options.locale?.language, magnitude: 'auto', decimals });
  };
  // The key and the summary name only states a reader can see: as a polygon, a marker or a label.
  const visibleStates = pack.regions.filter(region => region.polygons.length > 0 || visibleMarkerIds.has(region.id)).flatMap(region => statesById.has(region.id) ? [statesById.get(region.id)!] : []);
  pushAll(scale.legend, geoStateLegend(visibleStates, options));
  if (pack.regions.some((region) => !valuesById.has(region.id))) scale.legend.push({
    id: 'not-in-data', label: chartString(options, 'notInData'), paint: { token: 'inkMuted' }, pattern: 'outline', hollow: true,
  });
  warnings.push(...geoScaleHints(numericValues, options, fmt));
  const overlays = (data.overlays ?? []).filter(overlay => !omittedOverlays.has(overlay.id));
  const overlayLegend = geoOverlayLegend(overlays, options.overlayTones, options.overlayMeasure, data.overlays ?? [], options);
  pushAll(warnings, overlayLegend.warnings);
  const legendOptions = legendRequired(options.legend, warnings, 'choropleth', theme);
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const userSource = options.source ? chartString(options, 'userSourceClause', { v1: options.source }) : '';
  // The label selection and the pack's endorsement disclaimer are
  // method notes (the disclaimer also stands in the attribution on the source
  // line); the inset scale note changes how areas compare and stays.
  const methodNote = options.methodNote === true;
  const policyFootnote =
    methodNote && labelPolicy.mode === 'auto' &&
      labelPolicy.eligibleIds.size < pack.regions.length
      ? chartString(options, 'mapLabelPolicy', { v1: labelPolicy.topN })
      : undefined;
  const frameResult = solveFrame(
    {
      size,
      margin: { ...margin, ...options.margin },
      ...frameTextOptions(options),
      // Footer rule: the author's source line, and the pack's licence credit
      // apart, which the frame keeps visible where the licence requires it.
      source: options.source,
      ...(pack.meta.credit ? { credit: pack.meta.credit } : { source: `${pack.meta.attribution}${userSource}` }),
      footnotes: [
        // The pack credit may already hold the disclaimer; the method note
        // does not print it a second time.
        ...(methodNote && pack.meta.chartNote && !(pack.meta.credit?.text ?? pack.meta.attribution).includes(pack.meta.chartNote) ? [pack.meta.chartNote] : []),
        ...(pack.meta.insetScaleNote ? [pack.meta.insetScaleNote] : []),
        ...(policyFootnote ? [policyFootnote] : []),
        ...authoredNotes(options),
      ],
      // The colour key is drawn by layoutMapKeys beside the small members; the frame keeps the overlay key.
      legend: { options: legendOptions, items: overlayLegend.items },
      theme,
      measure,
    },
    occupied,
  );

  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot: frameResult.plot,
    labelPad: 0,
  });
  // The value table: every region with its swatch,
  // code and value beside the map, or under it when the width is short. With
  // it the map prints codes only and needs no list of small or dropped
  // regions: the table names them all.
  const tableMode = options.valueTable ?? 'auto';
  const tableIds = pack.regions
    .filter((region) => valuesById.has(region.id) && (region.polygons.length > 0 || visibleMarkerIds.has(region.id)))
    .map((region) => region.id);
  const ranks = valueRanks(valuesById);
  // The top quarter by value, at most five, in the emphasis weight.
  const topIds = new Set([...ranks].filter(([, rank]) => tableIds.length >= 4 && rank < Math.min(5, Math.ceil(tableIds.length / 4))).map(([id]) => id));
  const table = tableMode !== false && tableIds.length > 0 &&
    (tableMode !== 'auto' || (tableIds.length <= VALUE_TABLE_MAX_ROWS && numericValues.length > 0))
    ? valueTable({ options,
        ids: tableIds, pack, values: valuesById, states: statesById, scale, fmt, theme, measure,
        unit: compactCard && unitPrinted({ subtitle: resolveSubtitle(options.subtitle), unit: options.unit, unitShown: options.unitShown }) ? undefined : options.unit,
        compact: compactCard,
        bold: topIds,
      })
    : undefined;
  const baseSmallIds = table ? new Set<string>() : smallRegionIds(pack, labelPolicy.eligibleIds, explicitLabelIds, options);
  const smallIds = new Set([...baseSmallIds, ...(table ? [] : listed ?? [])]);
  // The subtitle (or the unit line) already names the measure and its
  // unit, so the key carries a title only when the author gives one.
  const keyTitle = options.keyTitle;
  // The key sits in the row above the map when nothing decided its place:
  // no legend option, or 'auto', and no theme position. Any other
  // option, 'none' included, has already resolved to a position through
  // legendRequired (whose warning says the key stays), and that position wins.
  const named = (options.legend !== undefined && options.legend !== 'auto') || theme.legend?.required !== undefined;
  const plot0 = frameResult.plot;
  const yPad = pack.id === 'us-states' ? US_MAP_PAD_Y : MAP_PAD;
  const packAspect = (pack.bounds[3] - pack.bounds[1]) / (pack.bounds[2] - pack.bounds[0]);
  // The side form: the map takes the row beside the
  // table's own width, never taller than a slide; the key and the table stand
  // in one block beside it, spread to the room the map leaves and centred on
  // the map's height. Without the room for it the table goes under the map,
  // and the key spans the row over the map.
  const sideCapH = Math.min(MAP_MAX_HEIGHT * size.width, SIDE_MAP_MAX_PX);
  const sideNaturalW = table ? Math.max(SIDE_KEY_MIN_W, table.size(Math.ceil(table.rowCount / Math.ceil(table.rowCount / SIDE_ROWS))).w) : 0;
  let sideMapW = Math.min(plot0.w - tableGap - sideNaturalW, sideCapH / packAspect + 2 * MAP_PAD);
  let sideBlockW = plot0.w - sideMapW - tableGap;
  let sideMaxColumns = table ? table.columnsIn(sideBlockW) : 0;
  let sideColumns = table ? Math.min(sideMaxColumns, Math.ceil(table.rowCount / SIDE_ROWS)) : 0;
  let sideWanted = table !== undefined && !named && tableMode !== 'below' && sideColumns >= 1 &&
    (tableMode === 'side' || sideMapW >= SIDE_MIN_MAP_W);
  const keyInput = { options,
    target: options.target,
    textScale: textScaleOf(options),
    compact: compactCard,
    position: named ? legendOptions.position : 'auto',
    title: keyTitle,
    scale,
    classes: options.classes,
    // A classed key labels its class joins on boundary ticks.
    classRanges: false,
    midpointLabel: options.scale?.kind === 'diverging' ? options.scale.midpointLabel : undefined,
    // Which end is better; the band ranges say which class an edge joins.
    caption: geoPolarityCaption(scale, options) ? `${geoPolarityCaption(scale, options)}.` : undefined,
    // A small region the data never names has nothing to list: the map does not label it either.
    smallIds: new Set([...smallIds].filter((id) => valuesById.has(id))), pack, values: valuesById, states: statesById, theme, measure, fmt, occupied, solveCtx,
    // One list title at every width, for small regions and dropped labels alike.
    smallTitle: chartString(options, 'hiddenMapLabels'),
  } as const;
  let sideKeyH = 0;
  // A key whose labels do not fit the block keeps the row over the map.
  if (sideWanted) try {
    sideKeyH = mapKeysSize({ ...keyInput, plot: { x: plot0.x + sideMapW + tableGap, y: plot0.y, w: sideBlockW, h: plot0.h }, keyWidth: sideBlockW }).h;
  } catch (error) {
    if (!(error instanceof NormalizeError) || error.code !== 'geo-key-overflow') throw error;
    sideWanted = false;
  }
  const sideBlockFor = (columns: number) => sideKeyH + KEY_TABLE_GAP + table!.size(Math.ceil(table!.rowCount / columns), sideBlockW, true).h;
  // A pinned canvas too short for the block opens more columns, else the table goes under the map.
  // The map may give up width for that column down to SIDE_MIN_SHARE of the row.
  if (sideWanted && pinnedHeight) while (sideBlockFor(sideColumns) > plot0.h) {
    if (sideColumns < sideMaxColumns) { sideColumns++; continue; }
    const wider = table!.size(Math.ceil(table!.rowCount / (sideColumns + 1))).w;
    if (sideColumns + 1 > table!.rowCount || plot0.w - tableGap - wider < SIDE_MIN_SHARE * plot0.w) break;
    sideBlockW = wider;
    sideMapW = plot0.w - tableGap - wider;
    sideMaxColumns = table!.columnsIn(sideBlockW);
    sideColumns++;
  }
  const sideForm = sideWanted && (tableMode === 'side' || !pinnedHeight || sideBlockFor(sideColumns) <= plot0.h);
  const sidePerColumn = sideForm ? Math.ceil(table!.rowCount / sideColumns) : 0;
  const sideMapH = Math.min(sideCapH, (sideMapW - 2 * MAP_PAD) * packAspect) + 2 * yPad;
  const sideBlockH = sideForm ? sideBlockFor(sideColumns) : 0;
  const sideBlockY = plot0.y + Math.max(0, (Math.min(plot0.h, sideMapH) - sideBlockH) / 2);
  const small = layoutMapKeys({ ...keyInput,
    plot: sideForm ? { x: plot0.x + sideMapW + tableGap, y: sideBlockY, w: sideBlockW, h: sideBlockH } : plot0,
    // Over a stacked table the key spans the row; beside the map it spans the block.
    ...(sideForm ? { keyWidth: sideBlockW } : table && !named ? { keyWidth: plot0.w } : {}),
  });
  // An automatic side table that cannot fit the row moves under the map
  // only when a pinned canvas leaves enough height for the map.
  const area = sideForm ? plot0 : small.mapPlot;
  const besideWanted = table !== undefined && !sideForm && tableMode !== 'below' &&
    // A named legend, or a pinned canvas too short for the side block, keeps the older side table.
    (tableMode === 'side' || ((named || sideWanted) && size.width >= 480 && table.size(table.rowCount).w + tableGap <= TABLE_MAX_SHARE * area.w));
  // The height a map takes when its host leaves the height open: the
  // text around it plus the map at the pack's aspect for the width it gets,
  // never taller than MAP_MAX_HEIGHT of the canvas width or MAP_MAX_HEIGHT_PX, and the table.
  // A map stacked over its table may reach STACKED_MAP_MAX_HEIGHT of the width.
  const naturalMapH = (width: number, share = MAP_MAX_HEIGHT) => Math.min((width - 2 * MAP_PAD) * packAspect, share * size.width, MAP_MAX_HEIGHT_PX) + 2 * yPad;
  const stackedShare = table && !named ? STACKED_MAP_MAX_HEIGHT : MAP_MAX_HEIGHT;
  let naturalAreaH = !table ? naturalMapH(area.w)
    : sideForm ? Math.max(sideMapH, sideBlockH)
    : besideWanted ? Math.max(naturalMapH(area.w - table.size(table.rowCount).w - tableGap), table.size(table.rowCount).h)
    : naturalMapH(area.w, stackedShare) + tableGap + table.size(table.rowsAcross(area.w), area.w).h;
  // A frame taller than the map needs keeps the map at its natural height at
  // the top; the rest stays empty above the footer. So a pinned frame and the
  // natural frame draw the same map with the same labels.
  let mapArea = { ...area, h: Math.min(area.h, naturalAreaH) };
  let tablePlace: { x: number; y: number; perColumn: number; width?: number; full?: boolean } | undefined;
  if (sideForm) {
    mapArea = { ...plot0, w: sideMapW, h: Math.min(plot0.h, sideMapH) };
    tablePlace = { x: small.blocks.x, y: small.blocks.y + small.blocks.h + KEY_TABLE_GAP, perColumn: sidePerColumn, width: sideBlockW, full: true };
  }
  if (table && besideWanted) {
    const perColumn = Math.max(1, Math.min(table.rowCount, table.rowsIn(area.h)));
    const block = table.size(perColumn);
    if (tableMode === 'side' || (perColumn === table.rowCount && block.w + tableGap <= TABLE_MAX_SHARE * area.w)) {
      // The map takes the width its height needs, and the table stands right beside it.
      const mapW = Math.min(area.w - block.w - tableGap, (mapArea.h - 2 * yPad) / packAspect + 2 * MAP_PAD);
      const offset = Math.max(0, (area.w - mapW - tableGap - block.w) / 2);
      mapArea = { ...mapArea, x: area.x + offset, w: Math.max(10, mapW), h: Math.min(mapArea.h, naturalMapH(area.w - block.w - tableGap)) };
      tablePlace = { x: mapArea.x + mapArea.w + tableGap, y: area.y, perColumn };
    }
  }
  if (table && !tablePlace && tableMode !== 'side') {
    let perColumn = table.rowsAcross(area.w);
    // A pinned canvas too short for the grouped columns spreads the rows over every column that fits.
    if (pinnedHeight && area.h - table.size(perColumn, area.w).h - tableGap < minMapHeight) perColumn = table.rowsAcross(area.w, false);
    const block = table.size(perColumn, area.w);
    if (tableMode === 'below' || !pinnedHeight || area.h - block.h - tableGap >= minMapHeight) {
      naturalAreaH = naturalMapH(area.w, stackedShare) + tableGap + block.h;
      mapArea = { ...area, h: Math.max(10, Math.min(area.h - block.h - tableGap, naturalMapH(area.w, stackedShare))) };
      tablePlace = { x: area.x + Math.max(0, (area.w - block.w) / 2), y: area.y + mapArea.h + tableGap, perColumn, width: area.w };
    }
  }
  // An automatic table that found no place is no table: the small-member list
  // and the listed passes take over. When they do not fit, or a region would
  // lose its value, the table goes under the map: values before map size.
  if (table && !tablePlace && tableMode === 'auto') {
    const fallback = layoutChoropleth(data, { ...options, valueTable: false }, listed, pass, new Map(), omittedOverlays);
    const valueLost = (geometry: typeof fallback) => geometry.labels.some(label => label.kind === 'category' && label.hidden && label.hidden !== 'redundant'
      && valuesById.get(label.owner.categoryId!) != null
      && !geometry.labels.some(cell => cell.id === `small-member-value:${label.owner.categoryId}` && !cell.hidden));
    if (!fallback.refused && (fallback.sizing?.minHeight ?? 0) <= size.height && (fallback.sizing?.minWidth ?? 0) <= size.width && !valueLost(fallback)) return fallback;
    return layoutChoropleth(data, { ...options, valueTable: 'below' }, listed, pass, new Map(), omittedOverlays);
  }
  if (table && !tablePlace) mapArea = { ...area, h: Math.min(area.h, naturalMapH(area.w)) };
  const tableDrawn = table && tablePlace ? table.draw(tablePlace.x, tablePlace.y, tablePlace.perColumn, occupied, solveCtx, tablePlace.width, tablePlace.full) : undefined;
  // Callouts stay in the band the map stands in, not in the empty rest of a tall frame.
  const mapCtx: SolveCtx = { ...solveCtx, plot: { ...solveCtx.plot, h: mapArea.y + mapArea.h - solveCtx.plot.y } };
  const naturalHeight = Math.ceil(size.height - area.h + naturalAreaH - 1e-6);
  const mapLabels = { ...labelPolicy, eligibleIds: new Set([...labelPolicy.eligibleIds].filter((id) => !smallIds.has(id))),
    leaderIds: new Set([...labelPolicy.leaderIds].filter((id) => !smallIds.has(id))) };
  if (smallIds.size && mapLabels.eligibleIds.size === 0) {
    minMapHeight = Math.min(minMapHeight, 2 * (compactPadding ?? MAP_PAD) + 2 * theme.type.label.size);
  }
  // A short map uses the complete code/value table instead of crowded duplicate leaders.
  if (tableDrawn && mapArea.h < MIN_MAP_AREA_H + theme.type.label.size * 6) {
    mapLabels.eligibleIds.clear();
    mapLabels.leaderIds.clear();
    // The complete table names the regions; the map needs only its thumbnail reserve.
    minMapHeight = Math.min(minMapHeight, 2 * (compactPadding ?? MAP_PAD) + 2 * theme.type.label.size);
  }
  // A map that names only a few regions prints their values too, so the
  // reader need not match a tint against the key. The count is taken before
  // any label drops for room, so the label form is one at every width; with
  // the value table the values stand there and the map prints codes.
  const autoLabelled = [...labelPolicy.eligibleIds].filter((id) => !baseSmallIds.has(id)).length;
  const regionValues = options.regionValues ??
    (!tableDrawn && autoLabelled > 0 && autoLabelled <= REGION_VALUES_DEFAULT_MAX);
  // The table's top group is bold on the map too, so the two read as one key.
  const withTable: TableLabels = tableDrawn ? { emphasis: topIds } : undefined;
  const valueTexts = new Map<string, string>(regionValues
    ? [...valuesById].flatMap(([id, value]) => (value === null ? [] : [[id, fmt(value)] as [string, string]]))
    : []);
  // The leader lane column sits right of the map. Beside a key strip that
  // leaves the right edge free, the lanes may run the full plot height, so a
  // long lane stack does not spill into the footer.
  const plot = frameResult.plot;
  const laneSpan = !tableDrawn && small.position !== 'right' && small.blocks.x + small.blocks.w <= plot.x + plot.w - LEADER_GUTTER
    ? { y: plot.y, h: mapArea.y + mapArea.h - plot.y } : { y: mapArea.y, h: mapArea.h };
  // The key row may stand over the map's empty corner. The map rises into
  // the row as far as no region or dot of it lies under the key.
  const keyArea: Rect = { x: small.blocks.x - MAP_GAP, y: small.blocks.y - MAP_GAP, w: small.blocks.w + 2 * MAP_GAP, h: small.blocks.h + 2 * MAP_GAP };
  const underKey = (candidate: ReturnType<typeof prepareMapLayout>) => candidate.fitted.regions.some((region) =>
    region.polygons.some((polygon) => polygon.some((ring) => ring.some(([x, y]) => pointInRect(x, y, keyArea)))) ||
    (region.marker !== undefined && pointInRect(region.marker.x, region.marker.y, keyArea)));
  const reserved = mapArea.y - plot.y;
  let prepared: ReturnType<typeof prepareMapLayout> | undefined;
  if (small.position === 'top' && reserved > 0) {
    for (const share of [0, 0.25, 0.5, 0.75]) {
      const top = plot.y + share * reserved;
      const rect = { ...mapArea, y: top, h: mapArea.y + mapArea.h - top };
      const padding = mapLabels.eligibleIds.size ? undefined : compactPadding;
      if (certainlyUnderKey(pack, rect, padding, keyArea, measure, theme)) continue;
      const candidate = prepareMapLayout(pack, rect, laneSpan, occupied, valuesById, mapLabels, visibleMarkerIds, theme, measure, mapCtx, valueTexts, padding, withTable);
      if (!underKey(candidate)) {
        prepared = candidate;
        break;
      }
    }
  }
  const { labelLayout, mapFrame, fitted, leaderLanes, outsideFits } = prepared ??
    prepareMapLayout(pack, mapArea, laneSpan, occupied, valuesById, mapLabels, visibleMarkerIds, theme, measure, mapCtx, valueTexts, mapLabels.eligibleIds.size ? undefined : compactPadding, withTable);
  // A map its host did not size takes its natural height.
  const grow = rowDrivenHeight({ options, width: size.width, height: size.height, chromeH: 0, rowsH: naturalHeight });
  if (grow !== undefined) return layoutChoropleth(data, { ...options, size: { width: size.width, height: grow } }, listed, pass, passes, omittedOverlays);

  // Crowded glyphs keep their geographic anchors; the later glyph moves to the note. So does a glyph whose
  // anchor the map crop leaves outside the map frame.
  const glyphDiscs: { x: number; y: number; radius: number }[] = [];
  const nextOmitted = new Set(omittedOverlays);
  // The automatic height probe is too short to decide which geographic glyphs fit.
  const heightReady = (options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false || size.height >= naturalHeight - 2;
  (heightReady ? overlays : []).forEach((overlay, index) => {
    const anchor = resolveChoroplethOverlayAnchor(overlay, index, fitted, idIndex, pack);
    const diameter = geoOverlayDiameter(overlay);
    const radius = diameter / 2 * (overlay.glyph.kind === 'marker' && overlay.glyph.shape === 'square' ? Math.SQRT2 : 1);
    if (!geoOverlayInFrame(anchor, mapFrame) || glyphDiscs.some(prior => Math.hypot(anchor.x - prior.x, anchor.y - prior.y) < radius + prior.radius)) nextOmitted.add(overlay.id);
    else glyphDiscs.push({ ...anchor, radius });
  });
  if (nextOmitted.size > omittedOverlays.size) return layoutChoropleth(data, options, listed, pass, new Map(), nextOmitted);

  const nodes: SceneNode[] = [...frameResult.nodes];
  // Region outline, the grammar's hair stroke. It is centred on the path, so a
  // region paints half of it OUTSIDE the geometry — see `markerPath`.
  const regionStroke = strokeToken(theme, 'hair');
  pushAll(warnings, small.warnings);
  const marks: ChoroplethMarks = { regions: [], boundaries: [] };
  const labelPlans: RegionLabelPlan[] = [];

  // Visible no-data regions too small to contain hatch ink (desc discloses).
  const chipOnlyNoData: string[] = [];
  let undrawnUnlisted = 0;
  for (const region of fitted.regions) {
    const value = valuesById.get(region.id) ?? null;
    const unlisted = !valuesById.has(region.id);
    const state = statesById.get(region.id);
    const noData = !unlisted && value === null && !state;
    const owner = { categoryId: region.id };
    const pathNodeId = `region:${region.id}`;
    const regionVisible = region.polygons.length > 0 || visibleMarkerIds.has(region.id);
    // A region the data never names and that has no outline to draw (a pack's
    // marker-only place) leaves nothing in the scene: no empty path, no mark.
    if (unlisted && !regionVisible) {
      undrawnUnlisted += 1;
      continue;
    }
    const d = regionVisible
      ? region.polygons.length > 0
        ? polygonsPath(region.polygons)
        : markerPath(
            region.marker?.x ?? region.anchor.x,
            region.marker?.y ?? region.anchor.y,
            region.marker?.radius ?? 2.5,
            regionStroke,
          )
      : '';
    const fill: Paint = state ? { token: 'inkMuted' } : noData ? { token: 'background' } : scale.paint(value);
    nodes.push({
      t: 'path',
      id: pathNodeId,
      d,
      fill,
      stroke: { token: 'inkMuted' },
      width: regionStroke,
      owner,
      part: 'region',
      ...(state ? { pattern: geoStatePattern(state) } : {}),
      display: state ? { state: geoStateLabel(state, options) } : unlisted ? { state: chartString(options, 'notInData') } : noData ? { state: chartString(options, 'valueMissing') } : { value: fmt(value!) },
    });
    if (regionVisible) claimRegionMark(region, occupied);

    let hatchNodeId: string | undefined;
    if (noData) {
      const segments = regionVisible ? hatchSegments(region, regionStroke) : [];
      if (regionVisible && segments.length === 0) {
        // A visible region too small to CONTAIN hatch ink gets no hatch node
        // at all — an empty-d path under a desc claiming hatch was the
        // original Malta lie, and ink that crosses into a valued neighbour
        // is worse. The label chip marks it; the desc discloses the count.
        chipOnlyNoData.push(region.id);
      } else {
        hatchNodeId = `region-hatch:${region.id}`;
        nodes.push({
          t: 'path',
          id: hatchNodeId,
          d: segmentsPath(segments),
          stroke: { token: 'neutral' },
          width: strokeToken(theme, 'hair'),
          owner,
          part: 'noDataHatch',
        });
        claimHatchSegments(segments, occupied, region.id);
      }
    }
    marks.regions.push({
      id: region.id,
      // The pack's name for the region, which the card and the accessible text print.
      name: region.anchor.name,
      pathNodeId,
      ...(hatchNodeId ? { hatchNodeId } : {}),
      value,
      state: state ?? (unlisted ? 'not-in-data' : noData ? 'no-data' : 'value'),
      fill,
    });

    if (mapLabels.eligibleIds.has(region.id)) {
      labelPlans.push(labelPlanForRegion(
        region,
        leaderLanes.get(region.id),
        theme,
        measure,
        fill,
        labelPolicy.inlineMarkerIds.has(region.id),
        valueTexts,
        ranks.get(region.id) ?? ranks.size,
        outsideFits,
        state ? geoStatePattern(state) : undefined,
        withTable?.emphasis.has(region.id) ?? false,
        withTable !== undefined,
      ));
    }
  }
  for (const boundary of fitted.boundaries) {
    const pathNodeId = `boundary:${boundary.id}`;
    const stroke: Paint = { token: 'leader' };
    nodes.push({
      t: 'path',
      id: pathNodeId,
      d: boundaryPath(boundary),
      stroke,
      width: strokeToken(theme, 'rule'),
      dash: dashToken(theme, 'reference'),
      owner: {},
      part: 'disputedBoundary',
    });
    claimBoundaryMark(boundary, occupied);
    marks.boundaries.push({
      id: boundary.id,
      pathNodeId,
      geometryClass: boundary.geometryClass,
      stroke,
      dash: dashToken(theme, 'reference'),
    });
  }
  claimLeaderAnchors(fitted.regions, labelLayout.leaderIds, occupied);

  reserveGeoOverlayGlyphs(overlays,
    (overlay, index) => resolveChoroplethOverlayAnchor(overlay, index, fitted, idIndex, pack), occupied);

  const solved = solveRegionLabels(labelPlans, occupied, mapCtx, outsideFits);
  // The complete value table is already the second home for an unplaced map label.
  if (tableDrawn) for (const label of solved.placed) {
    const id = label.owner.categoryId;
    if (label.hidden && ['code', 'value'].every(part => tableDrawn.placed.some(
      cell => cell.id === `value-table-${part}:${id}` && !cell.hidden))) label.hidden = 'redundant';
  }
  // A region whose name did not fit, or fits only at the end of a
  // leader across a fifth of the map, is listed with its value in the table
  // above the map instead. The table takes room from the map, so this runs
  // until no new region moves (at most four passes). Explicit regions also
  // use the table when no safe map seat exists. With a value table (drawn or not) the
  // listed set never joins smallIds, so a further pass would lay out the
  // same map again: none runs.
  const movable = (label: (typeof solved.placed)[number]) =>
    !table && pass < LISTED_PASSES && label.owner.categoryId !== undefined &&
    !smallIds.has(label.owner.categoryId);
  const lost = solved.placed.filter((label) => movable(label) && label.hidden).map((label) => label.owner.categoryId!);
  const far = solved.placed.filter((label) => movable(label) && !label.hidden && label.leader !== undefined &&
    pathLength(label.leader.d) > Math.max(LISTED_LEADER_FRACTION * mapFrame.w, CALLOUT_MAX_LEADER)).map((label) => label.owner.categoryId!);
  pushAll(nodes, small.nodes);
  pushAll(nodes, tableDrawn?.nodes ?? []);
  for (const node of labelsToNodes(theme, solved.placed, (label) => solved.fontByLabel.get(label.id)!)) {
    if (node.t === 'path' && node.part === 'leader') {
      nodes.push({ ...node, id: `${node.id}:casing`, stroke: { token: 'background' }, width: strokeToken(theme, 'rule') + 2 * strokeToken(theme, 'hair'), part: 'leaderCasing' });
      node.stroke = { token: 'ink' };
    }
    nodes.push(node);
  }
  pushAll(warnings, solved.warnings);
  pushAll(warnings, tableDrawn?.warnings ?? []);
  const overlayResult = renderGeoOverlays({ options,
    overlays: data.overlays ?? [],
    omitted: omittedOverlays,
    frame: mapFrame,
    toneNames: options.overlayTones,
    overlayMeasure: options.overlayMeasure,
    resolveAnchor: (overlay, index) =>
      resolveChoroplethOverlayAnchor(overlay, index, fitted, idIndex, pack),
    occupied,
    solveCtx,
    theme,
    measure,
    ignoredBaseParts: new Set(['region', 'noDataHatch']),
  });
  pushAll(nodes, overlayResult.nodes);
  pushAll(warnings, overlayResult.warnings);
  if (overlayResult.marks.length) marks.overlays = overlayResult.marks;

  // `derived` counts every pack member; the description counts what the map shows.
  const noDataCount = marks.regions.filter((mark) => mark.value === null).length + undrawnUnlisted;
  const missingCount = marks.regions.filter((mark) => mark.state === 'no-data').length;
  const drawnUnlistedCount = marks.regions.filter((mark) => mark.state === 'not-in-data').length;
  const unlistedCount = drawnUnlistedCount + undrawnUnlisted;
  const geometry: Geometry<ChoroplethMarks, ChoroplethDerived> = {
    type: 'choropleth',
    size,
    // Every choropleth draws the colour key, so its measured height is always
    // published; the width only grows for a small-members block.
    sizing: resolveSizing(chartSizing('choropleth'), size, {
      ...(smallIds.size ? { minWidth: size.width - frameResult.plot.w +
        (small.position === 'right' ? small.blocks.w + 200 : Math.max(200, small.blocks.w)) } : {}),
      minHeight: Math.max(size.height - frameResult.plot.h + small.minPlotH,
        size.height - area.h + (table && tablePlace ? sideForm ? Math.max(minMapHeight, sideBlockH)
          : tablePlace.y === area.y ? Math.max(minMapHeight, table.size(tablePlace.perColumn).h)
          : minMapHeight + tableGap + table.size(table.rowsAcross(area.w), area.w).h : minMapHeight)),
      naturalHeight,
    }),
    plot: sideForm ? mapArea : small.mapPlot,
    scene: nodes,
    labels: [...solved.placed, ...small.placed, ...(tableDrawn?.placed ?? []), ...overlayResult.labels],
    axes: [],
    annotations: [],
    legend: frameResult.legend
      ? { rect: unionRect(small.legend.rect, frameResult.legend.rect), items: [...small.legend.items, ...frameResult.legend.items] }
      : small.legend,
    frame: frameResult.frame,
    marks,
    derived: {
      domain: { min: scale.min, max: scale.max, midpoint: scale.midpoint, polarity: scale.polarity },
      legendRange: { min: scale.min, max: scale.max },
      ...(scale.edges ? { classEdges: scale.edges } : {}),
      noDataCount,
      unlistedCount,
      ...(overlayResult.descriptions.length
        ? { overlayDescriptions: overlayResult.descriptions }
        : {}),
      mapFrame,
      pack: {
        id: pack.id,
        hash: pack.meta.hash,
        packRev: pack.meta.packRev,
        worldview: pack.meta.worldview,
        attribution: pack.meta.attribution,
      },
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'choroplethTitle', { v1: pack.id })),
      counts: [...geoStateCounts(visibleStates, options), structureCount('regions', pack.regions.length, chartString(options, 'regionCountPrefix', { v1: pack.regions.length })),
        structureCount('regions', missingCount, chartString(options, 'listedRegions', { v1: missingCount })),
        ...(drawnUnlistedCount ? [structureCount('regions', drawnUnlistedCount, undefined, options)] : []),
        ...(smallIds.size ? [structureCount('regions', smallIds.size, chartString(options, 'regionsCount', { v1: smallIds.size }))] : []),
        ...(missingCount && chipOnlyNoData.length ? [structureCount('regions', chipOnlyNoData.length, chartString(options, 'regionsPlural', { v1: chipOnlyNoData.length, v2: chipOnlyNoData.length === 1 ? '' : 's' }))] : [])],
      desc:
        chartString(options, 'mapEqualArea', { v1: pack.regions.length }) +
        (scale.min === null
          ? chartString(options, 'noNumericValues')
          : chartString(options, 'mappedRange', { v1: fmt(scale.min), v2: fmt(scale.max!) })) +
        // The inverted judgment is an encoding — hue must not carry it alone
        // (variance appends the same phrase for its direction).
        (scale.polarity === 'lowerIsBetter' ? chartString(options, 'lowerFavorable') : '') +
        (tableDrawn ? chartString(options, 'mapTable', { v1: !sideForm && tablePlace!.y > mapArea.y ? chartString(options, 'under') : chartString(options, 'beside') })
          : smallIds.size ? chartString(options, 'mapHiddenRegions', { v1: smallIds.size }) : '') +
        chartString(options, 'mapMissingRegions', { v1: missingCount }) +
        (drawnUnlistedCount ? chartString(options, 'mapUnlistedRegions', { v1: drawnUnlistedCount }) : '') +
        geoStateSummary(visibleStates, options) +
        (missingCount === 0 ? '' : chipOnlyNoData.length === 0
          ? chartString(options, 'mapMissingHatch')
          : chartString(options, 'mapSmallMissing', { v1: chipOnlyNoData.length, v2: chipOnlyNoData.length === 1 ? ' is' : 's are', v3: chipOnlyNoData.length === 1 ? 'ies' : 'y' })) +
        (overlayResult.descriptions.length
          ? chartString(options, 'overlaysSentence', { v1: overlayResult.descriptions.join(' ') })
          : '') +
        chartString(options, 'sourceSentence', { v1: pack.meta.attribution, v2: userSource }),
    },
    warnings,
    debug: {
      occupied: visibleOccupiedSnapshot(
        occupied.snapshot(),
        [...solved.placed, ...small.placed, ...(tableDrawn?.placed ?? []), ...overlayResult.labels],
      ),
      decisions: [...solved.decisions, ...small.decisions, ...(tableDrawn?.decisions ?? []), ...overlayResult.decisions],
    },
  };
  // The table takes its room from the map. The next pass stands only when
  // the frame holds its table (no value hidden, no height the canvas lacks)
  // and it names more regions than this one; else it is tried with the lost
  // names alone, and else this pass stands.
  const hidden = (result: typeof geometry) => result.labels.filter((label) => label.hidden).length;
  // A frame below its own floor is refused whatever a later pass lists, so the
  // passes would only cost time: the size search moves on to a taller frame.
  if ((geometry.sizing?.minHeight ?? 0) > size.height + 1) return geometry;
  // Both moves, and passes below them, can reach the same listed set; each
  // set is laid out once per frame.
  for (const move of [[...lost, ...far], lost, lost.length ? [...labelPolicy.eligibleIds] : []]) {
    if (!move.length) continue;
    const ids = new Set([...(listed ?? []), ...move]);
    const key = `${pass + 1}:${[...ids].sort().join(',')}`;
    let next = passes.get(key) ?? layoutChoropleth(data, options, ids, pass + 1, passes, omittedOverlays);
    // An automatic frame can take the list's measured height when it keeps more names.
    const height = Math.ceil(Math.max(next.sizing?.minHeight ?? 0, next.sizing?.naturalHeight ?? 0));
    if ((options as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false && height > next.size.height && height <= 1400) {
      const taller = layoutChoropleth(data, { ...options, size: { width: size.width, height } }, ids, pass + 1, new Map(), omittedOverlays);
      if (hidden(taller) < hidden(geometry)) next = taller;
    }
    passes.set(key, next);
    const fits = !next.labels.some((label) => label.hidden && label.slot === 'smallMember') &&
      (next.sizing?.minHeight ?? 0) <= next.size.height && hidden(next) <= hidden(geometry);
    if (fits) return next;
  }
  return geometry;
}

function prepareMapLayout(pack: GeoPack, plot: Rect, laneSpan: { y: number; h: number }, occupied: OccupiedIndex, valuesById: Map<string, number | null>, labelPolicy: RegionLabelPolicy, visibleMarkerIds: Set<string>, theme: Theme,
  measure: typeof defaultMeasurer, solveCtx: SolveCtx, valueTexts: ReadonlyMap<string, string>, padding?: number,
  withTable?: TableLabels) {
  // The probes and final marks share one guard for each fitted frame.
  // These fits and query caches end with this map preparation.
  const fits = new Map<string, PreparedMapFit>();
  const fitMap = (frame: Rect): PreparedMapFit => {
    const key = `${frame.x},${frame.y},${frame.w},${frame.h}`;
    let prepared = fits.get(key);
    if (!prepared) {
      const fitted = fitGeoPack(pack, frame);
      const outsideFits = outsideLabelGuard(fitted.regions.filter(region => region.polygons.length > 0 || visibleMarkerIds.has(region.id)));
      prepared = { fitted, outsideFits };
      fits.set(key, prepared);
    }
    return prepared;
  };
  const labelLayout = labelPolicy.eligibleIds.size > 0
    ? resolveRegionLabelLayout(
        pack,
        plot,
        { ...plot, ...laneSpan },
        occupied.snapshot(),
        valuesById,
        labelPolicy.eligibleIds,
        labelPolicy.leaderIds,
        labelPolicy.inlineMarkerIds,
        visibleMarkerIds,
        theme,
        measure,
        solveCtx,
        valueTexts,
        fitMap,
        withTable,
      )
    : { gutter: 0, leaderIds: new Set<string>() };
  const mapFrame = choroplethMapFrame(plot, labelLayout.gutter, pack.id, padding);
  const mapFit = fitMap(mapFrame);
  const { fitted, outsideFits } = mapFit;
  const leaderLanes = buildLeaderLanes(
    mapFit,
    labelLayout.leaderIds,
    { ...plot, ...laneSpan },
    theme,
    measure,
    valueTexts,
  );

  return { labelLayout, mapFrame, fitted, leaderLanes, outsideFits };
}

function resolveChoroplethOverlayAnchor(
  overlay: GeoOverlay,
  index: number,
  fitted: ReturnType<typeof fitGeoPack>,
  idIndex: GeoRegionIdIndex,
  pack: GeoPack,
): { x: number; y: number } {
  if ('lon' in overlay.at) {
    let point: ReturnType<typeof fitGeoLonLat>;
    try {
      point = fitGeoLonLat(fitted, overlay.at.lon, overlay.at.lat);
    } catch (error) {
      throw new NormalizeError(
        'overlay-coordinate-invalid',
        `overlays[${index}].at`,
        `overlay '${overlay.id}' cannot be projected through pack '${pack.id}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!point) {
      throw new NormalizeError(
        'overlay-coordinate-unowned',
        `overlays[${index}].at`,
        `overlay '${overlay.id}' at longitude ${overlay.at.lon}, latitude ${overlay.at.lat} is not owned by any projection branch in pack '${pack.id}'`,
      );
    }
    return point;
  }
  const resolution = resolveGeoRegionId(idIndex, overlay.at.region);
  if (resolution.kind !== 'resolved') {
    throw new NormalizeError(
      'overlay-unknown-region',
      `overlays[${index}].at.region`,
      `overlay region '${overlay.at.region}' is not uniquely present in pack '${pack.id}'`,
      resolution.kind === 'ambiguous'
        ? `use one of ${resolution.candidates.join(', ')}`
        : undefined,
    );
  }
  const region = fitted.regions.find((candidate) => candidate.id === resolution.id);
  if (!region) {
    throw new NormalizeError(
      'overlay-unknown-region',
      `overlays[${index}].at.region`,
      `overlay region '${overlay.at.region}' is not present in fitted pack '${pack.id}'`,
    );
  }
  return { x: region.anchor.x, y: region.anchor.y };
}

function solveRegionLabels(
  plans: RegionLabelPlan[],
  occupied: OccupiedIndex,
  ctx: SolveCtx,
  outsideFits: ReturnType<typeof outsideLabelGuard>,
  /** A probe that reads only these regions' labels: the escalation stops after the last of them. */
  reads?: (regionId: string) => boolean,
): RegionLabelSolveResult {
  const pinOf = (plan: RegionLabelPlan) => ctx.pins[`category:${plan.region.id}`];
  const ordered = [...plans].sort((a, b) => {
    const aPinned = pinOf(a) ? 1 : 0;
    const bPinned = pinOf(b) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return b.priority - a.priority || compareText(a.region.id, b.region.id);
  });
  const result: RegionLabelSolveResult = {
    placed: [],
    decisions: [],
    warnings: [],
    fontByLabel: new Map(),
  };
  const solveCtx = { ...ctx, pins: {} };
  const unresolved: {
    plan: RegionLabelPlan;
    tried: string[];
    fallback: ReturnType<typeof solveLabels>;
  }[] = [];

  for (const plan of ordered) {
    const requestedPin = pinOf(plan);
    if (requestedPin) {
      const pinnedVariant = plan.variants.find((variant) =>
        variant.request.candidates.some((candidate) => candidate.slot === requestedPin)
      );
      if (pinnedVariant) {
        // A pinned variant must face EXACTLY the conditions the automatic path
        // below would have given it: a backed label sits on its own backing
        // rect, so region fills do not block it and the wider pad applies.
        // While pins were honoured blind this asymmetry was invisible; once
        // pins are collision-checked, judging a backed pin against region
        // marks hides labels that automatic placement would have drawn.
        const backed = pinnedVariant.request.candidates.some((candidate) => candidate.needsBacking);
        const pinned = solveLabels(
          [{ ...pinnedVariant.request, pinnedSlot: requestedPin }],
          backed ? withoutRegionMarks(occupied) : occupied,
          backed ? { ...solveCtx, labelPad: 4 } : solveCtx,
        );
        appendRegionSolve(result, pinned, pinnedVariant.font, plan);
        claimLabelBacking(pinned.placed[0], occupied);
        claimSolvedLeader(pinned.placed[0], plan.region, occupied);
        continue;
      }
      result.warnings.push({
        code: 'unknown-slot',
        severity: 'warn',
        message: `label 'category:${plan.region.id}': unknown slot '${requestedPin}' — using automatic placement`,
        owner: { categoryId: plan.region.id },
        suggest: allPlanSlots(plan).join(', '),
      });
    }

    const tried: string[] = [];
    let fallback: ReturnType<typeof solveLabels> | undefined;
    let placed = false;
    for (const variant of plan.variants.filter((candidate) => !candidate.leader && !candidate.callout)) {
      const backed = variant.request.candidates.some((candidate) => candidate.needsBacking);
      const solveOccupied = backed ? withoutRegionMarks(occupied) : occupied;
      const next = solveLabels(
        [variant.request],
        solveOccupied,
        backed ? { ...solveCtx, labelPad: 4 } : solveCtx,
      );
      fallback = next;
      tried.push(...(next.decisions[0]?.tried ?? []));
      if (next.placed[0]?.hidden) continue;
      appendRegionSolve(result, next, variant.font, plan, tried);
      claimLabelBacking(next.placed[0], occupied);
      placed = true;
      break;
    }
    if (!placed && fallback) unresolved.push({ plan, tried, fallback });
  }

  // The regions that could not label on their own fill take a callout in
  // value order, so the highest values keep their names when room runs out.
  unresolved.sort(
    (a, b) => b.plan.priority - a.plan.priority || compareText(a.plan.region.id, b.plan.region.id),
  );
  // A label escalated later claims room only after the ones before it, so
  // a probe's answer does not depend on the labels after its last region.
  let escalated = unresolved.length;
  if (reads) while (escalated > 0 && !reads(unresolved[escalated - 1]!.plan.region.id)) escalated--;
  const solvedLeaders: { placed: ReturnType<typeof solveLabels>['placed'][number]; region: FittedGeoRegion }[] = [];
  for (const item of unresolved.slice(0, escalated)) {
    const callout = item.plan.variants.find((variant) => variant.callout);
    if (callout) {
      const candidates = callout.callout!(occupied, ctx.plot);
      const next = solveLabels([{ ...callout.request, candidates }], occupied, solveCtx);
      const placed = next.placed[0];
      if (placed && !placed.hidden) {
        item.tried.push(...(next.decisions[0]?.tried ?? []));
        appendRegionSolve(result, next, callout.font, item.plan, item.tried);
        const from: GeoPoint = [item.plan.region.anchor.x, item.plan.region.anchor.y];
        const to = calloutTerminus(from, placed.rect);
        placed.leader = { d: polylinePath([from, to]), curved: false };
        claimLeaderRoute([from, to], occupied, item.plan.region.id);
        continue;
      }
      item.tried.push(...(next.decisions[0]?.tried ?? []));
    }
    const leaderVariant = item.plan.variants.find((variant) => variant.leader);
    if (!leaderVariant) {
      appendRegionSolve(result, item.fallback, item.plan.variants.at(-1)!.font, item.plan, item.tried);
      continue;
    }
    const next = solveLabels([leaderVariant.request], occupied, solveCtx);
    const tried = [...item.tried, ...(next.decisions[0]?.tried ?? [])];
    appendRegionSolve(result, next, leaderVariant.font, item.plan, tried);
    const placed = next.placed[0];
    if (placed && !placed.hidden && placed.leader) {
      claimLabelBacking(placed, occupied);
      solvedLeaders.push({ placed, region: item.plan.region });
    }
  }
  routeAndClaimLeaders(solvedLeaders, result.placed, ctx.plot, occupied, outsideFits);
  return result;
}

function withoutRegionMarks(occupied: OccupiedIndex): OccupiedIndex {
  const regionMark = (claim: OccupiedRect) =>
    claim.kind === 'mark' && (claim.part === 'region' || claim.part === 'noDataHatch');
  return {
    claim: (rect, kind, owner, part) => occupied.claim(rect, kind, owner, part),
    hits: (rect, pad = 0) => occupied.hits(rect, pad, regionMark),
    hitsWhich: (rect, pad = 0) => occupied.hitsWhich(rect, pad, regionMark),
    snapshot: () => occupied.snapshot(),
  };
}

function claimLabelBacking(
  placed: ReturnType<typeof solveLabels>['placed'][number] | undefined,
  occupied: OccupiedIndex,
): void {
  if (placed?.backing && !placed.hidden) {
    occupied.claim(placed.backing, 'reserved', placed.owner, 'labelBacking');
  }
}

function appendRegionSolve(
  result: RegionLabelSolveResult,
  next: ReturnType<typeof solveLabels>,
  font: FontSpec,
  plan: RegionLabelPlan,
  tried?: string[],
): void {
  const placed = next.placed[0];
  const decision = next.decisions[0];
  if (!placed || !decision) return;
  placed.slots = allPlanSlots(plan);
  result.placed.push(placed);
  result.decisions.push(
    tried === undefined
      ? decision
      : {
          ...decision,
          tried,
          reason: placed.hidden
            ? 'full, compact, and leader escalation exhausted'
            : `candidate ${tried.length} free in full → compact → leader escalation`,
        },
  );
  result.warnings.push(...next.warnings);
  result.fontByLabel.set(placed.id, font);
}

function claimSolvedLeader(
  placed: ReturnType<typeof solveLabels>['placed'][number] | undefined,
  region: FittedGeoRegion,
  occupied: OccupiedIndex,
): void {
  if (!placed || placed.hidden || !placed.leader) return;
  placed.leader = { d: polylinePath([[region.anchor.x, region.anchor.y], leaderTarget([region.anchor.x, region.anchor.y], placed.rect)]), curved: false };
  claimLeader(
    [region.anchor.x, region.anchor.y],
    leaderTarget([region.anchor.x, region.anchor.y], placed.rect),
    occupied,
    region.id,
  );
}

function routeAndClaimLeaders(
  leaders: { placed: ReturnType<typeof solveLabels>['placed'][number]; region: FittedGeoRegion }[],
  labels: ReturnType<typeof solveLabels>['placed'],
  plot: Rect,
  occupied: OccupiedIndex,
  outsideFits: ReturnType<typeof outsideLabelGuard>,
): void {
  const obstacles = labels.filter((label) => !label.hidden);
  for (const { placed, region } of leaders) {
    const from: GeoPoint = [region.anchor.x, region.anchor.y];
    const route = leastCrossingLeaderRoute(
      from,
      leaderTarget(from, placed.rect),
      obstacles,
      region.id,
      plot,
      placed.rect,
      outsideFits,
    );
    placed.leader = { d: polylinePath(route), curved: false };
    claimLeaderRoute(route, occupied, region.id);
  }
}

function leastCrossingLeaderRoute(
  from: GeoPoint,
  to: GeoPoint,
  labels: ReturnType<typeof solveLabels>['placed'],
  regionId: string,
  plot: Rect,
  rect: Rect,
  outsideFits: ReturnType<typeof outsideLabelGuard>,
): GeoPoint[] {
  const gutterX = to[0] - 6;
  const corridorY = new Set<number>([
    plot.y + 1,
    plot.y + plot.h - 1,
    from[1],
    to[1],
  ]);
  for (const label of labels) {
    if (label.owner.categoryId === regionId) continue;
    const rect = label.backing ?? label.rect;
    corridorY.add(Math.max(plot.y + 1, rect.y - 3));
    corridorY.add(Math.min(plot.y + plot.h - 1, rect.y + rect.h + 3));
  }
  const candidates: GeoPoint[][] = [
    [from, to],
    [from, [gutterX, from[1]], [gutterX, to[1]], to],
  ];
  for (const y of [...corridorY].sort((a, b) => a - b)) {
    candidates.push(
      [from, [from[0], y], [gutterX, y], [gutterX, to[1]], to],
      [from, [from[0] - 6, from[1]], [from[0] - 6, y], [gutterX, y], [gutterX, to[1]], to],
      [from, [from[0] + 6, from[1]], [from[0] + 6, y], [gutterX, y], [gutterX, to[1]], to],
    );
  }
  // Walk candidates shortest first; the first one with the fewest crossings is the
  // same pick as sorting by (crossings, length, points, index), and a zero-crossing
  // route ends the search.
  const obstacles = labels.filter((label) => label.owner.categoryId && label.owner.categoryId !== regionId && !label.hidden);
  const ranked = candidates
    .map((points, index) => ({ raw: points, points: dedupeRoute(points), length: routeLength(points), index }))
    .sort((a, b) => a.length - b.length || a.points.length - b.points.length || a.index - b.index);
  let best = ranked[0]!;
  let fewest = Infinity;
  for (const candidate of ranked) {
    if (!candidate.points.slice(1).every((point, index) => outsideFits(regionId, rect, candidate.points[index]!, point))) continue;
    const crossings = routeLabelCrossings(candidate.raw, obstacles, regionId, fewest);
    if (crossings < fewest) {
      best = candidate;
      fewest = crossings;
      if (fewest === 0) break;
    }
  }
  return best.points;
}

function routeLabelCrossings(
  points: GeoPoint[],
  labels: ReturnType<typeof solveLabels>['placed'],
  regionId: string,
  stopAt = Infinity,
): number {
  const crossed = new Set<string>();
  for (let index = 1; index < points.length; index++) {
    const segmentRect = rectForSegment(points[index - 1]!, points[index]!);
    for (const label of labels) {
      const id = label.owner.categoryId;
      if (!id || id === regionId || label.hidden) continue;
      if (rectsIntersect(segmentRect, label.backing ?? label.rect)) {
        crossed.add(id);
        if (crossed.size >= stopAt) return crossed.size;
      }
    }
  }
  return crossed.size;
}

function routeLength(points: GeoPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index]![0] - points[index - 1]![0],
      points[index]![1] - points[index - 1]![1],
    );
  }
  return length;
}

function dedupeRoute(points: GeoPoint[]): GeoPoint[] {
  return points.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== points[index - 1]![0] ||
      point[1] !== points[index - 1]![1],
  );
}

function polylinePath(points: GeoPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${coord(point)}`)
    .join('');
}

function claimLeaderRoute(
  points: GeoPoint[],
  occupied: OccupiedIndex,
  regionId: string,
): void {
  for (let index = 1; index < points.length; index++) {
    claimSegment(
      { a: points[index - 1]!, b: points[index]! },
      occupied,
      regionId,
      'regionLeader',
    );
  }
}

function rectForSegment(a: GeoPoint, b: GeoPoint): Rect {
  return {
    x: Math.min(a[0], b[0]) - 0.6,
    y: Math.min(a[1], b[1]) - 0.6,
    w: Math.abs(b[0] - a[0]) + 1.2,
    h: Math.abs(b[1] - a[1]) + 1.2,
  };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function allPlanSlots(plan: RegionLabelPlan): string[] {
  return plan.variants.flatMap((variant) =>
    variant.request.candidates.map((candidate) => candidate.slot)
  );
}

function resolveLabelRegionIds(
  requested: string[],
  idIndex: GeoRegionIdIndex,
  pack: GeoPack,
): Set<string> {
  const canonicalIds = idIndex.canonical;
  const resolved = new Set<string>();
  requested.forEach((id, index) => {
    const resolution = resolveGeoRegionId(idIndex, id);
    if (resolution.kind === 'ambiguous') {
      // A label request names one region; an ambiguous spelling names several.
      // Fail closed rather than label a region the author did not ask for.
      throw new NormalizeError(
        'choropleth-ambiguous-region',
        `labelRegions[${index}]`,
        `region '${id}' is ambiguous in pack '${pack.id}' — ` +
          `${resolution.candidates.join(', ')} all answer to it`,
        `use one of ${resolution.candidates.join(', ')}`,
      );
    }
    if (resolution.kind === 'unknown') {
      const suggestion = nearestRegionId(id, [...canonicalIds.keys()], canonicalIds);
      throw new NormalizeError(
        'choropleth-unknown-region',
        `labelRegions[${index}]`,
        `region '${id}' is not present in pack '${pack.id}'`,
        suggestion ? `did you mean '${suggestion}'?` : undefined,
      );
    }
    resolved.add(resolution.id);
  });
  return resolved;
}

function resolveRegionLabelPolicy(
  pack: GeoPack,
  valuesById: Map<string, number | null>,
  explicitIds: Set<string>,
  option: ChoroplethOptions['labels'],
  requestedTopN: number | undefined,
): RegionLabelPolicy {
  const mode = option === false ? 'none' : option ?? 'auto';
  const topN = pack.id === 'world'
    ? Math.min(pack.regions.length, requestedTopN ?? WORLD_AUTO_LABEL_COUNT)
    : pack.regions.length;
  if (mode === 'none') {
    return {
      mode,
      eligibleIds: new Set(),
      leaderIds: new Set(),
      inlineMarkerIds: new Set(),
      topN,
    };
  }
  if (mode === 'all' || pack.id !== 'world') {
    const eligibleIds = new Set(pack.regions.map((region) => region.id));
    return {
      mode,
      eligibleIds,
      leaderIds: new Set(eligibleIds),
      inlineMarkerIds: new Set(),
      topN,
    };
  }

  const rankedIds = pack.regions
    .flatMap((region) => {
      const value = valuesById.get(region.id) ?? null;
      return value === null ? [] : [{ id: region.id, value }];
    })
    .sort(
      (a, b) =>
        Math.abs(b.value) - Math.abs(a.value) ||
        compareText(a.id, b.id),
    )
    .slice(0, topN)
    .map((region) => region.id);
  const largeRegionIds = pack.regions.flatMap((region) => {
    const value = valuesById.get(region.id) ?? null;
    return value !== null &&
        region.polygons.length > 0 &&
        region.anchor.clearance >= WORLD_LARGE_REGION_CLEARANCE
      ? [region.id]
      : [];
  });
  const eligibleIds = new Set([...explicitIds, ...rankedIds, ...largeRegionIds]);
  const inlineMarkerIds = new Set(
    pack.regions
      .filter(
        (region) =>
          region.polygons.length === 0 &&
          eligibleIds.has(region.id) &&
          !explicitIds.has(region.id),
      )
      .map((region) => region.id),
  );
  return {
    mode,
    eligibleIds,
    leaderIds: new Set(explicitIds),
    inlineMarkerIds,
    topN,
  };
}


function resolveRegionLabelLayout(
  pack: GeoPack,
  plot: Rect,
  lanePlot: Rect,
  frameClaims: OccupiedRect[],
  valuesById: Map<string, number | null>,
  labelIds: Set<string>,
  leaderEligibleIds: Set<string>,
  inlineMarkerIds: Set<string>,
  visibleMarkerIds: Set<string>,
  theme: Theme,
  measure: typeof defaultMeasurer,
  solveCtx: SolveCtx,
  valueTexts: ReadonlyMap<string, string>,
  fitMap: (frame: Rect) => PreparedMapFit,
  withTable: TableLabels,
): { gutter: number; leaderIds: Set<string> } {
  let gutter = 0;
  let leaderIds = new Set(
    pack.regions
      .filter(
        (region) =>
          region.marker &&
          region.polygons.length === 0 &&
          leaderEligibleIds.has(region.id) &&
          (pack.id !== 'world' || region.microState),
      )
      .map((region) => region.id),
  );
  if (leaderIds.size > 0) {
    const initialFit = fitGeoPack(pack, choroplethMapFrame(plot, 0, pack.id));
    gutter = measuredLeaderGutter(initialFit.regions, leaderIds, plot, theme, measure, valueTexts);
  }
  const ranks = valueRanks(valuesById);
  for (let iteration = 0; iteration <= pack.regions.length; iteration++) {
    const mapFrame = choroplethMapFrame(plot, gutter, pack.id);
    const mapFit = fitMap(mapFrame);
    const { fitted, outsideFits } = mapFit;
    const lanes = buildLeaderLanes(mapFit, leaderIds, lanePlot, theme, measure, valueTexts);
    const probeOccupied = createOccupiedIndex(solveCtx.canvas ?? plot);
    for (const claim of frameClaims) {
      probeOccupied.claim(claim.rect, claim.kind, claim.owner, claim.part);
    }
    for (const region of fitted.regions) {
      const regionVisible = region.polygons.length > 0 || visibleMarkerIds.has(region.id);
      if (regionVisible) claimRegionMark(region, probeOccupied);
      if (regionVisible && (valuesById.get(region.id) ?? null) === null) {
        claimHatchSegments(hatchSegments(region, strokeToken(theme, 'hair')), probeOccupied, region.id);
      }
    }
    for (const boundary of fitted.boundaries) claimBoundaryMark(boundary, probeOccupied);
    claimLeaderAnchors(fitted.regions, leaderIds, probeOccupied);
    const plans = fitted.regions
      .filter((region) => labelIds.has(region.id))
      .map((region) =>
        labelPlanForRegion(
          region,
          lanes.get(region.id),
          theme,
          measure,
          { token: 'background' },
          inlineMarkerIds.has(region.id),
          valueTexts,
          ranks.get(region.id) ?? ranks.size,
          outsideFits,
          undefined,
          withTable?.emphasis.has(region.id) ?? false,
          withTable !== undefined,
        )
      );
    // Only a region not yet on a leader can add one.
    const solved = solveRegionLabels(plans, probeOccupied, solveCtx, outsideFits, (id) => leaderEligibleIds.has(id) && !leaderIds.has(id));
    const regionsById = new Map(fitted.regions.map((region) => [region.id, region]));
    const hiddenIds = solved.placed.flatMap((label) => {
      const id = label.owner.categoryId;
      const region = id ? regionsById.get(id) : undefined;
      return label.hidden === 'collision' &&
          id &&
          region &&
          leaderEligibleIds.has(id) &&
          (pack.id !== 'world' || region.microState)
        ? [id]
        : [];
    });
    const candidateLanes = buildLeaderLanes(mapFit, new Set([...leaderIds, ...hiddenIds]), lanePlot, theme, measure, valueTexts);
    // Reserve a gutter only for regions that can use it without a misleading leader.
    const safeIds = hiddenIds.filter(id => {
      const region = regionsById.get(id)!;
      const rect = candidateLanes.get(id)!.rect;
      const from: GeoPoint = [region.anchor.x, region.anchor.y];
      return outsideFits(id, rect, from, leaderTarget(from, rect));
    });
    const nextLeaderIds = new Set([...leaderIds, ...safeIds]);
    if (nextLeaderIds.size === leaderIds.size) return { gutter, leaderIds };
    leaderIds = nextLeaderIds;
    gutter = measuredLeaderGutter(fitted.regions, leaderIds, plot, theme, measure, valueTexts);
  }
  return { gutter, leaderIds };
}

function claimLeaderAnchors(
  regions: FittedGeoRegion[],
  leaderIds: Set<string>,
  occupied: OccupiedIndex,
): void {
  for (const region of regions) {
    if (!leaderIds.has(region.id)) continue;
    occupied.claim(
      {
        x: region.anchor.x - 2,
        y: region.anchor.y - 2,
        w: 4,
        h: 4,
      },
      'reserved',
      { categoryId: region.id },
      'leaderAnchor',
    );
  }
}

function visibleOccupiedSnapshot(
  claims: OccupiedRect[],
  labels: ReturnType<typeof solveLabels>['placed'],
): OccupiedRect[] {
  const backings = labels.flatMap((label) =>
    !label.hidden && label.backing
      ? [{ rect: label.backing, ownerId: label.owner.categoryId }]
      : []
  );
  return claims.flatMap((claim) => {
    if (
      claim.kind !== 'mark' ||
      (claim.part !== 'region' && claim.part !== 'noDataHatch')
    ) {
      return [claim];
    }
    let visible = [claim.rect];
    for (const backing of backings) {
      if (backing.ownerId === claim.owner.categoryId) continue;
      visible = visible.flatMap((rect) => subtractRect(rect, backing.rect));
    }
    return visible.map((rect) => ({ ...claim, rect }));
  });
}

function subtractRect(rect: Rect, cut: Rect): Rect[] {
  const x1 = Math.max(rect.x, cut.x);
  const y1 = Math.max(rect.y, cut.y);
  const x2 = Math.min(rect.x + rect.w, cut.x + cut.w);
  const y2 = Math.min(rect.y + rect.h, cut.y + cut.h);
  if (x1 >= x2 || y1 >= y2) return [rect];
  const pieces: Rect[] = [];
  if (rect.y < y1) pieces.push({ x: rect.x, y: rect.y, w: rect.w, h: y1 - rect.y });
  if (y2 < rect.y + rect.h) {
    pieces.push({ x: rect.x, y: y2, w: rect.w, h: rect.y + rect.h - y2 });
  }
  if (rect.x < x1) pieces.push({ x: rect.x, y: y1, w: x1 - rect.x, h: y2 - y1 });
  if (x2 < rect.x + rect.w) {
    pieces.push({ x: x2, y: y1, w: rect.x + rect.w - x2, h: y2 - y1 });
  }
  return pieces;
}

/**
 * Whether a key-share try is under the key for every gutter its leader probe can choose, so the
 * try is rejected without the probe. Proof: the gutter lies in [0, min(LEADER_GUTTER, LEADER_GUTTER_SHARE w)]
 * (measuredLeaderGutter, finite widths). Over that range each fitted point moves on a piecewise
 * linear path whose corners are the frame-width floor and the width/height scale switch. The key
 * area is convex, so a point inside it at the ends and corners is inside at every gutter; the
 * margin covers float rounding. Outside this domain the try runs in full.
 */
function certainlyUnderKey(pack: GeoPack, rect: Rect, padding: number | undefined, keyArea: Rect,
  measure: typeof defaultMeasurer, theme: Theme): boolean {
  // The built-in measurer gives a finite width for a finite font, so the gutter is never NaN.
  const font = geoLabelFont(theme);
  if (measure !== defaultMeasurer || !Number.isFinite(font.size) || !(font.letterSpacing === undefined || Number.isFinite(font.letterSpacing))) return false;
  const [minX, minY, maxX, maxY] = pack.bounds;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const xPad = padding ?? MAP_PAD;
  const yPad = padding ?? (pack.id === 'us-states' ? US_MAP_PAD_Y : MAP_PAD);
  const finite = [rect.x, rect.y, rect.w, rect.h, xPad, yPad, keyArea.x, keyArea.y, keyArea.w, keyArea.h, bw, bh, minX, minY];
  if (!finite.every(Number.isFinite) || !(bw > 0) || !(bh > 0) || !(rect.w >= 0)) return false;
  const gMax = Math.min(LEADER_GUTTER, rect.w * LEADER_GUTTER_SHARE);
  const fh = Math.max(10, rect.h - yPad * 2);
  const gutters = [0, gMax, rect.w - xPad * 2 - 10, rect.w - xPad * 2 - bw * fh / bh].filter((g) => g >= 0 && g <= gMax);
  // The same transform as fitDecodedGeoPack, at each end and corner of the gutter range.
  const fits = gutters.map((g) => {
    const fw = Math.max(10, rect.w - xPad * 2 - g);
    const sx = fw / bw;
    const sy = fh / bh;
    const scale = sx < sy ? sx : sy;
    return { scale, x: rect.x + xPad + (fw - bw * scale) / 2 - minX * scale, y: rect.y + yPad + (fh - bh * scale) / 2 - minY * scale, fw };
  });
  let magnitude = Math.max(Math.abs(keyArea.x), Math.abs(keyArea.y), Math.abs(keyArea.x + keyArea.w), Math.abs(keyArea.y + keyArea.h),
    Math.abs(rect.x) + xPad, Math.abs(rect.y) + yPad, rect.w, fh);
  for (const fit of fits) {
    magnitude = Math.max(magnitude, fit.fw, Math.abs(fit.x), Math.abs(fit.y),
      Math.abs(minX * fit.scale), Math.abs(maxX * fit.scale), Math.abs(minY * fit.scale), Math.abs(maxY * fit.scale));
  }
  if (!(magnitude <= 2 ** 40)) return false;
  const margin = 16 * Number.EPSILON * magnitude;
  const inner = { x: keyArea.x + margin, y: keyArea.y + margin, w: keyArea.w - 2 * margin, h: keyArea.h - 2 * margin };
  if (!(inner.w >= 0 && inner.h >= 0)) return false;
  const inside = (px: number, py: number) => fits.every((fit) => pointInRect(px * fit.scale + fit.x, py * fit.scale + fit.y, inner));
  for (const region of decodeGeoPack(pack).regions) {
    if (region.marker !== undefined && inside(region.marker.x, region.marker.y)) return true;
    for (const polygon of region.polygons) for (const ring of polygon) for (const [px, py] of ring) if (inside(px, py)) return true;
  }
  return false;
}

function choroplethMapFrame(plot: Rect, gutter: number, packId: GeoPack['id'], padding?: number): Rect {
  const xPad = padding ?? MAP_PAD;
  const yPad = padding ?? (packId === 'us-states' ? US_MAP_PAD_Y : MAP_PAD);
  return {
    x: plot.x + xPad,
    y: plot.y + yPad,
    w: Math.max(10, plot.w - xPad * 2 - gutter),
    h: Math.max(10, plot.h - yPad * 2),
  };
}

function measuredLeaderGutter(
  regions: FittedGeoRegion[],
  leaderIds: Set<string>,
  plot: Rect,
  theme: Theme,
  measure: typeof defaultMeasurer,
  valueTexts: ReadonlyMap<string, string>,
): number {
  const compactFont = geoLabelFont(theme);
  const maxWidth = regions
    .filter((region) => leaderIds.has(region.id))
    .reduce(
      (largest, region) =>
        Math.max(largest, measure(regionLabelText(region, compactFont, measure, valueTexts), compactFont).width),
      0,
    );
  return Math.min(LEADER_GUTTER, plot.w * LEADER_GUTTER_SHARE, Math.max(28, maxWidth + 24));
}

function buildLeaderLanes(
  prepared: PreparedMapFit,
  leaderIds: Set<string>,
  plot: Rect,
  theme: Theme,
  measure: typeof defaultMeasurer,
  valueTexts: ReadonlyMap<string, string>,
): Map<string, LeaderLane> {
  const { regions } = prepared.fitted;
  const compactFont = geoLabelFont(theme);
  const h = compactFont.size * (compactFont.lineHeight ?? 1.2);
  const ordered = regions
    .filter((region) => leaderIds.has(region.id))
    .sort((a, b) => a.anchor.y - b.anchor.y || compareText(a.id, b.id));
  if (ordered.length === 0) return new Map();

  const availableGap = ordered.length === 1
    ? LEADER_LANE_GAP
    : (plot.h - ordered.length * h) / (ordered.length - 1);
  const gap = Math.max(0, Math.min(LEADER_LANE_GAP, availableGap));
  const top = plot.y;
  const bottom = plot.y + plot.h - h;
  const y = ordered.map((region) =>
    Math.max(top, Math.min(bottom, region.anchor.y - h / 2))
  );
  for (let index = 1; index < y.length; index++) {
    y[index] = Math.max(y[index]!, y[index - 1]! + h + gap);
  }
  if (y[y.length - 1]! > bottom) {
    y[y.length - 1] = bottom;
    for (let index = y.length - 2; index >= 0; index--) {
      y[index] = Math.min(y[index]!, y[index + 1]! - h - gap);
    }
  }
  if (y[0]! < top) {
    y[0] = top;
    for (let index = 1; index < y.length; index++) {
      y[index] = Math.max(y[index]!, y[index - 1]! + h + gap);
    }
  }

  const contentRight = prepared.contentRight ??= regions.reduce((right, region) => {
    if (region.polygons.length > 0) {
      return Math.max(right, boundsOfPolygons(region.polygons)[2]);
    }
    const marker = region.marker ?? {
      x: region.anchor.x,
      y: region.anchor.y,
      radius: 2.5,
    };
    return Math.max(right, marker.x + marker.radius);
  }, plot.x);
  const maxLabelWidth = ordered.reduce(
    (width, region) =>
      Math.max(
        width,
        measure(regionLabelText(region, compactFont, measure, valueTexts), compactFont).width,
      ),
    0,
  );
  const laneX = Math.min(plot.x + plot.w - maxLabelWidth, contentRight + 16);
  return new Map(
    ordered.map((region, index) => {
      const text = regionLabelText(region, compactFont, measure, valueTexts);
      return [
        region.id,
        {
          index,
          rect: {
            x: laneX,
            y: y[index]!,
            w: measure(text, compactFont).width,
            h,
          },
        },
      ];
    }),
  );
}

function labelPlanForRegion(
  region: FittedGeoRegion,
  leaderLane: LeaderLane | undefined,
  theme: Theme,
  measure: typeof defaultMeasurer,
  insidePaint: Paint,
  markerInline: boolean,
  valueTexts: ReadonlyMap<string, string>,
  /** The region's place by value, highest first. */
  rank: number,
  outsideFits: ReturnType<typeof outsideLabelGuard>,
  pattern?: import('../../types/scene').HatchPattern,
  /** The region leads the value table: its label takes the emphasis weight. */
  emphasized = false,
  /**
   * The value table names every region: an enclave whose label fits nowhere
   * else may take a callout whose leader crosses a neighbour.
   */
  crossingCallouts = false,
): RegionLabelPlan {
  /*
   * ONE vocabulary per map, decided before placement.
   *
   * No full-name variant is tried per region: a region whose interior clearance
   * holds its full name would get "Texas" while its neighbours get "TX". The
   * vocabulary would then be a function of polygon geometry, which manufactures
   * a visual distinction out of nothing — a reader sees two kinds of label and
   * looks for the data difference behind them.
   *
   * The generic degradation ladder abbreviates AFTER trying a leader line; on a map that
   * order is wrong, because abbreviating is what makes the map uniform and the
   * leader is what makes it messy. Maps abbreviate up front.
   *
   * Note what is NOT here: a runtime chooser that picks a vocabulary for the
   * whole map. `shortestRegionName` decides per region, and on all five shipped
   * packs it already returns the same field for every region in the pack
   * (de-states and us-states return shortName, eu27 and dach return id,
   * world returns shortName === id). A chooser
   * would be a branch with zero live instances.
   */
  const tierFont = geoLabelFont(theme);
  const compactFont = emphasized ? { ...tierFont, weight: emphasisWeight(theme) } : tierFont;
  const compactText = regionLabelText(region, compactFont, measure, valueTexts);
  // Labels claim room in value order, so the highest values keep theirs.
  const priority = PRIORITY.interior + Math.max(0, 300 - rank);
  const compact = regionLabelRequest(
    region,
    compactText,
    compactFont,
    priority,
    inlineRegionCandidates(region, compactText, compactFont, effectiveFill(paintColor(theme, insidePaint), pattern, theme), measure, insidePaint, pattern),
  );
  const markerNeedsLeader = region.marker !== undefined && region.polygons.length === 0;
  // Marker records stay visible as marks; their labels must not cover the marker.
  const variants: RegionLabelVariant[] = markerNeedsLeader
    ? [{
        request: {
          ...compact,
          candidates: markerInline
            ? inlineMarkerCandidates(region, compactText, compactFont, measure).filter(candidate => outsideFits(region.id, candidate.rect))
            : [],
        },
        font: compactFont,
        leader: false,
      }]
    : [
        { request: compact, font: compactFont, leader: false },
        /**
         * A region whose label does not fit on its own fill gets a callout
         * on the free side nearest it, on a short straight leader that
         * crosses no other region when a free side allows. A backed chip
         * beside the anchor would hide the neighbours' fill.
         */
        {
          request: regionLabelRequest(region, compactText, compactFont, priority, []),
          font: compactFont,
          leader: false,
          callout: (occupied: OccupiedIndex, plot: Rect) => {
            const strict = calloutCandidates(region, compactText, compactFont, measure, occupied, plot, outsideFits);
            return strict.length || !crossingCallouts ? strict
              : calloutCandidates(region, compactText, compactFont, measure, occupied, plot, () => true);
          },
        },
      ];
  if (leaderLane) {
    variants.push({
      request: regionLabelRequest(
        region,
        compactText,
        compactFont,
        priority,
        [{
          slot: `leaderLane:${leaderLane.index + 1}`,
          rect: leaderLane.rect,
          penalty: 10,
          leaderFrom: { x: region.anchor.x, y: region.anchor.y },
        }].filter(candidate => outsideFits(region.id, candidate.rect,
          [region.anchor.x, region.anchor.y], leaderTarget([region.anchor.x, region.anchor.y], candidate.rect))),
      ),
      font: compactFont,
      leader: true,
    });
  }
  return { region, priority, variants };
}

/** The region's code, followed by its value when `regionValues` prints them. */
function regionLabelText(
  region: FittedGeoRegion,
  font: FontSpec,
  measure: typeof defaultMeasurer,
  valueTexts: ReadonlyMap<string, string>,
): string {
  const code = shortestRegionName(region, font, measure);
  const value = valueTexts.get(region.id);
  return value === undefined ? code : `${code} ${value}`;
}



/**
 * The four backed slots adjacent to a point — right, left, above, below, in
 * that penalty order. One shape for both users (marker labels and the
 * near-region chip variant) so the backed-chip geometry cannot drift apart
 * between them.
 */
function backedSlotsAround(
  cx: number,
  cy: number,
  gap: number,
  text: string,
  font: FontSpec,
  measure: typeof defaultMeasurer,
  slotPrefix: string,
  basePenalty: number,
): LabelRequest['candidates'] {
  const w = measure(text, font).width;
  const h = font.size * (font.lineHeight ?? 1.2);
  return [
    {
      slot: `${slotPrefix}Right`,
      rect: { x: cx + gap, y: cy - h / 2, w, h },
      penalty: basePenalty,
      needsBacking: true,
      contrast: 'box',
    },
    {
      slot: `${slotPrefix}Left`,
      rect: { x: cx - gap - w, y: cy - h / 2, w, h },
      penalty: basePenalty + 1,
      needsBacking: true,
      contrast: 'box',
    },
    {
      slot: `${slotPrefix}Above`,
      rect: { x: cx - w / 2, y: cy - gap - h, w, h },
      penalty: basePenalty + 2,
      needsBacking: true,
      contrast: 'box',
    },
    {
      slot: `${slotPrefix}Below`,
      rect: { x: cx - w / 2, y: cy + gap, w, h },
      penalty: basePenalty + 3,
      needsBacking: true,
      contrast: 'box',
    },
  ];
}

function inlineMarkerCandidates(
  region: FittedGeoRegion,
  text: string,
  font: FontSpec,
  measure: typeof defaultMeasurer,
): LabelRequest['candidates'] {
  const marker = region.marker ?? {
    x: region.anchor.x,
    y: region.anchor.y,
    radius: 2.5,
  };
  return backedSlotsAround(marker.x, marker.y, marker.radius + 6, text, font, measure, 'marker', 0);
}

function inlineRegionCandidates(
  region: FittedGeoRegion,
  text: string,
  font: FontSpec,
  insideFill: string,
  measure: typeof defaultMeasurer,
  insidePaint: Paint,
  insidePattern?: import('../../types/scene').HatchPattern,
): LabelRequest['candidates'] {
  // A label sits on its own fill without a box, and only where it covers at
  // most LABEL_MAX_COVER of the region; else it takes a callout. The slot
  // names keep the 'Compact' wording because 'insideCompactAboveRight' is part
  // of the public placement contract.
  const measured = measure(text, font);
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const w = measured.width;
  const h = lineH;
  const availableSpan = region.anchor.clearance * CLEARANCE_TEXT_SPAN;
  if (w > availableSpan || h > availableSpan || w * h > LABEL_MAX_COVER * polygonsArea(region.polygons)) return [];
  const decorate = (
    candidate: Omit<LabelRequest['candidates'][number], 'insideFill' | 'needsBacking'>,
  ): LabelRequest['candidates'][number] =>
    // Pattern strokes need the same page-colour halo as a hatched tile.
    ({ ...candidate, insideFill, insidePaint, ...(insidePattern ? { insidePattern, needsBacking: true } : {}) });
  const gap = 3;
  const center = {
    x: region.anchor.x - w / 2,
    y: region.anchor.y - h / 2,
    w,
    h,
  };
  const prefix = 'insideCompact';
  const candidates: LabelRequest['candidates'] = [
    decorate({ slot: `${prefix}Center`, rect: center, penalty: 3 }),
    decorate({
      slot: `${prefix}Above`,
      rect: { x: center.x, y: region.anchor.y - h - gap, w, h },
      penalty: 4,
    }),
    decorate({
      slot: `${prefix}Below`,
      rect: { x: center.x, y: region.anchor.y + gap, w, h },
      penalty: 5,
    }),
  ];
  {
    const nudges = [
      ['Up', 0, -3],
      ['Down', 0, 3],
      ['NudgeLeft', -3, 0],
      ['NudgeRight', 3, 0],
      ['UpLeft', -3, -3],
      ['UpRight', 3, -3],
      ['DownLeft', -3, 3],
      ['DownRight', 3, 3],
      ['FarUp', 0, -6],
      ['FarDown', 0, 6],
      ['FarLeft', -6, 0],
      ['FarRight', 6, 0],
    ] as const;
    nudges.forEach(([name, dx, dy], index) => {
      candidates.push(decorate({
        slot: `insideCompact${name}`,
        rect: { x: center.x + dx, y: center.y + dy, w, h },
        penalty: 6 + index,
      }));
    });
    candidates.push(
      decorate({
        slot: 'insideCompactLeft',
        rect: { x: region.anchor.x - w - gap, y: center.y, w, h },
        penalty: 18,
      }),
      decorate({
        slot: 'insideCompactRight',
        rect: { x: region.anchor.x + gap, y: center.y, w, h },
        penalty: 19,
      }),
      decorate({
        slot: 'insideCompactAboveLeft',
        rect: { x: region.anchor.x - w - gap, y: region.anchor.y - h - gap, w, h },
        penalty: 20,
      }),
      decorate({
        slot: 'insideCompactAboveRight',
        rect: { x: region.anchor.x + gap, y: region.anchor.y - h - gap, w, h },
        penalty: 21,
      }),
      decorate({
        slot: 'insideCompactBelowLeft',
        rect: { x: region.anchor.x - w - gap, y: region.anchor.y + gap, w, h },
        penalty: 22,
      }),
      decorate({
        slot: 'insideCompactBelowRight',
        rect: { x: region.anchor.x + gap, y: region.anchor.y + gap, w, h },
        penalty: 23,
      }),
    );
  }
  return candidates;
}

function regionLabelRequest(
  region: FittedGeoRegion,
  text: string,
  font: FontSpec,
  priority: number,
  candidates: LabelRequest['candidates'],
): LabelRequest {
  return {
    id: `category:${region.id}`,
    kind: 'category', typeRole: 'label',
    owner: { categoryId: region.id },
    text,
    lines: [text],
    font,
    priority,
    candidates,
  };
}

// Fits of one frame share their polygons (geo/decode), and a layout draws the same frame several
// times, so a region's path, fill strips and raster hatch are kept with its polygons. Each is a
// pure function of the polygons.
const regionPaths = new WeakMap<GeoPoint[][][], string>();
const regionStrips = new WeakMap<GeoPoint[][][], Rect[]>();
const regionHatches = new WeakMap<GeoPoint[][][], HatchSegment[]>();

function polygonsPath(polygons: GeoPoint[][][]): string {
  let d = regionPaths.get(polygons);
  if (d === undefined) regionPaths.set(polygons, d = polygonsPathOf(polygons));
  return d;
}

function polygonsPathOf(polygons: GeoPoint[][][]): string {
  let path = '';
  polygons.forEach((polygon) => polygon.forEach((ring) => {
    if (ring.length === 0) return;
    path += `M${coord(ring[0]!)}`;
    for (let i = 1; i < ring.length; i++) if (i in ring) path += `L${coord(ring[i]!)}`;
    path += 'Z';
  }));
  return path;
}

/**
 * `radius` is the marker's PAINTED extent — what the pack spaces micro-states
 * by and what `claimRegionMark` reserves. The outline is centred on the path,
 * so the path itself must be drawn half a stroke smaller; otherwise two markers
 * whose centres are further apart than the sum of their radii still touch in
 * ink (world pack GU/MP: centres 6.446pt apart, radii 6.180pt, painted disks
 * 6.830pt). The guarantee is about ink, not about geometric radius.
 */
function markerPath(cx: number, cy: number, radius: number, strokeWidth: number): string {
  const r = round2(Math.max(radius - strokeWidth / 2, strokeWidth / 2));
  return (
    `M${coord([cx - r, cy])}` +
    `A${r},${r} 0 1 0 ${coord([cx + r, cy])}` +
    `A${r},${r} 0 1 0 ${coord([cx - r, cy])}Z`
  );
}

function boundaryPath(boundary: FittedGeoBoundary): string {
  return boundary.lines.map((line) => polylinePath(line)).join('');
}

/** The one diagonal tick that stands in for a full hatch — same slope as the
 *  x+y=const hatch diagonals, centred on the anchor. */
function minimumHatchTick(anchor: { x: number; y: number }, radius: number): HatchSegment[] {
  return [{
    a: [anchor.x - radius, anchor.y + radius],
    b: [anchor.x + radius, anchor.y - radius],
  }];
}

/** Read-only: regions of one fitted frame share their raster hatch. */
function hatchSegments(region: FittedGeoRegion, strokeWidth: number): HatchSegment[] {
  if (region.polygons.length === 0) {
    // Marker-only regions obey the same contained-ink rule with the painted
    // marker disc as the budget. r = sqrt((R^2-0.25)/2)
    // keeps the 1px-stroke tick inside a disc of radius R; below R = 0.75
    // no visible ink fits and the marker itself carries the no-data state.
    const markerRadius = region.marker?.radius ?? 2.5;
    if (markerRadius < Math.max(0.75, strokeWidth / 2)) return [];
    // The budget is the SERIALIZED disc: markerPath draws its circle at
    // radius - stroke/2 (paint lands back on the nominal radius), so the
    // tick fits the strictest standard — centreline within the path disc,
    // sqrt(2)*r <= pathR — which implies painted-within-painted too. The
    // serialization eps covers two-decimal path rounding.
    const pathRadius = Math.max(markerRadius - strokeWidth / 2, strokeWidth / 2);
    return minimumHatchTick(
      // centre on the DISC, not the anchor — the two can differ by a
      // fraction of a pixel and the budget is the disc.
      { x: region.marker?.x ?? region.anchor.x, y: region.marker?.y ?? region.anchor.y },
      Math.min(pathRadius / Math.SQRT2 - TICK_SERIALIZATION_EPS, HATCH_STEP / 2),
    );
  }
  // Contained-ink gate FIRST, for every path: the anchor clearance is the
  // largest inscribed radius, so clearance < 0.75 means the region is
  // thinner than a 1px stroke plus visible core EVERYWHERE — raster chords
  // of such a region leak into its neighbours. No contained ink is possible,
  // so none is emitted. Large regions pass untouched; their raster
  // half-stroke edge is a known limitation.
  if (region.anchor.clearance < Math.max(0.75, strokeWidth / 2)) return [];
  let segments = regionHatches.get(region.polygons);
  if (!segments) regionHatches.set(region.polygons, segments = polygonHatchSegments(region.polygons, boundsOfPolygons(region.polygons)));
  if (segments.length > 0) return segments;
  // A polygon smaller than the hatch raster (eu27 Malta) intersects no
  // diagonal, yet the a11y desc claims hatched no-data geometry for every
  // visible region. The desc's claim is the contract, so the region still
  // gets one diagonal tick through its anchor, and no-data ink never
  // crosses into a neighbour that HAS data.
  // Containment is PROVABLE only for anchor-centred ink: the clearance is by
  // definition the anchor's distance to the nearest boundary, so any painted
  // point within `clearance` of the anchor is inside the region. Chord
  // fallbacks cannot make that promise — their endpoints sit ON the boundary
  // and the 1px stroke paints past every inset that only follows the chord
  // direction. A butt-capped tick with half-length r·√2 and
  // a 1px stroke paints no farther than √(2r²+0.25) from the anchor, so
  // r = √((c²−0.25)/2) is the largest contained radius. Below c = 0.75 that
  // radius drops under 0.25px — no visible ink can be contained, so NO ink
  // is emitted: the near-region label chip marks the region and the a11y
  // desc says so instead of claiming a hatch that would have to lie.
  const clearance = region.anchor.clearance;
  if (clearance < Math.max(0.75, strokeWidth / 2)) return [];
  return minimumHatchTick(
    region.anchor,
    // Same two-decimal serialization reserve as the marker tick.
    Math.min(
      Math.sqrt((clearance * clearance - (strokeWidth / 2) ** 2) / 2) - TICK_SERIALIZATION_EPS,
      HATCH_STEP / 2,
    ),
  );
}

/** Two-decimal path serialization can move a tick endpoint by 0.005*sqrt(2);
 *  the radius reserves double that so the PAINTED reach stays inside the
 *  budget after rounding. */
const TICK_SERIALIZATION_EPS = 0.015;

function polygonHatchSegments(
  polygons: FittedGeoRegion['polygons'],
  bounds: [number, number, number, number],
): HatchSegment[] {
  const segments: HatchSegment[] = [];
  const start = Math.floor((bounds[0] + bounds[1]) / HATCH_STEP) * HATCH_STEP;
  const end = bounds[2] + bounds[3];
  for (let diagonal = start; diagonal <= end; diagonal += HATCH_STEP) {
    pushAll(segments, diagonalChords(polygons, diagonal));
  }
  return segments;
}

/** The chords of one x+y=diagonal line inside the polygons — hatch ink is
 *  inside the region by construction, for raster lines and the minimum-tick
 *  fallback alike. */
function diagonalChords(
  polygons: FittedGeoRegion['polygons'],
  diagonal: number,
): HatchSegment[] {
  const segments: HatchSegment[] = [];
  for (const polygon of polygons) {
    const intersections: GeoPoint[] = [];
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!;
        const b = ring[i]!;
        const fa = a[0] + a[1] - diagonal;
        const fb = b[0] + b[1] - diagonal;
        if ((fa <= 0 && fb > 0) || (fb <= 0 && fa > 0)) {
          const t = fa / (fa - fb);
          intersections.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
    }
    intersections.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      segments.push({ a: intersections[i]!, b: intersections[i + 1]! });
    }
  }
  return segments;
}

function segmentsPath(segments: HatchSegment[]): string {
  return segments.map((segment) => `M${coord(segment.a)}L${coord(segment.b)}`).join('');
}

function claimPolygonFill(
  polygons: GeoPoint[][][],
  occupied: OccupiedIndex,
  regionId: string,
): void {
  let strips = regionStrips.get(polygons);
  if (!strips) regionStrips.set(polygons, strips = polygonFillStrips(polygons));
  for (const strip of strips) occupied.claim(strip, 'mark', { categoryId: regionId }, 'region');
}

/** The CLAIM_STEP strips that cover the polygons, in claim order. */
function polygonFillStrips(polygons: GeoPoint[][][]): Rect[] {
  const strips: Rect[] = [];
  for (const polygon of polygons) {
    const bounds = boundsOfPolygons([polygon]);
    const firstY = Math.floor(bounds[1] / CLAIM_STEP) * CLAIM_STEP + CLAIM_STEP / 2;
    const rows: number[] = [];
    for (let y = firstY; y <= bounds[3]; y += CLAIM_STEP) rows.push(y);
    // Each edge goes to the rows it crosses, [low y, high y), in ring and edge order, so a row
    // reads only its own edges and sorts the same crossings in the same order as a scan of all.
    const crossing: GeoPoint[][] = rows.map(() => []);
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!;
        const b = ring[i]!;
        const low = Math.min(a[1], b[1]);
        const high = Math.max(a[1], b[1]);
        if (!(low < high)) continue;
        let lo = 0;
        let hi = rows.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (rows[mid]! < low) lo = mid + 1;
          else hi = mid;
        }
        for (let row = lo; row < rows.length && rows[row]! < high; row++) crossing[row]!.push(a, b);
      }
    }
    for (let row = 0; row < rows.length; row++) {
      const y = rows[row]!;
      const edges = crossing[row]!;
      const intersections: number[] = [];
      for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i]!;
        const b = edges[i + 1]!;
        const t = (y - a[1]) / (b[1] - a[1]);
        intersections.push(a[0] + t * (b[0] - a[0]));
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const x1 = intersections[i]!;
        const x2 = intersections[i + 1]!;
        strips.push({ x: x1, y: y - CLAIM_STEP / 2, w: Math.max(0.5, x2 - x1), h: CLAIM_STEP });
      }
    }
  }
  return strips;
}

function claimRegionMark(region: FittedGeoRegion, occupied: OccupiedIndex): void {
  if (region.polygons.length > 0) {
    claimPolygonFill(region.polygons, occupied, region.id);
    return;
  }
  const marker = region.marker ?? {
    x: region.anchor.x,
    y: region.anchor.y,
    radius: 2.5,
  };
  occupied.claim(
    {
      x: marker.x - marker.radius,
      y: marker.y - marker.radius,
      w: marker.radius * 2,
      h: marker.radius * 2,
    },
    'mark',
    { categoryId: region.id },
    'region',
  );
}

function claimHatchSegments(
  segments: HatchSegment[],
  occupied: OccupiedIndex,
  regionId: string,
): void {
  for (const segment of segments) claimSegment(segment, occupied, regionId, 'noDataHatch');
}

function claimSegment(
  segment: HatchSegment,
  occupied: OccupiedIndex,
  regionId: string,
  part: string,
): void {
  claimOwnedSegment(segment, occupied, { categoryId: regionId }, part);
}

function claimOwnedSegment(
  segment: HatchSegment,
  occupied: OccupiedIndex,
  owner: OwnerRef,
  part: string,
): void {
  const dx = segment.b[0] - segment.a[0];
  const dy = segment.b[1] - segment.a[1];
  const slices = Math.max(1, Math.ceil(Math.hypot(dx, dy) / CLAIM_STEP));
  for (let index = 0; index < slices; index++) {
    const t1 = index / slices;
    const t2 = (index + 1) / slices;
    const a: GeoPoint = [segment.a[0] + dx * t1, segment.a[1] + dy * t1];
    const b: GeoPoint = [segment.a[0] + dx * t2, segment.a[1] + dy * t2];
    occupied.claim(
      {
        x: Math.min(a[0], b[0]) - 0.6,
        y: Math.min(a[1], b[1]) - 0.6,
        w: Math.abs(b[0] - a[0]) + 1.2,
        h: Math.abs(b[1] - a[1]) + 1.2,
      },
      'mark',
      owner,
      part,
    );
  }
}

function claimBoundaryMark(
  boundary: FittedGeoBoundary,
  occupied: OccupiedIndex,
): void {
  for (const line of boundary.lines) {
    for (let index = 1; index < line.length; index++) {
      claimOwnedSegment(
        { a: line[index - 1]!, b: line[index]! },
        occupied,
        {},
        'disputedBoundary',
      );
    }
  }
}

function leaderTarget(from: GeoPoint, rect: Rect): GeoPoint {
  return [
    from[0] <= rect.x ? rect.x : rect.x + rect.w,
    rect.y + rect.h / 2,
  ];
}

function leaderPolyline(from: GeoPoint, to: GeoPoint): GeoPoint[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) <= 8 || Math.abs(dy) <= 8) return [from, to];
  const midpointX = from[0] + dx / 2;
  return Array.from({ length: 13 }, (_, index) => {
    const t = index / 12;
    const inv = 1 - t;
    return [
      inv ** 3 * from[0] +
        3 * inv ** 2 * t * midpointX +
        3 * inv * t ** 2 * midpointX +
        t ** 3 * to[0],
      inv ** 3 * from[1] +
        3 * inv ** 2 * t * from[1] +
        3 * inv * t ** 2 * to[1] +
        t ** 3 * to[1],
    ];
  });
}

function claimLeader(
  from: GeoPoint,
  to: GeoPoint,
  occupied: OccupiedIndex,
  regionId: string,
): void {
  const points = leaderPolyline(from, to);
  for (let index = 1; index < points.length; index++) {
    claimSegment(
      { a: points[index - 1]!, b: points[index]! },
      occupied,
      regionId,
      'regionLeader',
    );
  }
}

function boundsOfPolygons(polygons: GeoPoint[][][]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const point of ring) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

function nearestRegionId(
  input: string,
  candidates: string[],
  canonical: ReadonlyMap<string, string>,
): string | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(input.toUpperCase(), candidate.toUpperCase());
    if (!best || distance < best.distance || (distance === best.distance && candidate < best.id)) {
      best = { id: candidate, distance };
    }
  }
  if (!best || best.distance > Math.max(2, Math.floor(input.length / 2))) return undefined;
  return canonical.get(best.id);
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** The drawn length of a leader path through its points (control points of a curve count as corners). */
function pathLength(d: string): number {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let length = 0;
  for (let index = 2; index + 1 < numbers.length; index += 2) {
    length += Math.hypot(numbers[index]! - numbers[index - 2]!, numbers[index + 1]! - numbers[index - 1]!);
  }
  return length;
}

/** Each region's place by absolute value, highest first; regions without a value follow. */
function valueRanks(valuesById: ReadonlyMap<string, number | null>): Map<string, number> {
  return new Map([...valuesById]
    .flatMap(([id, value]) => (value === null ? [] : [{ id, value }]))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || compareText(a.id, b.id))
    .map(({ id }, index) => [id, index]));
}

function polygonsArea(polygons: GeoPoint[][][]): number {
  return polygons.reduce((total, polygon) => total + polygon.reduce((sum, ring, index) => {
    let twice = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      twice += a[0] * b[1] - b[0] * a[1];
    }
    return sum + (index === 0 ? 1 : -1) * Math.abs(twice) / 2;
  }, 0), 0);
}

/** Where a callout's leader stops: the label box's nearest point, 2 px short of it. */
function calloutTerminus(from: GeoPoint, rect: Rect): GeoPoint {
  const box = { x: rect.x - 2, y: rect.y - 2, w: rect.w + 4, h: rect.h + 4 };
  return [Math.max(box.x, Math.min(from[0], box.x + box.w)), Math.max(box.y, Math.min(from[1], box.y + box.h))];
}

/**
 * The seats of a callout. In each of CALLOUT_DIRECTIONS directions the
 * label walks out from the anchor to the first spot that is free (off every
 * region and label) inside the plot. A seat whose leader crosses a label,
 * another leader or a foreign region is dropped. The label must be nearest
 * its own region. A leader beyond CALLOUT_MAX_LEADER costs more, so a
 * nearby free side wins before the region moves to the value list.
 */
function calloutCandidates(
  region: FittedGeoRegion,
  text: string,
  font: FontSpec,
  measure: typeof defaultMeasurer,
  occupied: OccupiedIndex,
  plot: Rect,
  outsideFits: ReturnType<typeof outsideLabelGuard>,
): LabelRequest['candidates'] {
  const w = measure(text, font).width;
  const h = font.size * (font.lineHeight ?? 1.2);
  const from: GeoPoint = [region.anchor.x, region.anchor.y];
  const candidates: LabelRequest['candidates'] = [];
  // The claim that blocked the last seat tried. The next seat out often meets
  // it again, and a box it meets is taken whatever else is near (a measure
  // runs this search some 15,000 times).
  let blocker: OccupiedClaim | undefined;
  const taken = (claim: OccupiedClaim) => { blocker = claim; return false; };
  for (let k = 0; k < CALLOUT_DIRECTIONS; k++) {
    const angle = (2 * Math.PI * k) / CALLOUT_DIRECTIONS;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const reach = Math.abs(dx) * (w / 2) + Math.abs(dy) * (h / 2);
    for (let d = Math.max(2, region.anchor.clearance); d <= 2 * CALLOUT_MAX_LEADER; d += Math.max(CALLOUT_STEP, d / 8)) {
      const rect = { x: from[0] + dx * (d + reach) - w / 2, y: from[1] + dy * (d + reach) - h / 2, w, h };
      if (rect.x < plot.x || rect.y < plot.y || rect.x + rect.w > plot.x + plot.w || rect.y + rect.h > plot.y + plot.h) break;
      if (blocker && !blocker.polygon && rectsOverlap(blocker.rect, rect, 2)) continue;
      if (occupied.hits(rect, 2, taken)) continue;
      if (!text.includes(' ') && occupied.hitsWhich(rect, 8).some(claim => claim.kind === 'label' && boxGap(rect, claim.rect) < 8 &&
        Math.abs(rect.y + h / 2 - claim.rect.y - claim.rect.h / 2) < Math.min(h, claim.rect.h) / 2)) continue;
      const to = calloutTerminus(from, rect);
      if (!outsideFits(region.id, rect, from, to)) break;
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      let crossesLabel = false;
      const samples = Math.max(1, Math.ceil(length / 3));
      // The leader is sampled every 3 px. Its padded box contains every sample.
      // Only a label or leader ends the query; visiting the claims in cell order
      // avoids collecting and sorting them. The outline guard checked regions.
      occupied.hits(
        { x: Math.min(from[0], to[0]) - 0.5, y: Math.min(from[1], to[1]) - 0.5, w: Math.abs(to[0] - from[0]) + 1, h: Math.abs(to[1] - from[1]) + 1 },
        1,
        (claim) => {
          if (claim.kind !== 'label' && claim.part !== 'regionLeader') return true;
          // Only the samples near the claim can meet it; one sample of slack on each side.
          const [x0, x1] = sampleSpan(from[0], to[0] - from[0], samples, claim.rect.x, claim.rect.x + claim.rect.w);
          const [y0, y1] = sampleSpan(from[1], to[1] - from[1], samples, claim.rect.y, claim.rect.y + claim.rect.h);
          for (let i = Math.max(x0, y0); i <= Math.min(x1, y1); i++) {
            const x = from[0] + ((to[0] - from[0]) * i) / samples;
            const y = from[1] + ((to[1] - from[1]) * i) / samples;
            const box = { x: x - 0.5, y: y - 0.5, w: 1, h: 1 };
            if (!rectsOverlap(claim.rect, box, 0) || (claim.polygon !== undefined && !rectHitsConvexPolygon(box, claim.polygon, 0))) continue;
            crossesLabel = true;
            break;
          }
          return !crossesLabel;
        },
      );
      if (!crossesLabel) {
        candidates.push({
          slot: `callout${k}`,
          rect,
          penalty: Math.round(length + (length > CALLOUT_MAX_LEADER ? 1000 : 0)),
        });
      }
      break;
    }
  }
  return candidates.sort((a, b) => a.penalty - b.penalty || compareText(a.slot, b.slot));
}

/** The sample indices 0..samples whose 1 px box can meet [lo, hi] on one axis, widened by one sample each side. */
function sampleSpan(start: number, delta: number, samples: number, lo: number, hi: number): [number, number] {
  if (delta === 0) return [0, samples];
  const a = ((lo - 0.5 - start) * samples) / delta;
  const b = ((hi + 0.5 - start) * samples) / delta;
  return [Math.max(0, Math.floor(Math.min(a, b)) - 1), Math.min(samples, Math.ceil(Math.max(a, b)) + 1)];
}

function coord(point: GeoPoint): string {
  return `${round2(point[0])},${round2(point[1])}`;
}
