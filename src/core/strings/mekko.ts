import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "mekkoTitle": "Mekko chart: {v1} by {v2} categories",
  "validColumns": "{v1} valid composition columns",
  "mekkoUnnamedNote": "Not named in place, left to right: {v1}.",
  "mekkoZeroNote": "Not drawn (total 0 or too thin): {v1}.",
  "totalsSentence": ". Totals: {v1}.",
  "mekkoPercentAxis": "percent-axis marimekko",
  "mekkoUnitAxis": "unit-axis mekko",
  "barMekko": "bar-mekko",
  "categoryTotals": "category totals",
  "mekkoValidDesc": "{v1}; {v2} valid composition columns × {v3} series; column widths proportional to ",
  "mekkoInvalidDesc": ". Valid totals: {v1}. Suppressed: {v2}.",
  "mekkoDesc": "{v1}, {v2} columns × {v3} series; column widths proportional to ",
  "widthTitle": "Column width: {v1}, {v2}",
  "netValue": "net {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "mekkoTitle": "Mekko-Diagramm: {v1} nach {v2} {v2|Kategorie|Kategorien}",
  "validColumns": "{v1} {v1|gültige Anteilssäule|gültige Anteilssäulen}",
  "mekkoUnnamedNote": "Ohne Beschriftung vor Ort, von links nach rechts: {v1}.",
  "mekkoZeroNote": "Nicht gezeichnet (Summe 0 oder zu schmal): {v1}.",
  "totalsSentence": ". Summen: {v1}.",
  "mekkoPercentAxis": "Marimekko mit Prozentachse",
  "mekkoUnitAxis": "Mekko mit Einheitenachse",
  "barMekko": "Balken-Mekko",
  "categoryTotals": "Kategoriesummen",
  "mekkoValidDesc": "{v1}; {v2} {v2|gültige Anteilssäule|gültige Anteilssäulen} × {v3} {v3|Reihe|Reihen}; Säulenbreiten proportional zu ",
  "mekkoInvalidDesc": ". Gültige Summen: {v1}. Ausgeblendet: {v2}.",
  "mekkoDesc": "{v1}, {v2} {v2|Säule|Säulen} × {v3} {v3|Reihe|Reihen}; Säulenbreiten proportional zu ",
  "widthTitle": "Spaltenbreite: {v1}, {v2}",
  "netValue": "netto {v1}",
};

export const { chartString } = chartStrings(EN, DE);
