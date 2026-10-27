import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "fallsLower": "falls",
  "risesLower": "rises",
  "chartData": "Chart data",
  "chartDataTitle": "Chart data: {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "fallsLower": "fällt",
  "risesLower": "steigt",
  "chartData": "Diagrammdaten",
  "chartDataTitle": "Diagrammdaten: {v1}",
};

export const { chartString } = chartStrings(EN, DE);
