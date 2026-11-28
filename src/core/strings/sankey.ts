import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  // one flow in the description: source, target and value.
  // the note line that lists the nodes an Other node holds.
  // the lead of the note that lists node names too small to print.
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  // one flow in the description: source, target and value.
  // the note line that lists the nodes an Other node holds.
  // the lead of the note that lists node names too small to print.
};

export const { chartString } = chartStrings(EN, DE);
