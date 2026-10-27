import * as z from 'zod';
import { baseOptionsSchema, sizeSchema, readerStringsSchema } from './shared';

/** The hover prop of every chart component and of BoardplotChart. */
export const hoverSchema = z.union([
  z.boolean().describe('true shows the label card and the series highlight on pointer hover; false or omitted draws the static chart.'),
  z.strictObject({
    card: z.union([
      z.literal(false).describe('false draws no card.'),
      z.literal('label').describe('The label card: the hovered record\'s own facts.'),
      z.literal('sparkline').describe('Table only: the row drawn across its column group, the hovered point ringed, with the cell\'s change lines beside its value.'),
    ]).optional().describe('Label card with the hovered record\'s own facts, placed beside the mark by the label solver and always inside the chart\'s own frame. Default \'label\'. On a table, \'sparkline\' draws the row across its column group instead and no card where the group holds fewer than three numbers.'),
    highlight: z.boolean().optional().describe('Dim the other series and outline the hovered marks; on a table, wash the row of the hovered cell instead. Default true.'),
  }).describe('Turn the card or the highlight off separately.'),
]).describe('Pointer hover: a label card and a highlight of the hovered series. Nothing else is interactive. The server render is the static chart.');

/** Host sizing is separate from the fixed dimensions accepted by core and CLI. */
export const reactSizingOptionsSchema = z.object({
  size: z.union([
    sizeSchema,
    z.literal('container').describe('Observe the parent size after hydration; use fallbackSize for server and initial client output.'),
  ]).optional().describe('Explicit frame or container. Container observes the parent after React attaches.'),
  fit: z.enum(['fill', 'content']).optional().describe('Container fit. Default uses the registered sizing policy; content lays out the box width with the height left to the chart and prints the static footer, as `boardplot render` at that width draws it.'),
  fallbackSize: sizeSchema.optional().describe('Server and initial client frame for container sizing. Default 720 by 405.'),
}).strict().describe('React-only container sizing options. Explicit sizes ignore fit and fallbackSize.');

// The provider strings fields worded as the chart strings fields are the same schema.
const sharedStrings = baseOptionsSchema.shape.strings.unwrap();

/** Serializable provider settings. React children are outside this contract. */
export const boardplotThemeOptionsSchema = z.object({
  target: baseOptionsSchema.shape.target,
  textScale: baseOptionsSchema.shape.textScale.describe('Inherited text scale: one factor on every text of every chart under the provider, 0.5 to 2.5. A chart option textScale or textSize wins.'),
  textSize: baseOptionsSchema.shape.textSize.describe('Inherited primary label size in px, equal on every chart under the provider. A chart option wins.'),
  diagnostics: z.enum(['auto', 'full', 'reader']).optional().describe('Default auto: full unless NODE_ENV is production, else reader. Reader cards keep diagnostics in console and data attributes. Full adds a collapsed Details disclosure.'),
  direction: z.enum(['ltr', 'rtl']).optional().describe('Reading direction of HTML controls and cards; default ltr. Chart geometry, axes and data order are unchanged.'),
  theme: baseOptionsSchema.shape.theme.describe('Inherited chart theme. Direct chart props take precedence.'),
  locale: z.union([
    z.string().describe('Inherited language tag shorthand, expanded to the locale language field.'),
    baseOptionsSchema.shape.locale,
  ]).optional().describe('Inherited locale. Locale support follows each chart formatter.'),
  motion: z.enum(['system', 'reduce', 'full']).optional().describe('Motion preference. Default system; charts remain static unless motion is enabled.'),
  density: z.enum(['comfortable', 'compact']).optional().describe('Inherited density. Default comfortable preserves existing spacing. Compact scales pad and row-pitch tokens (labelPad, canvas margins, frame gaps, legendRowH) and maps to compact table density when the table has no explicit density.'),
  strings: z.object({
    ...readerStringsSchema.shape,
    others: z.string().optional().describe('Host wording for the Others aggregate.'),
    total: z.string().optional().describe('Host wording for a computed total.'),
    source: z.string().optional().describe('Host wording for source furniture.'),
    ...sharedStrings.pick({ notApplicable: true }).shape,
    legendCount: z.string().optional().describe('Host wording for a legend count; use {count} for the number.'),
    partial: z.string().optional().describe('Host wording after the labels of partial categories in their footnote, also the hatch key label.'),
    ...sharedStrings.pick({
      better: true, worse: true, positiveTotal: true, rangeMidNote: true, sensitivityNote: true,
      hatchedBaseNote: true, missingSwingNote: true, rankOmitted: true, noRank: true, rankMethod: true,
      higherBetter: true, lowerBetter: true, rankFormat: true, rankRing: true, nearZeroNote: true, flagged: true,
      corridor: true, corridorBounds: true, median: true, anomalySmallSample: true, anomalyZeroMad: true,
      anomalyMadRule: true, anomalyCentreZero: true, anomalyCentreMedian: true, anomalyThresholdRule: true,
      outsideBounds: true, belowBound: true, aboveBound: true, lowerBound: true, upperBound: true,
      undrawnBounds: true, hiddenLabels: true, noteOne: true, noteMany: true, notesAndSources: true, close: true,
      mapCredit: true, gapBetween: true, aboveSeries: true, belowSeries: true,
    }).shape,
    average: z.string().optional().describe("Name before a computed mean; English Average, German Ø."),
    toDate: z.string().optional().describe("Text after a running category name in its key or note."),
    forecast: z.string().optional().describe("Key for the forecast pattern."),
    plan: z.string().optional().describe("Key for the plan outline."),
    forecastHeader: z.string().optional().describe("Header at the actual-to-forecast boundary. Keeps the scenario code by default."),
    net: z.string().optional().describe("Name before a net total."),
    incomplete: z.string().optional().describe("Marker on an incomplete stack total; prints under notes.show 'disclosure'."),
    range: z.string().optional().describe("Key for a range whisker."),
    valuesNotOnColumns: z.string().optional().describe("Note heading for omitted column values."),
    valuesNotBesideMarks: z.string().optional().describe("Note heading for omitted combo values."),
    partialTotals: z.string().optional().describe("Incomplete total note; {partial} is the marker."),
    knownPartsTotals: z.string().optional().describe("Incomplete total note where the marker does not print. Column and combo only; a bar stack uses incompleteStacks."),
    without: z.string().optional().describe("Word before missing stack parts."),
    and: z.string().optional().describe("Word joining missing stack parts."),
    aboveZero: z.string().optional().describe("Positive sign key; {series} and {meaning} are replaced."),
    belowZero: z.string().optional().describe("Negative sign key; {series} and {meaning} are replaced."),
    declaredBounds: z.string().optional().describe("Key for an authored uncertainty bound."),
    tied: z.string().optional().describe("Label of a shared rank."),
    tiedSymbol: z.string().optional().describe("Symbol before a displaced shared-rank label."),
    currentValue: z.string().optional().describe("Football-field spine; {value} is replaced."),
    baseCase: z.string().optional().describe("Tornado spine; {value} is replaced."),
    swingOutsideBase: z.string().optional().describe("Tornado hatch key."),
    fanGap: z.string().optional().describe("Missing uncertainty note; {categories} is replaced."),
    mixedShares: z.string().optional().describe("Mixed-sign share note; {categories} is replaced."),
    storyBack: z.string().optional().describe('Host wording for the story back button.'),
    storyNext: z.string().optional().describe('Host wording for the story next button.'),
    storyCounter: z.string().optional().describe('Host wording for the story counter; default {step} / {count}, without zero padding.'),
    storyStep: z.string().min(1).optional().describe('Host wording for the story live region position; {step} and {count} print without padding. Defaults to Step {step} of {count} (EN), Schritt {step} von {count} (DE).'),
    axisLow: z.string().optional().describe('Host wording for the low end of a scatter qualitative axis.'),
    axisHigh: z.string().optional().describe('Host wording for the high end of a scatter qualitative axis.'),
    ...sharedStrings.pick({ nearZeroChange: true, mixedCoverage: true, hiddenPeriods: true }).shape,
    // use the same wording path for caller and provider overrides.
    missingStack: baseOptionsSchema.shape.strings.unwrap().shape.missingStack,
    incompleteStacks: baseOptionsSchema.shape.strings.unwrap().shape.incompleteStacks,
    knownPartsShares: baseOptionsSchema.shape.strings.unwrap().shape.knownPartsShares,
    rebaseZero: baseOptionsSchema.shape.strings.unwrap().shape.rebaseZero,
    rebaseMissing: baseOptionsSchema.shape.strings.unwrap().shape.rebaseMissing,
    loading: z.string().optional().describe('Visible wording of the busy state; default Loading.'),
  }).strict().optional().describe('Inherited built-in wording. Authored labels remain unchanged.'),
}).strict().describe('Settings inherited through the BoardplotTheme React provider.');
