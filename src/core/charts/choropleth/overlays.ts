import { fmtPathNumber as fmt } from '../../curve';
import { localeStrings } from '../../strings/choropleth';
import { chartString } from '../../strings/choropleth';
import type { LegendItemInput } from '../../frame';
import { boxGap, rectContains, rectsOverlap, type Point, type Rect } from '../../geometry';
import { compileIcon, isIconName, listIcons } from '../../icons';
import type { OccupiedIndex } from '../../label/occupied';
import {
  leaderTerminus,
  PRIORITY,
  solveLabels,
  type SlotCandidate,
  type SolveCtx,
} from '../../label/solver';
import { NormalizeError } from '../../normalize/shared';
import { strokeToken, markRoleToken } from '../../theme';
import type { FontSpec, TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { LintWarning, Paint, PlacedLabel, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import type {
  GeoOverlay,
  GeoOverlayGlyph,
  GeoOverlayLegendModel,
  GeoOverlayRenderResult,
  GeoOverlaySize,
  GeoOverlayTone,
} from './overlayTypes';

interface RenderGeoOverlaysInput {
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>;
  overlays: readonly GeoOverlay[];
  resolveAnchor: (overlay: GeoOverlay, index: number) => Point;
  occupied: OccupiedIndex;
  solveCtx: SolveCtx;
  theme: Theme;
  measure: TextMeasurer;
  /** Base geography is a canvas, not a collision blocker. */
  ignoredBaseParts: ReadonlySet<string>;
  /** Only the seats beside the glyph, no leader seats (tile maps: a leader would cross other tiles). */
  adjacentOnly?: boolean;
  /** Overlays whose text an earlier pass moved to a note: their glyph is drawn, their text is not. */
  textless?: ReadonlySet<string>;
  /** Crowded choropleth glyphs move to the note together with their labels. */
  omitted?: ReadonlySet<string>;
  /** The map frame: an omitted glyph whose anchor lies outside it is named as cropped, not as crowded. */
  frame?: Rect;
  /** Key words an omitted glyph keeps in its note line, since its key entry goes with it. */
  toneNames?: Partial<Record<GeoOverlayTone, string>>;
  overlayMeasure?: string;
}

const SIZE: Record<GeoOverlaySize, number> = { sm: 12, md: 16, lg: 22 };
/** The map frame sits this far inside the plot, so an anchor just beyond a simplified coastline stays on the canvas. */
const FRAME_SLACK = 8;
/** A glyph whose anchor lies outside the map frame (a crop dropped its region) cannot be drawn. */
export const geoOverlayInFrame = (anchor: Point, frame: Rect): boolean => rectContains(frame, { ...anchor, w: 0, h: 0 }, -FRAME_SLACK);
export const geoOverlayDiameter = (overlay: GeoOverlay): number => SIZE[overlay.size ?? 'md'];

/** Reserve glyphs before solving region labels. Rendering reuses these exact claims. */
export function reserveGeoOverlayGlyphs(
  overlays: readonly GeoOverlay[],
  resolveAnchor: RenderGeoOverlaysInput['resolveAnchor'],
  occupied: OccupiedIndex,
): void {
  validateGeoOverlays(overlays);
  overlays.forEach((overlay, index) => {
    const anchor = resolveAnchor(overlay, index);
    const diameter = geoOverlayDiameter(overlay);
    occupied.claim({ x: anchor.x - diameter / 2, y: anchor.y - diameter / 2, w: diameter, h: diameter },
      'mark', { categoryId: `overlay:${overlay.id}` }, 'overlayGlyph');
  });
}
const GLYPH_LABEL_GAP = 5;
const SPREAD_GAP = 7;

function validateGeoOverlays(overlays: readonly GeoOverlay[]): void {
  const ids = new Set<Id>();
  overlays.forEach((overlay, index) => {
    if (!overlay?.id) {
      throw new NormalizeError('missing-id', `overlays[${index}]`, 'overlay requires an id');
    }
    if (ids.has(overlay.id)) {
      throw new NormalizeError(
        'duplicate-id',
        `overlays[${index}].id`,
        `duplicate overlay id '${overlay.id}'`,
      );
    }
    ids.add(overlay.id);
    if (!overlay.label) {
      throw new NormalizeError(
        'overlay-label-required',
        `overlays[${index}].label`,
        'every overlay requires an accessible label',
      );
    }
    if ('lon' in overlay.at) {
      if (
        !Number.isFinite(overlay.at.lon) ||
        !Number.isFinite(overlay.at.lat) ||
        overlay.at.lon < -180 ||
        overlay.at.lon > 180 ||
        overlay.at.lat < -90 ||
        overlay.at.lat > 90
      ) {
        throw new NormalizeError(
          'overlay-coordinate-invalid',
          `overlays[${index}].at`,
          `overlay '${overlay.id}' has invalid longitude/latitude`,
        );
      }
    }
    validateGlyph(overlay.glyph, index);
  });
}

/** A share label has one paint across the entire overlay key and drawing. */
function pieSharePaints(overlays: readonly GeoOverlay[]): Map<string, Paint> {
  const paints = new Map<string, Paint>();
  const explicit = new Map<string, GeoOverlayTone>();
  overlays.forEach((overlay, oi) => {
    if (overlay.glyph.kind !== 'pie') return;
    overlay.glyph.shares.forEach((share, si) => {
      if (!paints.has(share.label)) paints.set(share.label, tonePaint(si === 0 ? undefined : 'neutral'));
      if (share.tone === undefined) return;
      const previous = explicit.get(share.label);
      if (previous !== undefined && previous !== share.tone) {
        throw new NormalizeError('overlay-share-tone-conflict', `overlays[${oi}].glyph.shares[${si}].tone`,
          `pie share '${share.label}' uses both '${previous}' and '${share.tone}'`,
          'use the same tone for this share label in every overlay pie');
      }
      explicit.set(share.label, share.tone);
      paints.set(share.label, tonePaint(share.tone));
    });
  });
  return paints;
}

/** The words a toned overlay key entry prints when the spec names none. */
const DEFAULT_TONE_NAMES: Record<GeoOverlayTone, string> = {
  good: localeStrings().overlayGood, bad: localeStrings().overlayBad, warn: localeStrings().overlayWarn, neutral: localeStrings().overlayNeutral, info: localeStrings().overlayInfo,
};

/**
 * The overlay key explains only what the direct labels cannot: every
 * overlay prints its own label beside its glyph, and a Harvey ball, marker or
 * icon in the plain colour needs no entry. What the key adds is a toned glyph
 * among plain ones (named by `overlayTones`), each status a status glyph
 * shows, and each share a pie splits into.
 */
export function geoOverlayLegend(
  overlays: readonly GeoOverlay[],
  toneNames: Partial<Record<GeoOverlayTone, string>> = {},
  measure?: string,
  // The unnamed-measure warning reads every authored overlay, also ones omitted from the drawing.
  authored: readonly GeoOverlay[] = overlays,
  options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>,
): GeoOverlayLegendModel {
  validateGeoOverlays(overlays);
  const sharePaints = pieSharePaints(authored);
  const items: LegendItemInput[] = [];
  const warnings: LintWarning[] = [];
  // Name the drawn overlay measure as a heading, apart from region colour keys.
  const harvey = authored.some((overlay) => overlay.glyph.kind === 'harvey');
  if (measure && overlays.length) {
    items.push({ id: 'overlay-measure', label: measure, paint: tonePaint(undefined), key: 'heading' });
  } else if (harvey) {
    warnings.push({
      code: 'geo-overlay-measure-unnamed',
      severity: 'warn',
      message: 'the Harvey-ball overlays show a value, and no key names what it measures, so the reader has to guess',
      suggest: "name it in overlayMeasure, e.g. overlayMeasure: 'Activation progress, %'",
    });
  }
  const seen = new Set<string>();
  const unnamed = new Set<GeoOverlayTone>();
  const toneItem = (tone: GeoOverlayTone, key: 'marker' | 'diamond' | 'box', hollow = false) => {
    const identity = `tone:${tone}:${key}:${hollow}`;
    if (seen.has(identity)) return;
    const repeated = items.some(item => item.id === `overlay-tone:${tone}`);
    seen.add(identity);
    if (!toneNames[tone]) unnamed.add(tone);
    items.push({ id: `overlay-tone:${tone}${repeated ? `:${key}:${hollow ? 'ring' : 'solid'}` : ''}`,
      label: toneNames[tone] ?? chartString(options, ({ good: 'overlayGood', bad: 'overlayBad', warn: 'overlayWarn', neutral: 'overlayNeutral', info: 'overlayInfo' } as const)[tone]), key,
      paint: hollow ? { token: 'background' } : tonePaint(tone), ...(hollow ? { stroke: tonePaint(tone) } : {}) });
  };
  const plain = overlays.flatMap(({ glyph }) => {
    if (glyph.kind !== 'harvey' && glyph.kind !== 'icon' && glyph.kind !== 'marker') return [];
    return [{ tone: glyph.tone, hollow: glyph.kind !== 'marker',
      key: glyph.kind === 'marker' && glyph.shape === 'square' ? 'box' as const
        : glyph.kind === 'marker' && glyph.shape === 'diamond' ? 'diamond' as const : 'marker' as const }];
  });
  // One colour on every glyph carries no information; with two or more, the
  // plain glyph (no tone) is the unmarked case and every tone is keyed, info
  // included, since info paints apart from plain.
  const tones = [...plain.map(glyph => glyph.tone), ...overlays.flatMap(({ glyph }) => glyph.kind === 'status' ? [glyph.status] : [])];
  if (new Set(tones).size > 1) {
    for (const glyph of plain) if (glyph.tone !== undefined) toneItem(glyph.tone, glyph.key, glyph.hollow);
  }
  for (const overlay of overlays) {
    if (overlay.glyph.kind === 'status') toneItem(overlay.glyph.status, 'marker');
    if (overlay.glyph.kind === 'pie') {
      overlay.glyph.shares.forEach((share) => {
        if (seen.has(`share:${share.label}`)) return;
        seen.add(`share:${share.label}`);
        items.push({ id: `overlay-share:${share.label}`, label: share.label, paint: sharePaints.get(share.label)! });
      });
    }
  }
  if (unnamed.size) {
    const tones = [...unnamed];
    warnings.push({
      code: 'geo-overlay-tone-unnamed',
      severity: 'warn',
      message: `overlay tone${tones.length === 1 ? '' : 's'} ${tones.join(', ')} ${tones.length === 1 ? 'has' : 'have'} no name, so the key says '${tones.map((tone) => DEFAULT_TONE_NAMES[tone]).join("', '")}' and the reader has to guess what it marks`,
      suggest: `name ${tones.length === 1 ? 'it' : 'them'} in overlayTones, e.g. overlayTones: { ${tones[0]}: '...' }`,
    });
  }
  return { items, descriptions: overlays.map(overlay => describeOverlay(overlay, options)), warnings };
}

export function renderGeoOverlays(input: RenderGeoOverlaysInput): GeoOverlayRenderResult {
  validateGeoOverlays(input.overlays);
  const sharePaints = pieSharePaints(input.overlays);
  const font: FontSpec = {
    family: input.theme.type.family,
    ...input.theme.type.label,
  };
  // Every glyph sits on its anchor; only its text moves. The glyphs
  // are claimed first, so no text and no leader lands on another overlay.
  const glyphs = input.overlays.map((overlay, index) => {
    const anchor = input.resolveAnchor(overlay, index);
    const diameter = geoOverlayDiameter(overlay);
    const rect: Rect = { x: anchor.x - diameter / 2, y: anchor.y - diameter / 2, w: diameter, h: diameter };
    const owner = { categoryId: `overlay:${overlay.id}` };
    if (!input.omitted?.has(overlay.id) && !input.occupied.snapshot().some((claim) => claim.part === 'overlayGlyph' && claim.owner.categoryId === owner.categoryId)) {
      input.occupied.claim(rect, 'mark', owner, 'overlayGlyph');
    }
    return { overlay, anchor, rect, owner, description: overlay.a11y ?? describeOverlay(overlay, input.options) };
  });

  const visibleClaims = (rect: Rect, pad = 0) =>
    input.occupied
      .hitsWhich(rect, pad)
      .filter(
        (claim) =>
          !(claim.kind === 'mark' && claim.part && input.ignoredBaseParts.has(claim.part)),
      );
  const overlayOccupied: OccupiedIndex = {
    claim: (rect, kind, owner, part) => input.occupied.claim(rect, kind, owner, part),
    hits: (rect, pad = 0) => visibleClaims(rect, pad).length > 0,
    hitsWhich: visibleClaims,
    snapshot: () => input.occupied.snapshot(),
  };

  const glyphNodes: SceneNode[] = [];
  const leaderNodes: SceneNode[] = [];
  const textNodes: SceneNode[] = [];
  const marks: GeoOverlayRenderResult['marks'] = [];
  const labels: PlacedLabel[] = [];
  const warnings: GeoOverlayRenderResult['warnings'] = [];
  const decisions: GeoOverlayRenderResult['decisions'] = [];
  glyphs.forEach(({ overlay, anchor, rect, owner, description }, index) => {
    if (input.omitted?.has(overlay.id)) {
      const hidden = solveLabels([{
        id: `overlay:${overlay.id}`, kind: 'point', typeRole: 'label', owner,
        text: overlay.label, lines: [overlay.label], font, priority: PRIORITY.extreme + index,
        candidates: [], redundant: true, suppressedAs: 'density', owed: true,
        noteText: omittedNote(overlay, description, input.toneNames, input.overlayMeasure),
      }], overlayOccupied, input.solveCtx);
      labels.push(...hidden.placed);
      decisions.push(...hidden.decisions);
      if (input.frame && !geoOverlayInFrame(anchor, input.frame)) {
        warnings.push({ code: 'overlay-coordinate-outside-frame', severity: 'warn',
          message: `overlay '${overlay.id}' lies outside the map frame, so its glyph is not drawn; its label is listed in the note`,
          owner, suggest: 'move the overlay inside the mapped area, or place it on a region with at.region' });
        return;
      }
      warnings.push({ code: 'geo-overlay-no-space', severity: 'warn',
        message: `overlay '${overlay.id}' at its geographic anchor overlaps another glyph; its label is listed in the note`,
        owner, suggest: 'use smaller glyphs or a wider map' });
      return;
    }
    const visibleGlyphs = glyphs.filter(other => !input.omitted?.has(other.overlay.id));
    const collisions = glyphs.slice(0, index).filter(other => !input.omitted?.has(other.overlay.id) && rectsOverlap(rect, other.rect));
    if (collisions.length) warnings.push({ code: 'geo-overlay-collision', severity: 'warn',
      message: `overlay '${overlay.id}' overlaps glyphs ${collisions.map((other) => `'${other.overlay.id}'`).join(', ')} at its geographic anchor`,
      suggest: 'use fewer overlays at this location, smaller glyphs, or a larger map' });
    if (input.textless?.has(overlay.id)) {
      const nodes = glyphScene(overlay, rect, input.theme, description, sharePaints);
      glyphNodes.push(...nodes);
      marks.push({ id: overlay.id, glyph: overlay.glyph.kind, nodeIds: nodes.map((node) => String(node.id)), labelId: `overlay:${overlay.id}`, anchor, description });
      return;
    }
    const measured = input.measure(overlay.label, font);
    // A leader may not cross another overlay's glyph or text.
    const others = [
      ...visibleGlyphs.filter((other) => other.overlay.id !== overlay.id).map((other) => other.rect),
      ...labels.filter((label) => !label.hidden).map((label) => label.rect),
    ];
    const candidates = textCandidates(anchor, rect.w, measured.width, measured.height).filter((candidate) =>
      (input.adjacentOnly || (!visibleGlyphs.some(other => rectsOverlap(candidate.rect, other.rect)) &&
        visibleGlyphs.every(other => other.overlay.id === overlay.id || boxGap(candidate.rect, rect) <= boxGap(candidate.rect, other.rect)))) &&
      (!candidate.leaderFrom || (!input.adjacentOnly && !others.some((other) => segmentHitsRect(anchor, leaderTerminus(candidate.rect, anchor), other)))));
    const solved = solveLabels([{
      id: `overlay:${overlay.id}`,
      kind: 'point', typeRole: 'label',
      owner,
      text: overlay.label,
      lines: [overlay.label],
      font,
      priority: PRIORITY.extreme + index,
      candidates,
    }], overlayOccupied, input.solveCtx);
    warnings.push(...solved.warnings);
    decisions.push(...solved.decisions);
    const label = solved.placed[0]!;
    labels.push(label);
    const nodes = glyphScene(overlay, rect, input.theme, description, sharePaints);
    glyphNodes.push(...nodes);
    marks.push({
      id: overlay.id,
      glyph: overlay.glyph.kind,
      nodeIds: nodes.map((node) => String(node.id)),
      labelId: String(label.id),
      anchor,
      description,
    });
    if (label.hidden) return;
    if (label.leader) {
      leaderNodes.push({
        t: 'path',
        id: `leader:${label.id}`,
        d: label.leader.d,
        stroke: { token: 'leader' },
        width: strokeToken(input.theme, 'rule'),
        owner,
        part: 'leader',
        display: { state: description },
      });
      claimLeader(anchor, leaderTerminus(label.rect, anchor), input.occupied, owner);
    }
    const nodeId = `label:${label.id}`;
    label.nodeId = nodeId;
    textNodes.push({
      t: 'text', typeRole: 'label',
      id: nodeId,
      x: label.rect.x,
      y: label.rect.y,
      lines: [overlay.label],
      align: 'start',
      font,
      ink: { token: 'ink' },
      // The text sits on the geography, so it always takes the page halo.
      halo: true,
      owner,
      part: 'overlayLabel',
      display: { state: description },
    });
  });

  return {
    // Leaders under the glyphs they start from, text on top.
    nodes: [...leaderNodes, ...glyphNodes, ...textNodes],
    labels,
    marks,
    warnings,
    decisions,
    descriptions: glyphs.map((glyph) => glyph.description),
  };
}

function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let step = 0; step <= steps; step++) {
    const x = a.x + ((b.x - a.x) * step) / steps;
    const y = a.y + ((b.y - a.y) * step) / steps;
    if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) return true;
  }
  return false;
}

function claimLeader(a: Point, b: Point, occupied: OccupiedIndex, owner: { categoryId: string }): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  for (let step = 0; step < steps; step++) {
    const x1 = a.x + ((b.x - a.x) * step) / steps;
    const y1 = a.y + ((b.y - a.y) * step) / steps;
    const x2 = a.x + ((b.x - a.x) * (step + 1)) / steps;
    const y2 = a.y + ((b.y - a.y) * (step + 1)) / steps;
    occupied.claim({ x: Math.min(x1, x2) - 0.6, y: Math.min(y1, y2) - 0.6, w: Math.abs(x2 - x1) + 1.2, h: Math.abs(y2 - y1) + 1.2 }, 'reserved', owner, 'overlayLeader');
  }
}

function validateGlyph(glyph: GeoOverlayGlyph, index: number): void {
  if (glyph.kind === 'pie') {
    if (!Array.isArray(glyph.shares) || glyph.shares.length < 2) {
      throw new NormalizeError(
        'overlay-pie-shares',
        `overlays[${index}].glyph.shares`,
        'overlay pie requires at least two shares',
      );
    }
    if (
      glyph.shares.some((share) => !Number.isFinite(share.value) || share.value < 0) ||
      glyph.shares.reduce((sum, share) => sum + share.value, 0) <= 0
    ) {
      throw new NormalizeError(
        'overlay-pie-total',
        `overlays[${index}].glyph.shares`,
        'overlay pie shares must be non-negative with a positive total',
      );
    }
  } else if (glyph.kind === 'harvey' && (!Number.isFinite(glyph.value) || glyph.value < 0 || glyph.value > 1)) {
    throw new NormalizeError(
      'overlay-harvey-range',
      `overlays[${index}].glyph.value`,
      'overlay Harvey value must be between 0 and 1',
    );
  } else if (glyph.kind === 'icon' && !isIconName(glyph.name)) {
    throw new NormalizeError(
      'overlay-icon-unknown',
      `overlays[${index}].glyph.name`,
      `unknown icon '${String(glyph.name)}'`,
      `valid icons: ${listIcons().join(', ')}`,
    );
  }
}

function describeOverlay(overlay: GeoOverlay, options?: Pick<import('../../types/options').BaseOptions, 'locale' | 'strings'>): string {
  const where = 'region' in overlay.at
    ? chartString(options, 'overlayRegionLocation', { v1: overlay.at.region })
    : chartString(options, 'overlayCoordinateLocation', { v1: overlay.at.lon, v2: overlay.at.lat });
  if (overlay.glyph.kind === 'harvey') {
    return chartString(options, 'overlayHarveyDesc', { v1: overlay.label, v2: Math.round(overlay.glyph.value * 100), v3: where });
  }
  if (overlay.glyph.kind === 'status') {
    return chartString(options, 'overlayStatusDesc', { v1: overlay.label, v2: chartString(options, ({good: 'toneGood', bad: 'toneBad', warn: 'toneWarn', neutral: 'toneNeutral', info: 'overlayInfo'} as const)[overlay.glyph.status]), v3: where });
  }
  if (overlay.glyph.kind === 'pie') {
    return chartString(options, 'overlayPieDesc', { v1: overlay.label, v2: overlay.glyph.shares.map((share) => `${share.label} ${share.value}`).join(', '), v3: where });
  }
  if (overlay.glyph.kind === 'icon') {
    return chartString(options, 'overlayIconDesc', { v1: overlay.label, v2: overlay.glyph.name, v3: where });
  }
  return chartString(options, 'overlayMarkerDesc', { v1: overlay.label, v2: chartString(options, ({ circle: 'circleShape', square: 'squareShape', diamond: 'diamondShape' } as const)[overlay.glyph.shape ?? 'circle']), v3: where });
}

/** An omitted glyph leaves the key too, so its note line carries the tone name and the measure. */
function omittedNote(overlay: GeoOverlay, description: string, toneNames: Partial<Record<GeoOverlayTone, string>> = {}, measure?: string): string {
  const tone = overlay.glyph.kind === 'status' ? overlay.glyph.status : 'tone' in overlay.glyph ? overlay.glyph.tone : undefined;
  const toneName = tone === undefined ? undefined : toneNames[tone] ?? DEFAULT_TONE_NAMES[tone];
  return [description, toneName, measure].filter(Boolean).join(', ');
}

/** A glyph without a tone takes the accent; info is its own ink, so a key can name it. */
function tonePaint(tone: GeoOverlayTone | undefined): Paint {
  if (tone === undefined) return { token: 'highlight' };
  if (tone === 'info') return { token: 'ink' };
  return { token: markRoleToken(tone) };
}

/** Text slots around a glyph on its anchor: beside it first, then rings farther out on a leader. */
function textCandidates(
  anchor: Point,
  diameter: number,
  width: number,
  height: number,
): SlotCandidate[] {
  const edge = diameter / 2 + GLYPH_LABEL_GAP;
  const out: SlotCandidate[] = [
    { slot: 'right', rect: { x: anchor.x + edge, y: anchor.y - height / 2, w: width, h: height }, penalty: 0, needsBacking: true },
    { slot: 'left', rect: { x: anchor.x - edge - width, y: anchor.y - height / 2, w: width, h: height }, penalty: 1, needsBacking: true },
    { slot: 'above', rect: { x: anchor.x - width / 2, y: anchor.y - edge - height, w: width, h: height }, penalty: 2, needsBacking: true },
    { slot: 'below', rect: { x: anchor.x - width / 2, y: anchor.y + edge, w: width, h: height }, penalty: 3, needsBacking: true },
  ];
  const directions: readonly [string, number, number][] = [
    ['right', 1, 0],
    ['left', -1, 0],
    ['above', 0, -1],
    ['below', 0, 1],
    ['aboveRight', Math.SQRT1_2, -Math.SQRT1_2],
    ['aboveLeft', -Math.SQRT1_2, -Math.SQRT1_2],
    ['belowRight', Math.SQRT1_2, Math.SQRT1_2],
    ['belowLeft', -Math.SQRT1_2, Math.SQRT1_2],
  ];
  for (const ring of [1, 2, 3] as const) {
    const distance = edge + ring * (height + SPREAD_GAP);
    for (const [name, ux, uy] of directions) {
      const cx = anchor.x + ux * distance;
      const cy = anchor.y + uy * distance;
      out.push({
        slot: `${name}:${ring}`,
        rect: {
          x: ux < -0.1 ? cx - width : ux > 0.1 ? cx : cx - width / 2,
          y: uy < -0.1 ? cy - height : uy > 0.1 ? cy : cy - height / 2,
          w: width,
          h: height,
        },
        penalty: out.length,
        leaderFrom: anchor,
        ...(ux === 0 ? { leaderVertical: true } : {}),
        needsBacking: true,
      });
    }
  }
  return out;
}

function glyphScene(
  overlay: GeoOverlay,
  rect: Rect,
  _theme: Theme,
  description: string,
  sharePaints: ReadonlyMap<string, Paint>,
): SceneNode[] {
  const glyph = overlay.glyph;
  const owner = { categoryId: `overlay:${overlay.id}` };
  const id = `overlay:glyph:${overlay.id}`;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = rect.w / 2;
  const display = { state: description };
  if (glyph.kind === 'status') {
    return [{
      t: 'circle',
      id,
      cx,
      cy,
      r,
      fill: tonePaint(glyph.status),
      stroke: { token: 'background' }, strokeWidth: strokeToken(_theme, 'mark'),
      owner,
      part: 'overlayGlyph',
      display,
    }];
  }
  if (glyph.kind === 'marker') {
    const paint = tonePaint(glyph.tone);
    if ((glyph.shape ?? 'circle') === 'circle') {
      return [{ t: 'circle', id, cx, cy, r, fill: paint, owner, part: 'overlayGlyph', display }];
    }
    if (glyph.shape === 'square') {
      return [{ t: 'rect', id, rect, fill: paint, owner, part: 'overlayGlyph', display }];
    }
    return [{
      t: 'path',
      id,
      d: `M${fmt(cx)} ${fmt(rect.y)}L${fmt(rect.x + rect.w)} ${fmt(cy)}L${fmt(cx)} ${fmt(rect.y + rect.h)}L${fmt(rect.x)} ${fmt(cy)}Z`,
      fill: paint,
      owner,
      part: 'overlayGlyph',
      display,
    }];
  }
  if (glyph.kind === 'icon') {
    const paint = tonePaint(glyph.tone);
    const inner: Rect = {
      x: rect.x + rect.w * 0.2,
      y: rect.y + rect.h * 0.2,
      w: rect.w * 0.6,
      h: rect.h * 0.6,
    };
    const nodes: SceneNode[] = [{
      t: 'circle',
      id: `${id}:chip`,
      cx,
      cy,
      r,
      fill: { token: 'background' },
      stroke: paint, strokeWidth: strokeToken(_theme, 'mark'),
      owner,
      part: 'overlayGlyph',
      display,
    }];
    compileIcon(glyph.name, inner).forEach((primitive, index) => {
      nodes.push(
        primitive.kind === 'path'
          ? {
              t: 'path',
              id: `${id}:icon:${index}`,
              d: primitive.d,
              stroke: paint,
              width: strokeToken(_theme, 'rule'),
              owner,
              part: 'overlayGlyph',
              display,
            }
          : {
              t: 'circle',
              id: `${id}:icon:${index}`,
              cx: primitive.cx,
              cy: primitive.cy,
              r: primitive.r,
              fill: { token: 'background' },
              stroke: paint, strokeWidth: strokeToken(_theme, 'mark'),
              owner,
              part: 'overlayGlyph',
              display,
            },
      );
    });
    return nodes;
  }
  if (glyph.kind === 'harvey') {
    const paint = tonePaint(glyph.tone);
    const nodes: SceneNode[] = [{
      t: 'circle',
      id: `${id}:base`,
      cx,
      cy,
      r,
      fill: { token: 'background' },
      stroke: paint, strokeWidth: strokeToken(_theme, 'mark'),
      owner,
      part: 'overlayGlyph',
      display,
    }];
    if (glyph.value >= 1) {
      nodes.push({ t: 'circle', id, cx, cy, r, fill: paint, owner, part: 'overlayGlyph', display });
    } else if (glyph.value > 0) {
      nodes.push({
        t: 'path',
        id,
        d: sectorPath(cx, cy, r, glyph.value),
        fill: paint,
        owner,
        part: 'overlayGlyph',
        display,
      });
    }
    return nodes;
  }

  const total = glyph.shares.reduce((sum, share) => sum + share.value, 0);
  let start = -Math.PI / 2;
  const nodes: SceneNode[] = [];
  glyph.shares.forEach((share, index) => {
    const fraction = share.value / total;
    if (fraction <= 0) return;
    const paint = sharePaints.get(share.label)!;
    if (fraction >= 1) {
      nodes.push({
        t: 'circle',
        id: `${id}:${index}`,
        cx,
        cy,
        r,
        fill: paint,
        owner,
        part: 'overlayGlyph',
        display,
      });
    } else {
      const end = start + Math.PI * 2 * fraction;
      nodes.push({
        t: 'path',
        id: `${id}:${index}`,
        d: arcSectorPath(cx, cy, r, start, end),
        fill: paint,
        stroke: { token: 'background' },
        width: strokeToken(_theme, 'rule'),
        owner,
        part: 'overlayGlyph',
        display,
      });
      start = end;
    }
  });
  return nodes;
}

function sectorPath(cx: number, cy: number, r: number, fraction: number): string {
  return arcSectorPath(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
}

function arcSectorPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const sx = cx + Math.cos(start) * r;
  const sy = cy + Math.sin(start) * r;
  const ex = cx + Math.cos(end) * r;
  const ey = cy + Math.sin(end) * r;
  const large = end - start > Math.PI ? 1 : 0;
  return `M${fmt(cx)} ${fmt(cy)}L${fmt(sx)} ${fmt(sy)}A${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(ex)} ${fmt(ey)}Z`;
}

