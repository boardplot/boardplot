import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "shareRoundingMoved": "Printed shares are moved by one step so each whole adds up to 100%. The reading lists the moved shares.",
  "shareRoundingRescaled": "{v1}: the authored parts do not add up to 100, so each share is its part divided by the stack total.",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "shareRoundingMoved": "Gedruckte Anteile sind um einen Schritt verschoben, damit jedes Ganze 100 % ergibt. Das Reading listet die verschobenen Anteile.",
  "shareRoundingRescaled": "{v1}: Die erfassten Teile ergeben nicht 100, daher ist jeder Anteil sein Teil geteilt durch die Summe des Stapels.",
};

export const { chartString } = chartStrings(EN, DE);
