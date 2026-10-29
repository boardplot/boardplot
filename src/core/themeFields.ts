/**
 * One description per theme field, keyed by theme JSON path ('color.good'),
 * and the field rows `boardplot describe theme` prints from `THEME_SHAPE`.
 *
 * A field that shares its description with its siblings (type roles, scale
 * columns, table faces) is keyed with the wildcard spelled out, e.g.
 * 'type.<role>.size'; its shape node names that key in `doc`.
 */

import type { SchemaFieldReference } from './schema/reference';
import { THEME_SHAPE, type ShapeNode } from './themeShape';

/** The closed set of theme paths that carry a description. */
const THEME_FIELD_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  // ── identity ───────────────────────────────────────────────────────────────
  name: 'Theme name. Must be unique among registered themes; it is the value of the `theme` option.',
  scheme:
    'Fixed color scheme of the family: a `light` theme stays light on a dark host and a `dark` theme stays dark. Absent means light-slot behavior with the standard automatic dark pair.',

  // ── color ──────────────────────────────────────────────────────────────────
  color: 'Paint vocabulary. Every chart color comes from here; chart code never introduces a hex literal.',
  'color.good':
    'Business judgment "good" (variance up, target met). Not decoration: keep it distinct from `bad` under the shipped colorblind check.',
  'color.bad': 'Business judgment "bad" (variance down, target missed).',
  'color.goodFill':
    'The "good" fill of a large signed mark: a sign-coloured column, a variance bar or cap, a line gap fill, a heatmap cell over 12 x 12 px, a map region or tile, a table heat cell or row wash, a status cell, a zone or phase wash, a diagram node, and a bar, column, slice or cell whose colorRole is good. Absent means color.good. Text, ticks, strokes, pins and small squares keep color.good, and colorblindSafe takes color.colorblind.goodFill. Set it when color.good is a light accent that glows as a full fill, typically on a dark ground.',
  'color.badFill':
    'The "bad" fill of a large signed mark, as color.goodFill, of a negative mekko bar and of a likert disagree segment. Absent means color.bad. The pair is held to the good-bad-similar floor once either is set.',
  'color.markInk':
    "The ink a chart draws a data mark in, apart from the text ink: a line's emphasis: 'first' hero line and a themed area's line, the context line ladder under a highlight and a line band's contrast repair, the combo lead line under marks.comboLine: 'ink', the dot inside the latest-point ring, the standalone sparkline, the steps of a stepped table heat lane, a bar's range rail and caps, column range whiskers, the bar and column net line, the dot range mid, a mekko ridge, the pareto cumulative line, a bump ring, a difference target marker, a gantt bracket and the bullet measure bar (its bands lighten toward the page until they clear 3:1 against it, where their 12-point step allows). Absent means color.ink. Axes, value lines, reference ticks and lines, brackets between bars, connectors, annotation arrows, slice outlines and the plan outline keep color.ink. Held to the mark floor on the background, 3:1 as a line (mark-ink-invisible).",
  'color.heatTop':
    'The top band of a stepped table heat lane (surface.heatSteps). Absent means color.markInk, then color.ink. A dark theme whose full ink glares as a cell sets a quieter band here, and color.heatTopInk for its figures. In dark it also caps how far centered-funnel stage shading brightens; a stage colour already at or above it fades toward the background instead.',
  'color.heatTopInk': "The figures on a stepped heat lane's top band. Absent means color.inkInverse. Once either role is set, the pair is held to 3:1 (contrast-inside-label).",
  'color.onFillInk':
    "The dark fallback ink for text on a fill where neither color.ink nor color.inkInverse reaches 4.5:1, a mid-tone heat band or chip. Absent means '#050505'. With color.onFillLightInk it must stand 20.25:1 apart, so one of the two reaches 4.5:1 on every fill; a pair that cannot is warned as ink-on-fill, with the fill relative-luminance band where neither reaches it.",
  'color.onFillLightInk':
    "The light fallback ink for text on such a fill, paired with color.onFillInk. Absent means '#FFFFFF'.",
  'color.rest':
    "The bars and columns that step back when options.highlight selects a category on a single-series chart. Absent means color.neutralLight. Under marks.contrastEdge: true a pale rest fill takes a separation outline, which marks.restOutline: false drops.",
  'color.neutral':
    'Neutral fill for actuals (AC). Carries structure, never judgment, so it stays grey-family in every shipped preset.',
  'color.neutralMark':
    "The marks that paint in the neutral: a butterfly's and a pyramid's first side, variance and waterfall bars in the neutral tone, a sign-coloured column at zero, a dumbbell's first dots, a bar's reference marker, a slope's lines, a box's points and whiskers, a column spark's columns, a likert midpoint, a neutral status cell, the cohort average row, the heatmap's lowest step and Harvey rings, a map glyph whose tone is neutral, a series whose colorRole is 'neutral', and the scenario and partial-period legend keys. Absent means color.neutral. Held to the series floor on the background (series-invisible). A theme whose neutral is a band or surface tint sets a mark-strength grey here; bands, zebras, washes and no-data grounds keep color.neutral.",
  'color.neutralLight': 'Lighter neutral for prior year (PY) and low-emphasis structure.',
  'color.highlight':
    'The single accent, with one meaning: the focus the author asked for. It paints what options.highlight selects, an annotation or callout, a colorRole \'highlight\', and the larger marks listed under color.focus, unless color.focus is set. It also keeps a few point accents: the latest-point ring, a highlight reference tick, the last point or column of a spark, and map glyphs. Without an authored focus no chart paints it on a lead mark: series 1 leads. One accent per theme.',
  'color.focus':
    "What options.highlight selects: the highlighted bar, column, dot, slice, box, step, point or line, and the swatch beside its label. It also takes every mark larger than a point that would fall back to color.highlight: a line, area, bar, column, slice, cell, gantt item or scatter and dot group whose colorRole is 'highlight' (one other plain series then recedes to the neutral mark, and plain lines and slopes step back to their grey ladder), a diagram node, lane or badge whose role is 'accent', the in-cell bar, the gantt elapsed wash, and status cells, zones and phases whose tone is highlight or info. It also washes a kpi area spark, whose last point keeps color.highlight. Without an authored focus the lead mark takes series 1: the combo lead line takes the rank after the columns, a pareto's vital few take series 1 and the rest recede, a butterfly's or pyramid's second side, a dumbbell's second dots, a single-series funnel and a tornado's high case without casePair take series 1, linear-process step badges take the neutral mark, and the pie, heatmap ladder, ramp and Harvey fills, and the cohort, choropleth, tilemap and table heat ramps are tints of series 1. Absent means color.highlight. Set it apart when the accent is kept for a single mark, such as the latest-point ring or a reference tick, and the selected marks should take another colour, often the ink. A line's emphasis: 'first' hero takes the ink either way.",
  'color.spark':
    "The line of a kpi card's spark, a table sparkline cell and a creative trend, and the line over an area spark. Absent means color.neutralMark, then color.neutral. color.neutral is a fill, and a pale one draws a faint line: point the spark at the ink then. A column spark's columns take color.neutralMark, the last point keeps color.highlight, and the standalone sparkline type draws its line in the ink.",
  'color.total': 'Color for total and subtotal marks. Defaults to the accent in the shipped presets.',
  'color.others': 'Ground fill: gantt shades and row tints, value bands, annotation fills, diagram fills and the default of color.othersMark.',
  'color.othersMark': 'Fill of an Others mark: the topN Others bucket and a series or slice whose colorRole is others. Absent means color.others. Every preset sets it 1.4:1 or more against its page. Under marks.contrastEdge: true a pale Others fill takes a separation outline, which marks.othersOutline: false drops.',
  'color.ink': 'Primary text and axis ink on the theme background.',
  'color.inkInverse': 'Text ink for labels painted on a solid dark fill.',
  'color.inkMuted': 'Secondary ink for source lines, tick labels, and footnotes.',
  'color.inkMeta':
    "Tertiary ink: a table's state glyphs (missing, n/a, n.m.), a cell with heat: false, and a section heading whose table.section.ink is 'inkMeta'. Absent means color.inkMuted. Held to 3:1 on the background like inkMuted.",
  'color.axis': 'Axis line and tick ink.',
  'color.grid': 'Grid line ink. Quiet by design; it must not compete with data.',
  'color.leader': 'Leader line ink for labels placed away from their mark.',
  'color.rule':
    "A table's structural rule: the head underline, the rules above and under a total row, and the rule that closes the body, on the SVG and in the grid. Absent means color.axis. Set it when the axis ink is a quiet grey and the house rule is firmer; row, section and group rules keep color.grid.",
  'color.reference':
    'The rails of a slope chart, the two verticals the values are read against. Absent means color.axis. Held to 3:1 on the background once set (contrast-reference).',
  'color.background': 'Chart canvas background. Tint stages mix toward this color, so it must be a real surface color.',
  'color.series': 'Categorical ramp, index 0 first. A preset override with one or two colours fills the remaining slots from the preset, skipping colours already authored. A complete theme needs at least one entry; series past the end of the ramp follow color.seriesOverflow. Index 0 also bases the sequential ramps (tints of series 1).',
  'color.seriesOverflow':
    "What a series index beyond the ramp does: 'repeatLast' reuses the last entry, 'cycle' restarts the ramp. Default 'repeatLast'.",
  'color.casePair': 'Tornado low/high fills. Absent resolves to neutralLight/series 1.',
  'color.stack': 'Fills of the plain series of a stacked or 100% column or bar, strongest on the page first and the quietest last (2 or more). More series than steps share the ramp evenly between its ends; authored fills, colour roles, palettes and highlights win. Absent keeps the series order.',
  'color.palettes':
    'Named alternative categorical ramps so one report keeps disjoint color vocabularies per dimension. Charts opt in through options.palette.',
  'color.status':
    'Domain status colors keyed by the documented status enumeration (advanced, open, lost, pending, won, gantt-*).',
  'color.colorblind': 'Alternative good/bad pair that a colorblind viewer can still tell apart; the colorblind check compares it against good/bad.',
  'color.colorblind.good': 'Judgment "good" as it reads to a colorblind viewer; used by the colorblind comparison check. A diverging slope draws its better line and dots in it always.',
  'color.colorblind.bad': 'Judgment "bad" as it reads to a colorblind viewer.',
  'color.colorblind.goodFill': 'The colorblind "good" of a large signed fill under colorblindSafe: a status cell, a sign-coloured column, a variance bar or cap. A likert paints its agree side and a diverging slope its better side in it always, so the two sides stay apart for a red-green colour-blind reader. Absent means color.colorblind.good. Set it when colorblind.good is a text colour, such as the ink, that glares as a full fill.',
  'color.colorblind.badFill': 'The colorblind "bad" of a large signed fill under colorblindSafe. Absent means color.colorblind.bad.',
  'color.warn': 'At-risk judgment between good and bad (dark amber by default). Absent warnColor() supplies the shipped amber. Text, strokes, glyphs and chips print in it; large marks take color.warnFill.',
  'color.warnFill': 'The "warn" fill of a large mark: a status cell, a bar, column, segment, slice, chevron or gantt bar whose colorRole or tone is warn, a zone, phase or row wash, a diagram node. Absent means color.warn. Set it when color.warn is a dark amber chosen to read as text, which reads as olive as a full fill. Held to ink-on-fill and to the status-tone swatch floor against the good and bad fills.',

  // ── scenario ───────────────────────────────────────────────────────────────
  scenario: 'Scenario notation. Fixed by the standard, except the plan look a theme may set in scenario.PL.',
  'scenario.AC': "Actual fill notation. Fixed to 'solid'.",
  'scenario.PY': "Prior-year fill notation. Fixed to 'solidLight'.",
  'scenario.PL': "Plan fill notation. 'outline' is the notation look: the plan bar drawn in the background colour with an outline in its series colour. 'solidMuted' draws it solid in color.inkMuted at 35 % over the background, with no outline. A plan stack that keeps its series colours keeps its outline either way. A plan line defaults to a solid stroke in color.ink at pattern.outlineStrokeWidth; authored scenario styling wins.",
  'scenario.FC': "Forecast fill notation. Fixed to 'hatch45'.",

  // ── pattern ────────────────────────────────────────────────────────────────
  pattern: 'Hatch and outline geometry for scenario notation.',
  'pattern.hatchAngle': "Hatch line angle in degrees. Fixed to 45 by the notation rule.",
  'pattern.hatchGap': 'Distance between hatch lines in px. Lower values read denser and start to moiré in print.',
  'pattern.hatchStrokeWidth': 'Hatch line stroke width in px.',
  'pattern.outlineStrokeWidth': 'Outline stroke width in px for PL/FC notation and outlined marks.',
  'pattern.hatchColor':
    "Ink source for hatch lines: 'segment' keeps the series color, 'ink' switches to color.ink. Absent means 'segment'.",

  // ── stroke and dash ────────────────────────────────────────────────────────
  stroke: 'Line weights in px by role. Every absent key takes the default value.',
  'stroke.seam': 'The page-colour seam between touching segments of a stack. Absent means 0.5.',
  'stroke.hair': 'Gridlines, table row rules, separators between fills and borders. Absent means 0.75.',
  'stroke.rule': 'Axes, zero lines, dividers, leaders, connectors and reference lines. Absent means 1.',
  'stroke.mark': 'Outlines, hollow markers, targets and rings. Absent means 1.5.',
  'stroke.data': 'Data lines. Absent means 2.',
  'stroke.focus': 'The data line of an authored focus. Absent means 2.5.',
  'stroke.casing': 'The halo drawn under a data line where it crosses other marks. Absent means 5.',
  dash: 'Dash patterns as SVG dash arrays by role. Every absent key takes the default value.',
  'dash.reference': 'Every dashed line: reference, target, forecast and guide lines. Absent means [4, 3].',
  'dash.dotted': 'Every dotted line. Absent means [1, 3].',

  // ── type ───────────────────────────────────────────────────────────────────
  type: 'Typography: the font stack every role inherits plus one type step per role.',
  'type.family': 'CSS font stack for every type role. The label solver measures with this stack, so keep it to the calibrated class.',
  'type.<role>': 'One typographic role. Sizes step per width class through type.scale.',
  'type.<role>.family': 'CSS font stack for this role alone, in the type.family grammar. Absent falls back to type.family.',
  'type.<role>.size': 'Font size in px at the middle width class (720 to 1079 px); type.scale carries the small and large steps. Set in theme overrides, it holds in every class unless the overrides also set its step.',
  'type.<role>.weight': 'Font weight (100 to 1000) for this role.',
  'type.<role>.lineHeight': 'Unitless line height multiplier for this role.',
  'type.micro':
    'In-plot abbreviation role for geographic and matrix labels only. Absent derives it from footnote minus 1 px, floored at 9 px.',
  'type.secondary':
    'Secondary text: tick labels, axis titles, scenario markers (AC | FC) and the labels of series a highlight leaves in the background. Absent means the axis role.',
  'type.scale': 'Width-class size columns: type.<role>.size is the middle class, S and L carry the other two.',
  'type.scale.<column>': 'One width-class column of role sizes, keyed by role name.',
  'type.scale.<column>.<role>': 'Font size in px for this role at this width class.',
  'type.numeric':
    "Figures on numeric text (value labels, axis ticks, table numbers, KPI values): 'tabular' aligns digits in columns, 'proportional' uses the font's natural widths. Absent means 'tabular'. Titles, names, notes and source lines never set figures, and neither does a label the engine composed out of a name and a number, such as a funnel step caption or a pie slice label.",
  'type.figure':
    'The big value of a KPI card. Set its family and weight here. The preferred size is max(heroMinimum, round(title x 1.5)) in target units. type.scale does not step it. Absent means type.family at the emphasis weight (700 by default).',
  'type.figure.family':
    'CSS font stack for the KPI value alone, in the type.family grammar. Absent falls back to type.family. Measured from the width tables when one of its names is tabled, else by the character-class model.',
  'type.figure.weight': 'Font weight (100 to 1000) of the KPI value. Absent means the emphasis weight (700 by default).',
  'type.eyebrow':
    "The eyebrow of a KPI card, the label over the figure when the card has no title. Each absent key keeps today's eyebrow: the label role at 13 px or more, as authored, in color.inkMuted. type.scale does not step it.",
  'type.eyebrow.size': 'Font size in px of the KPI eyebrow (6 to 24). Absent keeps the label role at 13 px or more.',
  'type.eyebrow.weight': 'Font weight (100 to 1000) of the KPI eyebrow. Absent keeps the label weight.',
  'type.eyebrow.lineHeight': 'Line height of the KPI eyebrow as a ratio of its size (1 to 2). Absent keeps the label line height.',
  'type.eyebrow.tracking': 'Letter-spacing of the KPI eyebrow in em of its size (0 to 0.3), e.g. 0.14. Absent means none.',
  'type.emphasis': 'The emphasis weight: a total, a hero figure or an authored focus is set in this weight at its role size.',
  'type.emphasis.weight': 'Font weight (100 to 1000) of emphasised text. Absent means 700.',
  'type.eyebrow.ink': "Ink of the KPI eyebrow: 'inkMuted' or 'inkMeta'. Absent means inkMuted.",

  // ── space ──────────────────────────────────────────────────────────────────
  space: 'Spacing tokens shared by every layout.',
  'space.tierGap': 'Vertical gap in px between stacked tiers.',
  'space.facetGap': 'Gap in px between facets of a small-multiple layout.',
  'space.labelPad': 'Padding in px between a mark and its label.',
  'space.canvas': 'Canvas margin tokens by width class: `base` covers the small and middle widths, `wide` covers 1080 px and up.',
  'space.canvas.base': 'Canvas margins for the small and middle width classes, in px.',
  'space.canvas.wide': 'Canvas margins at canvas widths of 1080 px and up, in px.',
  'space.canvas.<class>.<side>': 'One canvas margin side in px (top, right, bottom, left).',
  'space.gap': 'Named vertical gaps of the fixed frame order; the `*Wide` variants apply at canvas widths of 1080 px and up.',
  'space.gap.titleSubtitle': 'Gap in px between title and subtitle.',
  'space.gap.subtitlePlot': 'Gap in px between subtitle and plot area below 1080 px canvas width.',
  'space.gap.subtitlePlotWide': 'Gap in px between subtitle and plot area at canvas widths of 1080 px and up.',
  'space.gap.axisFootnote': 'Gap in px between the axis band and the footnote below 1080 px canvas width.',
  'space.gap.axisFootnoteWide': 'Gap in px between the axis band and the footnote at canvas widths of 1080 px and up.',
  'space.gap.footnoteSource': 'Gap in px between footnote and source line.',
  'space.gap.legend': 'Gap in px between plot area and legend band.',
  'space.legendRowH': 'Row height in px of the horizontal legend band.',
  'space.barRow':
    "A fixed bar row: bar thickness and row pitch in px, such as 12 and 24. Absent, bar rows share whatever height the canvas gives them. Set, every bar and likert row is pitch px tall, or as tall as its label if that is taller, and a canvas taller than the chart never stretches the rows: the chart lays out at its natural height, draws at the top and leaves the rest of the canvas empty, as a content-fit chart sits at the top of its box. A host that wants the air elsewhere lays the chart out at its natural height (fit: 'content') and places it. An authored options.bandFraction still sets the bar's share of the row.",
  'space.barRow.thickness': 'Bar (or bar group) thickness in px. A thickness above the pitch draws the bar at the full row.',
  'space.barRow.pitch': 'Distance in px from one row to the next.',

  // ── legend, interaction, motion ────────────────────────────────────────────
  legend: 'Legend behavior switches.',
  'legend.auto': 'Automatic legend keys for series without visible names. Absent or false keeps the shipped defaults.',
  'legend.required':
    "Where a key the chart cannot drop goes when the spec hides or leaves the legend: the value key of a tilemap or choropleth. 'top' puts it in one row above the plot, 'bottom' under it. Absent keeps 'top'; a position the spec names wins.",
  marks: 'Default mark anatomy. Absent keeps the engine defaults; an authored series marker, fill or colorRole, or a node shape.radius, still wins.',
  'marks.lineMarkers':
    "Default point markers on line series. 'auto' (the default) draws a circle per point up to 12 categories on a line chart and on every combo line; 'none' draws none. A partial period keeps its hollow marker and a bump chart its identity shapes; the latest-point ring is not a marker and stays.",
  'marks.areaTint':
    "A single unstacked area (variant 'area', one series, no authored fill, colorRole, palette or PY/PL scenario): the tint amount of color.focus toward the background, 0 to 1 (0.86 = 14 % focus), under a stroke.data line in color.ink. The forecast region keeps its hatch in the full focus. Absent fills the area in its series colour under a 2 px line.",
  'marks.nodeRadius':
    'Corner radius in px of a diagram node drawn as a rounded rectangle, and of a group frame (0 to 16). Absent uses surface.chipRadius for nodes and group frames; 0 draws square corners. A node shape.radius wins.',
  'marks.nodeStroke':
    "The colour role of a diagram node's ring: axis, grid, leader, ink or inkMuted. Absent keeps axis, and grid on a muted node.",
  'marks.nodeStrokeWidth': 'Width in px of a diagram node ring and a group frame (0 to 3). Absent uses stroke.hair.',
  'marks.restOutline':
    'false draws the marks that recede under a highlight (color.rest) without the separation outline marks.contrastEdge: true adds to a fill too close to the background. Absent means true.',
  'marks.areaFromOrigin':
    "true places the first and last category of an area chart (line variants area, stacked-area, stacked100-area) on the plot edges, so the bands start at the value axis; an authored categoryAxis.crossesBetween wins. Absent keeps the categories centred in their bands.",
  'marks.barLabels':
    "'outside' places a bar chart's value label past the bar end, or drops it (a label-hidden lint) where no room is left there; never inside the bar or in a backed box. On grouped bars that cross zero, a negative value reads right of the zero line, where the positive values start, so the negative side holds only its bars; with no value axis drawn, the domain is the extent plus the label room rather than a rounded one. Absent keeps the cascade: inside the end where it fits, else outside, else inside on a backing.",
  'marks.comboColumnTint':
    'A combo\'s column series with no authored fill, colorRole or palette fill their actual columns in color.focus at this tint amount toward the background, 0 to 1 (0.74 = 26 % focus). Stacked series take a ramp of it: the top series the tint, the ones below stepping down the stacked-area ramp, capped at the full focus (26 / 45 / 70 / 100 % from the top at 0.74). The scenario look wins: a plan outline and a forecast hatch draw in the full focus, and a prior year keeps its scenario colour. A washed column takes no separation outline in any scheme: the tint is the theme\'s choice. Absent keeps the series colour.',
  'marks.comboLine':
    "'ink' draws a combo's lead line, when it has no authored fill, colorRole, highlight or palette, in color.ink at 1.5 px with the latest-point ring in color.highlight on its last observed point, never on a forecast one; its page-colour casing is a half-pixel hairline each side, not a second stroke. Absent keeps the focus at 2 px on a 1.5 px casing.",
  'marks.sparkEnd':
    "The last point of a kpi card's spark, a table spark and a creative trend: 'ring' draws the standalone sparkline's ring, the background with a 1.5 px ring in color.highlight at radius 3.2. Absent keeps 'dot', a filled point in the highlight.",
  'marks.sparkEndLabel':
    "false draws a kpi card's spark without the value label at its last point, which repeats the card's own figure; the line then runs the full width. A table spark keeps its label, since its row carries no figure. Absent means true.",
  'marks.sliceOutline':
    'false draws a pie or doughnut slice whose fill is too close to the background with the page-colour separator only, without the separation outline marks.contrastEdge: true adds. Absent means true.',
  'marks.othersOutline':
    "false draws an Others mark (the topN Others bucket of a bar, column, pie or butterfly chart, and a series or slice whose colorRole is 'others' in a stacked column, bar or area, a mekko, a combo or a funnel) whose fill is too close to the background without the separation outline marks.contrastEdge: true adds. Absent means true. Waffle rest cells use a floor-clearing fill instead and ignore it.",
  'marks.contrastEdge':
    'true draws the contrast edges round fills (WCAG 1.4.11). On a light page a fill under 3:1 against the page that no value label carries takes an edge in a deeper shade of its own hue, and a pale stack-ramp step a neutral hair outline. On a light or dark page a fill under the page floor (1.4:1 light, 3:1 dark: an Others, rest, pale slice or pale segment mark, and its key swatch) takes a separation outline; marks.restOutline, marks.othersOutline and marks.sliceOutline then apply. It also lets the palest pie tint and a faded series go past 1.4:1 against the page, as the outline then carries them. Absent means false: no fill on a light or dark page draws a contrast edge or outline. Segment seams, hollow, hatched and dashed marks, and a mark that crosses another fill are unchanged either way.',
  'marks.nodeFill':
    "'panel' draws every diagram node of the primary, secondary or muted role on the background with its ring (marks.nodeStroke), so the accent node is the one filled node. Signed, warn and category nodes keep their fills. Absent keeps 'role': primary in the first series colour, secondary and muted in color.neutralLight.",
  'marks.kpiCaret':
    'false draws a kpi card\'s delta and comparisons without the leading caret; the signed figure and its tone carry the direction ("+10.4% vs PY"). Absent means true.',
  'marks.bridge':
    "How a waterfall (vertical or horizontal) and a pvm bridge paint their steps. 'sign' draws the totals in color.total (ink when a theme leaves it unset), a rising step in color.goodFill and a falling one in color.badFill, the connectors dotted at 1 px in color.inkMeta, and each step's signed value beside its bar in color.good or color.bad (inside a bar it keeps the contrast ink). A step split into authored segments keeps its segment colours and key; a highlight still selects a total, while a step's colour stays its sign. 'neutral' draws the steps in color.neutral, totals in color.total, dashed color.leader connectors. Absent, the steps take their sign's fill (the waterfall's signColor) on dashed leader connectors, unless the spec names a palette.",
  'marks.funnelFill':
    "How a funnel (rows or centered) fills its bars. 'ramp': a single series takes color.series by stage, stage 1 the first colour; an outcome split takes it by series; the lost share, a series whose colorRole is 'status-lost' or 'bad', is color.badFill at 45 % over the background. Status colours never reach the bars, so a status map that borrows a text colour cannot fill a stage. An authored series fill wins. Absent means 'status': a colorRole resolves through the theme and a single series takes color.focus.",
  labels: 'Label conventions. Absent keeps the shipped placement.',
  'labels.endLabelPlacement': "Default for the line option endLabelPlacement: 'gutter' puts every end label right of the plot, 'lineEnd' puts the label of a series that ends early beside its last point.",
  valueAxis: 'Value-axis conventions. Each switch is off when absent; an explicit chart option wins.',
  'valueAxis.titles': "A drawn value axis without an authored title takes 'Measure, unit' from subtitle.measure and the axis unit (line, column, bar, pareto), where the drawn subtitle does not already print that unit.",
  'valueAxis.includeZero': 'Default for valueAxis.includeZero on line charts, so their value axis starts at zero.',
  'valueAxis.dualAxis': 'A combo with an acknowledged secondary axis draws the dual-axis anatomy; the combo option dualAxis wins.',
  'valueAxis.gridDash': "The gridlines of a value axis: 'solid' (default), 'dotted' (dash.dotted) or 'dashed' (dash.reference).",
  'labels.ink': "Ink of the value and category labels on the page: 'ink' (default) or 'muted', the grey inkMuted. A highlighted mark's labels keep the full ink; labels inside a fill keep their contrast ink.",
  interaction: 'Optional host interaction paint tokens. They change paint only; chart geometry is unaffected.',
  'interaction.dim': 'Opacity applied to marks outside the active interaction set (0 to 1); default 0.25.',
  'interaction.outlineWidth': 'Focus and selection outline width in CSS pixels; default 1.',
  motion: 'Optional host interaction timings in milliseconds. They change transitions only; chart geometry is unaffected.',
  'motion.easing': "Easing of the shared interaction transitions: 'linear', 'ease-out', or a cubic-bezier() curve of four numeric control points; default 'ease-out'.",
  'motion.hoverIntent': 'Delay before a hover interaction activates, in milliseconds; default 80.',
  'motion.fade': 'Duration of opacity transitions, in milliseconds; default 120.',
  'motion.travel': 'Duration of positional transitions, in milliseconds; default 160.',
  'motion.layout': 'Duration of layout transitions — rows opening, columns appearing, a table growing — in milliseconds; default 160.',
  surface: 'Surface anatomy for chips, row tints, and schedule washes.',
  'surface.chipTint': 'How far a chip background steps toward the surface (0.05 to 0.97).',
  'surface.rowTint': 'Opacity of the zebra row tint (0.85 to 0.98).',
  'surface.elapsedTint': 'Opacity of the elapsed-era wash in schedule charts (0.85 to 0.99).',
  'surface.anchorTint': 'Opacity of the structural wash on level-0 parent rows (0.85 to 0.99).',
  'surface.heatSteps': 'Band alphas of a stepped table heat lane, lightest first, over the background (0 to 1). Five bands need four entries: the band above the last one is the full ink with inverse text. Default 0.06 / 0.14 / 0.26 / 0.42.',
  'surface.bandTint': 'Weight of color.neutral over color.background for the group-band ground (0 to 1); default 0.06, the zebra weight. The total row takes twice it, capped at 1. A theme whose neutral IS the band colour, a sand over a white canvas, sets 0.5: the band then draws at half the neutral and the total at the whole of it. At 1 both grounds are the full neutral and the total no longer reads as the heavier of the two.',
  'surface.gapTint': "How far a line chart's gapFill wash steps toward the background (0.5 to 0.95); default 0.82 on a light page and 0.65 on a dark one.",
  'surface.ribbonAlpha': "Opacity of a column ribbon (options.ribbons) over the page (0.15 to 0.6); default 0.35. The column segments keep the full series paint, and a crossing darkens where two ribbons overlap.",
  'surface.ribbonSheetAlpha': "Opacity of a fixed-order ribbon (options.ribbons.order 'sheet') over the page (0.05 to 0.6); default 0.18, lighter than a ranked ribbon, so a dark segment's band does not compete with the columns.",
  'surface.chipRadius': 'Chip corner radius in px (0 to 6).',
  'surface.sparkWash': "Whether a spark whose data asks for kind 'area' (a kpi card's spark) draws the wash under its line. false draws it as its line and last point alone, the look of a line spark. Absent means true. Column sparks keep their columns.",
  'surface.panelShadow': 'CSS box-shadow of the notes popover a React chart opens, in the documented grammar (`0 1px 2px rgba(...)` style). Absent draws no shadow.',

  // ── table ──────────────────────────────────────────────────────────────────
  table: 'Table conventions. Every key is optional; an absent key keeps the engine default. Sizes written here are absolute: type.scale and the table densities never step them.',
  'table.inks': 'Table text colours. Each role accepts a CSS colour.',
  'table.inks.head': 'Column-head and group-heading ink of the table family (table, dimswitch, cohort, bar table, status, heatmap), on the SVG and in the React grid. A group note takes table.inks.secondary. A highlighted head keeps its own ink. Default color.ink.',
  'table.inks.subLabel': 'Header second-line ink. Default color.ink.',
  'table.inks.label': 'Row label ink. Default color.ink.',
  'table.inks.child': 'Detail and split label ink. Default color.ink.',
  'table.inks.figure': 'Value figure ink. Default color.ink.',
  'table.inks.qualifier': 'Unit affix ink. Default table.inks.secondary.',
  'table.inks.operator': 'Statement operator ink. Default table.inks.secondary.',
  'table.inks.driver': 'Driver label, figure and change ink. A good, warn or bad figure of a driver that options.driverTones allows (grouped by default: a driver under a line) keeps its tone, and a neutral figure and the label keep this ink. Default table.inks.secondary.',
  'table.inks.toggle': 'Fold toggle ink: the +/- mark, and the box under mark boxed. Default table.inks.secondary.',
  'table.inks.secondary': 'The one table ink that steps back behind a value: change lines, unit affixes, group notes, cell notes and hints, state glyphs, zero figures, muted columns and the fold toggle. On the SVG and in the grid. Boardroom #305B86, standard-dark #9EC3E2; absent, color.inkMuted.',
  'table.ruleInk': 'The quiet table rule, on the SVG and in the grid: row rules, the column-group rule and the column dividers. Boardroom #C3D3E3, standard-dark #344B60; absent, 25% of color.ink mixed into the background.',
  'table.weights.emphasis': 'Weight of totals, subtotals, results and parent rows, on labels and figures (100 to 1000). Default 600 in every shipped preset; absent in a custom theme, the type.emphasis weight.',
  'table.weights.subtotal': 'Subtotal label weight. Default table.weights.emphasis.',
  'table.weights.result': 'Result label weight. Default table.weights.emphasis.',
  'table.weights.figures': 'Figure weights per presentation kind.',
  'table.weights.figures.member': 'Member figure weight. Default 400 on a leaf and table.weights.emphasis on a parent.',
  'table.weights.figures.measure': 'Measure figure weight. Default 400 on a leaf and table.weights.emphasis on a parent.',
  'table.weights.figures.subtotal': 'Subtotal figure weight. Default table.weights.emphasis.',
  'table.weights.figures.result': 'Result figure weight. Default table.weights.emphasis.',
  'table.weights.block': 'Strong block-column figure weight. Default table.weights.emphasis.',
  'table.ruleWidths': 'Table rule widths in px.',
  'table.ruleWidths.head': 'Head rule width in px. Default 1.',
  'table.ruleWidths.row': 'Row rule width in px, in table.ruleInk. Default 1 in every preset; absent in a custom theme, the hair stroke (0.75).',
  'table.resultRule': 'Rule above a result: ink (default), rule or none.',
  'table.finalRule': 'Rule under a final result: double (default), rule or none. Double is two 1 px lines with 1 px air.',
  'table.driver': 'Driver row face.',
  'table.driver.italic': 'Italic driver labels, figures and changes. Default true. Width measurement uses upright metrics.',
  'table.qualifier': 'Unit affix size and gap.',
  'table.qualifier.sizeDelta': 'Size change from the label in px. Default -2.',
  'table.qualifier.gap': 'Gap after the label in px. Default 4.',
  'table.section.case': 'Section heading case: upper (default) or asis.',
  'table.toggle': 'Fold toggle dimensions.',
  'table.toggle.size': 'Box size in px. Default 11.',
  'table.toggle.gap': 'Offset before the label in px. Default 17.',
  'table.operator': 'Statement operator slot.',
  'table.operator.width': 'Slot width in px. Default 14. Present only when a drawn row has a glyph.',
  'table.grounds.subtotal': 'Subtotal row ground. Default none; transparent means no fill.',
  'table.grounds.total': 'Total row ground. Every preset sets transparent: no fill, the total rule and weight mark the total. Absent in a custom theme, twice the band tint.',
  'table.head': 'Column head face, on the SVG and in the grid. Absent keys fall back to the axis size (stepped by density and width class), weight 400, line height 1.33 and 0.5 px tracking. Column-group heads keep their size one step under the head and take its line height.',
  'table.section': 'Section row face, on the SVG and in the grid. Absent keys give the column-head size, the emphasis weight, line height 1.33 and tracking 0.14 em.',
  'table.section.rule': "The line under a section heading, across the full table width, on the SVG and in the grid: 'heavy' (default) twice the rule stroke in the text ink; 'hair' the row rule (table.ruleInk at table.ruleWidths.row), or the text ink under table.headRule 'ink'.",
  'table.section.spaceBefore': 'Air in px above the label of a section row that follows other rows, inside the row, on the SVG and in the grid, so a new block reads at once. Default one body line box; 0 for none. A section that is the first row under the head takes a quarter line box, never more than this value. The label sits at the bottom of its row.',
  'table.<face>.size': 'Font size in px at every density and width class.',
  'table.<face>.weight': 'Font weight (100 to 1000).',
  'table.<face>.lineHeight': 'Line height as a ratio of the size. Both surfaces reserve a whole-pixel line box, ceil(size x ratio): 10.5 x 1.33 gives 14.',
  'table.<face>.tracking': 'Letter-spacing in em of the size (0 to 0.3).',
  'table.head.case': "'upper' sets the column heads in capitals, on the SVG and in the grid; 'asis' prints each label as authored (\"Apr 25\", \"L10W avg\"), and the tracks measure that text. Absent means 'upper'. Column-group headings and section rows keep their capitals.",
  'table.section.ink': "Text colour of a section heading: 'ink', 'inkMuted' or 'inkMeta'. Absent means 'ink'; every preset sets 'ink'.",
  'table.fixedType':
    "True makes a density change row height and cell padding only: compact heads, body and total keep their size, and the label of a cohort grid's closing row keeps the total face while the matrix cells keep their own step. Absent or false steps compact type 0.5 px down as before.",
  'table.noPrevious':
    "What a change against the previous column prints where its group has no previous column, such as the first month's month-on-month: 'na' (default) prints n/a, 'missing' prints the missing glyph under the row's missing and the table's nulls policy.",
  'table.groupGround': "Which group rows carry the group ground when options.groupGround is absent. 'expanded': only the header row of an open group. 'always': folded or open, as before 0.28. 'none': none. Every preset sets 'none'; absent in a custom theme, 'expanded'. The Total keeps its own ground (table.grounds.total).",
  'table.ofWhich':
    "'muted' (default) draws ofWhich rows in the muted ink. 'ink' draws their labels and values in the text colour: the relation stays arithmetic only, and a muted column or an inline share line stays muted.",
  'table.headPad': 'Vertical air of the column-head cells, on the SVG and in the grid. Every preset sets 10 above and 8 to the head rule. Absent means no air above the head on the SVG and 7 px to the head rule, the row air in the grid. A pinned height that misses only on head and group air takes the least air first.',
  'table.groupPad': 'Vertical air of the column-group heading row, on the SVG and in the grid: above the heading and under its hairline. Every preset sets 8 above and 4 under. Absent means 6 above and 2 under on the SVG.',
  'table.<pad>.top': 'Air above the text in px (0 to 24).',
  'table.<pad>.bottom': 'Air below the text in px (0 to 24): to the head rule, or under the group hairline.',
  'table.mark': 'Outline mark: bare or boxed. Every preset sets bare; absent in a custom theme, steering tables draw boxed.',
  'table.rows': 'Body rows on one face, on the SVG and in the grid: every rung prints at the label size with this line height and air, so a deep row is as tall as a top one. The ladder then steps weight and indent only. Absent keeps the level ladder.',
  'table.rows.pad': 'Air above and below a body row\'s line box in px (0 to 16).',
  'table.weights': 'Label and figure weights by row kind, plus block-column figures and change lines. Absent keys keep the current face.',
  'table.weights.member': 'Label weight of a member row, such as a channel (100 to 1000). Default 400 on a leaf and table.weights.emphasis on a parent.',
  'table.weights.measure': 'Label weight of a measure row, such as a KPI (100 to 1000). Default 400 on a leaf and table.weights.emphasis on a parent.',
  'table.tones':
    "How a judged cell prints its tone. 'ink' (default) colours the figure; 'fill' paints the cell ground in table.grounds and keeps the figure in the text ink, so colour sits only where performance is judged.",
  'table.grounds': "Grounds a 'fill' tone paints. An absent key washes its tone toward the background.",
  'table.grounds.good': 'Ground of a good judgment. Transparent means no fill.',
  'table.grounds.goodStrong': 'Ground of a good judgment past its strong threshold (a cell with strong: true). Transparent means no fill.',
  'table.grounds.warn': 'Ground of a watch judgment. Transparent means no fill.',
  'table.grounds.bad': 'Ground of a bad judgment. Transparent means no fill.',
  'table.bar': 'Grounds of a size bar, the bar a cell with bar draws from its left edge.',
  'table.bar.fill': 'Ground of a size bar. Boardroom #D6E3F0, standard-dark #22384D; absent, the ink washed far toward the background. Transparent means no fill.',
  'table.bar.muted': 'Ground of a size bar in a muted column, such as a partial period. Absent, a paler wash. Transparent means no fill.',
  'table.headRule': "The line under the column heads, and under a section heading whose table.section.rule is 'hair': 'rule' (default) in the rule ink, 'ink' in the text ink.",
  'table.blockRule':
    "'rule' draws a 1 px line above an open top-level parent, and above the first top-level row after its block, in the rule ink, on the SVG and in the grid, so an open block reads as one. Column dividers keep table.ruleInk. 'grid' keeps the row rule there. Every preset sets 'rule'; absent in a custom theme, 'grid'.",
  'table.endRule':
    "The vertical hairline that closes the rows on the right, on the SVG and in the grid. 'auto' draws it on every table but a cohort grid, after the last column under rowExtent 'tracks' and at the frame edge under 'frame'; 'none' draws it on neither surface, for a host card whose own edge closes the rows. Absent means 'auto'.",
  'table.closeRule':
    "The rule under the last body row, on the SVG and in the grid. 'rule' draws it in the rule ink, 'grid' in the row-rule ink (table.ruleInk), 'none' draws none. Absent means 'rule'. A table that ends on its total keeps the total's own rule under it, and the total's other rules stay.",
  'table.dataGap': "What a value the data lacks prints, such as a month not yet reported: 'word' the n/a word ('k. A.' in German), 'glyph' the missing glyph. Absent means 'glyph' where table.glyphs.missing is set (every preset sets it), else 'word'. A cohort grid and nulls: 'blank' keep their own mark.",
  'table.glyphs': 'State glyphs a table prints: missing, na, nm and suppressed. Absent keys keep the engine glyphs.',
  'table.glyphs.missing': "Glyph of a missing value. Default the em dash; the variance chart's missing mark (default the en dash) prints it too when set.",
  'table.glyphs.na': "Glyph of a not-applicable value. Default 'n/a'.",
  'table.glyphs.nm': "Glyph of a not-meaningful value. Default 'n.m.'.",
  'table.glyphs.suppressed': 'Glyph of a withheld value, before the footnote marker the engine always appends. Default the em dash.',
});

/** Throws when a path has no description, so a new field cannot ship undescribed. */
function describeThemeField(path: string): string {
  const description = THEME_FIELD_DESCRIPTIONS[path];
  if (description === undefined) {
    throw new Error(`no theme field description registered for '${path}'`);
  }
  return description;
}

/** The `describe theme` rows: one per object key in `THEME_SHAPE`, with the value in `defaults` as its default. */
export function themeFieldReference(defaults: unknown): SchemaFieldReference[] {
  const rows: SchemaFieldReference[] = [];
  const visit = (node: ShapeNode, path: string[], value: unknown): void => {
    if (node.kind !== 'object') return;
    const values = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
    for (const [key, child] of Object.entries(node.props)) {
      const parts = [...path, key];
      const own = values[key];
      const type = child.kind === 'enum' ? typeof child.values[0] : child.kind === 'record' ? 'object' : child.kind === 'tuple' ? 'array' : child.kind;
      rows.push({
        path: parts.join('.'), type, required: !child.opt, description: describeThemeField(child.doc ?? parts.join('.')),
        ...(child.kind === 'enum' ? { values: [...child.values], valuesExhaustive: true } : {}),
        ...(own !== undefined ? { default: own } : {}),
      });
      visit(child, parts, own);
    }
  };
  visit(THEME_SHAPE, [], defaults);
  return rows;
}
