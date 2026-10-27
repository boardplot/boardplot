import { chartStrings } from '../strings';
export { localizedRecordReason } from './reasons';

const EN = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Value withheld",
  "valueUnavailable": "Unavailable ({v1})",
  "observationUnavailable": "Unavailable (no observation)",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Wert zurückgehalten",
  "valueUnavailable": "Nicht verfügbar ({v1})",
  "observationUnavailable": "Nicht verfügbar (keine Beobachtung)",
};

export const { chartString } = chartStrings(EN, DE);
