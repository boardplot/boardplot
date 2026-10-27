import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Value withheld",
  "ofValueClause": " of {v1}",
  "highestFirst": "highest first",
  "lowestFirst": "lowest first",
  "shareLabel": "Share:",
  "rankLabel": "Rank:",
  "rankValue": "{v1} of {v2}, {v3}",
  "moreRows": "… {count} more {count|row|rows}",
  "comparisonLabel": "vs {label}:",
  "cardTabHint": "Press Tab to reach the card.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueWithheld": "Wert zurückgehalten",
  "ofValueClause": " von {v1}",
  "highestFirst": "höchster zuerst",
  "lowestFirst": "niedrigster zuerst",
  "shareLabel": "Anteil:",
  "rankLabel": "Rang:",
  "rankValue": "{v1} von {v2}, {v3}",
  "moreRows": "… {count} weitere {count|Zeile|Zeilen}",
  "comparisonLabel": "ggü. {label}:",
  "cardTabHint": "Tab führt in die Karte.",
};

export const { chartString } = chartStrings(EN, DE);
