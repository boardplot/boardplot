import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "current": "Current",
  "prior": "Prior",
  "pvmEffectVolume": "Volume",
  "pvmEffectMix": "Mix",
  "pvmEffectVolumeMix": "Volume & mix",
  "pvmEffectPrice": "Price",
  "pvmEffectPriceLaspeyres": "Price (Laspeyres)",
  "pvmEffectJoint": "Price x volume",
  // the one-line footer convention.
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "current": "Aktuell",
  "prior": "Vorher",
  "pvmEffectVolume": "Volumen",
  "pvmEffectMix": "Mix",
  "pvmEffectVolumeMix": "Volumen / Mix",
  "pvmEffectPrice": "Preis",
  "pvmEffectPriceLaspeyres": "Preis (Laspeyres)",
  "pvmEffectJoint": "Preis × Volumen",
  // the one-line footer convention.
};

export const { chartString } = chartStrings(EN, DE);
