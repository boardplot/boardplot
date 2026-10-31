import type { TypeRoleName } from './theme';
import type { StructureCount } from '../structureCounts';
import type { PresentationInfo } from './sizing';

/** `kpiValue` is one hero figure; `panelValue` the headline numbers of a multi-panel waffle, held to the smaller panel floor. */
export type TypographyRole = TypeRoleName | 'kpiValue' | 'panelValue';
export interface TypographyMetadata {
  typeRole?: TypographyRole;
}

// Shared declarations stay here; the label solver owns propagation and fitting.
declare module '../label/solver' {
  interface LabelRequest extends TypographyMetadata {}
}

export type HatchPattern = 'hatch45' | 'crosshatch' | 'horizontal' | 'vertical';
import type { ResolvedSizing } from './sizing';
/** Geometry, the output contract. Colors stay symbolic until export. */

import type { Rect, Size } from '../geometry';
import type { FontSpec } from '../text';
import type { ColorRole, Id, OwnerRef, SlotId, Scenario } from './cell';
import type { LabelKind } from './options';
import type { AnnotationKind } from './annotations';
import type { ChartNote, NotePlacement } from '../notes';
import type { InteractionEvent, InteractionRecord } from '../a11y/types';

export type PaintToken =
  | ColorRole
  | 'ink'
  | 'inkInverse'
  | 'inkMuted' // source lines, tick labels
  | 'axis'
  | 'grid'
  | 'leader'
  | 'case-1'
  | 'case-2'
  | 'background'
  // What `options.highlight` selects; a theme without
  // `color.focus` resolves it to its highlight.
  | 'focus'
  // The line of a spark; a theme without `color.spark` resolves it
  // to its neutral mark role.
  | 'spark'
  // A mark in the neutral; a theme without `color.neutralMark`
  // resolves it to its neutral.
  | 'neutralMark'
  // The large signed fills; a theme without `color.goodFill` /
  // `color.badFill` resolves them to good / bad.
  | 'goodFill'
  | 'badFill'
  // The large warn fill; a theme without `color.warnFill` resolves
  // it to warn.
  | 'warnFill'
  // The tertiary ink; a theme without `color.inkMeta` resolves it
  // to its inkMuted.
  | 'inkMeta'
  // The marks that recede under a highlight; a theme without
  // `color.rest` resolves them to neutralLight.
  | 'rest'
  // The fill of an Others mark (the topN bucket, a series whose colorRole is
  // 'others'); a theme without `color.othersMark` resolves it to `others`.
  | 'othersMark'
  // A data mark drawn in ink, apart from the text ink; a theme without
  // `color.markInk` resolves it to its ink.
  | 'markInk'
  // A stepped heat lane's top band and its figures; a theme without
  // them resolves to markInk (then ink) and inkInverse.
  | 'heatTop'
  | 'heatTopInk'
  // A table's structural rule and a slope's rails; a theme without
  // `color.rule` / `color.reference` resolves them to its axis.
  | 'rule'
  | 'reference';

/**
 * Theme-derived colors whose identity cannot be recovered safely from a hex.
 * A named palette may share a light hex with a semantic token and still have a
 * different dark counterpart, so the source travels with the scene node.
 */
export type ThemePaintSource =
  | {
      kind: 'series';
      /** Zero-based rank; CSS exposes the same rank as --bp-series-0 … */
      index: number;
      /** Named palette selected by the document; absent means color.series. */
      palette?: string;
      /** Scenario calculation remains symbolic until the active theme resolves. */
      scenario?: Scenario;
      deEmphasizePy?: boolean;
      /** Internal low/high companion fade toward the visible surface pole. */
      surfaceFade?: boolean;
      /** A scenario beside its actual: a PY wash the page floor keeps on the actual's colour steps toward the ink instead, and an FC hatch on a dark page keeps strong stripes. */
      apart?: boolean;
    }
  | { kind: 'line-forecast'; base: Paint; crossesBand: boolean }
  | { kind: 'line-band'; base: Paint; seriesId: string }
  | { kind: 'line-context'; rank: number; rungCount: number; seriesId: string }
  /**
   * A context stroke that crosses other context strokes: the ladder share
   * `share`, raised in the active theme until the stroke is a palette step
   * (PALETTE_NORMAL_FLOOR) from every `apartFrom` paint, at most to `top`.
   * With `darker`, the stroke starts from `darker.share` instead when every
   * crossing pair of darker shares in `darker.pairs` stays a palette step
   * apart in the active theme (the darker grey ladder of a plain line).
   */
  | { kind: 'line-apart'; share: number; top: number; apartFrom: Paint[]; darker?: { share: number; pairs: Array<[number, number]> } }
  | { kind: 'fan-step'; base: Paint; bandCount: number; showBounds: boolean; index: number; seriesId: string; deEmphasized: boolean }
  /** `light`: the ramp of rows that print every band's name (bulletBandPaints). */
  | { kind: 'bullet-band'; poor: Paint; good: Paint; count: number; index: number; light?: true }
  /** A plain waterfall segment colour, tinted in the active theme where it reads too close to the total (segmentApartPaints). */
  | { kind: 'segment-apart'; plain: Paint[]; others: Paint[]; index: number }
  /** The third or later story line of a highlighted bump chart: index `index` of `count` story colours (bumpStoryPaints). */
  | { kind: 'bump-story'; index: number; count: number }
  | { kind: 'colorblind'; role: 'good' | 'bad' | 'goodFill' | 'badFill' }
  | { kind: 'pie-ramp'; base: Paint; index: number; count: number; /** The pie draws an Others slice; the ramp keeps its steps apart from that colour. */ withOthers?: true; /** 'apart': Others only has to differ from the named steps. */ othersShade?: 'apart' }
  | {
      kind: 'visible-tint';
      base: Paint;
      /** 'surface-anchor' / 'surface-gap' read surface.anchorTint / surface.gapTint of the theme painted in. */
      amount: number | 'surface-anchor' | 'surface-gap';
      floor: number | 'mark';
      /** Heatmap washes round each decrement; Likert ramps retain full precision. */
      roundStep?: boolean;
      /**
       * The contrast ratio a ramp step keeps from `base` (Likert). When the
       * floor pulls the wash back until the step nearly matches its token,
       * the step is taken toward the ink instead, until it is this far apart.
       */
      apart?: number;
      /**
       * On a dark page, a wash that has to read apart from others (a toned
       * strategy zone beside the neutral zone, a likert neutral between its
       * two sides): the amount walks back toward the base until it sits
       * `distance` OKLab from each.
       */
      darkApartFrom?: { paint: Paint | Paint[]; distance: number };
      /**
       * On a dark page, the wash deepens toward the base until its APCA
       * contrast with the page reaches the contrast the same wash draws on a
       * white page, so a traffic-light ground reads as clearly in dark as in
       * light. A light page keeps the wash as it is.
       */
      darkMatchLight?: true;
    }
  | { kind: 'brighter-pole' }
  /** A table cell ground (`table.grounds`, `table.bar`), resolved in the theme painted in. */
  | { kind: 'table-ground'; ground: 'good' | 'goodStrong' | 'warn' | 'bad' | 'bar' | 'barMuted' }
  /** A table text role (`table.inks`), resolved in the theme painted in: a repaint keeps the client's inks and the derived child ink. */
  | { kind: 'table-ink'; role: 'head' | 'subLabel' | 'label' | 'child' | 'figure' | 'qualifier' | 'operator' | 'driver' | 'toggle' | 'secondary' | 'rule' }
  /**
   * Emphasised text: the focus role where it reads at 4.5:1 on `ground`,
   * else the ink, decided again in every theme the scene is painted in.
   */
  | { kind: 'emphasis-ink'; ground: Paint }
  /**
   * A mark that has to read apart from the marks beside it (the scatter
   * highlight ring around group colours): the focus role where it clears the
   * swatch floor against every `apartFrom` paint, otherwise the ink, decided
   * again in every theme the scene is painted in.
   */
  | { kind: 'focus-apart'; apartFrom: Paint[] }
  /**
   * A reference line over a fill: the line's own `base` ink
   * where it reads at least as well against `fill` as the inverse ink does,
   * else the inverse ink (white on a dark bar in a light theme), decided again
   * in every theme the scene is painted in.
   */
  | { kind: 'line-on-fill'; base: Paint; fill: Paint }
  /**
   * Rung `index` of `count` on the theme's ordered ramp: the mark
   * ink tinted toward the page, rung 0 the weakest at 3:1 and the last rung the
   * full mark ink, so the order reads the same way in a light and a dark theme.
   */
  /**
   * Step `index` of `count` plain series of a stack on the theme's
   * stack ramp; a theme without `color.stack` paints series rank `slot`.
   */
  | { kind: 'stack-ramp'; index: number; count: number; slot: number }
  /** A plain series of a stack beside authored colours: its ramp step, chosen in the active theme apart from them (rampSlots, stacked). */
  | { kind: 'stack-apart'; own: (Paint | null)[]; index: number; palette?: string }
  | { kind: 'ordered-ramp'; index: number; count: number; /** A Rest series is drawn: the weakest rung stays further from the page than the Others colour. */ withOthers?: true }
  /**
   * A hatch's stripes: the fill's colour, deepened toward the mark ink until it
   * reaches 3:1 on the page; `grounded` stripes are resolved with
   * their 'hatch-ground' (groundedHatchColors).
   */
  | { kind: 'hatch-stripe'; base: Paint; grounded?: true; peers?: Paint[]; strength?: number; apart?: Paint; stacked?: true }
  /**
   * The ground under a hatch inside its own mark: the fill washed toward the
   * page until the stripes read on it (groundedHatchColors). `peers` are the
   * fills of every grounded hatch drawn with it, resolved together. A status
   * cell adds its `strength` (options.hatchStrength) and the cell with no
   * status its stripes stay `apart` from.
   */
  | { kind: 'hatch-ground'; base: Paint; peers?: Paint[]; strength?: number; apart?: Paint }
  /**
   * A hatch drawn below full strength (options.hatchStrength): the stripe
   * faded toward its ground, never below the floor its cue needs (hatchFadeColor).
   */
  | { kind: 'hatch-fade'; stripe: Paint; ground: Paint; strength: number; cue: HatchCue }
  /**
   * A fill that separates by itself from the page and the page-like surfaces
   * it may lie on (a gantt bar on a tinted row or the elapsed band): deepened
   * toward the mark ink until it clears the page floor on each (surfaceFloorPaint).
   */
  | { kind: 'surface-floor'; base: Paint; surfaces: Paint[] }
  /**
   * A translucent flow over the page (a sankey ribbon): the base colour at the
   * theme's `surface.ribbonAlpha`, more opaque where that draws under the page's
   * mark floor (ribbonPaint).
   */
  | { kind: 'ribbon'; base: Paint }
  /** Series identity as text, kept above the theme's text contrast floor. */
  | { kind: 'series-text'; base: Paint; surfaces?: Paint[] }
  /**
   * Text on an authored ground (a table total, a tone fill), decided in the active theme: `near` where the ground
   * sits on the page's side of lightness; on the other side `far` stepped until it reads at 4.5:1 on the ground
   * alone, else the ground's readable ink.
   */
  | { kind: 'ground-text'; near: Paint; ground: Paint; far?: Paint }
  /** An authored ground as a surface page-side text reads on: the ground on the page's side of lightness, else the page. */
  | { kind: 'page-side-ground'; ground: Paint }
  | {
      /** A theme-side calculation kept as a recipe, never materialised as `{css}`. */
      kind: 'mix';
      from: Paint;
      to: Paint;
      /** Linear-sRGB weight of `from`, matching mixColors(). */
      weight: number;
      /**
       * A wash toward the page that must not vanish: without marks.contrastEdge, the weight of
       * `from` grows until the mix reads at this ratio against the page.
       */
      pageFloor?: number;
    }
  | {
      kind: 'contrast-ink';
      fill: Paint;
      pattern?: HatchPattern | 'outline';
      /** Further grounds the text also lies on (a shading's mix over an area fill): the ink that reads best on the worst of them. */
      also?: Paint[];
    };

export type Paint =
  | {
      token: PaintToken;
      /** Optional source overrides token resolution while keeping old token readers compatible. */
      theme?: ThemePaintSource;
      tint?: number;
    } // tint 0..1 mixes toward background at resolve time
  | { css: string };

/** Theme-sensitive warning inputs retained independently of surviving scene paints. */
export type PaintWarningRule = { before: number } & (
  | { kind: 'series-adjacent-similar'; samples: AdjacentSeriesPaintSample[]; stacked: boolean }
  | { kind: 'bullet-band-lightness'; count: number; poor: Paint; good: Paint; light?: true }
  | { kind: 'highlight-reads-as-loss'; chart: 'waterfall' | 'variance' }
  | { kind: 'pie-ramp-crowded'; base: Paint; count: number; withOthers?: true; othersShade?: 'apart' }
  | { kind: 'others-shade-unavailable'; base: Paint }
  | { kind: 'mark-lost-on-band'; pairs: MarkOnBand[] }
  | { kind: 'likert-ramp-invisible'; options: { label: string; paint: Paint; amount: number }[] }
  | { kind: 'line-band-authored-contrast'; base: Paint; seriesId: string; authoredSource: string; /** The authored paint, when base is its faded form. */ authored?: Paint }
  /** Table text on authored grounds ('ground-text' paints). */
  | { kind: 'table-ground-text'; texts: Paint[] }
);

/** The paints a rectangle draws over an annotation band, retained for theme-dependent warnings. */
export type MarkOnBand = Pick<Extract<SceneNode, { t: 'rect' }>, 'fill' | 'stroke' | 'strokeWidth' | 'pattern' | 'hatchGround' | 'hatch' | 'hatchEdge'>
  & { name: string; owner: OwnerRef; band: Paint };

/** Sources for a color-dependent mark separator, re-evaluated without layout. */
export interface SeparationRule {
  /** Pale combo segments deepen their own fill. */
  fillStep?: true;
  fill: Paint;
  backing: Paint;
  /** Bullet measures use the least contrasting band or page as backing. */
  alternateBackings?: readonly Paint[];
  pattern?: HatchPattern | 'outline';
  fallback?: { stroke: Paint; strokeWidth: number };
  /** The backing is a tint of the page that marks rows or time (separationStroke): the page floor applies. */
  surface?: true;
  /**
   * Under marks.contrastEdge, a light-page fill under 3:1 with no equivalent text takes a 3:1 edge.
   * `strict` is the decision, re-made on every repaint from the inputs below.
   */
  strict?: true;
  /** Visible text carries this mark's label and value: a value label, or a note line that names both. */
  printed?: true;
  /** The mark stands for zero: its 0.5 px stub has no extent to show, so it takes no edge. */
  empty?: true;
  /** The note item that names this mark with its value; it carries the mark only when a drawn footnote holds it. */
  notedAs?: string;
  /** The fills on both sides of this mark (a stack segment, a pie slice); 3:1 on both bounds its extent. */
  bounds?: readonly Paint[];
  /** Further grounds the edge must clear at 3:1 (a gantt bar's row tint and elapsed band). */
  grounds?: readonly Paint[];
}

/** Already-formatted semantic truth carried by the layout for interactive folds. */
export interface SceneDisplay {
  value?: string;
  state?: string;
  /** Typed facts for an interaction layer; legacy formatted strings remain valid. */
  record?: InteractionRecord;
}

/**
 * What a text node says, for hosts that style one class of text.
 * `value` and `axis` are the numeric roles: only they carry tabular figures.
 * The role follows from `part` (see `textRole`); a node sets it explicitly
 * only where one part mixes names and numbers (table cells, card rows).
 */
export type TextRole = 'title' | 'subtitle' | 'value' | 'axis' | 'category' | 'caption' | 'note' | 'source';

/** Original semantic identity retained when a grid composes child scenes. */
export interface SceneOrigin {
  owner: OwnerRef;
  panels: string[];
  legendItem?: string;
}

/**
 * z-ordered, paint-ready scene. Renderers add NOTHING.
 *
 * Node ids are opaque: their order of parts differs by chart (a bar mark is
 * `mark:<category>:<series>`, a column mark `mark:<series>:<category>`), so a
 * probe matches a node by its `owner` fields, never by parsing its id. One
 * `part` can name more than one thing: `part: 'band'` is both an annotation
 * band and a bullet range rect; `owner.annotationId` tells the annotation
 * bands apart. Ids and part names stay as they are, because they reach SVG
 * attributes, CSS selectors and React keys.
 */
export type SceneNode = (
  | {
      t: 'image';
      id: Id;
      rect: Rect;
      /** Embedded PNG, JPEG or WebP. Renderers never fetch external media. */
      src: string;
      alt: string;
      owner: OwnerRef;
      part: string;
      display?: SceneDisplay;
      origin?: SceneOrigin;
      tx?: number;
      ty?: number;
    }
  | {
      t: 'rect';
      id: Id;
      rect: Rect;
      /**
       * What the rectangle stands for, when that is more than its own paint:
       * the hover card's box carries the card's whole reading, including the
       * rows a short frame left out. Renderers emit it as the element's
       * `<title>` and label it with the same text.
       */
      title?: string;
      fill: Paint;
      stroke?: Paint;
      separation?: SeparationRule;
      strokeWidth?: number;
      /** The stroke is the engine's ground hairline (groundEdges), decided anew per theme; any other stroke is the mark's own. */
      groundEdge?: true;
      radius?: number; // rx for chips/badges; 0/absent = square
      /**
       * 'hatch45' is the forecast notation and 'outline' the plan notation, whose
       * look a theme sets (`scenario.PL`). 'hollow' draws like the notation
       * outline under every theme: a key for a hollow point, which is not a plan bar.
       */
      pattern?: HatchPattern | 'outline' | 'hollow';
      /**
       * The ground under a 'hatch45' pattern's stripes; default the page
       * background. A stacked forecast segment grounds its hatch in its own
       * series colour, tinted, so the segment keeps its identity.
       */
      hatchGround?: Paint;
      /** How strongly a 'hatch45' pattern draws (options.hatchStrength, stampHatchLook). */
      hatch?: HatchLook;
      /**
       * false draws a 'hatch45' rect without the outline in its fill colour:
       * a status cell, whose gutter is its only separator.
       */
      hatchEdge?: false;
      owner: OwnerRef;
      part: string;
      display?: SceneDisplay;
      origin?: SceneOrigin;
      tx?: number; // grid panel translation
      ty?: number;
    }
  | {
      t: 'line';
      id: Id;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: Paint;
      width: number;
      dash?: number[];
      lineCap?: 'butt' | 'round' | 'square';
      owner: OwnerRef;
      part: string;
      display?: SceneDisplay;
      origin?: SceneOrigin;
      tx?: number; // grid panel translation
      ty?: number;
    }
  | {
      t: 'path';
      id: Id;
      d: string;
      fill?: Paint;
      pattern?: HatchPattern;
      /** How strongly the 'hatch45' pattern draws (options.hatchStrength, stampHatchLook). */
      hatch?: HatchLook;
      stroke?: Paint;
      separation?: SeparationRule;
      width?: number;
      dash?: number[];
      lineCap?: 'butt' | 'round' | 'square';
      /** A line casing that stays over the fills it crosses (the Pareto curve); `casingUnderFills` leaves it in place. */
      overFills?: true;
      owner: OwnerRef;
      part: string;
      display?: SceneDisplay;
      origin?: SceneOrigin;
      tx?: number; // grid panel translation
      ty?: number;
    }
  | {
      t: 'circle';
      id: Id;
      cx: number;
      cy: number;
      r: number;
      fill: Paint;
      stroke?: Paint;
      /** Ring weight; 1 without one, as SVG's own default is. */
      strokeWidth?: number;
      /** What the circle stands for (an event marker): emitted as its `<title>`. */
      title?: string;
      /** One keyboard stop of an event: the React fold makes it focusable when hover is on. */
      focusStop?: true;
      owner: OwnerRef;
      part: string;
      display?: SceneDisplay;
      origin?: SceneOrigin;
      tx?: number; // grid panel translation
      ty?: number;
    }
  | {
      t: 'text';
      typeRole?: TypographyMetadata['typeRole'];
      id: Id;
      x: number;
      y: number;
      lines: string[];
      /**
       * Styled runs for a SINGLE-line node (the notation subtitle's bold measure).
       * Renderers emit one <text> whose per-run <tspan>s carry only the weight
       * override — no per-run x — so the font engine owns the intra-line
       * advance, exactly as it does inside every other label. Positioning
       * each run at the SUM OF MEASURED widths of its predecessors would print
       * the width model's error into the visible joins: overlap under fonts
       * wider than the model (SF Pro), double-wide separators under the
       * calibrated class.
       * When present: exactly one line, and lines[0] must equal the
       * concatenated run texts — `lines` stays the plain-text truth for
       * a11y, claims, and lints. Measured run widths still size the occupied
       * claim; they position nothing visible.
       */
      runs?: { text: string; weight?: number }[];
      /**
       * Accessible full text for lines an ellipsis cut. Renderers emit it as
       * the text element's `<title>`; absent when nothing was cut. An event's
       * title line (lane and key) carries the whole event here instead.
       */
      title?: string;
      /** One keyboard stop of an event: the React fold makes it focusable when hover is on. */
      focusStop?: true;
      align: 'start' | 'middle' | 'end';
      /** Degrees, clockwise, about the anchor point (rotated category labels). */
      rotate?: number;
      font: FontSpec;
      ink: Paint;
      halo?: boolean;
      backing?: Rect;
      owner: OwnerRef;
      part: string;
      /** Overrides the role `part` implies; absent for almost every node. */
      role?: TextRole;
      display?: SceneDisplay;
      origin?: SceneOrigin;
      tx?: number; // grid panel translation
      ty?: number;
    }) & { /** Interaction paint, and the canonical translucency of a column ribbon (surface.ribbonAlpha); omitted means opaque. */ opacity?: number };

export type DiagramLabelKind =
  | 'diagramNode'
  | 'diagramSecondary'
  | 'diagramEdge'
  | 'diagramCaption'
  | 'diagramGroup'
  | 'diagramLane'
  | 'diagramBadge';

export interface PlacedLabel extends TypographyMetadata {
  id: Id; // stable LabelId: [kind, seriesId?, categoryId?, …].join(':')
  kind: LabelKind;
  owner: OwnerRef;
  text: string;
  lines: string[];
  rect: Rect; // final measured box — THE invariant object
  slot: SlotId;
  slots: SlotId[]; // finite legal alternatives — valid pin targets
  pinned: boolean;
  ink: Paint;
  backing?: Rect;
  /** Identity key box rendered at the rect's left edge (filled-variant
   * endpoint labels — a label's owner must be readable
   * without ratio inference). Rect width already reserves its space. */
  swatch?: Paint;
  leader?: { d: string; curved: boolean };
  /**
   * Force the contrast halo on (`labelsToNodes` otherwise turns it on only
   * for labels that carry a leader). Set by a layout that knows the label's
   * host mark is overpainted by a later sibling, where the ink was decided
   * against a tone the reader never sees — see `haloOverpaintedInsideLabels`
   * in src/core/markVisibility.ts.
   */
  halo?: boolean;
  /**
   * A small rounded plate in the page colour under the label (`labelsToNodes`
   * draws it as a rect before the text): the label reads in front of the hatch
   * it sits on. Plain rect, theme token: survives every repaint.
   */
  plate?: true;
  /** Degrees, clockwise, about the label's anchor; `rect` is then the axis-aligned box. */
  rotate?: number;
  hidden?: 'redundant' | 'tooSmall' | 'collision' | 'density' | 'note';
  /** A hidden label the note line names by this id (class 2): its second home. */
  noted?: true;
  /** Named destination when the label moves into a note. */
  noteLocation?: string;
  /** The note only counts this label ("and 236 more"); it does not name it. */
  noteCounted?: true;
  /** Reader-facing identity and value for an omission note. */
  noteText?: string;
  /** The label of a highlighted mark: drawn in the emphasis weight and the full ink. */
  emphasis?: true;
  /** A reader loses this value when it is hidden: the note line names it (class 2). */
  owed?: true;
  /** A hidden label whose text the drawn lines of this label print instead (a bump value in its name). */
  printedIn?: Id;
  /** The marks whose value this label prints: absent means its owner; [] a label that only names its mark. */
  printsFor?: OwnerRef[];
  /** Calculation whose displayed text comes from this final label. */
  claimId?: Id;
  /** Computed text before an authored label override. */
  claimText?: string;
  /** Full text behind cut lines; emitted as the text node's `<title>`. */
  title?: string;
  /** Font one type step down, set when the truncation policy shrank the label; emission prefers it. */
  font?: FontSpec;
  /** Cap height of the label's face in px, from the measurer; emission centres a one-line label's cap band on its rect. */
  capHeight?: number;
  /** Carried onto the text node when the label kind alone names the wrong role. */
  role?: TextRole;
  /** Each line centred in `rect` (a multi-line value label) or flush right in it ('end': a mirrored staircase name, a gap bracket caption); start-aligned otherwise. */
  align?: 'start' | 'middle' | 'end';
  /** The first this many lines use emphasis and the rest use the label's font (a callout headline). */
  headLines?: number;
  /** The measured emphasis weight of the callout headline. */
  headWeight?: number;
  /** Ink of the head lines when it differs from the label's (a bar CAGR's muted series name). */
  headInk?: Paint;
  /** Ink of the lines after the head lines, when it differs from the label's. */
  bodyInk?: Paint;
  /** Font of the lines after the head lines, when it differs from the label's. */
  bodyFont?: FontSpec;
  /** Styled runs of a one-line label (see the text node's `runs`). */
  runs?: { text: string; weight?: number }[];
  priority: number;
  nodeId?: Id; // scene text node; absent when hidden
}

export interface OccupiedRect {
  rect: Rect;
  kind: 'mark' | 'label' | 'axis' | 'annotation' | 'legend' | 'frame' | 'reserved';
  owner: OwnerRef;
  /** Semantic part tag of the claiming mark (e.g. 'segment', 'line'). */
  part?: string;
}

export type StrategyName = 'candidatesOccupied';

export interface PlaceDecision {
  labelId: Id;
  strategy: StrategyName;
  tried: SlotId[];
  chose: SlotId | 'hidden';
  reason: string;
}

export interface LintWarning extends Partial<import('../diagnostics/describe').DiagnosticMetadata> {
  code: string;
  /** `advice` is a design rule of the type's card: it never changes the drawing or refuses. */
  severity: 'advice' | 'info' | 'warn' | 'error';
  message: string;
  owner?: OwnerRef;
  suggest?: string;
  /** The offending field, relative to the chart, so the pointer names it. */
  field?: readonly (string | number)[];
  detail?: Record<string, unknown>;
}

export interface AxisGeometry {
  axis: 'x' | 'y';
  baselineNodeId?: Id;
  scenarioBands?: { rect: Rect; scenario: Scenario }[];
  ticks: { at: number | Id; pos: number; labelId?: Id; gridNodeId?: Id }[];
  baselineDisclosure?: { value: number; rect: Rect; nodeIds: Id[] };
  break?: { rect: Rect; style: 'straight' | 'wiggle'; nodeIds: Id[] };
}

/**
 * The engine's arithmetic behind a numeric annotation, carried so the claim
 * record can be a receipt instead of a restatement.
 *
 * A claim such as `+5.6% p.a.` needs `raw` and `inputs`. A record with
 * `raw: null, inputs: []` contains no number, so `verify --doc` cannot
 * contradict the claim and reports a match.
 *
 * `basis` says which group the annotation belongs in:
 *   'derived'   `op(inputs)` reproduces `raw` (cagr, diff, delta);
 *   'observed'  the value was read off the plotted data, not computed from
 *               operands that fit in a record (a mean, an anchor's own value);
 *   'authored'  the number came from the document (an explicit valueLine, the
 *               100% indicator, prose).
 */
export interface AnnotationDerivation {
  basis: 'derived' | 'observed' | 'authored';
  op: string;
  inputs: { ref: string; value: number | null; state?: string }[];
  raw: number | null;
}

export interface PlacedAnnotation {
  id: Id;
  kind: AnnotationKind;
  computedText: string;
  tone?: 'good' | 'bad' | 'warn' | 'neutral';
  nodeIds: Id[];
  /** An event of the event lane, in full: kept whether or not the lane or the key prints its detail. */
  event?: InteractionEvent & { anchor?: Rect };
  labelId?: Id;
  /**
   * The scene node that actually carries `labelId`'s text.
   *
   * Normally `label:<labelId>` — that is how `labelsToNodes` namespaces label
   * nodes, and consumers derived it by string concatenation. That derivation is
   * only valid while nothing rewrites ids underneath it. The grid composer does:
   * it prefixes scene nodes with `<panel>/` AFTER the `label:` namespace was
   * applied (`<panel>/label:<labelId>`) and prefixes `labelId` on its own
   * (`<panel>/<labelId>`), so the concatenation produced
   * `label:<panel>/<labelId>` — a node that exists in no scene. Every claim on a
   * grid-panel annotation therefore pointed at nothing, and `verify --doc`
   * reported "does not resolve in the scene" on a correctly rendered document.
   *
   * Carrying the node id explicitly means the composer prefixes it exactly the
   * way it prefixes the node, instead of consumers re-deriving it.
   */
  labelNodeId?: Id;
  derivation?: AnnotationDerivation;
  /** A value line's value as its label's format prints it: the line's own format, the series' or the chart's, with its unit. */
  valueText?: string;
  /** A value line's drawn tolerance band: its bounds as the band prints them. */
  toleranceText?: { low: string; high: string };
}

export interface LegendGeometry {
  rect: Rect;
  items: { id: Id; swatchNodeId: Id; labelId: Id }[];
}

export interface FrameGeometry {
  titleNodeId?: Id;
  /**
   * Lines the drawn title takes at this width. Absent when the chart
   * has no title. `measure` and render's reading report the same number.
   */
  titleLines?: number;
  subtitleNodeId?: Id;
  sourceNodeId?: Id;
  /**
   * The source credit a fixed compact frame left off the canvas:
   * the authored source, without the "Source:" word. A host shows it in its
   * own frame, behind an info button. Absent when the source line is drawn
   * or the chart has no source.
   */
  source?: string;
  /**
   * The notes the frame does not print, in list order: the notes
   * `footnotes: false` left off and the notes the footer rule moved
   * to the notes list. Absent when every note is drawn or there are none.
   */
  notes?: string[];
  /**
   * The notes list (footer rule): every note, the source
   * and a map credit with its kind, and whether the frame prints it. The
   * render result returns it as `notes`, with compact mode's omitted notes.
   */
  noteList?: ChartNote[];
  /** `notes.placement` as resolved for the target, before the SVG draws 'info' as 'frame'. */
  notePlacement?: NotePlacement;
  /**
   * The footer block (notes, source line, credit) from the top of its first
   * line to the bottom margin; absent without one. A React chart crops the
   * SVG at its top and draws the footer as HTML (core/notes).
   */
  footerRect?: Rect;
  /**
   * The static footer under 'info': where React's "Notes and sources (N)" button sits when a
   * content-fit chart draws this footer (the notes the footer does not print open from it). After
   * the last line of `nodeId`, or in an empty row at `y`. The image leaves that space empty.
   */
  notesButton?: { nodeId?: Id; y?: number };
  /** The node of a map credit drawn in the frame. */
  creditNodeId?: Id;
  footnoteNodeIds?: Id[];
  /** Frame warnings are consumed into Geometry.warnings by registered charts. */
  warnings?: LintWarning[];
  /**
   * The frame-solved plot band, recorded by `solveFrame` before chart-side
   * reserves (topPad, tick rows, annotation headroom) shrink it into
   * `geometry.plot`. The dead-band gate treats THIS band as the plot
   * block (it owns bands BETWEEN frame blocks; space inside the frame plot
   * belongs to other checks), so a chart-side reserve can never read as an
   * inter-block hole.
   */
  plotRect?: Rect;
  /** The event key band above the footnotes (core/eventLane); absent without one. */
  eventKeyRect?: Rect;
  /**
   * The canvas height at which title, legend, footnotes and source leave the
   * plot 10px. Sizing treats it as a minimum height, so the chart grows or
   * refuses, and a grid refuses a panel whose slot is shorter.
   */
  minHeight?: number;
  /**
   * The same, counting the chart's own reserves inside the frame band (axis
   * rows, category band, axis title band) as well; recorded by
   * `plotHeightAfter`. Sizing treats it as a minimum height too.
   */
  plotMinHeight?: number;
}

export interface AdjacentSeriesPaintSample {
  seriesId: Id;
  categoryId: Id;
  from: number;
  to: number;
  paint: Paint;
  pattern?: 'hatch45';
  /** A hatched bar or segment is told from its neighbour by its stripe colour, not its washed average. */
  byStripe?: true;
  highlighted: boolean;
}



export interface Geometry<
  M extends object = Record<string, unknown>,
  D extends object = Record<string, unknown>,
> {
  refused?: false;
  sizing?: ResolvedSizing;
  presentation?: PresentationInfo;
  mode?: 'full' | 'compact';
  type: string;
  size: Size;
  plot: Rect;
  scene: SceneNode[];
  labels: PlacedLabel[];
  axes: AxisGeometry[];
  annotations: PlacedAnnotation[];
  legend?: LegendGeometry;
  frame: FrameGeometry;
  marks: M;
  derived: D;
  a11y: {
    title: string;
    desc: string;
    /** Count phrases printed in desc. */
    counts?: StructureCount[];
    /** Extra default-title count phrases, for grids that print child titles in desc. */
    titleCounts?: StructureCount[];
    includeTitle?: boolean;
    compactNotes?: string[];
  };
  warnings: LintWarning[];
  paintWarningRules?: PaintWarningRule[];
  /** The story layer (options.story): the panel, its steps and what each step fades. */
  story?: StoryGeometry;
  debug: { occupied: OccupiedRect[]; decisions: PlaceDecision[] };
}

/** One laid-out story step. Node ids name scene nodes; positions never differ between steps. */
export interface StoryStepGeometry {
  id: string;
  title: string;
  body: string;
  /** The step's title and body text in the panel. */
  nodes: SceneNode[];
  /** The counter text, drawn by interactive renderers only. */
  counter: SceneNode;
  /** Nodes drawn at full strength, their text in bold. */
  focus: string[];
  /** Nodes faded to the theme's interaction dim. */
  dim: string[];
}

export interface StoryGeometry {
  /** Localized live region position template. Optional for older prepared geometry. */
  stepLabel?: string;
  /** The step the scene shows (options.story.step, else 0). */
  step: number;
  /** Where the panel sits: in an empty area of the plot, or beside the chart. */
  placement: 'plot' | 'right' | 'below';
  /** The panel with its button row; static output draws `staticPanel`, without the row. */
  panel: Rect;
  staticPanel: Rect;
  /** Button hit areas and their drawn outlines and labels. */
  nav: { back: Rect; next: Rect; nodes: SceneNode[] };
  steps: StoryStepGeometry[];
  /** The opacity and weight every node a step touches has without a story. */
  base: Record<string, { opacity?: number; weight?: number }>;
  /** The accessible description without the story text. */
  desc: string;
  /** The weight of a focused label and the opacity of a faded mark (theme title weight, interaction dim). */
  bold: number;
  dim: number;
}


export interface RefusedLayout {
  refused: true;
  presentation?: PresentationInfo;
  type: string;
  title: string;
  size: Size;
  sizing: ResolvedSizing;
  warnings: LintWarning[];
}

export type LayoutResult<M extends object = Record<string, unknown>, D extends object = Record<string, unknown>> =
  | Geometry<M, D>
  | RefusedLayout;

/**
 * Whether a hatch is the only thing that says "forecast" or "no data" ('sole':
 * a forecast column, a partial period, a no-data cell) or repeats what a
 * dashed line, a divider and the key already say ('second': a line or area
 * forecast). A sole hatch keeps its floors at every strength.
 */
export type HatchCue = 'sole' | 'second';

/** The strength a hatched node draws at, 0 to 100 (100 the theme's recipe), and its cue. */
export interface HatchLook {
  strength: number;
  cue: HatchCue;
  /** A segment of a hatched stack on the page: in a grey theme its stripe keeps a clear step from a paler segment beside it. */
  stacked?: true;
}
