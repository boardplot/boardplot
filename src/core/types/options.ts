/** Options. */

import type { LiveWindowOptions } from '../live/types';
import type { Margin } from '../geometry';
import type { TextMeasurer } from '../text';
import type { Direction, Id, OwnerRef, Scenario } from './cell';
import type { SlotId } from './cell';
import type { LineSeriesTarget, VarianceSpec } from './data';
import type { Annotation, EventOptions } from './annotations';
import type { OthersShade } from '../othersShade';
import type { ThemeRef } from './theme';
// Type-only, so nothing is imported at runtime and no cycle exists. The
// capability table is declared ONCE, next to the schemas that enforce it; this
// file reads its shape rather than restating it, because a declaration that
// restates a runtime table is a twin that will disagree with it.
import type { OPTION_CAPABILITY, VALUE_AXIS_CAPABILITY, VALUE_AXIS_ONLY } from '../schema/capability';

export type RenderTarget = 'report' | 'dashboard' | 'slide' | 'print';
export type LengthUnit = 'px' | 'pt' | 'mm';
export type SizePreset = 'slide-16x9' | 'slide-4x3' | 'a4' | 'dashboard'
  | 'a4-landscape-content' | 'a4-portrait-content';
export type CanvasSizeInput = SizePreset | { width: number; height?: number; unit?: LengthUnit };
export { SIZE_PRESETS } from '../target';

export type LabelDensity = 'full' | 'smart' | 'minimal'; // default 'smart'
export type SortOrder = 'sheet' | 'asc' | 'desc' | 'reverse';

export type LabelKind =
  | 'category'
  | 'series'
  | 'segment'
  | 'point'
  | 'total'
  | 'grandTotal'
  | 'insidePie'
  | 'outsidePie'
  | 'percentIndicator'
  | 'restSeries'
  | 'tick'
  | 'axisTitle'
  | 'valueLine'
  | 'annotation'
  | 'growth'
  | 'activity'
  | 'item'
  | 'scale'; // Gantt trio, reserved

export type LabelContent = ('absolute' | 'percent' | 'category' | 'series')[];

export interface Subtitle {
  company?: string;
  measure: string;
  period?: string;
  /**
   * Scenario codes appended to the subtitle as their own segment, joined
   * with " vs " ("AC vs PL"). `subtitleSchema` accepts
   * `z.array(z.string())` and `formatScenarios` joins whatever it is given, so the
   * runtime renders any string here; `Scenario[]` alone rejected documents the
   * renderer draws (`scenarios: ['Q1']`). The `string & {}` member keeps the
   * four scenario codes in autocomplete without narrowing the accepted domain.
   */
  scenarios?: (Scenario | (string & {}))[];
  // no unit key — options.unit is composed in automatically
}

export interface LocaleSpec {
  /** BCP 47 tag ('de', 'fr-FR'). Changes words, such as notes and month names, and the default number marks: German prints 1.234,5; English when absent. */
  language?: string;
  /** Decimal mark of every number the chart prints. Default by language: ',' for German, '.' otherwise. */
  decimal?: '.' | ',';
  /** Grouping mark of every number the chart prints. Default by language: '.' for German, otherwise ',' ('.' with decimal ','). A value equal to the decimal mark uses that fallback. */
  thousands?: ',' | '.' | '’' | ' ';
  minusGlyph?: '−' | '-';
  weekStartsOn?: 0 | 1;
}

/**
 * Wording for labels the renderer composes itself. Every key is optional and
 * the locale default stands in when the key is absent. Unsupported languages use English. Authored chart text is
 * never rewritten, and an explicit caller option (topN.restLabel, options.source,
 * a host legend-disclosure template) keeps precedence over this block.
 */
export interface StringsSpec {
  /** PVM bridge entry and exit bar names. Defaults New items and Lost items. */
  newItems?: string;
  lostItems?: string;
  /** Cohort measure name and its count-based formula. Defaults describe retention. */
  cohortMeasure?: string;
  cohortFormula?: string;
  /** Name of the aggregated rest bucket on pie, column, bar, mekko and butterfly. Default 'Others'. */
  others?: string;
  /** Label of a computed total row, such as the cohort exhibit total. Default 'Total'. */
  total?: string;
  /** Word introducing the authored source credit in the frame. Default 'Source'. */
  source?: string;
  /** Not applicable value; default 'n/a' (German 'k. A.'). */
  notApplicable?: string;
  /** Series or category legend disclosure; '{count}' becomes '2 of 4'. Default '<count> series shown'. */
  legendCount?: string;
  /** Partial hatch key label without a category name; default 'Partial'. A category-naming key uses toDate. */
  partial?: string;
  /** Meaning of a better sign-coloured value. */
  better?: string;
  /** Meaning of a worse sign-coloured value. */
  worse?: string;
  /** Name of a mixed-sign stack positive boundary. */
  positiveTotal?: string;
  /** Range method note. */
  rangeMidNote?: string;
  /** Tornado method note. */
  sensitivityNote?: string;
  /** Tornado base mismatch note. */
  hatchedBaseNote?: string;
  /** Tornado missing output note; {drivers} is replaced. */
  missingSwingNote?: string;
  /** Focused bump note. */
  rankOmitted?: string;
  /** A missing bump rank. */
  noRank?: string;
  /** Bump method note; {direction}, {format}, and {ring} are replaced. */
  rankMethod?: string;
  /** Direction of a bump rank. */
  higherBetter?: string;
  /** Direction of a bump rank. */
  lowerBetter?: string;
  /** Format clause in the bump method note. */
  rankFormat?: string;
  /** Tie clause in the bump method note. */
  rankRing?: string;
  /** Note for folded zero line ends. */
  nearZeroNote?: string;
  /** Anomaly marker key. */
  flagged?: string;
  /** Anomaly rule key. */
  corridor?: string;
  /** Authored anomaly bounds key. */
  corridorBounds?: string;
  /** Anomaly median rule label and key. */
  median?: string;
  /** Small-sample anomaly sentence. */
  anomalySmallSample?: string;
  /** Zero-MAD anomaly sentence. */
  anomalyZeroMad?: string;
  /** MAD anomaly sentence; preserves the full calculation. */
  anomalyMadRule?: string;
  /** Zero-centred anomaly rule clause. */
  anomalyCentreZero?: string;
  /** Median-centred anomaly rule clause. */
  anomalyCentreMedian?: string;
  /** Threshold anomaly sentence. */
  anomalyThresholdRule?: string;
  /** Two-sided threshold clause. */
  outsideBounds?: string;
  /** Lower threshold clause. */
  belowBound?: string;
  /** Upper threshold clause. */
  aboveBound?: string;
  /** Off-scale lower corridor bound. */
  lowerBound?: string;
  /** Off-scale upper corridor bound. */
  upperBound?: string;
  /** Off-scale corridor note. */
  undrawnBounds?: string;
  /** Heading of the note for hidden chart labels. */
  hiddenLabels?: string;
  /** Pointer to one hidden note. */
  noteOne?: string;
  /** Pointer to hidden notes. */
  noteMany?: string;
  /** React notes panel label. */
  notesAndSources?: string;
  /** Label of the Close control in the React notes panel. */
  close?: string;
  /** Word before a map credit in the React notes panel. */
  mapCredit?: string;
  /** Key for a gap between two lines. */
  gapBetween?: string;
  /** Positive line gap key. */
  aboveSeries?: string;
  /** Negative line gap key. */
  belowSeries?: string;
  /** Name before a computed mean; English Average, German Ø. */
  average?: string;
  /** Tolerance-band bounds. Fields: {v1}, {v2}. */
  valueLineRange?: string;
  /** Text after a running category name in its key or note. */
  toDate?: string;
  /** Key for the forecast pattern. */
  forecast?: string;
  /** Key for the plan outline. */
  plan?: string;
  /** Header at the actual-to-forecast boundary. Keeps the scenario code by default. */
  forecastHeader?: string;
  /** Name before a net total. */
  net?: string;
  /** Marker on an incomplete stack total; prints under notes.show 'disclosure'. */
  incomplete?: string;
  /** Key for a range whisker. */
  range?: string;
  /** Note heading for omitted column values. */
  valuesNotOnColumns?: string;
  /** Note heading for omitted combo values. */
  valuesNotBesideMarks?: string;
  /** Incomplete total note; {partial} is the marker. */
  partialTotals?: string;
  /** Incomplete total note where no marker prints (notes.show without 'disclosure'). */
  knownPartsTotals?: string;
  /** Word before missing stack parts. */
  without?: string;
  /** Word joining missing stack parts. */
  and?: string;
  /** Positive sign key; {series} and {meaning} are replaced. */
  aboveZero?: string;
  /** Negative sign key; {series} and {meaning} are replaced. */
  belowZero?: string;
  /** Key for an authored uncertainty bound. */
  declaredBounds?: string;
  /** Label of a shared rank. */
  tied?: string;
  /** Symbol before a displaced shared-rank label. */
  tiedSymbol?: string;
  /** Football-field spine; {value} is replaced. */
  currentValue?: string;
  /** Tornado spine; {value} is replaced. */
  baseCase?: string;
  /** Tornado hatch key. */
  swingOutsideBase?: string;
  /** Missing uncertainty note; {categories} is replaced. */
  fanGap?: string;
  /** Mixed-sign share note; {categories} is replaced. */
  mixedShares?: string;
  /**
   * Key labels of a table's traffic-light heat lane (`scale: 'status'`):
   * the side below the centre, the warn band around it and the side above
   * it. Defaults 'Below average', 'Around average' and 'Above average', or
   * '... total' under `center: 'total'`.
   */
  heatBelow?: string;
  heatAround?: string;
  heatAbove?: string;
  /**
   * Bullet band key words, worst to best, for the one worse-to-better key (`bandKey`).
   * The list needs one word per band; any other length keeps the built-in words.
   */
  bandKey?: string[];
  /** The word for a bullet row's comparison value in every phrase the bullet composes ("vs target", "of target", the keys, the hover card). Default 'target'. */
  target?: string;
  /** Bullet column heads. Defaults 'Actual', '% of {v1}', 'vs {v1}' (percent-of-target rows), 'Target' and 'Gap to {v1}'; {v1} is the comparison word. */
  actualColumn?: string;
  shareColumn?: string;
  deltaColumn?: string;
  targetColumn?: string;
  gapColumn?: string;
  /** Line under a bullet gap: below, above or on the comparison value. Defaults 'below {v1}', 'above {v1}', 'on {v1}'. */
  gapBelow?: string;
  gapAbove?: string;
  gapOn?: string;
  /** Waffle note naming the share of one cell; '{value}' becomes the percent, such as 5%. Default 'One cell = {value}'. */
  cellNote?: string;
  /**
   * Last item of a note line that lists only its first items (`notes.maxListed`); '{count}' becomes the
   * number left out. Default 'and {count} more'. A React chart with hover on adds ' (tap or hover shows each value)' when this is not set.
   */
  moreListed?: string;
  /** Story panel buttons and counter ('{step}' and '{count}', two digits). Defaults '‹ Back', 'Next ›', '{step} – {count}'. */
  storyBack?: string;
  storyNext?: string;
  storyCounter?: string;
  /** Live region position; '{step}' and '{count}' are unpadded. Defaults 'Step {step} of {count}' (EN), 'Schritt {step} von {count}' (DE). */
  storyStep?: string;
  /** Ends of a scatter qualitative axis. Defaults 'Lower' and 'Higher'. */
  axisLow?: string;
  axisHigh?: string;
  /** Table and dimswitch note for a change printed n.m.: past ±999 % or off a base that rounds to 0. */
  nearZeroChange?: string;
  /** Table note for a change printed n.m. because one operand is a partial total over fewer rows. */
  mixedCoverage?: string;
  /** Dimswitch card note naming the periods it leaves out at a narrow width; {periods} is replaced. */
  hiddenPeriods?: string;
  /** Cascade share-column heading. */
  share?: string;
  /** Histogram binning disclosure; {count}, {about}, {width}, {from}, {to}. */
  histogramBins?: string;
  /** Histogram approximation word, including its trailing space. */
  histogramAbout?: string;
  /** Histogram method note; {count}, {width}, {from}, {rule}, {rounding}, {smallSample}. */
  histogramMethod?: string;
  histogramRuleCount?: string;
  histogramRuleWidth?: string;
  /** Rounded bin width description; {rule} is replaced. */
  histogramSnapped?: string;
  histogramRounded?: string;
  histogramSmallSample?: string;
  /** Required source-null stack notes; {categories} is replaced. */
  missingStack?: string;
  incompleteStacks?: string;
  /** Required stacked-area note for a suppressed series; {series} and {period} are replaced. */
  rebaseZero?: string;
  rebaseMissing?: string;
  /** Required note for incomplete 100% stacks without total100; {categories} is replaced. */
  knownPartsShares?: string;
}

/** One step of a story: its panel text and the data ids it brings forward. No highlight is an intro step. */
export interface StoryStepSpec {
  id: string;
  title: string;
  body?: string;
  highlight?: Id | Id[];
}

export interface StorySpec {
  steps: StoryStepSpec[];
  /** The step static output (SVG, PNG, server render) draws; default the first. */
  step?: string;
}

export interface LegendOptions {
  position: 'right' | 'bottom' | 'top';
  order?: Id[];
}

export interface ValueAxisOptions {
  show?: boolean; // default false — direct labels are the default
  min?: number;
  max?: number;
  tickStep?: number; // snapped to nice; may NEVER clip data
  includeZero?: boolean;
  percent?: boolean;
  /** Scatter only: log10 scale on 'x', 'y' (also `true`) or 'both'; every value on it must be above zero. */
  log?: boolean | 'x' | 'y' | 'both';
  reverse?: boolean;
  gridlines?: boolean; // default false
  /**
   * Valid straight breaks collapse the omitted domain span to a fixed 12px gap.
   *
   * `style` names only what v1.0 accepts. `'wiggle'` (line/area/
   * mekko) is staged for v1.5 and is rejected by the schema today, so declaring
   * it here would let a consumer compile a document the runtime always refuses —
   * the exact divergence this package exists to remove. Widening the literal when
   * wiggle ships is not a breaking change. Absent or `false` keeps the axis whole.
   * Waterfall and pvm alone accept `'auto'`: choose a safe break when the smallest
   * total is at least twice the running span and the steps would be small.
   * A pvm bridge resolves an absent break to `'auto'` when its smaller total is
   * over 10 times its largest step or its running levels span under 20% of the
   * larger total; `false` keeps its axis whole.
   * Totals stay visibly taller than smaller steps and no shorter than equal steps.
   * Unsafe automatic breaks move down when valid; unsafe authored breaks are ignored with a warning.
   */
  break?: { from: number; to: number; style?: 'straight' } | 'auto' | false;
}

export interface CategoryAxisOptions {
  crossesBetween?: boolean;
  dateTicks?: 'years' | 'quarters' | 'months' | 'weeks' | 'days';
}

/**
 * Right-hand axis that RELABELS the primary domain as a share of `total` —
 * not a second scale. No `y2` is created, every series keeps the primary
 * scale, and the primary domain is pinned so the top tick row is exactly
 * 100%. Because there is only one scale, a ruler is not a dual axis and does
 * not carry the `dual-axis` warning.
 */
export interface AxisRuler {
  of: 'primary';
  /** The quantity 100% refers to; must be positive and finite. */
  total: number;
  /** Number of tick INTERVALS on the percent ladder; default 5 ⇒ 0…100 by 20. */
  ticks?: number;
}

/**
 * Mutually exclusive by construction: `acknowledge` opts in to a genuinely
 * independent second scale, `ruler` declares there is no second scale at all.
 * Supplying both is a contradiction about what the right-hand axis MEANS, so
 * the union makes it a type error (and combo refuses both at runtime).
 */
export type AcknowledgedSecondaryAxis = { acknowledge: true };
export type SecondaryAxisOptions =
  | (AcknowledgedSecondaryAxis & {
      ruler?: never;
      /**
       * Pin the acknowledged secondary domain (data may only WIDEN it, never
       * be clipped). Used by the pareto chart: the cumulative
       * share axis is pinned to [0, 100] so the percent ladder reads exact
       * shares while the bar axis stays independently economy-capped.
       */
      domain?: [number, number];
      /**
       * Format-by-example for the right-axis TICKS only (e.g. '1.2%'); wins
       * over series formats. Data labels keep their series/scale formats.
       */
      format?: string;
      /**
       * false draws no right tick column: the secondary series is read
       * from its labelled values and the secondary axis title. Default true.
       */
      show?: boolean;
    })
  | { acknowledge?: never; ruler: AxisRuler };

export interface TopNOptions {
  n: number;
  /** Show the rest bucket. On Pareto, false hides its column but keeps it in the cumulative curve. */
  rest?: boolean;
  restLabel?: string;
  showRestCount?: boolean;
  threshold?: number;
}

/**
 * Focus input: the ONE active source owner whose labels gain solver
 * priority. This is the pure, serializable half of `InteractionTarget`:
 * the host keeps the interaction state (`activeId`) and takes the target's
 * `owner`. The `chart`/`panel` scope is expressed by WHICH resolved request
 * carries the focus — for a grid, the panel's own options — so a focus in one
 * panel never reaches a sibling, which is a separate layout run.
 */
export interface FocusInput {
  /** Source owner to emphasise. An owner with no defined key never matches. */
  owner: OwnerRef;
}

/** One cell `details` key: its label on the hover card, its number format and unit. */
export interface DetailField {
  key: string;
  label?: string;
  format?: string;
  unit?: string;
}

export interface BaseOptions {
  /**
   * Accessible presentation. `title` emits the SVG hover title (default false);
   * accessible naming is always retained. `description` replaces the generated
   * accessible description with the author's text; omitted, the chart writes it.
   * `table` asks the React chart components for the record-derived accessible
   * data table: 'hidden' keeps it available to assistive technology only,
   * 'toggle' adds a disclosure control, and 'below' renders it visibly under the chart. BoardplotChart includes it in
   * the server output; a per-type component adds it after mount. Omitted, no
   * table is drawn.
   * The SVG is unchanged by `table`.
   */
  a11y?: { title?: boolean; description?: string; table?: 'hidden' | 'toggle' | 'below' };
  /** Explicit presentation mode; otherwise full at or above the chart's minimum width, compact below it. */
  mode?: 'full' | 'compact';
  /**
   * What a canvas below the chart's minimum (on either axis) gets, for the types with a
   * compact floor: column, line, scatter, dot and bar. 'compact' (default) draws the tight
   * chart down to the floor, and on a pinned canvas a full-mode refusal for lack of room falls
   * back to compact; 'refuse' refuses below the minimum. Types without a floor
   * always refuse below their minimum.
   */
  belowMinimum?: 'compact' | 'refuse';
  /** Reading context. Default report. */
  target?: RenderTarget;
  /**
   * One factor on every text the chart draws, 0.5 to 2.5. 1, like absent,
   * keeps the target's sizes; 1.25 sets every text 25 % larger. The layout
   * re-flows at the new sizes; the canvas keeps its size. A factor under 1
   * stops each text at the target's readability floor; a factor above 1
   * raises the floors with the text. The factor scales the size of the chart's width
   * class, so charts of different widths draw different sizes at the same
   * factor; `textSize` gives equal text across charts.
   */
  textScale?: number;
  /**
   * The primary label size in layout px, the same at every width, 6 to 32.
   * Every other text role keeps its ratio to the primary label in the middle
   * width class (720 to 1079 px): `textSize: 13` on the report target draws a
   * 560 px chart with the sizes a 1010 px chart has. Use it for equal text
   * across charts on one page or slide. A chart of 1080 px or more draws smaller than its default under textSize 13. On slide and print, textSize is in layout px. Not allowed with `textScale`. In a
   * grid it applies to every panel, and a panel may not set a different value.
   * A size under the target's floor stops each text at that floor.
   */
  textSize?: number;
  /** Target default or explicit frame. A width alone leaves height automatic. */
  size?: CanvasSizeInput;
  margin?: Partial<Margin>;
  /** Outer frame margin; each supplied side overrides margin and theme defaults. */
  canvas?: { margin?: Partial<Margin> };
  /** False omits the visible chart title while retaining an accessible name. */
  title?: string | false;
  subtitle?: string | Subtitle; // string ⇒ { measure }
  unit?: string; // declared once; composed into subtitle
  /**
   * The host prints the unit beside the chart. True, no end label, table
   * head or legend check repeats it; number formatting does not change.
   * Default false.
   */
  unitShown?: boolean;
  source?: string;
  /**
   * The notes under the chart, in authored order. False leaves the notes off
   * the canvas: these notes, the method notes the engine derives, the key to
   * an event badge and the "+N notes" pointer. A disclosure that `notes.show`
   * prints (a rounding note, a partial period, values not printed), the
   * source line and a required map credit stay. For a
   * host that draws its own frame around the chart and carries the notes
   * there; `title: false` is the same switch for the title.
   */
  footnotes?: string[] | false;
  /**
   * The footer rule. `maxListed`: the items a note line
   * the engine writes for what the drawing leaves out ("Not labelled on the
   * chart:...") names before it counts the rest ("and 3 more"); default 8,
   * 'all' names every item, 0 names none and only counts them ("18 of 36
   * values"). Every item stays in the reading's omissions and the hover records. `placement`: 'frame' prints notes in the frame within
   * `maxLines`, 'list' prints only the source, a required credit and the
   * pointer, 'info' is a React "Notes and sources" button (the SVG draws it as
   * 'frame'); default dashboard 'info', slide 'list', else 'frame'.
   * `maxLines`: visible lines of notes and source, a required credit not
   * counted; default report and dashboard 3 (2 under 720 px), slide 2,
   * print 3. `show`: the kinds the frame prints, default ['note'], the
   * author's notes; 'method' adds the engine's short method lines, and
   * 'disclosure' the engine's notes on how to read the chart (keys, data
   * changes, "Not labelled on the chart:..."), outside the budget; 'ranks'
   * only the rank key, the disclosure that names the rank numbers a column
   * row draws when its names do not fit (also printed by 'disclosure'). Engine
   * notes not shown stay in the notes list. `pointer`: default true, prints
   * "+N notes" when the notes list holds more of the kinds `show` prints.
   */
  notes?: {
    maxListed?: number | 'all';
    placement?: 'frame' | 'info' | 'list';
    maxLines?: number;
    show?: ('note' | 'method' | 'disclosure' | 'ranks')[];
    pointer?: boolean;
  };

  theme?: ThemeRef;
  locale?: LocaleSpec;
  /** Built-in wording for renderer-composed labels; explicit options still win per label. */
  strings?: StringsSpec;
  format?: string; // chart-level format-by-example
  /**
   * Label, format, unit and order of the cell `details` keys, the extra facts
   * a value's hover card lists after it. Declared keys print first, in this
   * order; an undeclared key prints after them, labelled with its key.
   */
  detailFields?: DetailField[];
  /**
   * How an automatic number format prints a nonzero value below its last
   * shown digit. 'bound' (default): "<0.01" at two decimals, ">−0.01" below
   * zero, "<1" for whole numbers, "<+0.01" on a signed change label; below 0.0001, scientific form. 'zero': spreadsheet style, the format's
   * own "0.00". 'scientific': two significant digits and a power of ten,
   * "1.2 × 10⁻⁹". 'p-value': every value from 0 to 1 prints as APA 7
   * writes a p-value, ".042", and "<.001" below. An authored format prints
   * as authored.
   */
  smallValues?: 'bound' | 'zero' | 'scientific' | 'p-value';

  /** Named theme palette (theme.color.palettes key) for the series ramp. */
  palette?: string;
  labelDensity?: LabelDensity; // default 'smart'
  labels?: false | Partial<Record<LabelKind, boolean | LabelContent>>;
  labelPlacements?: Record<Id, SlotId>;
  /**
   * Where the category names go (column, combo, pareto). 'axis' (default): the
   * row under the axis. 'staircase': each name in the free space over the
   * lower columns, one step lower than the one before, with a vertical leader
   * down to its column; falls back to the row, with a warning, when a name has
   * no seat.
   */
  categoryLabels?: 'axis' | 'staircase';

  legend?: 'none' | 'right' | 'bottom' | 'top' | 'auto' | LegendOptions; // auto accepts a visible subtitle measure or unit naming one primary series; explicit settings take precedence
  valueAxis?: ValueAxisOptions;
  categoryAxis?: CategoryAxisOptions;
  /**
   * The SHARED surface is acknowledge-only, because that is what
   * `schema/shared.ts` accepts. The `ruler` variant lives on ComboOptions,
   * whose own schema widens it (`combo/index.ts` secondaryAxisSchema) — and
   * it has to, because the react-surface check enumerates every declared
   * option against the runtime and catches `secondaryAxis.ruler` declared on
   * all 27 charts while 26 of them reject it. Declarations follow the
   * runtime; the runtime is never widened to match a declaration.
   */
  secondaryAxis?: AcknowledgedSecondaryAxis;
  /** `x` is refused: no chart type shares an x scale. */
  scaleGroup?: { x?: never; y?: string; id?: string };

  /**
   * Alignment of the row labels on a horizontal category axis. Default 'left':
   * one shared left edge. 'right' pushes each label block against the plot —
   * note a MULTI-LINE label is still positioned by its longest line, so its short lines stay ragged on the right.
   */
  rowLabels?: { align?: 'left' | 'right' };
  sort?: { categories?: SortOrder; segments?: SortOrder };
  topN?: TopNOptions;
  /**
   * REFUSED on every registered type, and typed so the compiler says so.
   * Measured: `transpose: true` moved the geometry of 0 of 240 fixtures
   * across all 29 types — the schema said yes and nothing happened, which is
   * the worst failure mode, because the only
   * caller of this surface is an agent reading `ok: true`. Orientation in this
   * library is a TYPE, not a flag: 'bar' is the horizontal twin of 'column',
   * 'butterfly' the mirrored one, and waterfall carries its own `variant`.
   * Declarations follow the runtime (see secondaryAxis above), so this is
   * `never` on both sides rather than dropped on one.
   */
  transpose?: never;
  bandFraction?: number; // default 0.7; column: 0.5 to 0.56 of the pitch, wider on a narrow plot

  highlight?: Id | Id[];
  /** Guided story: steps that fade every mark but the ones a step names, with a text panel. */
  story?: StorySpec;
  colorblindSafe?: boolean;
  /**
   * How strongly forecast, partial-period and no-data hatches draw, 0 to 100;
   * 100 is the theme's recipe. Default 60 on a line or area forecast, 100
   * where the hatch is the only cue (theme.ts, HATCH_STRENGTH_DEFAULT).
   */
  hatchStrength?: number;
  /** `sum-consistent` makes computed shares total 100%. Incompatible precisions or more than 13 decimals warn and keep the requested formats without adjustment. */
  rounding?: 'nearest' | 'sum-consistent';
  animate?: boolean;
  /** Emit progressive-enhancement metadata; layout geometry is unchanged. */
  interactive?: boolean;
  debug?: boolean;

  /**
   * Embed claim: the width (CSS px) at which this chart's SVG will be
   * placed in a host document. Fonts are absolute SVG px, so the host scales
   * type by s = embed.width / canvas width; declaring the width arms the
   * `type-below-effective-min` lint (a warning).
   * Geometry never changes.
   */
  embed?: { width: number };

  /**
   * Active-source focus. The ONE source owner whose labels gain solver
   * priority while it is set; every other label keeps its authored order.
   * Public and serializable (matching `schema/shared.ts`'s nullable `focus`),
   * so it travels on the resolved layout request and is retained by the
   * prepared request fingerprint; `null` clears an inherited focus. The focus
   * adds `focusBonus` to a selected label's sort key, which may carry it past a
   * higher authored band — that is the intended promotion. Layout only: totals,
   * shares, scales and claims are unchanged, and with the key omitted the
   * layout is byte-identical to a build without the feature. A grid panel scopes
   * its own focus by carrying it on that panel's options; siblings never see it.
   */
  focus?: FocusInput | null;

  annotations?: Annotation[]; // reserved key — adapters fold top-level annotations here
  measure?: TextMeasurer; // TS-only; EXCLUDED from JSON Schema
}

/** A shared-base key whose admission `src/core/schema/shared.ts` decides per type. */
type GatedOptionKey = keyof typeof OPTION_CAPABILITY & keyof BaseOptions;

/** The gated keys chart type `T` does NOT implement. */
export type RefusedOptionKeys<T extends string> = {
  [K in GatedOptionKey]: (typeof OPTION_CAPABILITY)[K] extends { unsupportedSeverity: 'warn' }
    ? never
    : T extends (typeof OPTION_CAPABILITY)[K]['implementedBy'][number]
      ? never
      : K;
}[GatedOptionKey];

/**
 * `BaseOptions` as chart type `T` really accepts it.
 *
 * Every gated key `T` does not implement becomes `never` rather than being
 * dropped, for the reason `transpose` is `never` above and `secondaryAxis.ruler`
 * is absent from charts that do not implement it: declarations FOLLOW the runtime, and the pack
 * contract's option enumeration compares them in BOTH directions — a key the
 * declaration offers and the schema refuses fails `react-surface` exactly as
 * loudly as the reverse. Dropping the key instead would also make
 * `options.locale` on a column chart a plain "property does not exist", where
 * `never` lets the compiler point at the same sentence the runtime prints.
 */
export type BaseOptionsFor<T extends string> = Omit<
  BaseOptions,
  RefusedOptionKeys<T> | 'valueAxis' | (T extends 'mekko' ? 'mode' : never)
> & {
  [K in RefusedOptionKeys<T>]?: Refused<BaseOptions[K]>;
} & {
  valueAxis?: ValueAxisFor<T>;
};

/**
 * A refused key as a layout sees it: absent. An object option whose fields
 * are all optional keeps their names with every value `never`, so no value
 * typechecks and a leftover `options.sort?.categories` read compiles to
 * undefined; any other refused key is `never`.
 */
type Refused<V> = NonNullable<V> extends object
  ? {} extends NonNullable<V> ? { [P in keyof NonNullable<V>]?: never } : never
  : never;

/** The valueAxis sub-keys type `T` does not read, from VALUE_AXIS_CAPABILITY and VALUE_AXIS_ONLY. */
type RefusedValueAxisKeys<T extends string> =
  | {
      [K in keyof typeof VALUE_AXIS_CAPABILITY]: T extends (typeof VALUE_AXIS_CAPABILITY)[K]['implementedBy'][number] ? never : K;
    }[keyof typeof VALUE_AXIS_CAPABILITY]
  | (T extends keyof typeof VALUE_AXIS_ONLY
      ? Exclude<keyof ValueAxisOptions, (typeof VALUE_AXIS_ONLY)[T]['keys'][number]>
      : never);

/**
 * `ValueAxisOptions` as chart type `T` accepts it: the refused sub-keys are
 * `never`, the way BaseOptionsFor refuses top-level keys, and a type that
 * reads no sub-key at all (pvm, sparkline, table) gets `never` for the
 * object, so even `valueAxis: {}` fails to compile as the schema refuses it.
 */
type ValueAxisFor<T extends string> = T extends keyof typeof VALUE_AXIS_ONLY
  ? (typeof VALUE_AXIS_ONLY)[T]['keys'] extends readonly []
    ? never
    : ValueAxisOptionsFor<T>
  : ValueAxisOptionsFor<T>;

type ValueAxisOptionsFor<T extends string> = {
  [K in keyof ValueAxisOptions]: K extends RefusedValueAxisKeys<T> ? never
    : K extends 'break' ? T extends 'waterfall' | 'pvm' ? ValueAxisOptions[K] : Exclude<ValueAxisOptions[K], 'auto'>
      : ValueAxisOptions[K];
};

export interface DerivedRatioTier {
  id: Id;
  label: string;
  numeratorSeriesId: Id;
  denominatorSeriesId: Id;
  at: Id[];
  format?: string;
  direction?: Direction;
}

// ---- per-chart options ----

/** Modified z-score rule, computed from the data. */
export interface AnomalyMadSpec {
  method: 'mad';
  /** Flag threshold on |modified z|; default 3.5, the authors' pairing with 1.4826. */
  k?: number;
  /** Centre of the rule. 'zero' (default) reads the input as a deviation. */
  baseline?: 'zero' | 'median';
  /** Names the rule on the exhibit; it is prefixed to the derived sentence, never a replacement. */
  label?: string;
}

/** Fully authored bounds — no statistics at all. */
export interface AnomalyThresholdSpec {
  method: 'threshold';
  low?: number;
  high?: number;
  label?: string;
}

export type AnomalySpec = AnomalyMadSpec | AnomalyThresholdSpec;

export interface ColumnOptions extends BaseOptionsFor<'column'> {
  /** Title of the drawn value axis. */
  axisTitles?: { primary?: string };
  variant?: 'grouped' | 'stacked' | 'stacked100'; // default 'grouped'
  /**
   * Which values print, as on line: 'none', 'last', 'ends' (first and last),
   * 'extremes' (first, last, highest and lowest; a tie takes the first) or
   * 'all', per series. Wins over labelDensity. The value axis is drawn
   * unless valueAxis.show says otherwise or the mode is 'all'. Grouped only.
   */
  valueLabels?: ValueLabelMode;
  grandTotalLabels?: boolean; // default true when stacked, false when stacked100
  /** Every stacked series is a share of the same whole; the stack then has a total. Stacked variants only. */
  sharesOfOneWhole?: boolean;
  referenceStyle?: 'tick' | 'line' | 'marker'; // default 'tick'
  /** Per-category cumulative-boundary ticks; ordered column axes connect them by default. */
  netLine?: boolean | { seriesId?: Id; connectors?: boolean };
  /** Computed arithmetic-average rule; Id[] limits the contributing series. */
  averageMarker?: boolean | { scope: 'all' | Id[] };
  /**
   * `style` is 'line' (default) or 'dashed'; dashed matches the waterfall
   * bridge's dash.reference token. There is no 'dot' or 'line-dot' variant:
   * 'dot' would draw boundary markers and NO connecting line, so it would
   * show two corners the rects already show and drop the relationship the
   * connector exists to state; 'line-dot' would add glyphs carrying no extra fact.
   */
  connectors?: boolean | {
    style?: 'line' | 'dashed';
    scope?: 'all' | Id[]; // default 'all'
  };
  /**
   * Ribbon chart (rank-flow stacked columns): a translucent band joins each
   * series' segments in adjacent columns. `order` 'rank' (default on stacked)
   * stacks each column by its own values, largest on top, so a crossing
   * ribbon is a rank swap; 'sheet' (default on stacked100) keeps the series
   * order. Stacked variants only; for ordered columns only.
   */
  ribbons?: boolean | { order?: 'rank' | 'sheet' };
  ratioTier?: DerivedRatioTier;
  /**
   * Paint each column good/bad/neutral by sign(value) × series.direction.
   * Declared HERE, not in a chart-local type: the column zod schema accepts
   * it at runtime, so a consumer type that omits it is exactly the
   * type-runtime drift the public-API lock exists to catch.
   */
  signColor?: boolean;
  /** Paint the data series on the theme's ordered ramp, the first strongest, for series whose order is the encoding. */
  seriesRamp?: boolean;
  /** With `seriesRamp` and a Rest series (colorRole 'others'): 'quietest' keeps every named step further from the background than Rest. 'apart': they only differ from it. Unset takes the chart default (DEFAULT_OTHERS_SHADE). */
  othersShade?: OthersShade;
  /** Flag exceptional periods against a visible, named threshold corridor. */
  anomaly?: AnomalySpec;
  /**
   * Name the stacked series once, at the right edge of the LAST column
   * or the left edge of the FIRST, instead of in a legend: the
   * layers of a cohort chart are read off their own bars. `{ only }` names
   * the ones that get a label, which is how twelve layers carry five names.
   */
  seriesLabels?: {
    at: 'right-edge' | 'left-edge';
    only?: Id[];
    /** Each name carries its series' CAGR ("Product B +10.1% p.a."), first to last category or over from/to. */
    cagr?: true | { from?: Id; to?: Id; format?: string };
  };
  /** Segment shares on chosen columns only (`only`), in a format by example ("26.3%"). Stacked variants. */
  shareLabels?: { only?: Id[]; format?: string };
  /** Display the last n periods; source means and anomaly rules keep every period. */
  window?: Pick<LiveWindowOptions, 'last'>;
  /** Visible category endpoints; source means and anomaly rules keep every period. */
  viewDomain?: { x: [string, string] };
  /** The event lane and key: placement, lane rows, event groups (column, combo, line). */
  events?: EventOptions;
}
/** Football-field "current value" pin: bare number or number plus its label. */
export interface CurrentValueSpec {
  value: number;
  label?: string;
}
/** Tornado base case: the output metric with every driver at its base input. */
export interface BaseValueSpec {
  value: number;
  label?: string;
}
/**
 * Tornado case identity. Two NAMED series rather than one range cell, because a
 * range normalizes low>high away and would destroy the fact that an inverse
 * driver's LOW input produces the HIGH output.
 */
export interface TornadoCases {
  low: Id;
  high: Id;
}
// The bar schema is `z.ZodType<BarOptions>`: the football-field variant and its
// currentValue pin are runtime-accepted, so they are declared here rather than
// in a chart-local type the package never exported. The tornado variant and its
// baseValue/tornado pins are the same class and are declared for the same
// reason — pack-contract's react-surface check compares every component's props
// against the RUNTIME option surface, so a runtime-accepted option that is not
// on the published interface fails the pack.
// `anomaly` is omitted for the MIRROR reason: bar's zod schema does not accept
// it, so inheriting it would declare a surface the runtime refuses
// (type-runtime-drift-reverse). Same principle, both directions. `signColor`
// and `colorblindSafe` are inherited: bar paints the sign colour as column
// does, and colorblindSafe swaps its good/bad pair.
// The column-only label, ramp and viewport keys are omitted too: bar's
// layout reads none of them and its schema refuses them.
export interface BarOptions
  extends Omit<
    ColumnOptions,
    'ratioTier' | 'variant' | 'anomaly' | 'rowLabels' | 'events'
    | 'seriesRamp' | 'othersShade' | 'seriesLabels' | 'shareLabels' | 'window' | 'viewDomain' | 'categoryLabels' | 'ribbons'
  > {
  /** Refused: a horizontal bar prints each name beside its row already (staircase names are column, combo and pareto). */
  categoryLabels?: never;
  /**
   * Re-declared, not inherited: bar's type is derived from COLUMN's, and column
   * has no row labels, so the shared gate types `rowLabels` as never there and
   * bar would inherit the refusal for an option it implements. Any shared option
   * bar implements and column does not has to be omitted and restated here.
   */
  rowLabels?: { align?: 'left' | 'right' };
  /**
   * The weight and the ink of the reference tick. It is read only
   * under `referenceStyle: 'tick'`: the dashed 'line' keeps its 1.25 px and
   * the 'marker' its neutral dot. A board that wants a strong prior-year
   * mark authors `{ width: 2, color: 'highlight' }`.
   */
  referenceTick?: { width?: number; color?: 'ink' | 'highlight' };
  variant?: ColumnOptions['variant'] | 'football-field' | 'tornado';
  currentValue?: number | CurrentValueSpec;
  baseValue?: number | BaseValueSpec;
  tornado?: TornadoCases;
  /**
   * Default false. true adds the method notes of the football-field and tornado
   * variants; a football-field range draws its mid-point tick only with its
   * note. Hatched tornado bars and drivers not shown print regardless.
   */
  methodNote?: boolean;
}
export interface ButterflyOptions extends BaseOptionsFor<'butterfly'> {
  a: Id;
  b: Id;
  centerColumnWidth?: number;
  sortBy?: 'sheet' | 'a' | 'b' | 'sum' | 'diff';
  /**
   * A right-aligned column of each row's difference (b minus a), signed, under
   * a bold delta head. Default true with sortBy 'diff', else false. A
   * highlighted row prints bold; the column stays off below 576 px canvas width.
   */
  diffColumn?: boolean;
  sharedScale?: boolean; // default true
  /** A negative value: 'direction' runs its bar from the pane's zero line toward the names, 'magnitude' draws |value| outward in a lighter tint. Default 'direction'. */
  negatives?: 'direction' | 'magnitude';
}
export interface WaterfallOptions extends BaseOptionsFor<'waterfall'> {
  /** Authored value-axis title above a vertical bridge; horizontal bridges do not print it. */
  axisTitles?: { primary?: string };
  variant?: 'vertical' | 'horizontal'; // default: vertical, or horizontal when the step names would rotate
  build?: 'up' | 'down'; // default 'up'
  /** Paint each plain step good or bad by its sign times the item's direction; false paints the neutral. */
  signColor?: boolean;
}
export type LineInterpolation = 'linear' | 'step-after' | 'step-before' | 'monotone';
export type GapFillTone = 'good' | 'bad' | 'neutral';

/** A target pin addressed from options, which must name its series. */
export interface LineOptionTarget extends LineSeriesTarget {
  seriesId: Id;
}

export interface LineGapFill {
  between: [Id, Id];
  positiveTone?: GapFillTone;
  negativeTone?: GapFillTone;
}

/**
 * One nested uncertainty band of a fan, declared as a pair of ordinary series.
 *
 * `label` is REQUIRED and carries no default. "80% predictive interval",
 * "P10-P90 of 500 simulations" and "min/max of three planning scenarios" are
 * drawn identically and mean entirely different things; a reader cannot
 * recover which one they are looking at from the picture, so the author has to
 * say. There is no honest fallback string the engine could invent here.
 */
export interface LineFanBand {
  /** Series id carrying the lower bound. */
  low: Id;
  /** Series id carrying the upper bound. */
  high: Id;
  /** What the interval MEANS. Required, min length 1. */
  label: string;
}

/**
 * Uncertainty fan preset. Bands are ORDINARY SERIES painted as nested washes;
 * the engine derives no quantile, sigma or interval of its own — see
 * `FanDerived.method` in the line layout for why.
 *
 * Bands are authored OUTERMOST FIRST, and the engine verifies that nesting
 * rather than sorting it: reordering a crossed pair would hide an authoring
 * error the reader could never see.
 */
export interface LineFan {
  /** The central trajectory series id. */
  of: Id;
  /** 1..4 bands, outermost first. Four is the legibility cap, not a whim. */
  bands: LineFanBand[];
  /** Draw the bound series as dotted hairlines as well; default false. */
  showBounds?: boolean;
}

/**
 * Bump preset. Direction is CHART-LEVEL and cannot be per series: ranking puts
 * every entity on one ladder, so "this series is lowerIsBetter and that one is
 * higherIsBetter" names no ordering at all. A per-series `direction` on the
 * data is therefore ignored with a warning rather than honoured.
 */
export interface LineBumpOptions {
  direction?: 'higherIsBetter' | 'lowerIsBetter'; // default 'higherIsBetter'
  /**
   * The entities to draw, at most BUMP_SERIES_LIMIT (12). Every entity is
   * still ranked; the others are named in a note with their last rank and
   * keep their values in the data table. Above the limit a bump without it is
   * refused (bump-series-limit).
   */
  focus?: Id[];
}

/**
 * A named reference band on a line chart: one level (`value`) or a range
 * (`low` and `high`) in the value axis' units, drawn as a thin neutral band
 * across the plot and named in a column right of it.
 */
export interface LineReferenceBand {
  id?: Id;
  value?: number;
  low?: number;
  high?: number;
  /** Bold short name, such as "60+". */
  label: string;
  /** Plain words after the name, such as "very strong cycle". */
  description?: string;
}

/** Where a line chart names its series: at the line ends, on the lines, in a key row above the plot, or nowhere. */
export type SeriesLabelMode = 'end' | 'inline' | 'key' | 'none';
/** Which point values a line prints: none, the last, the first and last, those plus each series' low and high, or every point. */
export type ValueLabelMode = 'none' | 'last' | 'ends' | 'extremes' | 'all';

/** A unit of a time-axis tick step. */
export type LineXTimeUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** The continuous x axis of a line or area chart (data.x). */
export interface LineXAxis {
  /** 'time' reads data.x as instants in `zone`; 'number' as plain numbers. */
  type: 'time' | 'number';
  /** IANA zone of ticks, labels and offset-free times; default 'UTC'. */
  zone?: string;
  /** Axis start, an x value; default the first reading. */
  min?: string | number;
  /** Axis end, an x value; default the last reading. */
  max?: string | number;
  /** Authored tick step: a number on number axes, { unit, step } on time axes. */
  tickStep?: number | { unit: LineXTimeUnit; step?: number };
  /** Explicit ticks: x values or { value, label } pairs. */
  ticks?: (string | number | { value: string | number; label?: string })[];
  /** Tick label format: a time pattern such as 'HH:mm', or a number format-by-example. */
  format?: string;
  /** Axis title under the tick row, at the right end. */
  title?: string;
  /** Number axes: the unit of x, which names the trend slope. */
  unit?: string;
  /** Most ticks the automatic ladder draws; default 10. */
  maxTicks?: number;
}

export interface LineOptions extends Omit<BaseOptionsFor<'line'>, 'annotations'> {
  /** On a time x axis, x anchors also accept epoch milliseconds, including categoryId, date and end. */
  annotations?: Annotation<string | number>[];
  /** Least-squares fit per shown series (line/area) over every source value in the shown range. Regular months, quarters and years fit on the period index; other dates use weeks or elapsed UTC days; otherwise category positions. The key prints slope per period unit and r². At least 3 non-null points; window/zoom sets the fitted range. */
  trend?: boolean | { label?: string };
  /** stacked100-area defaults to sum-consistent rounding of complete computed wholes; nearest preserves separate rounding. */
  rounding?: 'nearest' | 'sum-consistent';
  /** The event lane and key: placement, lane rows, event groups. */
  events?: EventOptions;
  /** Title over the drawn value axis. */
  axisTitles?: { primary?: string };
  /** Where an end label of a series that ends early goes: beside its last point, 'lineEnd' (default), or in the gutter right of the plot, 'gutter'. The theme's labels.endLabelPlacement sets the default. */
  endLabelPlacement?: 'gutter' | 'lineEnd';
  /** Display-only live window; source statistics and index baselines stay complete. */
  window?: LiveWindowOptions;
  /** Flag exceptional periods of the one drawn line against a named corridor, with column's rule. */
  anomaly?: AnomalySpec;
  /** Visible category endpoints, or two x values on a continuous axis. Calculations keep the complete source series. */
  viewDomain?: { x: [string | number, string | number] };
  /** Continuous x axis: readings from data.x placed by value, as times in a zone or plain numbers. */
  xAxis?: LineXAxis;
  /**
   * FC areas use hatched fills; FC lines use a contrast-safe tint. An actual-to-forecast
   * transition adds a divider at the last actual point and an FC header, reusing authored period furniture.
   * Area endpoints use leaders. Stacked and 100% area values sit wholly on their band,
   * the first and last moved inward along it; stacked100-area values need twice the measured
   * label height. Shared band edges have 1px separators.
   * `'bump'` is a rank preset on the line engine, not a fifth geometry: the
   * engine derives standard-competition ranks from the values and plots those.
   * It is mutually exclusive with the area variants by construction — the
   * field holds one value — and refuses `valueAxis.percent` promotion.
   */
  variant?: 'line' | 'area' | 'stacked-area' | 'stacked100-area' | 'bump';
  bump?: LineBumpOptions;
  /**
   * Where the series names print. 'end' (default): a column right of the line
   * ends with short leaders, names only. 'inline': on each line's clear
   * stretch. 'key': a key row above the plot. 'none': nowhere; two or more
   * drawn series then fall back to the key row. `{ only }` names the listed
   * series at their ends and leaves the rest without name or value. A lone
   * plain line defaults to 'none', the title names it.
   */
  seriesLabels?: SeriesLabelMode | { only: Id[] };
  /** Which point values print, each at its own point. Default 'last'; 'ends' on stacked100-area, 'none' on bump. */
  valueLabels?: ValueLabelMode;
  /**
   * A ring on the last observed point: the newest cohort of a curves chart,
   * the current period of a trend. `'ring'` picks the primary series (the
   * hero where `emphasis` named one, else the first data series that is not
   * a prior year, a plan or a forecast); the object form names the series
   * outright. `'none'` and omission draw nothing.
   */
  latestPoint?: 'ring' | 'none' | { series: Id; marker?: 'ring' };
  /**
   * Multi-series line colouring. `'none'`: every series takes its theme
   * ramp colour, `color.series[i]`. `'first'`: the first series takes ink and
   * the others step back to muted context tints. `'ordered'`: the series take
   * the theme's ordered ramp in data order, the first the lightest (still 3:1
   * on the page) and the last the full ink, for series whose order is the
   * encoding, such as cohorts. Unset means `'none'`, except on a drawn fan,
   * whose centre is the subject and takes the ink, and on `stacked-area` and
   * `stacked100-area` without a highlight, palette or series fill, whose bands
   * take `'ordered'` (`'none'` keeps the theme hues). `'first'` is for the plain
   * `line` variant only; highlight, palette, series fill, colorRole and
   * series-level scenario keep their own colours; cell-level FC and PL keep
   * their dashes.
   */
  emphasis?: 'first' | 'ordered' | 'none';
  /** With `emphasis: 'ordered'` and a Rest series (colorRole 'others'): 'quietest' keeps every named step further from the background than Rest. 'apart': they only differ from it. Unset takes the chart default (DEFAULT_OTHERS_SHADE). */
  othersShade?: OthersShade;
  /** With `highlight`: 'grey' (default) greys the other series; 'fade' keeps their own colour, washed toward the page. */
  highlightMode?: 'grey' | 'fade';
  rebase100?: boolean | { at: Id };
  ratioTier?: DerivedRatioTier;
  interpolate?: LineInterpolation;
  gapFill?: LineGapFill;
  fan?: LineFan;
  targets?: LineOptionTarget[];
  /** Contiguous phase partition filled under one continuous curve. */
  phases?: LinePhase[];
  /**
   * Weight and ink per scenario, opt-in and absent by default. A chart
   * that draws an actual against its prior year reads best with one
   * ladder: the current series at 1.5 px in the ink, the prior year at 1 px
   * in the muted ink. Nothing else in the engine reads a scenario for
   * weight, and the default widths (2, and the hero ladder's 2.4 and 1.4)
   * stand where this is absent. An authored `fill` or `colorRole`, a
   * `highlight` and `emphasis: 'first'` all still win.
   */
  scenarioStyle?: Partial<Record<Scenario, LineScenarioStyle>>;
  /** Default false. true adds the bump chart's ranking note; fan gaps and folded tails print regardless. */
  methodNote?: boolean;
  /** Named reference bands, each named in a column right of the plot and tied to its band by a leader. */
  referenceBands?: LineReferenceBand[];
}

/** Weight and ink the lines of one scenario take. */
export interface LineScenarioStyle {
  /** Stroke width in px. */
  width?: number;
  /** Which neutral ink the line takes. */
  ink?: 'ink' | 'inkMuted';
}

/** One lifecycle/era phase: an inclusive category span with its own fill. */
export interface LinePhase {
  id: Id;
  label: string;
  from: Id;
  to: Id;
  tone?: 'neutral' | 'muted' | 'highlight' | 'good' | 'bad' | 'warn';
  rank?: number;
}
/** First line point defaults to its value; last defaults to series name and value. */
export interface ComboOptions extends Omit<BaseOptionsFor<'combo'>, 'secondaryAxis'> {
  /** The event lane and key: placement, lane rows, event groups. */
  events?: EventOptions;
  /** Visible category endpoints; source means retain all observations. */
  viewDomain?: { x: [string, string] };
  /** Display the last n periods; source means retain all observations. */
  window?: Pick<LiveWindowOptions, 'last'>;
  /** Flag exceptional periods of the one line series against a named corridor, with column's rule. */
  anomaly?: AnomalySpec;
  /** Combo is the one type whose schema accepts the percent `ruler` form. */
  secondaryAxis?: SecondaryAxisOptions;
  /** Titles above active axes; acknowledged secondary charts infer unique series names and units. */
  axisTitles?: { primary?: string; secondary?: string };
  /** Combo's line/area series share the line family's interpolation contract. */
  interpolate?: LineInterpolation;
  /** The dual-axis anatomy on an acknowledged, unpinned secondary scale. */
  dualAxis?: { anatomy?: boolean; growth?: boolean };
  /** Which line points print their value, as on the line chart; default 'last' ('ends' under the dual-axis anatomy). The key row names the series. */
  valueLabels?: ValueLabelMode;
  /**
   * A ring on the last observed point of the lead line series, as on the line
   * chart. `'ring'` picks the first line series that is not a prior year, a
   * plan or a forecast. `'none'` rings nothing, and also drops the ring a
   * theme's ink lead line draws; omission keeps the theme's choice.
   */
  latestPoint?: 'ring' | 'none';
  /** The mean of the column stacks as a dashed Ø rule, as on column; lines are left out. */
  averageMarker?: ColumnOptions['averageMarker'];
  /** How reference series draw, as on bar and column; default 'tick'. */
  referenceStyle?: ColumnOptions['referenceStyle'];
  /** Weight and ink of the reference tick, as on bar; read under referenceStyle 'tick' only. */
  referenceTick?: BarOptions['referenceTick'];
}
/**
 * Pareto. `sort` is deliberately absent: descending IS the analysis, and an
 * option to un-sort it would be an option to stop being a Pareto.
 */
export interface ParetoOptions extends Omit<BaseOptionsFor<'pareto'>, 'sort'> {
  /**
   * `never`, not absent. Omitting the key makes `sort` a plain unknown property,
   * which a non-strict zod object STRIPS: the option would parse away silently, leave
   * the published JSON Schema, and escape the (type, key) census
   * at all. The schema refuses it out loud, so the declaration says so too.
   */
  sort?: never;
  /**
   * Cumulative-share reference, 0 < t < 100; default 80. A convention to
   * choose, not a property of the data: the rule, the highlighted vital few
   * and their key follow it. `false` draws the curve without a reference and
   * without the vital-few split.
   */
  threshold?: number | false;
  /** Draw the derived cumulative curve; default true. */
  cumulative?: boolean;
  /** Footnotes stating the derivation and the vital-few set; default false. */
  methodNote?: boolean;
  /** Title over the left value axis; drawn when authored, or derived where the theme sets valueAxis.titles. */
  axisTitles?: { primary?: string };
  /**
   * Scale the left axis to the total, so 100 % on the right sits level with
   * the total on the left and the curve starts at the top of the first
   * column. Default: on when a vital few reaches the threshold and no
   * valueAxis.min or max is set, off for a flat distribution; false keeps
   * two independent scales.
   */
  totalScale?: boolean;
}
export interface MekkoOptions extends BaseOptionsFor<'mekko'> {
  /** Title of the drawn value axis, drawn only when authored. */
  axisTitles?: { primary?: string };
  variant?: 'stacked100' | 'stacked' | 'bar'; // default 'stacked100'
  widthSeriesId?: Id;
  ridge?: Id;
}
export interface PieOptions extends BaseOptionsFor<'pie'> {
  /** Hole radius fraction, capped at 0.72 when inside labels are enabled. Centre totals include unit. */
  doughnut?: number;
  /** Defaults to five largest slices plus Others. */
  topN?: TopNOptions;
  /** Up to four displayed slices default to named outside labels with leaders. */
  labels?: BaseOptions['labels'];
  rotate?: 0 | 90 | 180 | 270;
  explode?: Record<Id, number>;
  /** Default 'sequential': one perceptual tint ladder at every slice count. 'categorical': each slice takes its own series hue. */
  colors?: 'categorical' | 'sequential';
  /** Sequential ramp beside an Others slice. 'quietest': named slices stay further from the background than Others. 'apart': they only differ from it. Unset takes the chart default (DEFAULT_OTHERS_SHADE). */
  othersShade?: OthersShade;
}
/**
 * A quadrant cut point: either the number the author declares, or a statistic
 * the engine computes over the PLOTTED points and names on the exhibit. There
 * is deliberately no size-weighted form — a weighted median needs declared
 * weight semantics and there is no honest default.
 */
export type QuadrantThreshold = number | { stat: 'median' | 'mean' };

/**
 * Strategy-matrix (2x2 / growth-share) preset on the scatter engine.
 * `x` and `y` are MANDATORY: where the dividing lines go decides which unit is
 * a star and which is a dog, so a bare enable is refused rather than guessed.
 */
export interface QuadrantOptions {
  x: QuadrantThreshold;
  y: QuadrantThreshold;
  /** Box captions, all optional; each rendered one places inside its own box. */
  labels?: { tl?: string; tr?: string; bl?: string; br?: string };
  /**
   * Neutral checkerboard wash only. Good/bad quadrant coloring is NOT offered:
   * the engine cannot know axis polarity, so a semantic quadrant color would be
   * an unfounded judgment. Emphasis belongs on `options.highlight`.
   */
  tint?: 'none' | 'alternating'; // default 'none'
  /** First caption candidate: the box's outer corner (default) or its centre. */
  captionPlacement?: 'corner' | 'centre';
  /**
   * Short names of the two axes for a one-line method note ("Cuts: share at 1
   * and growth at 8; …"). Used only with both names and two declared cut points.
   */
  axisNames?: { x?: string; y?: string };
}

/**
 * Per-axis outlier clamp. `min`/`max` are the vertical axis, the one
 * `valueAxis.min` and `valueAxis.max` address on this type; `x` and `y` name an
 * axis. Stating the vertical bound both ways is refused, not merged.
 */
export interface ScatterClampOptions {
  min?: number;
  max?: number;
  x?: { min?: number; max?: number };
  y?: { min?: number; max?: number };
}

/**
 * `valueAxis` as scatter widens it. The shared `min`/`max` widen the domain so
 * no value is cut off; `clamp` caps it on purpose and marks what it cut.
 */
export interface ScatterValueAxisOptions extends ValueAxisOptionsFor<'scatter'> {
  clamp?: ScatterClampOptions;
}

export interface ScatterOptions extends BaseOptionsFor<'scatter'> {
  /** Exact visible scale limits; means and bubble sizing retain all source points. */
  viewDomain?: { x?: [number, number]; y?: [number, number] };
  valueAxis?: ScatterValueAxisOptions;
  /** Drop points whose `count` is below this; refused when no point carries one. */
  minCount?: number;
  /** Axis titles; a scatter without them leaves the reader guessing which axis is which. */
  axisTitles?: { x?: string; y?: string };
  /**
   * Format-by-example per axis, such as { x: '$0', y: '0%' }. Each falls back
   * to `format`. Ticks, point values, hover values, zone and clamp text and
   * the accessible description print each coordinate in its own axis format.
   */
  axisFormat?: { x?: string; y?: string };
  /** `value: true` prints each point's value: the size on a bubble chart, y otherwise. */
  labels?: false | (Partial<Record<LabelKind, boolean | LabelContent>> & { value?: boolean });
  sizeBy?: 'area' | 'diameter'; // default 'area'
  maxPointLabels?: number; // default 300
  quadrants?: QuadrantOptions;
  /**
   * Linear trend: an ordinary least squares fit over the drawn points, drawn
   * dashed across the fitted x range under the points. `true` fits all points
   * as one; `groups: 'each'` fits every group, a list fits the named groups.
   * Slope, intercept and r² go into the claims. The key entry prints the
   * slope and r²; on the plot the only text is `label`, at an end of the line.
   */
  trend?: boolean | { groups?: 'all' | 'each' | Id[]; label?: string };
  /**
   * Pareto line through the drawn points no other point beats on both axes.
   * `x` and `y` say which end is better, such as { x: 'min', y: 'max' } for
   * the lowest cost at the highest score. Dotted, under the points, in x
   * order; keyed as 'Pareto line' or `label`. `extend` runs it a short way
   * past its first and last point; `groups` limits it to those groups.
   */
  frontier?: { x: 'min' | 'max'; y: 'min' | 'max'; label?: string; extend?: boolean; groups?: 'all' | Id[] };
  /**
   * Bubble size key: nested circles on one bottom tangent, each with its value,
   * inside the plot in the first corner no bubble touches. Bubble charts only;
   * drawn by default whenever a size is mapped, false turns it off.
   * Default values: a round number at most the largest size and one a quarter
   * of it or less; an authored value above the largest size is left out with a
   * warning. `label` names the size measure.
   */
  sizeLegend?: boolean | { values?: number[]; label?: string };
  /** Axes that read as directions, not scales: no ticks, 'Lower' and 'Higher' at the ends, the bold title between arrows. */
  qualitativeAxes?: boolean;
  /**
   * Default false. true adds the method notes: axes that do not start at zero
   * and the quadrant cut points, tie rule, shading and box counts. Clipped and
   * dropped points print regardless.
   */
  methodNote?: boolean;
}
export interface VarianceOptions extends BaseOptionsFor<'variance'> {
  /** Title of the value axis valueAxis.show draws, drawn only when authored. */
  axisTitles?: { primary?: string };
  variant: 'absolute' | 'relative' | 'integrated';
  variance: VarianceSpec;
  /**
   * What a category with no prior value leaves behind. 'dash' prints an en
   * dash at the baseline in the muted ink, so a missing reference reads as
   * missing instead of as no difference. Default 'none'.
   */
  missingMark?: 'dash' | 'none';
}
/** Rows stop at their measured natural pitch, normally 44px; deltas use the label token. */
export interface BulletOptions extends BaseOptionsFor<'bullet'> {
  /** Title of the shared-scale value axis valueAxis.show draws, drawn only when authored. */
  axisTitles?: { primary?: string };
  /**
   * true: one absolute value scale across all rows — for same-unit rows whose
   * magnitudes should compare (this was the only behaviour before ENGINE_REV
   * 15). false: each row is normalized to its own zero-based extent (band
   * maximum, extended by value/target overshoot) — the bullet-graph percent-of-scale
   * convention, which keeps mixed-unit KPI rows legible. Default: false
   * exactly when every row declares bands, true otherwise (a bandless row has
   * no band maximum to normalize to). Normalized rows ignore `valueAxis` with
   * a warning: one absolute axis cannot describe differently scaled rows.
   *
   * 'percentOfTarget': every row on one scale in percent of its own
   * target (actual ÷ target), 0 to 120 %; three shared bands (below 80 %,
   * 80–100 %, at or above target) named once in a key, mirrored at 100 % on a
   * lower-is-better row (the key then names them more than 20 % off, up to
   * 20 % off, on target or better), one target line at 100 %, the value, its share of target and the
   * delta beside each row. The rows' own bands, `valueAxis` and annotations
   * are not drawn.
   */
  sharedScale?: boolean | 'percentOfTarget';
  /**
   * How the band key reads. 'labels': one entry for each band label and shade.
   * 'ramp': one worse-to-better key with N entries (Worse ... Better; the words
   * come from `strings.bandKey` or the locale). 'auto' (default): ramp only when
   * the rows run both directions, a label sits on more than one shade, every
   * banded row has the same 2 to 5 bands, no band has a tone and no row is
   * neutral; otherwise labels. A forced ramp that cannot apply keeps labels and warns.
   * 'row': each band's name prints above its band on every row, the band edges are
   * ticked under each row on per-row scales, the value sits just past the bar end and
   * a key at the bottom names the bar and the target tick, and the ramp when `strings.bandKey` sets its words. It needs a name
   * on every band, rows side by side with the target column, and room for each name;
   * elsewhere the key names the bands and a warning says so. 'auto' picks 'row' for at
   * most 4 rows that name every band, wherever 'row' can show.
   */
  bandKey?: 'auto' | 'labels' | 'ramp' | 'row';
  /**
   * true (default): where the rows sit side by side and the plot keeps 45 % of
   * the width, a Target column and a Gap-to-target column print beside the
   * rows under their heads; the gap carries its position (below, above or on
   * target) under it, and each row name its direction. Where they do not fit,
   * and with false, the target prints above its tick and the delta at the row end.
   */
  targetColumns?: boolean;
  /**
   * 'compact': the 120 x 28 mark for a KPI column. Bar, bands and
   * target tick stay; row label, value, delta, axis and band key go, and the
   * value and target stay in the description and the hover. Default 'regular'.
   */
  density?: 'compact' | 'regular';
}
export interface DotOptions extends BaseOptionsFor<'dot'> {
  /** Authored value-axis title, under the tick row when the axis is drawn. */
  axisTitles?: { primary?: string };
  variant?: 'dot' | 'dumbbell' | 'lollipop';
  /** The mean of every dot of the series in scope as a dashed Ø rule, as on bar and column. */
  averageMarker?: ColumnOptions['averageMarker'];
  /**
   * Dumbbell only: the connector becomes an arrow into the second series' dot.
   * Painted good or bad by the sign of the change when the second series
   * declares `direction`, neutral otherwise.
   */
  arrow?: boolean;
  /**
   * Dumbbell only: the gap (second series minus first) per row, signed, in a
   * column right of the plot under a head such as "Gap, pp". A highlighted row
   * prints bold. Default false; the column stays off below 576 px canvas width.
   */
  gapColumn?: boolean;
  /** Default false. true adds the method note naming the mid-point tick inside a range, and draws the tick. */
  methodNote?: boolean;
  /**
   * What the drawn ranges are. `label` names the interval in the key
   * ("Peer range, min to max"); default "Range". `values: true` prints each
   * range's low and high beside its caps.
   */
  range?: { label?: string; values?: boolean };
}
export interface SlopeOptions extends BaseOptionsFor<'slope'> {
  /**
   * Fold every series that stays under this share of the endpoint total at BOTH
   * ends into one 'Other' line whose values the engine sums. A SHARE, not a
   * percent: 0.05 is five percent, and 5 is refused with the patch that turns it
   * into 0.05. Highlighted series keep their own name whatever their share.
   */
  foldBelowShare?: number;
  /**
   * A column of each line's change, right of the second rail's labels, under a
   * head such as "Change, pp". 'absolute' prints second minus first (points for
   * percent values), 'relative' the percent change. The highlighted line prints
   * bold. Default 'none'; the column stays off below 576 px canvas width.
   */
  change?: 'none' | 'absolute' | 'relative';
  /**
   * 'diverging' draws one panel per series: its values as the positive share
   * up from zero and its `negative` as the negative share down from zero, at
   * two periods. Unset draws the plain slope lines.
   */
  variant?: 'lines' | 'diverging';
  /** Variant 'diverging' only. */
  diverging?: {
    /** Area names in the first panel. Default 'Positive' and 'Negative'. */
    labels?: { positive?: string; negative?: string };
    /** Panel order. Default 'positive': the positive share in period 2, descending. */
    sort?: 'positive' | 'net' | 'data';
    /** Net score (positive − negative) in period 2 and its change under each panel, defined once in the key. Default true. */
    net?: boolean;
    /** A note naming the share that chose neither answer, when the two do not add to 100. Default true. */
    neutralNote?: boolean;
    /** A group with a base `n` under this in either period is hatched and named in a note. Default 30. */
    minBase?: number;
  };
}
export interface HeatmapOptions extends BaseOptionsFor<'heatmap'> {
  scale?: 'continuous' | 'discrete'; // default 'continuous'
  /** Automatic values share one fit decision per row; authored labels and valid pins retain precedence. */
  variant?: 'value' | 'harvey' | 'bubble';
  /** Where the continuous scale saturates, as table heat's cap: `pct` on a matrix of percent cells, in points, `abs` otherwise. */
  cap?: { pct?: number; abs?: number };
  /** Bin edges of the discrete scale, ascending: n edges paint n − 1 colour bins, such as [0, 30, 50, 100]. */
  breaks?: number[];
  /**
   * The bubble glyph: `levels` names ordinal sizes 1..n (series `sizes` hold
   * the level), else sizes are a continuous area scale. `sizeLabel` and
   * `colorLabel` title the two keys. `track` draws a line with an arrow through
   * each row (default false: it implies an order).
   */
  bubble?: { levels?: string[]; sizeLabel?: string; colorLabel?: string; track?: boolean };
  /** Cells whose series `bases` entry is below this base draw hatched, and a note says why. */
  minBase?: number;
  /**
   * How a cell with no value is drawn. Default `'hatch'`: stripes and a key
   * entry. `'blank'` draws no fill and no stripe; the same key entry or note
   * still names the blank cell. A blank cell keeps its grid line and dash,
   * so it does not read as the palest value. A low base stays hatched.
   */
  missing?: 'hatch' | 'blank';
}
/** Standalone width defaults to 360px and stops at 420px; comparison rows follow the value. */
export interface KpiOptions extends BaseOptionsFor<'kpi'> {
  /**
   * 'compact' uses a 280 px default card width instead of 360, for a
   * dashboard that puts nine of them in a row. An
   * unsized card of either density takes the height of its content.
   * 'regular' is the default.
   */
  density?: 'compact' | 'regular';
  /**
   * How `data.compare[]` and `data.attainment` are drawn. 'chip'
   * (the default) puts each in a tinted chip. 'text' draws each one the way
   * `data.delta` is drawn: text in its tone and no fill, the compare entries
   * signed with a caret, side by side on one row and one per row when they do
   * not fit, the attainment on the row under them.
   */
  comparisons?: 'chip' | 'text';
}
/**
 * The standalone sparkline: 176 by 36 by default, no axes, no
 * smoothing, no fill. A bare one draws edge to edge, because it is a mark
 * inside someone else's card; one that carries a title, subtitle, source or
 * note is 320 px wide by default and takes the canvas margin, and
 * `canvas.margin` overrides either.
 */
export interface SparklineOptions extends BaseOptionsFor<'sparkline'> {
  /** A ring on the last observed point, in the highlight. Default 'last'. */
  ring?: 'last' | 'none';
  /**
   * The first and last authored label under the ends of the line. Default
   * 'none'. It is `endLabels` and not `labels`, because `labels` is the
   * shared per-label-kind switch every other type reads.
   */
  endLabels?: 'ends' | 'none';
  /**
   * 'last' prints the last observed value beside the end of the line. On a framed sparkline with
   * room it also names the high, the low and the first value, and the reference value. 'last-and-high'
   * prints only the last value and the high. Default 'none'.
   */
  valueLabel?: 'last' | 'last-and-high' | 'none';
  /** Stroke width of the line. Default 1.5. */
  stroke?: number;
  /** A 1 px dashed line at this value; the scale always includes it. On a framed sparkline its value prints in the last value's column when valueLabel is 'last'. */
  reference?: number;
  /** The end ring in this tone instead of the highlight. Refused with ring 'none'. */
  ringTone?: 'good' | 'warn' | 'bad';
}
export interface FunnelOptions extends BaseOptionsFor<'funnel'> {
  /** Rows bound automatic callout leaders to three text widths; centered stage text uses three centered lines. */
  variant?: 'rows' | 'centered';
  totalCvr?: 'none' | 'column';
  /** Centered single-series stages darken by default; authored paints and palettes take priority. */
  stageShade?: 'darken' | 'lighten';
  /**
   * Rows only: the automatic "Biggest drop" callout at the step with the
   * largest loss. Default false; the step captions already print every rate.
   */
  worstDropCallout?: boolean;
}
export interface GridOptions extends BaseOptionsFor<'grid'> {
  /** Top-down metric stack with shared categories and computed readouts. */
  stack?: import('../charts/grid/metricStack').MetricStackOptions;
  columns?: number;
  /** Category-aligned column/variance tiers use 4:1 plot heights unless authored tracks or a shared y scale apply. */
  sharedAxis?: 'category' | 'none';
  /**
   * Numeric panels with matching unit and format read against one value scale,
   * so panel heights compare in facets and category-aligned tiers.
   *
   * Defaults to true in every sharedAxis mode only with evidence of one
   * measure: every numeric panel names the same non-empty unit and format,
   * the grid names a unit, or the panels come from repeat or a scaleGroup. A
   * shared chart type is no evidence. Set true to share panels without a
   * unit, false to keep independent domains. A grid with a nonnumeric panel or mismatched unit or
   * format stays independent unless an authored scale group says otherwise.
   */
  sharedScale?: boolean;
  /**
   * Panel order. `sheet` keeps the authored array and is the default.
   *
   * Deliberately NOT spelled `sort: { panels }`. The inherited base `sort` is
   * category-shaped, and `ChartDefinition` constrains every options type to
   * extend `BaseOptions`, so narrowing that key on one chart does not type.
   * Widening it would leave `sort: { categories: 'asc' }` legal on a grid and
   * silently dropped, which is a defect, so the ordering gets a key
   * of its own instead of an overloaded one.
   *
   * Only meaningful for facet cells; an authored row/column grid places its
   * panels explicitly, and asking for an order there warns rather than silently
   * doing nothing.
   */
  panelOrder?: 'sheet' | 'lastDesc' | 'lastAsc' | 'totalDesc' | 'totalAsc';
  /**
   * A facet grid of more panels than `columns` (a number) on a card under 480 px takes
   * `columns` as a maximum: where a panel drops category names for room, it draws with
   * fewer columns, down to two, at the largest count that prints every name and that an
   * authored height seats.
   * Default true. False keeps the authored count at every width.
   */
  reflow?: boolean;
}
