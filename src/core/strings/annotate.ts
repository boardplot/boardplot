import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "seriesSpan": "{v1} to {v2}",
  // author-facing warning, the same on a category axis and a time axis.
  "cagrStartNotPositive": "cagr '{v1}': the start value is not positive, so no growth rate is defined",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "seriesSpan": "{v1} zu {v2}",
  // author-facing warning, the same on a category axis and a time axis.
  "cagrStartNotPositive": "cagr '{v1}': Der Startwert ist nicht positiv, daher ist keine Wachstumsrate definiert",
};

export const { chartString } = chartStrings(EN, DE);
