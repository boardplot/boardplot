/** The band selector, apart from the schema in bands.ts: a layout imports this and keeps zod out of the browser bundle. */

export type ValueBand = { to: number; tone?: 'good' | 'warn' | 'bad' | 'neutral'; label?: string };

/** First band with `value <= to`; a value above every bound gets the last band. `bands` must be non-empty. */
export function bandFor<B extends { to: number }>(value: number, bands: readonly B[]): B {
  return bands.find((band) => value <= band.to) ?? bands[bands.length - 1]!;
}
