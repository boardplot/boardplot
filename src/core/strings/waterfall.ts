import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "waterfallChart": "Waterfall chart",
  "horizontalWaterfall": "Horizontal waterfall chart",
  "totalHighlightedStep": "Total, highlighted step",
  "change": "Change",
  "highlightedStep": "Highlighted step",
  "highlightedSteps": "Highlighted steps",
  "axisBreakNote": "Value axis broken between {v1} and {v2}",
  "checkTotalNote": "{v1} is drawn at {v2}, the sum of its steps; the data states {v3}",
  "checkSegmentsNote": "{v1} is drawn at {v2}, the sum of its segments; the data states {v3}",
  "waterfallCasesDesc": "{v1} cases side by side in each step. {v2}",
  "waterfallTitle": "Waterfall: {v1} to {v2}",
  "waterfallDesc": "Waterfall chart{v1}. {v2}.",
  "buildDownClause": " (build-down)",
  "increase": "Increase",
  "decrease": "Decrease",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "waterfallChart": "Wasserfalldiagramm",
  "horizontalWaterfall": "Horizontales Wasserfalldiagramm",
  "totalHighlightedStep": "Summe, hervorgehobener Schritt",
  "change": "Änderung",
  "highlightedStep": "Hervorgehobener Schritt",
  "highlightedSteps": "Hervorgehobene Schritte",
  "axisBreakNote": "Wertachse zwischen {v1} und {v2} unterbrochen",
  "checkTotalNote": "{v1} ist als Summe der Schritte mit {v2} gezeichnet; die Daten nennen {v3}",
  "checkSegmentsNote": "{v1} ist als Summe der Segmente mit {v2} gezeichnet; die Daten nennen {v3}",
  "waterfallCasesDesc": "{v1} {v1|Fall|Fälle} nebeneinander in jedem Schritt. {v2}",
  "waterfallTitle": "Wasserfall: {v1} bis {v2}",
  "waterfallDesc": "Wasserfalldiagramm{v1}. {v2}.",
  "buildDownClause": " (absteigend)",
  "increase": "Zunahme",
  "decrease": "Abnahme",
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
