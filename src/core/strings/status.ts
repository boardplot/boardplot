import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "noStatus": "No status",
  "noStatusCount": "No status {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "noStatus": "Kein Status",
  "noStatusCount": "Kein Status {v1}",
};

export const { chartString } = chartStrings(EN, DE);
