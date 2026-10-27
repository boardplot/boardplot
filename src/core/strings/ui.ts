import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "refusalMessage": "This chart needs at least {width} × {height} px.",
  "loading": "Loading",
  "loadingFailed": "Loading failed",
  "emptyMessage": "No data to show.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "refusalMessage": "Dieses Diagramm braucht mindestens {width} × {height} px.",
  "loading": "Wird geladen",
  "loadingFailed": "Laden fehlgeschlagen",
  "emptyMessage": "Keine Daten zum Anzeigen.",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
