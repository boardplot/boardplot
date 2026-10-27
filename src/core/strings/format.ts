import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "intervalClosed": "{v1} to {v2} inclusive",
  "intervalOpen": "{v1} to under {v2}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "intervalClosed": "{v1} bis einschließlich {v2}",
  "intervalOpen": "{v1} bis unter {v2}",
};

// format.ts and the shared string formatter import each other. Build this
// block on first use, after both modules have finished their initialization.
type Wording = ReturnType<typeof chartStrings<typeof EN>>;
let wording: Wording | undefined;
function getWording(): Wording {
  return wording ??= chartStrings(EN, DE);
}
export function chartString(...args: Parameters<Wording['chartString']>): string {
  return getWording().chartString(...args);
}
