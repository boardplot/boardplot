import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "boxWithheldNote": "{v1} observation{v2} outside the whisker rule ({v3}) {v4} not drawn and {v5} excluded from the value axis, so the spread shown is narrower than the data (showOutliers: false).",
  "boxWithheldCount": "{v1} of them are not drawn",
  "boxBeyondNountukey": "outliers",
  "boxBeyondNounminmax": "values outside the whiskers",
  "boxBeyondNounp10p90": "values outside the 10th–90th percentile range",
  "boxBeyondMeaningtukey": "outliers: observations beyond Q1 − 1.5×IQR or Q3 + 1.5×IQR",
  "boxBeyondMeaningminmax": "nothing is beyond: the whiskers reach every observation",
  "boxBeyondMeaningp10p90": "outer deciles, not outliers: observations below the 10th or above the 90th percentile, which a tenth of any sample reaches by construction",
  "boxHiddenCount": " · {v1} not shown",
  "boxEmptyN": "{v1} · no observations",
  "boxPointsN": "{v1} · observations shown",
  "boxSmallN": "{v1} · too few for a box",
  "boxValuesCount": "{v1} values",
  "boxValuesSpan": "{v1} values, {v2} to {v3}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "boxWithheldNote": "{v1} {v1|Beobachtung|Beobachtungen} außerhalb der Antennenregel ({v3}) {v1|wird|werden} nicht gezeichnet und {v1|ist|sind} aus der Wertachse ausgeschlossen. Die gezeigte Streuung ist daher enger als die Daten (showOutliers: false).",
  "boxWithheldCount": "{v1} davon nicht gezeichnet",
  "boxBeyondNountukey": "Ausreißer",
  "boxBeyondNounminmax": "Werte außerhalb der Antennen",
  "boxBeyondNounp10p90": "Werte außerhalb des 10.–90. Perzentils",
  "boxBeyondMeaningtukey": "Ausreißer: Beobachtungen unter Q1 − 1,5×IQR oder über Q3 + 1,5×IQR",
  "boxBeyondMeaningminmax": "keine Werte außerhalb: Die Antennen reichen zu jeder Beobachtung",
  "boxBeyondMeaningp10p90": "äußere Dezile, keine Ausreißer: Beobachtungen unter dem 10. oder über dem 90. Perzentil. Je ein Zehntel jeder Stichprobe liegt dort.",
  "boxHiddenCount": " · {v1} nicht gezeigt",
  "boxEmptyN": "{v1} · keine Beobachtungen",
  "boxPointsN": "{v1} · Beobachtungen gezeigt",
  "boxSmallN": "{v1} · zu wenige für eine Box",
  "boxValuesCount": "{v1} {v1|Wert|Werte}",
  "boxValuesSpan": "{v1} {v1|Wert|Werte}, {v2} bis {v3}",
};

export const { chartString } = chartStrings(EN, DE);
