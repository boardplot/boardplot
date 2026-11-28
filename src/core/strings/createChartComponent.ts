import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "hoverMoreListed": "and {count} more (tap or hover shows each value)",
  "chartScrollName": "{type} chart",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "hoverMoreListed": "und {count} weitere (Tippen oder Zeiger zeigt jeden Wert)",
  "chartScrollName": "{type}-Diagramm",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
