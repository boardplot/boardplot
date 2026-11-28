import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "zoomCovers": "Covers",
  "zoomDays": "days",
  "zoomGrainDay": "Daily",
  "zoomGrainHour": "Hourly",
  "zoomGrainMinute": "Per-minute",
  "zoomGrainMonth": "Monthly",
  "zoomGrainQuarter": "Quarterly",
  "zoomGrainWeek": "Weekly",
  "zoomGrainYear": "Yearly",
  "zoomHours": "hours",
  "zoomMinutes": "min",
  "zoomOf": "of",
  "zoomRuleLast": "last values",
  "zoomRuleMax": "maximums",
  "zoomRuleMean": "means",
  "zoomRuleMin": "minimums",
  "zoomRuleSum": "sums",
  "zoomTo": "to",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "zoomCovers": "Umfasst",
  "zoomDays": "Tagen",
  "zoomGrainDay": "Tägliche",
  "zoomGrainHour": "Stündliche",
  "zoomGrainMinute": "Minütliche",
  "zoomGrainMonth": "Monatliche",
  "zoomGrainQuarter": "Vierteljährliche",
  "zoomGrainWeek": "Wöchentliche",
  "zoomGrainYear": "Jährliche",
  "zoomHours": "Std.",
  "zoomMinutes": "Min.",
  "zoomOf": "von",
  "zoomRuleLast": "letzte Werte",
  "zoomRuleMax": "Maxima",
  "zoomRuleMean": "Mittelwerte",
  "zoomRuleMin": "Minima",
  "zoomRuleSum": "Summen",
  "zoomTo": "bis",
};

export const { chartString } = chartStrings(EN, DE);
