import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "valueMissing": "Value missing",
  "underValue": "Under {v1}",
  "valueAndAbove": "{v1} and above",
  "overToUnder": "Over {v1} to under {v2}",
  "overToInclusive": "Over {v1} to {v2} inclusive",
  "lowerIsBetterCapital": "Lower is better",
  "higherIsBetterCapital": "Higher is better",
  "betterPole": ", better",
  "worsePole": ", worse",
  "suppressed": "Suppressed",
  "notMeaningful": "Not meaningful",
  "notApplicableName": "Not applicable",
  "suppressedReading": "suppressed",
  "notMeaningfulReading": "not meaningful",
  "notApplicableReading": "not applicable",
  "mapStateCount": "{v1} listed region{v2} {v3} and use{v4} a distinct pattern. ",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "valueMissing": "Wert fehlt",
  "underValue": "Unter {v1}",
  "valueAndAbove": "{v1} und höher",
  "overToUnder": "Über {v1} bis unter {v2}",
  "overToInclusive": "Über {v1} bis einschließlich {v2}",
  "lowerIsBetterCapital": "Niedriger ist besser",
  "higherIsBetterCapital": "Höher ist besser",
  "betterPole": ", besser",
  "worsePole": ", schlechter",
  "suppressed": "Zurückgehalten",
  "notMeaningful": "Nicht aussagekräftig",
  "notApplicableName": "Nicht anwendbar",
  "suppressedReading": "zurückgehalten",
  "notMeaningfulReading": "nicht aussagekräftig",
  "notApplicableReading": "nicht anwendbar",
  "mapStateCount": "{v1} {v1|aufgeführte Region|aufgeführte Regionen} {v1|ist|sind} {v3} und {v1|nutzt|nutzen} ein eigenes Muster. ",
};

export const { chartString } = chartStrings(EN, DE);
