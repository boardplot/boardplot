import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Value withheld",
  "openPeriod": "Open period",
  "band": "Band",
  "state": "State",
  "rowMissing": "A row is missing",
  "low": "Low",
  "high": "High",
  "anchoredDateUnavailable": "Resolved anchored date is unavailable",
  "start": "Start",
  "end": "End",
  "description": "Description",
  "caption": "Caption",
  "recordSource": "Source",
  "recordTarget": "Target",
  "maturingHidden": "Maturing value not shown",
  "categoryState": "Category state",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Wert zurückgehalten",
  "openPeriod": "Offene Periode",
  "band": "Band",
  "state": "Zustand",
  "rowMissing": "Eine Zeile fehlt",
  "low": "Niedrig",
  "high": "Hoch",
  "anchoredDateUnavailable": "Aufgelöstes Ankerdatum nicht verfügbar",
  "start": "Start",
  "end": "Ende",
  "description": "Beschreibung",
  "caption": "Bildunterschrift",
  "recordSource": "Quelle",
  "recordTarget": "Ziel",
  "maturingHidden": "Noch nicht ausgereifter Wert nicht gezeigt",
  "categoryState": "Zustand der Kategorie",
};

export const { chartString } = chartStrings(EN, DE);
