import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "valueName": "Value",
  "cumulative": "Cumulative",
  "sortedCauses": "{v1} causes sorted descending",
  "firstCount": "The first {v1}",
  "causesOfCount": "{v1} of {v2} causes",
  "smallerCauses": "{v1} smaller causes",
  "cumulativeAxis": "Cumulative share, %",
  // the curve's line item in the highlight key.
  "cumulativeKey": "Cumulative %",
  "paretoTop": "Top {v1}{v2}",
  "outsideTop": "Outside top {v1}",
  "numberCount": "{v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueName": "Wert",
  "cumulative": "Kumuliert",
  "sortedCauses": "{v1} {v1|Ursache|Ursachen} absteigend geordnet",
  "firstCount": "Die ersten {v1}",
  "causesOfCount": "{v1} von {v2} {v2|Ursache|Ursachen}",
  "smallerCauses": "{v1} {v1|kleinere Ursache|kleinere Ursachen}",
  "cumulativeAxis": "Kumulierter Anteil, %",
  // The curve's line item in the highlight key.
  "cumulativeKey": "Kumuliert in %",
  "paretoTop": "Oberste {v1}{v2}",
  "outsideTop": "Außerhalb der obersten {v1}",
  "numberCount": "{v1}",
};

export const { chartString } = chartStrings(EN, DE);
