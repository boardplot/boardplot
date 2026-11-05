import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "funnelTitle": "Funnel: {v1} to {v2}",
  "stagesCount": "{v1} stage{v2}",
  "funnelDesc": "Funnel chart with {v1} stage{v2}. {v3}.",
  "funnelUndefined": "{v1}: not defined, the previous stage is zero.",
  "totalCvr": "Total conversion",
  "stepCvr": "Step conversion",
  // A spanning head over the two short column heads.
  "cvrSpanHeader": "Conversion rate",
  "stepCvrShort": "Step",
  "totalCvrShort": "Total",
  "centeredFunnelDesc": "Centered funnel chart with {v1} equal-height stage bands; width at each boundary is proportional to the stage total. {v2}.",
  "stageIncreased": "↑ increased",
  "stageAdvance": "{v1} advance",
  "previousStageZero": "not defined: previous stage is zero",
  "advanceProbe": "44% advance",
  "missing": "missing",
  "funnelIncreaseDesc": " ({v1} → {v2}: stage total increased; conversion percentage not shown)",
  "funnelConversionDesc": " ({v1} → {v2}: {v3} conversion)",
  "stageCvrDesc": "{v1} {v2}; stage CVR {v3}; total CVR {v4}",
  "clampedFunnelNote": "{v1} {v2} below zero shown as 0.",
  "biggestDrop": "Biggest drop: {v1}",
  "dropValue": "Drop {v1}",
  "stagePair": "{v1} to {v2}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "funnelTitle": "Trichter: {v1} bis {v2}",
  "stagesCount": "{v1} {v1|Stufe|Stufen}",
  "funnelDesc": "Trichterdiagramm mit {v1} {v1|Stufe|Stufen}. {v3}.",
  "funnelUndefined": "{v1}: nicht definiert, vorherige Stufe ist null.",
  "totalCvr": "Gesamt-Konversion",
  "stepCvr": "Stufen-Konversion",
  // A spanning head over the two short column heads.
  "cvrSpanHeader": "Konversionsrate",
  "stepCvrShort": "Stufe",
  "totalCvrShort": "Gesamt",
  "centeredFunnelDesc": "Zentriertes Trichterdiagramm mit {v1} {v1|gleich hoher Stufe|gleich hohen Stufen}. Die Breite jeder Grenze ist proportional zur Summe der Stufe. {v2}.",
  "stageIncreased": "↑ gestiegen",
  "stageAdvance": "{v1} weiter",
  "previousStageZero": "nicht definiert: vorherige Stufe ist null",
  "advanceProbe": "44% weiter",
  "missing": "fehlend",
  "funnelIncreaseDesc": " ({v1} → {v2}: Stufensumme gestiegen; Umwandlungsprozentsatz nicht gezeigt)",
  "funnelConversionDesc": " ({v1} → {v2}: {v3} Umwandlung)",
  "stageCvrDesc": "{v1} {v2}; Stufen-CVR {v3}; Gesamt-CVR {v4}",
  "clampedFunnelNote": "{v1} {v1|Wert|Werte} unter null als 0 gezeigt.",
  "biggestDrop": "Größter Abfall: {v1}",
  "dropValue": "Abfall {v1}",
  "stagePair": "{v1} bis {v2}",
};

export const { chartString } = chartStrings(EN, DE);
