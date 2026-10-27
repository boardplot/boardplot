import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "groupedCapital": "Grouped",
  "stackedCapital": "Stacked",
  "stacked100": "100% stacked",
  "barTitle": "Bar chart: {v1} categories",
  "barDesc": "{v1} horizontal bar chart with {v2} series.{v3}",
  "rangesClause": " Ranges: {v1}.",
  "namedRange": "{v1} {v2} to {v3}",
  "footballTitle": "Football-field valuation: {v1} methods",
  "footballDesc": "Football-field range chart. {v1}.",
  "currentValueSentence": " Current value {v1}.",
  "tornadoTitle": "Sensitivity tornado: {v1} drivers",
  "tornadoDescStart": "Sensitivity tornado, one-at-a-time: each driver is varied alone with every other driver held at its base input, ",
  "tornadoDescEffects": "so the swings do not sum to a total and interaction effects are not shown. ",
  "tornadoBaseDesc": "Base case {v1}. Drivers by swing: ",
  "tornadoDriverDesc": "{v1}, {v2} {v3}, {v4} {v5}, swing {v6}{v7}{v8}",
  "inverseClause": ", inverse",
  "baseOutsideClause": ", base outside the swing",
  "inverseDriversDesc": " {v1} of {v2} drivers are inverse: their high input produces the lower output.",
  "gapLead": "gap",
  "missingDriversDesc": " {v1} further driver{v2} — {v3} — {v4} not shown: not measurable, because a one-at-a-time swing needs both case outputs and {v5} missing.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "groupedCapital": "Gruppiert",
  "stackedCapital": "Gestapelt",
  "stacked100": "100 % gestapelt",
  "barTitle": "Balkendiagramm: {v1} {v1|Kategorie|Kategorien}",
  "barDesc": "Horizontales Balkendiagramm ({v1}) mit {v2} {v2|Reihe|Reihen}.{v3}",
  "rangesClause": " Spannen: {v1}.",
  "namedRange": "{v1} {v2} bis {v3}",
  "footballTitle": "Bewertung mit Spannendiagramm: {v1} {v1|Methode|Methoden}",
  "footballDesc": "Spannendiagramm für Bewertungen. {v1}.",
  "currentValueSentence": " Aktueller Wert {v1}.",
  "tornadoTitle": "Sensitivitätstornado: {v1} Treiber",
  "tornadoDescStart": "Sensitivitätstornado: Jeder Treiber wird einzeln geändert. Alle anderen Treiber behalten ihren Basiswert. ",
  "tornadoDescEffects": "Die Spannen ergeben keine Gesamtsumme. Wechselwirkungen werden nicht gezeigt. ",
  "tornadoBaseDesc": "Basisfall {v1}. Treiber nach Spanne: ",
  "tornadoDriverDesc": "{v1}, {v2} {v3}, {v4} {v5}, Spanne {v6}{v7}{v8}",
  "inverseClause": ", invers",
  "baseOutsideClause": ", Basis außerhalb der Spanne",
  "inverseDriversDesc": " {v1} von {v2} {v2|Treiber|Treibern} {v1|ist|sind} invers: Der hohe Eingabewert ergibt den niedrigeren Ausgabewert.",
  "gapLead": "Abstand",
  "missingDriversDesc": " {v1} {v1|weiterer Treiber|weitere Treiber} — {v3} — nicht gezeigt: nicht messbar. Eine einzeln berechnete Spanne braucht beide Ergebnisse. Mindestens eines fehlt.",
};

export const { chartString } = chartStrings(EN, DE);
