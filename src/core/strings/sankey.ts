import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  // one flow in the description: source, target and value.
  // the note line that lists the nodes an Other node holds.
  "otherMembers": "{v1}: {v2}",
  // the lead of the note that lists node names too small to print.
  "sankeyHiddenLead": "Smaller nodes",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  // one flow in the description: source, target and value.
  // the note line that lists the nodes an Other node holds.
  "otherMembers": "{v1}: {v2}",
  // the lead of the note that lists node names too small to print.
  "sankeyHiddenLead": "Kleinere Knoten",
};

export const { chartString } = chartStrings(EN, DE);
