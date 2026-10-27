/**
 * `othersShade`: how a sequential ramp sits beside an Others slice or Rest
 * series. One constant holds the default for pie, column and line; change
 * it here to change all three.
 */
export type OthersShade = 'quietest' | 'apart';

export const DEFAULT_OTHERS_SHADE: OthersShade = 'quietest';

/** Describe text for the option, with the default read from the constant. */
export function othersShadeDescribe(subject: string): string {
  return `${subject} Default '${DEFAULT_OTHERS_SHADE}'. 'quietest': Others is the quietest part, so every named step has more contrast against the background than Others and none matches it. 'apart': named steps only differ from Others, and some may be quieter. If Others is stronger than the first named step, the ramp falls back to 'apart' and the chart warns others-shade-unavailable.`;
}
