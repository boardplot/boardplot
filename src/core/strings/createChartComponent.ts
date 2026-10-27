import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "hoverMoreListed": "and {count} more (hover shows each value)",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "hoverMoreListed": "und {count} weitere (Zeiger zeigt jeden Wert)",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
