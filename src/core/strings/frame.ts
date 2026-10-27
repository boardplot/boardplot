import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  cutLabels: 'Full text of shortened labels',
  listedInNote: 'Listed in note {n}',
  countedInNote: 'Counted in note {n}; the value is not listed there',
  countedInNotes: 'Not shown on the chart; counted in the notes list',
  listedInNotes: 'Full text is in the notes list',
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  cutLabels: 'Vollständiger Text gekürzter Beschriftungen',
  listedInNote: 'In Anmerkung {n} aufgeführt',
  countedInNote: 'In Anmerkung {n} gezählt; der Wert ist dort nicht aufgeführt',
  countedInNotes: 'Nicht im Diagramm gezeigt; in der Anmerkungsliste gezählt',
  listedInNotes: 'Vollständiger Text steht in der Anmerkungsliste',
};

export const { chartString, localeStrings } = chartStrings(EN, DE);
