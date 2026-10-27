import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "noData": "No data",
  "hatchedNoData": "Hatched cells: no data.",
  "heatmapBaseNote": "Hatched {v1}: base below n = {v2}, read with care.",
  "circles": "circles",
  "cellsLower": "cells",
  "harveyBallName": "Harvey-ball",
  "bubbleScaleWord": "bubble{v1}",
  "circleAreaSize": " (circle area shows size)",
  "discrete": "discrete",
  "continuous": "continuous",
  "heatmapDescStart": "{v1} matrix, {v2} rows × {v3} columns. ",
  "valuesRange": "Values range {v1} to {v2}. ",
  "invertedRowsDesc": "Lower is better for {v1}. ",
  "rowMeansSentence": "Row means: {v1}.",
  "heatmapTitle": "Heatmap: {v1} × {v2} matrix",
  // The note under a bubble matrix that prints values in its largest circles only.
  "heatmapTopValuesNote": "Values shown in the largest circles.",
  // The callout under a value matrix whose story value has no room in its cell ("Aug low").
  "heatmapLeadLow": "{v1} low",
  "heatmapLeadHigh": "{v1} high",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "noData": "Keine Daten",
  "hatchedNoData": "Schraffierte Zellen: keine Daten.",
  "heatmapBaseNote": "Schraffierte {v1}: Basis unter n = {v2}; vorsichtig lesen.",
  "circles": "Kreise",
  "cellsLower": "Zellen",
  "harveyBallName": "Harvey-Ball",
  "bubbleScaleWord": "Blasendiagramm{v1}",
  "circleAreaSize": " (Kreisfläche zeigt Größe)",
  "discrete": "diskret",
  "continuous": "stetig",
  "heatmapDescStart": "{v1} Matrix, {v2} {v2|Zeile|Zeilen} × {v3} {v3|Spalte|Spalten}. ",
  "valuesRange": "Wertespanne {v1} bis {v2}. ",
  "invertedRowsDesc": "Niedriger ist besser für {v1}. ",
  "rowMeansSentence": "Zeilenmittel: {v1}.",
  "heatmapTitle": "Wärmekarte: {v1} × {v2} Matrix",
  // The note under a bubble matrix that prints values in its largest circles only.
  "heatmapTopValuesNote": "Werte stehen in den größten Kreisen.",
  "heatmapLeadLow": "{v1} Tief",
  "heatmapLeadHigh": "{v1} Hoch",
};

export const { chartString } = chartStrings(EN, DE);
