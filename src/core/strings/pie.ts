import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "pieHiddenSlices": "{v1} {v2} not labelled",
  "pieDesc": "{v1} chart, {v2} slices of {v3}, total {v4}. ",
  "sharesSentence": "Shares: {v1}.",
  "pieTitle": "{v1} chart: {v2} across {v3} slices",
  "pieName": "pie",
  "doughnutName": "doughnut",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "pieHiddenSlices": "{v1} {v1|Segment|Segmente} ohne Beschriftung",
  "pieDesc": "{v1} Diagramm mit {v2} {v2|Segment|Segmenten} für {v3}, Summe {v4}. ",
  "sharesSentence": "Anteile: {v1}.",
  "pieTitle": "{v1} Diagramm: {v2} über {v3} {v3|Segment|Segmente}",
  "pieName": "Kreis",
  "doughnutName": "Ring",
};

export const { chartString } = chartStrings(EN, DE);
