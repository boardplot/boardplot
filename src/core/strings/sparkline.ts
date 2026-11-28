import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "sparklineName": "Sparkline",
  "endingAt": ", ending at {v1}",
  "noValue": "no value",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "sparklineName": "Minidiagramm",
  "endingAt": " mit Endwert {v1}",
  "noValue": "kein Wert",
};

export const { chartString } = chartStrings(EN, DE);
