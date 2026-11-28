import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "waterfallChart": "Waterfall chart",
  "horizontalWaterfall": "Horizontal waterfall chart",
  "change": "Change",
  "axisBreakNote": "Value axis broken between {v1} and {v2}",
  "checkTotalNote": "{v1} is drawn at {v2}, the sum of its steps; the data states {v3}",
  "checkSegmentsNote": "{v1} is drawn at {v2}, the sum of its segments; the data states {v3}",
  "increase": "Increase",
  "decrease": "Decrease",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "waterfallChart": "Wasserfalldiagramm",
  "horizontalWaterfall": "Horizontales Wasserfalldiagramm",
  "change": "Änderung",
  "axisBreakNote": "Wertachse zwischen {v1} und {v2} unterbrochen",
  "checkTotalNote": "{v1} ist als Summe der Schritte mit {v2} gezeichnet; die Daten nennen {v3}",
  "checkSegmentsNote": "{v1} ist als Summe der Segmente mit {v2} gezeichnet; die Daten nennen {v3}",
  "increase": "Zunahme",
  "decrease": "Abnahme",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
