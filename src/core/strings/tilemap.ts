import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "notInData": "Not in data",
  "regionCountPrefix": "{v1}-region",
  "listedRegions": "{v1} listed regions",
  "noNumericValues": "No numeric values are available. ",
  "mappedRange": "Mapped range {v1} to {v2}. ",
  "lowerFavorable": "Lower values are favorable. ",
  "mapUnlistedRegions": "{v1} regions are not in the data and use plain background. ",
  "overlaysSentence": "Overlays: {v1} ",
  "sourceSentence": "Source: {v1}{v2}",
  "notPrintedTiles": "Not printed in tiles",
  "valueMissing": "Value missing",
  "tilemapTitle": "{v1} tile map",
  "equalTileGrid": "{v1}-region equal-tile grid; every region has identical visual area. ",
  "tileMissingRegions": "{v1} listed regions have a missing value and a hatched trace. ",
  "codesSentence": "Codes: {v1}.",
  "overlays": "Overlays",
  "userSourceClause": " User source: {v1}",
  // The key entry of a hatched tile and the short credit (no text on the tile).
  "tilemapNoData": "No data",
  "tileCreditShort": "Tile layout: Boardplot, after {v1}",
  // The note and the reading for values the tiles do not print.
  "valuesNotPrinted": "Values not printed in tiles",
  "tileValuesSentence": "Values: {v1}. ",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "notInData": "Nicht in den Daten",
  "regionCountPrefix": "{v1} {v1|Region|Regionen}",
  "listedRegions": "{v1} {v1|aufgeführte Region|aufgeführte Regionen}",
  "noNumericValues": "Keine Zahlenwerte verfügbar. ",
  "mappedRange": "Gezeigte Spanne {v1} bis {v2}. ",
  "lowerFavorable": "Niedrigere Werte sind günstiger. ",
  "mapUnlistedRegions": "{v1} {v1|Region|Regionen} {v1|ist|sind} nicht in den Daten und {v1|nutzt|nutzen} den einfachen Hintergrund. ",
  "overlaysSentence": "Zusatzzeichen: {v1} ",
  "sourceSentence": "Quelle: {v1}{v2}",
  "notPrintedTiles": "Ohne Beschriftung in den Kacheln",
  "valueMissing": "Wert fehlt",
  "tilemapTitle": "{v1} Kachelkarte",
  "equalTileGrid": "Raster mit {v1} {v1|gleich großer Regionenkachel|gleich großen Regionenkacheln}. Jede Region hat die gleiche sichtbare Fläche. ",
  "tileMissingRegions": "{v1} {v1|aufgeführte Region|aufgeführte Regionen} {v1|hat|haben} keinen Wert und eine Schraffur. ",
  "codesSentence": "Kürzel: {v1}.",
  "overlays": "Zusatzzeichen",
  "userSourceClause": " Nutzerquelle: {v1}",
  // The key entry of a hatched tile and the short credit (no text on the tile).
  "tilemapNoData": "Keine Daten",
  "tileCreditShort": "Kachellayout: Boardplot, nach {v1}",
  "valuesNotPrinted": "Werte nicht in den Kacheln",
  "tileValuesSentence": "Werte: {v1}. ",
};

export const { chartString } = chartStrings(EN, DE);
