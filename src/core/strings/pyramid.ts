import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "ofAllClause": ", {v1} of all",
  "orderedBands": "{v1} ordered bands",
  "closedBands": "{v1} closed bands",
  "pyramidShareSubtitle": "% of the grand total",
  "pyramidShareGroupSubtitle": "% of each group",
  "pyramidShareSnapshotSubtitle": "% of each snapshot",
  "openBandRequired": "{v1} is an open-ended band ({v2} and over).",
  "bandWidthClause": " {v1}-wide",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "ofAllClause": ", {v1} von allen",
  "orderedBands": "{v1} {v1|geordnete Klasse|geordnete Klassen}",
  "closedBands": "{v1} {v1|geschlossene Klasse|geschlossene Klassen}",
  "pyramidShareSubtitle": "% der Gesamtsumme",
  "pyramidShareGroupSubtitle": "% je Gruppe",
  "pyramidShareSnapshotSubtitle": "% je Stichtag",
  "openBandRequired": "{v1} ist eine nach oben offene Klasse (ab {v2}).",
  "bandWidthClause": " mit Breite {v1}",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
