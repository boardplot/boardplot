import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "chartData": "Chart data",
  "chartDataTitle": "Chart data: {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "chartData": "Diagrammdaten",
  "chartDataTitle": "Diagrammdaten: {v1}",
};

export const { chartString } = chartStrings(EN, DE);
