import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "ofAllClause": ", {v1} of all",
  "orderedBands": "{v1} ordered bands",
  "closedBands": "{v1} closed bands",
  "pyramidShareSubtitle": "% of the grand total",
  "pyramidShareGroupSubtitle": "% of each group",
  "pyramidShareSnapshotSubtitle": "% of each snapshot",
  "pyramidSharesDisclosure": " Values are shares of the grand total across both groups ({v1}), so the two sides do not each sum to 100%.",
  "pyramidBandsMethod": "Each band runs from its lower bound up to, but not including, its upper bound. The youngest band is at the bottom.",
  "equalBandsMethod": " All {v1} bands are{v2}.",
  "openBandsMethod": " {v1} bands are{v2}. '{v3}' is open-ended and not width-comparable.",
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
  "pyramidSharesDisclosure": " Werte sind Anteile der Gesamtsumme beider Gruppen ({v1}). Die Seiten ergeben jeweils nicht 100 %.",
  "pyramidBandsMethod": "Jede Klasse reicht von ihrer Untergrenze bis knapp unter ihre Obergrenze. Die jüngste Klasse steht unten.",
  "equalBandsMethod": " {v1|Die|Alle} {v1} {v1|Klasse|Klassen} {v1|ist|sind}{v2}.",
  "openBandsMethod": " {v1} {v1|Klasse|Klassen} {v1|ist|sind}{v2}. '{v3}' ist offen. Die Breite ist nicht vergleichbar.",
  "openBandRequired": "{v1} ist eine nach oben offene Klasse (ab {v2}).",
  "bandWidthClause": " mit Breite {v1}",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
