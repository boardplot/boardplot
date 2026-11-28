import { BUILT_IN_WORD_KEYS } from '../strings/keys.generated';
import { setWordKeys } from './wordKeyRegistry';

/** Called by the Node entries, which check a misspelt `options.strings` key; a browser bundle never imports this file. */
export function linkWordKeys(): void {
  setWordKeys(BUILT_IN_WORD_KEYS);
}
