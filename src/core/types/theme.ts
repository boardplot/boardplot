/** Theme: the typed JS object is canonical. */

import type { DeepPartial } from './cell';
import type { Margin } from '../geometry';
import type { FontSpec } from '../text';

/** The closed role set — the only names `type.scale` may step. */
export type TypeRoleName = 'title' | 'subtitle' | 'label' | 'axis' | 'footnote' | 'micro' | 'secondary';

export interface Theme {
  name: string;
  color: {
    good: string;
    bad: string;
    /**
     * The large signed fills: a sign-coloured column, a variance
     * bar or cap, a line gap fill, a likert disagree segment (bad only), a negative mekko bar or
     * a heatmap cell over 12 × 12 px that `good` or `bad` would paint.
     * Absent means `good` / `bad`: the marks carry the fill token either way
     * and resolve it, so a scene repaints between themes with and without
     * the role. Text, ticks, strokes, pins and small squares keep `good` /
     * `bad`; colorblind-safe mode keeps `colorblind`. A theme whose `good` is
     * a light accent on a dark ground sets a quieter fill here so a row of
     * columns does not glow.
     */
    goodFill?: string;
    badFill?: string;
    /**
     * The marks that step back when a highlight selects others on a
     * single-series bar or column chart. Absent means
     * `neutralLight`: the marks carry the `rest` token either way.
     */
    rest?: string;
    /**
     * The fill of an Others mark: the topN Others bucket of a bar, column,
     * pie, mekko, butterfly or dot chart, and a series or slice whose
     * colorRole is 'others'. Absent means `others`: the marks carry the
     * `othersMark` token either way. Every preset sets it 1.4:1 or more
     * against its page, as no outline carries the mark by default. `others` itself stays the ground of the
     * gantt shades and row tints, the value bands and annotation fills.
     */
    othersMark?: string;
    /**
     * The ink a chart draws a data mark in, apart from the text ink: a hero
     * or area line, a context line ladder, a combo lead line under
     * `marks.comboLine: 'ink'`, the latest-point dot, the standalone
     * sparkline, the stepped heat lane, and the bar, column, range, dot,
     * mekko, pareto, bump, difference and gantt marks that drew in the ink,
     * and the bullet measure bar.
     * Axes, value lines, reference ticks, brackets and connectors keep
     * `ink`. Absent means `ink`: the marks carry the `markInk` token either
     * way. Held to the mark floor on the background (3:1 as a line).
     */
    markInk?: string;
    /**
     * The top band of a stepped heat lane and the ink of its figures.
     * Absent means `markInk`, then `ink`, under `inkInverse`. A dark theme whose
     * full ink glares as a cell sets a quieter band and a dark figure ink.
     */
    heatTop?: string;
    heatTopInk?: string;
    /**
     * The fallback text inks on a fill where neither `ink` nor `inkInverse`
     * reaches 4.5:1: the dark one and the light one. Absent means
     * '#050505' and '#FFFFFF'. The pair needs 20.25:1 between its two inks
     * for one of them to reach 4.5:1 on every fill.
     */
    onFillInk?: string;
    onFillLightInk?: string;
    neutral: string; // AC dark
    /**
     * The marks that paint in the neutral: a butterfly's and pyramid's first
     * side, variance and waterfall bars in the neutral tone, a zero
     * sign column, a dumbbell's first dots, a slope's lines, a box's points
     * and whiskers, a column spark, a likert midpoint, a neutral status cell,
     * a heatmap's lowest step, a series whose colorRole is 'neutral', and the
     * scenario keys. Absent means `neutral`: the marks carry the
     * `neutralMark` token either way. A theme whose neutral is a band or
     * surface tint sets a mark-strength colour here; it is held to the
     * series floor on the background.
     */
    neutralMark?: string;
    neutralLight: string; // PY light grey
    highlight: string; // single accent
    /**
     * The colour of the marks `options.highlight` selects: a
     * highlighted bar, column, dot, slice, box, step, point, gantt item or
     * line, and the swatch beside its label. Absent means `highlight`: the
     * marks carry the `focus` token either way and resolve it to the
     * highlight, so a scene repaints between themes with and without the
     * role. A design that keeps its accent for one mark a reader must find
     * (the latest-point ring, a reference tick) sets it apart, often to the
     * ink. The line hero of `emphasis: 'first'` is the ink either way.
     */
    focus?: string;
    /**
     * The line of a spark: the spark of a kpi card, a table
     * sparkline cell and a creative trend, and the line over an area spark.
     * Absent means `neutralMark`, then `neutral`: the line carries the `spark`
     * token either way and resolves it to the neutral mark role, so a scene repaints between themes
     * with and without the role. `neutral` is a fill, and a pale one (a
     * band or prior-year sand) draws a line that is hard to see; such a
     * theme points the spark at its ink. A column spark's columns stay
     * fills and take `neutralMark`; the last point keeps `highlight`. The
     * standalone `sparkline` type draws its line in the ink and does not
     * read the role.
     */
    spark?: string;
    total: string;
    others: string;
    ink: string;
    inkInverse: string;
    inkMuted: string; // additive: source lines, tick labels
    /**
     * The tertiary ink: a table's state glyphs, a cell kept out of
     * its heat lane, and a section heading that names it. Absent means
     * `inkMuted`: the marks carry the `inkMeta` token either way and resolve
     * it, so a scene repaints between themes with and without the role.
     */
    inkMeta?: string;
    axis: string;
    grid: string;
    leader: string;
    /**
     * The structural rule of a table: the head underline, the
     * rules above and under a total row and the rule that closes the body,
     * on the SVG and in the grid. Absent means `axis`: the rules carry the
     * `rule` token either way. A theme whose axis ink is a quiet grey sets
     * its house rule colour here, so tables keep a firm rule while axes
     * stay quiet.
     */
    rule?: string;
    /**
     * A reference line that frames a comparison: the two rails of
     * a slope chart. Absent means `axis`. Held to 3:1 on the background once
     * set (WCAG 2.2 SC 1.4.11), since a reader reads the values against it.
     */
    reference?: string;
    background: string;
    series: string[]; // categorical ramp
    /** Tornado low/high cases; absent resolves to neutralLight/highlight. */
    casePair?: [string, string];
    /**
     * The fills of a stacked or 100% column or bar, strongest on
     * the page first and the quietest last (2 or more steps). More series than
     * steps share the ramp evenly between its ends. Absent keeps the
     * categorical `series` order.
     */
    stack?: string[];
    /**
     * The fills of treemap groups by rank, the first drawn group the
     * strongest (2 or more steps). More groups than steps share the ramp
     * evenly between its ends. Absent takes `stack`; a theme without either
     * steps the first series colour toward the page.
     */
    treemap?: string[];
    seriesOverflow?: 'repeatLast' | 'cycle'; // default 'repeatLast'
    /**
     * Named alternative categorical ramps (e.g. 'region', 'channel') so one
     * report can keep DISJOINT color vocabularies per dimension. Charts opt in
     * via options.palette; unknown names warn and fall back to `series`.
     */
    palettes?: Record<string, string[]>;
    status: Record<string, string>; // 'advanced' | 'open' | 'lost' | …
    /**
     * `goodFill` / `badFill` paint the large signed fills under colorblindSafe
     * (a status cell, a sign-coloured column, a variance bar or cap), as
     * `color.goodFill` / `color.badFill` do outside it. Absent means
     * `colorblind.good` / `colorblind.bad`.
     */
    colorblind: { good: string; bad: string; goodFill?: string; badFill?: string };
    /**
     * Judgment between good and bad (at-risk). Optional for external
     * themes — warnColor() supplies the default dark amber.
     */
    warn?: string;
    /**
     * The large warn fill: a status cell, a bar, segment or chevron,
     * a zone, phase or row wash, a diagram node that `warn` would paint.
     * Absent means `warn`. Text, strokes, glyphs and chips keep `warn`, which
     * a light theme darkens to read as text; set the brighter amber here so a
     * warn cell does not read as olive.
     */
    warnFill?: string;
  };
  /**
   * Scenario notation. AC, PY and FC are fixed. The plan look
   * is 'outline' by the standard; 'solidMuted' draws a plan bar solid in
   * `inkMuted` at 35 % over the background, with no outline.
   */
  scenario: { AC: 'solid'; PY: 'solidLight'; PL: 'outline' | 'solidMuted'; FC: 'hatch45' };
  pattern: { hatchAngle: 45; hatchGap: number; hatchStrokeWidth: number; outlineStrokeWidth: number; hatchColor?: 'ink' | 'segment' };
  type: {
    family: string;
    title: FontSpec;
    subtitle: FontSpec;
    label: FontSpec;
    axis: FontSpec;
    footnote: FontSpec; // ≈ 70% base
    /**
     * Micro role: in-plot geographic/matrix
     * abbreviations ONLY (choropleth/tilemap tier ladders) — never values,
     * axes, or footer. Optional for external themes; `microType()` derives
     * the relation micro = footnote − 1 px (floored at the 7.5 px
     * effective minimum), which reproduces the canonical column exactly at
     * every width class.
     */
    micro?: FontSpec;
    /**
     * Secondary text: value and period tick labels, axis
     * titles, scenario markers (AC | FC) and the names and values of series
     * a highlight leaves in the background. Smaller than `label`, so the
     * labels that carry the message lead. Optional; absent means the `axis`
     * role (`secondaryType()`).
     */
    secondary?: FontSpec;
    /**
     * Width-class size steps (classes W-S 480–719, W-M 720–1079,
     * W-L ≥ 1080). `size` on each role above is the W-M
     * (canonical) value; `scale.S`/`scale.L` carry the other two columns.
     * Absent → the role keeps its size at every class (external themes
     * that predate the norm render one fixed scale). Resolution happens
     * once per layout via `themeForWidth`; scene fonts never carry steps.
     */
    scale?: {
      S?: Partial<Record<TypeRoleName, number>>;
      L?: Partial<Record<TypeRoleName, number>>;
    };
    /**
     * Figures on the numeric text roles (value labels, axis ticks, table
     * numbers, KPI values). Absent means 'tabular'. Titles, names, notes and
     * source lines never carry a figure setting.
     */
    numeric?: 'tabular' | 'proportional';
    /**
     * The big figure of a KPI card: its family and weight. It is
     * not a sized role and `type.scale` does not step it; the figure keeps
     * its title-derived size. Absent means `type.family` at weight 700, so a
     * theme without it renders at that default. A family is measured like every
     * other role's: from the built-in or injected width tables when one of
     * its names is tabled, else by the character-class model. The kpi layout
     * reads it from the resolved theme; `themeForWidth`, which the cards skip,
     * does not carry it.
     */
    figure?: { family?: string; weight?: number };
    /**
     * The eyebrow of a KPI card, the label over the figure when the
     * card has no title: size and line height, weight, tracking in em of the
     * size, and its ink. Each absent key keeps
     * the default eyebrow: the label role at 13 px or more, as authored, in
     * `inkMuted`. `type.scale` does not step it, as the card keeps its column.
     */
    eyebrow?: ThemeEyebrow;
    /**
     * Text emphasis: the one weight a chart uses
     * for a total, a hero figure or an authored focus, without a size change.
     * Absent means 700. Every other text takes its role weight (400).
     */
    emphasis?: { weight?: number };
  };
  space: {
    tierGap: number;
    facetGap: number;
    labelPad: number;
    /**
     * Canvas margin tokens, keyed by width
     * class: `base` covers W-S/W-M, `wide` covers W-L (≥ 1080 px). Optional
     * for external themes — `spaceTokens()` supplies the norm values. The
     * two card types (kpi, bullet) are exempt from the width classes and
     * keep their compact card margins.
     */
    canvas?: { base: Margin; wide: Margin };
    /** Frame gap tokens; `*Wide` variants apply at W-L. */
    gap?: {
      titleSubtitle?: number;
      subtitlePlot?: number;
      subtitlePlotWide?: number;
      axisFootnote?: number;
      axisFootnoteWide?: number;
      footnoteSource?: number;
      legend?: number;
    };
    /** Horizontal legend band row height (legend.rowH). */
    legendRowH?: number;
    /**
     * A fixed bar row: the bar thickness and the row pitch in px.
     * Absent, bar rows share whatever height the canvas gives them. Set, a
     * row is `pitch` tall (or its label, if taller) and a taller canvas never
     * stretches it: the chart lays out at its natural height, draws at the
     * top of the canvas and leaves the rest empty.
     */
    barRow?: { thickness: number; pitch: number };
  };
  /** Automatic keys for series without visible names; omitted or false keeps existing defaults. */
  legend?: {
    auto?: boolean;
    /**
     * Where a key the chart cannot drop goes when the spec hides or leaves
     * the legend: the value key of a tilemap or choropleth. Absent
     * keeps 'top', one row above the plot; a position the spec names wins.
     * 'right' is refused: a key beside the plot takes the plot's width.
     */
    required?: 'bottom' | 'top';
  };
  /**
   * Default mark anatomy. Absent keeps the engine defaults, so a
   * theme without the block renders the engine defaults. An authored series `marker`,
   * `fill`, `colorRole` or node `shape.radius` still wins.
   */
  marks?: {
    /**
     * Default point markers on line series: 'auto' (a circle per point up to
     * 12 categories, none past that; every combo line) or 'none'. Under
     * 'none' a partial period keeps its hollow marker and a bump chart its
     * identity shapes, as past the density cutoff. The latest-point ring is
     * not a marker and stays.
     */
    lineMarkers?: 'auto' | 'none';
    /**
     * A single unstacked area (line variant 'area', one series, no authored
     * paint, palette or PY/PL scenario): absent fills it in its series
     * colour under a 2 px line. A
     * number fills it in `color.focus` washed that far toward the background,
     * the engine's tint amount (0.86 = 14 % focus), under a 1.5 px line in
     * `color.ink`; the forecast region keeps its hatch in the full focus.
     */
    areaTint?: number;
    /**
     * Corner radius in px of a diagram node drawn as a rounded rectangle.
     * Absent keeps the theme-scaled radius (twice `space.labelPad`, at most a
     * quarter of the node height); 0 draws square corners.
     */
    nodeRadius?: number;
    /**
     * The ring of a diagram node: its colour role and width in px.
     * Absent keeps `axis` (`grid` on a muted node) at 1 px. Group frames
     * take the width too, and `nodeRadius` rounds them.
     */
    nodeStroke?: 'axis' | 'grid' | 'leader' | 'ink' | 'inkMuted';
    nodeStrokeWidth?: number;
    /**
     * false draws the marks that recede under a highlight (`color.rest`)
     * without the separation outline the engine adds to a fill too close to
     * the background. Absent means true.
     */
    restOutline?: boolean;
    /**
     * true places an area chart's first and last category on the plot
     * edges (line variants area, stacked-area and stacked100-area), so the bands start
     * at the value axis with no half-step lead. An authored
     * `categoryAxis.crossesBetween` wins. Absent keeps the categories centred
     * in their bands.
     */
    areaFromOrigin?: boolean;
    /**
     * 'outside' places a bar's value label past the bar end, or drops it
     * where no room is left there, never inside the bar or in a backed box.
     * On grouped bars that cross zero, a negative value reads
     * right of the zero line, so the negative side holds only its bars, and
     * with no value axis drawn the domain is not rounded. Absent keeps
     * the engine cascade: inside the end where it fits, else outside, else
     * inside on a backing.
     */
    barLabels?: 'auto' | 'outside';
    /**
     * A combo's column series with no authored paint fill their actual
     * columns in `color.focus` at this tint amount (0.74 = 26 % focus).
     * Stacked series take a ramp of it: the top series the
     * tint, the ones below stepping down the stacked-area ramp (26 / 45 /
     * 70 / 100 % from the top at 0.74), capped at the full focus, so the
     * lightest band is on top. The scenario look
     * wins: plan outlines and forecast hatches draw in the full focus, and a
     * prior year keeps its scenario colour. A washed column takes no
     * separation outline in any scheme.
     */
    comboColumnTint?: number;
    /**
     * 'ink' draws a combo's lead line, when it has no authored paint, in
     * `color.ink` at 1.5 px with the latest-point ring on its last observed
     * point, on a half-pixel page-colour casing each side.
     * Absent keeps the focus at 2 px on a 1.5 px casing.
     */
    comboLine?: 'series' | 'ink';
    /**
     * The last point of a kpi card's spark, a table spark and a creative
     * trend: 'ring' draws the standalone sparkline's ring, the
     * background with a 1.5 px ring in `color.highlight`, radius 3.2. Absent
     * keeps 'dot', a filled point in the highlight.
     */
    sparkEnd?: 'dot' | 'ring';
    /**
     * false draws a kpi card's spark without the value label at its last
     * point, which repeats the card's own figure. Absent means true.
     */
    sparkEndLabel?: boolean;
    /**
     * false draws a pie or doughnut slice whose fill is too close to the
     * background with the page-colour separator only, without the
     * separation outline. Absent means true.
     */
    sliceOutline?: boolean;
    /**
     * false draws an Others mark (the topN Others bucket of a bar, column,
     * pie or butterfly chart, and a series or slice whose colorRole is
     * 'others' in a stacked column, bar or area, a mekko, a combo or a
     * funnel) without the separation outline a fill too close to the
     * background otherwise gets. Absent means true. Waffle rest cells use a
     * floor-clearing fill instead and ignore it.
     */
    othersOutline?: boolean;
    /**
     * true draws the contrast edges round fills. On a light page a fill under
     * 3:1 against the page that no value label carries takes an edge in a
     * deeper shade of its own hue and a pale stack-ramp step a neutral hair
     * outline. On any page a fill under the page floor (Others, rest, a pale
     * slice or segment, or a key swatch) takes a separation outline.
     * restOutline, othersOutline and sliceOutline then apply, and the palest
     * pie tint and a faded series may go past 1.4:1 against the page. Absent means
     * false: no fill on a light or dark page draws a contrast edge or outline.
     */
    contrastEdge?: boolean;
    /**
     * 'panel' draws every diagram node of the primary, secondary or muted
     * role on the background with its ring, so only the accent node is
     * filled. Signed, warn and category nodes keep their fills.
     * Absent keeps 'role': primary in the first series colour, secondary
     * and muted in `color.neutralLight`.
     */
    nodeFill?: 'role' | 'panel';
    /**
     * false draws a kpi card's delta and comparisons without the leading
     * caret: the signed figure and its tone carry the direction,
     * and a caret beside "+10.4% vs PY" reads as a stray bullet at card size.
     * Absent means true.
     */
    kpiCaret?: boolean;
    /**
     * How a bridge paints its steps, for the waterfall in
     * both orientations and the pvm bridge. 'sign' draws the totals in
     * `color.total` (ink when unset), a rising step in `goodFill` and a falling one in `badFill`,
     * the dotted 1 px connectors in `inkMeta`, and each step's signed value
     * beside its bar in `good` or `bad`. A step split into authored segments
     * keeps its segment colours and key, and a highlight selects a total
     * only: a step's colour is its sign. 'neutral': steps in `color.neutral`,
     * totals in `color.total`, dashed `leader` connectors. Absent, the steps
     * take their sign's fill (the waterfall's `signColor`) on dashed `leader`
     * connectors, unless the spec names a palette.
     */
    bridge?: 'neutral' | 'sign';
    /**
     * How a funnel fills its bars, rows and centered. 'ramp': a
     * single series takes the series ramp by stage (stage 1 the first
     * colour), an outcome split takes it by series, and the lost share
     * (colorRole 'status-lost' or 'bad') is `badFill` at 45 % over the
     * background. Status colours never reach the bars. An authored series
     * fill wins. Absent keeps 'status': a series colorRole resolves through
     * the theme, a single series takes the focus (centered shades it by
     * stage).
     */
    funnelFill?: 'status' | 'ramp';
    /**
     * How a status chart fills its good and neutral cells. Absent means
     * 'quiet': both draw washed toward the page, the good tone more than the
     * neutral, so off-track and at-risk cells carry the colour. 'full' fills
     * them with color.goodFill and color.neutralMark as they are.
     */
    statusFill?: 'quiet' | 'full';
    /**
     * How a bullet paints its bands. Absent means 'light': every row's
     * qualitative bands take the light ladder (0.06 lightness steps from the
     * page), a toned band takes its tone's fill washed toward the page, and
     * an attainment band washes the same way. 'full' paints toned bands and
     * attainment washes in the tone's full fill, and the ladder steps 0.12
     * apart on rows that do not print their band names.
     */
    bulletBandFill?: 'light' | 'full';
  };
  /** Label conventions; absent keeps the shipped placement. */
  labels?: {
    /** Default for the line option `endLabelPlacement`: 'lineEnd' (absent) or 'gutter'. */
    endLabelPlacement?: 'gutter' | 'lineEnd';
    /**
     * Ink of the value and category labels on the page: 'ink' (absent) or
     * 'muted', the grey `inkMuted`. A highlighted mark's labels keep the
     * full ink; labels inside a fill keep their contrast ink.
     */
    ink?: 'ink' | 'muted';
  };
  /**
   * Value-axis conventions. Each is off when absent, so a theme
   * without the block gets none of them; an explicit chart option wins.
   */
  valueAxis?: {
    /**
     * A drawn value axis with no authored title takes "Measure, unit" from
     * `subtitle.measure` and the chart unit (line, column, bar).
     */
    titles?: boolean;
    /** Default for `valueAxis.includeZero` on line charts. */
    includeZero?: boolean;
    /** A combo with an acknowledged secondary axis draws the dual-axis anatomy (`dualAxis` option). */
    dualAxis?: boolean;
    /** The gridlines of a value axis: 'solid' (absent), 'dotted' (`dash.dotted`) or 'dashed' (`dash.reference`). */
    gridDash?: 'solid' | 'dotted' | 'dashed';
  };
  /** Paint values for host interaction states; omissions use interactionTokens defaults. */
  interaction?: {
    /** Opacity applied to marks outside the active interaction set; default 0.25. */
    dim?: number;
    /** Focus and selection outline width in CSS pixels; default 1. */
    outlineWidth?: number;
  };
  /** Host interaction timings in milliseconds; omissions use interactionTokens defaults. */
  motion?: {
    /**
     * Shared interaction easing; default ease-out. Besides the two keywords a
     * theme may name its own ease-out curve as a `cubic-bezier(...)` string
     * (for example `cubic-bezier(.2,.7,.2,1)`), validated by the
     * grammar in themeRules.
     */
    easing?: string;
    /** Delay before a hover interaction activates; default 80ms. */
    hoverIntent?: number;
    /** Duration of opacity transitions; default 120ms. */
    fade?: number;
    /** Duration of positional transitions; default 160ms. */
    travel?: number;
    /**
     * Duration of layout transitions — rows opening, columns appearing,
     * a table growing; default 160ms.
     */
    layout?: number;
  };
  /**
   * Surface anatomy for chips, row tints, and schedule elapsed-era washes.
   * Optional for external themes — resolveSurface() supplies defaults.
   */
  surface?: {
    chipTint?: number;
    rowTint?: number;
    elapsedTint?: number;
    chipRadius?: number;
    /** Structural wash for level-0 parent rows (anchor wash) — quieter than rowTint. */
    anchorTint?: number;
    /**
     * Weight of `color.neutral` over `color.background` for a group band
     * ground; default 0.06, and the total row takes twice it. A theme whose
     * neutral IS the band colour sets 0.5: the band draws at half the
     * neutral and the total at the whole of it.
     */
    bandTint?: number;
    /**
     * How far a line chart's `gapFill` wash steps toward the background.
     * Default 0.82 on a light page and 0.65 on a dark one, where
     * the light step left a wash the eye barely finds.
     */
    gapTint?: number;
    /**
     * Opacity of a column ribbon (options.ribbons) over the page; default
     * 0.35. The column segment keeps the full series paint; translucency
     * lets a crossing read as the overlap darkens.
     */
    ribbonAlpha?: number;
    /**
     * Opacity of a fixed-order ribbon (options.ribbons.order 'sheet'); default
     * 0.18, lighter than a ranked one: its bands never cross, and a dark
     * segment's band must not compete with the columns.
     */
    ribbonSheetAlpha?: number;
    /**
     * Band alphas of a STEPPED table heat lane, lightest first, over the
     * background. The band above the last one is the full ink with
     * inverse text, so five bands need four entries. Default
     * 0.06 / 0.14 / 0.26 / 0.42, four steps that stay apart on a cohort grid.
     */
    heatSteps?: number[];
    /**
     * Whether a spark whose data asks for `kind: 'area'` draws the wash
     * under its line. false draws every such spark as its line and
     * last point alone. Absent means true.
     */
    sparkWash?: boolean;
    /** Where an area spark's scale and wash start; see themeFields. */
    sparkAreaBase?: 'zero' | 'min';
    /** CSS box-shadow of the React notes popover; see themeFields. */
    panelShadow?: string;
  };
  /**
   * Fixed color scheme of the family. A static theme is its scheme on every
   * host — a dark host never swaps a `light`-scheme theme for a different
   * palette, and a `dark`-scheme theme (glass) stays dark on light hosts.
   * Absent → light-slot behavior (standard/notation keep their real
   * dark pairs via AUTO_DARK).
   */
  scheme?: 'light' | 'dark';
  /**
   * Table conventions. Every key is optional and an absent key keeps
   * the engine's own behaviour, so a theme without the block renders byte
   * for byte the engine's own sizes. The faces are absolute: `type.scale` and the density
   * steps never move a size written here.
   */
  table?: ThemeTable;
  /**
   * line weights in px, by role. Every absent key takes
   * the default value (`GRAMMAR_STROKE` in core/theme): seam 0.5 (the page-colour
   * line between touching segments), hair 0.75 (gridlines,
   * row rules, fill separators, borders), rule 1 (axes, zero lines,
   * dividers, leaders, connectors, reference lines), mark 1.5 (outlines,
   * hollow markers, targets, rings), data 2 (data lines), focus 2.5 (the
   * focus data line) and casing 5 (the halo under a line). Chart code reads
   * these through `strokeToken`, never a literal.
   */
  stroke?: Partial<Record<StrokeRole, number>>;
  /**
   * dash patterns as SVG dash arrays, by role. Absent
   * keys take `GRAMMAR_DASH`: reference [4, 3] for every dashed line
   * (reference, forecast, guide), dotted [1, 3] for dotted lines.
   */
  dash?: Partial<Record<DashRole, number[]>>;
}

/** The stroke roles of the theme. */
export type StrokeRole = 'seam' | 'hair' | 'rule' | 'mark' | 'data' | 'focus' | 'casing';
/** The dash roles of the theme. */
export type DashRole = 'reference' | 'dotted';

/** A KPI card's eyebrow. */
export interface ThemeEyebrow {
  size?: number;
  weight?: number;
  lineHeight?: number;
  /** Letter-spacing in em of the size. */
  tracking?: number;
  ink?: 'inkMuted' | 'inkMeta';
}

/** One face a table draws: size in px, line height as a ratio, tracking in em. */
export interface ThemeTableFace {
  size?: number;
  weight?: number;
  /** Line box = ceil(size x lineHeight), on the SVG and in the grid alike. */
  lineHeight?: number;
  /** Letter-spacing in em of the size. */
  tracking?: number;
}

export interface ThemeTable {
  /**
   * Column heads; the column-group heads take its line height, one step
   * under its size. `case: 'asis'` prints the authored label ("Apr 25");
   * 'upper', like absent, sets it in capitals.
   */
  head?: ThemeTableFace & { case?: 'upper' | 'asis' };
  /**
   * Section rows; `ink` picks the text colour of the heading. `spaceBefore`
   * is the air in px above the label of a section that follows other rows,
   * inside its row (default one body line box; 0 for none; a first row
   * under the head takes a quarter line box, never more). `rule` is the line
   * under the label: 'heavy' (default) twice the rule stroke in the text ink,
   * 'hair' the row hairline in the ink `headRule` picks.
   */
  section?: ThemeTableFace & { ink?: 'ink' | 'inkMuted' | 'inkMeta'; case?: 'upper' | 'asis'; spaceBefore?: number; rule?: 'heavy' | 'hair' };
  /** True: density changes row height and cell padding only, never a type size. */
  fixedType?: boolean;
  /** What a change against a previous column prints where the group has none. */
  noPrevious?: 'na' | 'missing';
  /** Which group rows carry the group ground when the table option `groupGround` is absent: 'expanded' (default), 'always' or 'none'. */
  groupGround?: 'expanded' | 'always' | 'none';
  /** 'ink' draws ofWhich rows in the text colour; the relation stays arithmetic only. */
  ofWhich?: 'muted' | 'ink';
  /** What a value the data lacks prints: 'word' the n/a word, 'glyph' the missing glyph. Absent: 'glyph' where `glyphs.missing` is set, else 'word'. */
  dataGap?: 'word' | 'glyph';
  /** State glyphs; the variance chart's missing mark follows `missing`. */
  glyphs?: { missing?: string; na?: string; nm?: string; suppressed?: string };
  /**
   * Vertical air of the column-head cells in px: above the head
   * text, and between it and the head rule. Head cells written in CSS
   * as `padding: 10px 10px 8px` have 10 and 8; the horizontal air stays the
   * cell air, so a head sits over its figures.
   */
  headPad?: ThemeTablePad;
  /** Vertical air of the column-group heading row in px: above it, and under its hairline. */
  groupPad?: ThemeTablePad;
  /**
   * The vertical hairline that closes the rows on the right. 'auto', like
   * absent, draws it where the table draws it today (every table but a
   * cohort grid); 'none' draws it on neither surface, for a host whose card
   * edge already closes the rows under `rowExtent: 'frame'`.
   */
  endRule?: 'auto' | 'none';
  /** Outline mark in its fixed gutter. */
  mark?: 'bare' | 'boxed';
  /**
   * Body rows on one face: every rung prints at the label size with this line
   * height and this air above and below the line box, on the SVG and in the
   * grid. The ladder then steps weight and indent only.
   */
  rows?: { lineHeight?: number; pad?: number };
  /** Weights by row kind. Member and measure rows default to regular weight on leaves and emphasis on parents. Subtotals and results default to emphasis. `emphasis` is that weight for totals, subtotals, results and parents (default the `type.emphasis` weight). */
  weights?: { emphasis?: number; member?: number; measure?: number; subtotal?: number; result?: number; figures?: { member?: number; measure?: number; subtotal?: number; result?: number }; block?: number;
    /** @deprecated Retired: ignored, and warns `option-deprecated` with a fix that removes it. */
    change?: number };
  /**
   * Table text paints. Absent: the text ink for head, subLabel, label, child
   * and figure; `secondary` for qualifier, operator, driver and toggle.
   * `secondary` is the one ink that steps back behind a value (change lines,
   * unit affixes, notes, state glyphs, muted columns); absent, the muted ink.
   */
  inks?: { head?: string; subLabel?: string; label?: string; child?: string; figure?: string; qualifier?: string; operator?: string; driver?: string; toggle?: string; secondary?: string };
  /** The quiet table rule: row rules, the column-group rule and the column dividers. Absent: 25% of the ink in the background. */
  ruleInk?: string;
  /** Rule widths in px: `head` under the head block (default the hair stroke), `row` between body rows (default the hair stroke). */
  ruleWidths?: { head?: number; row?: number };
  resultRule?: 'ink' | 'rule' | 'none';
  finalRule?: 'double' | 'rule' | 'none';
  driver?: { italic?: boolean };
  /** Size delta from the label, and air after it, in px. Defaults -2 and 4. */
  qualifier?: { sizeDelta?: number; gap?: number };
  toggle?: { size?: number; gap?: number };
  operator?: { width?: number };
  /** How a judged cell prints its tone: 'ink' (default) colours the figure; 'fill' paints the cell ground and keeps the figure in the text ink. */
  tones?: 'ink' | 'fill';
  /** Grounds of a 'fill' tone. An absent key washes its tone toward the background; goodStrong is a judgment past its strong threshold. */
  grounds?: { good?: string; goodStrong?: string; warn?: string; bad?: string; subtotal?: string; total?: string };
  /** Grounds of a size bar (a cell's `bar`): `fill`, and `muted` in a muted column. Absent, the ink washed toward the background. */
  bar?: { fill?: string; muted?: string };
  /** The line under the column heads, and under a section heading whose `section.rule` is 'hair': 'rule' (default) in the rule ink, 'ink' in the text ink. */
  headRule?: 'rule' | 'ink';
  /** 'rule' draws the line above an open top-level parent, and above the row after its block, in the rule ink, on both surfaces; 'grid' (default) keeps the row rule. */
  blockRule?: 'grid' | 'rule';
  /**
   * The rule under the last body row. 'rule', like absent, draws it in the
   * rule ink; 'grid' draws it in the row-rule ink (`ruleInk`); 'none' draws none. A
   * table that ends on its total keeps the total's own rule under it.
   */
  closeRule?: 'rule' | 'grid' | 'none';
}

/** Air above and below a head row, in px. */
export interface ThemeTablePad {
  top?: number;
  bottom?: number;
}

/**
 * Preset names plus any theme registered at runtime via `registerTheme`
 * (the design-interface path: brand themes load as validated JSON).
 */
export type ThemeRef = string | { preset: string; overrides?: DeepPartial<Theme> };
