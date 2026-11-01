import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "ofAllClause": ", {v1} of all",
  "pyramidDesc": "Population pyramid: {v1} (left) and {v2} (right) across {v3} ordered bands, ",
  "youngestBottom": "youngest at the bottom. ",
  "bandsWidth": "All bands are {v1} wide.",
  "openBandDesc": "{v1} closed bands{v2} plus the open-ended '{v3}', whose row is not width-comparable.",
  "pyramidTotals": " {v1} totals {v2}{v3}, {v4} totals {v5}{v6}, grand total {v7}{v8}. ",
  "pyramidShares": "Bars are shares of that grand total across both groups, so the two sides do not each sum to 100%. ",
  "pyramidCounts": "Bars are counts{v1}. ",
  "inUnitClause": " in {v1}",
  "pyramidTitle": "Population pyramid: {v1} vs {v2}",
  "orderedBands": "{v1} ordered bands",
  "closedBands": "{v1} closed bands",
  "pyramidShareSubtitle": "% of the grand total",
  "pyramidShareGroupSubtitle": "% of each group",
  "pyramidShareSnapshotSubtitle": "% of each snapshot",
  "pyramidSharesOfGroup": "Bars are shares of their own group total, so each side sums to 100%. ",
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
  "pyramidDesc": "Bevölkerungspyramide: {v1} (links) und {v2} (rechts) über {v3} {v3|geordnete Klasse|geordnete Klassen}, ",
  "youngestBottom": "jüngste Klasse unten. ",
  "bandsWidth": "Alle Klassen sind {v1} breit.",
  "openBandDesc": "{v1} {v1|geschlossene Klasse|geschlossene Klassen}{v2} plus die offene Klasse '{v3}'. Ihre Breite ist nicht vergleichbar.",
  "pyramidTotals": " {v1} ergibt {v2}{v3}, {v4} ergibt {v5}{v6}, Gesamtsumme {v7}{v8}. ",
  "pyramidShares": "Balken zeigen Anteile an der Gesamtsumme beider Gruppen. Die Seiten ergeben jeweils nicht 100 %. ",
  "pyramidCounts": "Balken zeigen Anzahlen{v1}. ",
  "inUnitClause": " in {v1}",
  "pyramidTitle": "Bevölkerungspyramide: {v1} vs {v2}",
  "orderedBands": "{v1} {v1|geordnete Klasse|geordnete Klassen}",
  "closedBands": "{v1} {v1|geschlossene Klasse|geschlossene Klassen}",
  "pyramidShareSubtitle": "% der Gesamtsumme",
  "pyramidShareGroupSubtitle": "% je Gruppe",
  "pyramidShareSnapshotSubtitle": "% je Stichtag",
  "pyramidSharesOfGroup": "Balken zeigen Anteile an der Summe der eigenen Gruppe. Jede Seite ergibt 100 %. ",
  "pyramidSharesDisclosure": " Werte sind Anteile der Gesamtsumme beider Gruppen ({v1}). Die Seiten ergeben jeweils nicht 100 %.",
  "pyramidBandsMethod": "Jede Klasse reicht von ihrer Untergrenze bis knapp unter ihre Obergrenze. Die jüngste Klasse steht unten.",
  "equalBandsMethod": " {v1|Die|Alle} {v1} {v1|Klasse|Klassen} {v1|ist|sind}{v2}.",
  "openBandsMethod": " {v1} {v1|Klasse|Klassen} {v1|ist|sind}{v2}. '{v3}' ist offen. Die Breite ist nicht vergleichbar.",
  "openBandRequired": "{v1} ist eine nach oben offene Klasse (ab {v2}).",
  "bandWidthClause": " mit Breite {v1}",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
