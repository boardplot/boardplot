import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "columnTitle": "Column chart: {v1} by {v2} categories",
  "referenceSeriesCount": "{v1} reference series",
  "stacked100": "100% stacked",
  "rangesClause": " Ranges: {v1}.",
  "namedRange": "{v1} {v2} to {v3}",
  "columnDescStart": "{v1} column chart, {v2} categories × {v3} series",
  "referenceSeriesClause": " plus {v1} reference series",
  "totalsSentence": ". Totals: {v1}.",
  "growthVersus": " Growth versus {v1}: {v2}.",
  "anomalyDesc": " Anomaly rule — {v1}.{v2} ",
  "noFlaggedPeriod": "No period is flagged.",
  "flaggedSentence": "Flagged: {v1}.",
  "clustered": "clustered",
  "stackedLower": "stacked",
  "anomalyRuleDesc": " Anomaly rule — {v1}.{v2}",
  "noFlaggedPeriodClause": " No period flagged.",
  "flaggedClause": " Flagged: {v1}.",
  "priorYearKey": "PY",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "columnTitle": "Säulendiagramm: {v1} nach {v2} {v2|Kategorie|Kategorien}",
  "referenceSeriesCount": "{v1} {v1|Referenzreihe|Referenzreihen}",
  "stacked100": "100 % gestapeltes",
  "rangesClause": " Spannen: {v1}.",
  "namedRange": "{v1} {v2} bis {v3}",
  "columnDescStart": "{v1} Säulendiagramm, {v2} {v2|Kategorie|Kategorien} × {v3} {v3|Reihe|Reihen}",
  "referenceSeriesClause": " plus {v1} {v1|Referenzreihe|Referenzreihen}",
  "totalsSentence": ". Summen: {v1}.",
  "growthVersus": " Wachstum vs {v1}: {v2}.",
  "anomalyDesc": " Anomalieregel — {v1}.{v2} ",
  "noFlaggedPeriod": "Keine Periode markiert.",
  "flaggedSentence": "Markiert: {v1}.",
  "clustered": "gruppiertes",
  "stackedLower": "gestapeltes",
  "anomalyRuleDesc": " Anomalieregel — {v1}.{v2}",
  "noFlaggedPeriodClause": " Keine Periode markiert.",
  "flaggedClause": " Markiert: {v1}.",
  "priorYearKey": "PY",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
