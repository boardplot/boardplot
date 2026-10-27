import { formatExactNumber } from './format';
import type { BaseOptions } from './types/options';

/** Built-in chart wording. Unsupported languages use English. */
const EN = {
  "storyBack": "‹ Back",
  "storyNext": "Next ›",
  "storyCounter": "{step} / {count}",
  "storyStep": "Step {step} of {count}",
  "partial": "Partial",
  "others": "Others",
  "total": "Total",
  "source": "Source",
  "notApplicable": "n/a",
  "average": "Average",
  "toDate": "to date",
  "forecast": "FC",
  "plan": "PL",
  "forecastHeader": "FC",
  "net": "Net",
  "incomplete": "(partial)",
  "range": "Range, low to high",
  "valuesNotOnColumns": "Values not printed on the columns",
  "valuesNotBesideMarks": "Values not printed beside their marks",
  "partialTotals": "Totals marked {partial} add the known parts only",
  "knownPartsTotals": "Totals add the known parts only",
  "without": "without",
  "and": "and",
  "aboveZero": "{series} above 0 ({meaning})",
  "belowZero": "{series} below 0 ({meaning})",
  "declaredBounds": "Declared bounds",
  "tied": "Tied",
  "tiedSymbol": "○",
  "currentValue": "Current value {value}",
  "baseCase": "Base case {value}",
  "swingOutsideBase": "Swing does not contain the base case",
  "fanGap": "Interval not declared at {categories}: the band is drawn only where both bounds were supplied. The gap does not mean that the interval closed.",
  "mixedShares": "{categories}: n.m., the parts mix positive and negative values, so they are no shares of a whole.",
  "better": "better",
  "worse": "worse",
  "positiveTotal": "Positive total",
  "rangeMidNote": "Tick inside a range marks its mid-point as supplied.",
  "sensitivityNote": "One-at-a-time sensitivity: each driver is varied alone with every other driver held at its base input. The swings do not sum to a total and interaction effects are not shown.",
  "hatchedBaseNote": "Hatched bars do not contain the base case: at base inputs the model does not reproduce the stated base.",
  "missingSwingNote": "Not shown, not measurable (a swing needs both case outputs): {drivers}.",
  "rankOmitted": "Ranked but not drawn (rank in {period}, of {count}): {entries}.",
  "noRank": "no rank",
  "rankMethod": "Rank derived from the plotted measure by standard competition ranking ({direction}), rank 1 at the top. Tied entities share a rank and the next rank is skipped. Values are compared as printed{format}, so equal printed values share a rank.{ring}",
  "higherBetter": "higher is better",
  "lowerBetter": "lower is better",
  "rankFormat": " (format '{format}')",
  "rankRing": " A ring marks a rank held by more than one entity.",
  "nearZeroNote": "{count} series end near {value} and carry no end label.",
  "flagged": "Flagged ({count} of {total})",
  "corridor": "Corridor (|modified z| ≤ {value})",
  "corridorBounds": "Corridor (authored bounds)",
  "median": "Median {value}",
  "anomalySmallSample": "Not flagged: {count} of the {minimum} periods a modified-z rule needs",
  "anomalyZeroMad": "Not flagged: MAD is 0 over {count} periods, so |modified z| has no denominator (no mean ± σ substitute is applied)",
  "anomalyMadRule": "Flagged: |modified z| > {k} ({centre} — {k} × {factor} × MAD {mad} = {low} to {high}, n = {count})",
  "anomalyCentreZero": "centre 0, spread from median {median}",
  "anomalyCentreMedian": "centre = median {median}",
  "anomalyThresholdRule": "Flagged: {bounds} (authored bounds, n = {count})",
  "outsideBounds": "outside {low} to {high}",
  "belowBound": "below {value}",
  "aboveBound": "above {value}",
  "lowerBound": "the lower bound {value}",
  "upperBound": "the upper bound {value}",
  "undrawnBounds": " Not drawn: {bounds} — outside the plotted range.",
  "hiddenLabels": "Not labelled on the chart",
  "noteOne": "+{count} note",
  "noteMany": "+{count} notes",
  "notesAndSources": "Notes and sources",
  "close": "Close",
  "mapCredit": "Map",
  "gapBetween": "Gap between {first} and {second}",
  "aboveSeries": "{first} above {second}",
  "belowSeries": "{first} below {second}",
  "moreListed": "and {count} more",
  "countedValues": "{count} of {total} values",
  "countedItems": "{count} items",
  "nearZeroChange": "n.m.: not meaningful, the base is near zero.",
  "mixedCoverage": "n.m.: not meaningful, the compared totals cover different rows.",
  "hiddenPeriods": "{periods} not shown at this width.",
  "share": "Share",
  "histogramBins": "{count} bins of {about}{width} from {from} to {to}, lower edge included",
  "histogramAbout": "about ",
  "histogramMethod": "{count} bins of {width} from {from} ({rule}{rounding}); each bin includes its lower bound, the last one both{smallSample}.",
  "histogramRuleCount": "authored bin count",
  "histogramRuleWidth": "authored bin width",
  "histogramSnapped": "{rule}, snapped to a round width",
  "histogramRounded": "; width and first edge shown rounded",
  "histogramSmallSample": "; at this n the bin count is largely an artifact of the rule",
  // shared reader-facing chart and accessibility wording.
  "target": "target",
  "cellNote": "One cell = {value}",
  "axisLow": "Lower",
  "axisHigh": "Higher",
  "newItems": "New items",
  "lostItems": "Lost items",

  // stack disclosures and rebase suppression (keep this block at the end).
  ...{
    missingStack: "Missing values at {categories}: 0 used; totals partial.",
    incompleteStacks: "{categories}: incomplete stacks; missing parts are not drawn.",
    knownPartsShares: "{categories}: shares of known parts only.",
    rebaseZero: "{series} not shown: zero base at {period}.",
    rebaseMissing: "{series} not shown: missing base at {period}.",
  }
} as const satisfies Record<string, string>;
const DE: { [K in keyof typeof EN]: string } = {
  "storyBack": "‹ Zurück",
  "storyNext": "Weiter ›",
  "storyCounter": "{step} / {count}",
  "storyStep": "Schritt {step} von {count}",
  "partial": "Unvollständig",
  "others": "Andere",
  "total": "Summe",
  "source": "Quelle",
  "notApplicable": "k. A.",
  "average": "Ø",
  "toDate": "bis heute",
  "forecast": "FC",
  "plan": "PL",
  "forecastHeader": "FC",
  "net": "Netto",
  "incomplete": "(unvollst.)",
  "range": "Spanne, niedrig bis hoch",
  "valuesNotOnColumns": "Werte ohne Beschriftung auf den Säulen",
  "valuesNotBesideMarks": "Werte ohne Beschriftung an den Datenpunkten",
  "partialTotals": "Summen mit {partial} addieren nur die bekannten Teile",
  "knownPartsTotals": "Summen addieren nur die bekannten Teile",
  "without": "ohne",
  "and": "und",
  "aboveZero": "{series} über 0 ({meaning})",
  "belowZero": "{series} unter 0 ({meaning})",
  "declaredBounds": "Angegebene Grenzen",
  "tied": "Gleichstand",
  "tiedSymbol": "○",
  "currentValue": "Aktueller Wert {value}",
  "baseCase": "Basisfall {value}",
  "swingOutsideBase": "Spanne enthält den Basisfall nicht",
  "fanGap": "Intervall bei {categories} nicht angegeben: Das Band wird nur mit beiden Grenzen gezeichnet. Die Lücke bedeutet nicht, dass sich das Intervall geschlossen hat.",
  "mixedShares": "{categories}: n.m., die Teile enthalten positive und negative Werte. Sie sind keine Anteile eines Ganzen.",
  "better": "besser",
  "worse": "schlechter",
  "positiveTotal": "Positive Summe",
  "rangeMidNote": "Der Strich in einer Spanne zeigt den angegebenen Mittelwert.",
  "sensitivityNote": "Sensitivität: Jeder Treiber wird einzeln geändert. Die anderen Treiber behalten ihre Basiswerte. Die Spannen ergeben keine Gesamtsumme. Wechselwirkungen werden nicht gezeigt.",
  "hatchedBaseNote": "Schraffierte Balken enthalten den Basisfall nicht: Mit den Basiswerten ergibt das Modell nicht den angegebenen Basisfall.",
  "missingSwingNote": "Nicht gezeigt, nicht messbar (eine Spanne braucht beide Ergebnisse): {drivers}.",
  "rankOmitted": "Bewertet, aber nicht gezeichnet (Rang in {period}, von {count}): {entries}.",
  "noRank": "kein Rang",
  "rankMethod": "Rang aus den gezeichneten Werten ({direction}), Rang 1 oben. Gleiche Werte teilen einen Rang. Der nächste Rang wird übersprungen. Verglichen werden die gedruckten Werte{format}.{ring}",
  "higherBetter": "höher ist besser",
  "lowerBetter": "niedriger ist besser",
  "rankFormat": " (Format '{format}')",
  "rankRing": " Ein Ring zeigt einen geteilten Rang.",
  "nearZeroNote": "{count} Reihen enden nahe {value} und haben keine Endbeschriftung.",
  "flagged": "Markiert ({count} von {total})",
  "corridor": "Korridor (|modifiziertes z| ≤ {value})",
  "corridorBounds": "Korridor (angegebene Grenzen)",
  "median": "Median {value}",
  "anomalySmallSample": "Nicht markiert: {count} von {minimum} Perioden, die die Regel braucht",
  "anomalyZeroMad": "Nicht markiert: MAD ist über {count} Perioden 0. |modifiziertes z| hat keinen Nenner. Mittelwert ± σ wird nicht als Ersatz verwendet.",
  "anomalyMadRule": "Markiert: |modifiziertes z| > {k} ({centre} — {k} × {factor} × MAD {mad} = {low} bis {high}, n = {count})",
  "anomalyCentreZero": "Mitte 0, Streuung aus Median {median}",
  "anomalyCentreMedian": "Mitte = Median {median}",
  "anomalyThresholdRule": "Markiert: {bounds} (angegebene Grenzen, n = {count})",
  "outsideBounds": "außerhalb von {low} bis {high}",
  "belowBound": "unter {value}",
  "aboveBound": "über {value}",
  "lowerBound": "die untere Grenze {value}",
  "upperBound": "die obere Grenze {value}",
  "undrawnBounds": " Nicht gezeichnet: {bounds} — außerhalb des gezeichneten Bereichs.",
  "hiddenLabels": "Ohne Beschriftung im Diagramm",
  "noteOne": "+{count} Hinweis",
  "noteMany": "+{count} Hinweise",
  "notesAndSources": "Hinweise und Quellen",
  "close": "Schließen",
  "mapCredit": "Karte",
  "gapBetween": "Abstand zwischen {first} und {second}",
  "aboveSeries": "{first} über {second}",
  "belowSeries": "{first} unter {second}",
  "moreListed": "und {count} weitere",
  "countedValues": "{count} von {total} Werten",
  "countedItems": "{count} Einträge",
  "nearZeroChange": "n.m.: nicht aussagekräftig, die Basis liegt nahe null.",
  "mixedCoverage": "n.m.: nicht aussagekräftig, die verglichenen Summen umfassen verschiedene Zeilen.",
  "hiddenPeriods": "{periods} bei dieser Breite nicht gezeigt.",
  "share": "Anteil",
  "histogramBins": "{count} Klassen mit Breite {about}{width} von {from} bis {to}, untere Grenze eingeschlossen",
  "histogramAbout": "etwa ",
  "histogramMethod": "{count} Klassen mit Breite {width} ab {from} ({rule}{rounding}); jede Klasse enthält ihre untere Grenze, die letzte beide Grenzen{smallSample}.",
  "histogramRuleCount": "angegebene Klassenzahl",
  "histogramRuleWidth": "angegebene Klassenbreite",
  "histogramSnapped": "{rule}, auf eine runde Breite gesetzt",
  "histogramRounded": "; Breite und erste Grenze gerundet",
  "histogramSmallSample": "; bei diesem n hängt die Klassenzahl stark von der Regel ab",
  // shared reader-facing chart and accessibility wording.
  "target": "Ziel",
  "cellNote": "Eine Zelle = {value}",
  "axisLow": "Niedriger",
  "axisHigh": "Höher",
  "newItems": "Neue Artikel",
  "lostItems": "Verlorene Artikel",

  // stack disclosures and rebase suppression (keep this block at the end).
  ...{
    missingStack: "Fehlende Werte bei {categories}: als 0 gezeichnet; Summen unvollständig.",
    incompleteStacks: "{categories}: unvollständige Stapel; fehlende Teile nicht gezeichnet.",
    knownPartsShares: "{categories}: Anteile nur der bekannten Teile.",
    rebaseZero: "{series} nicht gezeigt: Basis ist 0 bei {period}.",
    rebaseMissing: "{series} nicht gezeigt: Basis fehlt bei {period}.",
  }
};

export function localeStrings(language?: string): typeof DE {
  return /^de(?:[-_]|$)/i.test(language ?? '') ? DE : EN;
}

/** Set once the locale table is merged in; holds the caller's own words. */
const LOCALE_STRINGS = Symbol('localeStrings');

type Authored = { [LOCALE_STRINGS]?: Record<string, string> };

/** Caller wording wins per key. Authored labels never enter this table. The caller's own keys stay under a symbol for `chartWording`. */
export function withLocaleStrings<O extends Pick<BaseOptions, 'locale' | 'strings'>>(options: O): O {
  if ((options as O & Authored)[LOCALE_STRINGS]) return options;
  const custom = Object.fromEntries(Object.entries(options.strings ?? {}).filter(([, value]) => value !== undefined)) as Record<string, string>;
  return { ...options, [LOCALE_STRINGS]: custom, strings: { ...localeStrings(options.locale?.language), ...custom } };
}

/**
 * A chart's own default wording for shared keys (such as the treemap's hidden-label lead): it
 * replaces the locale fill, and the caller's own words still win. Runs after withLocaleStrings.
 */
export function withChartDefaultStrings<O extends Pick<BaseOptions, 'strings'>>(options: O, defaults: Record<string, string>): O {
  const custom = (options as O & Authored)[LOCALE_STRINGS] ?? {};
  const fill = Object.fromEntries(Object.entries(defaults).filter(([key]) => custom[key] === undefined));
  return Object.keys(fill).length === 0 ? options : { ...options, strings: { ...options.strings, ...fill } };
}

/** A sentence that ends with an abbreviation's period ("1,3 Mio.") takes no second one. */
export function singleStops(text: string): string {
  return text.replace(/(\p{L}\.)\.(?=\s|$)/gu, '$1');
}

/** Sentences joined with ". ", one period after an abbreviation. */
export function joinSentences(parts: readonly string[]): string {
  return singleStops(parts.join('. '));
}

/** Substitute named fields without treating caller text as a regular expression. */
export function stringFields(template: string, fields: Record<string, string | number>, language?: string): string {
  // A value that ends with an abbreviation's period ("1,3 Mio.") ends the sentence with it: "1,3 Mio.", not "1,3 Mio..".
  return template.replace(/\{([^{}]+)\}(\.?)/g, (match, field: string, stop: string) => {
    const text = fieldText(match.slice(0, match.length - stop.length), field, fields, language);
    return stop && text.endsWith('.') ? text : text + stop;
  });
}

function fieldText(match: string, field: string, fields: Record<string, string | number>, language?: string): string {
  if (!field.includes('|')) {
    const value = fields[field];
    return typeof value === 'number' ? formatExactNumber(value, language) : String(value ?? match);
  }
  const [key, one, many] = field.split('|');
  const value = fields[key!];
  // Count-aware wording: {count|singular|plural}. Keep the raw count for this choice.
  if (one !== undefined && many !== undefined && value !== undefined) return value === 1 || value === '1' ? one : many;
  return typeof value === 'number' ? formatExactNumber(value, language) : String(value ?? match);
}

/** The caller's own words, without the locale fill: what a grid hands its panels, so each panel fills its own locale. */
export function authoredStrings(options: Pick<BaseOptions, 'strings'>): Record<string, string | undefined> | undefined {
  return (options as Authored)[LOCALE_STRINGS] ?? options.strings as Record<string, string | undefined> | undefined;
}

/**
 * A chart whose own English wording is more exact than the table's (pareto "Outside top five" for
 * `others`): the caller's word wins, then that wording in English, then the locale table.
 * The registry fills every key, so `strings.others ?? 'Outside top five'` would never reach the chart's word.
 */
export function chartWording(options: Pick<BaseOptions, 'locale' | 'strings'>, key: keyof typeof EN, english: string): string {
  const authored = authoredStrings(options);
  const locale = localeStrings(options.locale?.language);
  return authored?.[key] ?? (locale === EN ? english : locale[key]);
}

type StringOptions = { locale?: BaseOptions['locale'] | string; strings?: BaseOptions['strings'] } | undefined;
type StringFields = Record<string, string | number | undefined>;

/** Built-in wording at its source; caller strings win before field substitution. */
export function chartString(options: StringOptions, key: keyof typeof EN, fields?: StringFields): string {
  return fillChartString(options, key, fields, localeStrings(languageOf(options)));
}

function languageOf(options: StringOptions): string | undefined {
  return typeof options?.locale === 'string' ? options.locale.replace(/_/g, '-') : options?.locale?.language;
}

function fillChartString(options: StringOptions, key: string, fields: StringFields | undefined, words: Record<string, string>): string {
  const template = (options?.strings as Record<string, string | undefined> | undefined)?.[key] ?? words[key]!;
  if (fields === undefined || !template.includes('{')) return template;
  const language = languageOf(options);
  const localized = Object.fromEntries(Object.entries(fields).map(([name, value]) =>
    [name, typeof value === 'number' ? value : String(value)]));
  return stringFields(template, localized, language);
}

/** Keep type wording out of unrelated React entries. */
export function chartStrings<const E extends Record<string, string>>(en: E, de: { [K in keyof E]: string }) {
  type Words = { [K in keyof typeof EN | keyof E]: string };
  let english: Words | undefined;
  let german: Words | undefined;
  const words = (language?: string): Words => /^de(?:[-_]|$)/i.test(language ?? '')
    ? german ??= { ...DE, ...de }
    : english ??= { ...EN, ...en };
  return {
    localeStrings: words,
    chartString: (options: StringOptions, key: keyof typeof EN | keyof E, fields?: StringFields): string =>
      fillChartString(options, String(key), fields, words(languageOf(options))),
  };
}
