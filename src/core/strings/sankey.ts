import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "sankeyTitle": "Sankey: {v1} flows between {v2} nodes, total {v3}",
  "sankeyDesc": "Sankey of {v1} flows between {v2} nodes in {v3} columns, total {v4}. ",
  "largestFlows": "Largest flows: {v1}.",
  // one flow in the description: source, target and value.
  "flowReading": "{v1} to {v2} {v3}",
  // the note line that lists the nodes an Other node holds.
  "otherMembers": "{v1}: {v2}",
  // the lead of the note that lists node names too small to print.
  "sankeyHiddenLead": "Smaller nodes",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "sankeyTitle": "Sankey: {v1} {v1|Fluss|Flüsse} zwischen {v2} Knoten, Summe {v3}",
  "sankeyDesc": "Sankey-Diagramm mit {v1} {v1|Fluss|Flüssen} zwischen {v2} Knoten in {v3} {v3|Spalte|Spalten}, Summe {v4}. ",
  "largestFlows": "Größte Flüsse: {v1}.",
  // one flow in the description: source, target and value.
  "flowReading": "{v1} zu {v2} {v3}",
  // the note line that lists the nodes an Other node holds.
  "otherMembers": "{v1}: {v2}",
  // the lead of the note that lists node names too small to print.
  "sankeyHiddenLead": "Kleinere Knoten",
};

export const { chartString } = chartStrings(EN, DE);
