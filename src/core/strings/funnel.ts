import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "stagesCount": "{v1} stage{v2}",
  "funnelUndefined": "{v1}: not defined, the previous stage is zero.",
  "totalCvr": "Total conversion",
  "stepCvr": "Step conversion",
  // A spanning head over the two short column heads.
  "cvrSpanHeader": "Conversion rate",
  "stepCvrShort": "Step",
  "totalCvrShort": "Total",
  "stageIncreased": "↑ increased",
  "stageAdvance": "{v1} advance",
  "previousStageZero": "not defined: previous stage is zero",
  "advanceProbe": "44% advance",
  "missing": "missing",
  "clampedFunnelNote": "{v1} {v2} below zero shown as 0.",
  "biggestDrop": "Biggest drop: {v1}",
  "dropValue": "Drop {v1}",
  "stagePair": "{v1} to {v2}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "stagesCount": "{v1} {v1|Stufe|Stufen}",
  "funnelUndefined": "{v1}: nicht definiert, vorherige Stufe ist null.",
  "totalCvr": "Gesamt-Konversion",
  "stepCvr": "Stufen-Konversion",
  // A spanning head over the two short column heads.
  "cvrSpanHeader": "Konversionsrate",
  "stepCvrShort": "Stufe",
  "totalCvrShort": "Gesamt",
  "stageIncreased": "↑ gestiegen",
  "stageAdvance": "{v1} weiter",
  "previousStageZero": "nicht definiert: vorherige Stufe ist null",
  "advanceProbe": "44% weiter",
  "missing": "fehlend",
  "clampedFunnelNote": "{v1} {v1|Wert|Werte} unter null als 0 gezeigt.",
  "biggestDrop": "Größter Abfall: {v1}",
  "dropValue": "Abfall {v1}",
  "stagePair": "{v1} bis {v2}",
};

export const { chartString } = chartStrings(EN, DE);
