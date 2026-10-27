import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "accountMedian": "Account median",
  "medianPopulation": "Median population",
  "medianWindow": "Median window",
  "spendToDate": "Spend to date",
  "fatigueRule": "Authored fatigue rule",
  "dailyMeanChange": "Change of unweighted daily means",
  "baselineObservations": "Baseline observations",
  "currentObservations": "Current observations",
  "dailyMetric": "Daily {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "accountMedian": "Kontomedian",
  "medianPopulation": "Grundgesamtheit des Medians",
  "medianWindow": "Zeitraum des Medians",
  "spendToDate": "Ausgaben bis heute",
  "fatigueRule": "Angegebene Ermüdungsregel",
  "dailyMeanChange": "Änderung der ungewichteten Tagesmittel",
  "baselineObservations": "Beobachtungen im Basiszeitraum",
  "currentObservations": "Beobachtungen im aktuellen Zeitraum",
  "dailyMetric": "Täglich {v1}",
};

export const { chartString } = chartStrings(EN, DE);
