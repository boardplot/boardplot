import { staticFrame } from '../../footer';
import { chartTheme } from '../chartEnv';
import { chartString } from '../../strings/tilemap';
import { structureCount } from '../../structureCounts';
import { authoredNotes, DEFAULT_NOTE_LIMIT, valueNoteLine, frameTextOptions, settledAutoHeight, legendRequired, noteCap, noteLine, solveFrame, type FrameResult, type LegendItemInput, type NoteCapOptions } from '../../frame';
import { formatAutomaticNumber } from '../../format';
import { formatterFromExample } from '../../formatSpec';
import type { Rect } from '../../geometry';
// By name, not through the '../../geo' barrel, for the reason choropleth/layout.ts gives.
import { projectGeoLonLat } from '../../geo/project';
import { geoRegionIdIndex, resolveGeoRegionId } from '../../geo/resolveRegionId';
import { getTilePack, type TileRegionRecord } from '../../geo/tiles';
import type { GeoPackId } from '../../geo/types';
import { getGeoPack } from '../../geo/packs/registry';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { resolveSizing, sizeRefusal, plotFloorHeight, SIZE_TOLERANCE } from '../../sizing';
import { readerFloorPx } from '../../typeFloors';
import { rowDrivenHeight, tallestContentHeight } from '../../rowCanvas';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SolveCtx,
  type SolveResult,
} from '../../label/solver';
import { EMPTY_DATA } from '../../emptyData';
import { accessibleTitle, NormalizeError, resolveSize } from '../../normalize/shared';
import { defaultMeasurer, type FontSpec } from '../../text';
import { strokeToken, canvasMargin, emphasisWeight, paintColor, panelTypeClass, resolveSemanticPaletteTheme, spaceTokens } from '../../theme';
import type { RenderTarget } from '../../types/options';
import type { LayoutResult, LintWarning, Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { TILEMAP_SIZING } from './sizing';
import type {
  TilemapData,
  TilemapDerived,
  TilemapMarks,
  TilemapOptions,
} from './types';
import { buildGeoScale, decimalsOf, geoLabelFont, ingestGeoRegions, type ScaleModel, geoStatePattern, geoStateLabel, geoStateLegend, geoStateSummary, geoStateCounts, geoScaleHints } from '../geoScale';
import { autoDecimals } from '../../formatPrecision';
import { compareText } from '../../text';
import { geoOverlayDiameter, geoOverlayLegend, renderGeoOverlays, reserveGeoOverlayGlyphs } from '../choropleth/overlays';
import type { GeoOverlay } from '../choropleth/overlayTypes';
import { geoOptionRefusals } from '../choropleth/geoRefusals';
import { copyNote, disclosureNote, engineNoteMeta, keepNoteMeta } from '../../notes';
import { maxOf, minOf, pushAll } from '../../arrays';

interface TileLabelVariant {
  request: LabelRequest;
  font: FontSpec;
}

interface TileLabelPlan {
  id: string;
  variants: TileLabelVariant[];
}

type TileLabelSolveResult = SolveResult & {
  fontByLabel: Map<string, FontSpec>;
};

const TILE_GAP = 2;
const GRID_PAD = 4;
const MAX_LAYOUT_PASSES = 32;
const AUTOMATIC_FRAME = Symbol('tilemap.automaticFrame');
/** A pinned height too short for the stepped key draws the one-entry-per-class key instead. */
const SWATCH_KEY = Symbol('tilemap.swatchKey');

interface TilemapPass {
  options: TilemapOptions;
  listed?: ReadonlySet<string>;
  run?: number;
  omitted?: ReadonlySet<string>;
  heights?: Map<number, number>;
  fixedHeight?: boolean;
  /** The automatic height stopped on a repeated height; the frame is not pinned. */
  stopped?: boolean;
  /** The tiles print codes alone; a note names the value leads and counts the rest above DEFAULT_NOTE_LIMIT. */
  valuesNoted?: boolean;
  /** The tile size under the stepped key, while a pinned canvas tries the swatch key instead. */
  steppedTile?: number;
  /** The swatch key left smaller tiles than the stepped key: keep the stepped key. */
  keepStepped?: true;
}

export function layoutTilemap(
  data: TilemapData,
  options: TilemapOptions = {},
  /** Overlays whose text an earlier pass could not seat off the other tiles; listed in a note. */
  listed?: ReadonlySet<string>,
  run = 0,
  omitted: ReadonlySet<string> = new Set(),
): LayoutResult<TilemapMarks, TilemapDerived> {
  const constraints = (options as TargetSizeOptions)[TARGET_SIZE] as
    (NonNullable<TargetSizeOptions[typeof TARGET_SIZE]> & { [AUTOMATIC_FRAME]?: { width: number; height: number } }) | undefined;
  const size = resolveSize(options.size);
  // A right key can change width when overlay entries drop. Keep its first
  // automatic frame separate from fixed repair probes at the same width.
  const rightKey = options.legend === 'right' || (typeof options.legend === 'object' && options.legend.position === 'right');
  if (rightKey && data.overlays?.length && constraints && !constraints.fixed.height && size.width === constraints.sizePx.width) constraints[AUTOMATIC_FRAME] ??= size;
  const automaticFrame = constraints?.[AUTOMATIC_FRAME];
  const fixedHeight = constraints?.fixed.height || (constraints !== undefined
    && (size.width !== constraints.sizePx.width || (automaticFrame !== undefined && size.height !== automaticFrame.height)))
    || (constraints === undefined && options.size !== undefined);
  if (fixedHeight && constraints) constraints.fixed.height = true;
  let pass: TilemapPass = { options, listed, run, omitted, fixedHeight };
  for (let attempt = 0; ; attempt++) {
    const result = layoutTilemapPass(data, pass, attempt === MAX_LAYOUT_PASSES);
    if ('type' in result) return result;
    pass = result;
  }
}

/** Height and note passes must not grow the call stack. */
function layoutTilemapPass(
  data: TilemapData,
  { options, listed, run = 0, omitted = new Set(), heights = new Map(), fixedHeight = false, stopped = false, valuesNoted = false, steppedTile, keepStepped }: TilemapPass,
  exhausted: boolean,
): LayoutResult<TilemapMarks, TilemapDerived> | TilemapPass {
  // What the schema refuses, refused here for the React entry.
  const warnings: LintWarning[] = geoOptionRefusals(options, 'tilemap');

  // Zero listed regions would draw a map of "no data" tiles, which shows nothing (the schema says the same).
  if (!data.regions.length) throw new NormalizeError(EMPTY_DATA, 'regions', 'tilemap requires at least one region', 'add regions[].id and value');
  const pack = getTilePack(data.pack);
  const idIndex = geoRegionIdIndex(pack.regions);
  const { valuesById, statesById } = ingestGeoRegions(data.regions, idIndex, { where: `tile pack '${pack.id}'`, regionWord: 'tile-pack region' }, warnings, (id, index) => {
    throw new NormalizeError('tilemap-unknown-region', `regions[${index}].id`, `region '${id}' is not present in tile pack '${pack.id}'`);
  });

  const theme = resolveSemanticPaletteTheme(
    chartTheme(options),
    options.palette,
    warnings,
  );
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language)
    : (value: number) => formatAutomaticNumber(value, { locale: options.locale?.language, decimals: autoDecimals(value) });
  const numericValues = [...valuesById.values()].filter((value): value is number => value !== null);
  if (numericValues.length === 0) {
    warnings.push({
      code: 'tilemap-no-values',
      severity: 'info',
      message: `tile pack '${pack.id}' has no numeric observations; all ${pack.regions.length} tiles render as no data`,
    });
  }
  /**
   * Same listed-null predicate the tile loop uses
   * over the same population, so the `No data` key exists exactly when a
   * hatched tile does; choropleth/layout.ts does the same. All three tilemap
   * FIXTURES carry a no-data region, so the fixture sweep alone does not cover
   * a map with complete data, where a hatched chip would name no tile.
   */
  const hasNoDataRegion = pack.regions.some(
    (region) => valuesById.has(region.id) && valuesById.get(region.id) === null && !statesById.has(region.id),
  );
  const scale = buildGeoScale(numericValues, options, fmt, hasNoDataRegion, theme, { token: 'neutral' });
  // The tilemap names the hatched key entry "No data"; the choropleth keeps its own words.
  scale.legend.forEach((item, i) => { if (item.id === 'no-data') scale.legend[i] = { ...item, label: chartString(options, 'tilemapNoData') }; });
  pushAll(scale.legend, geoStateLegend(statesById.values(), options));
  if (pack.regions.some((region) => !valuesById.has(region.id))) scale.legend.push({
    id: 'not-in-data', label: chartString(options, 'notInData'), paint: { token: 'inkMuted' }, pattern: 'outline', hollow: true,
  });
  warnings.push(...geoScaleHints(numericValues, options, fmt));
  const legendOptions = legendRequired(options.legend, warnings, 'tilemap', theme);
  // The classed key of a sequential scale is one stepped bar with each break
  // printed once under it; the frame keeps the other key entries.
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  const key = !(options as { [SWATCH_KEY]?: true })[SWATCH_KEY] && legendOptions.position === 'top' && scale.edges !== undefined
    && (options.scale?.kind ?? 'sequential') === 'sequential' && panelTypeClass(options) === undefined
    ? planSteppedKey(scale, margin.left, size.width - margin.left - margin.right, spaceTokens(theme, size.width).gapLegend, theme, options.target!, measure, fmt)
    : undefined;
  const userSource = options.source ? chartString(options, 'userSourceClause', { v1: options.source }) : '';
  // Fit the occupied lattice, excluding any empty edge rows or columns.
  const rowMin = minOf(pack.regions.map((region) => region.row));
  const colMin = minOf(pack.regions.map((region) => region.col));
  const rows = maxOf(pack.regions.map((region) => region.row)) - rowMin + 1;
  const cols = maxOf(pack.regions.map((region) => region.col)) - colMin + 1;
  const omissionLines = valueNoteLine(chartString(options, 'notPrintedTiles'), [...omitted].map(id => {
    const region = pack.regions.find(region => region.id === id)!;
    const value = valuesById.get(id);
    const state = statesById.get(id);
    return `${region.id} ${state ? geoStateLabel(state, options) : value != null ? fmt(value) : valuesById.has(id) ? chartString(options, 'valueMissing') : chartString(options, 'notInData')}`;
  }), options);
  // Tiles too small for their values print codes alone. The note names the leads (the
  // extremes and any value the title or subtitle names) and, above DEFAULT_NOTE_LIMIT,
  // counts the rest; the reading lists every value.
  const valueEntries = pack.regions.flatMap((region) => {
    const value = valuesById.get(region.id);
    return value != null && !statesById.has(region.id) ? [{ id: region.id, name: region.name, value, text: `${region.id} ${fmt(value)}` }] : [];
  });
  const valueLines = valuesNoted ? tileValueNote(valueEntries, options) : [];
  if (valueLines.length) pushAll(omissionLines, valueLines);
  // Fixed canvases and right keys keep their accepted tile area.
  // The note-list fallback records omissions without taking tile space.
  const rightKey = options.legend === 'right' || (typeof options.legend === 'object' && options.legend.position === 'right');
  // A stopped automatic height is not a pinned frame. Its note stays in the
  // frame, so the reported floor holds the note the static footer prints.
  const listOmissions = !staticFrame.pinned && ((fixedHeight && !stopped) || rightKey || panelTypeClass(options) !== undefined);
  let drawableOverlays = data.overlays ?? [];
  const layoutFrame = () => {
    const overlayLegend = geoOverlayLegend(drawableOverlays, options.overlayTones, options.overlayMeasure, drawableOverlays, options);
    const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
    const frameResult = solveFrame(
      {
        size,
        margin,
        ...frameTextOptions(options),
        // Only drawn glyphs can have a key or a label in the tile note.
        footnotes: [...overlayNote(drawableOverlays, listed, pack, idIndex, options), ...codeLookup(options, pack),
          ...(listOmissions ? [] : omissionLines), ...authoredNotes(options)],
        // Footer rule: the tile layout is Boardplot's own, drawn from pinned anchors, so it
        // needs no credit line. The short credit ends the source line,
        // "Source: … · Tile layout: Boardplot, after Natural Earth"; the full attribution
        // stays in the reading and in derived.pack.attribution.
        source: options.source ? `${options.source} · ${tileCreditShort(pack.meta.attribution, options)}` : tileCreditShort(pack.meta.attribution, options),
        legend: { options: legendOptions, items: [...scale.legend.filter((item) => !key?.owns.has(item.id)), ...overlayLegend.items] },
        theme,
        measure,
      },
      occupied,
    );
    if (listOmissions && omissionLines.length) {
      frameResult.frame.notes = [...(frameResult.frame.notes ?? []), ...omissionLines];
      frameResult.frame.noteList = [...(frameResult.frame.noteList ?? []),
        ...omissionLines.map(text => keepNoteMeta({ n: 0, kind: 'disclosure' as const, text, inFrame: false }, engineNoteMeta(text)))]
        .map((note, i) => copyNote(note, { n: i + 1 }));
    }
    // The stepped key takes a band above the plot, as the frame's own key row would.
    if (key) {
      const plot = frameResult.plot;
      frameResult.plot = { ...plot, y: plot.y + key.band, h: Math.max(1, plot.h - key.band) };
      frameResult.frame.plotRect = { ...frameResult.plot };
    }
    const available: Rect = {
      x: frameResult.plot.x + GRID_PAD,
      y: frameResult.plot.y + GRID_PAD,
      w: Math.max(1, frameResult.plot.w - GRID_PAD * 2),
      h: Math.max(1, frameResult.plot.h - GRID_PAD * 2),
    };
    const tileSize = Math.max(1, Math.min(
      (available.w - (cols - 1) * TILE_GAP) / cols,
      (available.h - (rows - 1) * TILE_GAP) / rows,
    ));
    return { overlayLegend, occupied, frameResult, available, tileSize };
  };
  let frame = layoutFrame();
  const constraints = (options as TargetSizeOptions)[TARGET_SIZE];
  const automaticHeight = !fixedHeight && panelTypeClass(options) === undefined
    && (constraints?.fixed.height === false || options.size === undefined);
  const fullGridHeight = () => rows * Math.max(1, (frame.available.w - (cols - 1) * TILE_GAP) / cols) + (rows - 1) * TILE_GAP;
  // A right key's minimum frame can exceed the lattice height.
  // Rounded to 1/1000 px first: the chrome sum carries float noise, and a
  // ceiling over it would move the natural height by 1 px between passes.
  const naturalHeight = () => Math.ceil(Math.round(Math.max(TILEMAP_SIZING.minHeight, size.height - frame.available.h + fullGridHeight(),
    rightKey ? frame.frameResult.frame.minHeight ?? 0 : 0) * 1000) / 1000);
  // A pinned canvas never refuses for the stepped key alone: where it is too
  // short for the key's tick row, the swatch list takes its place. The list
  // can wrap to more rows than the stepped bar takes; it stays only where its tiles are larger.
  if (key && fixedHeight && !keepStepped && size.height + SIZE_TOLERANCE < naturalHeight()) {
    return { options: { ...options, [SWATCH_KEY]: true } as TilemapOptions, listed, run, omitted, heights, fixedHeight, stopped, valuesNoted, steppedTile: frame.tileSize };
  }
  if (steppedTile !== undefined && frame.tileSize < steppedTile) {
    const { [SWATCH_KEY]: _swatch, ...stepped } = options as TilemapOptions & { [SWATCH_KEY]?: true };
    return { options: stepped, listed, run, omitted, heights, fixedHeight, stopped, valuesNoted, keepStepped: true };
  }
  if (exhausted) {
    // Repair probes must use the advised fixed height.
    if (constraints) constraints.fixed.height = true;
    // Include the frame deficit: a very long title can exceed the current
    // canvas by much more than the last automatic-height step.
    const frameHeight = Math.ceil(Math.max(naturalHeight(),
      (frame.frameResult.frame.minHeight ?? size.height) + fullGridHeight()));
    const minHeight = plotFloorHeight({ size: { ...size, height: frameHeight },
      plot: { ...frame.frameResult.plot, h: fullGridHeight() } }, options.target!);
    return sizeRefusal('tilemap', 'Tile-grid map', size,
      resolveSizing(TILEMAP_SIZING, size, { minHeight, naturalHeight: minHeight }));
  }
  const fittingOverlays = (tileSize: number) => drawableOverlays.filter((overlay, index) => {
    const regionId = resolveTilemapOverlayRegion(overlay, index, pack.id, idIndex);
    const minimum = geoOverlayDiameter(overlay) + 4;
    if (tileSize >= minimum) return true;
    warnings.push({ code: 'geo-overlay-no-space', severity: 'warn',
      message: `overlay '${overlay.id}' omitted: region '${regionId}' needs a tile at least ${minimum}px wide and high to contain its glyph`,
      suggest: 'give the tile map more room or use a smaller overlay size' });
    return false;
  });
  for (;;) {
    if (automaticHeight && rightKey) {
      // More height cannot fit a glyph wider than the width-limited tile.
      // Drop its key entry before it sets the automatic frame height.
      const fitting = fittingOverlays((frame.available.w - (cols - 1) * TILE_GAP) / cols);
      if (fitting.length !== drawableOverlays.length) {
        drawableOverlays = fitting;
        frame = layoutFrame();
        continue;
      }
    }
    const nextHeight = naturalHeight();
    const repeated = heights.has(nextHeight);
    if (automaticHeight) heights.set(size.height, nextHeight);
    // reserve the full-width lattice before omission notes consume its space.
    if (automaticHeight && (Math.abs(nextHeight - size.height) > 1 || (rightKey && nextHeight < size.height))) {
      // A right key can lose and restore overlay entries. End that height cycle;
      // repair probes must then test their exact height, without automatic growth.
      if (repeated && constraints) constraints.fixed.height = true;
      // Stop at the smallest recorded frame that holds its natural height.
      const fittingHeights = [...heights].filter(([height, natural]) => natural <= height + 1).map(([height]) => height);
      const stoppedHeight = fittingHeights.length ? Math.min(...fittingHeights) : Math.max(...heights.keys(), nextHeight);
      return {
        options: { ...options, size: { width: size.width, height: repeated ? stoppedHeight : nextHeight } },
        listed, run, omitted, heights, fixedHeight: fixedHeight || repeated, stopped: stopped || (repeated && !fixedHeight), valuesNoted,
      };
    }
    // Keep automatic height growth before deciding which glyphs fit.
    const grow = rowDrivenHeight({
      options, width: size.width, height: size.height,
      chromeH: size.height - frame.available.h,
      rowsH: rows * ((frame.available.w - (cols - 1) * TILE_GAP) / cols) + (rows - 1) * TILE_GAP,
      maxHeight: tallestContentHeight(size.width),
    });
    if (grow !== undefined) return {
      options: { ...options, size: { width: size.width, height: grow } }, listed, run, omitted, heights, fixedHeight, stopped, valuesNoted,
    };
    const fitting = fittingOverlays(frame.tileSize);
    if (fitting.length === drawableOverlays.length) break;
    // Removing key entries can change the frame. Only remove glyphs, so the
    // calculation cannot alternate between two drawable sets.
    drawableOverlays = fitting;
    frame = layoutFrame();
  }
  const { frameResult, occupied, available, tileSize } = frame;
  pushAll(warnings, frame.overlayLegend.warnings);
  const gridW = cols * tileSize + (cols - 1) * TILE_GAP;
  const gridH = rows * tileSize + (rows - 1) * TILE_GAP;
  const gridFrame: Rect = {
    x: available.x + (available.w - gridW) / 2,
    y: available.y + (available.h - gridH) / 2,
    w: gridW,
    h: gridH,
  };

  const nodes: SceneNode[] = [...frameResult.nodes];
  if (key) drawSteppedKey(key, frameResult, occupied, nodes, theme);
  const marks: TilemapMarks = { regions: [] };
  const labelPlans: TileLabelPlan[] = [];
  const labelEnabled = options.labels !== false && options.labels?.category !== false;

  // Unset regionValues prints every value where every value fits its tile
  // under the bold code; otherwise the tiles keep their codes alone.
  const printValues = options.regionValues
    ?? (labelEnabled && valuesFit(pack.regions, valuesById, tileSize, theme, measure, fmt));
  // Values the tiles leave out are named in a note: run again with it, so the frame holds its lines.
  if (!printValues && !valuesNoted && options.regionValues === undefined && labelEnabled && valueEntries.length) {
    return { options, listed, run, omitted, heights: new Map(), fixedHeight, stopped, valuesNoted: true };
  }
  // Codes print bold where every code fits bold, so one map has one weight.
  const boldCodes = codesFitBold(pack.regions, tileSize, theme, measure);
  for (const region of pack.regions) {
    const value = valuesById.get(region.id) ?? null;
    const unlisted = !valuesById.has(region.id);
    const state = statesById.get(region.id);
    const noData = !unlisted && value === null && !state;
    const rect = {
      x: gridFrame.x + (region.col - colMin) * (tileSize + TILE_GAP),
      y: gridFrame.y + (region.row - rowMin) * (tileSize + TILE_GAP),
      w: tileSize,
      h: tileSize,
    };
    const fill: Paint = state ? { token: 'inkMuted' } : unlisted ? { token: 'background' } : noData ? { token: 'neutral' } : scale.paint(value);
    const labelBackground: Paint = (noData || state) ? { token: 'background' } : fill;
    const nodeId = `tile:${region.id}`;
    const owner = { categoryId: region.id };
    nodes.push({
      t: 'rect',
      id: nodeId,
      rect,
      fill,
      // A 2 px gap in the page colour parts filled tiles; an outline stays on
      // hatched, state and unlisted tiles, whose fill does not carry an edge.
      ...(!unlisted && !noData && !state ? {} : { stroke: { token: 'inkMuted' } as Paint, strokeWidth: strokeToken(theme, 'hair') }),
      ...(state ? { pattern: geoStatePattern(state) } : noData ? { pattern: 'hatch45' as const } : {}),
      owner,
      part: 'tile',
      display: state ? { state: geoStateLabel(state, options) } : unlisted ? { state: chartString(options, 'notInData') } : noData ? { state: chartString(options, 'valueMissing') } : { value: fmt(value!) },
    });
    occupied.claim(rect, 'mark', owner, 'tile');
    marks.regions.push({
      id: region.id,
      // The tile pack's country name, which the card and the accessible text print.
      name: region.name,
      nodeId,
      rect,
      value,
      state: state ?? (unlisted ? 'not-in-data' : noData ? 'no-data' : 'value'),
      fill,
    });
    if (labelEnabled) {
      labelPlans.push(
        tileLabelPlan(region, rect, labelBackground, theme, measure, printValues && value !== null ? fmt(value) : undefined, boldCodes),
      );
    }
  }

  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot: gridFrame,
    labelPad: 0,
  });
  reserveGeoOverlayGlyphs(drawableOverlays,
    (overlay, index) => resolveTilemapOverlayAnchor(overlay, index, pack.id, idIndex, marks.regions), occupied);
  const solved = labelEnabled
    ? solveTileLabels(labelPlans, occupied, solveCtx)
    : { placed: [], decisions: [], warnings: [], fontByLabel: new Map<string, FontSpec>() };
  const labelNodes = labelsToNodes(theme, solved.placed, (label) => solved.fontByLabel.get(label.id)!, nodes);
  pushAll(nodes, centredTileLabels(labelNodes, solved.placed, theme));
  pushAll(warnings, solved.warnings);
  const valueless = options.regionValues
    ? solved.placed.filter((label) => !label.hidden && label.lines?.length === 1 && valuesById.get(label.owner.categoryId!) != null)
    : [];
  // Fixed repairs and stopped height cycles still owe every hidden label. A
  // frame below its floor refuses in the size gate: noting its
  // labels would only add passes to a probe that cannot draw.
  const belowFloor = panelTypeClass(options) === undefined && size.height + SIZE_TOLERANCE < naturalHeight();
  const missing = belowFloor ? [] : solved.placed.filter(label => label.hidden || valueless.includes(label));
  if (missing.some(label => !omitted.has(label.owner.categoryId!))) {
    return { options, listed, run, omitted: new Set([...omitted, ...missing.map(label => label.owner.categoryId!)]), heights, fixedHeight, stopped, valuesNoted };
  }
  const omissionNote = frameResult.frame.noteList?.find(note => note.text.startsWith(`${chartString(options, 'notPrintedTiles')}:`));
  if (omissionNote) {
    const omittedIds = [...omitted];
    for (const label of missing) {
      label.noted = true;
      if (omittedIds.indexOf(label.owner.categoryId!) >= noteCap(options, omittedIds.length)) label.noteCounted = true;
      label.noteLocation = `${chartString(options, 'notPrintedTiles')} (frame.noteList)`;
    }
  }
  if (valueless.length) {
    warnings.push({
      code: 'tilemap-values-dropped',
      severity: 'warn',
      message: `regionValues: ${valueless.length} tile${valueless.length === 1 ? '' : 's'} too small for a value under the code (${valueless.map((label) => label.owner.categoryId).join(', ')}); ${omissionNote ? 'their values are listed in the note' : 'their values show on hover only'}`,
      suggest: 'give the tile map more room, or a shorter format',
    });
  }
  const overlayResult = renderGeoOverlays({ options,
    overlays: drawableOverlays,
    resolveAnchor: (overlay, index) =>
      resolveTilemapOverlayAnchor(overlay, index, pack.id, idIndex, marks.regions),
    occupied,
    solveCtx,
    theme,
    measure,
    // An overlay's text never lies on another tile: it takes a seat beside its
    // glyph off the tiles, or moves to the note.
    ignoredBaseParts: new Set(),
    adjacentOnly: true,
    ...(listed ? { textless: listed } : {}),
  });
  const lost = overlayResult.labels.filter((label) => label.hidden).map((label) => String(label.id).replace(/^overlay:/, ''));
  if (lost.length && run < 3) return {
    options, listed: new Set([...(listed ?? []), ...lost]), run: run + 1, omitted, heights, fixedHeight, stopped, valuesNoted,
  };
  const listedOverlays = drawableOverlays.filter((overlay) => listed?.has(overlay.id)).map((overlay) => overlay.id);
  if (listedOverlays.length) warnings.push({
    code: 'geo-overlay-label-listed', severity: 'warn',
    message: `overlay labels moved to the region-coded note because no adjacent slot fits: ${listedOverlays.join(', ')}`,
    suggest: 'give the tile map more room or shorten the overlay labels',
  });
  pushAll(nodes, overlayResult.nodes);
  pushAll(warnings, overlayResult.warnings);
  if (overlayResult.marks.length) marks.overlays = overlayResult.marks;

  if (automaticHeight && !data.overlays?.length && !listed?.size && omitted.size === 0
    && naturalHeight() === size.height) settledAutoHeight.add(frameResult.frame);
  // A successful automatic layout has fitted its notes and glyphs. Later
  // height probes can repeat that natural frame; refusals keep their fixed
  // repair context instead.
  if (automaticHeight && constraints) {
    delete (constraints as typeof constraints & { [AUTOMATIC_FRAME]?: unknown })[AUTOMATIC_FRAME];
  }

  const noDataCount = marks.regions.filter((mark) => mark.value === null).length;
  const missingCount = marks.regions.filter((mark) => mark.state === 'no-data').length;
  const unlistedCount = marks.regions.filter((mark) => mark.state === 'not-in-data').length;
  // The width-filled lattice is a preference. A pinned, shorter lattice is
  // already readable when every country code and the frame fit unchanged.
  const smallerLattice = fixedHeight && options.belowMinimum !== 'refuse'
    && size.height + SIZE_TOLERANCE < naturalHeight()
    && (frameResult.frame.minHeight ?? 0) <= size.height + SIZE_TOLERANCE
    && solved.placed.every(label => !label.hidden);
  if (smallerLattice) warnings.push({
    code: 'plot-under-floor', severity: 'warn',
    message: `the fixed height uses smaller square tiles; the chart needs ${naturalHeight()} px for the width-filled lattice`,
    suggest: 'Leave options.size.height out to fill the width, or use measure() for the exact verified size.',
    field: ['options', 'size'],
    fix: [{ op: 'replace', path: '/options/size', value: { width: size.width, height: naturalHeight() } }],
  });
  return {
    type: 'tilemap',
    size,
    sizing: resolveSizing(TILEMAP_SIZING, size, {
      minHeight: smallerLattice ? size.height : naturalHeight(),
      naturalHeight: naturalHeight(),
    }),
    plot: frameResult.plot,
    scene: nodes,
    labels: [...solved.placed, ...overlayResult.labels],
    axes: [],
    annotations: [],
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: {
      domain: { min: scale.min, max: scale.max, midpoint: scale.midpoint, polarity: scale.polarity },
      legendRange: { min: scale.min, max: scale.max },
      noDataCount,
      unlistedCount,
      ...(overlayResult.descriptions.length
        ? { overlayDescriptions: overlayResult.descriptions }
        : {}),
      tileSize,
      tileGap: TILE_GAP,
      gridFrame,
      pack: {
        id: pack.id,
        layoutAuthor: pack.meta.layoutAuthor,
        layoutVersion: pack.meta.layoutVersion,
        memberDate: pack.meta.memberDate,
        adjacencyExceptionCount: pack.meta.adjacencyExceptions.length,
        attribution: pack.meta.attribution,
      },
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'tilemapTitle', { v1: pack.id })),
      counts: [...geoStateCounts(statesById.values(), options), structureCount('regions', pack.regions.length, chartString(options, 'regionCountPrefix', { v1: pack.regions.length })),
        structureCount('regions', missingCount, chartString(options, 'listedRegions', { v1: missingCount })),
        ...(unlistedCount ? [structureCount('regions', unlistedCount, undefined, options)] : [])],
      desc:
        chartString(options, 'equalTileGrid', { v1: pack.regions.length }) +
        (scale.min === null
          ? chartString(options, 'noNumericValues')
          : chartString(options, 'mappedRange', { v1: fmt(scale.min), v2: fmt(scale.max!) })) +
        // The inverted judgment is an encoding — hue must not carry it alone
        // (variance appends the same phrase for its direction).
        (scale.polarity === 'lowerIsBetter' ? chartString(options, 'lowerFavorable') : '') +
        chartString(options, 'tileMissingRegions', { v1: missingCount }) +
        (valueLines.length ? chartString(options, 'tileValuesSentence', { v1: valueEntries.map((entry) => entry.text).join(', ') }) : '') +
        (unlistedCount ? chartString(options, 'mapUnlistedRegions', { v1: unlistedCount }) : '') +
        geoStateSummary(statesById.values(), options) +
        (overlayResult.descriptions.length
          ? chartString(options, 'overlaysSentence', { v1: overlayResult.descriptions.join(' ') })
          : '') +
        chartString(options, 'sourceSentence', { v1: pack.meta.attribution, v2: userSource }),
    },
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...overlayResult.decisions],
    },
  };
}

/**
 * The world grid prints two- and three-letter codes that few readers
 * know, so a static exhibit (PNG, slide) carries the lookup: every code with
 * its country name. The US and EU grids print their standard codes.
 */
function codeLookup(options: TilemapOptions, pack: ReturnType<typeof getTilePack>): string[] {
  if (pack.id !== 'world') return [];
  const entries = [...pack.regions].sort((a, b) => compareText(a.id, b.id)).map((region) => `${region.id} ${region.name}`);
  return [disclosureNote(chartString(options, 'codesSentence', { v1: entries.join('; ') }))];
}

/** The note that lists overlay texts moved off the grid, each under its tile's code. */
function overlayNote(overlays: readonly GeoOverlay[], listed: ReadonlySet<string> | undefined, pack: ReturnType<typeof getTilePack>, idIndex: ReturnType<typeof geoRegionIdIndex>, options: NoteCapOptions): string[] {
  if (!listed?.size) return [];
  return noteLine(chartString(options, 'overlays'), overlays.flatMap((overlay, index) => {
    if (!listed.has(overlay.id)) return [];
    const regionId = resolveTilemapOverlayRegion(overlay, index, pack.id, idIndex);
    const code = pack.regions.find((region) => region.id === regionId)?.shortName ?? regionId;
    return [overlay.label.startsWith(code) ? overlay.label : `${code} ${overlay.label}`];
  }), options);
}

function resolveTilemapOverlayAnchor(
  overlay: GeoOverlay,
  index: number,
  packId: GeoPackId,
  idIndex: ReturnType<typeof geoRegionIdIndex>,
  regions: TilemapMarks['regions'],
): { x: number; y: number } {
  const regionId = resolveTilemapOverlayRegion(overlay, index, packId, idIndex);
  const mark = regions.find((region) => region.id === regionId);
  if (!mark) {
    throw new NormalizeError(
      'overlay-unknown-region',
      `overlays[${index}].at`,
      `overlay anchor resolves to region '${regionId}', which is not present in tile pack '${packId}'`,
    );
  }
  const radius = geoOverlayDiameter(overlay) / 2;
  const inset = radius + 2;
  if (mark.rect.w < 2 * inset || mark.rect.h < 2 * inset) {
    throw new NormalizeError('geo-overlay-no-space', `overlays[${index}].size`,
      `overlay '${overlay.id}' needs a tile at least ${2 * inset}px wide and high to stay inside region '${regionId}'`,
      'give the tile map more room or use a smaller overlay size');
  }
  // One tile owns the whole glyph. Region labels solve around this slot.
  return {
    x: mark.rect.x + mark.rect.w - inset,
    y: mark.rect.y + inset,
  };
}

function resolveTilemapOverlayRegion(
  overlay: GeoOverlay,
  index: number,
  packId: GeoPackId,
  idIndex: ReturnType<typeof geoRegionIdIndex>,
): string {
  let regionId: string;
  if ('region' in overlay.at) {
    const resolution = resolveGeoRegionId(idIndex, overlay.at.region);
    if (resolution.kind !== 'resolved') {
      throw new NormalizeError(
        'overlay-unknown-region',
        `overlays[${index}].at.region`,
        `overlay region '${overlay.at.region}' is not uniquely present in tile pack '${packId}'`,
        resolution.kind === 'ambiguous'
          ? `use one of ${resolution.candidates.join(', ')}`
          : undefined,
      );
    }
    regionId = resolution.id;
  } else {
    const geoPack = getGeoPack(packId);
    const point = projectGeoLonLat(geoPack, overlay.at.lon, overlay.at.lat);
    if (!point) {
      throw new NormalizeError(
        'overlay-coordinate-unowned',
        `overlays[${index}].at`,
        `overlay '${overlay.id}' at longitude ${overlay.at.lon}, latitude ${overlay.at.lat} is not owned by any projection branch in pack '${packId}'`,
      );
    }
    const nearest = [...geoPack.regions].sort((a, b) => {
      const da = (a.anchor.x - point.x) ** 2 + (a.anchor.y - point.y) ** 2;
      const db = (b.anchor.x - point.x) ** 2 + (b.anchor.y - point.y) ** 2;
      return da - db || compareText(a.id, b.id);
    })[0];
    if (!nearest) {
      throw new NormalizeError(
        'overlay-coordinate-invalid',
        `overlays[${index}].at`,
        `overlay '${overlay.id}' cannot resolve a tile through pack '${packId}'`,
      );
    }
    regionId = nearest.id;
  }
  return regionId;
}

function solveTileLabels(
  plans: TileLabelPlan[],
  occupied: OccupiedIndex,
  ctx: SolveCtx,
): TileLabelSolveResult {
  const result: TileLabelSolveResult = {
    placed: [],
    decisions: [],
    warnings: [],
    fontByLabel: new Map(),
  };
  const solveCtx = { ...ctx, pins: {} };
  for (const plan of [...plans].sort((a, b) => compareText(a.id, b.id))) {
    const labelId = `category:${plan.id}`;
    const pin = ctx.pins[labelId];
    const pinnedVariant = pin
      ? plan.variants.find((variant) =>
          variant.request.candidates.some((candidate) => candidate.slot === pin)
        )
      : undefined;
    if (pin && !pinnedVariant) {
      result.warnings.push({
        code: 'unknown-slot',
        severity: 'warn',
        message: `label '${labelId}': unknown slot '${pin}' — using automatic placement`,
        owner: { categoryId: plan.id },
        suggest: plan.variants.flatMap((variant) =>
          variant.request.candidates.map((candidate) => candidate.slot)
        ).join(', '),
      });
    }
    const variants = pinnedVariant ? [pinnedVariant] : plan.variants;
    let fallback: { solved: SolveResult; font: FontSpec } | undefined;
    for (const variant of variants) {
      const request = pinnedVariant
        ? { ...variant.request, pinnedSlot: pin }
        : variant.request;
      const solved = solveLabels([request], occupied, solveCtx);
      fallback = { solved, font: variant.font };
      if (solved.placed[0]?.hidden) continue;
      appendTileSolve(result, solved, variant.font, plan);
      fallback = undefined;
      break;
    }
    if (fallback) appendTileSolve(result, fallback.solved, fallback.font, plan);
  }
  return result;
}

function appendTileSolve(
  result: TileLabelSolveResult,
  solved: SolveResult,
  font: FontSpec,
  plan: TileLabelPlan,
): void {
  const placed = solved.placed[0];
  const decision = solved.decisions[0];
  if (!placed || !decision) return;
  placed.slots = plan.variants.flatMap((variant) =>
    variant.request.candidates.map((candidate) => candidate.slot)
  );
  result.placed.push(placed);
  result.decisions.push(decision);
  pushAll(result.warnings, solved.warnings);
  result.fontByLabel.set(placed.id, font);
}

function tileLabelPlan(
  region: TileRegionRecord,
  tile: Rect,
  insidePaint: Paint,
  theme: Theme,
  measure: typeof defaultMeasurer,
  value?: string,
  bold = false,
): TileLabelPlan {
  /*
   * ONE vocabulary per map. TWIN of choropleth's labelPlanForRegion — see the
   * long note there for why the full name is not used.
   *
   * Taking the first of several forms that FITS the tile would decide the
   * vocabulary by how many letters a country's name has: on eu27 (all tiles the
   * same size) 'Austria' would stand beside 'BE'.
   *
   * The tier stays 2. Fixing it at 1 would render eu27's 16 code labels one
   * point LARGER, and the fit gate below can empty the variant list, which hides
   * the label outright — buying uniformity at the cost of a label would break
   * "never lose a label".
   */
  const TILE_TIER = 2;
  const tierFont = geoLabelFont(theme);
  const text =
    measure(region.shortName, tierFont).width <= measure(region.id, tierFont).width
      ? region.shortName
      : region.id;
  // With regionValues the value sits under the code; a tile too small
  // for both keeps its code, and the layout reports the dropped value.
  // A bold code carries the value regular under it.
  const forms = [
    ...(value === undefined ? [] : [{ lines: [text, value], tier: TILE_TIER, slot: 'tileCodeValue', bold }]),
    { lines: [text], tier: TILE_TIER, slot: 'tileCode', bold },
  ];
  const variants = forms.flatMap(({ lines, tier, slot, bold: strong }) => {
    const regular = geoLabelFont(theme);
    const font = strong ? { ...regular, weight: emphasisWeight(theme) } : regular;
    const width = Math.max(...lines.map((line, i) => measure(line, i === 0 ? font : regular).width));
    const h = lines.length * font.size * (font.lineHeight ?? 1.2);
    if (width > tile.w - 4 || h > tile.h - 2) return [];
    const rect = {
      x: tile.x + (tile.w - width) / 2,
      y: tile.y + (tile.h - h) / 2,
      w: width,
      h,
    };
    return [{
      font,
      request: {
        id: `category:${region.id}`,
        kind: 'category' as const, typeRole: 'label' as const,
        owner: { categoryId: region.id },
        text: lines.join(' '),
        lines,
        font,
        priority: PRIORITY.interior,
        candidates: [
          { slot, rect, penalty: tier, insideFill: paintColor(theme, insidePaint), insidePaint },
          // A glyph owns the upper-right slot. Try the lower-left within this tile.
          { slot: `${slot}:lowerLeft`, rect: { ...rect, x: tile.x + 2, y: tile.y + tile.h - h - 1 }, penalty: tier + 1, insideFill: paintColor(theme, insidePaint), insidePaint },
        ],
      },
    }];
  });
  if (variants.length === 0) {
    const font = geoLabelFont(theme);
    // Emit the CHOSEN form, not region.id — otherwise a tile whose code did not
    // fit would reintroduce a second vocabulary through the back door.
    variants.push({
      font,
      request: {
        id: `category:${region.id}`,
        kind: 'category', typeRole: 'label',
        owner: { categoryId: region.id },
        text,
        lines: [text],
        font,
        priority: PRIORITY.interior,
        candidates: [],
      },
    });
  }
  return { id: region.id, variants };
}


/** The stepped key's bar height, how far its ticks reach under it, and the chips beside it. */
const KEY_BAR_H = 10;
const KEY_TICK_DOWN = 3;
const KEY_STEP_MAX = 76;
const KEY_CHIP_W = 14;
const KEY_CHIP_GAP = 4;
const KEY_ENTRY_GAP = 24;
const KEY_ROW_GAP = 4;
const KEY_LABEL_GAP = 6;

interface SteppedKey {
  x: number;
  step: number;
  classes: LegendItemInput[];
  ticks: { text: string; align: 'start' | 'middle' | 'end' }[];
  font: FontSpec;
  lineH: number;
  /** The other scale entries ('No data', named states, 'Not in data'): row 0 beside the bar, later rows under the ticks. */
  entries: { item: LegendItemInput; dx: number; row: number }[];
  /** Key height plus the gap to the grid. */
  band: number;
  /** The scale entries this key draws; the frame keeps the rest. */
  owns: Set<string>;
}

/**
 * A classed sequential key is one bar of equal steps, each break
 * printed once under its tick, the first and last at the bar's ends. The
 * other scale entries ('No data', named states, 'Not in data') stand beside
 * the bar, and wrap to rows under it where the row is too narrow. Undefined
 * when the bar itself cannot fit: the frame then keeps one entry per class.
 */
function planSteppedKey(
  scale: ScaleModel, x: number, width: number, gap: number, theme: Theme, target: RenderTarget,
  measure: typeof defaultMeasurer, fmt: (value: number) => string,
): SteppedKey | undefined {
  const edges = scale.edges!;
  const classes = scale.legend.filter((item) => item.id.startsWith('class-'));
  if (classes.length !== edges.length - 1 || classes.length < 2) return undefined;
  const font: FontSpec = { family: theme.type.family, ...theme.type.axis,
    size: Math.max(theme.type.axis.size, readerFloorPx(target, 'axis')) };
  const lineH = font.size * (font.lineHeight ?? 1.2);
  // A round break prints round; an end that is not round keeps the format's decimals.
  const roundDecimals = Math.max(0, ...edges.slice(1, -1).map(decimalsOf));
  const ticks = edges.map((value, i) => {
    const end = i === 0 || i === edges.length - 1;
    return {
      text: !end || scale.liftedDecimals || decimalsOf(value) <= roundDecimals ? scale.edgeFmt(value) : fmt(value),
      align: (i === 0 ? 'start' : i === edges.length - 1 ? 'end' : 'middle') as 'start' | 'middle' | 'end',
    };
  });
  const widths = ticks.map((tick) => measure(tick.text, font).width);
  const reach = (i: number, side: 'left' | 'right') => {
    const align = ticks[i]!.align;
    return align === 'middle' ? widths[i]! / 2 : (align === 'start') === (side === 'right') ? widths[i]! : 0;
  };
  const minStep = Math.max(KEY_CHIP_W * 2, ...ticks.slice(1).map((_, i) => reach(i, 'right') + reach(i + 1, 'left') + KEY_LABEL_GAP));
  const step = Math.min(KEY_STEP_MAX, Math.max(minStep, width / 11));
  const barW = step * classes.length;
  if (barW > width) return undefined;
  const others = scale.legend.filter((item) => !item.id.startsWith('class-'));
  const entries: SteppedKey['entries'] = [];
  let row = 0;
  let dx = barW + KEY_ENTRY_GAP;
  for (const item of others) {
    const w = KEY_CHIP_W + KEY_CHIP_GAP + measure(item.label, font).width;
    if (dx + w > width && dx > 0) { row++; dx = 0; }
    entries.push({ item, dx, row });
    dx += w + KEY_ENTRY_GAP;
  }
  const height = KEY_BAR_H + KEY_TICK_DOWN + 2 + lineH + row * (KEY_ROW_GAP + lineH);
  return {
    x, step, classes, ticks, font, lineH, entries,
    band: height + gap,
    owns: new Set(scale.legend.map((item) => item.id)),
  };
}

function drawSteppedKey(key: SteppedKey, frameResult: FrameResult, occupied: OccupiedIndex, nodes: SceneNode[], theme: Theme): void {
  const y = frameResult.plot.y - key.band;
  const items: { id: string; swatchNodeId: string; labelId: string }[] = [];
  const labelY = y + KEY_BAR_H + KEY_TICK_DOWN + 2;
  key.classes.forEach((item, i) => {
    nodes.push({ t: 'rect', id: `legend:step:${i}`, rect: { x: key.x + i * key.step, y, w: key.step, h: KEY_BAR_H },
      fill: item.paint, owner: { seriesId: item.id }, part: 'swatch' });
  });
  key.ticks.forEach((tick, i) => {
    const tx = key.x + i * key.step;
    nodes.push({ t: 'line', id: `legend:tick:${i}`, x1: tx, x2: tx, y1: y, y2: y + KEY_BAR_H + KEY_TICK_DOWN,
      stroke: { token: 'inkMuted' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'legendTick' });
    nodes.push({ t: 'text', id: `legend:tickLabel:${i}`, x: tx, y: labelY, lines: [tick.text], align: tick.align, font: key.font,
      ink: { token: 'inkMuted' }, owner: {}, part: 'legendLabel', typeRole: 'axis' });
  });
  key.classes.forEach((item, i) => items.push({ id: item.id, swatchNodeId: `legend:step:${i}`, labelId: `legend:tickLabel:${i}` }));
  let bottom = labelY + key.lineH;
  for (const { item, dx, row } of key.entries) {
    const rowY = row === 0 ? y + KEY_BAR_H / 2 - key.lineH / 2 : labelY + key.lineH + KEY_ROW_GAP + (row - 1) * (key.lineH + KEY_ROW_GAP);
    const cx = key.x + dx;
    const swatchId = `legend:${item.id}`;
    const labelId = `legend:${item.id}:label`;
    nodes.push({ t: 'rect', id: swatchId, rect: { x: cx, y: rowY + key.lineH / 2 - KEY_BAR_H / 2, w: KEY_CHIP_W, h: KEY_BAR_H },
      fill: item.paint, ...(item.hollow ? { pattern: 'hollow' as const } : item.pattern ? { pattern: item.pattern } : {}),
      ...(item.stroke ? { stroke: item.stroke, strokeWidth: item.width ?? strokeToken(theme, 'mark') } : {}),
      owner: { seriesId: item.id }, part: 'swatch' });
    nodes.push({ t: 'text', id: labelId, x: cx + KEY_CHIP_W + KEY_CHIP_GAP, y: rowY, lines: [item.label], align: 'start',
      font: key.font, ink: { token: 'inkMuted' }, owner: { seriesId: item.id }, part: 'legendLabel', typeRole: 'axis' });
    items.push({ id: item.id, swatchNodeId: swatchId, labelId });
    bottom = Math.max(bottom, rowY + key.lineH);
  }
  const rect = { x: key.x, y, w: frameResult.plot.w, h: bottom - y };
  occupied.claim(rect, 'legend', {});
  if (frameResult.legend) pushAll(frameResult.legend.items, items);
  else frameResult.legend = { rect, items };
}

/** Whether every listed value fits its tile under its bold code, as tileLabelPlan measures it. */
function valuesFit(
  regions: readonly TileRegionRecord[], valuesById: ReadonlyMap<string, number | null>, tile: number, theme: Theme,
  measure: typeof defaultMeasurer, fmt: (value: number) => string,
): boolean {
  const regular = geoLabelFont(theme);
  const bold = { ...regular, weight: emphasisWeight(theme) };
  if (2 * regular.size * (regular.lineHeight ?? 1.2) > tile - 2) return false;
  return regions.every((region) => {
    const value = valuesById.get(region.id);
    if (value == null) return true;
    const code = Math.min(measure(region.shortName, bold).width, measure(region.id, bold).width);
    return Math.max(code, measure(fmt(value), regular).width) <= tile - 4;
  });
}

/**
 * The note for values the tiles do not print: above DEFAULT_NOTE_LIMIT the
 * leads (highest, lowest, and any value or region the title or subtitle names) come first, then
 * the rest in order; the first 8 by name, then "and N more". `notes.maxListed` wins.
 */
function tileValueNote(entries: readonly { id: string; name: string; value: number; text: string }[], options: TilemapOptions): string[] {
  const lead = chartString(options, 'valuesNotPrinted');
  if (entries.length <= DEFAULT_NOTE_LIMIT) return valueNoteLine(lead, entries.map((entry) => entry.text), options, entries.length);
  const heading = [options.title, ...(typeof options.subtitle === 'object' && options.subtitle !== null ? Object.values(options.subtitle) : [options.subtitle])]
    .filter((part): part is string => typeof part === 'string').join(' ');
  const named = (entry: typeof entries[number]) => [entry.id, entry.name, entry.text.slice(entry.id.length + 1)]
    .some((token) => heading.includes(token) && new RegExp(`(^|[^\\p{L}\\p{N}.,])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}]|[.,]\\p{N})`, 'u').test(heading));
  const values = entries.map((entry) => entry.value);
  const high = entries.find((entry) => entry.value === maxOf(values))!;
  const low = entries.find((entry) => entry.value === minOf(values))!;
  const leads = [...new Set([high, low, ...entries.filter(named)])];
  return valueNoteLine(lead, [...new Set([...leads, ...entries])].map((entry) => entry.text), options, entries.length);
}

/** The short tile-layout credit: the anchor source by name, else the full attribution. */
function tileCreditShort(attribution: string, options: TilemapOptions): string {
  const from = /Natural Earth/.test(attribution) ? 'Natural Earth' : /US Census Bureau/.test(attribution) ? 'US Census Bureau' : undefined;
  return from ? chartString(options, 'tileCreditShort', { v1: from }) : attribution;
}

/** Whether every tile's code fits its tile in bold, as tileLabelPlan measures it. */
function codesFitBold(regions: readonly TileRegionRecord[], tile: number, theme: Theme, measure: typeof defaultMeasurer): boolean {
  const regular = geoLabelFont(theme);
  const bold = { ...regular, weight: emphasisWeight(theme) };
  return regions.every((region) => Math.min(measure(region.shortName, bold).width, measure(region.id, bold).width) <= tile - 4);
}

/**
 * A tile label prints centred: the code bold on its own line, the value
 * regular under it. The solver placed one box; this splits its text.
 */
function centredTileLabels(nodes: SceneNode[], placed: SolveResult['placed'], theme: Theme): SceneNode[] {
  const boxes = new Map(placed.map((label) => [`label:${label.id}`, label.rect]));
  return nodes.flatMap((node): SceneNode[] => {
    const box = node.t === 'text' && node.part === 'category' ? boxes.get(node.id) : undefined;
    if (!box || node.t !== 'text') return [node];
    const x = box.x + box.w / 2;
    const regular = { ...node.font, weight: theme.type.label.weight ?? 400 };
    const head: SceneNode = { ...node, x, align: 'middle', lines: node.lines.slice(0, 1) };
    if (node.lines.length < 2) return [head];
    const lineH = node.font.size * (node.font.lineHeight ?? 1.2);
    return [head, { ...node, id: `${node.id}:value`, x, y: node.y + lineH, align: 'middle', lines: node.lines.slice(1), font: regular }];
  });
}
