import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "validColumns": "{v1} valid composition columns",
  "mekkoUnnamedNote": "Not named in place, left to right: {v1}.",
  "mekkoZeroNote": "Not drawn (total 0 or too thin): {v1}.",
  "mekkoNegativeNote": "Not drawn (negative total): {v1}.",
  "mekkoMissingNote": "Not available: {v1}.",
  "totalsSentence": ". Totals: {v1}.",
  "widthTitle": "Column width: {v1}, {v2}",
  "netValue": "net {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "validColumns": "{v1} {v1|gültige Anteilssäule|gültige Anteilssäulen}",
  "mekkoUnnamedNote": "Ohne Beschriftung vor Ort, von links nach rechts: {v1}.",
  "mekkoZeroNote": "Nicht gezeichnet (Summe 0 oder zu schmal): {v1}.",
  "mekkoNegativeNote": "Nicht gezeichnet (negative Summe): {v1}.",
  "mekkoMissingNote": "Nicht verfügbar: {v1}.",
  "totalsSentence": ". Summen: {v1}.",
  "widthTitle": "Spaltenbreite: {v1}, {v2}",
  "netValue": "netto {v1}",
};

export const { chartString } = chartStrings(EN, DE);
