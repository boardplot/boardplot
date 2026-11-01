import { chartString } from '../../strings/diagram';
import { chartPalette, chartTheme } from '../chartEnv';
import { TARGET_SIZE, type TargetSizeOptions } from '../../target';
import { structureCount, type StructureCount } from '../../structureCounts';
import { rectContains, rectsOverlap, type Point, type Rect } from '../../geometry';
import { fitText } from '../../label/fitText';
import { frameTextOptions, solveFrame, type LegendItemInput } from '../../frame';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, seatLeader, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize } from '../../normalize/shared';
import { defaultMeasurer, wrapText, type FontSpec } from '../../text';
import { emphasisWeight, headingWeight, resolveSurface, strokeToken, canvasMargin, paintColor, panelTypeClass } from '../../theme';
import type {
  DiagramData,
  DiagramDerived,
  DiagramMarks,
  DiagramNode,
  DiagramOptions,
  ResolvedDiagramGroup,
  ResolvedDiagramLane,
  ResolvedDiagramNode,
} from '../../types/diagram';
import type {
  DiagramLabelKind,
  Geometry,
  LintWarning,
  PlacedLabel,
  Paint,
  SceneNode,
  TextRole,
} from '../../types/scene';
import { rowDrivenHeight } from '../../rowCanvas';
import { chartSizing, contentSizing, resolveSizing, sizeRefusal } from '../../sizing';
import { diagramSceneId } from './ids';
import { normalizeDiagramModel, type NormalizedDiagram } from './model';
import {
  createDiagramPalette,
  groupOwner,
  laneOwner,
  measuredNodeSize,
  nodeFillCss,
  nodeFillPaint,
  nodeOwner,
  nodeShapeScene,
  q,
  qRect,
} from './primitives';
import { circularLabelBand, circularRing, layoutPreset, strategyHouseBands } from './presets';
import { layoutOrgChart, orgChartEligible } from './orgChart';
import { issueTreeEligible, layoutIssueTreeCompact } from './issueTreeCompact';
import { architectureEligible, architectureFill, layoutArchitecture } from './architecture';
import { journeyEligible, layoutJourneyCompact } from './journeyCompact';
import { layoutLinearCompact, linearEligible } from './linearCompact';
import { layoutRoadmapCompact, roadmapEligible } from './roadmapCompact';
import { edgeDash, routeDiagramEdges } from './routing';
import { maxOf, pushAll } from '../../arrays';



/** The width floor of every diagram layout but the compact org chart. */
const DIAGRAM_MIN_WIDTH = 480;
/** Presets whose own layout scales below that floor, to the type's 320. */
const NARROW_PRESETS = new Set<DiagramOptions['variant']>(['circular-process', 'strategy-house']);

export function layoutDiagram(
  rawData: DiagramData,
  rawOptions?: DiagramOptions,
  measureMinimum = true,
): Geometry<DiagramMarks, DiagramDerived> {
  return layoutDiagramPass(rawData, rawOptions, measureMinimum);
}

type DiagramFit = Pick<Geometry<DiagramMarks, DiagramDerived>, 'warnings'>;

function layoutDiagramPass(
  rawData: DiagramData, rawOptions: DiagramOptions | undefined, measureMinimum: boolean,
): Geometry<DiagramMarks, DiagramDerived>;
function layoutDiagramPass(
  rawData: DiagramData, rawOptions: DiagramOptions | undefined, measureMinimum: boolean, fitOnly: true | 'structural',
): DiagramFit;
function layoutDiagramPass(
  rawData: DiagramData,
  rawOptions: DiagramOptions | undefined,
  measureMinimum: boolean,
  fitOnly: boolean | 'structural' = false,
): Geometry<DiagramMarks, DiagramDerived> | DiagramFit {
  if (!rawOptions?.variant) {
    throw new NormalizeError(
      'invalid-options',
      'options.variant',
      'diagram requires an explicit variant',
    );
  }
  const { data, options } = normalizeDiagramModel(rawData, rawOptions);
  const theme = chartTheme(options);
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const u = Math.max(4, theme.space.labelPad);
  const warnings: LintWarning[] = [];
  const palette = chartPalette(theme, options.palette, warnings);
  pushAll(warnings, duplicateOrderWarnings(data, options));
  const categoryKeys = diagramCategoryKeys([...data.nodes, ...data.groups, ...data.lanes]);
  const diagramPalette = createDiagramPalette(
    theme,
    categoryKeys,
    palette ? options.palette : undefined,
    new Set([...data.nodes, ...data.groups, ...data.key, ...data.edges].flatMap((item) => (item.paletteKey ? [item.paletteKey] : []))),
    diagramCategoryKeys(data.edges),
  );
  // A good, bad or warn fill on a node that carries its own label reads by
  // convention (red = critical), so no key is required. data.key
  // still draws one; without an entry an info lint says where to add it when
  // the tone means something else.
  const keyedRoles = new Set(data.key.map((entry) => entry.role));
  const unkeyed = [...new Set(data.nodes.flatMap((node) =>
    (node.role === 'good' || node.role === 'bad' || node.role === 'warn') && !keyedRoles.has(node.role) ? [node.role] : []))];
  if (unkeyed.length > 0) {
    warnings.push({
      code: 'diagram-tone-unexplained',
      severity: 'info',
      message: `nodes filled in the ${unkeyed.join(', ')} tone read by convention; name it in data.key when the tone means something else`,
      suggest: `name it in data.key, for example { role: '${unkeyed[0]}', label: '…' }`,
    });
  }
  const keyItems: LegendItemInput[] = data.key.map((entry, index) => {
    // A line style is keyed as the edges draw it.
    if (entry.line !== undefined) return { id: `key:${index}`, label: entry.label, paint: { token: 'leader' }, key: 'line', width: strokeToken(theme, 'rule'), ...(entry.line === 'solid' ? {} : { dash: edgeDash(theme, entry.line)!, lineCap: entry.line === 'dotted' ? 'round' as const : 'butt' as const }) };
    const node = data.nodes.find((item) => item.role === entry.role && item.paletteKey === entry.paletteKey) ??
      ({ id: `key:${index}`, kind: 'step', label: entry.label, shape: { kind: 'rectangle' }, role: entry.role, paletteKey: entry.paletteKey } as DiagramNode);
    if (options.variant === 'architecture') {
      const { fill, ring } = architectureFill(node, data.lanes, diagramPalette);
      return { id: `key:${index}`, label: entry.label, ...(ring ? { paint: { token: ring }, hollow: true } : { paint: fill }) };
    }
    // The fill the nodes of that role wear, as nodeFillPaint paints them.
    return { id: `key:${index}`, label: entry.label, paint: nodeFillPaint(node, diagramPalette, theme) };
  });
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frame = solveFrame(
    {
      size,
      margin: { ...canvasMargin(theme, size.width), ...options.margin },
      ...frameTextOptions(options),
      unit: undefined,
      ...(keyItems.length > 0 ? { legend: { options: { position: theme.legend?.required ?? 'top' }, items: keyItems } } : {}),
      theme: theme,
      measure,
    },
    occupied,
  );
  const plot = frame.plot;
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const axisFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  // Node headings follow each preset's design. A process step
  // name (linear and circular) takes the emphasis weight; the strategy
  // house's roof, pillar heads and foundation, a roadmap phase, a critical
  // journey card and the issue tree's question and branches take the heading
  // weight. Everything else keeps its role weight.
  const stepFont: FontSpec = { ...labelFont, weight: emphasisWeight(theme) };
  const headFont: FontSpec = { ...labelFont, weight: headingWeight(theme) };
  const badgeFont: FontSpec = options.variant === 'linear-process' ? { ...labelFont, weight: emphasisWeight(theme) } : labelFont;
  const laneFont: FontSpec = options.variant === 'roadmap' || options.variant === 'architecture' ? { ...axisFont, weight: headingWeight(theme) } : axisFont;
  const nodeFontById = (id: string): FontSpec | undefined => {
    const node = data.nodes.find((candidate) => candidate.id === id);
    return node ? presetFont(node) : undefined;
  };
  const presetFont = (node: DiagramNode): FontSpec | undefined =>
    options.variant === 'linear-process' && node.kind === 'step' ? stepFont
    : options.variant === 'strategy-house' && (node.kind === 'vision' || node.kind === 'objective' || node.kind === 'foundation') ? headFont
    : undefined;
  // A step description sits in the axis type (13 px at the narrow widths), under or beside its step.
  const captionFont: FontSpec = options.variant === 'linear-process' ? axisFont : labelFont;
  const lineHeight = labelFont.size * (labelFont.lineHeight ?? 1.2);
  const externalLabels = options.variant === 'circular-process' || options.variant === 'roadmap';
  // A phrase uses a pill. Its height follows the font, never the text width.
  const pills = new Map(data.nodes.filter(node => node.badge && node.badge.text.length > 3).map(node => {
    const text = measure(node.badge!.text, badgeFont);
    const height = q(Math.max(4 * u, text.height + u));
    return [node.id, { width: q(Math.max(height, text.width + 2 * u)), height }];
  }));
  // An automatic number counts the node's kind in the normalized node order,
  // the order the presets place steps in, so the numbers read in drawn order.
  const stepNumbers = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  for (const node of data.nodes) {
    const count = (kindCounts.get(node.kind) ?? 0) + 1;
    kindCounts.set(node.kind, count);
    stepNumbers.set(node.id, count);
  }
  const badgeText = (node: DiagramNode) => node.badge?.text ?? String(stepNumbers.get(node.id)!);
  // number badges need the same measured clearance as phrase badges.
  const badgeSizes = new Map(data.nodes.filter(node => node.badge || options.variant === 'linear-process').map(node => {
    const text = measure(badgeText(node), badgeFont);
    const diameter = q(Math.max(4 * u, text.width + 2 * u, text.height + 2 * u));
    return [node.id, pills.get(node.id) ?? { width: diameter, height: diameter }];
  }));
  const nodeSizes = new Map(
    data.nodes.map((node) => {
      const size = measuredNodeSize(node, Math.max(measure(node.label, presetFont(node) ?? labelFont).width, node.secondaryLabel ? measure(node.secondaryLabel, labelFont).width : 0), lineHeight, u);
      const pill = badgeSizes.get(node.id);
      return [node.id, pill && !externalLabels ? { width: Math.max(size.width, pill.width + 2 * u), height: size.height + pill.height } : size];
    }),
  );
  const presetContext = { data, options, plot, sizes: nodeSizes, lineHeight, u,
    palette: diagramPalette, measure, font: labelFont, titleFont: axisFont, headFont };
  // The compact org chart and issue tree lay out and route themselves.
  const org = architectureEligible(options) ? layoutArchitecture(data, options, plot, { name: stepFont, text: labelFont, title: laneFont }, measure, u, diagramPalette, theme, badgeSizes)
    : orgChartEligible(data, options) ? layoutOrgChart(data, plot, labelFont, measure, u)
    : issueTreeEligible(data, options) ? layoutIssueTreeCompact(data, plot, labelFont, measure, u, headingWeight(theme))
    : journeyEligible(data, options) ? layoutJourneyCompact(data, options, plot, labelFont, axisFont, measure, u, diagramPalette, headingWeight(theme))
    : linearEligible(data, options) ? layoutLinearCompact(data, plot, stepFont, badgeFont, captionFont, measure, u, badgeText,
      size.width >= 720 ? 2 * stepFont.size : 0)
    : roadmapEligible(data, options) ? layoutRoadmapCompact(data, options, plot, labelFont, laneFont, measure, u, diagramPalette, theme) : undefined;
  // Refuse-less: every layout draws on a card under 480 px when it reads
  // there: no card or group text cut, no group frame over another. Otherwise it keeps the
  // 480 px floor. The ring, the house and the compact layouts scale to the width.
  const narrow = org !== undefined || NARROW_PRESETS.has(options.variant);
  const underCard = !narrow && panelTypeClass(options) === undefined && size.width < DIAGRAM_MIN_WIDTH;
  const narrowCard = underCard;
  // Narrow cards can regrow before their final readability refusal. Keep
  // that full path; all other search probes have an explicit, fixed size.
  const probe = fitOnly && !narrowCard;
  let preset = org?.preset ?? layoutPreset(theme, presetContext);
  if (org?.warnings) pushAll(warnings, org.warnings);
  // constrained columns wrap primary labels even without secondary text.
  // Measure those lines before the preset assigns row heights and badge clearance.
  if (!externalLabels && !org) {
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const node of data.nodes) {
        const rect = preset.nodeRects.get(node.id);
        if (!rect) continue;
        const width = Math.max(1, rect.w - 4 * u);
        const lines = wrapText(node.label, presetFont(node) ?? labelFont, width, 3, measure).lines.length;
        const secondary = node.secondaryLabel ? wrapText(node.secondaryLabel, labelFont, width, 2, measure).lines.length * lineHeight + u : 0;
        const icon = Math.max(preset.contentTopReserves.get(node.id) ?? 0, node.icon || node.shape.kind === 'icon' ? Math.max(4.5 * u, 28) : 0);
        const height = lines * lineHeight + secondary + icon + 3 * u + (badgeSizes.get(node.id)?.height ?? 0);
        const current = nodeSizes.get(node.id)!;
        if (height > current.height) {
          nodeSizes.set(node.id, { ...current, height });
          changed = true;
        }
      }
      if (!changed) break;
      preset = layoutPreset(theme, presetContext);
    }
  }
  if (preset.compressed) {
    warnings.push({
      code: 'diagram-layout-compressed',
      severity: 'info',
      message: `${options.variant} reduced legal node width below its preferred measured width`,
    });
  }
  if (options.variant === 'circular-process' && data.nodes.length < 2) {
    warnings.push({
      code: 'diagram-cycle-degenerate',
      severity: 'info',
      message: `circular-process has ${data.nodes.length} step${data.nodes.length === 1 ? '' : 's'}; no false full cycle was invented`,
    });
  }
  if (
    options.variant === 'customer-journey' &&
    options.flow === 'serpentine' &&
    data.lanes.length > 1
  ) {
    warnings.push({
      code: 'diagram-layout-wrapped',
      severity: 'info',
      message: `customer-journey wrapped ${data.lanes.length} phases into a serpentine reading path`,
    });
  }
  if (options.variant === 'customer-journey' || options.variant === 'roadmap') {
    for (const lane of data.lanes) {
      if (!data.nodes.some((node) => node.laneId === lane.id)) {
        warnings.push({
          code: 'diagram-empty-phase',
          severity: 'info',
          message: `phase '${lane.label ?? lane.id}' has no members`,
          owner: laneOwner(lane.id),
        });
      }
    }
  }
  const refusedIds = ensurePositionContract(rawData.nodes, data.nodes, preset.nodeRects, plot, warnings);

  const labelRequests: LabelRequest[] = [];
  const joinedLabels = new Map<string, JoinedLabel>();
  const labelKinds = new Map<string, DiagramLabelKind>();
  /** Node labels whose first lines are the step name, printed bold. */
  const boldLeads = new Map<string, number>();
  const nodeMarks: ResolvedDiagramNode[] = [];
  const nodeScene: SceneNode[] = [];
  const badgeScene: SceneNode[] = [];
  const groupScene: SceneNode[] = [];

  // The strategy house draws its pillars as cells in white gutters, with no frame,
  // unless the theme names a node ring, which its group frames then follow.
  const framedGroups = options.variant !== 'strategy-house' || theme.marks?.nodeStroke !== undefined;
  const groups: ResolvedDiagramGroup[] = preset.groups.map((group) => {
    const authored = data.groups.find((candidate) => candidate.id === group.id)!;
    const nodeId = diagramSceneId('group', group.id);
    const drawn = framedGroups && !org?.groupPaint?.dashed.has(group.id);
    if (drawn) groupScene.push({
      t: 'rect',
      id: nodeId,
      rect: group.bounds,
      fill: org?.groupPaint?.fill ?? { token: 'others', tint: 0.82 },
      stroke: org?.groupPaint && authored.role === undefined ? org.groupPaint.stroke : diagramPalette.paint(authored.role, authored.paletteKey),
      // A group frame follows the node ring's width and corner.
      strokeWidth: theme.marks?.nodeStrokeWidth ?? strokeToken(theme, 'hair'),
      radius: theme.marks?.nodeRadius ?? resolveSurface(theme).chipRadius,
      owner: groupOwner(group.id),
      part: 'diagramGroup',
    });
    if (options.variant === 'hierarchy' || options.variant === 'architecture') {
      addBoxLabelRequest(
        labelRequests,
        labelKinds,
        `group-label:${group.id}`,
        'diagramGroup',
        groupOwner(group.id),
        authored.title,
        group.titleBox,
        laneFont,
        measure,
        PRIORITY.endpoint,
        options.target,
      );
    }
    return { ...group, sceneNodeIds: framedGroups ? [nodeId] : [] };
  });

  // A serpentine journey numbers its phases, so the order reads without
  // following the turn.
  const numberedPhases = options.variant === 'customer-journey' && options.flow === 'serpentine' && data.lanes.length > 1;
  const lanes: ResolvedDiagramLane[] = preset.lanes.map((lane, laneIndex) => {
    const authored = data.lanes.find((candidate) => candidate.id === lane.id)!;
    if (lane.headerBox && authored.label) {
      addBoxLabelRequest(
        labelRequests,
        labelKinds,
        `lane-label:${lane.id}`,
        'diagramLane',
        laneOwner(lane.id),
        numberedPhases ? `${laneIndex + 1} ${authored.label}` : authored.label,
        lane.headerBox,
        laneFont,
        measure,
        PRIORITY.endpoint,
        options.target,
        paintColor(theme, org?.laneFills?.get(lane.id) ?? diagramPalette.lane(authored.role, authored.paletteKey)),
        org?.laneFills?.get(lane.id) ?? diagramPalette.lane(authored.role, authored.paletteKey),
      );
    }
    return {
      ...lane,
      sceneNodeIds: [
        diagramSceneId('lane', lane.id, 'header'),
        diagramSceneId('lane', lane.id, 'partition'),
      ].filter((id) => preset.decorationScene.some((node) => node.id === id)),
    };
  });

  preset.decorationClaims.forEach((claim) =>
    occupied.claim(claim.rect, 'mark', claim.owner, claim.part),
  );

  // Presets reserve the pill above the body as part of each node's envelope.
  // A node too short to keep its label clear of the pill keeps its whole rect.
  // The pill then sits inside the node's left end and the label takes the rest.
  const badgeFlush = new Set<string>();
  for (const [id, pill] of badgeSizes) {
    const rect = preset.nodeRects.get(id);
    const node = rect && !externalLabels && !org?.badges ? data.nodes.find(candidate => candidate.id === id) : undefined;
    if (!rect || !node) continue;
    const icon = node.icon ?? (node.shape.kind === 'icon' ? node.shape.name : undefined);
    const room = rect.h - pill.height / 2 - 2.5 * u - Math.max(0, pill.height / 2 + u - 1.25 * u)
      - (preset.contentTopReserves.get(id) ?? (icon ? Math.min(rect.h * 0.42, 28) : 0));
    const lines = fitText(node.label, presetFont(node) ?? labelFont, Math.max(1, rect.w - 4 * u), 3, measure, { target: options.target, typeRole: 'label' }).lines.length;
    if (room + 0.5 < lines * lineHeight) badgeFlush.add(id);
    else preset.nodeRects.set(id, qRect({ ...rect, y: rect.y + pill.height / 2, h: rect.h - pill.height / 2 }));
  }
  for (const node of data.nodes) {
    const rect = preset.nodeRects.get(node.id);
    if (!rect) {
      throw new NormalizeError(
        'diagram-node-unplaced',
        `nodes[${node.id}]`,
        `variant '${options.variant}' did not place node '${node.id}'`,
      );
    }
    const icon = node.icon ?? (node.shape.kind === 'icon' ? node.shape.name : undefined);
    const iconReserve = org ? 0 :
      preset.contentTopReserves.get(node.id) ??
      (icon ? Math.min(rect.h * 0.42, 28) : 0);
    const contentRect = org ? org.labelBoxes.get(node.id)! : qRect({
      x: rect.x + 2 * u,
      y: rect.y + 1.25 * u,
      w: Math.max(1, rect.w - 4 * u),
      h: Math.max(1, rect.h - 2.5 * u),
    });
    const pill = pills.get(node.id);
    const badgeSize = badgeSizes.get(node.id);
    if (badgeSize && badgeFlush.has(node.id)) {
      contentRect.x += badgeSize.width;
      contentRect.w = Math.max(1, contentRect.w - badgeSize.width);
    } else if (badgeSize && !externalLabels && !org?.badges) {
      const reserve = Math.max(0, badgeSize.height / 2 + u - 1.25 * u);
      contentRect.y += reserve;
      contentRect.h = Math.max(1, contentRect.h - reserve);
    }
    if (iconReserve) {
      contentRect.y += iconReserve;
      contentRect.h = Math.max(1, contentRect.h - iconReserve);
    }
    const resolved: ResolvedDiagramNode = {
      id: node.id,
      kind: node.kind,
      shape: node.shape,
      rect,
      contentRect,
      ports: [],
      labelIds: [],
      sceneNodeIds: [],
    };
    const shapes = nodeShapeScene(node, resolved, diagramPalette, theme,
      org ? { iconBox: org.icons.get(node.id), ring: theme.marks?.nodeStroke !== undefined,
        ...(theme.marks?.nodeStroke === undefined && org.rings?.has(node.id) ? { ringPaint: org.rings.get(node.id) } : {}),
        ...(org.fills?.has(node.id) ? { fill: org.fills.get(node.id) } : {}), ...(org.plainShape ? { plainShape: true } : {}),
        ...(org.paths?.has(node.id) ? { d: org.paths.get(node.id) } : {}) }
      // The house's bands and cells are borderless unless the theme names a node ring.
      : options.variant === 'strategy-house' && theme.marks?.nodeStroke === undefined ? { ring: false } : undefined);
    pushAll(resolved.sceneNodeIds, shapes.map((shape) => shape.id));
    pushAll(nodeScene, shapes);
    occupied.claim(rect, 'mark', nodeOwner(node.id), 'diagramNode');
    addNodeLabels(
      node,
      resolved,
      options,
      org?.fonts.get(node.id) ?? presetFont(node) ?? labelFont,
      measure,
      u,
      labelRequests,
      labelKinds,
      warnings,
      org?.fills?.has(node.id) ? paintColor(theme, org.fills.get(node.id)!) : nodeFillCss(node, diagramPalette, theme),
      plot,
      org?.fills?.get(node.id) ?? nodeFillPaint(node, diagramPalette, theme),
      boldLeads,
      options.variant === 'roadmap' ? preset.lanes.find(lane => lane.id === node.laneId)?.bounds : undefined,
      org !== undefined && !org.centred,
      emphasisWeight(theme),
      org?.captionBoxes ? { font: captionFont, box: org.captionBoxes.get(node.id) } : org?.seats ? { font: labelFont, seat: org.seats.get(node.id) }
        : org?.secondaryFont ? { font: captionFont, secondaryFont: org.secondaryFont } : undefined,
      joinedLabels,
    );
    if (node.badge || options.variant === 'linear-process') {
      // An authored badge takes its role; the engine's step number is no
      // authored accent and takes the neutral mark.
      const badgePaint: Paint = org?.badgePaint ?? (node.badge ? diagramPalette.fill(node.badge.role, node.badge.paletteKey) : { token: 'neutralMark' });
      const text = badgeText(node);
      const diameter = q(Math.max(4 * u, measure(text, badgeFont).width + 2 * u));
      const placed = org?.badges?.get(node.id) ?? qRect({
        x: rect.x + u,
        y: badgeFlush.has(node.id) ? rect.y + (rect.h - badgeSize!.height) / 2 : rect.y - (badgeSize?.height ?? diameter) / 2,
        w: badgeSize?.width ?? diameter,
        h: badgeSize?.height ?? diameter,
      });
      // A badge that leaves the canvas moves inside it and keeps its size. A node
      // that is itself off the canvas is refused for its own label, so its badge is not drawn.
      const canvas = { x: 0, y: 0, w: size.width, h: size.height };
      const nodeOnCanvas = rectContains(canvas, rect, -0.5);
      const badgeBox = qRect({
        ...placed,
        x: Math.max(0, Math.min(placed.x, size.width - placed.w)),
        y: Math.max(0, Math.min(placed.y, size.height - placed.h)),
      });
      if (nodeOnCanvas && rectContains(canvas, badgeBox)) {
        const badgeId = diagramSceneId('badge', node.id);
        badgeScene.push({
          ...(pill ? { t: 'rect' as const, rect: badgeBox, radius: resolveSurface(theme).chipRadius } : {
            t: 'circle' as const,
            cx: q(badgeBox.x + badgeBox.w / 2),
            cy: q(badgeBox.y + badgeBox.h / 2),
            r: q(badgeBox.w / 2),
          }),
          id: badgeId,
          fill: badgePaint,
          owner: nodeOwner(node.id),
          part: 'diagramBadge',
        });
        occupied.claim(badgeBox, 'mark', nodeOwner(node.id), 'diagramBadge');
        resolved.badgeBox = badgeBox;
        resolved.sceneNodeIds.push(badgeId);
        addBoxLabelRequest(
          labelRequests,
          labelKinds,
          `badge-label:${node.id}`,
          'diagramBadge',
          nodeOwner(node.id),
          text,
          badgeBox,
          badgeFont,
          measure,
          PRIORITY.endpoint,
          options.target,
          paintColor(theme, badgePaint),
          badgePaint,
          // Authored badge text is a name; the linear-process sequence number is a value.
          node.badge ? 'category' : 'value',
        );
      } else if (node.badge && nodeOnCanvas) {
        // Only a canvas smaller than the badge itself lands here.
        warnings.push({
          code: 'diagram-size-too-small',
          severity: 'error',
          message: `badge '${text}' on node '${node.id}' cannot fit the canvas`,
          suggest: `shorten badge '${text}' or give node '${node.id}' more space`,
          owner: nodeOwner(node.id),
        });
      }
    }
    nodeMarks.push(resolved);
  }

  const structuralCtx = labelCtx(theme, size, {}, {
    density: 'full',
    measure,
    plot,
    labelPad: 1,
  });
  const solvedStructural = solveLabels(labelRequests, occupied, structuralCtx);
  remapLabelKinds(solvedStructural.placed, labelKinds);
  // A compact layout's own inks: a muted description, a numeral in its step's fill.
  for (const label of solvedStructural.placed) {
    const node = org?.badgePaint && label.id.startsWith('badge-label:') ? data.nodes.find((candidate) => candidate.id === label.owner.pointId) : undefined;
    const ink = org?.labelInks?.get(label.id) ?? (node ? nodeFillPaint(node, diagramPalette, theme) : undefined);
    if (ink && !label.hidden) label.ink = ink;
  }
  pushAll(warnings, solvedStructural.warnings);
  translateLabelLosses(solvedStructural.placed, labelKinds, warnings);
  if (probe && (warnings.some(warning => warning.severity === 'error') || sizeWarning(
    nodeMarks.filter(node => !refusedIds.has(node.id)), plot, warnings, options.variant, 0,
  ))) return { warnings };
  if (probe && fitOnly === 'structural') return { warnings };
  // A size search that stops at the structure never reads a secondary text, so only a later pass settles the blocks.
  const unplaced = settleJoinedLabels(solvedStructural.placed, joinedLabels, nodeMarks, occupied, { x: 0, y: 0, w: size.width, h: size.height }, structuralCtx);
  if (unplaced) {
    remapLabelKinds(unplaced.placed, labelKinds);
    solvedStructural.placed.push(...unplaced.placed);
    solvedStructural.decisions.push(...unplaced.decisions);
    pushAll(warnings, unplaced.warnings);
    translateLabelLosses(unplaced.placed, labelKinds, warnings);
  }
  for (const label of solvedStructural.placed) {
    const nodeId = label.owner.pointId;
    if (!nodeId) continue;
    const mark = nodeMarks.find((candidate) => candidate.id === nodeId);
    if (!mark) continue;
    mark.labelIds.push(label.id);
    if ((label.kind as string) === 'diagramCaption' && !label.hidden) mark.captionBox = label.rect;
  }

  const structuralLabelNodes = probe ? [] : labelsToNodes(theme, solvedStructural.placed, (label) =>
    ['diagramLane', 'diagramGroup', 'diagramBadge'].includes(label.kind as string)
      ? (labelKinds.get(label.id) === 'diagramBadge' ? badgeFont : labelKinds.get(label.id) === 'diagramLane' || options.variant === 'architecture' ? laneFont : axisFont)
      : labelKinds.get(label.id) === 'diagramCaption' && org?.captionBoxes ? captionFont
      : org?.secondaryFont && label.id.startsWith('secondary-label:') ? org.secondaryFont
      : (label.owner.pointId ? org?.fonts.get(label.owner.pointId) ?? (label.id.startsWith('node-label:') ? nodeFontById(label.owner.pointId) : undefined) : undefined) ?? labelFont,
  ).flatMap((node) => splitBoldLead(node, boldLeads, emphasisWeight(theme)));
  const reservedForRouting = solvedStructural.placed
    .filter((label) => !label.hidden)
    .map((label) => label.rect);
  const edgeLabelSizes = new Map(
    preset.edges.flatMap((edge) =>
      edge.label
        ? [[edge.id, { width: measure(edge.label, labelFont).width, height: measure(edge.label, labelFont).height }] as const]
        : [],
    ),
  );
  const routed = routeDiagramEdges(theme, {
    preset: options.variant,
    nodes: data.nodes,
    nodeRects: preset.nodeRects,
    edges: preset.edges,
    plot,
    // The smaller arrowhead of a dense flow exhibit.
    clearance: options.variant === 'architecture' ? 0.7 * u : u,
    labelSizes: edgeLabelSizes,
    reserved: reservedForRouting,
    palette: diagramPalette,
    ...(org ? { fixedRoutes: org.routes, ...(org.edgePaint ? { edgePaint: org.edgePaint } : org.centred ? {} : { edgePaint: { token: 'neutral' as const, tint: 0.2 } }) }
      // The cycle's arrows read in the neutral grey, darker than a leader.
      : options.variant === 'circular-process' ? { edgePaint: { token: 'neutral' as const } } : {}),
  });
  pushAll(warnings, routed.warnings);
  // Edge-label solving emits only warn/info diagnostics. The remaining
  // error check is sizeWarning, already checked above. Narrow cards kept
  // the full path because their readability check can still refuse.
  if (probe) return { warnings };
  routed.claims.forEach((claim) =>
    occupied.claim(claim.rect, 'mark', { segmentId: claim.edgeId }, claim.part),
  );
  nodeMarks.forEach((node) => {
    node.ports = routed.portsByNode.get(node.id) ?? [];
  });

  const edgeLabelRequests: LabelRequest[] = [];
  const edgeLabelKinds = new Map<string, DiagramLabelKind>();
  preset.edges.forEach((edge) => {
    const rect = routed.labelBoxes.get(edge.id);
    if (!edge.label || !rect) return;
    addBoxLabelRequest(
      edgeLabelRequests,
      edgeLabelKinds,
      `edge-label:${edge.id}`,
      'diagramEdge',
      { segmentId: edge.id },
      edge.label,
      rect,
      labelFont,
      measure,
      PRIORITY.interior,
      options.target,
    );
  });
  org?.channelLabels?.forEach((label) => addBoxLabelRequest(edgeLabelRequests, edgeLabelKinds, label.id, 'diagramEdge', label.owner, label.text,
    label.rect, labelFont, measure, PRIORITY.interior, options.target));
  const solvedEdges = solveLabels(edgeLabelRequests, occupied, labelCtx(theme, size, {}, {
    density: 'full',
    measure,
    plot,
    labelPad: 1,
  }));
  remapLabelKinds(solvedEdges.placed, edgeLabelKinds);
  pushAll(warnings, solvedEdges.warnings);
  const edgeLabelNodes = labelsToNodes(theme, solvedEdges.placed, () => labelFont);

  const { laneGroupLabels, nodeLabels, accessoryLabels } = groupStructuralLabels(structuralLabelNodes);
  const scene = [
    ...frame.nodes,
    ...groupScene,
    ...preset.decorationScene,
    ...routed.scene,
    ...nodeScene,
    ...laneGroupLabels,
    ...nodeLabels,
    ...badgeScene,
    ...accessoryLabels,
    ...edgeLabelNodes,
  ];
  const labels = [...solvedStructural.placed, ...solvedEdges.placed];
  const a11y = diagramA11y(data, options, preset.readingOrder, preset.edges);
  // A node label that is hidden or would be cut is required content either
  // way: both count toward the size that fits, and both refusals name it.
  const nodeLabelLosses = warnings.filter((warning) => warning.code === 'diagram-node-label-unplaced');
  const tooSmall = sizeWarning(
    nodeMarks.filter((node) => !refusedIds.has(node.id)), plot, warnings, options.variant,
    new Set(nodeLabelLosses.map((warning) => warning.owner?.pointId ?? warning.message)).size,
  );

  const contentRects = [
    ...nodeMarks.map((node) => node.rect), ...groups.map((group) => group.bounds), ...lanes.map((lane) => lane.bounds),
    ...nodeMarks.flatMap(node => badgeSizes.has(node.id) && node.badgeBox ? [node.badgeBox] : []),
    ...labels.filter((label) => !label.hidden).map((label) => label.rect),
    ...(org?.extent ?? []),
  ];
  // A compact layout's height is its content's.
  const sizing = org ? contentSizing('diagram', size, plot, contentRects) : naturalDiagramSizing(options, data, nodeSizes, labelFont, measure, u, contentSizing('diagram', size, plot, contentRects), size, plot, headFont);
  // A layout that reads at its card width keeps the type's 320 floor; one that does not keeps 480.
  // Card and group text counts when cut; any label the narrow layout hid (not as redundant) or
  // cut on an edge is lost text too, so the card keeps 480 rather than drop it without a note.
  const unreadable = narrowCard && (solvedStructural.placed.some((label) => !label.hidden && label.title !== undefined && CARD_TEXT_KINDS.has(label.kind))
    || labels.some((label) => !!label.hidden && label.hidden !== 'redundant')
    || solvedEdges.placed.some((label) => !label.hidden && label.title !== undefined)
    // An authored position that overlaps another or leaves the plot at this width is not drawn as authored.
    || refusedIds.size > 0
    // Groups never nest (the data has no parent group), so a frame inside a sibling's frame is an overlap too.
    || groups.some((group, i) => groups.slice(i + 1).some((other) => rectsOverlap(group.bounds, other.bounds))));
  // A pinned narrow card that does not read is refused below whatever the search finds, so skip it.
  // A width-only card keeps it: the minimum height feeds the regrow that judges it at its content height.
  const refusedNarrow = unreadable && (rawOptions as TargetSizeOptions)[TARGET_SIZE]?.fixed.height !== false;
  // A repair size is a rendered result, not a multiplier on the failed canvas.
  const requiredAccessoryLoss = warnings.some(warning => (warning.code === 'diagram-size-too-small' || warning.code === 'diagram-route-unresolved') && warning.severity === 'error');
  const minimumRequiredSize = (tooSmall || requiredAccessoryLoss || refusedIds.size > 0) && measureMinimum && !refusedNarrow
    ? measuredDiagramMinimum(size, sizing.naturalHeight, panelTypeClass(options) !== undefined,
      (candidate, structuralOnly) => layoutDiagramPass(rawData, { ...rawOptions, size: candidate }, false,
        structuralOnly ? 'structural' : true)) : undefined;
  if (minimumRequiredSize) {
    sizing.minWidth = sizing.measuredMinWidth = minimumRequiredSize.width > size.width
      ? minimumRequiredSize.width : sizing.minWidth;
    sizing.minHeight = sizing.measuredMinHeight = minimumRequiredSize.height;
    sizing.naturalWidth = Math.max(sizing.naturalWidth, sizing.minWidth);
    sizing.naturalHeight = Math.max(sizing.naturalHeight, sizing.minHeight);
    for (const warning of [...nodeLabelLosses, ...warnings.filter(w => w.code === 'diagram-size-too-small'
      || w.code === 'fixed-position-outside' || w.code === 'fixed-position-overlap')]) {
      warning.suggest = `${warning.suggest ? `${warning.suggest}; ` : ''}render at ${minimumRequiredSize.width}×${minimumRequiredSize.height}, or shorten the labels`;
      warning.fix = [{ op: 'replace', path: '/options/size', value: minimumRequiredSize }];
    }
  }
  // A diagram its host did not size takes the height of its content. A width-only layout
  // grows first, so the readability check below judges the height the diagram draws at.
  const grow = rowDrivenHeight({ options: rawOptions, width: size.width, height: size.height, chromeH: 0, rowsH: sizing.naturalHeight });
  if (grow !== undefined) return layoutDiagram(rawData, { ...rawOptions, size: { width: size.width, height: grow } }, measureMinimum);
  // The same for a width the host gave without a height: the narrow card is judged at its content height.
  const openHeight = narrowCard && (rawOptions as TargetSizeOptions)[TARGET_SIZE]?.fixed.height === false;
  const contentHeight = Math.ceil(sizing.naturalHeight - 1e-6);
  if (openHeight && contentHeight > size.height + 2) {
    return layoutDiagram(rawData, { ...rawOptions, size: { width: size.width, height: contentHeight } }, measureMinimum);
  }
  if (unreadable) {
    const policy = { ...chartSizing('diagram'), minWidth: DIAGRAM_MIN_WIDTH };
    return sizeRefusal('diagram', 'Diagram', size, resolveSizing(policy, size)) as unknown as Geometry<DiagramMarks, DiagramDerived>;
  }
  if (!narrow && !narrowCard && panelTypeClass(options) === undefined) sizing.minWidth = Math.max(sizing.minWidth, DIAGRAM_MIN_WIDTH);

  const geometry: Geometry<DiagramMarks, DiagramDerived> = {
    type: 'diagram',
    size,
    sizing,
    plot,
    scene,
    labels,
    axes: [],
    annotations: [],
    frame: frame.frame,
    ...(frame.legend ? { legend: frame.legend } : {}),
    marks: {
      nodes: nodeMarks,
      edges: routed.edges,
      groups,
      lanes,
    },
    derived: {
      variant: options.variant,
      readingOrder: preset.readingOrder,
      syntheticEdgeIds: preset.syntheticEdgeIds,
      degradedEdgeIds: routed.edges
        .filter((edge) => edge.requestedRouting !== edge.actualRouting)
        .map((edge) => edge.id),
      ...(minimumRequiredSize ? { minimumRequiredSize } : {}),
      clearance: u,
      ...(preset.trajectory ? { trajectory: preset.trajectory } : {}),
    },
    a11y,
    warnings,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solvedStructural.decisions, ...solvedEdges.decisions],
    },
  };
  return geometry;
}

function addNodeLabels(
  node: DiagramNode,
  resolved: ResolvedDiagramNode,
  options: DiagramOptions,
  font: FontSpec,
  measure: typeof defaultMeasurer,
  u: number,
  requests: LabelRequest[],
  kinds: Map<string, DiagramLabelKind>,
  warnings: LintWarning[],
  fillCss: string,
  plot: Rect,
  insidePaint: Paint,
  boldLeads: Map<string, number>,
  laneBox?: Rect,
  /** The org chart starts its label at the content box's left edge. */
  start = false,
  /** The weight of a cycle step's name line. */
  leadWeight = font.weight,
  /** A compact layout's caption type and its seat. */
  caption?: { font: FontSpec; box?: { rect: Rect; lines: string[] }; seat?: { rect: Rect; lines: string[] }; secondaryFont?: FontSpec },
  /** Per node label id, what the label block needs once the solver has seated it with its secondary lines or without them. */
  joinedLabels?: Map<string, JoinedLabel>,
): void {
  const external = options.variant === 'roadmap' || options.variant === 'circular-process';
  // A cycle step's label sits on the side of its node that faces away from
  // the ring: a side label is set flush toward its node and
  // takes the room out to the plot edge, a top or bottom label is centred
  // and may run as wide as half the plot.
  const ring = options.variant === 'circular-process' ? circularSide(resolved.rect, plot) : undefined;
  const ringWidth = ring === 'left' ? resolved.rect.x - plot.x - 2 * u
    : ring === 'right' ? plot.x + plot.w - resolved.rect.x - resolved.rect.w - 2 * u
    : plot.w / 2;
  const maxWidth = ring ? Math.max(Math.min(18 * u, plot.w / 4), ringWidth)
    : external ? Math.min(18 * u, plot.w / Math.max(2, options.variant === 'roadmap' ? 5 : 4))
    : resolved.contentRect.w;
  const externalFit = { target: options.target, typeRole: 'label' as const,
    ...(external && !ring ? { wider: plot.w / (options.variant === 'roadmap' ? 5 : 4) } : {}) };
  const id = `node-label:${node.id}`;
  // A cycle step written "Name\nwhat it does" keeps its name above the detail.
  const cut = options.variant === 'circular-process' ? node.label.indexOf('\n') : -1;
  const bold: FontSpec = { ...font, weight: leadWeight };
  const lead = cut > 0 ? fitText(node.label.slice(0, cut), bold, maxWidth, 1, measure, externalFit) : undefined;
  const seat = caption?.seat;
  const primary = seat ? { lines: seat.lines, title: undefined as string | undefined } : lead
    ? (() => {
      const rest = fitText(node.label.slice(cut + 1), font, maxWidth, 2, measure, externalFit);
      return { lines: [...lead.lines, ...rest.lines], title: lead.title ?? rest.title };
    })()
    : fitText(node.label, font, maxWidth, 3, measure, externalFit);
  if (lead) boldLeads.set(id, lead.lines.length);
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const secondaryFont = caption?.secondaryFont ?? font;
  const secondary = node.secondaryLabel ? fitText(node.secondaryLabel, secondaryFont, resolved.contentRect.w, 2, measure, { target: options.target, typeRole: 'label' }) : undefined;
  const secondaryHeight = (secondary?.lines.length ?? 0) * lineH;
  const height = primary.lines.length * lineH;
  const secondaryFits = secondary && !secondary.title && height + secondaryHeight + u <= resolved.contentRect.h;
  const primaryHeight = resolved.contentRect.h - (!external && secondaryFits ? secondaryHeight + u : 0);
  kinds.set(id, 'diagramNode');
  const labelRequest = (block: { lines: string[]; title?: string | undefined }, text: string): LabelRequest => {
    const width = Math.max(1, ...block.lines.map((line, index) => measure(line, index < (lead?.lines.length ?? 0) ? bold : font).width));
    const blockHeight = block.lines.length * lineH;
    const candidates = seat ? [{ slot: 'right', rect: qRect(seat.rect), penalty: 0 }] : !external && blockHeight > primaryHeight + 0.5
      ? [] : external
      ? externalCandidates(
          resolved.rect,
          width,
          blockHeight,
          u,
          options.variant === 'roadmap',
          plot,
          laneBox,
        )
      : [
          {
            slot: 'inside',
            rect: qRect({
              x: start ? resolved.contentRect.x : resolved.contentRect.x + (resolved.contentRect.w - width) / 2,
              y: resolved.contentRect.y + (primaryHeight - blockHeight) / 2,
              w: width,
              h: blockHeight,
            }),
            penalty: 0,
            insideFill: fillCss,
            insidePaint,
          },
        ];
    return {
      id,
      kind: 'point', markAnchored: false, typeRole: 'label',
      owner: nodeOwner(node.id),
      text,
      lines: block.lines,
      ...(block.title !== undefined ? { title: block.title } : {}),
      font,
      priority: PRIORITY.valueLine,
      ...(ring === 'left' ? { align: 'end' as const } : ring === 'above' || ring === 'below' ? { align: 'middle' as const } : { align: 'start' as const }),
      candidates,
    };
  };
  requests.push(labelRequest(primary, node.label));
  // A node with its label outside has no room inside for a second text. Its
  // secondary lines follow the name in one outside block, which settles after
  // the solve (see `settleJoinedLabels`).
  const joined = joinedLabels !== undefined && external && !seat && Boolean(node.secondaryLabel) && !secondaryFits;
  if (joined) {
    joinedLabels.set(id, {
      block: () => {
        const outside = fitText(node.secondaryLabel!, font, maxWidth, 2, measure, externalFit);
        const text = `${node.label}\n${node.secondaryLabel}`;
        const block = { lines: [...primary.lines, ...outside.lines], title: primary.title !== undefined || outside.title !== undefined ? text : undefined };
        return { text, lines: block.lines, title: block.title, seats: labelRequest(block, text).candidates };
      },
      from: { x: resolved.rect.x + resolved.rect.w / 2, y: resolved.rect.y + resolved.rect.h / 2 },
      secondary: () => secondaryRequest(secondary!),
    });
  }
  if (primary.title !== undefined) {
    warnings.push({
      code: 'diagram-node-label-unplaced',
      severity: 'error',
      message: `primary label on node '${node.id}' cannot fit without truncation`,
      owner: nodeOwner(node.id),
    });
  }

  function secondaryRequest(lines: { lines: string[]; title?: string | undefined }): LabelRequest {
    const secondaryWidth = Math.max(1, ...lines.lines.map((line) => measure(line, secondaryFont).width));
    const secondaryId = `secondary-label:${node.id}`;
    kinds.set(secondaryId, 'diagramSecondary');
    return {
      id: secondaryId,
      kind: 'point', markAnchored: false, typeRole: 'label',
      owner: nodeOwner(node.id),
      text: node.secondaryLabel!,
      lines: lines.lines,
      ...(lines.title !== undefined ? { title: lines.title } : {}),
      font: secondaryFont,
      priority: PRIORITY.interior,
      candidates: !secondaryFits ? [] : [
        {
          slot: 'inside-secondary',
          rect: qRect({
            x: caption?.secondaryFont ? resolved.contentRect.x : resolved.contentRect.x + (resolved.contentRect.w - secondaryWidth) / 2,
            y: resolved.contentRect.y + resolved.contentRect.h - secondaryHeight,
            w: secondaryWidth,
            h: secondaryHeight,
          }),
          penalty: 0,
          insideFill: fillCss,
          insidePaint,
        },
      ],
    };
  }
  if (secondary && !joined) requests.push(secondaryRequest(secondary));

  addNodeCaption(node, resolved, options, caption?.font ?? font, measure, u, requests, kinds, caption?.box);
}

/** An outside node label that can take its node's secondary lines as extra lines of one block. */
interface JoinedLabel {
  /** The label text, lines, title and seats of the name with its secondary lines. The seats follow the order of the name's own seats. */
  block: () => { text: string; lines: string[]; title: string | undefined; seats: LabelRequest['candidates'] };
  /** The centre of the node, where a leader starts. */
  from: Point;
  /** The secondary text as a request of its own, which has no seat. */
  secondary: () => LabelRequest;
}

/**
 * Gives each outside node label its secondary lines once every name has its
 * seat. The taller block takes the first of its seats that is clear of every
 * other claim, and the name keeps its own seat where none is, so a secondary
 * text cannot cost any node its name. A secondary text with no room stays
 * unplaced and goes to the note.
 */
function settleJoinedLabels(
  placed: readonly PlacedLabel[],
  joined: ReadonlyMap<string, JoinedLabel>,
  nodes: readonly ResolvedDiagramNode[],
  occupied: OccupiedIndex,
  canvas: Rect,
  ctx: SolveCtx,
): ReturnType<typeof solveLabels> | undefined {
  if (joined.size === 0) return undefined;
  const pad = ctx.labelPad ?? 2;
  const byId = new Map(placed.map(label => [label.id, label]));
  const unplaced: LabelRequest[] = [];
  for (const [id, entry] of joined) {
    const label = byId.get(id);
    const name = label && !label.hidden
      ? occupied.hitsWhich(label.rect, 0).find(claim => claim.kind === 'label' && claim.owner.pointId === label.owner.pointId && sameRect(claim.rect, label.rect))
      : undefined;
    if (!label || !name) {
      unplaced.push(entry.secondary());
      continue;
    }
    // The name gives up its own claim while its taller block looks for a seat.
    occupied.release?.(name);
    const block = entry.block();
    const seat = block.seats.find(candidate => rectContains(canvas, candidate.rect, 0) && !occupied.hits(candidate.rect, pad));
    if (!seat) {
      occupied.claim(label.rect, 'label', label.owner);
      unplaced.push(entry.secondary());
      continue;
    }
    occupied.claim(seat.rect, 'label', label.owner);
    label.rect = seat.rect;
    label.slot = seat.slot;
    label.lines = block.lines;
    label.text = block.text;
    if (block.title === undefined) delete label.title;
    else label.title = block.title;
    const leader = seatLeader(seat.rect, entry.from);
    if (leader) label.leader = leader;
    else delete label.leader;
    const node = nodes.find(candidate => candidate.id === label.owner.pointId);
    if (node) node.secondaryPrinted = true;
  }
  return unplaced.length === 0 ? undefined : solveLabels(unplaced, occupied, ctx);
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** The side of the plot centre a ring node sits on: where its label goes. */
function circularSide(rect: Rect, plot: Rect): 'left' | 'right' | 'above' | 'below' {
  const dx = rect.x + rect.w / 2 - (plot.x + plot.w / 2);
  const dy = rect.y + rect.h / 2 - (plot.y + plot.h / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'above' : 'below';
}

function externalCandidates(
  rect: Rect,
  width: number,
  height: number,
  u: number,
  roadmap: boolean,
  plot: Rect,
  laneBox?: Rect,
): LabelRequest['candidates'] {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const candidates: LabelRequest['candidates'] = [
    {
      slot: 'above',
      rect: qRect({ x: cx - width / 2, y: rect.y - height - 2 * u, w: width, h: height }),
      penalty: 0,
      leaderFrom: { x: cx, y: cy },
    },
    {
      slot: 'below',
      rect: qRect({ x: cx - width / 2, y: rect.y + rect.h + 2 * u, w: width, h: height }),
      penalty: 1,
      leaderFrom: { x: cx, y: cy },
    },
    {
      slot: 'right',
      rect: qRect({ x: rect.x + rect.w + 2 * u, y: cy - height / 2, w: width, h: height }),
      penalty: 2,
      leaderFrom: { x: cx, y: cy },
    },
    {
      slot: 'left',
      rect: qRect({ x: rect.x - width - 2 * u, y: cy - height / 2, w: width, h: height }),
      penalty: 3,
      leaderFrom: { x: cx, y: cy },
    },
  ];
  if (roadmap) {
    // keep a wrapped milestone name inside its phase, clear of the partition.
    if (laneBox && width + 2 * u <= laneBox.w) {
      const x = Math.max(laneBox.x + u, Math.min(laneBox.x + laneBox.w - width - u, cx - width / 2));
      candidates.unshift(...candidates.slice(0, 2).map(candidate => ({ ...candidate,
        slot: `${candidate.slot}InLane`, rect: { ...candidate.rect, x: q(x) } })));
      const clampX = (left: number) => q(Math.max(laneBox.x + u, Math.min(laneBox.x + laneBox.w - width - u, left)));
      for (const above of [true, false]) for (const right of [true, false]) {
        candidates.push({ slot: `${above ? 'above' : 'below'}${right ? 'Right' : 'Left'}InLane`,
          rect: qRect({ x: clampX(right ? rect.x + rect.w + u : rect.x - width - u),
            y: above ? rect.y - height - u : rect.y + rect.h + u, w: width, h: height }),
          penalty: 4, leaderFrom: { x: cx, y: cy } });
      }
    }
    return candidates;
  }
  const plotCentre = { x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 };
  const dx = cx - plotCentre.x;
  const dy = cy - plotCentre.y;
  const radialSlot =
    Math.abs(dx) > Math.abs(dy)
      ? dx < 0
        ? 'left'
        : 'right'
      : dy < 0
        ? 'above'
        : 'below';
  return [
    ...candidates
      .filter((candidate) => candidate.slot === radialSlot)
      .map((candidate) => ({ ...candidate, slot: 'outside', penalty: 0 })),
    ...candidates.map((candidate, index) => ({ ...candidate, penalty: index + 1 })),
  ];
}

function addBoxLabelRequest(
  requests: LabelRequest[],
  kinds: Map<string, DiagramLabelKind>,
  id: string,
  kind: DiagramLabelKind,
  owner: LabelRequest['owner'],
  text: string,
  box: Rect,
  font: FontSpec,
  measure: typeof defaultMeasurer,
  priority: number,
  target: DiagramOptions['target'],
  insideFill?: string,
  insidePaint?: Paint,
  role?: TextRole,
): void {
  // An edge label takes the lines its box was seated for.
  const maxLines = kind === 'diagramEdge' ? Math.max(2, Math.round(box.h / (font.size * (font.lineHeight ?? 1.2)))) : 2;
  const wrapped = fitText(text, font, Math.max(1, box.w - (kind === 'diagramEdge' ? 0 : 8)), maxLines, measure, { target, typeRole: kind === 'diagramBadge' || kind === 'diagramEdge' ? 'label' : 'axis' });
  const lineH = font.size * (font.lineHeight ?? 1.2);
  const width = Math.max(1, ...wrapped.lines.map((line) => measure(line, font).width));
  const height = wrapped.lines.length * lineH;
  kinds.set(id, kind);
  requests.push({
    id,
    kind: 'annotation', typeRole: kind === 'diagramBadge' || kind === 'diagramEdge' ? 'label' : 'axis',
    owner,
    text,
    lines: wrapped.lines,
    ...(wrapped.title !== undefined ? { title: wrapped.title } : {}),
    font,
    priority,
    ...(role ? { role } : {}),
    candidates: [
      {
        slot: 'inside',
        rect: qRect({
          x: box.x + (box.w - width) / 2,
          y: box.y + (box.h - height) / 2,
          w: width,
          h: height,
        }),
        penalty: 0,
        ...(insideFill ? { insideFill, insidePaint } : {}),
      },
    ],
  });
}

function remapLabelKinds(
  labels: PlacedLabel[],
  kinds: ReadonlyMap<string, DiagramLabelKind>,
): void {
  labels.forEach((label) => {
    const kind = kinds.get(label.id);
    if (kind) label.kind = kind as never;
  });
}

function translateLabelLosses(
  labels: readonly PlacedLabel[],
  kinds: ReadonlyMap<string, DiagramLabelKind>,
  warnings: LintWarning[],
): void {
  for (const label of labels) {
    if (!label.hidden) continue;
    const kind = kinds.get(label.id);
    const code =
      kind === 'diagramNode'
        ? 'diagram-node-label-unplaced'
        : kind === 'diagramSecondary'
          ? 'diagram-secondary-label-unplaced'
          : kind === 'diagramCaption'
            ? 'diagram-caption-unplaced'
            : kind === 'diagramBadge' ? 'diagram-size-too-small' : undefined;
    if (!code) continue;
    warnings.push({
      code,
      severity: kind === 'diagramNode' || kind === 'diagramBadge' ? 'error' : 'warn',
      message: `${kind} '${label.text}' has no collision-free placement`,
      ...(kind === 'diagramBadge' ? { suggest: `shorten badge '${label.text}' or give node '${label.owner.pointId}' more space` } : {}),
      ...(kind === 'diagramCaption' ? { suggest: 'increase the canvas height or node spacing; shorten the caption or move it into secondaryLabel if it must stay inside the node' } : {}),
      owner: label.owner,
    });
  }
}

/**
 * A fixed node outside the plot, or two that overlap, are refused with an
 * error lint, not a throw: whether they fit depends on the
 * canvas, so layout and measure answer. Returns the ids refused, which the
 * size lint then leaves out.
 */
function ensurePositionContract(
  authored: readonly DiagramNode[],
  nodes: readonly DiagramNode[],
  rects: ReadonlyMap<string, Rect>,
  plot: Rect,
  warnings: LintWarning[],
): Set<string> {
  // A node its preset did not place is refused later as diagram-node-unplaced.
  const fixed = nodes.filter((node) => node.position && rects.has(node.id));
  const refused = new Set<string>();
  const span = (from: number, size: number) => `${q(from)} to ${q(from + size)}`;
  for (const node of fixed) {
    const rect = rects.get(node.id)!;
    if (!rectContains(plot, rect)) {
      refused.add(node.id);
      warnings.push({
        code: 'fixed-position-outside',
        severity: 'error',
        message: `fixed node '${node.id}' leaves the plot: the node spans x ${span(rect.x, rect.w)} and y ${span(rect.y, rect.h)} px, the plot x ${span(plot.x, plot.w)} and y ${span(plot.y, plot.h)} px`,
        suggest: `move nodes[${node.id}].position inward, or enlarge the canvas`,
        field: ['data', 'nodes', authored.findIndex((candidate) => candidate.id === node.id), 'position'],
        owner: nodeOwner(node.id),
      });
    }
  }
  for (let left = 0; left < fixed.length; left++) {
    for (let right = left + 1; right < fixed.length; right++) {
      const [a, b] = [fixed[left]!, fixed[right]!];
      if (rectsOverlap(rects.get(a.id)!, rects.get(b.id)!)) {
        refused.add(a.id).add(b.id);
        warnings.push({
          code: 'fixed-position-overlap',
          severity: 'error',
          message: `fixed nodes '${a.id}' and '${b.id}' overlap`,
          suggest: `move nodes[${b.id}].position apart from '${a.id}', or enlarge the canvas`,
          field: ['data', 'nodes', authored.findIndex((candidate) => candidate.id === b.id), 'position'],
          owner: nodeOwner(b.id),
        });
      }
    }
  }
  return refused;
}

/**
 * Two items with one order value fall back to id order, which the author did
 * not choose. Groups, lanes and the steps of a process are one sequence
 * each; other node orders rank within a parent or lane and are left alone.
 */
function duplicateOrderWarnings(
  data: { nodes: readonly DiagramNode[]; groups: NonNullable<DiagramData['groups']>; lanes: NonNullable<DiagramData['lanes']> },
  options: DiagramOptions,
): LintWarning[] {
  const sequential = options.variant === 'linear-process' || options.variant === 'circular-process';
  const lists: [string, readonly { id: string; order?: number }[]][] = [
    ['nodes', sequential ? data.nodes : []], ['groups', data.groups], ['lanes', data.lanes],
  ];
  return lists.flatMap(([name, items]) => {
    const byOrder = new Map<number, string[]>();
    for (const item of items) if (item.order !== undefined) byOrder.set(item.order, [...(byOrder.get(item.order) ?? []), item.id]);
    return [...byOrder].filter(([, ids]) => ids.length > 1).map(([order, ids]): LintWarning => ({
      code: 'diagram-order-duplicate',
      severity: 'warn',
      message: `${name} ${ids.map((id) => `'${id}'`).join(', ')} share order ${order}; they are sequenced by id instead`,
      suggest: 'give each item its own order value',
    }));
  });
}

function sizeWarning(
  nodes: readonly ResolvedDiagramNode[],
  plot: Rect,
  warnings: LintWarning[],
  preset: string,
  requiredLabelLosses: number,
): boolean {
  // Node rects snap to half pixels; the frame keeps fractional text metrics.
  const outside = nodes.filter((node) => !rectContains(plot, node.rect, -0.5));
  let overlaps = 0;
  for (let left = 0; left < nodes.length; left++) {
    for (let right = left + 1; right < nodes.length; right++) {
      const a = nodes[left]!;
      const b = nodes[right]!;
      const circles = a.shape.kind === 'circle' && b.shape.kind === 'circle';
      if (circles
        ? Math.hypot(a.rect.x + a.rect.w / 2 - b.rect.x - b.rect.w / 2, a.rect.y + a.rect.h / 2 - b.rect.y - b.rect.h / 2) < (a.rect.w + b.rect.w) / 2 - 0.5
        : rectsOverlap(a.rect, b.rect)) overlaps++;
    }
  }
  if (outside.length === 0 && overlaps === 0 && requiredLabelLosses === 0) return false;
  warnings.push({
    code: 'diagram-size-too-small',
    severity: 'error',
    message: `${preset} does not fit required content (${outside.length} outside, ${overlaps} overlaps, ${requiredLabelLosses} required labels unplaced)`,
  });
  return true;
}

/** Keep the smallest whole-pixel size that the probes actually accept. */
function measuredDiagramMinimum(
  received: { width: number; height: number }, naturalHeight: number, nested: boolean,
  layoutAt: (size: { width: number; height: number }, structuralOnly?: boolean) => DiagramFit,
): { width: number; height: number } | undefined {
  const policy = chartSizing('diagram');
  const floor = { width: received.width, height: nested ? 1 : policy.minHeight };
  const fits = (size: typeof received, structuralOnly = false) =>
    !layoutAt(size, structuralOnly).warnings.some(w => w.severity === 'error');
  let size = { width: floor.width, height: Math.ceil(Math.max(floor.height, naturalHeight)) };
  // Height can solve a crowded tree without widening its columns. Try it
  // first; a label that needs width must not keep multiplying both sides.
  if (!fits(size)) {
    // The diagram floor is 160 px, but the first taller probe starts from the shared 270 px:
    // a short probe never finds a height that fits, and the floor stays too low.
    const taller = { ...size, height: Math.max(size.height, received.height, 270) * 2 };
    if (fits(taller)) size = taller;
    else {
      let found = false;
      for (let pass = 0; pass < 8; pass++) {
        size = { width: size.width * 2, height: Math.max(size.height, received.height) };
        if (fits(size)) { found = true; break; }
        const tall = { ...size, height: Math.max(size.height, received.height) * 2 };
        if (fits(tall)) { size = tall; found = true; break; }
      }
      if (!found) return undefined;
    }
  }
  for (const axis of ['width', 'height'] as const) {
    const minimum = (structuralOnly: boolean) => {
      let low = floor[axis] - 1;
      let high = size[axis];
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        const probe = { ...size, [axis]: mid };
        if (fits(probe, structuralOnly)) high = mid;
        else low = mid;
      }
      return { ...size, [axis]: high };
    };
    // A structural failure is a full failure. Check the structural minimum
    // with routing; if it fails, repeat the original search from its bounds.
    // The current size already fits, so an unchanged minimum needs no check.
    const structural = minimum(true);
    size = structural[axis] === size[axis] || fits(structural) ? structural : minimum(false);
  }
  return size;
}

function diagramA11y(
  data: {
    nodes: DiagramNode[];
    groups: NonNullable<DiagramData['groups']>;
    lanes: NonNullable<DiagramData['lanes']>;
  },
  options: DiagramOptions,
  readingOrder: readonly string[],
  edges: readonly { source: { nodeId: string }; target: { nodeId: string } }[],
): { title: string; desc: string; counts: StructureCount[] } {
  const labels = new Map(data.nodes.map((node) => [node.id, node.label]));
  const order = readingOrder.map((id) => labels.get(id) ?? id).join('; ');
  const relationships = edges
    .map((edge) => `${labels.get(edge.source.nodeId) ?? edge.source.nodeId} → ${labels.get(edge.target.nodeId) ?? edge.target.nodeId}`)
    .join('; ');
  const groups = data.groups
    .map((group) => {
      const members = data.nodes
        .filter((node) => node.groupId === group.id)
        .map((node) => node.label)
        .join(', ');
      return chartString(options, 'containsMembers', { v1: group.title, v2: members || chartString(options, 'noNodes') });
    })
    .join('; ');
  const lanes = data.lanes
    .map((lane) => {
      const members = data.nodes
        .filter((node) => node.laneId === lane.id)
        .map((node) => node.label)
        .join(', ');
      return chartString(options, 'containsMembers', { v1: lane.label ?? lane.id, v2: members || chartString(options, 'noNodes') });
    })
    .join('; ');
  return {
    title: accessibleTitle(options.title, chartString(options, 'diagramTitle', { v1: chartString(options, ({"hierarchy":"diagramHierarchy","issue-tree":"diagramIssueTree","linear-process":"diagramLinearProcess","customer-journey":"diagramCustomerJourney","circular-process":"diagramCircularProcess","strategy-house":"diagramStrategyHouse","roadmap":"diagramRoadmap","architecture":"diagramArchitecture"} as const)[options.variant]) })),
    counts: [structureCount('nodes', data.nodes.length, undefined, options), structureCount('relationships', edges.length, undefined, options)],
    desc: [
      chartString(options, 'diagramDesc', { v1: chartString(options, ({"hierarchy":"diagramHierarchy","issue-tree":"diagramIssueTree","linear-process":"diagramLinearProcess","customer-journey":"diagramCustomerJourney","circular-process":"diagramCircularProcess","strategy-house":"diagramStrategyHouse","roadmap":"diagramRoadmap","architecture":"diagramArchitecture"} as const)[options.variant]), v2: data.nodes.length, v3: edges.length }),
      chartString(options, 'readingOrder', { v1: order }),
      relationships ? chartString(options, 'relationshipsSentence', { v1: relationships }) : '',
      groups ? chartString(options, 'groupsSentence', { v1: groups }) : '',
      lanes ? chartString(options, 'lanesSentence', { v1: lanes }) : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function diagramCategoryKeys(items: readonly { role?: string; paletteKey?: string }[]): string[] {
  return items.flatMap((item) => item.role === 'category' && item.paletteKey ? [item.paletteKey] : []);
}

/** Splits a node label into its name and the detail below it. */
function splitBoldLead(node: SceneNode, boldLeads: ReadonlyMap<string, number>, weight: number): SceneNode[] {
  if (node.t !== 'text' || !node.id.startsWith('label:')) return [node];
  const count = boldLeads.get(node.id.slice('label:'.length));
  if (count === undefined || count >= node.lines.length) {
    return [node];
  }
  const lineH = node.font.size * (node.font.lineHeight ?? 1.2);
  return [
    { ...node, lines: node.lines.slice(0, count), font: { ...node.font, weight } },
    { ...node, id: `${node.id}:detail`, lines: node.lines.slice(count), y: node.y + count * lineH },
  ];
}

/** Card and group text: the labels a narrow diagram card must keep whole. */
const CARD_TEXT_KINDS: ReadonlySet<string> = new Set(['diagramNode', 'diagramSecondary', 'diagramGroup', 'diagramLane']);

function groupStructuralLabels(structuralLabelNodes: SceneNode[]) {
  const laneGroupLabels = structuralLabelNodes.filter((node) =>
    ['diagramLane', 'diagramGroup'].includes(node.part),
  );
  const nodeLabels = structuralLabelNodes.filter((node) =>
    ['diagramNode', 'diagramSecondary'].includes(node.part),
  );
  const accessoryLabels = structuralLabelNodes.filter((node) =>
    ['diagramBadge', 'diagramCaption'].includes(node.part),
  );
  return { laneGroupLabels, nodeLabels, accessoryLabels };
}

function addNodeCaption(
  node: DiagramNode, resolved: ResolvedDiagramNode, options: DiagramOptions,
  font: FontSpec, measure: typeof defaultMeasurer, u: number,
  requests: LabelRequest[], kinds: Map<string, DiagramLabelKind>,
  box?: { rect: Rect; lines: string[] },
): void {
  const lineH = font.size * (font.lineHeight ?? 1.2);
  if (node.caption && box) {
    const captionId = `caption-label:${node.id}`;
    kinds.set(captionId, 'diagramCaption');
    requests.push({ id: captionId, kind: 'annotation', typeRole: 'label', owner: nodeOwner(node.id), text: node.caption,
      lines: box.lines, font, priority: PRIORITY.interior, candidates: [{ slot: 'below', rect: qRect(box.rect), penalty: 0 }] });
  } else if (node.caption) {
    const caption = fitText(node.caption, font, Math.max(resolved.rect.w, 16 * u), 2, measure, { target: options.target, typeRole: 'label' });
    const captionWidth = Math.max(1, ...caption.lines.map((line) => measure(line, font).width));
    const captionHeight = caption.lines.length * lineH;
    const captionId = `caption-label:${node.id}`;
    kinds.set(captionId, 'diagramCaption');
    requests.push({
      id: captionId,
      kind: 'annotation', typeRole: 'label',
      owner: nodeOwner(node.id),
      text: node.caption,
      lines: caption.lines,
      ...(caption.title !== undefined ? { title: caption.title } : {}),
      font,
      priority: PRIORITY.interior,
      candidates: [
        {
          slot: 'below',
          rect: qRect({
            x: resolved.rect.x + (resolved.rect.w - captionWidth) / 2,
            y:
              resolved.rect.y +
              resolved.rect.h +
              (options.variant === 'linear-process' ? u : 2 * u),
            w: captionWidth,
            h: captionHeight,
          }),
          penalty: 0,
        },
        {
          slot: 'above',
          rect: qRect({
            x: resolved.rect.x + (resolved.rect.w - captionWidth) / 2,
            y: resolved.rect.y - captionHeight - 2 * u,
            w: captionWidth,
            h: captionHeight,
          }),
          penalty: 1,
        },
      ],
    });
  }
}

/** Frame-filling presets need an intrinsic height independent of their current lane bounds. */
function naturalDiagramSizing(
  options: DiagramOptions, data: Pick<NormalizedDiagram, 'nodes' | 'groups'>, sizes: ReadonlyMap<string, { width: number; height: number }>,
  font: FontSpec, measure: typeof defaultMeasurer, u: number, measured: ReturnType<typeof contentSizing>, size: { height: number }, plot: Rect,
  headFont: FontSpec = font,
) {
  const nodes = data.nodes;
  const authored = nodes.length > 0 && nodes.every(node => node.position !== undefined);
  const linear = options.variant === 'linear-process';
  if (options.variant === 'strategy-house' && !authored) {
    return { ...measured, naturalHeight: Math.ceil(Math.max(measured.minHeight, size.height - plot.h + strategyHouseBands(data, plot.w, u, font, measure, headFont).height)) };
  }
  if (options.variant !== 'circular-process' && options.variant !== 'roadmap' && !authored && !linear) return measured;
  let plotHeight = plot.w;
  if (linear) {
    const width = (plot.w - u * (nodes.length - 1)) / nodes.length;
    const captions = nodes.filter(node => node.caption).map(node => wrapText(node.caption!, font, Math.max(width, 16 * u), 2, measure).lines.length * font.size * (font.lineHeight ?? 1.2));
    plotHeight = 2 * u + Math.max(12 * u, maxOf([...sizes.values()].map(size => size.height))) + (captions.length ? u + maxOf(captions) : 0);
  }
  else if (authored) plotHeight = authoredPlotHeight(nodes, sizes, plot.w, u);
  else if (options.variant === 'circular-process') {
    // The ring with a name-and-detail band above and below it.
    const { diameter, radius } = circularRing(nodes, { w: plot.w, h: Infinity }, u, { font, measure });
    plotHeight = 2 * radius + diameter + 2 * circularLabelBand(font, u);
  }
  else if (options.variant === 'roadmap') {
    const milestones = nodes.filter(node => node.kind === 'milestone');
    const lineH = font.size * (font.lineHeight ?? 1.2);
    const rows = milestones.map(node => {
      const diameter = Math.min(4 * u, sizes.get(node.id)!.height);
      const labelHeight = wrapText(node.label, font, Math.min(18 * u, plot.w / 5), 3, measure).lines.length * lineH;
      const captionHeight = node.caption
        ? wrapText(node.caption, font, Math.max(diameter, 16 * u), 2, measure).lines.length * lineH + 2 * u : 0;
      return diameter + 2 * u + labelHeight + captionHeight;
    });
    // Roadmap already reserves a 7u header, 6u above the trajectory and 7u below it.
    plotHeight = 20 * u + rows.reduce((total, height) => total + height, 0);
  }
  return { ...measured, naturalHeight: Math.ceil(Math.max(measured.minHeight, size.height - plot.h + plotHeight)) };
}

/** Solve normalized authored centres against measured node extents, without moving the centres. */
function authoredPlotHeight(
  nodes: readonly DiagramNode[], sizes: ReadonlyMap<string, { width: number; height: number }>, width: number, u: number,
): number {
  let height = 0;
  for (const node of nodes) {
    const y = node.position!.y;
    const half = sizes.get(node.id)!.height / 2;
    if (y > 0 && y < 1) height = Math.max(height, half / y, half / (1 - y));
  }
  for (let i = 0; i < nodes.length; i++) for (const other of nodes.slice(i + 1)) {
    const node = nodes[i]!;
    const first = sizes.get(node.id)!;
    const second = sizes.get(other.id)!;
    const dx = Math.abs(node.position!.x - other.position!.x) * width;
    const dy = Math.abs(node.position!.y - other.position!.y);
    if (dx < (first.width + second.width) / 2 && dy > 0) {
      height = Math.max(height, ((first.height + second.height) / 2 + 3 * u) / dy);
    }
  }
  return height;
}
